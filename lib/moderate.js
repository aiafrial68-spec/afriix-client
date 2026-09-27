// Moderasi konten tidak pantas + anti-spam + hitung pelanggaran.
//
// BATAS JUJUR (penting dipahami sebelum jualan):
// - Tanpa API visual, bot hanya menilai TEKS/caption/nama file. Isi foto/video
//   baru bisa dinilai kalau MOD_API_URL + MOD_API_KEY diisi (webhook generik,
//   mis. dibungkus dari Sightengine/Hive: POST {image: base64} -> {nsfw: bool}).
// - Hapus pesan HANYA bisa di grup dan HANYA kalau bot jadi ADMIN.
// - Di chat pribadi pesan lawan TIDAK bisa dihapus via API WA (hanya pengirim
//   yang bisa). Jadi di private: peringatan + teruskan ke owner + mute otomatis
//   setelah MOD_MAX_PRIVATE pelanggaran.
const axios = require('axios');

// Kata/frasa dewasa (Indonesia + Inggris umum). Cocokkan utuh (\b) agar
// "dewe" (Jawa: sendiri) tidak kena "ewe", "susu" minuman tidak kena, dll.
const BANNED_WORDS = [
  'bokep', 'porno', 'hentai', 'bugil', 'telanjang', 'ngentot', 'ngewe',
  'memek', 'kontol', 'pepek', 'itil', 'pentil', 'toket',
  'coli', 'colmek', 'onani', 'masturbasi', 'sange', 'sangek', 'horny',
  'desah', 'orgasme', 'ejakulasi', 'vcs', 'bispak', 'esek'
];
const BANNED_PHRASES = [
  'open bo', 'pijat plus', ' VCS ', ' video call sex '
];
const BANNED_DOMAINS = [
  'xnxx', 'xvideos', 'pornhub', 'xhamster', 'redtube', 'youporn', 'onlyfans'
];

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function containsBanned(text) {
  const t = ` ${(text || '').toLowerCase()} `;
  for (const d of BANNED_DOMAINS) {
    if (t.includes(d)) return true;
  }
  for (const p of BANNED_PHRASES) {
    if (t.includes(p.toLowerCase())) return true;
  }
  for (const w of BANNED_WORDS) {
    if (new RegExp(`\\b${escRe(w)}\\b`, 'i').test(t)) return true;
  }
  return false;
}

// Jenis media pesan (untuk keputusan hapus/scan). null = teks biasa.
function mediaKind(msg) {
  const m = msg?.message;
  if (!m) return null;
  if (m.imageMessage) return 'image';
  if (m.videoMessage) return 'video';
  if (m.stickerMessage) return 'sticker';
  if (m.documentMessage) return 'document';
  if (m.audioMessage) return 'audio';
  return null;
}

// Teks tambahan untuk di-scan selain caption: nama file dokumen.
function extraScanOf(msg) {
  const m = msg?.message;
  const fn = m?.documentMessage?.fileName || '';
  const mt = m?.documentMessage?.mimetype || m?.videoMessage?.mimetype || m?.imageMessage?.mimetype || '';
  return `${fn}\n${mt}`.trim();
}

