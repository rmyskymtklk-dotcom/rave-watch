/**
 * ============================================================================
 * SYNCPARTY SYNC ENGINE (SENKRONİZASYON MOTORU)
 * YouTube IFrame (Altyazısız & Arka Planda Kesintisiz), HTML5 Video, HLS & WebRTC
 * ============================================================================
 */

class SyncEngine {
  constructor(socket) {
    this.socket = socket;
    this.isHost = false;
    this.hostOnlyControl = true;
    this.currentMediaType = 'youtube'; // 'youtube' | 'html5' | 'embed' | 'webrtc'
    this.currentMediaUrl = '';
    
    // YouTube API Durumu
    this.ytPlayer = null;
    this.isYtReady = false;
    this.pendingYtVideoId = null;

    // HTML5 Video & HLS
    this.html5Video = document.getElementById('html5-video');
    this.hls = null;

    // Embed & WebRTC Katmanları
    this.embedIframe = document.getElementById('proxy-iframe');
    this.webrtcVideo = document.getElementById('webrtc-video');

    // UI Kontrol Elemanları
    this.playPauseBtn = document.getElementById('ctrl-play-pause');
    this.playPauseIcon = document.getElementById('play-pause-icon');
    this.currentTimeText = document.getElementById('current-time-text');
    this.durationTimeText = document.getElementById('duration-time-text');
    this.progressContainer = document.getElementById('progress-container');
    this.progressCurrent = document.getElementById('progress-current');
    this.progressBuffered = document.getElementById('progress-buffered');
    this.progressHandle = document.getElementById('progress-handle');
    this.progressTooltip = document.getElementById('progress-tooltip');
    this.volumeSlider = document.getElementById('volume-slider');
    this.muteBtn = document.getElementById('ctrl-mute-btn');
    this.volumeIcon = document.getElementById('volume-icon');
    this.mediaTypeBadge = document.getElementById('media-type-badge');
    this.currentMediaTitle = document.getElementById('current-media-title');
    this.hostLockTag = document.getElementById('host-lock-tag');
    this.pipBtn = document.getElementById('ctrl-pip');

    // Bağımsız Yerel Ses Düzeyi (Varsayılan: %100, Maksimum: %200 Boost)
    this.localVolume = parseFloat(localStorage.getItem('sync_volume') || '100');
    this.isMuted = localStorage.getItem('sync_muted') === 'true';

    // Senkronizasyon ve Arka Plan Oynatma Durumu
    this.isSeeking = false;
    this.ignoreNextPlayEvent = false;
    this.ignoreNextPauseEvent = false;
    this.userInitiatedPause = false; // Kullanıcı mı durdurdu yoksa sekme değiştiği için tarayıcı mı durdurdu?
    this.lastHostSyncTime = 0;

    this.initUI();
    this.initSocketEvents();
    this.setupVolume();
    this.setupBackgroundPlayback();
  }

  // -----------------------------------------------------------
  // BAĞIMSIZ SES AYARI & 200% SES GÜÇLENDİRİCİ (AUDIO BOOSTER)
  // -----------------------------------------------------------
  setupVolume() {
    this.volumeTooltip = document.getElementById('volume-tooltip');
    this.volumeSlider.value = this.localVolume;
    this.applyVolume();

    this.volumeSlider.addEventListener('input', (e) => {
      this.localVolume = parseFloat(e.target.value);
      this.isMuted = this.localVolume === 0;
      localStorage.setItem('sync_volume', this.localVolume);
      localStorage.setItem('sync_muted', this.isMuted);
      this.applyVolume();
    });

    this.muteBtn.addEventListener('click', () => {
      this.isMuted = !this.isMuted;
      localStorage.setItem('sync_muted', this.isMuted);
      this.applyVolume();
    });
  }

