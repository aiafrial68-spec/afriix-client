require('dotenv').config();

module.exports = {
  storeName: process.env.STORE_NAME || 'AfriIX',
  ownerNumber: process.env.OWNER_NUMBER || '',
  jam: process.env.JAM_OPERASIONAL || '-',
  lokasi: process.env.LOKASI || '-',
  katalogUrl: process.env.KATALOG_URL || '',

  botNumber: (process.env.BOT_NUMBER || '').replace(/\D/g, ''),
  // Dual pairing: 1 = kode angka + QR (keduanya tampil), 0 = QR saja
  usePairing: process.env.USE_PAIRING !== '0',

  // Lisensi jualan: 1 kunci = 1 nomor bot. Pelanggan isi LICENSE_KEY dari penjual.
  licenseKey: (process.env.LICENSE_KEY || '').trim(),

  // Moderasi konten tidak pantas + anti-spam
  enableModeration: process.env.ENABLE_MODERATION !== '0',
  modDeleteGroup: process.env.MOD_DELETE_GROUP !== '0', // hapus di grup (butuh bot admin)
  modMaxPrivate: parseInt(process.env.MOD_MAX_PRIVATE || '3', 10), // pelanggaran private -> mute 30 mnt
  modApiUrl: process.env.MOD_API_URL || '', // webhook visual (opsional): POST {image} -> {nsfw}
  modApiKey: process.env.MOD_API_KEY || '',
  spamLimit: parseInt(process.env.SPAM_LIMIT || '15', 10), // pesan/menit per pengirim
  logChat: process.env.LOG_CHAT === '1', // catat metadata chat ke logs/chat.log (default off)

  // Heartbeat monitoring ke dashboard owner (opt-in, kosong = mati)
  monitorUrl: (process.env.MONITOR_URL || '').trim().replace(/\/$/, ''),
  monitorToken: (process.env.MONITOR_TOKEN || '').trim(),
  monitorInterval: parseInt(process.env.MONITOR_INTERVAL || '60', 10),

  enableWelcome: process.env.ENABLE_WELCOME !== '0',
  welcomeText: (process.env.WELCOME_TEXT || '').trim(),
  enableAI: process.env.ENABLE_AI !== '0',
  enableSticker: process.env.ENABLE_STICKER !== '0',
  enableCsAuto: process.env.ENABLE_CS_AUTO !== '0',

  ai: {
    url: process.env.AI_API_URL || 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    model: process.env.AI_MODEL || 'gemini-2.5-flash-lite',
    key: process.env.AI_API_KEY || '',
    url2: process.env.AI_API_URL2 || 'https://api.groq.com/openai/v1/chat/completions',
    model2: process.env.AI_MODEL2 || 'llama-3.1-8b-instant',
    key2: process.env.AI_API_KEY2 || '',
    visionModel: process.env.AI_VISION_MODEL || 'qwen/qwen3.8-27b',
    whisperModel: process.env.AI_WHISPER_MODEL || 'whisper-large-v3-turbo',
    systemPrompt: process.env.AI_SYSTEM_PROMPT || 'Kamu adalah Tuan Afrial yang sedang membalas chat WA pribadinya. Tulis persis seperti manusia: santai, natural, tidak kaku, maksimal 1-2 kalimat pendek. Variasikan jawaban, jangan template. Pahami bahasa santai, singkatan, typo, dan Jawa sehari-hari. Ingat konteks percakapan sebelumnya, jangan mengulang yang sudah dibahas. Jangan mengarang info spesifik (jadwal, harga, alamat); kalau ditanya begitu jawab natural: nanti aku kabarin lagi ya, aku cek dulu. Bahasa yang kamu kuasai: Indonesia, Inggris, Jawa. Jika pesan memakai bahasa lain yang tidak kamu kenali atau sama sekali tidak paham, jawab persis: TIDAK_PAHAM. Jika penanya minta bicara, ketemu, atau telepon langsung dengan Tuan Afrial, jawab persis: ALIHKAN. Jangan pernah bilang kamu AI/bot/asisten.'
  },
  // Asisten pribadi (bukan jualan): tidak ada katalog/order di bot ini.
  dailyReportHour: parseInt(process.env.DAILY_REPORT_HOUR || '21', 10),
  ownerKeywords: (process.env.OWNER_KEYWORDS || 'afrial,real,yal').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  autoAiPrivate: process.env.AUTO_AI_PRIVATE !== '0',
  aiCooldown: parseInt(process.env.AI_COOLDOWN || '20', 10),
  redirectMuteMin: parseInt(process.env.REDIRECT_MUTE_MIN || '60', 10),
  nudgeMin: parseInt(process.env.NUDGE_MIN || '10', 10),
  resumeMin: parseInt(process.env.RESUME_MIN || '30', 10),

  // Jam tidur Tuan Afrial (WIB). 23:00-05:00 = tidur, rentang melewati tengah malam.
  sleepStart: parseInt(process.env.SLEEP_START || '23', 10),
  sleepEnd: parseInt(process.env.SLEEP_END || '5', 10),
  dash: {
    enabled: process.env.ENABLE_DASH !== '0',
    host: process.env.DASH_HOST || '127.0.0.1',
    port: parseInt(process.env.DASH_PORT || '3000', 10),
    token: process.env.DASH_TOKEN || 'ganti-token-ini'
  },

  prefix: '!'
};