// Scan visual via webhook generik. Return true/false, atau null bila tak bisa dinilai.
// Webhook: POST { image: base64 } + Bearer key -> { nsfw } / { is_nsfw } / { score>=0.8 }.
async function visualNsfw(buffer, cfg) {
  if (!cfg?.url || !cfg?.key || !buffer?.length) return null;
  try {
    const res = await axios.post(
      cfg.url,
      { image: buffer.toString('base64') },
      { headers: { Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json' }, timeout: 25000, maxBodyLength: 15 * 1024 * 1024 }
    );
    const d = res.data || {};
    if (typeof d.nsfw === 'boolean') return d.nsfw;
    if (typeof d.is_nsfw === 'boolean') return d.is_nsfw;
    if (typeof d.score === 'number') return d.score >= 0.8;
    if (typeof d.porn === 'number') return d.porn >= 0.8;
    return null;
  } catch (e) {
    console.log('mod visual err:', (e.response?.data?.error?.message || e.message || '').toString().slice(0, 150));
    return null;
  }
}

// ---- Anti-spam: max `limit` pesan/menit per pengirim ----
// Return 'ok' | 'drop' (diam) | 'mute' (baru layak di-mute, notif sekali/10 mnt).
const spamHits = {};
const spamMutedAt = {};
function spamCheck(sender, limit = 15) {
  const k = String(sender || 'x');
  const now = Date.now();
  if (!spamHits[k]) spamHits[k] = [];
  spamHits[k] = spamHits[k].filter((t) => now - t < 60000);
  spamHits[k].push(now);
  if (Object.keys(spamHits).length > 1000) {
    for (const key of Object.keys(spamHits).slice(0, 500)) delete spamHits[key];
  }
  if (spamHits[k].length <= limit) return 'ok';
  if (spamHits[k].length > limit + 10 && now - (spamMutedAt[k] || 0) > 10 * 60 * 1000) {
    spamMutedAt[k] = now;
    return 'mute';
  }
  return 'drop';
}

// ---- Pelanggaran moderasi private: hitung per nomor, reset 24 jam ----
const vios = {};
function addViolation(sender) {
  const num = String(sender || '').split('@')[0].replace(/\D/g, '') || String(sender);
  const now = Date.now();
  if (!vios[num] || now - vios[num].ts > 24 * 60 * 60 * 1000) vios[num] = { n: 0, ts: now };
  vios[num].n += 1;
  vios[num].ts = now;
  return vios[num].n;
}

// ---- Cooldown peringatan grup (1x/menit per chat) agar tidak spam ----
const lastWarn = {};
function modWarnCooldown(chatJid) {
  const now = Date.now();
  if (now - (lastWarn[chatJid] || 0) < 60000) return true;
  lastWarn[chatJid] = now;
  return false;
}

// ---- Anti-spam BOT (biar bot tidak terasa spam) ----
// 1) cmdCooldown: max 1 command per `ms` per pengirim (default 3 detik).
//    Return true = boleh jalan, false = terlalu cepat (drop diam-diam).
const cmdHits = {};
function cmdCooldown(sender, ms = 3000) {
  const k = String(sender || 'x');
  const now = Date.now();
  if (now - (cmdHits[k] || 0) < ms) return false;
  cmdHits[k] = now;
  if (Object.keys(cmdHits).length > 1000) {
    for (const key of Object.keys(cmdHits).slice(0, 500)) delete cmdHits[key];
  }
  return true;
}
// 2) dupCheck: pesan/command SAMA persis dalam `window` ms -> drop (spam tombol/copy-paste).
//    Return true = duplikat (sebaiknya drop), false = baru.
const lastCmdText = {};
function dupCheck(sender, text, window = 30000) {
  const k = String(sender || 'x');
  const now = Date.now();
  const t = String(text || '').slice(0, 200);
  const prev = lastCmdText[k];
  if (prev && prev.text === t && now - prev.at < window) return true;
  lastCmdText[k] = { text: t, at: now };
  if (Object.keys(lastCmdText).length > 1000) {
    for (const key of Object.keys(lastCmdText).slice(0, 500)) delete lastCmdText[key];
  }
  return false;
}
// 3) heavyCheck: command berat (dl/tts/tagall) dibatasi 1x per `ms` per pengirim.
//    Return { ok:true } atau { ok:false, left } (sisa detik).
const heavyHits = {};
function heavyCheck(sender, cmd, ms = 60000) {
  const k = `${String(sender || 'x')}|${cmd}`;
  const now = Date.now();
  const last = heavyHits[k] || 0;
  if (now - last < ms) return { ok: false, left: Math.ceil((ms - (now - last)) / 1000) };
  heavyHits[k] = now;
  if (Object.keys(heavyHits).length > 1000) {
    for (const key of Object.keys(heavyHits).slice(0, 500)) delete heavyHits[key];
  }
  return { ok: true };
}
// 4) quickCooldown: jawaban instan (quickReply) tetap dibatasi 1x per 5 detik per chat
//    agar spam "halo halo halo" tidak dibalas semua.
const quickHits = {};
function quickCooldown(chatJid, ms = 5000) {
  const k = String(chatJid || 'x');
  const now = Date.now();
  if (now - (quickHits[k] || 0) < ms) return false;
  quickHits[k] = now;
  return true;
}

module.exports = {
  containsBanned, mediaKind, extraScanOf, visualNsfw,
  spamCheck, addViolation, modWarnCooldown,
  cmdCooldown, dupCheck, heavyCheck, quickCooldown
};