  applyVolume() {
    const vol = this.isMuted ? 0 : this.localVolume;
    
    // Tooltip güncelle
    if (this.volumeTooltip) {
      if (this.isMuted || vol === 0) {
        this.volumeTooltip.textContent = 'Sessiz';
        this.volumeTooltip.style.color = '#ef4444';
      } else if (vol > 100) {
        this.volumeTooltip.textContent = `${Math.round(vol)}% 🚀`;
        this.volumeTooltip.style.color = '#f59e0b';
      } else {
        this.volumeTooltip.textContent = `${Math.round(vol)}%`;
        this.volumeTooltip.style.color = '#fff';
      }
    }

    // YouTube Sesi (0-100 ölçekli)
    if (this.ytPlayer && this.isYtReady && typeof this.ytPlayer.setVolume === 'function') {
      if (this.isMuted) {
        this.ytPlayer.mute();
      } else {
        this.ytPlayer.unMute();
        this.ytPlayer.setVolume(Math.min(100, vol));
      }
    }

    // HTML5 Sesi
    if (this.html5Video) {
      this.html5Video.volume = Math.min(1.0, vol / 100);
      this.html5Video.muted = this.isMuted;
    }

    // WebRTC Sesi
    if (this.webrtcVideo) {
      this.webrtcVideo.volume = Math.min(1.0, vol / 100);
      if (window.webrtcShare && window.webrtcShare.isSharing) {
        this.webrtcVideo.muted = true;
      } else {
        this.webrtcVideo.muted = this.isMuted;
      }
    }

    // İkon Güncelle
    if (this.isMuted || vol === 0) {
      this.volumeIcon.className = 'fa-solid fa-volume-xmark';
    } else if (vol < 50) {
      this.volumeIcon.className = 'fa-solid fa-volume-low';
    } else {
      this.volumeIcon.className = 'fa-solid fa-volume-high';
    }
  }

  // -----------------------------------------------------------
  // YOUTUBE OYNATICI (ALTYAZISIZ & ARKA PLAN KESİNTİSİZ)
  // -----------------------------------------------------------
  initYouTube(onReadyCallback) {
    if (!this.pendingYtVideoId) return;

    if (window.YT && window.YT.Player) {
      this.ytPlayer = new YT.Player('youtube-iframe-target', {
        height: '100%',
        width: '100%',
        videoId: this.pendingYtVideoId,
        playerVars: {
          autoplay: 0,
          controls: 0,
          disablekb: 1,
          enablejsapi: 1,
          fs: 0,
          modestbranding: 1,
          rel: 0,
          iv_load_policy: 3,
          cc_load_policy: 0,
          cc_lang_pref: 'none'
        },
        events: {
          onReady: (event) => {
            this.isYtReady = true;
            this.disableSubtitles();
            this.applyVolume();
            if (onReadyCallback) onReadyCallback();
          },
          onStateChange: (event) => {
            this.handleYouTubeStateChange(event);
          }
        }
      });
    } else {
      window.onYouTubeIframeAPIReady = () => {
        this.initYouTube(onReadyCallback);
      };
    }
  }

  disableSubtitles() {
    try {
      if (this.ytPlayer && typeof this.ytPlayer.setOption === 'function') {
        this.ytPlayer.setOption('captions', 'track', {});
        this.ytPlayer.setOption('cc', 'track', {});
      }
      if (this.ytPlayer && typeof this.ytPlayer.unloadModule === 'function') {
        this.ytPlayer.unloadModule('captions');
        this.ytPlayer.unloadModule('cc');
      }
    } catch (e) {}
  }

  handleYouTubeStateChange(event) {
    if (this.isHost) {
      const curTime = this.ytPlayer.getCurrentTime() || 0;
      if (event.data === YT.PlayerState.PLAYING) {
        this.userInitiatedPause = false;
        this.disableSubtitles();
        this.updateMediaSession(this.currentMediaTitle.textContent, true);
        if (!this.ignoreNextPlayEvent) {
          this.socket.emit('media-action', { action: 'play', currentTime: curTime });
          this.updatePlayPauseIcon(true);
        }
        this.ignoreNextPlayEvent = false;
      } else if (event.data === YT.PlayerState.PAUSED) {
        // Sekme değiştiği için tarayıcı durdurduysa odaya duraklatma gönderme, devam ettir!
        if (document.hidden && !this.userInitiatedPause) {
          this.ytPlayer.playVideo();
          return;
        }

        if (!this.ignoreNextPauseEvent && this.userInitiatedPause) {
          this.socket.emit('media-action', { action: 'pause', currentTime: curTime });
          this.updatePlayPauseIcon(false);
          this.updateMediaSession(this.currentMediaTitle.textContent, false);
        }
        this.ignoreNextPauseEvent = false;
      }
    }
  }

