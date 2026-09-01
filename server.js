const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');
const axios = require('axios');
const compression = require('compression');

const app = express();
const server = http.createServer(app);

// Socket.io yapılandırması (Heartbeat & Keepalive - 30dk kopma önleyici)
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  pingInterval: 10000, // 10 saniyede bir ping
  pingTimeout: 30000,  // 30 saniye yanıtsız kalırsa yeniden bağlan
  connectTimeout: 45000,
  maxHttpBufferSize: 1e8 // 100 MB buffer
});

app.use(compression());
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1h',
  etag: true
}));

// Oda Sayfası Rotaları (Sayfa Yenilemede 404 Almayı ve Oda Kaybını Kökten Önler)
app.get('/room/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'room.html'));
});

app.get('/room', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'room.html'));
});

// Oda Verileri (Hafıza Yönetimi)
const rooms = new Map();

/**
 * Oda Oluşturma veya Getirme Yardımcısı
 */
function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      id: roomId,
      hostId: null,
      hostToken: null,
      users: new Map(),
      media: {
        type: 'idle', // Boş sinema bekleme sahnesi (İstenmeyen videolar otomatik açılmaz)
        url: '',
        title: '🎬 Henüz bir video veya film seçilmedi',
        currentTime: 0,
        isPlaying: false,
        lastUpdated: Date.now()
      },
      settings: {
        hostOnlyControl: true, // Karşı taraf ilerletemesin / durduramasın
        allowChat: true
      },
      createdAt: Date.now(),
      lastActive: Date.now()
    });
  }
  const room = rooms.get(roomId);
  room.lastActive = Date.now();
  return room;
}

// -------------------------------------------------------------
// GELİŞMİŞ AKILLI PROXY & BOT KORUMASI ATLATICI
// -------------------------------------------------------------

/**
 * 1. TAM TERS PROXY (Full Reverse Proxy) — /api/proxy-embed
 * Cloudflare korumalı filmmakinesi.to, dizibox, hdfilm vb. tüm siteler için.
 * - Cloudflare yoksa: sayfayı tam olarak proxy'ler, tüm alt kaynaklar dahil.
 * - Cloudflare varsa: tarayıcı doğrudan siteyi açar (CF challenge browser'da çözülür).
 */
