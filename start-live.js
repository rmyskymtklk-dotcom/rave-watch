const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log(`
======================================================
🔥 SYNCPARTY CANLI BAŞLATICI 🔥
======================================================
🚀 1. Sunucu başlatılıyor (Port 3000)...
📡 2. Cloudflare Tüneli kuruluyor, canlı link hazırlanıyor...
======================================================
`);

// 1. server.js dosyasını arka planda başlat
const serverProc = spawn('node', ['server.js'], { stdio: 'inherit', shell: true });

// 2. Cloudflare Tünelini başlat ve linki otomatik yakala
const tunnelProc = spawn('npx', ['cloudflared', 'tunnel', '--url', 'http://localhost:3000'], { shell: true });

let linkFound = false;

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

tunnelProc.stdout.on('data', handleLog);
tunnelProc.stderr.on('data', handleLog);

tunnelProc.on('close', (code) => {
  if (!linkFound) {
    console.log('\n⚠️ Tünel kapandı veya durduruldu.');
  }
});