  // -----------------------------------------------------------
  // ARAYÜZ (UI) ETKİLEŞİMLERİ VE KONTROLLER
  // -----------------------------------------------------------
  initUI() {
    this.playPauseBtn.addEventListener('click', () => {
      if (!this.isHost && this.hostOnlyControl) {
        window.showToast('⚠️ Videoyu yalnızca oda sahibi duraklatabilir veya başlatabilir.');
        return;
      }
      this.togglePlayPause();
    });

    const ctrlBackward = document.getElementById('ctrl-backward');
    const ctrlForward = document.getElementById('ctrl-forward');

    if (ctrlBackward) {
      ctrlBackward.addEventListener('click', () => {
        if (this.canControl()) this.seekRelative(-10);
      });
    }
    if (ctrlForward) {
      ctrlForward.addEventListener('click', () => {
        if (this.canControl()) this.seekRelative(10);
      });
    }

    if (this.pipBtn) {
      this.pipBtn.addEventListener('click', () => {
        this.togglePictureInPicture();
      });
    }

    const btnToggleFit = document.getElementById('btn-toggle-fit');
    if (btnToggleFit) {
      btnToggleFit.addEventListener('click', () => {
        const playerWrapper = document.getElementById('player-wrapper');
        if (playerWrapper) {
          const isFilled = playerWrapper.classList.toggle('fill-screen-mode');
          window.showToast(isFilled ? '📐 Ekranı Doldurma Modu: Açık (Boşluksuz Tam Ekran)' : '📐 Ekranı Sığdırma Modu: Orantılı (16:9)');
        }
      });
    }

    this.progressContainer.addEventListener('click', (e) => {
      if (!this.canControl()) {
        window.showToast('🔒 Yalnızca oda sahibi videoyu sarabilir!');
        return;
      }
      const rect = this.progressContainer.getBoundingClientRect();
      const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const dur = this.getDuration();
      if (dur > 0) {
        const targetTime = pos * dur;
        this.seekTo(targetTime, true);
      }
    });

    this.progressContainer.addEventListener('mousemove', (e) => {
      const rect = this.progressContainer.getBoundingClientRect();
      const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const dur = this.getDuration();
      if (dur > 0) {
        this.progressTooltip.style.display = 'block';
        this.progressTooltip.style.left = `${pos * 100}%`;
        this.progressTooltip.textContent = this.formatTime(pos * dur);
      }
    });

    this.progressContainer.addEventListener('mouseleave', () => {
      this.progressTooltip.style.display = 'none';
    });

    // Düzenli Zaman Güncelleme Döngüsü
    setInterval(() => {
      this.updateProgressUI();
      if (this.isHost && this.currentMediaType === 'youtube') {
        const curTime = this.getCurrentTime();
        const isPlaying = this.getIsPlaying();
        this.socket.emit('host-sync-heartbeat', {
          currentTime: curTime,
          isPlaying: isPlaying
        });
      }
    }, 1000);
  }

