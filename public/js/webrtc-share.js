/**
 * ============================================================================
 * SYNCPARTY WEBRTC SCREEN SHARING ENGINE v4.0
 * Güvenilir Canvas Streaming, PCM Ses, Host/İzleyici Ayrımı
 * ============================================================================
 */

class WebRTCShareEngine {
  constructor(socket) {
    this.socket = socket;
    this.isSharing = false;
    this.localStream = null;
    this.peerConnections = new Map();

    // Canvas (hem host önizleme hem izleyici görüntü)
    this.canvas = document.getElementById('webrtc-canvas');
    this.ctx = this.canvas ? this.canvas.getContext('2d', { alpha: false }) : null;

    // Host: ekrandan video okumak için gizli <video>
    this.captureVideo = document.createElement('video');
    this.captureVideo.muted = true;
    this.captureVideo.playsInline = true;

    // Host: küçültülmüş çıktı canvas'ı
    this.outCanvas = document.createElement('canvas');
    this.outCtx = this.outCanvas.getContext('2d', { alpha: false });

    // Durum
    this.frameTimer = null;
    this.isEncoding = false;
    this.latestFrame = null;
    this.isDrawing = false;

    // Ses (izleyici)
    this.guestAudioCtx = null;
    this.nextPlayTime = 0;

    // Ses (host yakalama)
    this.hostAudioCtx = null;
    this.hostProc = null;

    // UI
    this.shareBtn = document.getElementById('btn-screen-share');
    this.shareBtnText = document.getElementById('screen-share-btn-text');
    this.autoplayOverlay = document.getElementById('webrtc-autoplay-overlay');
    this.resumeBtn = document.getElementById('btn-resume-live');

    // STUN
    this.rtcCfg = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    };

