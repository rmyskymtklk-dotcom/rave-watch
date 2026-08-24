/**
 * ============================================================================
 * SYNCPARTY WEBRTC SCREEN SHARING ENGINE
 * Canvas tabanlı güvenilir akış + PCM ses + host/izleyici ayrımı
 * ============================================================================
 */

class WebRTCShareEngine {
  constructor(socket) {
    this.socket = socket;
    this.localStream = null;
    this.peerConnections = new Map();
    this.isSharing = false;

    // UI Elemanları
    this.webrtcCanvas = document.getElementById('webrtc-canvas');
    this.screenShareBtn = document.getElementById('btn-screen-share');
    this.screenShareBtnText = document.getElementById('screen-share-btn-text');
    this.autoplayOverlay = document.getElementById('webrtc-autoplay-overlay');
    this.resumeLiveBtn = document.getElementById('btn-resume-live');

    // Canvas çizim bağlamı
    this.canvasCtx = this.webrtcCanvas
      ? this.webrtcCanvas.getContext('2d', { alpha: false, desynchronized: true })
      : null;

    // Host: ekrandan video okumak için gizli video elemanı
    this.captureVideo = document.createElement('video');
    this.captureVideo.muted = true;
    this.captureVideo.playsInline = true;

    // Küçültülmüş yakalama canvas'ı
    this.captureCanvas = document.createElement('canvas');
    this.captureCtx = this.captureCanvas.getContext('2d', { alpha: false });

    // Kare döngüsü
    this.frameLoop = null;
    this.isEncoding = false;

    // PCM ses (izleyici)
    this.guestAudioCtx = null;
    this.nextPlayTime = 0;

    // PCM ses (host yakalama)
    this.hostAudioCtx = null;
    this.hostProcessor = null;

    // Latest-frame drop: izleyicide sadece en güncel kare çizilir
    this.latestFrame = null;
    this.isDrawing = false;

    this.rtcConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
      ]
    };

    this.init();
  }

  init() {
    // Ses kilidi açma
    const unlock = () => this.unlockAudio();
    if (this.resumeLiveBtn) {
      this.resumeLiveBtn.addEventListener('click', (e) => { e.preventDefault(); unlock(); });
    }
    if (this.autoplayOverlay) {
      this.autoplayOverlay.addEventListener('click', unlock);
    }
    // Her tıklamada otomatik ses aç
    document.addEventListener('click', unlock, { once: true, passive: true });
    document.addEventListener('keydown', unlock, { once: true, passive: true });

    // Ekran Paylaşım butonu
    if (this.screenShareBtn) {
      this.screenShareBtn.addEventListener('click', () => {
        if (this.isSharing) {
          this.stopScreenShare();
        } else {
          this.startScreenShare();
        }
      });
    }

    // ------- İzleyici: Kare alıcı -------
    this.socket.on('screenshare-frame', (frameData) => {
      if (this.isSharing) return; // Host ise bu verilere bakma
      this.latestFrame = frameData;
      if (!this.isDrawing) this.drawLatestFrame();
    });

    // ------- İzleyici: PCM ses alıcı -------
    this.socket.on('screenshare-audio', (audioData) => {
      if (this.isSharing) return;
      this.playPCMAudio(audioData);
    });

    // ------- Ekran paylaşımı başladı/bitti bilgisi -------
    this.socket.on('screenshare-status-update', ({ active, media }) => {
      if (this.isSharing) return; // Host ise yoksay

      if (active) {
        this.showScreenLayer();
        window.syncEngine.loadMedia(media);
        window.showToast('📺 Canlı ekran yayını başladı!');
        // İzleyici bir süre sonra ekranı talep et
        setTimeout(() => {
          this.socket.emit('guest-needs-stream');
        }, 300);
      } else {
        if (this.webrtcCanvas && this.canvasCtx) {
          this.canvasCtx.clearRect(0, 0, this.webrtcCanvas.width, this.webrtcCanvas.height);
        }
        if (this.autoplayOverlay) this.autoplayOverlay.classList.add('hidden');
        window.syncEngine.loadMedia(media);
        window.showToast('📺 Ekran yayını sonlandı.');
      }
    });

    // ------- WebRTC sinyalleşmesi -------
    this.socket.on('webrtc-signal', async ({ senderId, signal, type }) => {
      await this.handleRTCSignal(senderId, signal, type);
    });

    // ------- Yeni izleyici geldiğinde WebRTC bağlantısı kur -------
    this.socket.on('user-joined', ({ user }) => {
      if (this.isSharing && this.localStream && user.id !== this.socket.id) {
        this.createPeer(user.id, true);
      }
    });

    // ------- İzleyici akış talep ettiğinde -------
    this.socket.on('guest-needs-stream', ({ guestId }) => {
      if (this.isSharing && this.localStream) {
        this.createPeer(guestId, true);
      }
    });
  }

  // ============================================================
  // HOST: Ekran paylaşımını başlat
  // ============================================================
  async startScreenShare() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: 'never',
          frameRate: { ideal: 30, max: 30 }
        },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });

      this.localStream = stream;
      this.isSharing = true;

      // Host kendi önizlemesini canvas'ta göster
      this.captureVideo.srcObject = stream;
      this.captureVideo.play().catch(() => {});

      // Kare gönderme döngüsünü başlat
      this.startFrameLoop();

      // Ses varsa gönder
      if (stream.getAudioTracks().length > 0) {
        this.startAudioCapture(stream);
      } else {
        window.showToast('ℹ️ Ses için paylaşırken "Sekme Sesini Paylaş" seçeneğini işaretleyin.');
      }

      // UI güncelle
      this.screenShareBtn.classList.add('btn-primary');
      this.screenShareBtn.classList.remove('btn-secondary-sm');
      if (this.screenShareBtnText) this.screenShareBtnText.textContent = 'Paylaşımı Durdur';

      // Host kendi canvas'ında da görsün
      this.showScreenLayer();

      // Sunucuya bildir
      this.socket.emit('screenshare-status', { active: true });

      // Odadaki mevcut izleyicilere WebRTC akışı gönder
      if (window.roomEngine && window.roomEngine.users) {
        window.roomEngine.users.forEach(u => {
          if (u.id !== this.socket.id) {
            this.createPeer(u.id, true);
          }
        });
      }

      stream.getVideoTracks()[0].onended = () => this.stopScreenShare();

      window.showToast('🚀 Ekran paylaşımı başladı!');
    } catch (err) {
      console.error('[WebRTC] getDisplayMedia hatası:', err);
      if (err.name !== 'NotAllowedError') {
        window.showToast('❌ Ekran paylaşımı başlatılamadı: ' + err.message);
      }
    }
  }

  // ============================================================
  // HOST: Canvas kare döngüsü (30 FPS, sıkıştırılmış JPEG)
  // ============================================================
  startFrameLoop() {
    if (this.frameLoop) clearInterval(this.frameLoop);
    this.isEncoding = false;

    this.frameLoop = setInterval(() => {
      if (!this.isSharing || !this.captureVideo.videoWidth) return;
      if (this.isEncoding) return; // Önceki kare henüz gönderilmediyse atla

      this.isEncoding = true;

      const vw = this.captureVideo.videoWidth;
      const vh = this.captureVideo.videoHeight;

      // Hedef: en fazla 960px genişlik (yeterince kaliteli, ağı sıkmayan)
      const scale = Math.min(1, 960 / vw);
      const tw = Math.round(vw * scale);
      const th = Math.round(vh * scale);

      if (this.captureCanvas.width !== tw || this.captureCanvas.height !== th) {
        this.captureCanvas.width = tw;
        this.captureCanvas.height = th;
      }
      this.captureCtx.drawImage(this.captureVideo, 0, 0, tw, th);

      // Host canvas'ında da göster
      if (this.webrtcCanvas && this.canvasCtx) {
        if (this.webrtcCanvas.width !== tw || this.webrtcCanvas.height !== th) {
          this.webrtcCanvas.width = tw;
          this.webrtcCanvas.height = th;
        }
        this.canvasCtx.drawImage(this.captureCanvas, 0, 0);
      }

      // JPEG blob olarak gönder
      this.captureCanvas.toBlob((blob) => {
        this.isEncoding = false;
        if (blob && this.isSharing) {
          this.socket.emit('screenshare-frame', blob);
        }
      }, 'image/jpeg', 0.60);

    }, 33); // ~30 FPS
  }

  // ============================================================
  // HOST: PCM ses yakalama
  // ============================================================
  startAudioCapture(stream) {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.hostAudioCtx = new AC();
      const src = this.hostAudioCtx.createMediaStreamSource(stream);
      const proc = this.hostAudioCtx.createScriptProcessor(2048, 1, 1);
      src.connect(proc);
      const dummy = this.hostAudioCtx.createGain();
      dummy.gain.value = 0;
      proc.connect(dummy);
      dummy.connect(this.hostAudioCtx.destination);

      proc.onaudioprocess = (e) => {
        if (!this.isSharing) return;
        const f32 = e.inputBuffer.getChannelData(0);
        const i16 = new Int16Array(f32.length);
        for (let i = 0; i < f32.length; i++) {
          const s = Math.max(-1, Math.min(1, f32[i]));
          i16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        this.socket.emit('screenshare-audio', {
          pcm: i16.buffer,
          sampleRate: this.hostAudioCtx.sampleRate
        });
      };
      this.hostProcessor = proc;
    } catch (e) {
      console.warn('[Audio Capture] Hata:', e);
    }
  }

  // ============================================================
  // HOST: Durdur
  // ============================================================
  stopScreenShare() {
    if (this.frameLoop) { clearInterval(this.frameLoop); this.frameLoop = null; }
    if (this.hostProcessor) { try { this.hostProcessor.disconnect(); } catch(e){} this.hostProcessor = null; }
    if (this.hostAudioCtx) { try { this.hostAudioCtx.close(); } catch(e){} this.hostAudioCtx = null; }
    if (this.localStream) { this.localStream.getTracks().forEach(t => t.stop()); this.localStream = null; }

    this.peerConnections.forEach(pc => { try { pc.close(); } catch(e){} });
    this.peerConnections.clear();

    this.isSharing = false;
    if (this.screenShareBtn) {
      this.screenShareBtn.classList.remove('btn-primary');
      this.screenShareBtn.classList.add('btn-secondary-sm');
    }
    if (this.screenShareBtnText) this.screenShareBtnText.textContent = 'Ekran Paylaş';

    if (this.webrtcCanvas && this.canvasCtx) {
      this.canvasCtx.clearRect(0, 0, this.webrtcCanvas.width, this.webrtcCanvas.height);
    }

    this.socket.emit('screenshare-status', { active: false });
    window.syncEngine.loadMedia({ type: 'idle', url: '', title: '🎬 Henüz bir video seçilmedi' });
  }

  // ============================================================
  // İZLEYİCİ: Gelen kareyi çiz (Latest-frame dropping)
  // ============================================================
  drawLatestFrame() {
    if (!this.latestFrame) {
      this.isDrawing = false;
      return;
    }
    this.isDrawing = true;
    const frame = this.latestFrame;
    this.latestFrame = null;

    const blob = frame instanceof Blob ? frame : new Blob([frame], { type: 'image/jpeg' });

    if (window.createImageBitmap) {
      createImageBitmap(blob).then(bitmap => {
        if (!this.webrtcCanvas || !this.canvasCtx) { bitmap.close(); this.isDrawing = false; return; }
        if (this.webrtcCanvas.width !== bitmap.width || this.webrtcCanvas.height !== bitmap.height) {
          this.webrtcCanvas.width = bitmap.width;
          this.webrtcCanvas.height = bitmap.height;
        }
        this.canvasCtx.drawImage(bitmap, 0, 0);
        bitmap.close();
        this.isDrawing = false;
        if (this.latestFrame) requestAnimationFrame(() => this.drawLatestFrame());
      }).catch(() => { this.isDrawing = false; });
    } else {
      const img = new Image();
      const url = URL.createObjectURL(blob);
      img.onload = () => {
        if (!this.webrtcCanvas || !this.canvasCtx) { URL.revokeObjectURL(url); this.isDrawing = false; return; }
        if (this.webrtcCanvas.width !== img.naturalWidth || this.webrtcCanvas.height !== img.naturalHeight) {
          this.webrtcCanvas.width = img.naturalWidth;
          this.webrtcCanvas.height = img.naturalHeight;
        }
        this.canvasCtx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        this.isDrawing = false;
        if (this.latestFrame) requestAnimationFrame(() => this.drawLatestFrame());
      };
      img.src = url;
    }
  }

  // ============================================================
  // İZLEYİCİ: PCM ses çal
  // ============================================================
  playPCMAudio({ pcm, sampleRate }) {
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
        return;
      }

      const i16 = new Int16Array(pcm);
      const f32 = new Float32Array(i16.length);
      for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768.0;

      const buf = this.guestAudioCtx.createBuffer(1, f32.length, sampleRate || this.guestAudioCtx.sampleRate);
      buf.copyToChannel(f32, 0);

      const src = this.guestAudioCtx.createBufferSource();
      src.buffer = buf;
      const gain = this.guestAudioCtx.createGain();
      gain.gain.value = window.syncEngine ? window.syncEngine.volume : 1;
      src.connect(gain);
      gain.connect(this.guestAudioCtx.destination);

      const now = this.guestAudioCtx.currentTime;
      if (this.nextPlayTime < now) this.nextPlayTime = now + 0.01;
      src.start(this.nextPlayTime);
      this.nextPlayTime += buf.duration;
    } catch (e) {
      console.warn('[Audio Play] Hata:', e);
    }
  }

  unlockAudio() {
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

  // ============================================================
  // Canvas katmanını göster
  // ============================================================
  showScreenLayer() {
    const el = document.getElementById('webrtc-player-container');
    if (el) el.classList.remove('hidden');
    const idle = document.getElementById('idle-player-container');
    if (idle) idle.classList.add('hidden');
    const yt = document.getElementById('youtube-player-container');
    if (yt) yt.classList.add('hidden');
    const h5 = document.getElementById('html5-player-container');
    if (h5) h5.classList.add('hidden');
    const emb = document.getElementById('embed-player-container');
    if (emb) emb.classList.add('hidden');

    if (this.webrtcCanvas) this.webrtcCanvas.classList.remove('hidden');
  }

  // ============================================================
  // WebRTC Peer (WebRTC üzerinden doğrudan akış — ağ izin verirse)
  // ============================================================
  createPeer(peerId, isInitiator) {
    if (this.peerConnections.has(peerId)) {
      try { this.peerConnections.get(peerId).close(); } catch(e){}
      this.peerConnections.delete(peerId);
    }

    const pc = new RTCPeerConnection(this.rtcConfig);
    pc._queue = [];
    this.peerConnections.set(peerId, pc);

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => pc.addTrack(track, this.localStream));
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

    pc.ontrack = (evt) => {
      // WebRTC native stream gelirse video elemanına bağla (canvas yerine)
      const stream = evt.streams?.[0] || new MediaStream([evt.track]);
      const vid = document.getElementById('webrtc-video');
      if (vid) {
        vid.srcObject = stream;
        vid.muted = false;
        vid.classList.remove('hidden');
        vid.play().catch(() => { vid.muted = true; vid.play().catch(() => {}); });
      }
      // Canvas'ı gizle, video'yu göster
      if (this.webrtcCanvas) this.webrtcCanvas.classList.add('hidden');
      this.showScreenLayer();
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

  async handleRTCSignal(senderId, signal, type) {
    let pc = this.peerConnections.get(senderId);
    if (!pc) pc = this.createPeer(senderId, false);

    try {
      if (type === 'offer') {
        await pc.setRemoteDescription(new RTCSessionDescription({ type: signal.type, sdp: signal.sdp }));
        for (const c of pc._queue || []) { try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch(e){} }
        pc._queue = [];
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.socket.emit('webrtc-signal', {
          targetId: senderId,
          signal: { type: answer.type, sdp: answer.sdp },
          type: 'answer'
        });
      } else if (type === 'answer') {
        if (pc.signalingState !== 'stable') {
          await pc.setRemoteDescription(new RTCSessionDescription({ type: signal.type, sdp: signal.sdp }));
          for (const c of pc._queue || []) { try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch(e){} }
          pc._queue = [];
        }
      } else if (type === 'candidate' && signal?.candidate) {
        const cand = { candidate: signal.candidate, sdpMid: signal.sdpMid, sdpMLineIndex: signal.sdpMLineIndex };
        if (pc.remoteDescription?.type) {
          try { await pc.addIceCandidate(new RTCIceCandidate(cand)); } catch(e){}
        } else {
          if (!pc._queue) pc._queue = [];
          pc._queue.push(cand);
        }
      }
    } catch (e) {
      console.error('[WebRTC] Signal hatası:', type, e);
    }
  }
}
