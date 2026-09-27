function personalMenu(botName) {
  return `*${botName} — ASISTEN PRIBADI*\n\n` +
    `!ping — status dan uptime\n` +
    `!ai <pesan> — ngobrol dengan AI\n` +
    `!ingat <catatan> — simpan catatan/pengingat\n` +
    `!jadwal — daftar pengingat\n` +
    `!list — daftar catatan\n` +
    `!profil — profil percakapan\n` +
    `!sticker / !stext — buat stiker\n` +
    `!tts <teks> — buat voice note\n` +
    `!cuaca <kota> — cek cuaca\n` +
    `!sholat <kota> — jadwal sholat\n` +
    `!kurs — kurs USD/IDR\n` +
    `!tr-en <teks> — terjemahan\n` +
    `!qr <teks> — buat QR\n` +
    `!calc <ekspresi> — kalkulator\n` +
    `!gambar <deskripsi> — buat gambar (Pollinations, gratis)\n\n` +
    `AI utama Gemini, cadangan Groq.`;
}

module.exports = { personalMenu };
