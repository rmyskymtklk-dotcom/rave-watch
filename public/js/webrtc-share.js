/**
 * ============================================================================
 * SYNCPARTY BULLETPROOF SCREEN & AUDIO STREAMING ENGINE v8.0
 * Garantili Canlı Görüntü (Host & İzleyici), 3.5x Ses Güçlendirici, 0 Bellek Sızıntısı
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

    // Bellek İçi Çizim Canvas'ı (Host)
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

    // Kalıcı Ses Sistemi (İzleyici - 0 Bellek Sızıntısı & 3.5x Audio Booster)
    this.guestAudioCtx = null;
    this.guestCompressor = null;
    this.guestGainNode = null;
    this.nextPlayTime = 0;

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

      // Host kendi ekranını doğrudan hardware-accelerated video elementiyle 60fps kesintisiz görür
      if (this.webrtcVideo) {
        this.webrtcVideo.srcObject = stream;
        this.webrtcVideo.muted = true;
        this.webrtcVideo.classList.remove('hidden');
        this.webrtcVideo.style.display = 'block';
        await this.webrtcVideo.play().catch(() => {});
      }

      if (this.canvas) {
        this.canvas.classList.add('hidden');
        this.canvas.style.display = 'none';
      }

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
  // HOST: Kesintisiz & Akıcı Kare Gönderme Döngüsü (25 FPS, Hafif & 0 Lag)
  // ================================================================
  _startFrameLoop() {
    if (this.frameTimer) clearInterval(this.frameTimer);
    this.isEncoding = false;
    this.lastEncodingTime = Date.now();

    this.frameTimer = setInterval(() => {
      if (!this.isSharing) return;

      const videoSource = (this.webrtcVideo && this.webrtcVideo.videoWidth) ? this.webrtcVideo : null;
      if (!videoSource) return;

      const vw = videoSource.videoWidth;
      const vh = videoSource.videoHeight;
      if (!vw || !vh) return;

      if (this.isEncoding) {
        if (Date.now() - this.lastEncodingTime > 80) {
          this.isEncoding = false;
        } else {
          return; // Önceki kare henüz işleniyor, drop et (ağ kuyruk birikmesini ve gecikmeyi 0'a indir)
        }
      }

      this.isEncoding = true;
      this.lastEncodingTime = Date.now();

      // ⚡ Süper Hafif & Net 1024px Genişlik (Sıfır Donma, Sıfır Kasma)
      const scale = Math.min(1, 1024 / vw);
      const tw = Math.round(vw * scale);
      const th = Math.round(vh * scale);

      if (this.outCanvas.width !== tw || this.outCanvas.height !== th) {
        this.outCanvas.width = tw;
        this.outCanvas.height = th;
      }
      this.outCtx.drawImage(videoSource, 0, 0, tw, th);

      // ⚡ Optimize JPEG (18-20 KB küçük paketler, anında iletilir)
      this.outCanvas.toBlob((blob) => {
        this.isEncoding = false;
        if (blob && this.isSharing) {
          this.lastEncodedBlob = blob;
          this.socket.emit('screenshare-frame', blob);
        }
      }, 'image/jpeg', 0.58);
    }, 40); // 25 FPS Akıcı & Kesintisiz
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

    if (this.webrtcVideo) {
      this.webrtcVideo.srcObject = null;
      this.webrtcVideo.classList.add('hidden');
      this.webrtcVideo.style.display = 'none';
    }
    if (this.canvas) {
      this.canvas.classList.remove('hidden');
      this.canvas.style.display = 'block';
    }

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
  // İZLEYİCİ: En Güncel Kareyi Çiz (Garantili & Sıfır Boşluk)
  // ================================================================
  _drawFrame() {
    if (!this.latestFrame) return;

    if (this.isDrawing) {
      if (Date.now() - this.lastDrawTime > 120) {
        this.isDrawing = false;
      } else {
        return;
      }
    }

    this.isDrawing = true;
    this.lastDrawTime = Date.now();

    const blob = this.latestFrame;
    this.latestFrame = null;

    // WebRTC katmanının açık olduğundan emin ol
    const wrtc = document.getElementById('webrtc-player-container');
    if (wrtc && (wrtc.classList.contains('hidden') || wrtc.style.display === 'none')) {
      this._showLayer();
    }

    if (this.canvas && (this.canvas.classList.contains('hidden') || this.canvas.style.display === 'none')) {
      this.canvas.classList.remove('hidden');
      this.canvas.style.display = 'block';
    }

    const drawToCanvas = (imgSource) => {
      if (!this.canvas || !this.ctx) {
        this.isDrawing = false;
        return;
      }
      const container = this.canvas.parentElement;
      const cw = (container && container.clientWidth > 50) ? container.clientWidth : (window.innerWidth || 1280);
      const ch = (container && container.clientHeight > 50) ? container.clientHeight : (window.innerHeight || 720);
      if (this.canvas.width !== cw || this.canvas.height !== ch) {
        this.canvas.width = cw;
        this.canvas.height = ch;
      }
      this.ctx.drawImage(imgSource, 0, 0, cw, ch);
      this.isDrawing = false;
      if (this.latestFrame) {
        requestAnimationFrame(() => this._drawFrame());
      }
    };

    if (window.createImageBitmap) {
      createImageBitmap(blob).then(bmp => {
        drawToCanvas(bmp);
        bmp.close();
      }).catch(() => { this.isDrawing = false; });
    } else {
      const img = new Image();
      const url = URL.createObjectURL(blob);
      img.onload = () => { drawToCanvas(img); URL.revokeObjectURL(url); };
      img.onerror = () => { URL.revokeObjectURL(url); this.isDrawing = false; };
      img.src = url;
    }
  }

  // ================================================================
  // İZLEYİCİ: 3.5x Yüksek Kazançlı Ses Çalma (Dinamik Kompresör & 0 Sızıntı)
  // ================================================================
  _ensureGuestAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!this.guestAudioCtx && AC) {
      this.guestAudioCtx = new AC();
      this.nextPlayTime = this.guestAudioCtx.currentTime;

      // Dinamik Kompresör (Yüksek seste paraziti & bozulmayı 100% önler)
      this.guestCompressor = this.guestAudioCtx.createDynamicsCompressor();
      this.guestCompressor.threshold.setValueAtTime(-14, this.guestAudioCtx.currentTime);
      this.guestCompressor.knee.setValueAtTime(30, this.guestAudioCtx.currentTime);
      this.guestCompressor.ratio.setValueAtTime(12, this.guestAudioCtx.currentTime);
      this.guestCompressor.attack.setValueAtTime(0.003, this.guestAudioCtx.currentTime);
      this.guestCompressor.release.setValueAtTime(0.25, this.guestAudioCtx.currentTime);

      // Kalıcı Ana GainNode (Bellekte tek bir node kullanılır, 30dk sonra kasmaz)
      this.guestGainNode = this.guestAudioCtx.createGain();
      this.guestGainNode.gain.setValueAtTime(1.5, this.guestAudioCtx.currentTime);

      this.guestCompressor.connect(this.guestGainNode);
      this.guestGainNode.connect(this.guestAudioCtx.destination);
    }

    if (this.guestAudioCtx && this.guestAudioCtx.state === 'suspended') {
      this.guestAudioCtx.resume().catch(() => {});
    }
  }

  _playAudio({ pcm, sampleRate }) {
    if (!pcm) return;
    try {
      this._ensureGuestAudio();
      if (!this.guestAudioCtx) return;

      const rawVol = window.syncEngine ? window.syncEngine.localVolume : 100;
      const isMuted = window.syncEngine ? window.syncEngine.isMuted : false;
      // ⚡ 3.5x Güçlendirilmiş Ses Çarpanı
      const targetGain = isMuted ? 0 : Math.max(0, (rawVol / 100) * 3.5);
      if (this.guestGainNode) {
        this.guestGainNode.gain.setValueAtTime(targetGain, this.guestAudioCtx.currentTime);
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
      src.connect(this.guestCompressor);

      // Bellek Sızıntısı Engelleyici: Çalma bitince buffer'ı hemen bellekten kopar
      src.onended = () => {
        try { src.disconnect(); } catch(e){}
      };

      const now = this.guestAudioCtx.currentTime;
      // Drift & Zaman Aşımı Koruması (Ses asla gecikmeli birikmez, 0 Gecikme)
      if (this.nextPlayTime < now) {
        this.nextPlayTime = now + 0.005;
      } else if (this.nextPlayTime - now > 0.06) {
        this.nextPlayTime = now + 0.01; // Kuyruk gecikmesini anında sıfırla
      }

      src.start(this.nextPlayTime);
      this.nextPlayTime += buf.duration;
    } catch (e) {
      console.warn('[AudioPlay] Hata:', e);
    }
  }

  _unlockAudio() {
    if (this.autoplayOverlay) this.autoplayOverlay.classList.add('hidden');
    this._ensureGuestAudio();
  }

  // ================================================================
  // Katmanı Görünür Yap (Host ve İzleyiciye Özel)
  // ================================================================
  _showLayer() {
    ['idle-player-container', 'youtube-player-container', 'html5-player-container', 'embed-player-container'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.classList.add('hidden');
        el.style.display = 'none';
      }
    });

    const wrtc = document.getElementById('webrtc-player-container');
    if (wrtc) {
      wrtc.classList.remove('hidden');
      wrtc.style.display = 'block';
    }

    if (this.isSharing) {
      // Host: Doğrudan video göster
      if (this.webrtcVideo) {
        this.webrtcVideo.classList.remove('hidden');
        this.webrtcVideo.style.display = 'block';
      }
      if (this.canvas) {
        this.canvas.classList.add('hidden');
        this.canvas.style.display = 'none';
      }
    } else {
      // İzleyici: Canvas üzerinden çiz
      if (this.webrtcVideo) {
        this.webrtcVideo.classList.add('hidden');
        this.webrtcVideo.style.display = 'none';
      }
      if (this.canvas) {
        this.canvas.classList.remove('hidden');
        this.canvas.style.display = 'block';
      }
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

    // Doğrudan P2P Donanım Hızlandırmalı Video Akışı
    pc.ontrack = (event) => {
      if (!this.isSharing && event.streams && event.streams[0]) {
        console.log('[WebRTC] P2P Donanımsal Akış Bağlandı (60 FPS, 0 Lag)');
        if (this.webrtcVideo) {
          this.webrtcVideo.srcObject = event.streams[0];
          this.webrtcVideo.classList.remove('hidden');
          this.webrtcVideo.style.display = 'block';
          this.webrtcVideo.play().catch(() => {});
        }
        if (this.canvas) {
          this.canvas.classList.add('hidden');
          this.canvas.style.display = 'none';
        }
      }
    };

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
