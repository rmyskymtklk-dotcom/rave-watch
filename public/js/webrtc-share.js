/**
 * ============================================================================
 * SYNCPARTY WEBRTC DIRECT HARDWARE SCREEN & AUDIO STREAMING ENGINE
 * 60 FPS Donanımsal Akış, Kristal Netliğinde Sekme/Film Sesi & Boşluksuz Tam Ekran
 * ============================================================================
 */

class WebRTCShareEngine {
  constructor(socket) {
    this.socket = socket;
    this.localStream = null;
    this.peerConnections = new Map();
    this.isSharing = false;

    // UI & Oynatıcı Elemanları
    this.webrtcVideo = document.getElementById('webrtc-video');
    this.webrtcCanvas = document.getElementById('webrtc-canvas');
    this.screenShareBtn = document.getElementById('btn-screen-share');
    this.screenShareBtnText = document.getElementById('screen-share-btn-text');
    this.autoplayOverlay = document.getElementById('webrtc-autoplay-overlay');
    this.resumeLiveBtn = document.getElementById('btn-resume-live');

    // Web Audio API Değişkenleri
    this.guestAudioCtx = null;
    this.nextAudioPlayTime = 0;

    // Global Yüksek Performanslı STUN & TURN Sunucu Havuzu
    this.rtcConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' },
        { urls: 'stun:global.stun.twilio.com:3478' },
        { urls: 'stun:stun.services.mozilla.com' },
        {
          urls: [
            'turn:openrelay.metered.ca:80',
            'turn:openrelay.metered.ca:443',
            'turn:openrelay.metered.ca:443?transport=tcp',
            'turn:openrelay.metered.ca:443?transport=udp',
            'turns:openrelay.metered.ca:443',
            'turns:openrelay.metered.ca:443?transport=tcp'
          ],
          username: 'openrelay',
          credential: 'openrelay'
        }
      ],
      iceCandidatePoolSize: 10
    };

    this.init();
  }

  init() {
    if (this.webrtcVideo) {
      this.webrtcVideo.setAttribute('autoplay', '');
      this.webrtcVideo.setAttribute('playsinline', '');
      this.webrtcVideo.setAttribute('webkit-playsinline', '');
      this.webrtcVideo.playsInline = true;
      this.webrtcVideo.muted = false;
      this.webrtcVideo.volume = 1.0;
    }

    // Ses Açma Tetikleyicileri
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

    // Sayfanın herhangi bir yerine dokunulduğunda sesi anında aktif et
    const globalUnlock = () => {
      this.unlockAudio();
    };
    window.addEventListener('click', globalUnlock, { passive: true });
    window.addEventListener('touchstart', globalUnlock, { passive: true });
    window.addEventListener('keydown', globalUnlock, { passive: true });

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

    // WebRTC Sinyalleşme Dinleyicisi
    this.socket.on('webrtc-signal', async ({ senderId, signal, type }) => {
      await this.handleSignal(senderId, signal, type);
    });

    // Yeni kullanıcı odaya girdiğinde akışı bağla
    this.socket.on('user-joined', ({ user }) => {
      if (this.isSharing && this.localStream && user.id !== this.socket.id) {
        console.log('[WebRTC] Yeni katılımcı bağlandı:', user.id);
        this.createPeerConnection(user.id, true);
      }
    });

    // İzleyici talep ettiğinde akışı bağla
    this.socket.on('guest-requested-screenshare', ({ guestId }) => {
      if (this.isSharing && this.localStream) {
        console.log('[WebRTC] İzleyiciden akış talebi:', guestId);
        this.createPeerConnection(guestId, true);
      }
    });

    // Ekran Paylaşımı Durum Güncellemesi
    this.socket.on('screenshare-status-update', ({ active, media }) => {
      if (!this.isSharing) {
        if (active) {
          window.syncEngine.loadMedia(media);
          this.activateScreenLayer();
          window.showToast('📺 Canlı film ve ekran yayını başladı!');
          setTimeout(() => {
            this.socket.emit('request-screenshare-stream');
          }, 150);
        } else {
          window.syncEngine.loadMedia(media);
          window.showToast('📺 Ekran yayını sonlandırıldı.');
          if (this.webrtcVideo) this.webrtcVideo.srcObject = null;
          if (this.autoplayOverlay) this.autoplayOverlay.classList.add('hidden');
        }
      }
    });

    // Canlı PCM Ses Desteği
    this.socket.on('screenshare-audio-raw', (audioData) => {
      if (this.isSharing) return;
      this.playRawAudio(audioData);
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

    if (this.webrtcVideo) {
      this.webrtcVideo.classList.remove('hidden');
      this.webrtcVideo.style.display = 'block';
    }
  }

  unlockAudio() {
    if (this.autoplayOverlay) this.autoplayOverlay.classList.add('hidden');

    if (this.webrtcVideo) {
      this.webrtcVideo.muted = false;
      this.webrtcVideo.volume = (window.syncEngine ? window.syncEngine.volume : 1.0);
      this.webrtcVideo.play().then(() => {
        window.showToast('🔊 Canlı yayın sesi açıldı.');
      }).catch(() => {});
    }

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!this.guestAudioCtx && AudioContext) {
      this.guestAudioCtx = new AudioContext();
    }
    if (this.guestAudioCtx && this.guestAudioCtx.state === 'suspended') {
      this.guestAudioCtx.resume().catch(() => {});
    }
  }

  // -----------------------------------------------------------
  // HOST: EKRAN PAYLAŞIMINI BAŞLAT (60 FPS & Kristal Ses)
  // -----------------------------------------------------------
  async startScreenShare() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: 'never', // 🚀 FARE İMLECİNİ TAMAMEN GİZLE
          frameRate: { ideal: 60, max: 60 },
          width: { ideal: 1920, max: 3840 },
          height: { ideal: 1080, max: 2160 }
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
      this.webrtcVideo.srcObject = stream;
      this.webrtcVideo.muted = true; // Host yankı yapmaması için kendi sesini susturur
      this.webrtcVideo.play().catch(() => {});

      // Ses kanalı kontrolü
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length > 0) {
        this.startAudioStreamingLoop(stream);
      } else {
        window.showToast('ℹ️ Not: Sesin gitmesi için ekran paylaşırken "Sekme Sesini Paylaş" kutusunu işaretleyin.');
      }

      this.screenShareBtn.classList.add('btn-primary');
      this.screenShareBtn.classList.remove('btn-secondary-sm');
      this.screenShareBtnText.textContent = 'Paylaşımı Durdur';

      stream.getVideoTracks()[0].onended = () => {
        this.stopScreenShare();
      };

      this.socket.emit('screenshare-status', { active: true });

      // Odadaki tüm izleyicilere doğrudan donanımsal WebRTC akışını aç
      if (window.roomEngine && window.roomEngine.users) {
        window.roomEngine.users.forEach(user => {
          if (user.id !== this.socket.id) {
            this.createPeerConnection(user.id, true);
          }
        });
      }

      window.showToast('🚀 60 FPS Donanımsal canlı yayın başladı! (Boşluksuz tam ekran)');
    } catch (err) {
      console.warn('Ekran paylaşımı başlatılamadı:', err);
    }
  }

  // -----------------------------------------------------------
  // HOST: CANLI PCM SES YAKALAYICI
  // -----------------------------------------------------------
  startAudioStreamingLoop(stream) {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.hostAudioCtx = new AudioContext();
      const source = this.hostAudioCtx.createMediaStreamSource(stream);

      const processor = this.hostAudioCtx.createScriptProcessor(2048, 1, 1);
      source.connect(processor);

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
        this.guestAudioCtx.resume().catch(() => {});
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

  stopScreenShare() {
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

    if (this.webrtcVideo) this.webrtcVideo.srcObject = null;

    window.syncEngine.loadMedia({
      type: 'idle',
      url: '',
      title: '🎬 Henüz bir video veya film seçilmedi'
    });

    this.socket.emit('screenshare-status', { active: false });
  }

  // -----------------------------------------------------------
  // WEBRTC PEER CONNECTION (Donanımsal 60 FPS Stream & Ses)
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

    // Host tarafı: Akışın video ve ses kanallarını PeerConnection'a ekle
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream);
      });
    }

    // İzleyici tarafı: Gelen CANLI akışı doğrudan <video> etiketine bağla
    pc.ontrack = (event) => {
      console.log('[WebRTC Hardware Stream] Track yakalandı:', event.track.kind);
      const incomingStream = (event.streams && event.streams[0]) ? event.streams[0] : new MediaStream([event.track]);

      this.activateScreenLayer();

      if (this.webrtcVideo) {
        this.webrtcVideo.srcObject = incomingStream;
        this.webrtcVideo.muted = false;
        this.webrtcVideo.volume = (window.syncEngine ? window.syncEngine.volume : 1.0);
        
        this.webrtcVideo.play().then(() => {
          console.log('[WebRTC] Donanımsal 60 FPS akış ve ses başladı!');
          if (this.autoplayOverlay) this.autoplayOverlay.classList.add('hidden');
        }).catch(() => {
          this.webrtcVideo.muted = true;
          this.webrtcVideo.play().catch(() => {});
          if (this.autoplayOverlay) this.autoplayOverlay.classList.remove('hidden');
        });
      }
    };

    // ICE Adaylarını İlet
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

    // Teklif Başlatıcı (Initiator / Host)
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
