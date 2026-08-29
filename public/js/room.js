/**
 * ============================================================================
 * SYNCPARTY ROOM CONTROLLER (ANA ODA YÖNETİCİSİ)
 * ============================================================================
 */

// Dinamik Tema Renk Paletleri
const themePalettes = {
  '#b3001e': { red: '#b3001e', crimson: '#8b0018', glow: 'rgba(179, 0, 30, 0.45)', border: 'rgba(179, 0, 30, 0.35)' },
  '#8b0018': { red: '#8b0018', crimson: '#5c000e', glow: 'rgba(139, 0, 24, 0.45)', border: 'rgba(139, 0, 24, 0.35)' },
  '#d90429': { red: '#d90429', crimson: '#a0001e', glow: 'rgba(217, 4, 41, 0.45)', border: 'rgba(217, 4, 41, 0.35)' },
  '#7928ca': { red: '#7928ca', crimson: '#551199', glow: 'rgba(121, 40, 202, 0.45)', border: 'rgba(121, 40, 202, 0.35)' },
  '#00f2fe': { red: '#00f2fe', crimson: '#00a3cc', glow: 'rgba(0, 242, 254, 0.45)', border: 'rgba(0, 242, 254, 0.35)' },
  '#ff9900': { red: '#ff9900', crimson: '#cc7a00', glow: 'rgba(255, 153, 0, 0.45)', border: 'rgba(255, 153, 0, 0.35)' },
  '#10b981': { red: '#10b981', crimson: '#059669', glow: 'rgba(16, 185, 129, 0.45)', border: 'rgba(16, 185, 129, 0.35)' }
};

function applyAccentColor(hex) {
  const p = themePalettes[hex] || themePalettes['#b3001e'];
  document.documentElement.style.setProperty('--accent-red', p.red);
  document.documentElement.style.setProperty('--accent-crimson', p.crimson);
  document.documentElement.style.setProperty('--accent-red-glow', p.glow);
  document.documentElement.style.setProperty('--border-red', p.border);
  document.documentElement.style.setProperty('--border-red-active', p.red);
  localStorage.setItem('sync_accent_color', hex);
}

// Toast Bildirim Fonksiyonu
window.showToast = function(message) {
  const toast = document.getElementById('room-toast');
  const toastText = document.getElementById('toast-text');
  if (toast && toastText) {
    toastText.textContent = message;
    toast.classList.add('show');
    clearTimeout(window._toastTimer);
    window._toastTimer = setTimeout(() => {
      toast.classList.remove('show');
    }, 3500);
  }
};

class RoomEngine {
  constructor() {
    this.socket = io({
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000
    });

    this.roomId = this.getRoomIdFromUrl();
    this.currentUser = null;
    this.users = [];
    this.isHost = false;
    this.isFitFill = false;

    // Alt Motorlar
    window.syncEngine = new SyncEngine(this.socket);
    window.chatEngine = new ChatEngine(this.socket);
    window.webrtcShare = new WebRTCShareEngine(this.socket);
    window.webrtcEngine = window.webrtcShare; // alias

    this.init();
    this.initTheme();
  }

  getRoomIdFromUrl() {
    const pathParts = window.location.pathname.split('/');
    let roomId = pathParts[pathParts.length - 1];
    if (!roomId || roomId === 'room.html' || roomId === 'room') {
      const urlParams = new URLSearchParams(window.location.search);
      roomId = urlParams.get('room') || 'AB42';
    }
    return roomId.toUpperCase();
  }

  initTheme() {
    const savedTheme = localStorage.getItem('sync_theme');
    if (savedTheme === 'oled') {
      document.body.classList.add('theme-oled');
    }

    const savedAccent = localStorage.getItem('sync_accent_color') || localStorage.getItem('sync_color') || '#b3001e';
    applyAccentColor(savedAccent);

    // Oda içi tema değiştirme butonu
    const themeToggleBtn = document.getElementById('btn-theme-toggle');
    if (themeToggleBtn) {
      themeToggleBtn.addEventListener('click', () => {
        const isOled = document.body.classList.toggle('theme-oled');
        localStorage.setItem('sync_theme', isOled ? 'oled' : 'midnight');
        window.showToast(isOled ? '🌑 OLED Saf Siyah Modu Aktif' : '✨ Standart Koyu Mod Aktif');
      });
    }

    // Modal içi renk seçimi
    const colorDots = document.querySelectorAll('#room-color-picker .color-dot');
    colorDots.forEach(dot => {
      dot.classList.toggle('active', dot.dataset.color === savedAccent);
      dot.addEventListener('click', () => {
        colorDots.forEach(d => d.classList.remove('active'));
        dot.classList.add('active');
        applyAccentColor(dot.dataset.color);
        window.showToast(`🎨 Tema Rengi Değiştirildi`);
      });
    });
  }

