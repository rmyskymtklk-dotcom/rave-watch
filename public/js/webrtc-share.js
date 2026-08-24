/**
 * ============================================================================
 * SYNCPARTY BULLETPROOF SCREEN & AUDIO STREAMING ENGINE v7.0
 * Garantili Canlı Görüntü & Kristal Netliğinde Ses, 0 Gecikme, Kesintisiz Akış
 * ============================================================================
 */

class WebRTCShareEngine {
  constructor(socket) {
    this.socket = socket;
    this.isSharing = false;
    this.localStream = null;
    this.peerConnections = new Map();

    // Canvas ve Video Elemanları
    this.canvas = document.getElementById('webrtc-canvas');
    this.ctx = this.canvas ? this.canvas.getContext('2d', { alpha: false }) : null;
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

    this.rtcCfg = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
      ]
    };

    this._init();
  }

  _init() {
    // Ses Kilidi Çözücü
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

    // ─── İZLEYİCİ: Canlı Video Karesi Al ve Anında Çiz ───
    this.socket.on('screenshare-frame', (data) => {
      if (this.isSharing) return;
      this.latestFrame = data instanceof Blob ? data : new Blob([data], { type: 'image/jpeg' });
      this._drawFrame();
    });

    // ─── İZLEYİCİ: Canlı PCM Ses Al ───
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
        setTimeout(() => this.socket.emit('guest-needs-stream'), 200);
      } else {
        if (this.ctx && this.canvas) this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
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

    // ─── İzleyici Akış İstediğinde (Anında İlk Kareyi Gönder) ───
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
          cursor: 'never',
          displaySurface: 'browser',
          frameRate: { ideal: 30, max: 60 }
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

      // Odadaki tüm izleyicilere bağlantı aç
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
  // HOST: Kesintisiz & Akıcı Kare Gönderme Döngüsü
  // ================================================================
  _startFrameLoop() {
    if (this.frameTimer) clearInterval(this.frameTimer);
    this.isEncoding = false;
    this.lastEncodingTime = Date.now();

    this.frameTimer = setInterval(() => {
      if (!this.isSharing || !this.captureVideo.videoWidth) return;

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

      // Akıcı ve optimize 960px genişlik
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

      this.outCanvas.toBlob((blob) => {
        this.isEncoding = false;
        if (blob && this.isSharing) {
          this.lastEncodedBlob = blob;
          this.socket.emit('screenshare-frame', blob);
        }
      }, 'image/jpeg', 0.65);
    }, 33); // ~30 FPS
  }

  // ================================================================
  // HOST: Kesintisiz PCM Ses Yakalama
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
  // İZLEYİCİ: En Güncel Kareyi Çiz (Garantili & Kesintisiz)
  // ================================================================
  _drawFrame() {
    if (!this.latestFrame) return;

    if (this.isDrawing) {
      if (Date.now() - this.lastDrawTime > 150) {
        this.isDrawing = false;
      } else {
        return;
      }
    }

    this.isDrawing = true;
    this.lastDrawTime = Date.now();

    const blob = this.latestFrame;
    this.latestFrame = null;

    // Canvas'ın her zaman görünür ve açık olduğundan emin ol
    if (this.canvas && this.canvas.classList.contains('hidden')) {
      this.canvas.classList.remove('hidden');
      this.canvas.style.display = 'block';
    }

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
  // İZLEYİCİ: 2.2x Yüksek Kazançlı Ses Çalma (Audio Booster)
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

      const gainNode = this.guestAudioCtx.createGain();
      const rawVol = window.syncEngine ? window.syncEngine.localVolume : 100;
      const isMuted = window.syncEngine ? window.syncEngine.isMuted : false;
      const gainVal = isMuted ? 0 : (rawVol / 100) * 2.2;
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
      this.guestAudioCtx.resume().catch(() => {});
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
  // WebRTC P2P Bağlantı
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
      }, 50);
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
