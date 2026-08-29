const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');
const axios = require('axios');

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

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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
 * 1. Evrensel Iframe Embed Proxy'si (/api/proxy-embed)
 * X-Frame-Options, CSP, Frame-Busting scriptlerini ve Cloudflare/WAF başlıklarını temizler.
 */
app.get('/api/proxy-embed', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).send('URL parametresi gereklidir.');
  }

  try {
    const parsedUrl = new URL(targetUrl);
    const origin = `${parsedUrl.protocol}//${parsedUrl.host}`;

    const response = await axios.get(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
        'Referer': origin,
        'Origin': origin,
        'sec-ch-ua': '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'iframe',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'cross-site',
        'Upgrade-Insecure-Requests': '1'
      },
      responseType: 'text',
      timeout: 25000,
      maxRedirects: 8
    });

    let html = response.data;

    // Frame-Busting Korumasını Kökten Temizle
    html = html.replace(/top\.location\s*=/gi, '/* anti-frame */ window.location =');
    html = html.replace(/window\.top\s*!==\s*window\.self/gi, 'false');
    html = html.replace(/top\s*!==\s*self/gi, 'false');
    html = html.replace(/top\.location\.href/gi, 'window.location.href');
    html = html.replace(/parent\.location/gi, 'window.location');

    // Güvenlik kısıtlamalarını kaldıran başlıklar
    res.removeHeader('X-Frame-Options');
    res.removeHeader('Content-Security-Policy');
    res.removeHeader('X-Content-Type-Options');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Base tag & Reklam/Popup Engelleyici Script & Video %100 Genişletici
    const injectScripts = `<base href="${targetUrl}">
    <script>
      try {
        Object.defineProperty(window, 'top', { get: function() { return window.self; } });
        Object.defineProperty(window, 'parent', { get: function() { return window.self; } });
        window.open = function() { return null; };
      } catch(e) {}
    </script>
    <style>
      html, body { width: 100% !important; height: 100% !important; margin: 0 !important; padding: 0 !important; background: #000 !important; overflow: hidden !important; }
      iframe, video, #player, .jwplayer, .video-js, .plyr, .player-container { width: 100% !important; height: 100% !important; max-width: 100vw !important; max-height: 100vh !important; }
      iframe[src*="ad"], .ad-box, .banner-ad, [class*="reklam"], [id*="reklam"], #popunder, .popunder, [class*="popup"] { display: none !important; opacity: 0 !important; pointer-events: none !important; }
    </style>`;

    if (html.includes('<head>')) {
      html = html.replace('<head>', `<head>${injectScripts}`);
    } else {
      html = `${injectScripts}${html}`;
    }

    res.send(html);
  } catch (error) {
    console.error('Proxy Hatası:', error.message);
    // Cloudflare / Bot Koruması Olduğunda Kullanıcı Dostu Doğrudan Çözüm
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { background: #091319; color: #f5efe3; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; }
          .proxy-card { background: rgba(14, 30, 39, 0.9); border: 1px solid rgba(217, 191, 135, 0.3); border-radius: 16px; padding: 32px; max-width: 520px; box-shadow: 0 10px 40px rgba(0,0,0,0.6); }
          .btn-action { display: inline-block; margin-top: 18px; padding: 12px 24px; background: linear-gradient(135deg, #d9bf87, #c9aa6d); color: #091319; font-weight: 700; border-radius: 10px; text-decoration: none; }
        </style>
      </head>
      <body>
        <div class="proxy-card">
          <div style="font-size: 40px; margin-bottom: 12px;">🛡️</div>
          <h2 style="margin: 0 0 10px 0; color: #d9bf87;">Bu Film Sitesi Cloudflare Korumalı</h2>
          <p style="color: #a3b8c2; font-size: 14px; line-height: 1.6;">
            Bu film sitesi sunucu bazlı çekimleri engelliyor. Ancak tarayıcınızdan <b>1 saniyede</b> kesintisiz izleyebilirsiniz:
          </p>
          <div style="background: rgba(217, 191, 135, 0.08); padding: 14px; border-radius: 10px; text-align: left; font-size: 13px; margin: 16px 0; color: #f5efe3;">
            <b>💡 1 Tıkla Kesintisiz İzleme Yöntemi:</b><br>
            1. Yukarıdaki <b>"Ekran Paylaş"</b> butonuna tıklayın.<br>
            2. Açılan pencerede <b>"Sekme"</b>yi seçip filmin açık olduğu sekmeyi işaretleyin.<br>
            3. Sol alttaki <b>"Sekme Sesini Paylaş"</b> kutucuğunu açın.<br>
            ✨ <b>Sonuç:</b> Film 1080p, sıfır gecikmeli ve gür sesli olarak tüm izleyicilere canlı akar!
          </div>
          <a href="${targetUrl}" target="_blank" class="btn-action">🎬 Filmi Yeni Sekmede Aç</a>
        </div>
      </body>
      </html>
    `);
  }
});

/**
 * 2. Gelişmiş Otomatik Video & Iframe Player Çıkarıcı (/api/extract-video)
 * DiziBox, HDFilmcehennemi, VidMoly, Upstream, FileLions ve film sayfalarını derinlemesine tarar.
 */
app.get('/api/extract-video', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).json({ success: false, message: 'URL gerekli' });

  try {
    const origin = new URL(targetUrl).origin;
    const fetchHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'Referer': origin,
      'Origin': origin,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    };

    // 1. Ana sayfayı çek
    const response = await axios.get(targetUrl, {
      headers: fetchHeaders,
      timeout: 15000,
      maxRedirects: 6
    });

    let html = response.data;
    if (typeof html !== 'string') html = JSON.stringify(html);

    // Doğrudan .m3u8 veya .mp4 tespiti
    let m3u8Match = html.match(/(https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*)/i);
    let mp4Match = html.match(/(https?:\/\/[^"'\s\\]+\.mp4[^"'\s\\]*)/i);

    if (m3u8Match) {
      return res.json({ success: true, streamUrl: m3u8Match[1].replace(/\\/g, ''), type: 'hls' });
    }
    if (mp4Match) {
      return res.json({ success: true, streamUrl: mp4Match[1].replace(/\\/g, ''), type: 'mp4' });
    }

    // 2. Sayfadaki gömülü video player iframe'lerini tara (vidmoly, upstream, closeload, streamwish, doodstream vb.)
    const iframeMatches = [...html.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)];
    for (const match of iframeMatches) {
      let iframeUrl = match[1];
      if (iframeUrl.startsWith('//')) iframeUrl = 'https:' + iframeUrl;
      else if (iframeUrl.startsWith('/')) iframeUrl = origin + iframeUrl;

      // Video player iframe'i mi?
      if (iframeUrl.includes('http') && (
        iframeUrl.includes('vidmoly') ||
        iframeUrl.includes('upstream') ||
        iframeUrl.includes('closeload') ||
        iframeUrl.includes('filelions') ||
        iframeUrl.includes('streamwish') ||
        iframeUrl.includes('dood') ||
        iframeUrl.includes('player') ||
        iframeUrl.includes('embed') ||
        iframeUrl.includes('vidsrc') ||
        iframeUrl.includes('vk.com') ||
        iframeUrl.includes('superembed')
      )) {
        return res.json({
          success: true,
          streamUrl: `/api/proxy-embed?url=${encodeURIComponent(iframeUrl)}`,
          type: 'embed',
          isDirectPlayer: true
        });
      }
    }

    // İlk geçerli iframe'i döndür
    for (const match of iframeMatches) {
      let iframeUrl = match[1];
      if (iframeUrl.startsWith('//')) iframeUrl = 'https:' + iframeUrl;
      else if (iframeUrl.startsWith('/')) iframeUrl = origin + iframeUrl;

      if (iframeUrl.includes('http') && !iframeUrl.includes('google') && !iframeUrl.includes('disqus') && !iframeUrl.includes('facebook')) {
        return res.json({
          success: true,
          streamUrl: `/api/proxy-embed?url=${encodeURIComponent(iframeUrl)}`,
          type: 'embed'
        });
      }
    }

    return res.json({
      success: true,
      streamUrl: `/api/proxy-embed?url=${encodeURIComponent(targetUrl)}`,
      type: 'embed'
    });
  } catch (err) {
    return res.json({
      success: true,
      streamUrl: `/api/proxy-embed?url=${encodeURIComponent(targetUrl)}`,
      type: 'embed'
    });
  }
});

/**
 * 2. Medya Akışı Proxy'si (/api/proxy-media)
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

    // 1. Oda yeni mi veya sahibi geri mi döndü?
    if (room.hostToken && room.hostToken === userToken) {
      // Odanın gerçek sahibi F5 attı / geri geldi
      room.hostId = socket.id;
      isHost = true;
      if (room.hostDisconnectTimer) {
        clearTimeout(room.hostDisconnectTimer);
        room.hostDisconnectTimer = null;
      }
    } else if (!room.hostToken && (isCreator || room.users.size === 0)) {
      // Odayı ilk oluşturan kişi
      room.hostToken = userToken;
      room.hostId = socket.id;
      isHost = true;
      if (room.hostDisconnectTimer) {
        clearTimeout(room.hostDisconnectTimer);
        room.hostDisconnectTimer = null;
      }
    } else {
      // Kesinlikle İZLEYİCİ (Asla Host yapılamaz)
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

      // 1. Sunucu hesapladığı tahmini süreyi anında izleyiciye iletir (Gecikmesiz)
      socket.emit('sync-force', {
        currentTime: liveTime,
        isPlaying: room.media.isPlaying,
        media: room.media
      });

      // 2. Host'tan tam milisaniyelik anlık süreyi çekip izleyiciye basar
      if (room.hostId && room.hostId !== socket.id) {
        io.to(room.hostId).emit('host-ping-time-for-guest', { guestId: socket.id });
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

  // Yeni Canvas Kare Rölesi (host -> tüm izleyiciler)
  socket.on('screenshare-frame', (chunk) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    // Host kontrolü: server'ın tuttuğu hostId ile eşleştir
    const isRoomHost = room.hostId === socket.id;
    if (!isRoomHost) return;
    socket.to(currentRoomId).emit('screenshare-frame', chunk);
  });

  // PCM Ses Rölesi (host -> tüm izleyiciler)
  socket.on('screenshare-audio', (audioData) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    if (room.hostId !== socket.id) return;
    socket.to(currentRoomId).emit('screenshare-audio', audioData);
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

      // Eğer ayrılan kişi Host ise, 3 dakika (180 saniye) bekle (Sayfa yenilemede Host değişmesin!)
      if (room.hostId === socket.id) {
        room.hostDisconnectTimer = setTimeout(() => {
          if (rooms.has(currentRoomId)) {
            const currentRoom = rooms.get(currentRoomId);
            if (currentRoom.users.size > 0 && currentRoom.hostId === socket.id) {
              const nextHost = currentRoom.users.values().next().value;
              currentRoom.hostId = nextHost.id;
              currentRoom.hostToken = nextHost.userToken;
              nextHost.isHost = true;

              io.to(currentRoomId).emit('host-transferred', {
                newHostId: nextHost.id,
                newHostName: nextHost.username
              });
            }
          }
        }, 180000); // 3 Dakika (180 saniye)
      }

      // Odadakilere güncelleme gönder
      io.to(currentRoomId).emit('user-left', {
        userId: socket.id,
        users: Array.from(room.users.values())
      });

      // Oda tamamen boşaldıysa 1 saat sonra temizle (zaman kısıtlamasını engellemek için)
      if (room.users.size === 0) {
        setTimeout(() => {
          if (rooms.has(currentRoomId) && rooms.get(currentRoomId).users.size === 0) {
            rooms.delete(currentRoomId);
            console.log(`[x] Boş oda silindi: ${currentRoomId}`);
          }
        }, 3600000); // 1 saat
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