  init() {
    // 15sn Kopma Önleyici Heartbeat Dinleyicisi
    this.socket.on('heartbeat-ping', () => {
      this.socket.emit('heartbeat-pong');
    });

    // Odaya Bağlanma (Kalıcı Host Kimliği - Sekme ve Yenileme Korumalı)
    const username = localStorage.getItem('sync_username') || `İzleyici ${Math.floor(10 + Math.random() * 90)}`;
    const avatarColor = localStorage.getItem('sync_accent_color') || localStorage.getItem('sync_color') || '#b3001e';
    
    // Her sekmenin kendi bağımsız token'ı olur ve F5 yenilemede korunur
    let userToken = sessionStorage.getItem('sync_user_token');
    if (!userToken) {
      userToken = 'tok_' + Math.random().toString(36).substr(2, 9) + Date.now();
      sessionStorage.setItem('sync_user_token', userToken);
    }

    const isCreator = sessionStorage.getItem('sync_room_host_' + this.roomId.toLowerCase()) === 'true';

    this.socket.emit('join-room', {
      roomId: this.roomId,
      username,
      avatarColor,
      userToken,
      isCreator
    });

    document.getElementById('display-room-code').textContent = this.roomId;

    // Oda Kodunu Kopyalama (Yalnızca 4 Haneli Kodu Kopyalar)
    const copyBtn = document.getElementById('btn-copy-link');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        const code = this.roomId;
        navigator.clipboard.writeText(code).then(() => {
          window.showToast(`📋 Oda kodu kopyalandı: ${code}`);
        }).catch(() => {
          window.showToast('Oda Kodu: ' + code);
        });
      });
    }

    // Sinema Modu / Sohbeti Kapat Geniş Ekran Toggle
    const theaterBtn = document.getElementById('btn-theater-mode');
    if (theaterBtn) {
      theaterBtn.addEventListener('click', () => {
        const mainLayout = document.querySelector('.room-main-layout');
        if (mainLayout) {
          mainLayout.classList.toggle('theater-mode');
          const isTheater = mainLayout.classList.contains('theater-mode');
          window.showToast(isTheater ? '🎬 Sinema Modu: Geniş Ekran Aktif' : '💬 Sohbet Görünümü Açıldı');
        }
      });
    }

    // Ekranı Tam Doldurma / Boşluk Doldur Butonu (Fill / Contain Toggle)
    const fitBtn = document.getElementById('btn-toggle-fit');
    if (fitBtn) {
      fitBtn.addEventListener('click', () => {
        const playerWrapper = document.getElementById('player-wrapper');
        this.isFitFill = !this.isFitFill;
        if (this.isFitFill) {
          playerWrapper.classList.add('fill-screen-mode');
          window.showToast('📐 Ekran Tam Alana Dolduruldu (Boşluksuz)');
        } else {
          playerWrapper.classList.remove('fill-screen-mode');
          window.showToast('📏 Orijinal En-Boy Oranına Dönüldü');
        }
      });
    }

    // Tam Ekran Yönetimi (PC, Android & iOS Safari Uyumlu)
    const playerWrapper = document.getElementById('player-wrapper');
    const toggleAppFullscreen = () => {
      const isFullscreen = document.fullscreenElement || document.webkitFullscreenElement || document.body.classList.contains('mobile-pseudo-fullscreen');

      if (!isFullscreen) {
        if (playerWrapper.requestFullscreen) {
          playerWrapper.requestFullscreen().then(() => {
            if (screen.orientation && screen.orientation.lock) {
              screen.orientation.lock('landscape').catch(() => {});
            }
          }).catch(() => {
            this.triggerMobileVideoFullscreen();
          });
        } else if (playerWrapper.webkitRequestFullscreen) {
          playerWrapper.webkitRequestFullscreen();
        } else {
          this.triggerMobileVideoFullscreen();
        }
      } else {
        if (document.exitFullscreen) {
          document.exitFullscreen().catch(() => {});
        } else if (document.webkitExitFullscreen) {
          document.webkitExitFullscreen();
        }
        document.body.classList.remove('mobile-pseudo-fullscreen');
        if (screen.orientation && screen.orientation.unlock) {
          screen.orientation.unlock().catch(() => {});
        }
      }
    };

    const fsBtn = document.getElementById('ctrl-fullscreen');
    if (fsBtn) {
      fsBtn.addEventListener('click', toggleAppFullscreen);
    }

    // Mobilde Videoya Çift Dokunarak Tam Ekran Yapma
    let lastTap = 0;
    playerWrapper.addEventListener('touchend', (e) => {
      const currentTime = new Date().getTime();
      const tapLength = currentTime - lastTap;
      if (tapLength < 350 && tapLength > 0) {
        e.preventDefault();
        toggleAppFullscreen();
      }
      lastTap = currentTime;
    });

    // Telefonu Yatay Çevirince (Landscape) Otomatik Tam Ekrana Geçme
    const handleDeviceOrientation = () => {
      const isMobile = window.innerWidth <= 1024;
      const isLandscape = window.innerWidth > window.innerHeight;

      if (isMobile && isLandscape) {
        document.body.classList.add('mobile-landscape-mode');
        if (!document.fullscreenElement && playerWrapper.requestFullscreen) {
          playerWrapper.requestFullscreen().catch(() => {});
        }
      } else if (isMobile && !isLandscape) {
        document.body.classList.remove('mobile-landscape-mode');
        if (document.fullscreenElement && document.exitFullscreen) {
          document.exitFullscreen().catch(() => {});
        }
        document.body.classList.remove('mobile-pseudo-fullscreen');
      }
    };

    window.addEventListener('resize', handleDeviceOrientation);
    window.addEventListener('orientationchange', () => {
      setTimeout(handleDeviceOrientation, 250);
    });
    if (screen.orientation) {
      screen.orientation.addEventListener('change', handleDeviceOrientation);
    }

    // Yeniden Eşitleme Butonu
    const reSyncBtn = document.getElementById('btn-re-sync');
    if (reSyncBtn) {
      reSyncBtn.addEventListener('click', () => {
        if (!this.isHost) {
          window.showToast('🔄 Host ile anında yeniden eşitleniyor...');
          this.socket.emit('host-action', { action: 'request-sync' });
          this.socket.emit('guest-needs-stream');
          if (window.webrtcShare) {
            window.webrtcShare._showLayer();
            window.webrtcShare._unlockAudio();
          }
          if (window.syncEngine && window.syncEngine.currentMediaType === 'embed' && window.syncEngine.embedIframe) {
            const curSrc = window.syncEngine.embedIframe.src;
            if (curSrc && curSrc !== 'about:blank') {
              window.syncEngine.embedIframe.src = curSrc;
            }
          }
        } else {
          window.showToast('👑 Siz oda sahibisiniz, yayın kaynağı sizsiniz.');
        }
      });
    }

    // Yan Panel Sekme Değişimi
    const tabChatBtn = document.getElementById('tab-chat-btn');
    const tabUsersBtn = document.getElementById('tab-users-btn');
    const chatTab = document.getElementById('chat-tab');
    const usersTab = document.getElementById('users-tab');

    tabChatBtn.addEventListener('click', () => {
      tabChatBtn.classList.add('active');
      tabUsersBtn.classList.remove('active');
      chatTab.classList.remove('hidden');
      usersTab.classList.add('hidden');
    });

    tabUsersBtn.addEventListener('click', () => {
      tabUsersBtn.classList.add('active');
      tabChatBtn.classList.remove('active');
      usersTab.classList.remove('hidden');
      chatTab.classList.add('hidden');
    });

    document.getElementById('users-toggle-btn').addEventListener('click', () => {
      tabUsersBtn.click();
    });

    // Medya ve Ayar Modalları
    this.initMediaModal();
    this.initSettingsModal();
    this.initSocketEvents();
  }

  // -----------------------------------------------------------
  // MEDYA SEÇİM MODALI (YouTube, Film Proxy, MP4/M3U8)
  // -----------------------------------------------------------
  initMediaModal() {
    const mediaModal = document.getElementById('media-modal');
    const openModalBtn = document.getElementById('btn-open-media-modal');
    const closeModalBtn = document.getElementById('close-media-modal');
    const cancelModalBtn = document.getElementById('cancel-media-modal');
    const applyMediaBtn = document.getElementById('apply-media-btn');

    const openMediaModal = () => {
      if (!this.isHost && window.syncEngine.hostOnlyControl) {
        window.showToast('🔒 Yalnızca oda sahibi video kaynağını değiştirebilir!');
        return;
      }
      mediaModal.classList.remove('hidden');
    };

    openModalBtn.addEventListener('click', openMediaModal);
    const idlePickBtn = document.getElementById('btn-idle-pick');
    if (idlePickBtn) {
      idlePickBtn.addEventListener('click', openMediaModal);
    }

    const hideModal = () => mediaModal.classList.add('hidden');
    closeModalBtn.addEventListener('click', hideModal);
    cancelModalBtn.addEventListener('click', hideModal);

    // Modal Sekmeleri Değişimi
    const modalTabBtns = document.querySelectorAll('.m-tab-btn');
    const forms = {
      youtube: document.getElementById('source-form-youtube'),
      film: document.getElementById('source-form-film'),
      direct: document.getElementById('source-form-direct'),
      screenshare: document.getElementById('source-form-screenshare')
    };

    let selectedSource = 'youtube';

    modalTabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        modalTabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedSource = btn.dataset.source;

        Object.keys(forms).forEach(key => {
          if (key === selectedSource) forms[key].classList.remove('hidden');
          else forms[key].classList.add('hidden');
        });
      });
    });

    // Örnek YouTube ve Film Butonları
    document.querySelectorAll('.chip-sample').forEach(chip => {
      chip.addEventListener('click', () => {
        const url = chip.dataset.url;
        if (selectedSource === 'film') {
          const filmInput = document.getElementById('input-film-url');
          if (filmInput) filmInput.value = url;
        } else {
          const ytInput = document.getElementById('input-yt-url');
          if (ytInput) ytInput.value = url;
        }
      });
    });

    // Modal Ekran Paylaşımı Başlat
    const modalScreenShareBtn = document.getElementById('btn-start-modal-screenshare');
    if (modalScreenShareBtn) {
      modalScreenShareBtn.addEventListener('click', () => {
        hideModal();
        if (window.webrtcShare) {
          window.webrtcShare._promptAndStartShare();
        }
      });
    }

    // Medya Uygula Butonu
    applyMediaBtn.addEventListener('click', async () => {
      let type = selectedSource;
      let url = '';
      let title = '';

      if (type === 'youtube') {
        url = document.getElementById('input-yt-url').value.trim();
        title = 'YouTube';
      } else if (type === 'film') {
        const filmUrl = document.getElementById('input-film-url').value.trim();
        if (!filmUrl) return;

        window.showToast('🔍 Film kaynağı taranıyor...');
        try {
          const extractRes = await fetch(`/api/extract-video?url=${encodeURIComponent(filmUrl)}`);
          const extractData = await extractRes.json();

          if (extractData.success && extractData.streamUrl) {
            type = extractData.type || 'embed';
            url = extractData.streamUrl;
            title = extractData.isDirectPlayer ? '🎬 Doğrudan Player Yayını' : '🎬 Film / Dizi Yayını';
            window.showToast('🎉 Film akışı bağlandı!');
          } else {
            type = 'embed';
            url = `/api/proxy-embed?url=${encodeURIComponent(filmUrl)}`;
            title = '🎬 Film Sitesi Yayını (Proxy)';
          }
        } catch (e) {
          type = 'embed';
          url = `/api/proxy-embed?url=${encodeURIComponent(filmUrl)}`;
          title = '🎬 Film Sitesi Yayını (Proxy)';
        }
      } else if (type === 'direct') {
        url = document.getElementById('input-direct-url').value.trim();
        title = url.includes('.m3u8') ? 'HLS Canlı Yayın' : 'MP4 Video';
      }

      if (!url && type !== 'screenshare') {
        window.showToast('⚠️ Lütfen geçerli bir bağlantı girin!');
        return;
      }

      this.socket.emit('change-media', { type, url, title });
      hideModal();
    });
  }

  // -----------------------------------------------------------
  // AYARLAR MODALI
  // -----------------------------------------------------------
  initSettingsModal() {
    const settingsModal = document.getElementById('settings-modal');
    const openSettingsBtn = document.getElementById('btn-room-settings');
    const closeSettingsBtn = document.getElementById('close-settings-modal');
    const saveSettingsBtn = document.getElementById('save-settings-btn');
    const hostLockCheck = document.getElementById('setting-host-lock');
    const oledModeCheck = document.getElementById('setting-oled-mode');

    openSettingsBtn.addEventListener('click', () => {
      hostLockCheck.checked = window.syncEngine.hostOnlyControl;
      hostLockCheck.disabled = !this.isHost;
      oledModeCheck.checked = document.body.classList.contains('theme-oled');
      settingsModal.classList.remove('hidden');
    });

    const hide = () => settingsModal.classList.add('hidden');
    closeSettingsBtn.addEventListener('click', hide);

    saveSettingsBtn.addEventListener('click', () => {
      if (this.isHost) {
        this.socket.emit('toggle-host-control', {
          hostOnlyControl: hostLockCheck.checked
        });
      }
      
      if (oledModeCheck.checked) {
        document.body.classList.add('theme-oled');
        localStorage.setItem('sync_theme', 'oled');
      } else {
        document.body.classList.remove('theme-oled');
        localStorage.setItem('sync_theme', 'midnight');
      }

      hide();
      window.showToast('⚙️ Ayarlar kaydedildi.');
    });
  }

  // -----------------------------------------------------------
  // SOCKET.IO ODA YÖNETİMİ
  // -----------------------------------------------------------
  initSocketEvents() {
    this.socket.on('room-joined', (data) => {
      this.currentUser = data.user;
      this.isHost = data.user.id === data.hostId;
      this.users = data.users;

      window.syncEngine.setHost(this.isHost);
      this.updateHostStatusUI();
      this.renderUsersList();

      // Medyayı yükle
      if (data.media) {
        window.syncEngine.loadMedia(data.media);
        // Eğer odada aktif ekran paylaşımı varsa derhal (0ms) akışı talep et
        if (data.media.type === 'webrtc') {
          if (window.webrtcShare) window.webrtcShare._showLayer();
          this.socket.emit('guest-needs-stream');
          setTimeout(() => {
            this.socket.emit('guest-needs-stream');
          }, 300);
        }
      }

      window.showToast(this.isHost ? '👑 Odanın sahibisiniz!' : '🎉 Odaya katıldınız!');
    });

    this.socket.on('user-joined', ({ user, users }) => {
      this.users = users;
      this.renderUsersList();
      window.showToast(`👋 ${user.username} odaya katıldı.`);
    });

    this.socket.on('user-left', ({ userId, users }) => {
      this.users = users;
      this.renderUsersList();
    });

    this.socket.on('host-transferred', ({ newHostId, newHostName }) => {
      this.isHost = this.socket.id === newHostId;
      window.syncEngine.setHost(this.isHost);
      this.updateHostStatusUI();
      window.showToast(`👑 Yeni oda sahibi: ${newHostName}`);
    });

    this.socket.on('action-error', ({ message }) => {
      window.showToast(`⚠️ ${message}`);
    });
  }

  updateHostStatusUI() {
    const indicator = document.getElementById('host-status-indicator');

    if (this.isHost) {
      indicator.className = 'status-pill is-host';
      indicator.innerHTML = `<i class="fa-solid fa-crown"></i> <span id="role-text">Oda Sahibi (Host)</span>`;
    } else {
      indicator.className = 'status-pill';
      indicator.innerHTML = `<i class="fa-solid fa-shield"></i> <span id="role-text">İzleyici Modu</span>`;
    }
  }

  renderUsersList() {
    const container = document.getElementById('users-list-container');
    const userCountDisplay = document.getElementById('user-count-display');
    const tabUsersCount = document.getElementById('tab-users-count');

    userCountDisplay.textContent = this.users.length;
    tabUsersCount.textContent = this.users.length;

    container.innerHTML = '';

    this.users.forEach(user => {
      const row = document.createElement('div');
      row.className = 'user-row';

      const left = document.createElement('div');
      left.className = 'user-info-left';

      const avatar = document.createElement('div');
      avatar.className = 'user-avatar-circle';
      avatar.style.backgroundColor = user.avatarColor || '#b3001e';
      avatar.textContent = user.username.charAt(0).toUpperCase();

      const name = document.createElement('span');
      name.className = 'user-name-label';
      name.textContent = user.username + (user.id === this.socket.id ? ' (Siz)' : '');

      left.appendChild(avatar);
      left.appendChild(name);
      row.appendChild(left);

      if (user.isHost) {
        const hostBadge = document.createElement('span');
        hostBadge.className = 'user-badge-host';
        hostBadge.innerHTML = '<i class="fa-solid fa-crown"></i> HOST';
        row.appendChild(hostBadge);
      }

      container.appendChild(row);
    });
  }

  // iOS Safari & Mobil Video Tam Ekran Tetikleyicisi
  triggerMobileVideoFullscreen() {
    const currentType = window.syncEngine ? window.syncEngine.currentMediaType : 'youtube';
    if (currentType === 'html5' && window.syncEngine.html5Video && window.syncEngine.html5Video.webkitEnterFullscreen) {
      window.syncEngine.html5Video.webkitEnterFullscreen();
    } else if (currentType === 'webrtc' && window.syncEngine.webrtcVideo && window.syncEngine.webrtcVideo.webkitEnterFullscreen) {
      window.syncEngine.webrtcVideo.webkitEnterFullscreen();
    } else {
      document.body.classList.toggle('mobile-pseudo-fullscreen');
    }
  }
}

// Uygulama Başlatıcı
document.addEventListener('DOMContentLoaded', () => {
  window.roomEngine = new RoomEngine();
});
