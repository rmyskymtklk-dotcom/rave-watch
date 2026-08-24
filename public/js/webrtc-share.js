/**
 * ============================================================================
 * SYNCPARTY WEBRTC SCREEN & TAB AUDIO SHARING ENGINE
 * Güvenli JSON Sinyalleşmeli, 60 FPS Kesintisiz Canlı Ekran & Film Yayını
 * ============================================================================
 */

class WebRTCShareEngine {
  constructor(socket) {
    this.socket = socket;
    this.localStream = null;
    this.remoteStream = null;
    this.peerConnections = new Map(); // peerId -> RTCPeerConnection
    this.isSharing = false;

    this.webrtcVideo = document.getElementById('webrtc-video');
    this.screenShareBtn = document.getElementById('btn-screen-share');
    this.screenShareBtnText = document.getElementById('screen-share-btn-text');
    this.autoplayOverlay = document.getElementById('webrtc-autoplay-overlay');
    this.resumeLiveBtn = document.getElementById('btn-resume-live');

    // Genişletilmiş Yüksek Hızlı STUN & TURN Sunucu Havuzu
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
      ]
    };

    this.init();
  }

  init() {
    if (this.webrtcVideo) {
      this.webrtcVideo.setAttribute('autoplay', '');
      this.webrtcVideo.setAttribute('playsinline', '');
      this.webrtcVideo.setAttribute('webkit-playsinline', '');
      this.webrtcVideo.playsInline = true;
      this.webrtcVideo.muted = true;
      
      this.webrtcVideo.addEventListener('loadedmetadata', () => {
        this.webrtcVideo.play().catch(() => {});
      });
    }

    // Mobil ve Masaüstü Kilit Çözücü Buton
    const handleUnmute = (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      this.unlockAudioAndPlay();
    };

    if (this.resumeLiveBtn) {
      this.resumeLiveBtn.addEventListener('click', handleUnmute);
      this.resumeLiveBtn.addEventListener('touchend', handleUnmute);
    }
    if (this.autoplayOverlay) {
      this.autoplayOverlay.addEventListener('click', handleUnmute);
      this.autoplayOverlay.addEventListener('touchend', handleUnmute);
    }

    // Video alanına dokunulduğunda sesi aç
    const playerWrapper = document.getElementById('player-wrapper');
    if (playerWrapper) {
      const tryUnmute = () => {
        if (this.webrtcVideo && this.webrtcVideo.muted && !this.isSharing) {
          this.webrtcVideo.muted = false;
          window.syncEngine.applyVolume();
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

    // WebRTC Sinyalleşme Dinleyicisi
    this.socket.on('webrtc-signal', async ({ senderId, signal, type }) => {
      await this.handleSignal(senderId, signal, type);
    });

    // Yeni kullanıcı odaya girdiğinde (Host tarafı akış sunar)
    this.socket.on('user-joined', ({ user }) => {
      if (this.isSharing && this.localStream && user.id !== this.socket.id) {
        console.log('[WebRTC] Yeni katılımcı algılandı:', user.id);
        this.createPeerConnection(user.id, true);
      }
    });

    // İzleyici F5 attığında veya sonradan katıldığında gelen talep
    this.socket.on('guest-requested-screenshare', ({ guestId }) => {
      if (this.isSharing && this.localStream) {
        console.log('[WebRTC] İzleyiciden akış talebi geldi:', guestId);
        this.createPeerConnection(guestId, true);
      }
    });

    // Ekran Paylaşımı Durum Güncellemesi (Tüm İzleyiciler İçin)
    this.socket.on('screenshare-status-update', ({ active, media }) => {
      if (!this.isSharing) {
        if (active) {
          window.syncEngine.loadMedia(media);
          window.showToast('📺 Canlı ekran yayını başladı...');
          if (this.autoplayOverlay) this.autoplayOverlay.classList.add('hidden');
          setTimeout(() => {
            this.socket.emit('request-screenshare-stream');
          }, 200);
        } else {
          window.syncEngine.loadMedia(media);
          window.showToast('📺 Ekran yayını sonlandırıldı.');
          if (this.autoplayOverlay) this.autoplayOverlay.classList.add('hidden');
          if (this.webrtcVideo) this.webrtcVideo.srcObject = null;
        }
      }
    });
  }

  unlockAudioAndPlay() {
    if (this.autoplayOverlay) this.autoplayOverlay.classList.add('hidden');
    window.showToast('🔊 Canlı yayın başlatıldı ve ses açıldı.');

    const webrtcContainer = document.getElementById('webrtc-player-container');
    if (webrtcContainer) webrtcContainer.classList.remove('hidden');
    const idleLayer = document.getElementById('idle-player-container');
    if (idleLayer) idleLayer.classList.add('hidden');

    this.socket.emit('request-screenshare-stream');

    if (this.webrtcVideo) {
      this.webrtcVideo.muted = false;
      this.webrtcVideo.play().then(() => {
        window.syncEngine.applyVolume();
      }).catch(() => {
        this.webrtcVideo.muted = true;
        this.webrtcVideo.play().catch(() => {});
      });
    }
  }

  async startScreenShare() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: 'always',
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

      // Oynatıcıyı canlı WebRTC moduna al
      window.syncEngine.loadMedia({
        type: 'webrtc',
        url: 'screenshare-live',
        title: '📺 Canlı Ekran / Film Yayını'
      });

      // Host tarafı: Kendi ekranını göster (Yankı önlemek için sessiz)
      this.webrtcVideo.srcObject = stream;
      this.webrtcVideo.muted = true;
      this.webrtcVideo.play().catch(() => {});

      this.screenShareBtn.classList.add('btn-primary');
      this.screenShareBtn.classList.remove('btn-secondary-sm');
      this.screenShareBtnText.textContent = 'Paylaşımı Durdur';

      // Tarayıcının kendi "Paylaşımı Durdur" butonuna basarsa
      stream.getVideoTracks()[0].onended = () => {
        this.stopScreenShare();
      };

      // Sunucuya ve odaya bildir
      this.socket.emit('screenshare-status', { active: true });

      // Odadaki tüm izleyicilere WebRTC teklifi (Offer) gönder
      if (window.roomEngine && window.roomEngine.users) {
        window.roomEngine.users.forEach(user => {
          if (user.id !== this.socket.id) {
            this.createPeerConnection(user.id, true);
          }
        });
      }

      window.showToast('🚀 Canlı ekran yayınınız başladı!');
    } catch (err) {
      console.warn('Ekran paylaşımı başlatılamadı:', err);
    }
  }

  stopScreenShare() {
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

    window.syncEngine.loadMedia({
      type: 'idle',
      url: '',
      title: '🎬 Henüz bir video veya film seçilmedi'
    });

    this.socket.emit('screenshare-status', { active: false });
  }

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

    // İzleyici tarafı: Gelen CANLI akışı yakala ve ekrana bağla
    pc.ontrack = (event) => {
      console.log('[WebRTC] Canlı yayın track yakalandı:', event.track.kind);

      const incomingStream = (event.streams && event.streams[0]) ? event.streams[0] : new MediaStream([event.track]);

      window.syncEngine.loadMedia({
        type: 'webrtc',
        url: 'screenshare-live',
        title: '📺 Canlı Ekran / Film Yayını'
      });

      const webrtcContainer = document.getElementById('webrtc-player-container');
      if (webrtcContainer) webrtcContainer.classList.remove('hidden');
      const idleLayer = document.getElementById('idle-player-container');
      if (idleLayer) idleLayer.classList.add('hidden');

      this.webrtcVideo.srcObject = incomingStream;
      
      // Tüm tarayıcılarda engelsiz oynatma için sessiz başlat
      this.webrtcVideo.muted = true;
      const playPromise = this.webrtcVideo.play();
      if (playPromise !== undefined) {
        playPromise.then(() => {
          this.webrtcVideo.muted = false;
          window.syncEngine.applyVolume();
          if (this.autoplayOverlay) this.autoplayOverlay.classList.add('hidden');
        }).catch(() => {
          this.webrtcVideo.muted = true;
          this.webrtcVideo.play().catch(() => {});
          if (this.autoplayOverlay) this.autoplayOverlay.classList.remove('hidden');
        });
      }
    };

    // ICE Adaylarını İlet (Güvenli JSON serileştirmesi ile)
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const candidateData = event.candidate.toJSON ? event.candidate.toJSON() : {
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

    // Bağlantı durumunu izle
    pc.oniceconnectionstatechange = () => {
      console.log(`[WebRTC] ICE Durumu (${peerId}):`, pc.iceConnectionState);
      if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
        if (isInitiator && typeof pc.restartIce === 'function') {
          pc.restartIce();
        }
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
            signal: {
              type: pc.localDescription.type || 'offer',
              sdp: pc.localDescription.sdp
            },
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
        const desc = new RTCSessionDescription({
          type: signal.type || 'offer',
          sdp: signal.sdp
        });
        await pc.setRemoteDescription(desc);
        
        // Biriken ICE adaylarını ekle
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
          signal: {
            type: pc.localDescription.type || 'answer',
            sdp: pc.localDescription.sdp
          },
          type: 'answer'
        });
      } else if (type === 'answer') {
        if (pc.signalingState !== 'stable') {
          const desc = new RTCSessionDescription({
            type: signal.type || 'answer',
            sdp: signal.sdp
          });
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