    this._init();
  }

  _init() {
    // Ses kilidi
    const unlock = () => this._unlockAudio();
    if (this.resumeBtn) this.resumeBtn.addEventListener('click', unlock);
    if (this.autoplayOverlay) this.autoplayOverlay.addEventListener('click', unlock);
    document.addEventListener('click', unlock, { once: true, passive: true });

    // Ekran Paylaşım butonu
    if (this.shareBtn) {
      this.shareBtn.addEventListener('click', () => {
        if (this.isSharing) this._stopShare();
        else this._startShare();
      });
    }

    // ─── İZLEYİCİ: Kare al ve çiz ───
    this.socket.on('screenshare-frame', (data) => {
      if (this.isSharing) return;
      this.latestFrame = data instanceof Blob ? data : new Blob([data], { type: 'image/jpeg' });
      if (!this.isDrawing) this._drawFrame();
    });

    // ─── İZLEYİCİ: Ses al ───
    this.socket.on('screenshare-audio', (d) => {
      if (!this.isSharing) this._playAudio(d);
    });

    // ─── İZLEYİCİ: Ekran paylaşımı başladı/bitti ───
    this.socket.on('screenshare-status-update', ({ active, media }) => {
      console.log('[WebRTC] screenshare-status-update alındı, active=', active);
      if (this.isSharing) return;

      if (active) {
        this._showLayer();
        if (window.syncEngine) window.syncEngine.loadMedia(media);
        window.showToast('📺 Canlı ekran yayını bağlandı!');
        setTimeout(() => this.socket.emit('guest-needs-stream'), 400);
      } else {
        if (this.ctx && this.canvas) this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        if (window.syncEngine) window.syncEngine.loadMedia(media);
        window.showToast('📺 Ekran yayını sonlandı.');
      }
    });

    // ─── WebRTC sinyalleşme ───
    this.socket.on('webrtc-signal', async ({ senderId, signal, type }) => {
      await this._handleSignal(senderId, signal, type);
    });

    // ─── Yeni kullanıcı geldiğinde bağlantı kur ───
    this.socket.on('user-joined', ({ user }) => {
      if (this.isSharing && this.localStream && user.id !== this.socket.id) {
        this._createPeer(user.id, true);
      }
    });

    // ─── İzleyici akış istedi ───
    this.socket.on('guest-needs-stream', ({ guestId }) => {
      if (this.isSharing && this.localStream) {
        this._createPeer(guestId, true);
      }
    });
  }

  // ================================================================
  // HOST: Ekran paylaşımını başlat
  // ================================================================
  async _startShare() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'never', frameRate: { ideal: 30, max: 30 } },
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      });

      this.localStream = stream;
      this.isSharing = true;

      // captureVideo'ya akışı bağla
      this.captureVideo.srcObject = stream;
      await this.captureVideo.play().catch(() => {});

      // Canvas'ı göster
      this._showLayer();

      // Kare döngüsünü başlat
      this._startFrameLoop();

      // Ses yakalamayı başlat
      if (stream.getAudioTracks().length > 0) {
        this._startAudioCapture(stream);
      } else {
        setTimeout(() => window.showToast('ℹ️ Ses için "Sekme Sesini Paylaş" seçeneğini işaretleyin.'), 1000);
      }

      // UI güncelle
      if (this.shareBtn) this.shareBtn.classList.add('btn-primary');
      if (this.shareBtnText) this.shareBtnText.textContent = 'Paylaşımı Durdur';

      // Sunucuya bildir
      this.socket.emit('screenshare-status', { active: true });

      // Odadaki mevcut izleyicilere WebRTC akışını bağla
      if (window.roomEngine && window.roomEngine.users) {
        window.roomEngine.users.forEach(u => {
          if (u.id !== this.socket.id) this._createPeer(u.id, true);
        });
      }

      stream.getVideoTracks()[0].onended = () => this._stopShare();
      window.showToast('🚀 Ekran paylaşımı başladı!');
    } catch (err) {
      if (err.name !== 'NotAllowedError') window.showToast('❌ Ekran paylaşımı başlatılamadı.');
    }
  }

  // ================================================================
  // HOST: 30 FPS JPEG kare gönderme döngüsü
  // ================================================================
  _startFrameLoop() {
    if (this.frameTimer) clearInterval(this.frameTimer);
    this.isEncoding = false;

    this.frameTimer = setInterval(() => {
      if (!this.isSharing || !this.captureVideo.videoWidth) return;
      if (this.isEncoding) return; // Önceki kare henüz gönderilmedi, atla

      this.isEncoding = true;

      const vw = this.captureVideo.videoWidth;
      const vh = this.captureVideo.videoHeight;
      // Max 960px genişlik
      const scale = Math.min(1, 960 / vw);
      const tw = Math.round(vw * scale);
      const th = Math.round(vh * scale);

      if (this.outCanvas.width !== tw || this.outCanvas.height !== th) {
        this.outCanvas.width = tw;
        this.outCanvas.height = th;
      }
      this.outCtx.drawImage(this.captureVideo, 0, 0, tw, th);

      // Host kendi canvas'ında önizlesin
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
          this.socket.emit('screenshare-frame', blob);
        }
      }, 'image/jpeg', 0.65);
    }, 33); // ~30 FPS
  }

  // ================================================================
  // HOST: PCM ses yakalama
  // ================================================================
  _startAudioCapture(stream) {
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
        const f = e.inputBuffer.getChannelData(0);
        const i = new Int16Array(f.length);
        for (let k = 0; k < f.length; k++) {
          const s = Math.max(-1, Math.min(1, f[k]));
          i[k] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        this.socket.emit('screenshare-audio', { pcm: i.buffer, sampleRate: this.hostAudioCtx.sampleRate });
      };
      this.hostProc = proc;
    } catch (e) { console.warn('[Audio] Yakalama hatası:', e); }
  }

  // ================================================================
  // HOST: Durdur
  // ================================================================
  _stopShare() {
    if (this.frameTimer) { clearInterval(this.frameTimer); this.frameTimer = null; }
    if (this.hostProc) { try { this.hostProc.disconnect(); } catch(e){} this.hostProc = null; }
    if (this.hostAudioCtx) { try { this.hostAudioCtx.close(); } catch(e){} this.hostAudioCtx = null; }
    if (this.localStream) { this.localStream.getTracks().forEach(t => t.stop()); this.localStream = null; }
    this.peerConnections.forEach(pc => { try { pc.close(); } catch(e){} });
    this.peerConnections.clear();
    this.isSharing = false;
    if (this.shareBtn) this.shareBtn.classList.remove('btn-primary');
    if (this.shareBtnText) this.shareBtnText.textContent = 'Ekran Paylaş';
    if (this.ctx && this.canvas) this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.socket.emit('screenshare-status', { active: false });
    if (window.syncEngine) window.syncEngine.loadMedia({ type: 'idle', url: '', title: '🎬 Video seçilmedi' });
  }

  // ================================================================
  // İZLEYİCİ: Canvas'a kare çiz (latest-frame drop)
  // ================================================================
  _drawFrame() {
    if (!this.latestFrame) { this.isDrawing = false; return; }
    this.isDrawing = true;
    const blob = this.latestFrame;
    this.latestFrame = null;

    if (window.createImageBitmap) {
      createImageBitmap(blob).then(bmp => {
        if (!this.canvas || !this.ctx) { bmp.close(); this.isDrawing = false; return; }
        if (this.canvas.width !== bmp.width || this.canvas.height !== bmp.height) {
          this.canvas.width = bmp.width;
          this.canvas.height = bmp.height;
        }
        this.ctx.drawImage(bmp, 0, 0);
        bmp.close();
        this.isDrawing = false;
        if (this.latestFrame) requestAnimationFrame(() => this._drawFrame());
      }).catch(() => { this.isDrawing = false; });
    } else {
      const img = new Image();
      const url = URL.createObjectURL(blob);
      img.onload = () => {
        if (!this.canvas || !this.ctx) { URL.revokeObjectURL(url); this.isDrawing = false; return; }
        if (this.canvas.width !== img.naturalWidth || this.canvas.height !== img.naturalHeight) {
          this.canvas.width = img.naturalWidth;
          this.canvas.height = img.naturalHeight;
        }
        this.ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        this.isDrawing = false;
        if (this.latestFrame) requestAnimationFrame(() => this._drawFrame());
      };
      img.src = url;
    }
  }

  // ================================================================
  // İZLEYİCİ: PCM ses oynat
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
      if (this.guestAudioCtx.state === 'suspended') { this.guestAudioCtx.resume().catch(()=>{}); return; }

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
    } catch (e) {}
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
  // Katmanı görünür yap
  // ================================================================
  _showLayer() {
    // Önce tüm katmanları gizle
    ['idle-player-container', 'youtube-player-container', 'html5-player-container', 'embed-player-container'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });
    // WebRTC katmanını göster
    const wrtc = document.getElementById('webrtc-player-container');
    if (wrtc) {
      wrtc.classList.remove('hidden');
      wrtc.style.display = 'flex';
    }
    // Canvas'ı görünür yap
    if (this.canvas) {
      this.canvas.classList.remove('hidden');
      this.canvas.style.display = 'block';
    }
  }

  // ================================================================
  // WebRTC Peer (P2P doğrudan akış — NAT geçerse)
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

    pc.ontrack = (evt) => {
      const stream = evt.streams?.[0] || new MediaStream([evt.track]);
      // WebRTC native stream gelince video elemanına bağla (kalitesi canvas'tan daha yüksek)
      const vid = document.getElementById('webrtc-video');
      if (vid && evt.track.kind === 'video') {
        vid.srcObject = stream;
        vid.muted = false;
        vid.classList.remove('hidden');
        vid.style.display = 'block';
        vid.play().catch(() => { vid.muted = true; vid.play().catch(() => {}); });
        // Video gelince canvas'ı gizle (video daha kaliteli)
        if (this.canvas) this.canvas.classList.add('hidden');
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
      }, 100);
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