app.get('/api/proxy-embed', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('URL parametresi gereklidir.');

  let parsedUrl;
  try { parsedUrl = new URL(targetUrl); } catch(e) { return res.status(400).send('Geçersiz URL'); }

  const origin = `${parsedUrl.protocol}//${parsedUrl.host}`;
  const proxyBase = `/api/proxy-embed?url=`;

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.6613.120 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'identity',
    'Referer': origin + '/',
    'sec-ch-ua': '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'none',
    'sec-fetch-user': '?1',
    'Upgrade-Insecure-Requests': '1',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
  };

  if (req.headers.cookie) headers['Cookie'] = req.headers.cookie;

  // Güvenlik başlıklarını kaldır
  const removeSecHeaders = () => {
    res.removeHeader('X-Frame-Options');
    res.removeHeader('Content-Security-Policy');
    res.removeHeader('X-Content-Type-Options');
    res.removeHeader('Strict-Transport-Security');
    res.setHeader('Access-Control-Allow-Origin', '*');
  };

  // Cloudflare koruması varsa tarayıcıya direkt yönlendir (challenge browser'da çözülür)
  const sendDirectBrowserPage = () => {
    removeSecHeaders();
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8">
<script>
  // Frame/top bypass
  try {
    Object.defineProperty(window,'top',{get:()=>window.self,configurable:true});
    Object.defineProperty(window,'parent',{get:()=>window.self,configurable:true});
    window.open=()=>null;
  } catch(e){}
</script>
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  html,body{width:100%;min-height:100%;background:#000;overflow-x:hidden;overflow-y:auto;-webkit-overflow-scrolling:touch;}
  iframe{width:100%;height:100vh;min-height:100%;border:none;display:block;}
  .loader{position:fixed;inset:0;background:#091319;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#d9bf87;font-family:sans-serif;gap:16px;transition:opacity 0.5s;z-index:99;}
  .loader.fade{opacity:0;pointer-events:none;}
  .spinner{width:44px;height:44px;border:3px solid rgba(217,191,135,0.2);border-top-color:#d9bf87;border-radius:50%;animation:spin 0.8s linear infinite;}
  @keyframes spin{to{transform:rotate(360deg)}}
</style>
</head>
<body>
<div class="loader" id="loader">
  <div class="spinner"></div>
  <div style="font-size:15px;font-weight:600;">Film sitesi açılıyor...</div>
  <div style="font-size:12px;color:#7fa197;">Cloudflare doğrulaması tarayıcıda çözülüyor</div>
</div>
<iframe id="directFrame" src="${targetUrl}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-storage-access-by-user-activation allow-top-navigation-by-user-activation" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen></iframe>
<script>
  const frame = document.getElementById('directFrame');
  const loader = document.getElementById('loader');
  frame.onload = () => { setTimeout(() => loader.classList.add('fade'), 800); };
  setTimeout(() => loader.classList.add('fade'), 8000);
</script>
</body></html>`);
  };

  try {
    const response = await axios.get(targetUrl, {
      headers,
      responseType: 'arraybuffer',
      timeout: 15000,
      maxRedirects: 10,
      validateStatus: () => true,
    });

    const contentType = (response.headers['content-type'] || 'text/html').toLowerCase();
    const status = response.status;

    // Cloudflare bot koruması tespiti (403/503 + cf-ray header veya cf_clearance gerektiriyor)
    const isCFBlock = (status === 403 || status === 503) && (
      response.headers['cf-ray'] || response.headers['cf-mitigated'] ||
      (response.data && response.data.toString().includes('cf-browser-verification')) ||
      (response.data && response.data.toString().includes('Just a moment'))
    );

    if (isCFBlock) {
      console.log('[Proxy] Cloudflare engeli tespit edildi, tarayıcıya direkt yönlendiriliyor:', targetUrl);
      return sendDirectBrowserPage();
    }

    removeSecHeaders();
    res.setHeader('Content-Type', contentType.includes('charset') ? contentType : contentType + '; charset=utf-8');

    // Sadece HTML sayfalarını dönüştür
    if (contentType.includes('text/html')) {
      let html = response.data.toString('utf8');

      // Cloudflare JS challenge metinleri varsa direkt yönlendir
      if (html.includes('Just a moment') || html.includes('cf-browser-verification') || html.includes('challenge-platform')) {
        return sendDirectBrowserPage();
      }

      // Frame-Busting scriptlerini etkisiz kıl
      html = html.replace(/top\.location\s*[=!]/gi, m => m.includes('=') ? '/* fb */ void(0)//' : '/* fb */ true ||');
      html = html.replace(/window\.top\s*!==\s*window\.self/gi, 'false');
      html = html.replace(/top\s*!==\s*self/gi, 'false');
      html = html.replace(/top\.location\.href/gi, 'window.location.href');
      html = html.replace(/parent\.location/gi, 'window.location');
      html = html.replace(/top\.location\s*=/gi, '/* fb */ window.location =');

      // Tüm mutlak ve göreli URL'leri, iframeleri ve kaynakları proxy üzerinden yeniden yaz
      const rewriteUrl = (url) => {
        if (!url || url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('#') || url.startsWith('javascript:')) return url;
        if (url.startsWith('//')) url = parsedUrl.protocol + url;
        else if (url.startsWith('/')) url = origin + url;
        else if (!url.startsWith('http')) url = origin + parsedUrl.pathname.replace(/\/[^/]*$/, '/') + url;
        return proxyBase + encodeURIComponent(url);
      };

      html = html.replace(/\b(href|src|action|data-src|data-url|data-player|data-embed)=["']([^"'#][^"']*?)["']/gi, (match, attr, url) => {
        return `${attr}="${rewriteUrl(url)}"`;
      });

      html = html.replace(/url\(["']?(https?:\/\/[^"')]+)["']?\)/gi, (match, url) => {
        return `url("${rewriteUrl(url)}")`;
      });

      const inject = `
<script>
  try {
    Object.defineProperty(window, 'top', { get: () => window.self, configurable: true });
    Object.defineProperty(window, 'parent', { get: () => window.self, configurable: true });
    window.open = () => null;
  } catch(e) {}

  // Video Oynatma, Durdurma ve Sarmayı Kökten Engelleyen Güvenlik Motoru
  // Başlatan, Durduran ve İlerleten Sadece Host'tur; İzleyici Yalnızca Sayfayı Kaydırabilir
  (function() {
    let lastValidTime = 0;
    let isInternalSetting = false;

    try {
      const originalCurrentTime = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
      if (originalCurrentTime && originalCurrentTime.set) {
        Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
          get: function() {
            return originalCurrentTime.get.call(this);
          },
          set: function(val) {
            if (isInternalSetting) {
              return originalCurrentTime.set.call(this, val);
            }
            const current = originalCurrentTime.get.call(this);
            if (Math.abs(val - current) > 0.8) {
              return;
            }
            return originalCurrentTime.set.call(this, val);
          },
          configurable: true
        });
      }
    } catch(e) {}

    try {
      if (HTMLMediaElement.prototype.fastSeek) {
        HTMLMediaElement.prototype.fastSeek = function() {};
      }
    } catch(e) {}

    document.addEventListener('timeupdate', function(e) {
      if (e.target && e.target.tagName === 'VIDEO' && !isInternalSetting) {
        lastValidTime = e.target.currentTime;
      }
    }, true);

    document.addEventListener('seeking', function(e) {
      const vid = e.target;
      if (vid && vid.tagName === 'VIDEO' && !isInternalSetting) {
        const diff = Math.abs(vid.currentTime - lastValidTime);
        if (diff > 0.8) {
          isInternalSetting = true;
          vid.currentTime = lastValidTime;
          setTimeout(() => { isInternalSetting = false; }, 80);
        }
      }
    }, true);

    // Klavye kısayolları ile oynat/duraklat/sar tuşlarını engelle (Space, Ok Tuşları, K, J, L)
    window.addEventListener('keydown', function(e) {
      if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) return;
      const blockedKeys = [' ', 'Space', 'k', 'K', 'j', 'J', 'l', 'L', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
      if (blockedKeys.includes(e.key) || blockedKeys.includes(e.code)) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
  })();
</script>
<style>
  html, body { 
    width: 100% !important; 
    min-height: 100% !important; 
    margin: 0 !important; 
    padding: 0 !important; 
    background: #000 !important; 
    overflow-x: hidden !important; 
    overflow-y: auto !important; 
    -webkit-overflow-scrolling: touch !important; 
  }

  /* Video Oynatıcı Alanını (Oynat, Duraklat, İlerlet) Kökten Kilitle - Kontrol Sadece Host'tadır */
  /* İzleyici Sadece Sayfada Aşağı/Yukarı Kaydırma Yapabilir */
  video, #player, .jwplayer, .video-js, .plyr, .player-container, 
  [id*="player"], [class*="player"], .dplayer, .artplayer-app,
  [class*="video-wrap"], [id*="video-wrap"], [class*="media-player"],
  .jw-controls, .vjs-control-bar, .plyr__controls, [class*="control-bar"], [class*="controls"],
  .jw-slider-time, .vjs-progress-control, .plyr__progress, .timeline-bar,
  .player-progress, [class*="progress-bar"], [class*="scrubber"], [class*="seek-bar"],
  [class*="timeline"], [id*="progress-bar"], [id*="scrubber"], [id*="seek-bar"],
  .jw-display-icon-rewind, .jw-display-icon-forward, [class*="forward-10"], [class*="rewind-10"],
  [class*="skip-forward"], [class*="skip-back"], [aria-label*="Seek"], [aria-label*="Sar"],
  .vjs-play-progress, .vjs-progress-holder, .jw-progress, .jw-buffer,
  [class*="progress-holder"], [class*="progress-container"], [id*="progress-holder"],
  .art-control-progress, .dplayer-bar-wrap, .dplayer-bar, .plyr__progress__buffer,
  [class*="range"], input[type="range"][class*="seek"], input[type="range"][class*="progress"] {
    pointer-events: none !important;
    user-select: none !important;
    touch-action: pan-y !important;
  }

  .ad-box, .banner-ad, [class*="reklam"], [id*="reklam"], #popunder, .popunder, [class*="popup"], [id*="popup"],
  .cookie-notice, .gdpr-bar, .notice-bar { display: none !important; }
</style>`;

      if (html.includes('<head>')) {
        html = html.replace('<head>', '<head>' + inject);
      } else if (html.includes('<html')) {
        html = html.replace(/<html[^>]*>/, m => m + inject);
      } else {
        html = inject + html;
      }

      return res.send(html);
    }

    // HTML olmayan kaynaklar (CSS, JS, images) — doğrudan stream et
    res.status(response.status).send(Buffer.from(response.data));

  } catch (error) {
    console.error('[Proxy] Hata:', error.message);
    // Ağ hatası veya timeout — tarayıcıya direkt yönlendir
    sendDirectBrowserPage();
  }
});

/**
 * 2. Gelişmiş Video & Iframe Player Çıkarıcı (/api/extract-video)
 * DiziBox, HDFilmcehennemi, VidMoly, Upstream, FileLions vb. sayfaları tarar.
 */
app.get('/api/extract-video', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).json({ success: false, message: 'URL gerekli' });

  try {
    const origin = new URL(targetUrl).origin;
    const fetchHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.6613.120 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8',
      'Referer': origin,
      'sec-fetch-mode': 'navigate',
      'sec-fetch-site': 'none',
    };

    const response = await axios.get(targetUrl, {
      headers: fetchHeaders, timeout: 15000, maxRedirects: 8, validateStatus: () => true,
    });

    let html = response.data;
    if (typeof html !== 'string') html = JSON.stringify(html);

    // Doğrudan .m3u8 veya .mp4 tespiti
    const m3u8Match = html.match(/(https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*)/i);
    const mp4Match = html.match(/(https?:\/\/[^"'\s\\]+\.mp4[^"'\s\\]*)/i);

    if (m3u8Match) return res.json({ success: true, streamUrl: m3u8Match[1].replace(/\\/g, ''), type: 'hls' });
    if (mp4Match) return res.json({ success: true, streamUrl: mp4Match[1].replace(/\\/g, ''), type: 'mp4' });

    // Sayfadaki gömülü video player iframe'lerini tara
    const iframeMatches = [...html.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)];
    const playerKeywords = ['vidmoly','upstream','closeload','filelions','streamwish','dood','player','embed','vidsrc','vk.com','superembed','fembed','streamtape','mixdrop'];
    for (const match of iframeMatches) {
      let iframeUrl = match[1];
      if (iframeUrl.startsWith('//')) iframeUrl = 'https:' + iframeUrl;
      else if (iframeUrl.startsWith('/')) iframeUrl = origin + iframeUrl;
      if (!iframeUrl.startsWith('http')) continue;
      if (playerKeywords.some(k => iframeUrl.includes(k))) {
        return res.json({ success: true, streamUrl: `/api/proxy-embed?url=${encodeURIComponent(iframeUrl)}`, type: 'embed', isDirectPlayer: true });
      }
    }

    // Genel iframe varsa kullan
    for (const match of iframeMatches) {
      let iframeUrl = match[1];
      if (iframeUrl.startsWith('//')) iframeUrl = 'https:' + iframeUrl;
      else if (iframeUrl.startsWith('/')) iframeUrl = origin + iframeUrl;
      if (iframeUrl.startsWith('http') && !iframeUrl.includes('google') && !iframeUrl.includes('disqus') && !iframeUrl.includes('facebook')) {
        return res.json({ success: true, streamUrl: `/api/proxy-embed?url=${encodeURIComponent(iframeUrl)}`, type: 'embed' });
      }
    }

    // Her şey başarısız → tam sayfayı proxy'le
    return res.json({ success: true, streamUrl: `/api/proxy-embed?url=${encodeURIComponent(targetUrl)}`, type: 'embed' });
  } catch (err) {
    return res.json({ success: true, streamUrl: `/api/proxy-embed?url=${encodeURIComponent(targetUrl)}`, type: 'embed' });
  }
});

/**
 * 3. Medya Akışı Proxy'si (/api/proxy-media)
 * Video akışlarını (MP4/HLS/m3u8) CORS korumasını atlatıp istemciye stream eder.
 */
app.get('/api/proxy-media', async (req, res) => {
  const mediaUrl = req.query.url;
  if (!mediaUrl) {
    return res.status(400).send('Medya URL parametresi gereklidir.');
  }

  try {
    const range = req.headers.range;
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': new URL(mediaUrl).origin
    };

    if (range) {
      headers['Range'] = range;
    }

    const response = await axios({
      method: 'GET',
      url: mediaUrl,
      headers: headers,
      responseType: 'stream',
      timeout: 20000
    });

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', response.headers['content-type'] || 'video/mp4');
    
    if (response.headers['content-length']) {
      res.setHeader('Content-Length', response.headers['content-length']);
    }
    if (response.headers['content-range']) {
      res.setHeader('Content-Range', response.headers['content-range']);
      res.status(206);
    }

    response.data.pipe(res);
  } catch (error) {
    res.status(500).send('Medya akışı proxy hatası: ' + error.message);
  }
});

// -------------------------------------------------------------
// REAL-TIME SOCKET.IO ETKİLEŞİM YÖNETİMİ
// -------------------------------------------------------------

io.on('connection', (socket) => {
  let currentRoomId = null;
  let currentUser = null;

  // 15 saniyede bir özel heartbeat kontrolü (30dk sınırsız oturum)
  const heartbeatInterval = setInterval(() => {
    socket.emit('heartbeat-ping', { timestamp: Date.now() });
  }, 15000);

  socket.on('heartbeat-pong', () => {
    // Bağlantı aktif
  });

  // Odaya Katılma / Oluşturma (Kalıcı Host Kimlik Kontrolü)
  socket.on('join-room', ({ roomId, username, avatarColor, userToken, isCreator }) => {
    currentRoomId = roomId.trim().toLowerCase();
    const room = getOrCreateRoom(currentRoomId);

    let isHost = false;

    // 1. Oda yeni mi veya sahibi geri mi döndü? (F5 ve Kodla Yeniden Giriş Korumalı)
    if (room.hostToken && room.hostToken === userToken) {
      room.hostId = socket.id;
      isHost = true;
      if (room.hostDisconnectTimer) {
        clearTimeout(room.hostDisconnectTimer);
        room.hostDisconnectTimer = null;
      }
    } else if (isCreator) {
      // Odayı oluşturan kişi odaya geri döndü (F5 veya kodla giriş) - Hostluğu Geri Ver
      room.hostToken = userToken;
      room.hostId = socket.id;
      isHost = true;
      if (room.hostDisconnectTimer) {
        clearTimeout(room.hostDisconnectTimer);
        room.hostDisconnectTimer = null;
      }
    } else if (!room.hostToken || room.users.size === 0) {
      room.hostToken = userToken;
      room.hostId = socket.id;
      isHost = true;
      if (room.hostDisconnectTimer) {
        clearTimeout(room.hostDisconnectTimer);
        room.hostDisconnectTimer = null;
      }
    } else {
      // Kesinlikle İZLEYİCİ (Hostluk gasp edilemez)
      isHost = false;
    }

    currentUser = {
      id: socket.id,
      userToken: userToken,
      username: username || `İzleyici ${Math.floor(1000 + Math.random() * 9000)}`,
      avatarColor: avatarColor || '#b3001e',
      isHost: isHost
    };

    room.users.set(socket.id, currentUser);
    socket.join(currentRoomId);

    // Eğer Host yeniden bağlandıysa odaya teyit et
    if (isHost) {
      io.to(currentRoomId).emit('host-transferred', {
        newHostId: socket.id,
        newHostName: currentUser.username
      });
    }

    // Kullanıcıya mevcut oda durumunu gönder
    socket.emit('room-joined', {
      roomId: currentRoomId,
      user: currentUser,
      hostId: room.hostId,
      media: room.media,
      settings: room.settings,
      users: Array.from(room.users.values())
    });

    // Odadaki diğer kullanıcılara yeni katılımcıyı bildir
    socket.to(currentRoomId).emit('user-joined', {
      user: currentUser,
      users: Array.from(room.users.values())
    });

    console.log(`[+] ${currentUser.username} (${socket.id}) odaya katıldı: ${currentRoomId} (Host: ${isHost})`);
  });

  // Medya Kaynağı Değiştirme (Sadece Host veya İzinli Kullanıcı)
  socket.on('change-media', ({ type, url, title }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;

    // Yetki kontrolü: Yalnızca Oda Sahibi değiştirebilir (hostOnlyControl açıksa)
    if (room.settings.hostOnlyControl && room.hostId !== socket.id) {
      socket.emit('action-error', { message: 'Yalnızca oda sahibi video kaynağını değiştirebilir!' });
      return;
    }

    room.media = {
      type: type || 'youtube',
      url: url,
      title: title || 'Medya Yayını',
      currentTime: 0,
      isPlaying: true,
      lastUpdated: Date.now()
    };

    io.to(currentRoomId).emit('media-changed', room.media);
    console.log(`[Media] ${currentRoomId} odasında medya değiştirildi: ${url} (${type})`);
  });

  // Oynat / Duraklat / Sar (Host Eylemleri)
  socket.on('media-action', ({ action, currentTime }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;

    // Karşı taraf ilerletemesin / durduramasın kuralı
    if (room.settings.hostOnlyControl && room.hostId !== socket.id) {
      // İzleyiciye senkronizasyonu bozmaması için mevcut host durumunu geri yansıt
      socket.emit('sync-force', {
        currentTime: room.media.currentTime,
        isPlaying: room.media.isPlaying
      });
      return;
    }

    if (action === 'play') {
      room.media.isPlaying = true;
    } else if (action === 'pause') {
      room.media.isPlaying = false;
    }

    if (typeof currentTime === 'number') {
      room.media.currentTime = currentTime;
    }
    room.media.lastUpdated = Date.now();

    // Tüm odadaki izleyicilere ilet
    socket.to(currentRoomId).emit('media-action-broadcast', {
      action,
      currentTime: room.media.currentTime,
      isPlaying: room.media.isPlaying,
      hostTimestamp: Date.now()
    });
  });

  // Host Periyodik Zaman Senkronizasyonu (Sync Heartbeat)
  socket.on('host-sync-heartbeat', ({ currentTime, isPlaying }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;

    if (room.hostId === socket.id) {
      room.media.currentTime = currentTime;
      room.media.isPlaying = isPlaying;
      room.media.lastUpdated = Date.now();

      // İzleyicilere yumuşak drift senkronizasyonu yolla
      socket.to(currentRoomId).emit('sync-time-update', {
        currentTime,
        isPlaying,
        timestamp: Date.now()
      });
    }
  });

  // İzleyici "Host İle Yeniden Eşitle" İstediğinde (Anında Eşitleme)
  socket.on('host-action', ({ action }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;

    if (action === 'request-sync') {
      let liveTime = room.media.currentTime;
      if (room.media.isPlaying && room.media.lastUpdated) {
        const elapsed = (Date.now() - room.media.lastUpdated) / 1000;
        liveTime += elapsed;
      }

      // 1. Sunucu hesapladığı tahmini süreyi ve o anki medyayı anında izleyiciye iletir
      socket.emit('sync-force', {
        currentTime: liveTime,
        isPlaying: room.media.isPlaying,
        media: room.media
      });

      // 2. Host'tan anlık süreyi ve ekran akışını talep et
      if (room.hostId && room.hostId !== socket.id) {
        io.to(room.hostId).emit('host-ping-time-for-guest', { guestId: socket.id });
        io.to(room.hostId).emit('guest-needs-stream', { guestId: socket.id });
      }
    }
  });

  socket.on('host-pong-time', ({ guestId, currentTime, isPlaying }) => {
    if (guestId) {
      io.to(guestId).emit('sync-force', {
        currentTime,
        isPlaying
      });
    }
  });

  // Oda Ayarı Değiştirme (Host Only Kontrol Aç/Kapa)
  socket.on('toggle-host-control', ({ hostOnlyControl }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room || room.hostId !== socket.id) return;

    room.settings.hostOnlyControl = Boolean(hostOnlyControl);
    io.to(currentRoomId).emit('settings-updated', room.settings);
  });

  // Canlı Sohbet Mesajı (Yanıt Verme / Quote Destekli)
  socket.on('chat-message', ({ text, replyTo }) => {
    if (!currentRoomId || !text) return;
    const trimmed = text.trim();
    if (trimmed.length === 0) return;

    const room = rooms.get(currentRoomId);
    const user = currentUser || (room && room.users ? room.users.get(socket.id) : null) || {
      username: 'İzleyici',
      avatarColor: '#b3001e',
      isHost: room && room.hostId === socket.id
    };

    const messageData = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      userId: socket.id,
      username: user.username,
      avatarColor: user.avatarColor,
      isHost: user.isHost,
      text: trimmed,
      replyTo: replyTo ? {
        id: replyTo.id,
        username: replyTo.username,
        text: replyTo.text
      } : null,
      time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
      timestamp: Date.now()
    };

    io.to(currentRoomId).emit('chat-message-broadcast', messageData);
  });

  // Rave Tarzı Uçuşan Reaksiyon Gönderme (🔥, ❤️, 😂 vb.)
  socket.on('send-reaction', ({ emoji }) => {
    if (!currentRoomId || !emoji) return;

    io.to(currentRoomId).emit('reaction-broadcast', {
      emoji,
      userId: socket.id,
      username: currentUser ? currentUser.username : 'Birisi',
      color: currentUser ? currentUser.avatarColor : '#ff1e56',
      timestamp: Date.now()
    });
  });

  // WebRTC Sinyalleşmesi (Ekran & Sekme Sesi Paylaşımı)
  socket.on('webrtc-signal', ({ targetId, signal, type }) => {
    if (targetId) {
      io.to(targetId).emit('webrtc-signal', { senderId: socket.id, signal, type });
    } else if (currentRoomId) {
      socket.to(currentRoomId).emit('webrtc-signal', { senderId: socket.id, signal, type });
    }
  });

  // Ekran Paylaşımı Başlatma / Durdurma Bildirimi
  socket.on('screenshare-status', ({ active }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    // hostId kontrolü (isHost flag'ine güvenme — sadece server'ın tuttuğu hostId'e güven)
    if (!room || room.hostId !== socket.id) return;

    if (active) {
      room.media.type = 'webrtc';
      room.media.url = 'screenshare-live';
      room.media.title = '📺 Canlı Ekran / Film Yayını';
    } else {
      room.media.type = 'idle';
      room.media.url = '';
      room.media.title = '🎬 Henüz bir video veya film seçilmedi';
    }

    // Sadece diğer kullanıcılara bildir (host kendisi zaten biliyor)
    socket.to(currentRoomId).emit('screenshare-status-update', {
      active,
      media: room.media
    });
    console.log(`[ScreenShare] ${active ? 'Başladı' : 'Bitti'}: Oda ${currentRoomId}, Host: ${socket.id}`);
  });

  // Yeni Canvas Kare Rölesi (host -> tüm izleyiciler, 0 Gecikme volatile emit)
  socket.on('screenshare-frame', (chunk) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    const isRoomHost = room.hostId === socket.id;
    if (!isRoomHost) return;
    socket.to(currentRoomId).volatile.emit('screenshare-frame', chunk);
  });

  // PCM Ses Rölesi (host -> tüm izleyiciler, 0 Gecikme volatile emit)
  socket.on('screenshare-audio', (audioData) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    if (room.hostId !== socket.id) return;
    socket.to(currentRoomId).volatile.emit('screenshare-audio', audioData);
  });

  // İzleyici akış talep ettiğinde host'a bildir
  const handleGuestNeedsStream = () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (room && room.hostId && room.hostId !== socket.id) {
      console.log(`[ScreenShare] İzleyici akış talep etti: ${socket.id} -> Host: ${room.hostId}`);
      io.to(room.hostId).emit('guest-needs-stream', { guestId: socket.id });
    }
  };
  socket.on('guest-needs-stream', handleGuestNeedsStream);
  socket.on('request-screenshare-stream', handleGuestNeedsStream); // geriye dönük uyumluluk

  // Ayrılma & Bağlantı Kopması (Host Yenileme Koruması)
  socket.on('disconnect', () => {
    clearInterval(heartbeatInterval);

    if (currentRoomId && rooms.has(currentRoomId)) {
      const room = rooms.get(currentRoomId);
      room.users.delete(socket.id);

      console.log(`[-] ${currentUser ? currentUser.username : socket.id} ayrıldı: ${currentRoomId}`);

      // Eğer ayrılan kişi Host ise, 10 dakika bekle (Sayfa yenilemede izleyici host olmasın!)
      if (room.hostId === socket.id) {
        room.hostDisconnectTimer = setTimeout(() => {
          if (rooms.has(currentRoomId)) {
            const currentRoom = rooms.get(currentRoomId);
            if (currentRoom.users.size > 0 && currentRoom.hostId === socket.id) {
              const nextHost = currentRoom.users.values().next().value;
              currentRoom.hostId = nextHost.id;
              nextHost.isHost = true;

              io.to(currentRoomId).emit('host-transferred', {
                newHostId: nextHost.id,
                newHostName: nextHost.username
              });
            }
          }
        }, 600000); // 10 Dakika (Sayfa yenilemede hostluk asla izleyiciye geçmez)
      }

      // Odadakilere güncelleme gönder
      io.to(currentRoomId).emit('user-left', {
        userId: socket.id,
        users: Array.from(room.users.values())
      });

      // Oda tamamen boşaldıysa 6 saat sonra temizle (oda kodu ve geçmiş korunur)
      if (room.users.size === 0) {
        setTimeout(() => {
          if (rooms.has(currentRoomId) && rooms.get(currentRoomId).users.size === 0) {
            rooms.delete(currentRoomId);
            console.log(`[x] Boş oda silindi: ${currentRoomId}`);
          }
        }, 21600000); // 6 saat
      }
    }
  });
});

// SPA / Rota Yönlendirmeleri
app.get('/room/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'room.html'));
});

const DEFAULT_PORT = parseInt(process.env.PORT, 10) || 3000;

function startServer(port) {
  server.listen(port, () => {
    console.log(`
  ======================================================
  🔥 SYNCWAVE / RAVE WATCH PARTY SUNUCUSU BAŞLATILDI 🔥
  ======================================================
  🚀 Web Adresi: http://localhost:${port}
  📡 WebSocket: Aktif (Heartbeat 15s - Zaman aşımı korumalı)
  🛡️ Akıllı Proxy: Aktif (/api/proxy-embed, /api/proxy-media)
  🎥 WebRTC Ekran Paylaşımı: Hazır
  ======================================================
    `);
  }).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`⚠️ Port ${port} kullanımda, Port ${port + 1} deneniyor...`);
      startServer(port + 1);
    } else {
      console.error('Sunucu Başlatma Hatası:', err);
    }
  });
}

startServer(DEFAULT_PORT);

