/**
 * ============================================================================
 * SYNCPARTY WEBRTC SCREEN & TAB AUDIO SHARING ENGINE
 * H.264/VP8 Mobil & iOS Safari Uyumlu, Kesintisiz Canlı Yayın Motoru
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

    // STUN & Global TURN Sunucu Havuzu (Mobil 4G/5G ve Farklı Ağlar Arası Kesintisiz Geçiş)
    this.rtcConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' },
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
      iceCandidatePoolSize: 10,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require'
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

    // Mobil ve Masaüstü Kilit Çözücü
    const handleUnmuteClick = (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      this.unlockAudioAndPlay();
    };

    if (this.resumeLiveBtn) {
      this.resumeLiveBtn.addEventListener('click', handleUnmuteClick);
      this.resumeLiveBtn.addEventListener('touchend', handleUnmuteClick);
    }
    if (this.autoplayOverlay) {
      this.autoplayOverlay.addEventListener('click', handleUnmuteClick);
      this.autoplayOverlay.addEventListener('touchend', handleUnmuteClick);
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

    // Yeni kullanıcı odaya girdiğinde (Host tarafı canlı akışı anında iletir)
    this.socket.on('user-joined', ({ user }) => {
      if (this.isSharing && this.localStream && user.id !== this.socket.id) {
        console.log('[WebRTC] Yeni kullanıcı katıldı, canlı akış teklifi gönderiliyor:', user.id);
        this.createPeerConnection(user.id, true);
      }
    });

    // İzleyici F5 attığında veya mobilden odaya girdiğinde gelen talep
    this.socket.on('guest-requested-screenshare', ({ guestId }) => {
      if (this.isSharing && this.localStream) {
        console.log('[WebRTC] İzleyiciden akış talebi alındı, yeniden bağlanılıyor:', guestId);
        this.createPeerConnection(guestId, true);
      }
    });

    // Ekran Paylaşımı Durum Güncellemesi (Tüm İzleyiciler İçin)
    this.socket.on('screenshare-status-update', ({ active, media }) => {
      if (!this.isSharing) {
        if (active) {
          window.syncEngine.loadMedia(media);
          window.showToast('📺 Canlı ekran yayını başlatıldı...');
          if (this.autoplayOverlay) this.autoplayOverlay.classList.add('hidden');
          setTimeout(() => {
            this.socket.emit('request-screenshare-stream');
          }, 200);
        } else {
          window.syncEngine.loadMedia(media);
          window.showToast('📺 Ekran yayını sonlandırıldı.');
          if (this.autoplayOverlay) this.autoplayOverlay.classList.add('hidden');
          if (this.remoteStream) {
            this.remoteStream.getTracks().forEach(t => t.stop());
            this.remoteStream = null;
          }
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
      console.warn('Ekran paylaşımı iptal edildi veya başlatılamadı:', err);
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

    // Bekleme katmanına geri dön
    window.syncEngine.loadMedia({
      type: 'idle',
      url: '',
      title: '🎬 Henüz bir video veya film seçilmedi'
    });

    this.socket.emit('screenshare-status', { active: false });
  }

  // Mobil & Safari Uyumlu H264/VP8 Codec Sıralayıcısı
  preferMobileCodecs(sdp) {
    const lines = sdp.split('\r\n');
    const mLineIndex = lines.findIndex(l => l.startsWith('m=video'));
    if (mLineIndex === -1) return sdp;

    const mParts = lines[mLineIndex].split(' ');
    const header = mParts.slice(0, 3);
    const payloads = mParts.slice(3);

    const h264 = [];
    const vp8 = [];
    const others = [];

    for (const pt of payloads) {
      const mapLine = lines.find(l => l.startsWith(`a=rtpmap:${pt} `));
      if (mapLine) {
        const lower = mapLine.toLowerCase();
        if (lower.includes('h264')) h264.push(pt);
        else if (lower.includes('vp8')) vp8.push(pt);
        else others.push(pt);
      } else {
        others.push(pt);
      }
    }

    const reordered = [...h264, ...vp8, ...others];
    lines[mLineIndex] = `${header.join(' ')} ${reordered.join(' ')}`;
    return lines.join('\r\n');
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

    // İzleyici tarafı: Gelen CANLI video ve ses kanallarını ekrana yansıt
    pc.ontrack = (event) => {
      console.log('[WebRTC] Canlı akış track yakalandı:', event.track.kind);

      if (!this.remoteStream) {
        this.remoteStream = new MediaStream();
      }

      if (event.streams && event.streams[0]) {
        event.streams[0].getTracks().forEach(track => {
          if (!this.remoteStream.getTracks().some(t => t.id === track.id)) {
            this.remoteStream.addTrack(track);
          }
        });
      } else if (event.track) {
        if (!this.remoteStream.getTracks().some(t => t.id === event.track.id)) {
          this.remoteStream.addTrack(event.track);
        }
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

      this.webrtcVideo.srcObject = this.remoteStream;
      
      // Video ekranını başlat (Sessiz başlatma tüm mobil tarayıcılarda engelsiz açar)
      this.webrtcVideo.muted = true;
      this.webrtcVideo.play().then(() => {
        // Otomatik ses açmayı dene
        this.webrtcVideo.muted = false;
        window.syncEngine.applyVolume();
        if (this.autoplayOverlay) this.autoplayOverlay.classList.add('hidden');
      }).catch(() => {
        this.webrtcVideo.muted = true;
        this.webrtcVideo.play().catch(() => {});
        if (this.autoplayOverlay) this.autoplayOverlay.classList.remove('hidden');
      });
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
          const mobileSdp = this.preferMobileCodecs(offer.sdp);
          await pc.setLocalDescription(new RTCSessionDescription({ type: 'offer', sdp: mobileSdp }));
          
          this.socket.emit('webrtc-signal', {
            targetId: peerId,
            signal: pc.localDescription,
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
        const mobileAnswerSdp = this.preferMobileCodecs(answer.sdp);
        await pc.setLocalDescription(new RTCSessionDescription({ type: 'answer', sdp: mobileAnswerSdp }));
        
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
      console.error('[WebRTC] Sinyal hatası:', err);
    }
  }
}
