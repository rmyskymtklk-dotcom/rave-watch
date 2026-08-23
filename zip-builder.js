const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const outputZipPath = path.join(__dirname, 'rave-watch-party.zip');
const output = fs.createWriteStream(outputZipPath);
const archive = archiver('zip', {
  zlib: { level: 9 } // En yüksek sıkıştırma
});

output.on('close', function() {
  console.log(`\n🎉 BAŞARILI! Tüm proje "${outputZipPath}" içerisine paketlendi.`);
  console.log(`📦 Toplam Boyut: ${(archive.pointer() / 1024).toFixed(2)} KB`);
});

archive.on('error', function(err) {
  throw err;
});

archive.pipe(output);

// Dosyaları ve klasörleri ekle (node_modules hariç)
archive.file(path.join(__dirname, 'server.js'), { name: 'server.js' });
archive.file(path.join(__dirname, 'package.json'), { name: 'package.json' });
archive.file(path.join(__dirname, 'README.md'), { name: 'README.md' });
archive.directory(path.join(__dirname, 'public/'), 'public');

archive.finalize();
