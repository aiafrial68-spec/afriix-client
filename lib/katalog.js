const config = require('../config');

// Katalog lama (tidak dipakai mode pribadi, disimpan arsip)
const KATALOG = [
  { nama: 'Paket Hemat 1', harga: 'Rp 25.000', desc: 'Contoh - ganti di lib/katalog.js' },
  { nama: 'Paket Best Seller', harga: 'Rp 50.000', desc: 'Contoh - ganti di lib/katalog.js' },
  { nama: 'Paket Premium', harga: 'Rp 100.000', desc: 'Contoh - ganti di lib/katalog.js' }
];

function katalogText() {
  let txt = `*KATALOG ${config.storeName.toUpperCase()}*\n\n`;
  KATALOG.forEach((p, i) => {
    txt += `${i + 1}. *${p.nama}* - ${p.harga}\n   ${p.desc}\n`;
  });
  return txt;
}

function menuText() {
  return `*${config.storeName} - MENU BOT*\n\n*!ping* - cek bot aktif\n*!menu* - menu ini`;
}

module.exports = { KATALOG, katalogText, menuText };
