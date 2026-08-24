const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log(`
======================================================
🔥 SYNCPARTY KESİNTİSİZ CANLI BAŞLATICI 🔥
======================================================
🚀 1. Sunucu başlatılıyor (Port 3000)...
📡 2. Cloudflare Tüneli kuruluyor, canlı link hazırlanıyor...
======================================================
`);

// 1. server.js dosyasını başlat
const serverProc = spawn('node', ['server.js'], { stdio: 'inherit', shell: true });

// 2. Cloudflare Tünelini başlat ve düşerse otomatik yenile
let currentTunnel = null;
let linkFound = false;

function startTunnel() {
  linkFound = false;
  currentTunnel = spawn('npx', ['cloudflared', 'tunnel', '--url', 'http://localhost:3000'], { shell: true });

  function handleLog(chunk) {
    const str = chunk.toString();
    const match = str.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/i);
    if (match && !linkFound) {
      linkFound = true;
      const url = match[0];
      console.log(`
===============================================================================
🎉 SİTENİZ BAŞARIYLA CANLIYA ALINDI! (TÜM DÜNYA İÇİN AKTİF)
===============================================================================
👉 CANLI LİNKİNİZ: ${url}
===============================================================================
📋 Bu linki kopyalayıp arkadaşlarınıza atın. Şifre veya onay sormadan DİREKT açılır!
===============================================================================
      `);
    }
  }

  currentTunnel.stdout.on('data', handleLog);
  currentTunnel.stderr.on('data', handleLog);

  currentTunnel.on('close', (code) => {
    console.log('\n⚠️ Tünel bağlantısı kapandı, 3 saniye içinde otomatik yeniden bağlanıyor...');
    setTimeout(() => {
      startTunnel();
    }, 3000);
  });
}

startTunnel();
