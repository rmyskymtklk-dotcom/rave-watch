/**
 * ============================================================================
 * SYNCPARTY WEBRTC & ZERO-NAT CANVAS SCREEN STREAMING ENGINE
 * 1.0x Akıcı Hız, Canlı PCM Web Audio, Gizli Fare İmleci & Boşluksuz Tam Ekran
 * ============================================================================
 */

class WebRTCShareEngine {
  constructor(socket) {
    this.socket = socket;
    this.localStream = null;
    this.peerConnections = new Map();
    this.isSharing = false;

    // UI & Oynatıcı Elemanları
    this.webrtcCanvas = document.getElementById('webrtc-canvas');
    this.webrtcVideo = document.getElementById('webrtc-video');
    this.screenShareBtn = document.getElementById('btn-screen-share');
    this.screenShareBtnText = document.getElementById('screen-share-btn-text');
    this.autoplayOverlay = document.getElementById('webrtc-autoplay-overlay');
    this.resumeLiveBtn = document.getElementById('btn-resume-live');

    this.canvasCtx = this.webrtcCanvas ? this.webrtcCanvas.getContext('2d', { alpha: false, desynchronized: true }) : null;

    // Host Arka Plan Kare & Ses İşleyicileri
    this.captureVideo = document.createElement('video');
    this.captureVideo.muted = true;
    this.captureVideo.playsInline = true;
    this.captureCanvas = document.createElement('canvas');
    this.frameLoopInterval = null;
    this.isEncodingFrame = false;

    // Web Audio API (PCM Raw Audio Stream)
    this.hostAudioCtx = null;
    this.hostAudioProcessor = null;
    this.guestAudioCtx = null;
    this.nextAudioPlayTime = 0;

    // İzleyici Kare Çizim Kontrolü (Sıfır Gecikme / Real-Time Drop)
    this.isRenderingFrame = false;
    this.latestFrameBlob = null;

    // STUN Yapılandırması
    this.rtcConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' }
      ]
    };

    this.init();
  }

  init() {
    // Ses Açma Tetikleyicisi
    const handleUnmute = (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      this.unlockAudio();
    };

    if (this.resumeLiveBtn) {
      this.resumeLiveBtn.addEventListener('click', handleUnmute);
      this.resumeLiveBtn.addEventListener('touchend', handleUnmute);
    }
    if (this.autoplayOverlay) {
      this.autoplayOverlay.addEventListener('click', handleUnmute);
      this.autoplayOverlay.addEventListener('touchend', handleUnmute);
    }

    // Video sahnesine dokunulduğunda sesi aç
    const playerWrapper = document.getElementById('player-wrapper');
    if (playerWrapper) {
      const tryUnmute = () => {
        this.unlockAudio();
      };
      playerWrapper.addEventListener('click', tryUnmute);
      playerWrapper.addEventListener('touchend', tryUnmute);
    }

    // Ekran Paylaşım Butonu (Host)
    if (this.screenShareBtn) {
      this.screenShareBtn.addEventListener('click', () => {
        if (this.isSharing) {
          this.stopScreenShare();
        } else {
          this.startScreenShare();
        }
      });
    }

    // -----------------------------------------------------------
    // İZLEYİCİ: 1.0X GERÇEK ZAMANLI KARE OYNATICI (Sıfır Yavaşlama)
    // -----------------------------------------------------------
    this.socket.on('screenshare-frame-chunk', (blobData) => {
      if (this.isSharing) return;

      this.latestFrameBlob = blobData instanceof Blob ? blobData : new Blob([blobData], { type: 'image/jpeg' });

      if (!this.isRenderingFrame) {
        this.drawNextFrame();
      }
    });

    // -----------------------------------------------------------
    // İZLEYİCİ: CANLI PCM SES ALICISI (Web Audio API)
    // -----------------------------------------------------------
    this.socket.on('screenshare-audio-raw', (audioData) => {
      if (this.isSharing) return;
      this.playRawAudio(audioData);
    });

    // WebRTC Sinyalleşmesi
    this.socket.on('webrtc-signal', async ({ senderId, signal, type }) => {
      await this.handleSignal(senderId, signal, type);
    });

    this.socket.on('user-joined', ({ user }) => {
      if (this.isSharing && this.localStream && user.id !== this.socket.id) {
        this.createPeerConnection(user.id, true);
      }
    });

    this.socket.on('guest-requested-screenshare', ({ guestId }) => {
      if (this.isSharing && this.localStream) {
        this.createPeerConnection(guestId, true);
      }
    });

    this.socket.on('screenshare-status-update', ({ active, media }) => {
      if (!this.isSharing) {
        if (active) {
          window.syncEngine.loadMedia(media);
          this.activateScreenLayer();
          window.showToast('📺 Canlı ekran yayını bağlandı!');
          this.socket.emit('request-screenshare-stream');
        } else {
          window.syncEngine.loadMedia(media);
          window.showToast('📺 Ekran yayını sonlandırıldı.');
          this.clearCanvas();
          if (this.autoplayOverlay) this.autoplayOverlay.classList.add('hidden');
        }
      }
    });
  }

  drawNextFrame() {
    if (!this.latestFrameBlob) {
      this.isRenderingFrame = false;
      return;
    }

    this.isRenderingFrame = true;
    const blob = this.latestFrameBlob;
    this.latestFrameBlob = null; // Buffer birikmesini engelle

    if (window.createImageBitmap) {
      createImageBitmap(blob).then((bitmap) => {
        this.renderFrameBitmap(bitmap);
        this.isRenderingFrame = false;
        if (this.latestFrameBlob) {
          requestAnimationFrame(() => this.drawNextFrame());
        }
      }).catch(() => {
        this.isRenderingFrame = false;
      });
    } else {
      const img = new Image();
      img.onload = () => {
        this.renderFrameImage(img);
        URL.revokeObjectURL(img.src);
        this.isRenderingFrame = false;
        if (this.latestFrameBlob) {
          requestAnimationFrame(() => this.drawNextFrame());
        }
      };
      img.src = URL.createObjectURL(blob);
    }
  }

  activateScreenLayer() {
    const webrtcContainer = document.getElementById('webrtc-player-container');
    if (webrtcContainer) webrtcContainer.classList.remove('hidden');
    const idleLayer = document.getElementById('idle-player-container');
    if (idleLayer) idleLayer.classList.add('hidden');
    const ytLayer = document.getElementById('youtube-player-container');
    if (ytLayer) ytLayer.classList.add('hidden');
    const html5Layer = document.getElementById('html5-player-container');
    if (html5Layer) html5Layer.classList.add('hidden');
  }

  renderFrameBitmap(bitmap) {
    this.activateScreenLayer();
    if (!this.webrtcCanvas || !this.canvasCtx) return;

    if (this.webrtcCanvas.width !== bitmap.width || this.webrtcCanvas.height !== bitmap.height) {
      this.webrtcCanvas.width = bitmap.width;
      this.webrtcCanvas.height = bitmap.height;
    }
    this.canvasCtx.drawImage(bitmap, 0, 0);
    bitmap.close();
  }

  renderFrameImage(img) {
    this.activateScreenLayer();
    if (!this.webrtcCanvas || !this.canvasCtx) return;

    if (this.webrtcCanvas.width !== img.width || this.webrtcCanvas.height !== img.height) {
      this.webrtcCanvas.width = img.width;
      this.webrtcCanvas.height = img.height;
    }
    this.canvasCtx.drawImage(img, 0, 0);
  }

  clearCanvas() {
    if (this.webrtcCanvas && this.canvasCtx) {
      this.canvasCtx.clearRect(0, 0, this.webrtcCanvas.width, this.webrtcCanvas.height);
    }
  }

  // -----------------------------------------------------------
  // İZLEYİCİ: CANLI SESİ KESİNTİSİZ OYNAT (Web Audio Timeline Queue)
  // -----------------------------------------------------------
  playRawAudio({ pcm, sampleRate }) {
    if (!pcm) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!this.guestAudioCtx && AudioContext) {
        this.guestAudioCtx = new AudioContext();
        this.nextAudioPlayTime = this.guestAudioCtx.currentTime;
      }
      if (!this.guestAudioCtx) return;

      if (this.guestAudioCtx.state === 'suspended') {
        if (this.autoplayOverlay) this.autoplayOverlay.classList.remove('hidden');
        return;
      } else {
        if (this.autoplayOverlay) this.autoplayOverlay.classList.add('hidden');
      }

      const int16Array = new Int16Array(pcm);
      const float32Array = new Float32Array(int16Array.length);
      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / 32768.0;
      }

      const targetRate = sampleRate || this.guestAudioCtx.sampleRate;
      const audioBuffer = this.guestAudioCtx.createBuffer(1, float32Array.length, targetRate);
      audioBuffer.copyToChannel(float32Array, 0);

      const source = this.guestAudioCtx.createBufferSource();
      source.buffer = audioBuffer;

      const gainNode = this.guestAudioCtx.createGain();
      const vol = window.syncEngine ? window.syncEngine.volume : 1;
      gainNode.gain.value = vol;

      source.connect(gainNode);
      gainNode.connect(this.guestAudioCtx.destination);

      const now = this.guestAudioCtx.currentTime;
      if (this.nextAudioPlayTime < now) {
        this.nextAudioPlayTime = now + 0.015;
      }

      source.start(this.nextAudioPlayTime);
      this.nextAudioPlayTime += audioBuffer.duration;
    } catch (e) {
      console.warn('Audio playback error:', e);
    }
  }

  unlockAudio() {
    if (this.autoplayOverlay) this.autoplayOverlay.classList.add('hidden');
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!this.guestAudioCtx && AudioContext) {
      this.guestAudioCtx = new AudioContext();
      this.nextAudioPlayTime = this.guestAudioCtx.currentTime;
    }
    if (this.guestAudioCtx && this.guestAudioCtx.state === 'suspended') {
      this.guestAudioCtx.resume().then(() => {
        window.showToast('🔊 Canlı yayın sesi açıldı.');
      });
    }
  }

  // -----------------------------------------------------------
  // HOST: EKRAN PAYLAŞIMINI BAŞLAT (Fare İmleci Gizli & 24 FPS HD)
  // -----------------------------------------------------------
  async startScreenShare() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: 'never', // 🚀 FARE İMLECİNİ TAMAMEN GİZLE
          frameRate: { ideal: 24, max: 24 },
          width: { ideal: 1920, max: 1920 },
          height: { ideal: 1080, max: 1080 }
        },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });

      this.localStream = stream;
      this.isSharing = true;

      // Oynatıcıyı canlı moda al
      window.syncEngine.loadMedia({
        type: 'webrtc',
        url: 'screenshare-live',
        title: '📺 Canlı Ekran / Film Yayını'
      });
      this.activateScreenLayer();

      // Host önizlemesi
      this.captureVideo.srcObject = stream;
      await this.captureVideo.play().catch(() => {});

      // 1. Canlı Video Karesi Akış Döngüsü (1.0x Akıcı Gerçek Zamanlı Hız)
      this.startFrameStreamingLoop();

      // 2. Canlı PCM Ses Akışı Döngüsü (Sekme & Sistem Sesi)
      this.startAudioStreamingLoop(stream);

      this.screenShareBtn.classList.add('btn-primary');
      this.screenShareBtn.classList.remove('btn-secondary-sm');
      this.screenShareBtnText.textContent = 'Paylaşımı Durdur';

      stream.getVideoTracks()[0].onended = () => {
        this.stopScreenShare();
      };

      this.socket.emit('screenshare-status', { active: true });

      // Paralel WebRTC P2P Akışı başlat
      if (window.roomEngine && window.roomEngine.users) {
        window.roomEngine.users.forEach(user => {
          if (user.id !== this.socket.id) {
            this.createPeerConnection(user.id, true);
          }
        });
      }

      window.showToast('🚀 Canlı yayın başladı! (Sekme sesi & film akışı aktif)');
    } catch (err) {
      console.warn('Ekran paylaşımı başlatılamadı:', err);
    }
  }

  // -----------------------------------------------------------
  // HOST: CANLI KARE AKIŞI (Ultra-Hafif 720p HD & Sıfır Tıkanma)
  // -----------------------------------------------------------
  startFrameStreamingLoop() {
    if (this.frameLoopInterval) clearInterval(this.frameLoopInterval);

    const ctx = this.captureCanvas.getContext('2d', { alpha: false });
    this.isEncodingFrame = false;

    this.frameLoopInterval = setInterval(() => {
      if (!this.isSharing || !this.captureVideo.videoWidth) return;
      if (this.isEncodingFrame) return; // Önceki kare gönderilmediyse bekle (Ağ tıkanmasını önler)

      this.isEncodingFrame = true;

      const srcW = this.captureVideo.videoWidth;
      const srcH = this.captureVideo.videoHeight;
      const targetW = Math.min(1280, srcW);
      const targetH = Math.round(targetW * (srcH / srcW));

      if (this.captureCanvas.width !== targetW || this.captureCanvas.height !== targetH) {
        this.captureCanvas.width = targetW;
        this.captureCanvas.height = targetH;
      }

      ctx.drawImage(this.captureVideo, 0, 0, targetW, targetH);

      // Host tarafında da yerel çiz
      if (this.webrtcCanvas && this.canvasCtx) {
        if (this.webrtcCanvas.width !== targetW || this.webrtcCanvas.height !== targetH) {
          this.webrtcCanvas.width = targetW;
          this.webrtcCanvas.height = targetH;
        }
        this.canvasCtx.drawImage(this.captureCanvas, 0, 0);
      }

      // Optimize JPEG kalitesi (Yalnızca ~15 KB / kare -> Sıfır Donma, Akıcı 24 FPS)
      this.captureCanvas.toBlob((blob) => {
        this.isEncodingFrame = false;
        if (blob && this.isSharing) {
          this.socket.emit('screenshare-frame-chunk', blob);
        }
      }, 'image/jpeg', 0.55);
    }, 41); // 24 FPS standart sinema kare hızı
  }

  // -----------------------------------------------------------
  // HOST: CANLI PCM SES YAKALAYICI (Sekme / Film Sesi)
  // -----------------------------------------------------------
  startAudioStreamingLoop(stream) {
    if (stream.getAudioTracks().length === 0) {
      console.log('[WebRTC] Sekme sesi bulunamadı (Ekran paylaşırken "Sekme Sesini Paylaş" kutusunu işaretleyin)');
      return;
    }

    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.hostAudioCtx = new AudioContext();
      const source = this.hostAudioCtx.createMediaStreamSource(stream);

      // 4096 örnek buffer boyutu (~90ms kristal netliğinde PCM paketleri)
      const processor = this.hostAudioCtx.createScriptProcessor(4096, 1, 1);
      source.connect(processor);

      // Host'un kendi hoparlöründe çift yankı yapmaması için sıfır gain
      const gainNode = this.hostAudioCtx.createGain();
      gainNode.gain.value = 0;
      processor.connect(gainNode);
      gainNode.connect(this.hostAudioCtx.destination);

      processor.onaudioprocess = (e) => {
        if (!this.isSharing) return;
        const input = e.inputBuffer.getChannelData(0);
        const pcm16 = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
          const s = Math.max(-1, Math.min(1, input[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        this.socket.emit('screenshare-audio-raw', {
          pcm: pcm16.buffer,
          sampleRate: this.hostAudioCtx.sampleRate
        });
      };

      this.hostAudioProcessor = processor;
    } catch (err) {
      console.warn('[AudioCapture] Web Audio hatası:', err);
    }
  }

  stopScreenShare() {
    if (this.frameLoopInterval) {
      clearInterval(this.frameLoopInterval);
      this.frameLoopInterval = null;
    }

    if (this.hostAudioProcessor) {
      try { this.hostAudioProcessor.disconnect(); } catch (e) {}
      this.hostAudioProcessor = null;
    }
    if (this.hostAudioCtx) {
      try { this.hostAudioCtx.close(); } catch (e) {}
      this.hostAudioCtx = null;
    }

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }

    this.peerConnections.forEach(pc => {
      try { pc.close(); } catch(e) {}
    });
    this.peerConnections.clear();

    this.isSharing = false;
    this.screenShareBtn.classList.remove('btn-primary');
    this.screenShareBtn.classList.add('btn-secondary-sm');
    this.screenShareBtnText.textContent = 'Ekran Paylaş';

    this.clearCanvas();

    window.syncEngine.loadMedia({
      type: 'idle',
      url: '',
      title: '🎬 Henüz bir video veya film seçilmedi'
    });

    this.socket.emit('screenshare-status', { active: false });
  }

  // -----------------------------------------------------------
  // WEBRTC PEER CONNECTION
  // -----------------------------------------------------------
  createPeerConnection(peerId, isInitiator) {
    if (this.peerConnections.has(peerId)) {
      try {
        const oldPc = this.peerConnections.get(peerId);
        oldPc.close();
      } catch(e) {}
      this.peerConnections.delete(peerId);
    }

    const pc = new RTCPeerConnection(this.rtcConfig);
    pc.iceCandidatesQueue = [];
    this.peerConnections.set(peerId, pc);

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream);
      });
    }

    pc.ontrack = (event) => {
      const incomingStream = (event.streams && event.streams[0]) ? event.streams[0] : new MediaStream([event.track]);
      this.activateScreenLayer();

      if (this.webrtcVideo) {
        this.webrtcVideo.srcObject = incomingStream;
        this.webrtcVideo.muted = true;
        this.webrtcVideo.play().catch(() => {});
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const candidateData = {
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid,
          sdpMLineIndex: event.candidate.sdpMLineIndex
        };
        this.socket.emit('webrtc-signal', {
          targetId: peerId,
          signal: candidateData,
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
        } catch (err) {
          console.error('[WebRTC] Offer hatası:', err);
        }
      }, 50);
    }

    return pc;
  }

  async handleSignal(senderId, signal, type) {
    let pc = this.peerConnections.get(senderId);
    if (!pc) {
      pc = this.createPeerConnection(senderId, false);
    }

    try {
      if (type === 'offer') {
        const desc = new RTCSessionDescription({ type: signal.type, sdp: signal.sdp });
        await pc.setRemoteDescription(desc);
        
        if (pc.iceCandidatesQueue && pc.iceCandidatesQueue.length > 0) {
          for (const cand of pc.iceCandidatesQueue) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(cand));
            } catch(e) {}
          }
          pc.iceCandidatesQueue = [];
        }

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.socket.emit('webrtc-signal', {
          targetId: senderId,
          signal: { type: answer.type, sdp: answer.sdp },
          type: 'answer'
        });
      } else if (type === 'answer') {
        if (pc.signalingState !== 'stable') {
          const desc = new RTCSessionDescription({ type: signal.type, sdp: signal.sdp });
          await pc.setRemoteDescription(desc);
          
          if (pc.iceCandidatesQueue && pc.iceCandidatesQueue.length > 0) {
            for (const cand of pc.iceCandidatesQueue) {
              try {
                await pc.addIceCandidate(new RTCIceCandidate(cand));
              } catch(e) {}
            }
            pc.iceCandidatesQueue = [];
          }
        }
      } else if (type === 'candidate') {
        if (signal && signal.candidate) {
          const cand = new RTCIceCandidate(signal);
          if (pc.remoteDescription && pc.remoteDescription.type) {
            try {
              await pc.addIceCandidate(cand);
            } catch(e) {}
          } else {
            if (!pc.iceCandidatesQueue) pc.iceCandidatesQueue = [];
            pc.iceCandidatesQueue.push(signal);
          }
        }
      }
    } catch (err) {
      console.error('[WebRTC] Sinyal hatası:', err);
    }
  }
}
