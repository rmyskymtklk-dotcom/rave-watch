/**
 * ============================================================================
 * SYNCPARTY WEBRTC SCREEN & TAB AUDIO SHARING ENGINE
 * HDFilmCehennemi ve Tüm Siteler İçin Sıfır Gecikmeli Ekran/Sekme Paylaşımı
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

    // Ekran Paylaşımı Durum Güncellemesi (Tüm Kullanıcılar İçin)
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

      // 1. Ekranı Host'un kendi SyncParty penceresinde hemen göster
      window.syncEngine.loadMedia({
        type: 'webrtc',
        url: 'screenshare-live',
        title: '📺 Ekran Yayını (Canlı)'
      });

      this.webrtcVideo.srcObject = stream;
      this.webrtcVideo.muted = true; // Host kendi sekme sesinden eko yapmasın
      this.webrtcVideo.play().catch(e => console.warn(e));

      this.screenShareBtn.classList.add('btn-primary');
      this.screenShareBtn.classList.remove('btn-secondary-sm');
      this.screenShareBtnText.textContent = 'Paylaşımı Durdur';

      // Ekran paylaşımını tarayıcı butonundan durdurursa
      stream.getVideoTracks()[0].onended = () => {
        this.stopScreenShare();
      };

      // Sunucuya ve diğer kullanıcılara bildir
      this.socket.emit('screenshare-status', { active: true });

      // Odadaki diğer kullanıcılara WebRTC teklifi gönder
      window.roomEngine.users.forEach(user => {
        if (user.id !== this.socket.id) {
          this.createPeerConnection(user.id, true);
        }
      });

      window.showToast('🚀 Ekranınız hem sizde hem odadaki izleyicilerde canlı açıldı!');
    } catch (err) {
      console.warn('Ekran paylaşımı başlatılamadı veya iptal edildi:', err);
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
    const pc = new RTCPeerConnection(this.rtcConfig);
    this.peerConnections.set(peerId, pc);

    // Host tarafı: Akışı ekle
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream);
      });
    }

    // İzleyici tarafı: Gelen canlı akışı oynat
    pc.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        window.syncEngine.loadMedia({
          type: 'webrtc',
          url: 'screenshare-live',
          title: '📺 Canlı Ekran Yayını'
        });
        this.webrtcVideo.srcObject = event.streams[0];
        this.webrtcVideo.play().catch(e => console.warn(e));
        window.syncEngine.applyVolume();
      }
    };

    // ICE Adayları
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('webrtc-signal', {
          targetId: peerId,
          signal: event.candidate,
          type: 'candidate'
        });
      }
    };

    // Initiator Teklifi
    if (isInitiator) {
      pc.onnegotiationneeded = async () => {
        try {
          const offer = await pc.createOffer();
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
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.socket.emit('webrtc-signal', {
          targetId: senderId,
          signal: pc.localDescription,
          type: 'answer'
        });
      } else if (type === 'answer') {
        await pc.setRemoteDescription(new RTCSessionDescription(signal));
      } else if (type === 'candidate') {
        await pc.addIceCandidate(new RTCIceCandidate(signal));
      }
    } catch (err) {
      console.error('Sinyal işleme hatası:', err);
    }
  }
}
