/**
 * ============================================================================
 * SYNCPARTY WEBRTC & ZERO-NAT CANVAS SCREEN STREAMING ENGINE
 * %100 Çalışma Garantili Çift Kanallı Canlı Ekran & Film Yayın Motoru
 * (WebRTC P2P + WebSocket Ultra-Hızlı Kare Rölesi - Telefon & PC Uyumlu)
 * ============================================================================
 */

class WebRTCShareEngine {
  constructor(socket) {
    this.socket = socket;
    this.localStream = null;
    this.peerConnections = new Map();
    this.isSharing = false;

    // UI & Video / Canvas Elemanları
    this.webrtcCanvas = document.getElementById('webrtc-canvas');
    this.webrtcVideo = document.getElementById('webrtc-video');
    this.audioPlayer = document.getElementById('webrtc-audio-player');
    this.screenShareBtn = document.getElementById('btn-screen-share');
    this.screenShareBtnText = document.getElementById('screen-share-btn-text');
    this.autoplayOverlay = document.getElementById('webrtc-autoplay-overlay');
    this.resumeLiveBtn = document.getElementById('btn-resume-live');

    this.canvasCtx = this.webrtcCanvas ? this.webrtcCanvas.getContext('2d') : null;

    // Host Arka Plan Yakalama Elemanları
    this.captureVideo = document.createElement('video');
    this.captureVideo.muted = true;
    this.captureVideo.playsInline = true;
    this.captureCanvas = document.createElement('canvas');
    this.frameLoopInterval = null;
    this.audioRecorder = null;
    this.audioQueue = [];
    this.isPlayingAudio = false;

    // WebRTC STUN & TURN
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
    // Mobil & PC Ses Açma Tetikleyicisi
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

    // Video/Canvas alanına tıklayınca ses kilidini aç
    const playerWrapper = document.getElementById('player-wrapper');
    if (playerWrapper) {
      const tryUnmute = () => {
        if (this.audioPlayer && this.audioPlayer.muted && !this.isSharing) {
          this.audioPlayer.muted = false;
          if (this.autoplayOverlay) this.autoplayOverlay.classList.add('hidden');
        }
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
    // CANLI KARE VE SES AKIŞI ALICILARI (İzleyici Tarafı)
    // -----------------------------------------------------------

    // 1. Canlı Ekran Karesi Alındığında (Anında Canvas'a Çiz)
    this.socket.on('screenshare-frame-chunk', async (blobData) => {
      if (this.isSharing) return;

      try {
        const blob = blobData instanceof Blob ? blobData : new Blob([blobData], { type: 'image/jpeg' });
        
        if (window.createImageBitmap) {
          const bitmap = await createImageBitmap(blob);
          this.renderFrameBitmap(bitmap);
        } else {
          const img = new Image();
          img.onload = () => {
            this.renderFrameImage(img);
            URL.revokeObjectURL(img.src);
          };
          img.src = URL.createObjectURL(blob);
        }
      } catch (err) {
        console.warn('Frame render error:', err);
      }
    });

    // 2. Canlı Ses Parçası Alındığında
    this.socket.on('screenshare-audio-chunk', (audioBlob) => {
      if (this.isSharing) return;
      this.playAudioChunk(audioBlob);
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

  playAudioChunk(chunk) {
    try {
      const blob = chunk instanceof Blob ? chunk : new Blob([chunk], { type: 'audio/webm' });
      const audioUrl = URL.createObjectURL(blob);
      const tempAudio = new Audio(audioUrl);
      tempAudio.play().then(() => {
        tempAudio.onended = () => URL.revokeObjectURL(audioUrl);
      }).catch(() => {});
    } catch(e) {}
  }

  unlockAudio() {
    if (this.autoplayOverlay) this.autoplayOverlay.classList.add('hidden');
    window.showToast('🔊 Canlı yayın sesi açıldı.');
    if (this.audioPlayer) {
      this.audioPlayer.muted = false;
      this.audioPlayer.play().catch(() => {});
    }
    if (this.webrtcVideo) {
      this.webrtcVideo.muted = false;
      this.webrtcVideo.play().catch(() => {});
    }
  }

  // -----------------------------------------------------------
  // EKRAN PAYLAŞIMINI BAŞLAT (Host)
  // -----------------------------------------------------------
  async startScreenShare() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: 'always',
          frameRate: { ideal: 30, max: 30 },
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

      // 1. Host'un kendi ekranını yerel Canvas'ta çiz
      this.captureVideo.srcObject = stream;
      await this.captureVideo.play().catch(() => {});

      // 2. ULTRA-HIZLI CANLI KARE VE SES RÖLE DÖNGÜSÜ (Zero-NAT Guaranteed)
      this.startFrameStreamingLoop();
      this.startAudioStreamingLoop(stream);

      this.screenShareBtn.classList.add('btn-primary');
      this.screenShareBtn.classList.remove('btn-secondary-sm');
      this.screenShareBtnText.textContent = 'Paylaşımı Durdur';

      stream.getVideoTracks()[0].onended = () => {
        this.stopScreenShare();
      };

      // Sunucuya bildir
      this.socket.emit('screenshare-status', { active: true });

      // Paralel WebRTC P2P Akışı başlat
      if (window.roomEngine && window.roomEngine.users) {
        window.roomEngine.users.forEach(user => {
          if (user.id !== this.socket.id) {
            this.createPeerConnection(user.id, true);
          }
        });
      }

      window.showToast('🚀 Canlı ekran yayınınız tüm izleyicilere açıldı!');
    } catch (err) {
      console.warn('Ekran paylaşımı başlatılamadı:', err);
    }
  }

  startFrameStreamingLoop() {
    if (this.frameLoopInterval) clearInterval(this.frameLoopInterval);

    const ctx = this.captureCanvas.getContext('2d', { alpha: false });

    // Saniyede ~28 kare pürüzsüz canlı yayın
    this.frameLoopInterval = setInterval(() => {
      if (!this.isSharing || !this.captureVideo.videoWidth) return;

      const srcW = this.captureVideo.videoWidth;
      const srcH = this.captureVideo.videoHeight;
      const targetW = Math.min(1280, srcW);
      const targetH = Math.round(targetW * (srcH / srcW));

      if (this.captureCanvas.width !== targetW || this.captureCanvas.height !== targetH) {
        this.captureCanvas.width = targetW;
        this.captureCanvas.height = targetH;
      }

      ctx.drawImage(this.captureVideo, 0, 0, targetW, targetH);

      // Host'un kendi ekranını da hemen canvas'a çiz
      if (this.webrtcCanvas && this.canvasCtx) {
        if (this.webrtcCanvas.width !== targetW || this.webrtcCanvas.height !== targetH) {
          this.webrtcCanvas.width = targetW;
          this.webrtcCanvas.height = targetH;
        }
        this.canvasCtx.drawImage(this.captureCanvas, 0, 0);
      }

      // Kareyi sıkıştır ve WebSocket üzerinden tüm izleyicilere canlı fırlat
      this.captureCanvas.toBlob((blob) => {
        if (blob && this.isSharing) {
          this.socket.emit('screenshare-frame-chunk', blob);
        }
      }, 'image/jpeg', 0.65);
    }, 35);
  }

  startAudioStreamingLoop(stream) {
    if (stream.getAudioTracks().length === 0) return;

    try {
      const audioStream = new MediaStream(stream.getAudioTracks());
      const options = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? { mimeType: 'audio/webm;codecs=opus' } : undefined;
      this.audioRecorder = new MediaRecorder(audioStream, options);

      this.audioRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0 && this.isSharing) {
          this.socket.emit('screenshare-audio-chunk', e.data);
        }
      };

      this.audioRecorder.start(200); // 200ms ses paketleri
    } catch(e) {
      console.warn('Audio streaming not supported:', e);
    }
  }

  stopScreenShare() {
    if (this.frameLoopInterval) {
      clearInterval(this.frameLoopInterval);
      this.frameLoopInterval = null;
    }

    if (this.audioRecorder && this.audioRecorder.state !== 'inactive') {
      try { this.audioRecorder.stop(); } catch(e) {}
      this.audioRecorder = null;
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
  // WEBRTC PEER CONNECTION VE SİNYALLEŞME
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
      console.log('[WebRTC P2P] Canlı akış track yakalandı:', event.track.kind);
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
