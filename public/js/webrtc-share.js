/**
 * ============================================================================
 * SYNCPARTY WEBRTC SCREEN SHARING & HIGH-GAIN AUDIO ENGINE v5.0
 * 60 FPS Canvas Yayını, Çift Katmanlı Yüksek Ses Amplifikatörü (Audio Booster),
 * Donanımsal WebRTC Audio + PCM Web Audio Fallback, İmleç & Sekme İzolasyonu
 * ============================================================================
 */

class WebRTCShareEngine {
  constructor(socket) {
    this.socket = socket;
    this.isSharing = false;
    this.localStream = null;
    this.peerConnections = new Map();

    // Canvas & Video Elemanları
    this.canvas = document.getElementById('webrtc-canvas');
    this.ctx = this.canvas ? this.canvas.getContext('2d', { alpha: false, desynchronized: true }) : null;
    this.webrtcVideo = document.getElementById('webrtc-video');

    // Gizli Yakalama Elemanları (Host)
    this.captureVideo = document.createElement('video');
    this.captureVideo.muted = true;
    this.captureVideo.playsInline = true;

    this.outCanvas = document.createElement('canvas');
    this.outCtx = this.outCanvas.getContext('2d', { alpha: false });

    // Çerçeve Döngüsü ve Çizim Durumu
    this.frameTimer = null;
    this.isEncoding = false;
    this.lastEncodingTime = 0;
    this.lastEncodedBlob = null;
    this.latestFrame = null;
    this.isDrawing = false;
    this.lastDrawTime = 0;

    // Yüksek Kazançlı Ses Sistemi (İzleyici)
    this.guestAudioCtx = null;
    this.guestGainNode = null;
    this.nextPlayTime = 0;
    this.p2pAudioEl = null;

    // Ses Yakalama Sistemi (Host)
    this.hostAudioCtx = null;
    this.hostProc = null;
    this.hostSource = null;

    // UI Butonları
    this.shareBtn = document.getElementById('btn-screen-share');
    this.shareBtnText = document.getElementById('screen-share-btn-text');
    this.autoplayOverlay = document.getElementById('webrtc-autoplay-overlay');
    this.resumeBtn = document.getElementById('btn-resume-live');

    // STUN Yapılandırması
    this.rtcCfg = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' }
      ]
    };

    this._init();
  }

  _init() {
    // Özel P2P Ses Elemanı oluştur
    this.p2pAudioEl = document.createElement('audio');
    this.p2pAudioEl.autoplay = true;
    this.p2pAudioEl.playsInline = true;
    this.p2pAudioEl.style.display = 'none';
    document.body.appendChild(this.p2pAudioEl);

    // Global Ses Kilidi Çözücü
    const unlock = () => this._unlockAudio();
    if (this.resumeBtn) this.resumeBtn.addEventListener('click', unlock);
    if (this.autoplayOverlay) this.autoplayOverlay.addEventListener('click', unlock);
    document.addEventListener('click', unlock, { passive: true });
    document.addEventListener('touchstart', unlock, { passive: true });
    document.addEventListener('keydown', unlock, { passive: true });

    // Ekran Paylaş Butonu
    if (this.shareBtn) {
      this.shareBtn.addEventListener('click', () => {
        if (this.isSharing) {
          this._stopShare();
        } else {
          this._promptAndStartShare();
        }
      });
    }

    // ─── İZLEYİCİ: Canlı Video Karesi Al ───
    this.socket.on('screenshare-frame', (data) => {
      if (this.isSharing) return;
      this.latestFrame = data instanceof Blob ? data : new Blob([data], { type: 'image/jpeg' });
      if (!this.isDrawing) this._drawFrame();
    });

    // ─── İZLEYİCİ: Canlı PCM Ses Al (Yüksek Kazançlı) ───
    this.socket.on('screenshare-audio', (d) => {
      if (!this.isSharing) {
        this._playAudio(d);
      }
    });

    // ─── İZLEYİCİ: Ekran Paylaşım Durum Değişimi ───
    this.socket.on('screenshare-status-update', ({ active, media }) => {
      console.log('[WebRTC] screenshare-status-update:', active);
      if (this.isSharing) return;

      if (active) {
        this._showLayer();
        if (window.syncEngine) window.syncEngine.loadMedia(media);
        window.showToast('📺 Canlı film ve ekran yayını başladı!');
        this._unlockAudio();
        setTimeout(() => this.socket.emit('guest-needs-stream'), 300);
      } else {
        if (this.ctx && this.canvas) this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        if (this.p2pAudioEl) this.p2pAudioEl.srcObject = null;
        if (window.syncEngine) window.syncEngine.loadMedia(media);
        window.showToast('📺 Ekran yayını sonlandırıldı.');
      }
    });

    // ─── WebRTC Sinyalleşme ───
    this.socket.on('webrtc-signal', async ({ senderId, signal, type }) => {
      await this._handleSignal(senderId, signal, type);
    });

    // ─── Katılımcı Odaya Girdiğinde Akışı İlet ───
    this.socket.on('user-joined', ({ user }) => {
      if (this.isSharing && this.localStream && user.id !== this.socket.id) {
        this._createPeer(user.id, true);
        if (this.lastEncodedBlob) {
          this.socket.emit('screenshare-frame', this.lastEncodedBlob);
        }
      }
    });

    // ─── İzleyici Akış İstediğinde (Sonradan Katılan İzleyiciye Anında Ekran Gönder) ───
    this.socket.on('guest-needs-stream', ({ guestId }) => {
      if (this.isSharing && this.localStream) {
        this._createPeer(guestId, true);
        if (this.lastEncodedBlob) {
          this.socket.emit('screenshare-frame', this.lastEncodedBlob);
        }
      }
    });
  }

  startScreenShare() {
    this._promptAndStartShare();
  }

  stopScreenShare() {
    this._stopShare();
  }

  // ================================================================
  // HOST: Kullanıcıyı Bilgilendir ve Ekran Paylaşımını Başlat
  // ================================================================
  _promptAndStartShare() {
    window.showToast('🎬 İpucu: Açılan pencerede "SEKME" seçip "Sekme Sesini Paylaş" kutusunu işaretleyin.');
    setTimeout(() => {
      this._startShare();
    }, 150);
  }

  async _startShare() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: 'never', // Fare imlecini tamamen yok et
          displaySurface: 'browser',
          frameRate: { ideal: 30, max: 60 },
          width: { ideal: 1920, max: 2560 },
          height: { ideal: 1080, max: 1440 }
        },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          suppressLocalAudioPlayback: false
        },
        preferCurrentTab: false,
        selfBrowserSurface: 'exclude',
        systemAudio: 'include',
        surfaceSwitching: 'include'
      });

      this.localStream = stream;
      this.isSharing = true;

      this.captureVideo.srcObject = stream;
      await this.captureVideo.play().catch(() => {});

      this._showLayer();
      this._startFrameLoop();

      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length > 0) {
        this._startAudioCapture(stream);
        window.showToast('🔊 Sekme sesi ve film yayını aktif!');
      } else {
        window.showToast('⚠️ Ses Gitmiyor: "Sekme Sesini Paylaş" kutusunu işaretleyerek yeniden başlatın.');
      }

      if (this.shareBtn) {
        this.shareBtn.classList.add('btn-primary');
        this.shareBtn.classList.remove('btn-secondary-sm');
      }
      if (this.shareBtnText) this.shareBtnText.textContent = 'Paylaşımı Durdur';

      this.socket.emit('screenshare-status', { active: true });

      if (window.roomEngine && window.roomEngine.users) {
        window.roomEngine.users.forEach(u => {
          if (u.id !== this.socket.id) this._createPeer(u.id, true);
        });
      }

      stream.getVideoTracks()[0].onended = () => this._stopShare();
      window.showToast('🚀 Ekran ve film yayını başladı!');
    } catch (err) {
      console.warn('Ekran paylaşımı başlatılamadı:', err);
      if (err.name !== 'NotAllowedError') {
        window.showToast('❌ Ekran paylaşımı başlatılamadı.');
      }
    }
  }

  // ================================================================
  // HOST: 25 FPS Akıcı, Sıfır Gecikmeli & Ultra Hafif Kare Gönderme Döngüsü
  // ================================================================
  _startFrameLoop() {
    if (this.frameTimer) clearInterval(this.frameTimer);
    this.isEncoding = false;
    this.lastEncodingTime = Date.now();

    this.frameTimer = setInterval(() => {
      if (!this.isSharing || !this.captureVideo.videoWidth) return;

      // 🛡️ Watchdog: Eğer önceki kare 150ms'den uzun sürdüyse kilidi zorla aç
      if (this.isEncoding) {
        if (Date.now() - this.lastEncodingTime > 150) {
          this.isEncoding = false;
        } else {
          return;
        }
      }

      this.isEncoding = true;
      this.lastEncodingTime = Date.now();

      const vw = this.captureVideo.videoWidth;
      const vh = this.captureVideo.videoHeight;

      // Ultra Akıcı ve Sıfır Gecikmeli 960px (720p 16:9) Optimize Ölçeklendirme
      const scale = Math.min(1, 960 / vw);
      const tw = Math.round(vw * scale);
      const th = Math.round(vh * scale);

      if (this.outCanvas.width !== tw || this.outCanvas.height !== th) {
        this.outCanvas.width = tw;
        this.outCanvas.height = th;
      }
      this.outCtx.drawImage(this.captureVideo, 0, 0, tw, th);

      // Host önizleme canvas'ı
      if (this.canvas && this.ctx) {
        if (this.canvas.width !== tw || this.canvas.height !== th) {
          this.canvas.width = tw;
          this.canvas.height = th;
        }
        this.ctx.drawImage(this.outCanvas, 0, 0);
      }

      // Ultra optimize 0.58 JPEG kalitesi (Sadece ~25 KB, sıfır ağ tıkanması & anında iletim)
      this.outCanvas.toBlob((blob) => {
        this.isEncoding = false;
        if (blob && this.isSharing) {
          this.lastEncodedBlob = blob;
          this.socket.emit('screenshare-frame', blob);
        }
      }, 'image/jpeg', 0.58);
    }, 40); // 25 FPS (Kesintisiz sinema akıcılığı & 0 gecikme)
  }

  // ================================================================
  // HOST: Kesintisiz PCM Ses Yakalama & Sıkıştırma
  // ================================================================
  _startAudioCapture(stream) {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.hostAudioCtx = new AC();
      this.hostSource = this.hostAudioCtx.createMediaStreamSource(stream);

      this.hostProc = this.hostAudioCtx.createScriptProcessor(4096, 1, 1);
      this.hostSource.connect(this.hostProc);

      const dummyGain = this.hostAudioCtx.createGain();
      dummyGain.gain.value = 0.0001;
      this.hostProc.connect(dummyGain);
      dummyGain.connect(this.hostAudioCtx.destination);

      this.hostProc.onaudioprocess = (e) => {
        if (!this.isSharing) return;
        const f = e.inputBuffer.getChannelData(0);
        const i = new Int16Array(f.length);
        for (let k = 0; k < f.length; k++) {
          const s = Math.max(-1, Math.min(1, f[k]));
          i[k] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        this.socket.emit('screenshare-audio', {
          pcm: i.buffer,
          sampleRate: this.hostAudioCtx.sampleRate
        });
      };
    } catch (e) {
      console.warn('[AudioCapture] Hata:', e);
    }
  }

  // ================================================================
  // HOST: Ekran Paylaşımını Durdur
  // ================================================================
  _stopShare() {
    if (this.frameTimer) { clearInterval(this.frameTimer); this.frameTimer = null; }
    if (this.hostProc) { try { this.hostProc.disconnect(); } catch(e){} this.hostProc = null; }
    if (this.hostSource) { try { this.hostSource.disconnect(); } catch(e){} this.hostSource = null; }
    if (this.hostAudioCtx) { try { this.hostAudioCtx.close(); } catch(e){} this.hostAudioCtx = null; }
    if (this.localStream) { this.localStream.getTracks().forEach(t => t.stop()); this.localStream = null; }

    this.peerConnections.forEach(pc => { try { pc.close(); } catch(e){} });
    this.peerConnections.clear();
    this.isSharing = false;
    this.lastEncodedBlob = null;

    if (this.shareBtn) {
      this.shareBtn.classList.remove('btn-primary');
      this.shareBtn.classList.add('btn-secondary-sm');
    }
    if (this.shareBtnText) this.shareBtnText.textContent = 'Ekran Paylaş';
    if (this.ctx && this.canvas) this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    this.socket.emit('screenshare-status', { active: false });
    if (window.syncEngine) window.syncEngine.loadMedia({ type: 'idle', url: '', title: '🎬 Henüz bir video seçilmedi' });
  }

  // ================================================================
  // İZLEYİCİ: En Güncel Kareyi Çiz (Donma Korumalı & Kesintisiz)
  // ================================================================
  _drawFrame() {
    if (!this.latestFrame) {
      this.isDrawing = false;
      return;
    }

    if (this.isDrawing) {
      if (Date.now() - this.lastDrawTime > 250) {
        this.isDrawing = false;
      } else {
        return;
      }
    }

    this.isDrawing = true;
    this.lastDrawTime = Date.now();

    const blob = this.latestFrame;
    this.latestFrame = null;

    if (window.createImageBitmap) {
      createImageBitmap(blob).then(bmp => {
        if (!this.canvas || !this.ctx) {
          bmp.close();
          this.isDrawing = false;
          return;
        }
        if (this.canvas.width !== bmp.width || this.canvas.height !== bmp.height) {
          this.canvas.width = bmp.width;
          this.canvas.height = bmp.height;
        }
        this.ctx.drawImage(bmp, 0, 0);
        bmp.close();
        this.isDrawing = false;
        if (this.latestFrame) {
          requestAnimationFrame(() => this._drawFrame());
        }
      }).catch(() => {
        this.isDrawing = false;
        if (this.latestFrame) {
          requestAnimationFrame(() => this._drawFrame());
        }
      });
    } else {
      const img = new Image();
      const url = URL.createObjectURL(blob);
      img.onload = () => {
        if (!this.canvas || !this.ctx) {
          URL.revokeObjectURL(url);
          this.isDrawing = false;
          return;
        }
        if (this.canvas.width !== img.naturalWidth || this.canvas.height !== img.naturalHeight) {
          this.canvas.width = img.naturalWidth;
          this.canvas.height = img.naturalHeight;
        }
        this.ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        this.isDrawing = false;
        if (this.latestFrame) {
          requestAnimationFrame(() => this._drawFrame());
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        this.isDrawing = false;
      };
      img.src = url;
    }
  }

  // ================================================================
  // İZLEYİCİ: Yüksek Kazançlı Güçlendirilmiş Ses Çalma (Audio Booster)
  // ================================================================
  _playAudio({ pcm, sampleRate }) {
    if (!pcm) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!this.guestAudioCtx && AC) {
        this.guestAudioCtx = new AC();
        this.nextPlayTime = this.guestAudioCtx.currentTime;
      }
      if (!this.guestAudioCtx) return;

      if (this.guestAudioCtx.state === 'suspended') {
        this.guestAudioCtx.resume().catch(() => {});
      }

      const i16 = new Int16Array(pcm);
      const f32 = new Float32Array(i16.length);
      for (let i = 0; i < i16.length; i++) {
        f32[i] = i16[i] / 32768.0;
      }

      const targetRate = sampleRate || this.guestAudioCtx.sampleRate;
      const buf = this.guestAudioCtx.createBuffer(1, f32.length, targetRate);
      buf.copyToChannel(f32, 0);

      const src = this.guestAudioCtx.createBufferSource();
      src.buffer = buf;

      // 🔊 Gelişmiş Ses Güçlendirici (Audio Booster): Kullanıcı ses ayarını 2.5 kat amplifiye et
      const gainNode = this.guestAudioCtx.createGain();
      const rawVol = window.syncEngine ? window.syncEngine.localVolume : 100;
      const isMuted = window.syncEngine ? window.syncEngine.isMuted : false;
      const gainVal = isMuted ? 0 : (rawVol / 100) * 2.2; // 2.2x Yüksek Güçlü Net Ses
      gainNode.gain.value = gainVal;

      src.connect(gainNode);
      gainNode.connect(this.guestAudioCtx.destination);

      const now = this.guestAudioCtx.currentTime;
      if (this.nextPlayTime < now) {
        this.nextPlayTime = now + 0.01;
      }
      src.start(this.nextPlayTime);
      this.nextPlayTime += buf.duration;
    } catch (e) {
      console.warn('[AudioPlay] Hata:', e);
    }
  }

  _unlockAudio() {
    if (this.autoplayOverlay) this.autoplayOverlay.classList.add('hidden');
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!this.guestAudioCtx && AC) {
      this.guestAudioCtx = new AC();
      this.nextPlayTime = this.guestAudioCtx.currentTime;
    }
    if (this.guestAudioCtx && this.guestAudioCtx.state === 'suspended') {
      this.guestAudioCtx.resume().then(() => {
        console.log('[WebRTC] Ses kilidi başarıyla açıldı.');
      }).catch(() => {});
    }
    if (this.p2pAudioEl) {
      this.p2pAudioEl.muted = false;
      this.p2pAudioEl.play().catch(() => {});
    }
    if (this.webrtcVideo) {
      this.webrtcVideo.muted = false;
      this.webrtcVideo.play().catch(() => {});
    }
  }

  // ================================================================
  // Katmanı Görünür Yap
  // ================================================================
  _showLayer() {
    ['idle-player-container', 'youtube-player-container', 'html5-player-container', 'embed-player-container'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });

    const wrtc = document.getElementById('webrtc-player-container');
    if (wrtc) {
      wrtc.classList.remove('hidden');
      wrtc.style.display = 'flex';
    }

    if (this.canvas) {
      this.canvas.classList.remove('hidden');
      this.canvas.style.display = 'block';
    }
  }

  // ================================================================
  // WebRTC P2P Doğrudan Donanımsal Akış & Ses Entegrasyonu
  // ================================================================
  _createPeer(peerId, isInitiator) {
    if (this.peerConnections.has(peerId)) {
      try { this.peerConnections.get(peerId).close(); } catch(e){}
      this.peerConnections.delete(peerId);
    }

    const pc = new RTCPeerConnection(this.rtcCfg);
    pc._queue = [];
    this.peerConnections.set(peerId, pc);

    if (this.localStream) {
      this.localStream.getTracks().forEach(t => pc.addTrack(t, this.localStream));
    }

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this.socket.emit('webrtc-signal', {
          targetId: peerId,
          signal: { candidate: candidate.candidate, sdpMid: candidate.sdpMid, sdpMLineIndex: candidate.sdpMLineIndex },
          type: 'candidate'
        });
      }
    };

    // İzleyicide gelen donanımsal track'leri karşıla
    pc.ontrack = (evt) => {
      console.log('[WebRTC P2P] Track alındı:', evt.track.kind);
      const stream = evt.streams?.[0] || new MediaStream([evt.track]);

      if (evt.track.kind === 'audio') {
        if (this.p2pAudioEl) {
          this.p2pAudioEl.srcObject = stream;
          this.p2pAudioEl.muted = false;
          this.p2pAudioEl.volume = 1.0;
          this.p2pAudioEl.play().catch(() => {});
        }
      } else if (evt.track.kind === 'video') {
        const vid = document.getElementById('webrtc-video');
        if (vid) {
          vid.srcObject = stream;
          vid.muted = false;
          vid.classList.remove('hidden');
          vid.style.display = 'block';
          vid.play().catch(() => { vid.muted = true; vid.play().catch(() => {}); });
          if (this.canvas) this.canvas.classList.add('hidden');
        }
      }
      this._showLayer();
    };

    if (isInitiator) {
      setTimeout(async () => {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          this.socket.emit('webrtc-signal', {
            targetId: peerId,
            signal: { type: offer.type, sdp: offer.sdp },
            type: 'offer'
          });
        } catch (e) { console.error('[WebRTC] Offer hatası:', e); }
      }, 80);
    }

    return pc;
  }

  async _handleSignal(senderId, signal, type) {
    let pc = this.peerConnections.get(senderId);
    if (!pc) pc = this._createPeer(senderId, false);

    try {
      if (type === 'offer') {
        await pc.setRemoteDescription(new RTCSessionDescription({ type: signal.type, sdp: signal.sdp }));
        for (const c of (pc._queue || [])) { try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch(e){} }
        pc._queue = [];
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.socket.emit('webrtc-signal', {
          targetId: senderId,
          signal: { type: answer.type, sdp: answer.sdp },
          type: 'answer'
        });
      } else if (type === 'answer' && pc.signalingState !== 'stable') {
        await pc.setRemoteDescription(new RTCSessionDescription({ type: signal.type, sdp: signal.sdp }));
        for (const c of (pc._queue || [])) { try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch(e){} }
        pc._queue = [];
      } else if (type === 'candidate' && signal?.candidate) {
        const c = { candidate: signal.candidate, sdpMid: signal.sdpMid, sdpMLineIndex: signal.sdpMLineIndex };
        if (pc.remoteDescription?.type) {
          try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch(e){}
        } else {
          if (!pc._queue) pc._queue = [];
          pc._queue.push(c);
        }
      }
    } catch (e) {
      console.error('[WebRTC] Signal hatası:', type, e);
    }
  }
}
