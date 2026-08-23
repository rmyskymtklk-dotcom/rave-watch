/**
 * ============================================================================
 * SYNCPARTY WEBRTC SCREEN & TAB AUDIO SHARING ENGINE
 * STUN & TURN Destekli, F5 Yenileme ve Sonradan Giriş Garantili WebRTC Motoru
 * ============================================================================
 */

class WebRTCShareEngine {
  constructor(socket) {
    this.socket = socket;
    this.localStream = null;
    this.peerConnections = new Map(); // peerId -> RTCPeerConnection
    this.isSharing = false;

    this.webrtcVideo = document.getElementById('webrtc-video');
    this.screenShareBtn = document.getElementById('btn-screen-share');
    this.screenShareBtnText = document.getElementById('screen-share-btn-text');
    this.autoplayOverlay = document.getElementById('webrtc-autoplay-overlay');
    this.resumeLiveBtn = document.getElementById('btn-resume-live');

    // STUN + ÜCRETSİZ TURN SUNUCULARI (Farklı Ev/Mobil Ağlar Arası NAT Geçiş Garantisi)
    this.rtcConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun.services.mozilla.com' },
        {
          urls: 'turn:openrelay.metered.ca:80',
          username: 'openrelay',
          credential: 'openrelay'
        },
        {
          urls: 'turn:openrelay.metered.ca:443',
          username: 'openrelay',
          credential: 'openrelay'
        },
        {
          urls: 'turn:openrelay.metered.ca:443?transport=tcp',
          username: 'openrelay',
          credential: 'openrelay'
        }
      ],
      iceCandidatePoolSize: 10
    };

    this.init();
  }

  init() {
    // Video element ayarları
    if (this.webrtcVideo) {
      this.webrtcVideo.setAttribute('autoplay', '');
      this.webrtcVideo.setAttribute('playsinline', '');
      this.webrtcVideo.setAttribute('webkit-playsinline', '');
      this.webrtcVideo.playsInline = true;
    }

    // Autoplay Kilit Çözücü Buton
    if (this.resumeLiveBtn) {
      this.resumeLiveBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.unlockAudioAndPlay();
      });
    }

    if (this.autoplayOverlay) {
      this.autoplayOverlay.addEventListener('click', (e) => {
        e.preventDefault();
        this.unlockAudioAndPlay();
      });
    }

    // Ekran Paylaşım Butonu
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

    // Yeni kullanıcı odaya girdiğinde (Host tarafı akış gönderir)
    this.socket.on('user-joined', ({ user }) => {
      if (this.isSharing && this.localStream && user.id !== this.socket.id) {
        console.log('[WebRTC] Yeni katılımcı algılandı, canlı akış teklifi gönderiliyor:', user.id);
        this.createPeerConnection(user.id, true);
      }
    });

    // İzleyici F5 attığında veya sonradan odaya girdiğinde gelen doğrudan talep
    this.socket.on('guest-requested-screenshare', ({ guestId }) => {
      if (this.isSharing && this.localStream) {
        console.log('[WebRTC] İzleyici akış talep etti, teklif oluşturuluyor:', guestId);
        this.createPeerConnection(guestId, true);
      }
    });

    // Ekran Paylaşımı Durum Güncellemesi (Tüm İzleyiciler İçin)
    this.socket.on('screenshare-status-update', ({ active, media }) => {
      if (!this.isSharing) {
        if (active) {
          window.syncEngine.loadMedia(media);
          window.showToast('📺 Ekran yayını aktif, bağlanılıyor...');
          // Host'tan doğrudan akış iste
          setTimeout(() => {
            this.socket.emit('request-screenshare-stream');
          }, 300);
        } else {
          window.syncEngine.loadMedia(media);
          window.showToast('📺 Ekran paylaşımı sonlandırıldı.');
          if (this.autoplayOverlay) this.autoplayOverlay.classList.add('hidden');
        }
      }
    });
  }

  unlockAudioAndPlay() {
    window.showToast('🔄 Canlı yayın akışı başlatılıyor...');

    const webrtcContainer = document.getElementById('webrtc-player-container');
    if (webrtcContainer) webrtcContainer.classList.remove('hidden');
    const idleLayer = document.getElementById('idle-player-container');
    if (idleLayer) idleLayer.classList.add('hidden');

    // Host'tan akışı tekrar talep et
    this.socket.emit('request-screenshare-stream');

    if (this.webrtcVideo) {
      this.webrtcVideo.muted = false;
      this.webrtcVideo.play().then(() => {
        if (this.autoplayOverlay) this.autoplayOverlay.classList.add('hidden');
        window.syncEngine.applyVolume();
      }).catch(err => {
        console.warn('Sessiz başlatılıyor:', err);
        this.webrtcVideo.muted = true;
        this.webrtcVideo.play().then(() => {
          if (this.autoplayOverlay) this.autoplayOverlay.classList.add('hidden');
        }).catch(() => {});
      });
    }
  }

  async startScreenShare() {
    try {
      // Sekme / Ekran + Ses Yakalama (60 FPS & Yüksek Kalite)
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

      // 1. Oynatıcıyı canlı WebRTC moduna al
      window.syncEngine.loadMedia({
        type: 'webrtc',
        url: 'screenshare-live',
        title: '📺 Canlı Ekran / Film Yayını'
      });

      // Host'ta kendi video ekranını göster (Yankı yapmaması için Host'ta sessiz)
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

      window.showToast('🚀 Ekranınız canlı yayına geçti!');
    } catch (err) {
      console.warn('Ekran paylaşımı iptal edildi veya başlatılamadı:', err);
    }
  }

  stopScreenShare() {
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }

    this.peerConnections.forEach(pc => pc.close());
    this.peerConnections.clear();

    this.isSharing = false;
    this.screenShareBtn.classList.remove('btn-primary');
    this.screenShareBtn.classList.add('btn-secondary-sm');
    this.screenShareBtnText.textContent = 'Ekran Paylaş';

    // Bekleme katmanına geri dön
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

    // Host tarafı: Akışın video ve ses kanallarını ekle
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream);
      });
    }

    // İzleyici tarafı: Gelen canlı akışı anında yakala ve ekrana yansıt
    pc.ontrack = (event) => {
      console.log('[WebRTC] Canlı yayın akışı yakalandı!', event);
      let streamToPlay = null;
      if (event.streams && event.streams[0]) {
        streamToPlay = event.streams[0];
      } else {
        if (!this.webrtcVideo.srcObject) {
          this.webrtcVideo.srcObject = new MediaStream();
        }
        this.webrtcVideo.srcObject.addTrack(event.track);
        streamToPlay = this.webrtcVideo.srcObject;
      }

      window.syncEngine.loadMedia({
        type: 'webrtc',
        url: 'screenshare-live',
        title: '📺 Canlı Ekran / Film Yayını'
      });

      const webrtcContainer = document.getElementById('webrtc-player-container');
      if (webrtcContainer) webrtcContainer.classList.remove('hidden');
      const idleLayer = document.getElementById('idle-player-container');
      if (idleLayer) idleLayer.classList.add('hidden');

      this.webrtcVideo.srcObject = streamToPlay;
      
      // Önce sessiz başlat (Tarayıcı güvenlik engeline takılmaz)
      this.webrtcVideo.muted = true;
      const playPromise = this.webrtcVideo.play();
      if (playPromise !== undefined) {
        playPromise.then(() => {
          // Başarılı oynatma: Sesi açmayı dene
          this.webrtcVideo.muted = false;
          window.syncEngine.applyVolume();
          if (this.autoplayOverlay) this.autoplayOverlay.classList.add('hidden');
        }).catch(() => {
          // Tarayıcı güvenlik engeli: Butonu göster
          this.webrtcVideo.muted = true;
          this.webrtcVideo.play().catch(() => {});
          if (this.autoplayOverlay) this.autoplayOverlay.classList.remove('hidden');
        });
      }
    };

    // ICE Adaylarını İlet
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('webrtc-signal', {
          targetId: peerId,
          signal: event.candidate,
          type: 'candidate'
        });
      }
    };

    // Bağlantı durumunu izle
    pc.oniceconnectionstatechange = () => {
      console.log(`[WebRTC] ICE Bağlantı Durumu (${peerId}):`, pc.iceConnectionState);
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
          const offer = await pc.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true
          });
          await pc.setLocalDescription(offer);
          this.socket.emit('webrtc-signal', {
            targetId: peerId,
            signal: pc.localDescription,
            type: 'offer'
          });
        } catch (err) {
          console.error('[WebRTC] Offer oluşturma hatası:', err);
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
        await pc.setRemoteDescription(new RTCSessionDescription(signal));
        
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
          signal: pc.localDescription,
          type: 'answer'
        });
      } else if (type === 'answer') {
        if (pc.signalingState !== 'stable') {
          await pc.setRemoteDescription(new RTCSessionDescription(signal));
          
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
        if (pc.remoteDescription && pc.remoteDescription.type) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(signal));
          } catch(e) {}
        } else {
          if (!pc.iceCandidatesQueue) pc.iceCandidatesQueue = [];
          pc.iceCandidatesQueue.push(signal);
        }
      }
    } catch (err) {
      console.error('[WebRTC] Sinyal işleme hatası:', err);
    }
  }
}