  async togglePictureInPicture() {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        if (this.currentMediaType === 'webrtc' && this.webrtcVideo) {
          await this.webrtcVideo.requestPictureInPicture();
        } else if (this.currentMediaType === 'html5' && this.html5Video) {
          await this.html5Video.requestPictureInPicture();
        } else {
          window.showToast('ℹ️ PiP modu ekran paylaşımı ve doğrudan video oynatıcıda etkindir.');
        }
      }
    } catch (err) {
      console.warn('PiP başlatılamadı:', err);
    }
  }

  canControl() {
    if (this.isHost) return true;
    if (!this.hostOnlyControl) return true;
    return false;
  }

  // -----------------------------------------------------------
  // MEDYA YÜKLEME VE OYNATICI DEĞİŞTİRME
  // -----------------------------------------------------------
  loadMedia(mediaData) {
    const { type, url, title, currentTime, isPlaying } = mediaData;
    this.currentMediaType = type || 'youtube';
    this.currentMediaUrl = url;

    // 1. Önceki tüm medya oynatıcılarını durdur / sustur
    if (this.ytPlayer && this.isYtReady && typeof this.ytPlayer.pauseVideo === 'function') {
      try {
        this.ytPlayer.pauseVideo();
        if (this.currentMediaType !== 'youtube') {
          this.ytPlayer.stopVideo();
        }
      } catch (e) {}
    }
    if (this.html5Video) {
      try {
        this.html5Video.pause();
        if (this.currentMediaType !== 'html5') {
          this.html5Video.src = '';
        }
      } catch (e) {}
    }
    if (this.embedIframe && this.currentMediaType !== 'embed') {
      this.embedIframe.src = 'about:blank';
    }

    // 2. Tüm katmanları gizle
    const idleLayer = document.getElementById('idle-player-container');
    if (idleLayer) idleLayer.classList.add('hidden');
    document.getElementById('youtube-player-container').classList.add('hidden');
    document.getElementById('html5-player-container').classList.add('hidden');
    document.getElementById('webrtc-player-container').classList.add('hidden');
    document.getElementById('embed-player-container').classList.add('hidden');

    this.mediaTypeBadge.textContent = this.currentMediaType.toUpperCase();
    this.currentMediaTitle.textContent = title || url || 'Medya Yayını';

    // Boş / Bekleme Durumu
    if (this.currentMediaType === 'idle' || (!url && this.currentMediaType !== 'webrtc')) {
      if (idleLayer) idleLayer.classList.remove('hidden');
      this.mediaTypeBadge.textContent = 'BEKLEMEDE';
      this.currentMediaTitle.textContent = '🎬 Henüz bir video veya film seçilmedi';
      this.updatePlayPauseIcon(false);
      return;
    }

    // 3. İlgili katmanı aç ve başlat
    if (this.currentMediaType === 'youtube') {
      document.getElementById('youtube-player-container').classList.remove('hidden');
      const videoId = this.extractYouTubeId(url);
      if (videoId) {
        this.pendingYtVideoId = videoId;
        if (this.ytPlayer && this.isYtReady && typeof this.ytPlayer.loadVideoById === 'function') {
          try {
            this.ytPlayer.loadVideoById(videoId, currentTime || 0);
            this.disableSubtitles();
            if (isPlaying) {
              this.userInitiatedPause = false;
              this.ytPlayer.playVideo();
            } else {
              this.userInitiatedPause = true;
              setTimeout(() => {
                if (this.ytPlayer && this.ytPlayer.pauseVideo) this.ytPlayer.pauseVideo();
              }, 200);
            }
          } catch(e) {
            this.initYouTube();
          }
        } else {
          this.initYouTube(() => {
            if (this.ytPlayer && typeof this.ytPlayer.loadVideoById === 'function') {
              this.ytPlayer.loadVideoById(videoId, currentTime || 0);
            }
            if (currentTime && this.ytPlayer.seekTo) this.ytPlayer.seekTo(currentTime, true);
            if (isPlaying) {
              this.userInitiatedPause = false;
              if (this.ytPlayer.playVideo) this.ytPlayer.playVideo();
            }
            this.disableSubtitles();
          });
        }
      }
    } else if (this.currentMediaType === 'html5') {
      document.getElementById('html5-player-container').classList.remove('hidden');
      this.loadHtml5Video(url, currentTime, isPlaying);
    } else if (this.currentMediaType === 'embed') {
      document.getElementById('embed-player-container').classList.remove('hidden');
      const finalUrl = url.startsWith('/api/proxy-embed') ? url : `/api/proxy-embed?url=${encodeURIComponent(url)}`;
      this.embedIframe.src = finalUrl;
    } else if (this.currentMediaType === 'webrtc') {
      document.getElementById('webrtc-player-container').classList.remove('hidden');
    }

    // Gömülü Iframe (Embed) ve Canlı Yayında (WebRTC) çakışan kontrolleri gizle
    const controlsLeft = document.querySelector('.controls-left');
    if (this.progressContainer) {
      if (this.currentMediaType === 'webrtc' || this.currentMediaType === 'embed') {
        this.progressContainer.style.display = 'none';
      } else {
        this.progressContainer.style.display = 'block';
      }
    }

    if (controlsLeft) {
      if (this.currentMediaType === 'embed') {
        // Embed modunda harici sitenin kendi kontrolleri kullanılacağı için sol çubuğu sadeleştir
        const playBtn = document.getElementById('ctrl-play-pause');
        const timeDisp = document.querySelector('.time-display');
        if (playBtn) playBtn.style.display = 'none';
        if (timeDisp) timeDisp.style.display = 'none';
      } else {
        const playBtn = document.getElementById('ctrl-play-pause');
        const timeDisp = document.querySelector('.time-display');
        if (playBtn) playBtn.style.display = 'flex';
        if (timeDisp) timeDisp.style.display = 'flex';
      }
    }

    this.updateMediaSession(title, isPlaying);
  }

  loadHtml5Video(url, startTime, isPlaying) {
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }

    const isM3U8 = url.includes('.m3u8');

    if (isM3U8 && typeof Hls !== 'undefined' && Hls.isSupported()) {
      this.hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true
      });
      this.hls.loadSource(url);
      this.hls.attachMedia(this.html5Video);
      this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (startTime) this.html5Video.currentTime = startTime;
        if (isPlaying) {
          this.userInitiatedPause = false;
          this.html5Video.play().catch(() => {});
        }
      });
    } else {
      this.html5Video.src = url;
      this.html5Video.load();
      if (startTime) this.html5Video.currentTime = startTime;
      if (isPlaying) {
        this.userInitiatedPause = false;
        this.html5Video.play().catch(() => {});
      }
    }

    this.applyVolume();
  }

  extractYouTubeId(url) {
    if (!url) return null;
    url = url.trim();
    if (url.length === 11 && !url.includes('/') && !url.includes('.') && !url.includes('?')) {
      return url;
    }
    try {
      if (url.includes('youtu.be/')) {
        const id = url.split('youtu.be/')[1].split(/[?#&]/)[0];
        if (id && id.length === 11) return id;
      }
      if (url.includes('youtube.com/')) {
        const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
        const v = urlObj.searchParams.get('v');
        if (v && v.length === 11) return v;
        const parts = urlObj.pathname.split('/');
        const lastPart = parts[parts.length - 1];
        if (lastPart && lastPart.length === 11) {
          return lastPart.split(/[?#&]/)[0];
        }
      }
    } catch(e) {}
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|shorts\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2] && match[2].length === 11) ? match[2] : url;
  }

  togglePlayPause() {
    const isPlaying = this.getIsPlaying();
    if (isPlaying) {
      this.userInitiatedPause = true;
      this.pause(true);
    } else {
      this.userInitiatedPause = false;
      this.play(true);
    }
  }

  play(emit = false) {
    this.userInitiatedPause = false;
    if (this.currentMediaType === 'youtube' && this.ytPlayer && this.isYtReady) {
      this.ignoreNextPlayEvent = !emit;
      this.disableSubtitles();
      this.ytPlayer.playVideo();
    } else if (this.currentMediaType === 'html5' && this.html5Video) {
      this.html5Video.play().catch(() => {});
    }

    this.updatePlayPauseIcon(true);
    this.updateMediaSession(this.currentMediaTitle.textContent, true);

    if (emit && this.isHost) {
      this.socket.emit('media-action', {
        action: 'play',
        currentTime: this.getCurrentTime()
      });
    }
  }

  pause(emit = false) {
    this.userInitiatedPause = true;
    if (this.currentMediaType === 'youtube' && this.ytPlayer && this.isYtReady) {
      this.ignoreNextPauseEvent = !emit;
      this.ytPlayer.pauseVideo();
    } else if (this.currentMediaType === 'html5' && this.html5Video) {
      this.html5Video.pause();
    }

    this.updatePlayPauseIcon(false);
    this.updateMediaSession(this.currentMediaTitle.textContent, false);

    if (emit && this.isHost) {
      this.socket.emit('media-action', {
        action: 'pause',
        currentTime: this.getCurrentTime()
      });
    }
  }

  seekTo(seconds, emit = false) {
    if (this.currentMediaType === 'youtube' && this.ytPlayer && this.isYtReady) {
      this.ytPlayer.seekTo(seconds, true);
      this.disableSubtitles();
    } else if (this.currentMediaType === 'html5' && this.html5Video) {
      this.html5Video.currentTime = seconds;
    }

    if (emit && this.isHost) {
      this.socket.emit('media-action', {
        action: 'seek',
        currentTime: seconds
      });
    }
  }

  seekRelative(deltaSeconds) {
    const cur = this.getCurrentTime();
    const dur = this.getDuration();
    const nextTime = Math.max(0, Math.min(dur, cur + deltaSeconds));
    this.seekTo(nextTime, true);
  }

  getCurrentTime() {
    if (this.currentMediaType === 'youtube' && this.ytPlayer && this.isYtReady && typeof this.ytPlayer.getCurrentTime === 'function') {
      return this.ytPlayer.getCurrentTime() || 0;
    } else if (this.currentMediaType === 'html5' && this.html5Video) {
      return this.html5Video.currentTime || 0;
    }
    return 0;
  }

  getDuration() {
    if (this.currentMediaType === 'youtube' && this.ytPlayer && this.isYtReady && typeof this.ytPlayer.getDuration === 'function') {
      return this.ytPlayer.getDuration() || 0;
    } else if (this.currentMediaType === 'html5' && this.html5Video) {
      return this.html5Video.duration || 0;
    }
    return 0;
  }

  getIsPlaying() {
    if (this.currentMediaType === 'youtube' && this.ytPlayer && this.isYtReady && typeof this.ytPlayer.getPlayerState === 'function') {
      return this.ytPlayer.getPlayerState() === YT.PlayerState.PLAYING;
    } else if (this.currentMediaType === 'html5' && this.html5Video) {
      return !this.html5Video.paused && !this.html5Video.ended;
    }
    return false;
  }

  updatePlayPauseIcon(isPlaying) {
    if (isPlaying) {
      this.playPauseIcon.className = 'fa-solid fa-pause';
    } else {
      this.playPauseIcon.className = 'fa-solid fa-play';
    }
  }

  updateProgressUI() {
    const cur = this.getCurrentTime();
    const dur = this.getDuration();

    this.currentTimeText.textContent = this.formatTime(cur);
    this.durationTimeText.textContent = this.formatTime(dur);

    if (dur > 0) {
      const pct = (cur / dur) * 100;
      this.progressCurrent.style.width = `${pct}%`;
      this.progressHandle.style.left = `${pct}%`;

      if (this.currentMediaType === 'youtube' && this.ytPlayer && this.isYtReady && typeof this.ytPlayer.getVideoLoadedFraction === 'function') {
        const loaded = this.ytPlayer.getVideoLoadedFraction() || 0;
        this.progressBuffered.style.width = `${loaded * 100}%`;
      } else if (this.currentMediaType === 'html5' && this.html5Video && this.html5Video.buffered.length > 0) {
        const end = this.html5Video.buffered.end(this.html5Video.buffered.length - 1);
        this.progressBuffered.style.width = `${(end / dur) * 100}%`;
      }
    }
  }

  formatTime(totalSeconds) {
    if (isNaN(totalSeconds) || totalSeconds < 0) return '00:00';
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = Math.floor(totalSeconds % 60);

    const pad = (n) => n.toString().padStart(2, '0');
    if (hrs > 0) {
      return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
    }
    return `${pad(mins)}:${pad(secs)}`;
  }

  initSocketEvents() {
    this.socket.on('media-changed', (mediaData) => {
      this.loadMedia(mediaData);
      window.showToast(`🎬 Yeni medya yüklendi: ${mediaData.title || 'Video'}`);
    });

    this.socket.on('media-action-broadcast', ({ action, currentTime, isPlaying }) => {
      if (action === 'play') {
        this.userInitiatedPause = false;
        this.play(false);
      } else if (action === 'pause') {
        this.userInitiatedPause = true;
        this.pause(false);
      }

      if (typeof currentTime === 'number') {
        const myTime = this.getCurrentTime();
        if (Math.abs(myTime - currentTime) > 0.8) {
          this.seekTo(currentTime, false);
        }
      }
    });

    this.socket.on('sync-time-update', ({ currentTime, isPlaying }) => {
      if (this.isHost) return;

      const myTime = this.getCurrentTime();
      const delta = Math.abs(myTime - currentTime);

      if (delta > 1.5) {
        this.seekTo(currentTime, false);
      }

      const myIsPlaying = this.getIsPlaying();
      if (isPlaying && !myIsPlaying) {
        this.userInitiatedPause = false;
        this.play(false);
      } else if (!isPlaying && myIsPlaying) {
        this.userInitiatedPause = true;
        this.pause(false);
      }
    });

    this.socket.on('sync-force', ({ currentTime, isPlaying }) => {
      if (typeof currentTime === 'number') {
        this.seekTo(currentTime, false);
      }
      if (isPlaying) {
        this.userInitiatedPause = false;
        this.play(false);
      } else {
        this.userInitiatedPause = true;
        this.pause(false);
      }
      window.showToast('⚡ Host ile anında eşitlendi!');
    });

    // Host için: İzleyici "Yeniden Eşitle" istediğinde milisaniyelik süreyi anında bildir
    this.socket.on('host-ping-time-for-guest', ({ guestId }) => {
      if (this.isHost) {
        this.socket.emit('host-pong-time', {
          guestId,
          currentTime: this.getCurrentTime(),
          isPlaying: this.getIsPlaying()
        });
      }
    });

    this.socket.on('settings-updated', (settings) => {
      this.hostOnlyControl = settings.hostOnlyControl;
      this.updateHostLockIndicator();
    });
  }

  // -----------------------------------------------------------
  // MOBİL & PC ARKA PLANDA ÇALMA VE KİLİT EKRANI (KeepAlive)
  // -----------------------------------------------------------
  setupBackgroundPlayback() {
    // 1. MediaSession API (Android/iOS Kilit ekranı ve bildirim kontrolleri)
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.setActionHandler('play', () => this.play(true));
        navigator.mediaSession.setActionHandler('pause', () => this.pause(true));
        navigator.mediaSession.setActionHandler('seekto', (details) => {
          if (details.seekTime !== undefined) this.seekTo(details.seekTime, true);
        });
      } catch(e) {}
    }

    // 2. Tarayıcı arka plana geçtiğinde / ekran kilitlendiğinde sesin kesilmesini engelle
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        if (!this.userInitiatedPause) {
          if (this.html5Video && this.html5Video.paused) {
            this.html5Video.play().catch(() => {});
          }
          if (this.ytPlayer && typeof this.ytPlayer.playVideo === 'function') {
            this.ytPlayer.playVideo();
          }
          if (this.webrtcVideo && this.webrtcVideo.paused) {
            this.webrtcVideo.play().catch(() => {});
          }
        }
      }
    });

    window.addEventListener('blur', () => {
      if (!this.userInitiatedPause) {
        if (this.ytPlayer && typeof this.ytPlayer.playVideo === 'function') {
          this.ytPlayer.playVideo();
        }
      }
    });

    // 3. Mobil ses oturumunu güvenle aktifleştir (Sessiz ve parazitsiz)
    const unlockAudio = () => {
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) {
          const ctx = new AudioContext();
          if (ctx.state === 'suspended') ctx.resume();
        }
      } catch(e) {}
      document.removeEventListener('click', unlockAudio);
      document.removeEventListener('touchstart', unlockAudio);
    };

    document.addEventListener('click', unlockAudio, { once: true });
    document.addEventListener('touchstart', unlockAudio, { once: true });
  }

  updateMediaSession(title, isPlaying) {
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: title || 'SyncParty Yayını',
          artist: 'SyncParty Birlikte İzle',
          album: 'Canlı Yayın',
          artwork: [
            { src: 'https://cdn-icons-png.flaticon.com/512/3845/3845868.png', sizes: '512x512', type: 'image/png' }
          ]
        });
        navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
      } catch(e) {}
    }
  }

  setHost(isHost) {
    this.isHost = isHost;
    this.updateHostLockIndicator();
  }

  updateHostLockIndicator() {
    if (this.isHost) {
      this.hostLockTag.innerHTML = `<i class="fa-solid fa-crown"></i> <span>Oda Sahibi (Kontrol Sizde)</span>`;
      this.hostLockTag.style.borderColor = '#10b981';
      this.hostLockTag.style.color = '#10b981';
      this.playPauseBtn.disabled = false;
    } else {
      if (this.hostOnlyControl) {
        this.hostLockTag.innerHTML = `<i class="fa-solid fa-lock"></i> <span>Host Kilidi (İzleyici Modu)</span>`;
        this.hostLockTag.style.borderColor = 'var(--border-red)';
        this.hostLockTag.style.color = 'var(--accent-red)';
      } else {
        this.hostLockTag.innerHTML = `<i class="fa-solid fa-unlock"></i> <span>Ortak Kontrol</span>`;
        this.hostLockTag.style.borderColor = '#00f2fe';
        this.hostLockTag.style.color = '#00f2fe';
      }
    }
  }
}
