/**
 * ============================================================================
 * SYNCPARTY WEBRTC SCREEN & TAB AUDIO SHARING ENGINE
 * Kesintisiz 60 FPS Canlı Ekran ve Sekme Yayını (ICE Queue & Autoplay Korumalı)
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

    // Global Yüksek Erişilebilirlikli STUN Sunucuları (Farklı Ağlar Arası Kesintisiz Bağlantı)
    this.rtcConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        { urls: 'stun:stun.services.mozilla.com' },
        { urls: 'stun:global.stun.twilio.com:3478' }
      ]
    };

    this.init();
  }

  init() {
    this.screenShareBtn.addEventListener('click', () => {
      if (this.isSharing) {
        this.stopScreenShare();
      } else {
        this.startScreenShare();
      }
    });

    // WebRTC Sinyalleşme Dinleyicisi
    this.socket.on('webrtc-signal', async ({ senderId, signal, type }) => {
      await this.handleSignal(senderId, signal, type);
    });

    // Yeni kullanıcı katıldığında eğer Host ekran paylaşıyorsa yeni kişiye de teklif yolla
    this.socket.on('user-joined', ({ user }) => {
      if (this.isSharing && user.id !== this.socket.id) {
        this.createPeerConnection(user.id, true);
      }
    });

    // Ekran Paylaşımı Durum Güncellemesi (Tüm İzleyiciler İçin)
    this.socket.on('screenshare-status-update', ({ active, media }) => {
      if (!this.isSharing) {
        if (active) {
          window.syncEngine.loadMedia(media);
          window.showToast('📺 Oda sahibi ekran yayını başlattı!');
        } else {
          window.syncEngine.loadMedia(media);
          window.showToast('📺 Ekran paylaşımı sonlandırıldı.');
        }
      }
    });
  }

  async startScreenShare() {
    try {
      // Sekme / Ekran + Ses Yakalama (60 FPS & Tam Çözünürlük)
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

      // 1. YouTube ve diğer sesleri anında durdur, ekran katmanını aç
      window.syncEngine.loadMedia({
        type: 'webrtc',
        url: 'screenshare-live',
        title: '📺 Canlı Ekran Yayını'
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
      window.roomEngine.users.forEach(user => {
        if (user.id !== this.socket.id) {
          this.createPeerConnection(user.id, true);
        }
      });

      window.showToast('🚀 Ekranınız hem sizde hem izleyicilerde canlı açıldı!');
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

    // Standart YouTube katmanına geri dön
    window.syncEngine.loadMedia({
      type: 'youtube',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      title: 'YouTube'
    });

    this.socket.emit('screenshare-status', { active: false });
  }

  createPeerConnection(peerId, isInitiator) {
    if (this.peerConnections.has(peerId)) {
      this.peerConnections.get(peerId).close();
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
    } else {
      // İzleyici tarafı: Video ve Ses alıcılarını hazırla
      pc.addTransceiver('video', { direction: 'recvonly' });
      pc.addTransceiver('audio', { direction: 'recvonly' });
    }

    // İzleyici tarafı: Gelen canlı akışı anında oynat (Autoplay Garantili)
    pc.ontrack = (event) => {
      const stream = (event.streams && event.streams[0]) ? event.streams[0] : new MediaStream([event.track]);
      
      window.syncEngine.loadMedia({
        type: 'webrtc',
        url: 'screenshare-live',
        title: '📺 Canlı Ekran Yayını'
      });

      this.webrtcVideo.srcObject = stream;
      
      // Autoplay engelini aşmak için önce sessiz başlat sonra sesi uygula
      this.webrtcVideo.muted = true;
      this.webrtcVideo.play().then(() => {
        // Oynatma başarılı olunca izleyicinin ses ayarını aç
        this.webrtcVideo.muted = false;
        window.syncEngine.applyVolume();
      }).catch((err) => {
        console.warn('Otomatik oynatma kısıtlaması, sessiz devam ediliyor:', err);
        this.webrtcVideo.muted = true;
        this.webrtcVideo.play().catch(e => console.error(e));
      });
    };

    // ICE Adaylarını Karşı Tarafa İlet
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('webrtc-signal', {
          targetId: peerId,
          signal: event.candidate,
          type: 'candidate'
        });
      }
    };

    // Teklif Başlatıcı (Initiator / Host)
    if (isInitiator) {
      const makeOffer = async () => {
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
          console.error('Offer oluşturma hatası:', err);
        }
      };
      makeOffer();
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
            await pc.addIceCandidate(new RTCIceCandidate(cand));
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
              await pc.addIceCandidate(new RTCIceCandidate(cand));
            }
            pc.iceCandidatesQueue = [];
          }
        }
      } else if (type === 'candidate') {
        if (pc.remoteDescription && pc.remoteDescription.type) {
          await pc.addIceCandidate(new RTCIceCandidate(signal));
        } else {
          if (!pc.iceCandidatesQueue) pc.iceCandidatesQueue = [];
          pc.iceCandidatesQueue.push(signal);
        }
      }
    } catch (err) {
      console.error('Sinyal işleme hatası:', err);
    }
  }
}
