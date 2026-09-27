const config = require('../config');

// Auto-reply CS lama (tidak dipakai mode pribadi, disimpan arsip)
function csAutoReply(text) {
  const t = (text || '').toLowerCase();
  if (/^(halo|hallo|hai|hi|pagi|siang|sore|malam|assalamu|permisi)\b/.test(t)) {
    return `Halo kak! Selamat datang di *${config.storeName}* 🙏\nKetik *!menu* untuk lihat layanan.`;
  }
  if (t.includes('harga') || t.includes('katalog') || t.includes('produk')) {
    return `Untuk katalog & harga lengkap ketik *!katalog* ya kak.`;
  }
  if (t.includes('jam') || t.includes('buka') || t.includes('operasional')) {
    return `Jam operasional kami:\n*${config.jam}*`;
  }
  if (t.includes('lokasi') || t.includes('alamat') || t.includes('dimana') || t.includes('di mana')) {
    return `Lokasi kami:\n📍 ${config.lokasi}`;
  }
  return null;
}

module.exports = { csAutoReply };
