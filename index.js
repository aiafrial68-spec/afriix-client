require('dotenv').config();
const readline = require('readline');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
  jidNormalizedUser,
  Browsers
} = require('@whiskeysockets/baileys');
// Fingerprint companion modern. '20.0.04' itu versi OS Ubuntu, BUKAN Chrome —
// server WA menolak hello usang (401 1-2 detik setelah pairing code). Pakai helper resmi.
const COMPANION = (typeof Browsers !== 'undefined' && Browsers.macOS)
  ? Browsers.macOS('Desktop')
  : ['Ubuntu', 'Chrome', '122.0.0.0'];

const config = require('./config');
const { aiReply, aiTelemetry, detectLang, learnChat } = require('./lib/ai');
const { sendHuman, quickReply, isGreeting, shouldSkip, isUnknownLanguage } = require('./lib/human');
const { personalMenu } = require('./lib/personal-menu');
const reminder = require('./lib/reminder');
const tools = require('./lib/tools');
const { startDashboard } = require('./lib/dashboard');
const sessionGuard = require('./lib/session');
const { containsBanned, mediaKind, extraScanOf, visualNsfw, spamCheck, addViolation, modWarnCooldown, cmdCooldown, dupCheck, heavyCheck, quickCooldown } = require('./lib/moderate');
const { aiVision } = require('./lib/vision');
const { ttsBuffer, transcribeGroq } = require('./lib/voice');
const { startDaily } = require('./lib/daily');
const { startHeartbeat } = require('./lib/heartbeat');
const sched = require('./lib/schedule');
const info = require('./lib/info');

const BOT_NAME = config.storeName || 'AfriIX';
const startTime = Date.now();
let autoAi = config.autoAiPrivate;
const lastAiReply = {}; // cooldown per pengirim, karena API gratis limit ~15 detik
// Statistik untuk dashboard monitoring
const stats = { startedAt: Date.now(), connected: false, user: '-', msgIn: 0, aiOut: 0, redirects: 0, lastFrom: '-', lastAt: '-', meta: [] };
function logMessageMeta(msg, direction, type, startedAt, status = 'ok') {
  try {
    const raw = sessionGuard.displayNumber(msg, msg?.key?.remoteJid || '');
    const masked = raw.length > 6 ? raw.slice(0, 4) + '****' + raw.slice(-2) : '****';
    stats.meta.unshift({ at: new Date().toISOString(), num: masked, direction, type, ms: Math.max(0, Date.now() - startedAt), status });
    if (stats.meta.length > 50) stats.meta.length = 50;
  } catch {}
}
// ===== Event-log + bucket per-jam untuk dashboard modern (ringan, di RAM) =====
const evtLog = []; // [{t, type, msg}] max 120
function logEvt(type, msg) {
  try {
    evtLog.unshift({ t: new Date().toISOString(), type: String(type || 'info').slice(0, 12), msg: String(msg || '').slice(0, 160) });
    if (evtLog.length > 120) evtLog.length = 120;
  } catch {}
}
const hourBuckets = {}; // "YYYY-MM-DDTHH" (UTC) -> {in, ai, redir}
function hourKey(d) { return new Date(d || Date.now()).toISOString().slice(0, 13); }
function bumpHour(kind) {
  try {
    const k = hourKey();
    const b = hourBuckets[k] || (hourBuckets[k] = { in: 0, ai: 0, redir: 0 });
    if (b[kind] !== undefined) b[kind]++;
    const keys = Object.keys(hourBuckets).sort();
    while (keys.length > 48) delete hourBuckets[keys.shift()];
  } catch {}
}
function hourLabel(k) {
  try {
    return new Date(k + ':00:00Z').toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'numeric', hour: '2-digit', hour12: false }).replace('.', ':');
  } catch { return k; }
}
function muteLeft(exp) {
  const ms = exp - Date.now();
  if (ms <= 0) return 'habis';
  const m = Math.floor(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}j ${m % 60}m` : `${m}m`;
}

// ===== Anti-log-bengkak: potong dump raksasa Baileys/libsignal (SessionEntry/Buffer) =====
// Tanpa ini logs/out.log bisa 5.8M+ dalam sehari. Aktifkan detail via LOG_VERBOSE=1.
(function quietNoisyLogs() {
  if (process.env.LOG_VERBOSE === '1' || global.__quietOn) return;
  global.__quietOn = true;
  for (const k of ['log', 'error']) {
    try {
      const orig = console[k].bind(console);
      console[k] = (...a) => {
        try {
          const s = a.map((x) => (typeof x === 'string' ? x : String(x?.message || x))).join(' ');
          if (/SessionEntry|_chains|ephemeralKeyPair|lastRemoteEphemeralKey|remoteIdentityKey|Closing session|Removing old closed session/i.test(s)) return;
          if (s.length > 2000) { orig(s.slice(0, 2000) + `…[potong ${s.length}chr]`); return; }
        } catch {}
        orig(...a);
      };
    } catch {}
  }
})();

// ===== Log 1 baris tiap balasan AI (biar debug tidak buta di pm2 logs) =====
function logReply(to, txt) {
  try {
    const num = String(to || '').split('@')[0];
    console.log(`[BALAS ke ${num}]: ${String(txt || '').slice(0, 80)}`);
  } catch {}
}

// ===== Alasan drop terakhir (cooldown/mute/DND/ai-off) untuk /api/state =====
const lastDrop = { at: '-', reason: '-', from: '-' };
function markDrop(reason, from) {
  try {
    lastDrop.at = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    lastDrop.reason = String(reason || '-').slice(0, 30);
    lastDrop.from = String(from || '-').split('@')[0].slice(0, 25);
  } catch {}
}

// ===== Mode tidur Tuan Afrial (default 23:00-05:00 WIB) =====
function jakartaHour() {
  try {
    const parts = new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta', hour: 'numeric', hour12: false
    }).formatToParts(new Date());
    const h = parts.find((p) => p.type === 'hour');
    let hour = parseInt(h?.value || '0', 10);
    if (hour === 24) hour = 0;
    return hour;
  } catch {
    return new Date().getHours();
  }
}
function isSleeping() {
  const s = config.sleepStart ?? 23;
  const e = config.sleepEnd ?? 5;
  const h = jakartaHour();
  if (s <= e) return h >= s && h < e; // contoh 22-23 (tidak lewat tengah malam)
  return h >= s || h < e; // contoh 23-05 (lewat tengah malam)
}
function sleepLabel() {
  const s = config.sleepStart ?? 23;
  const e = config.sleepEnd ?? 5;
  const p = (n) => String(n).padStart(2, '0');
  return `${p(s)}:00–${p(e)}:00`;
}
function sleepRedirectText() {
  return `🌙 Mohon maaf, Tuan Afrial sedang istirahat (jam ${sleepLabel()} WIB) 🙏\nPesan kakak sudah saya teruskan dan akan dibalas setelah beliau aktif.\nAda yang bisa saya bantu dulu?`;
}
function sleepNoteSuffix() {
  return `\n\n🌙 *Catatan: Tuan Afrial sedang istirahat (${sleepLabel()} WIB). Pesan kakak akan dibalas setelah beliau aktif. Terima kasih atas pengertiannya 🙏*`;
}
function withSleepNote(txt, isGroup) {
  if (!txt || isGroup || !isSleeping()) return txt;
  if (txt.includes('masih tidur')) return txt; // cegah dobel
  return txt + sleepNoteSuffix();
}

// ===== Tombol ON/OFF AI (owner) =====
// Alasan !auto teks "tidak bekerja": arg case-sensitive + owner via LID tidak
// terdeteksi + silent-return. Tombol mengirim "!auto on"/"!auto off" sebagai
// buttonId sehingga tidak ada salah ketik.
function autoStatusText() {
  return `🤖 *Status AI: ${autoAi ? 'ON 🟢' : 'OFF 🔴'}*\n\nPencet tombol di bawah atau ketik:\n*!auto on* = hidupkan\n*!auto off* = matikan`;
}
async function sendAutoToggle(sock, from, msg, useOwnerNotify, ownerNotifyFn) {
  const txt = autoStatusText();
  // 1) Coba tombol interaktif modern (quick_reply). Kalau WA/bot tidak dukung, fallback.
  try {
    await sock.sendMessage(from, {
      text: txt,
      buttons: [
        { buttonId: '!auto on', buttonText: { displayText: '🟢 ON' }, type: 1 },
        { buttonId: '!auto off', buttonText: { displayText: '🔴 OFF' }, type: 1 },
      ],
      headerType: 1,
    }, { quoted: msg });
    return;
  } catch (e) { console.log('auto btn fallback:', String(e?.message || e).slice(0, 100)); }
  // 2) Fallback teks biasa
  try {
    if (useOwnerNotify && ownerNotifyFn) await ownerNotifyFn(txt);
    else await sock.sendMessage(from, { text: txt }, { quoted: msg });
  } catch {}
}
const question = (q) => new Promise((res) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question(q, (a) => { rl.close(); res(a.trim()); });
});

function getButtonId(msg) {
  const m = msg?.message;
  if (!m) return '';
  if (m.buttonsResponseMessage?.selectedButtonId) return String(m.buttonsResponseMessage.selectedButtonId);
  if (m.templateButtonReplyMessage?.selectedId) return String(m.templateButtonReplyMessage.selectedId);
  if (m.listResponseMessage?.singleSelectReply?.selectedRowId) return String(m.listResponseMessage.singleSelectReply.selectedRowId);
  const inter = m.interactiveResponseMessage?.nativeFlowResponseMessage;
  if (inter?.paramsJson) {
    try {
      const p = JSON.parse(inter.paramsJson);
      if (p?.id) return String(p.id);
    } catch {}
  }
  // fallback: body teks tombol interaktif yang isinya perintah
  const bodyTxt = m.interactiveResponseMessage?.body?.text;
  if (bodyTxt && /^!(auto|on|off|aion|aioff)\b/i.test(bodyTxt.trim())) return bodyTxt.trim();
  return '';
}

function getText(msg) {
  // Tap tombol ON/OFF dikembalikan sebagai teks perintah (mis. "!auto on")
  // agar masuk jalur command biasa.
  const bid = getButtonId(msg);
  if (bid) return bid;
  const m = msg.message;
  if (!m) return '';
  if (m.conversation) return m.conversation;
  if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
  if (m.imageMessage?.caption) return m.imageMessage.caption;
  if (m.videoMessage?.caption) return m.videoMessage.caption;
  return '';
}

async function makeStickerBuffer(imgBuffer) {
  const sharp = require('sharp');
  return await sharp(imgBuffer)
    .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp()
    .toBuffer();
}

async function makeTextSticker(text) {
  const sharp = require('sharp');
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').slice(0, 120);
  const svg = `<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
    <rect width="512" height="512" rx="60" fill="#111827"/>
    <foreignObject x="30" y="30" width="452" height="452">
      <div xmlns="http://www.w3.org/1999/xhtml" style="display:flex;align-items:center;justify-content:center;height:452px;text-align:center;color:white;font-family:sans-serif;font-size:44px;font-weight:bold;word-break:break-word;">${esc}</div>
    </foreignObject></svg>`;
  return await sharp(Buffer.from(svg)).webp().toBuffer();
}

function uptimeText() {
  const s = Math.floor((Date.now() - startTime) / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return `${h}j ${m}m ${ss}d`;
}

function run(cmd, args = [], timeout = 90000) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { timeout, shell: false });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) resolve(out.trim());
      else reject(new Error((err || `exit ${code}`).slice(0, 500)));
    });
  });
}

// Validasi URL download: hanya http/https, tolak shell-metachars & IP lokal
function isSafeDlUrl(s) {
  if (!s || s.length > 2048) return false;
  if (!/^https?:\/\/[^\s"'`$&|;<>]+$/i.test(s)) return false;
  try {
    const u = new URL(s);
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    const host = u.hostname.toLowerCase();
    if (['localhost', '127.0.0.1', '0.0.0.0', '[::1]'].includes(host)) return false;
    if (/^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
    return true;
  } catch { return false; }
}

// Chat yang memanggil pemilik langsung dialihkan, tidak dijawab AI.
// Keyword dinamis dari OWNER_KEYWORDS (default afrial,real,yal).
// "mas": hanya di awal chat atau "mas <keyword>". "p": hanya sapaan permisi di awal, bukan "P 25rb".
function callsOwner(text) {
  const t = (text || '').toLowerCase();
  const kws = (config.ownerKeywords && config.ownerKeywords.length ? config.ownerKeywords : ['afrial', 'real', 'yal']);
  for (const kw of kws) {
    const k = kw.toLowerCase().trim();
    if (!k) continue;
    if (k === 'mas') continue; // ditangani khusus di bawah
    if (k === 'p') continue; // ditangani khusus di bawah
    if (new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(t)) return true;
  }
  if (/^\s*mas\b/.test(t)) {
    // "mas" saja di awal = panggil, tapi "masuk/masih/masalah" sudah aman karena \b
    // cegah "mas 25rb" (harga emas?) -> hanya panggil jika pendek atau diikuti keyword/sapaan
    const after = t.replace(/^\s*mas\b/, '').trim();
    if (!after) return true;
    if (/^(afrial|real|yal|bang|kak|bro|sis|mas)\b/.test(after)) return true;
    if (after.length < 30 && /^(tolong|bantu|minta|tanya|permisi|halo|hai|pagi|siang|sore|malam|assalamu)/.test(after)) return true;
    // "mas, ..." sapaan tetap dihitung, tapi "masuk ..." tidak (sudah difilter \b)
    if (/^[,!.]/.test(after)) return true;
    return false;
  }
  if (/\bmas\s+(afrial|real|yal)\b/.test(t)) return true;
  // "p" permisi: hanya jika pesan diawali p ("p", "p mas", "p, permisi") — bukan "P 25rb" / harga
  if (/^\s*p([\s,.!?]+|$)/i.test(t)) {
    const rest = t.replace(/^\s*p/i, '').trim();
    if (!rest) return true; // "p" saja
    if (/^(mas|bang|kak|bro|misi|permisi|halo|hai|assalamu)/.test(rest)) return true;
    if (rest.length < 20 && !/\d/.test(rest)) return true; // "p pagi", "p tanya" tanpa angka
    return false;
  }
  return false;
}

async function forwardToOwner(sock, sender, pushName, text, msg = null) {
  if (!config.ownerNumber) return;
  try {
    const ownerJid = jidNormalizedUser(config.ownerNumber.replace(/\D/g, '') + '@s.whatsapp.net');
    const shown = sessionGuard.displayNumber(msg, sender);
    const header = `🔔 *Panggilan untuk Tuan Afrial*\nDari: ${pushName || sender}\nNo: ${shown}\nPesan: ${(text || '').slice(0, 500)}`;
    // teruskan media (gambar/video/dokumen/audio) agar owner lihat konteks, bukan cuma teks
    try {
      const m = msg?.message;
      const hasMedia = m?.imageMessage || m?.videoMessage || m?.documentMessage || m?.audioMessage || m?.stickerMessage;
      if (msg && hasMedia) {
        const buf = await downloadMediaMessage(msg, 'buffer', {});
        if (buf && buf.length < 60 * 1024 * 1024) {
          if (m.imageMessage) {
            await sock.sendMessage(ownerJid, { image: buf, caption: header });
            return;
          }
          if (m.videoMessage) {
            await sock.sendMessage(ownerJid, { video: buf, caption: header });
            return;
          }
          if (m.documentMessage) {
            await sock.sendMessage(ownerJid, {
              document: buf,
              fileName: m.documentMessage.fileName || 'file',
              mimetype: m.documentMessage.mimetype || 'application/octet-stream',
              caption: header
            });
            return;
          }
          if (m.audioMessage) {
            await sock.sendMessage(ownerJid, { audio: buf, mimetype: 'audio/ogg; codecs=opus', ptt: !!m.audioMessage.ptt });
            await sock.sendMessage(ownerJid, { text: header });
            return;
          }
        }
      }
    } catch (e) { console.log('forward media err:', e.message); }
    await sock.sendMessage(ownerJid, { text: header });
  } catch (e) { console.log('forward err:', e.message); }
}

// Notifikasi khusus pemilik (status bot, dsb). Tidak pernah ke orang lain.
async function notifyOwner(sock, text) {
  if (!config.ownerNumber) return;
  try {
    const ownerJid = jidNormalizedUser(config.ownerNumber.replace(/\D/g, '') + '@s.whatsapp.net');
    await sock.sendMessage(ownerJid, { text });
  } catch (e) { console.log('notify err:', e.message); }
}
// Notifikasi crash ke owner (penting saat dijual: bot tidak boleh mati diam-diam).
function crashLog(line) {
  try {
    const dir = path.join(__dirname, 'logs');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'crash.log'), new Date().toISOString() + ' ' + line + '\n');
  } catch {}
}
if (!global.__crashOn) {
  global.__crashOn = true;
  process.on('unhandledRejection', (e) => {
    const m = String(e?.message || e).slice(0, 300);
    console.log('unhandledRejection:', m);
    crashLog('unhandledRejection: ' + m);
    try { if (global.__sock) notifyOwner(global.__sock, `⚠️ *AfriIX* gangguan: ${m}`); } catch {}
  });
  process.on('uncaughtException', (e) => {
    const m = String(e?.message || e?.stack || e).slice(0, 300);
    console.log('uncaughtException:', m);
    crashLog('uncaughtException: ' + m);
    try { if (global.__sock) global.__sock.sendMessage(jidNormalizedUser(config.ownerNumber.replace(/\D/g, '') + '@s.whatsapp.net'), { text: `❌ *AfriIX* crash: ${m}\nBot restart otomatis...` }); } catch {}
    setTimeout(() => process.exit(1), 1500);
  });
}

const mutedUntil = {};
// Tidak ada balas otomatis berbasis timer (nudge & resume dihapus sesuai request).
// Kalau owner diam dan orangnya juga diam -> bot diam total, tidak apa-apa.
// Kalau user chat lagi saat mute, bot balas "sabar menunggu" reaktif (lihat handler mute di bawah).
// Balasan sabar saat mute: hanya 1x per masa mute (flag, bukan cooldown).
const lastMuteReply = {};
function clearEscalation(jid) {
  delete mutedUntil[jid];
  delete lastAiReply[jid];
  delete lastMuteReply[jid];
}
// Sweep memori tiap 5 menit: hapus mute & cooldown kedaluwarsa agar tidak bengkak
// lastMuteReply ikut dibersihkan hanya jika mute-nya sudah habis (biar tetap 1x).
setInterval(() => {
  try {
    const now = Date.now();
    for (const k of Object.keys(mutedUntil)) {
      if (mutedUntil[k] <= now) delete mutedUntil[k];
    }
    const cdMs = (config.aiCooldown || 20) * 1000 * 3;
    for (const k of Object.keys(lastAiReply)) {
      if (now - lastAiReply[k] > cdMs) delete lastAiReply[k];
    }
    for (const k of Object.keys(lastMuteReply)) {
      if (!mutedUntil[k] || mutedUntil[k] <= now) delete lastMuteReply[k];
    }
  } catch {}
}, 5 * 60 * 1000).unref?.();
async function redirectToOwner(sock, from, msg, sender, text, tag) {
  try { logEvt('redir', `[${tag || 'ALIH'}] ${(msg.pushName || sender || '').toString().slice(0, 20)}: ${(text || '').slice(0, 80)}`); } catch {}
  stats.redirects += 1; bumpHour('redir');
  const tidur = isSleeping();
  const replyText = tidur ? sleepRedirectText() : 'Saya alihkan ke Tuan Afrial';
  await sock.sendMessage(from, { text: replyText }, { quoted: msg });
  const fwdTag = tidur ? `TIDUR ${tag ? '+ ' + tag : ''}`.trim() : tag;
  await forwardToOwner(sock, sender, msg.pushName, fwdTag ? `[${fwdTag}] ${text}` : text, msg);
  mutedUntil[from] = Date.now() + (config.redirectMuteMin || 60) * 60 * 1000;
  // Reset flag sabar agar chat berikutnya dapat 1x balasan sabar (lalu diam sampai mute dibuka).
  try {
    const pn0 = msg?.key?.senderPn || msg?.key?.participantPn || null;
    for (const k of sessionGuard.muteKeysFor(from, sender, pn0)) delete lastMuteReply[k];
  } catch {}
  // NOTE: tidak ada timer nudge/resume — kalau orangnya diam, bot diam (tidak balas otomatis).
  // Balasan "sabar menunggu" hanya keluar kalau user chat lagi (handler mute di bawah).
  // Mute tetap jalan sampai REDIRECT_MUTE_MIN habis atau owner !lanjut/!sudah.
}

let startInProgress = false;
let reconnectTimer = null;
let reconnectAttempts = 0;
function scheduleReconnect(delayMs) {
  if (reconnectTimer) return;
  const jitter = Math.floor(Math.random() * 2000);
  const delay = Math.min(delayMs + jitter, 5 * 60 * 1000);
  console.log(`⏳ Reconnect dalam ${Math.round(delay / 1000)}s (attempt ${reconnectAttempts + 1})...`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    reconnectAttempts += 1;
    start();
  }, delay);
  try { reconnectTimer.unref?.(); } catch {}
}
// Kode terminal = session/noise keys sudah tidak valid. Retry buta = Bad MAC loop + risiko ban.
// 401=logged out, 405=method not allowed (out of sync), 409/412=conflict, 411=multidevice mismatch.
// 428=connectionClosed (transient, AKIBAT putus — bukan sebab) dan 440=replaced: JANGAN karantina,
// session yang sudah OPEN pernah dibuang sia-sia karena 428. Lihat PR Baileys #2367.
const TERMINAL_SESSION_CODES = new Set([401, 405, 409, 411, 412]);

// Cache pesan untuk getMessage (anti bubble "Menunggu pesan ini..." permanen).
// Baileys memanggil getMessage saat lawan minta kirim-ulang pesan kita yang gagal didekripsi.
// Kalau selalu return undefined -> penerima stuck di bubble "Menunggu pesan" selamanya.
const MSG_CACHE_FILE = path.join(__dirname, 'data-message-cache.json');
const MSG_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const msgCache = new Map();
let msgCacheSaveTimer = null;
try {
  const saved = JSON.parse(fs.readFileSync(MSG_CACHE_FILE, 'utf8') || '{}');
  for (const [id, value] of Object.entries(saved)) {
    if (value?.message && Date.now() - value.ts <= MSG_CACHE_TTL) msgCache.set(id, value);
  }
} catch {}
function saveMsgCache() {
  if (msgCacheSaveTimer) return;
  msgCacheSaveTimer = setTimeout(() => {
    msgCacheSaveTimer = null;
    try {
      fs.writeFileSync(MSG_CACHE_FILE, JSON.stringify(Object.fromEntries(msgCache)), { mode: 0o600 });
      try { fs.chmodSync(MSG_CACHE_FILE, 0o600); } catch {}
    } catch {}
  }, 1000);
  msgCacheSaveTimer.unref?.();
}
function cacheMsg(m) {
  try {
    const id = m?.key?.id;
    if (!id || !m?.message) return;
    msgCache.set(id, { message: m.message, ts: Date.now() });
    while (msgCache.size > 2000) msgCache.delete(msgCache.keys().next().value);
    saveMsgCache();
  } catch {}
}
setInterval(() => {
  try {
    const now = Date.now();
    for (const [id, value] of msgCache) {
      if (now - value.ts > MSG_CACHE_TTL) msgCache.delete(id);
    }
    saveMsgCache();
  } catch {}
}, 60 * 60 * 1000).unref?.();
async function getCachedMessage(key) {
  try {
    const c = key?.id ? msgCache.get(key.id) : null;
    if (c?.message && Date.now() - c.ts <= MSG_CACHE_TTL) return c.message;
  } catch {}
  return undefined;
}

// Sambutan first-chat: sekali per nomor, tersimpan di data-known.json (tahan restart).
// Hormati PN<->LID flip: cek/tandai semua varian nomor pengirim.
const KNOWN_FILE = path.join(__dirname, 'data-known.json');
let knownCache = null;
function loadKnown() {
  if (knownCache) return knownCache;
  try {
    if (fs.existsSync(KNOWN_FILE)) {
      const raw = JSON.parse(fs.readFileSync(KNOWN_FILE, 'utf8') || '{}');
      knownCache = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
    } else knownCache = {};
  } catch { knownCache = {}; }
  return knownCache;
}
function saveKnown() {
  try {
    const keys = Object.keys(knownCache || {});
    // batasi 2000 nomor agar file tidak bengkak (FIFO sederhana)
    if (keys.length > 2000) {
      for (const k of keys.slice(0, keys.length - 2000)) delete knownCache[k];
    }
    fs.writeFileSync(KNOWN_FILE, JSON.stringify(knownCache, null, 2));
  } catch (e) { console.log('save known err:', e.message); }
}
function welcomeNums(sender, senderPn) {
  const out = new Set();
  for (const jid of [sender, senderPn]) {
    if (!jid) continue;
    const num = String(jid).split('@')[0].replace(/\D/g, '');
    if (num && num.length >= 8) out.add(num);
  }
  return [...out];
}
function isKnownContact(sender, senderPn) {
  const m = loadKnown();
  return welcomeNums(sender, senderPn).some((n) => m[n]);
}
function markKnownContact(sender, senderPn) {
  const nums = welcomeNums(sender, senderPn);
  if (!nums.length) return;
  const m = loadKnown();
  let changed = false;
  for (const n of nums) {
    if (!m[n]) { m[n] = new Date().toISOString().slice(0, 10); changed = true; }
  }
  if (changed) saveKnown();
}
function cleanName(pushName) {
  const raw = (pushName || '').trim().split(/\s+/)[0].slice(0, 20);
  // username/ID (ada _ @ angka) bukan nama asli -> jangan dipakai, biar profesional
  if (!raw || raw.length < 2 || /[_@0-9]/.test(raw)) return '';
  return raw;
}
function welcomeText(pushName) {
  if (config.welcomeText) return config.welcomeText;
  const nm = cleanName(pushName);
  const sapa = nm ? `Halo ${nm} 👋` : 'Halo kak 👋';
  return `${sapa} Saya AfriIX, asisten dari tuan afrial, Ada yang bisa saya bantu?`;
}
async function start() {
  if (startInProgress) return;
  startInProgress = true;
  try {
    const license = require('./lib/license');
    const verified = license.verifyLicense(config.licenseKey, config.botNumber);
    const trial = !config.licenseKey ? license.trialCheck() : null;
    if (!verified.ok && !(trial?.active && trial.ok)) {
      console.log(`Lisensi tidak valid: ${verified.reason}${trial ? ` ${trial.reason}` : ''}`);
      startInProgress = false;
      return;
    }
    try { require('./lib/backup').startBackup(); } catch (e) { console.log('backup err:', e.message); }
    sessionGuard.ensureSessionDir();
    const pre = sessionGuard.checkCreds();
    if (!pre.ok && pre.reason !== 'no-creds') {
      console.log(`⚠️ Creds bermasalah (${pre.reason}). Backup tersedia, lanjut dengan kunci yang ada — jika gagal akan dikarantina otomatis.`);
    }
    let state, saveCreds;
    try {
      ({ state, saveCreds } = await useMultiFileAuthState(sessionGuard.SESSION_DIR));
    } catch (e) {
      console.log('❌ Auth state corrupt:', e.message);
      sessionGuard.quarantineSession('auth-state-corrupt');
      console.log('❌ Session corrupt dikarantina. Pairing ulang diperlukan: node index.js');
      startInProgress = false;
      return;
    }
    let version;
    try {
      ({ version } = await fetchLatestBaileysVersion());
    } catch (e) {
      console.log('fetchLatestBaileysVersion gagal, pakai versi bawaan lib:', e.message);
      version = undefined; // Baileys pakai versi bundled — lebih aman daripada crash
    }

    const sock = makeWASocket({
      version,
      auth: state,
      // 'fatal' default: dump SessionEntry/Buffer Baileys (level error) tidak spam log (anti 5.8M/bengkak).
      // Butuh Bad MAC detail? Set LOG_LEVEL=error di .env sementara.
      logger: pino({ level: process.env.LOG_LEVEL || 'fatal' }),
      printQRInTerminal: false,
      // JANGAN ganti browser string setelah pairing — companion baru = kunci Noise/Signal baru = pairing ulang.
      browser: COMPANION,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      keepAliveIntervalMs: 30000,
      // PENTING: jangan return undefined terus. Saat HP lawan gagal dekripsi pesan bot,
      // ia minta retry — getMessage harus kembalikan isi pesan asli dari cache,
      // kalau tidak bubble "Menunggu pesan ini..." tidak pernah sembuh.
      getMessage: getCachedMessage,
      retryRequestDelayMs: 500
    });

    sock.ev.on('creds.update', saveCreds);
    global.__sock = sock; // untuk notifikasi crash

  // Pairing code + QR (dual). requestPairingCode HANYA setelah socket OPEN,
  // dipicu event qr — delay buta bikin server menolak hello (401 1-2 detik).
  let pairingNum = null;
  if (!sock.authState.creds.registered && config.usePairing) {
    pairingNum = config.botNumber;
    if (!pairingNum) pairingNum = (await question('Masukkan nomor WA bot (628xxx): ')).replace(/\D/g, '');
    if (!pairingNum || pairingNum.length < 10) {
      console.log('Nomor tidak valid. Cek BOT_NUMBER di .env, contoh: 6282241160861');
      startInProgress = false;
      return;
    }
    console.log('Menunggu socket siap + QR dari server, lalu minta pairing code...');
  }
  if (!sock.authState.creds.registered && !config.usePairing) {
    console.log('Mode QR aktif (USE_PAIRING=0). Scan QR di console. Untuk kode angka: set USE_PAIRING=1 di .env lalu restart.');
  }
  let pairingRequested = false;
  let pairingCode = '';
  let pairingError = '';

  sock.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect, qr } = u;
    if (qr) qrcode.generate(qr, { small: true }); // dual pairing: QR selalu tampil + kode pairing bila USE_PAIRING=1
    // Minta pairing code tepat saat server kirim qr = socket sudah handshake.
    if (qr && pairingNum && !pairingRequested && !sock.authState.creds.registered) {
      pairingRequested = true;
      (async () => {
        try { await sock.waitForSocketOpen(); } catch {}
        for (let i = 1; i <= 5 && !sock.authState.creds.registered; i++) {
          try {
            const code = await sock.requestPairingCode(pairingNum);
            pairingCode = code;
            pairingError = '';
            console.log(`\n=== PAIRING CODE untuk ${pairingNum}: ${code} ===`);
            console.log('Pilih salah satu:');
            console.log(' 1) WA > Perangkat Tertaut > Tautkan dengan nomor telepon, masukkan kode itu (<20 detik!), ATAU');
            console.log(' 2) Scan QR yang tampil di console ini.');
            console.log('Jangan restart bot sebelum menautkan.\n');
            break;
          } catch (e) {
            pairingError = String(e.message || e).slice(0, 160);
            console.log(`Pairing attempt ${i}/5 gagal: ${e.message}`);
            if (i < 5) await new Promise((r) => setTimeout(r, 8000));
          }
        }
        if (!sock.authState.creds.registered) {
          console.log('Gagal pairing 5x (atau QR belum di-scan) — retry otomatis 30 detik lagi, atau manual: pm2 restart afriix');
          scheduleReconnect(30000);
        }
      })();
    }
    if (connection === 'close') {
      const boom = lastDisconnect?.error;
      const code = boom?.output?.statusCode;
      const msg = boom?.message || '';
      console.log('Koneksi putus:', code, msg.slice(0, 200));
      stats.connected = false;
      try { logEvt('conn', `WA putus (code ${code ?? '?'}) — reconnect otomatis`); } catch {}
      const low = msg.toLowerCase();
      const looksLoggedOut = code === DisconnectReason.loggedOut || code === 401
        || /logged.?out|companion.*removed|device.*removed/.test(low);
      const looksTerminal = TERMINAL_SESSION_CODES.has(code)
        || /multidevice.?mismatch|bad.?session|session.*corrupt|not.?allowed/.test(low);
      const everPaired = !!sock.authState.creds.registered;
      if ((looksLoggedOut || looksTerminal) && !everPaired) {
        // Belum pernah pairing sukses: ini bukan logout/session-mati, cuma handshake gagal.
        // Jangan karantina (kunci fresh belum dipakai) — retry backoff biasa.
        console.log(`Close ${code ?? '?'} sebelum pairing sukses — retry otomatis tanpa karantina.`);
      } else {
        if (looksLoggedOut) {
          try { await notifyOwner(sock, '❌ *AfriIX*: perangkat di-logout dari WA (401). Session dikarantina — pairing ulang diperlukan. Bot TIDAK auto-reconnect.'); } catch {}
          sessionGuard.quarantineSession('logged-out-401');
          console.log('Logged out. Session dikarantina, pairing ulang: node index.js');
          return; // stop — reconnect buta hanya membakar pre-key
        }
        if (looksTerminal) {
          try { await notifyOwner(sock, `❌ *AfriIX*: sesi korup/terminal (code ${code}). Session dikarantina — pairing ulang diperlukan.`); } catch {}
          sessionGuard.quarantineSession(`terminal-${code}`);
          console.log(`Terminal code ${code}. Session dikarantina, pairing ulang: node index.js`);
          return;
        }
      }
      try { await notifyOwner(sock, '🔴 *AfriIX* tidak aktif: koneksi WhatsApp terputus. Mencoba tersambung ulang otomatis...'); } catch {}
      // Transient (408/500/515/timeout/ECONNRESET): exponential backoff anti reconnect-storm.
      const base = 5000 * Math.pow(2, Math.min(reconnectAttempts, 5));
      scheduleReconnect(base);
    }
    if (connection === 'open') {
      console.log('✅', BOT_NAME, 'terhubung sebagai', sock.user?.id);
      try { logEvt('conn', 'WA tersambung ✅'); } catch {}
      reconnectAttempts = 0;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      sessionGuard.backupCreds();
      const wasDown = !stats.connected;
      stats.connected = true;
      stats.user = sock.user?.id || '-';
      try {
        await notifyOwner(sock, wasDown
          ? '✅ *AfriIX* aktif kembali dan tersambung ke WhatsApp.'
          : '✅ *AfriIX* aktif dan tersambung ke WhatsApp.');
      } catch {}
    }
  });
  // NOTE: notifyOwner() didefinisikan di bawah (function hoisting) — aman dipakai di connection.update.

  // Dashboard monitoring (sekali saja, tidak ikut reconnect)
  if (config.dash.enabled && !global.__dashOn) {
    global.__dashOn = true;
    try {
      startDashboard({
        host: config.dash.host || '127.0.0.1',
        port: config.dash.port,
        token: config.dash.token,
        getState: () => {
          const now = Date.now();
          const hours = Object.keys(hourBuckets).sort().slice(-24)
            .map((k) => ({ h: hourLabel(k), ...hourBuckets[k] }));
          const dndExp = sched.getDnd();
          return {
            startedAt: stats.startedAt,
            connected: stats.connected,
             user: stats.user,
             pairing: { available: !!(global.__sock && !global.__sock.authState.creds.registered), code: pairingCode || '', error: pairingError || '', number: pairingNum || config.botNumber || '' },
             autoAi,
            enableAI: !!config.enableAI,
            cooldown: config.aiCooldown || 20,
            redirectMuteMin: config.redirectMuteMin || 60,
            sleep: { start: config.sleepStart ?? 23, end: config.sleepEnd ?? 5, now: isSleeping() },
            dnd: dndExp ? { on: true, left: sched.fmtLeft(dndExp - now) } : { on: false },
             msgIn: stats.msgIn,
             aiOut: stats.aiOut,
             messageMeta: stats.meta,
             aiTelemetry: aiTelemetry(),
             redirects: stats.redirects,
            lastFrom: stats.lastFrom,
            lastAt: stats.lastAt,
            lastDrop: { at: lastDrop.at, reason: lastDrop.reason, from: lastDrop.from },
            aiModel1: config.ai?.model || '-',
            aiModel2: config.ai?.model2 || '-',
            key1: config.ai?.key ? 'terisi' : 'kosong',
            key2: config.ai?.key2 ? 'terisi' : 'kosong',
            muted: Object.entries(mutedUntil)
              .filter(([, exp]) => exp > now)
              .map(([jid, exp]) => ({ num: jid.split('@')[0], left: muteLeft(exp) })),
            events: evtLog.slice(0, 40),
            hourly: hours,
          };
        },
        setAuto: (v) => { autoAi = !!v; try { logEvt('dash', `Auto-AI → ${autoAi ? 'ON' : 'OFF'} (dashboard)`); } catch {} return true; },
        actions: {
           log: (type, msg) => logEvt(type, msg),
           requestPairing: async (number) => {
             if (sock.authState.creds.registered) throw new Error('bot sudah terhubung');
             const n = String(number || pairingNum || config.botNumber || '').replace(/\D/g, '');
             if (n.length < 10) throw new Error('nomor WA tidak valid');
             pairingNum = n;
             try { await sock.waitForSocketOpen(); } catch {}
             pairingCode = await sock.requestPairingCode(n);
             pairingError = '';
             logEvt('pair', `Pairing code dibuat untuk ${n.slice(0, 4)}****`);
             return { code: pairingCode };
           },
           setDnd: (minutes) => {
            if (!minutes || minutes <= 0) { sched.setDnd(0); logEvt('dash', 'DND dimatikan (dashboard)'); return { on: false }; }
            const ms = Math.min(minutes, 24 * 60) * 60 * 1000;
            sched.setDnd(ms);
            logEvt('dash', `DND aktif ${minutes}mnt (dashboard)`);
            return { on: true, left: sched.fmtLeft(ms) };
          },
          unmute: (num) => {
            if (!num || num === 'all') {
              for (const k of Object.keys(mutedUntil)) clearEscalation(k);
              logEvt('dash', 'Semua mute dibuka (dashboard)');
              return { opened: 'all' };
            }
            const n = String(num).replace(/\D/g, '');
            sessionGuard.clearEscalationAny(clearEscalation, n + '@s.whatsapp.net', n + '@lid', null);
            logEvt('dash', `Mute ${n} dibuka (dashboard)`);
            return { opened: n };
          },
          setCooldown: (sec) => {
            const v = Math.max(5, Math.min(300, parseInt(sec, 10) || 20));
            config.aiCooldown = v;
            logEvt('dash', `AI cooldown → ${v}dtk (dashboard)`);
            return { cooldown: v };
          },
          testAi: async (prompt) => {
            const { aiReply, detectLang } = require('./lib/ai');
            const p = String(prompt || '').slice(0, 300);
            if (!p) throw new Error('prompt kosong');
            const t0 = Date.now();
            const lang = detectLang(p);
            const ans = await aiReply(p, 'dash-test', 'Dashboard', lang, 'dash');
            return { answer: ans || '(AI tidak menjawab — cek KEY / koneksi)', ms: Date.now() - t0, lang };
          },
          getBrain: () => {
            const { brainStats } = require('./lib/ai');
            let sum = null;
            try { sum = require('./lib/ai').brainSummary?.() || null; } catch {}
            return { text: brainStats(), summary: sum };
          },
          resetBrain: () => {
            try { require('./lib/ai').resetBrain?.(); } catch (e) { throw new Error('gagal reset: ' + e.message); }
            logEvt('dash', 'Otak AI direset (dashboard)');
            return { ok: true };
          },
          getInstance: () => {
            let waVer = '-';
            try { waVer = require('@whiskeysockets/baileys/package.json').version || '-'; } catch {}
            let sess = '?';
            try { const c = require('./lib/session').checkCreds(); sess = c.ok ? 'OK ✅' : 'RUSAK ❌ (' + c.reason + ')'; } catch {}
            const upMin = Math.floor((Date.now() - stats.startedAt) / 60000);
            return {
              name: BOT_NAME, number: stats.user, waLib: waVer, node: process.version,
              platform: os.platform() + '/' + os.arch(), session: sess,
              uptime: Math.floor(upMin / 1440) + 'h ' + Math.floor((upMin % 1440) / 60) + 'j ' + (upMin % 60) + 'm',
              msgIn: stats.msgIn, aiOut: stats.aiOut,
            };
          },
        },
      });
    } catch (e) { console.log('dashboard err:', e.message); }
  }

  if (!global.__heartbeatOn && config.monitorUrl && config.monitorToken) {
    global.__heartbeatOn = true;
    startHeartbeat({
      url: config.monitorUrl,
      token: config.monitorToken,
      intervalSec: config.monitorInterval,
      getState: () => ({
        num: config.botNumber || stats.user?.split('@')[0] || '',
        up: Math.floor((Date.now() - stats.startedAt) / 1000),
        ok: stats.connected,
        in: stats.msgIn,
        out: stats.aiOut,
        meta: stats.meta
      })
    });
    console.log('📡 Monitoring heartbeat aktif.');
  }

  // Laporan harian otomatis ke owner (sekali saja, tidak ikut reconnect)
  if (!global.__dailyOn) {
    global.__dailyOn = true;
    try {
      startDaily({
        hour: config.dailyReportHour ?? 21,
        getState: () => ({
          connected: stats.connected,
          autoAi,
          msgIn: stats.msgIn,
          aiOut: stats.aiOut,
          redirects: stats.redirects,
          lastFrom: stats.lastFrom,
          lastAt: stats.lastAt,
          muted: Object.entries(mutedUntil).filter(([, exp]) => exp > Date.now()).map(([jid]) => ({ num: jid.split('@')[0] })),
        }),
        notifyOwner: (t) => notifyOwner(sock, t),
      });
      console.log('📊 Laporan harian aktif.');
    } catch (e) { console.log('daily err:', e.message); }
  }

  // Pengingat waktu + rutin harian (sekali saja, tahan restart)
  if (!global.__schedStarted) {
    global.__schedStarted = true;
    try {
      sched.startSchedulers((to, t) => sock.sendMessage(to, { text: t }));
      console.log('⏰ Scheduler pengingat aktif.');
    } catch (e) { console.log('sched err:', e.message); }
  }

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const metaStartedAt = Date.now();
    try {
      // Simpan semua pesan (termasuk fromMe) ke cache untuk kebutuhan retry dekripsi.
      try {
        for (const m of (messages || [])) cacheMsg(m);
      } catch {}
      const msg = messages[0];
      if (msg) {
        const m = msg.message || {};
        const type = m.imageMessage ? 'image' : m.videoMessage ? 'video' : m.audioMessage ? 'audio' : m.documentMessage ? 'document' : m.stickerMessage ? 'sticker' : 'text';
        logMessageMeta(msg, msg.key?.fromMe ? 'out' : 'in', type, metaStartedAt);
      }
      // Pesan dari HP bot sendiri: abaikan SEMUA kecuali !tts/!vn/!suara
      // (biar dari nomor bot bisa kirim VN ke orang lain, tanpa loop).
      if (msg?.key?.fromMe) {
        try {
          const t = getText(msg).trim();
          if (t.startsWith(config.prefix)) {
            const [cmdRaw, ...rest] = t.slice(1).split(' ');
            const c = (cmdRaw || '').toLowerCase();
            if (c === 'tts' || c === 'vn' || c === 'suara') {
              const arg = rest.join(' ').trim();
              const fromMe = msg.key.remoteJid;
              if (fromMe && !fromMe.endsWith('@g.us') && !fromMe.endsWith('@newsletter') && !fromMe.includes('@broadcast')) {
                let targetJid = fromMe;
                let ttsText = arg;
                const m = arg.match(/^(\d{10,16})\s+([\s\S]+)/);
                if (m) { targetJid = m[1] + '@s.whatsapp.net'; ttsText = m[2]; }
                if (ttsText) {
                  const buf = await ttsBuffer(ttsText.slice(0, 300), 'id');
                  const tmpIn = path.join(os.tmpdir(), `tts-${Date.now()}.mp3`);
                  const tmpOut = path.join(os.tmpdir(), `tts-${Date.now()}.ogg`);
                  let sent = false;
                  try {
                    fs.writeFileSync(tmpIn, buf);
                    await run('ffmpeg', ['-y', '-v', 'error', '-i', tmpIn, '-c:a', 'libopus', '-b:a', '64k', tmpOut], 20000);
                    const ogg = fs.readFileSync(tmpOut);
                    if (ogg && ogg.length) {
                      await sock.sendMessage(targetJid, { audio: ogg, mimetype: 'audio/ogg; codecs=opus', ptt: true });
                      sent = true;
                    }
                  } catch {}
                  finally { try { fs.unlinkSync(tmpIn); } catch {} try { fs.unlinkSync(tmpOut); } catch {} }
                  if (!sent) await sock.sendMessage(targetJid, { audio: buf, mimetype: 'audio/mpeg' });
                  if (targetJid !== fromMe) await sock.sendMessage(fromMe, { text: `✅ VN terkirim ke ${targetJid.split('@')[0]}` });
                }
              }
            }
          }
        } catch {}
        return;
      }
      if (!msg?.message) return;
      const from = msg.key.remoteJid;
      // Saluran (newsletter): jangan balas otomatis sama sekali.
      // Bot tidak bisa membalas di saluran, dan admin post tidak boleh memicu AI.
      if (from.endsWith('@newsletter')) return;
      const isGroup = from.endsWith('@g.us');
      if (isGroup) return;
      let text = getText(msg).trim();
      // Teks kosong + bukan media (mis. sticker tanpa caption? tidak) -> abaikan.
      // Media tanpa caption tetap diproses agar masuk moderasi.
      if (!text && !msg.message?.imageMessage && !msg.message?.videoMessage && !msg.message?.documentMessage && !msg.message?.stickerMessage && !msg.message?.audioMessage) return;
      const sender = msg.key.participant || from;
      // LID: nomor asli hanya untuk display/log. Balasan SELALU ke `from` (JID asli),
      // karena session Signal terikat ke JID itu — kirim ke senderPn merusak sesi (Baileys #1744).
      const senderPn = msg.key.senderPn || msg.key.participantPn || null;

      // Media tanpa caption (text kosong) tetap diproses agar masuk moderasi.
      const kind0 = mediaKind(msg);
      // hanya respon perintah ! di grup, di chat pribadi boleh !ai / AI bebas
      // (media non-perintah di grup tetap lolos ke moderasi di bawah)
      const isCmd = text.startsWith(config.prefix);
      // Absen natural: "hadir" polos di grup tetap dicatat (tanpa !) bila absen aktif
      if (isGroup && !isCmd && /^(hadir|hadir +(kak|bang|mas|pak|bu|min))[\s✅🙏.]*$/i.test(text.trim())) {
        try {
          const a = group.markHadir(from, sender, msg.pushName);
          if (a) { stats.msgIn += 1; return; } // tercatat diam-diam, tidak spam chat
        } catch {}
      }
      if (isGroup && !isCmd && !kind0) return;

      console.log(`[${isGroup ? 'GRUP' : 'PRIBADI'}] ${sender}: ${text.slice(0, 80)}`);
      stats.msgIn += 1; bumpHour('in');
      stats.lastFrom = sender.split('@')[0];
      stats.lastAt = new Date().toLocaleString('id-ID');

      // Pesan dari pemilik (Tuan Afrial) tidak dibalas AI. Perintah ! tetap jalan.
      // FIX !auto "tidak bekerja": owner sering terdeteksi sebagai @lid (bukan PN),
      // sehingga senderNum != OWNER_NUMBER. Cek juga senderPn + from.
      const senderNum = (sender || '').split('@')[0].replace(/\D/g, '');
      const senderPnNum = (senderPn || '').split('@')[0].replace(/\D/g, '');
      const fromNum = (from || '').split('@')[0].replace(/\D/g, '');
      const ownerNum = (config.ownerNumber || '').replace(/\D/g, '');
      const isOwner = !!(ownerNum && (senderNum === ownerNum || senderPnNum === ownerNum || fromNum === ownerNum));

      // Mode jangan ganggu: bot diam total kecuali owner.
      if (!isOwner && sched.getDnd()) { markDrop('dnd', from); return; }

      // Sedang dialihkan ke pemilik -> jangan AI-an, tapi kalau user chat lagi
      // balas "sabar menunggu" hanya 1x per masa mute (selanjutnya diam).
      // Pemilik bisa buka lagi pakai !lanjut <nomor> / !sudah <nomor>.
      // Cek semua varian JID (PN<->LID flip) agar mute tidak bocor.
      if (!isOwner && sessionGuard.isMutedAny(mutedUntil, from, sender, senderPn)) {
        if (!isGroup) {
          // Hanya 1x per masa mute: cek semua varian JID (PN<->LID flip).
          let already = false;
          try {
            for (const k of sessionGuard.muteKeysFor(from, sender, senderPn)) {
              if (lastMuteReply[k]) { already = true; break; }
            }
          } catch { already = !!lastMuteReply[from]; }
          if (!already) {
            try {
              for (const k of sessionGuard.muteKeysFor(from, sender, senderPn)) lastMuteReply[k] = 1;
            } catch { lastMuteReply[from] = 1; }
            try {
              const t = isSleeping()
                ? `🌙 Tuan Afrial masih tidur (${sleepLabel()} WIB) 🙏 Mohon sabar menunggu ya, nanti dibalas setelah bangun.`
                : 'Mohon sabar menunggu ya 🙏 Tuan Afrial akan segera membalas.';
              await sock.sendMessage(from, { text: t }, { quoted: msg });
              logReply(from, t);
              markDrop('mute-sabar-1x', from);
              // SUSULAN dihapus sesuai request owner: chat susulan saat mute
              // TIDAK diteruskan lagi ke owner (biar tidak berisik).
            } catch {}
          } else markDrop('mute-silent', from);
        } else markDrop('mute-silent-grup', from);
        return;
      }

      // ===== Log chat (metadata saja, opt-in via LOG_CHAT=1) =====
      if (config.logChat) {
        try {
          const kind = text.startsWith(config.prefix) ? 'cmd' : (mediaKind(msg) || 'text');
          const line = JSON.stringify({ t: new Date().toISOString(), chat: isGroup ? 'grup' : 'pribadi', from: senderNum || '?', kind, msg: text.slice(0, 80) });
          const logDir = path.join(__dirname, 'logs');
          try { if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true }); } catch {}
          fs.appendFile(path.join(logDir, 'chat.log'), line + '\n', () => {});
        } catch {}
      }

      // ===== Anti-spam: batasi flood (non-pemilik). Owner bebas. =====
      if (!isOwner) {
        const spam = spamCheck(sender, config.spamLimit || 15);
        if (spam !== 'ok') {
          if (spam === 'mute' && !isGroup) {
            mutedUntil[from] = Date.now() + 5 * 60 * 1000;
            try { logEvt('mute', `Spam/flood ${senderNum} → mute 5mnt`); } catch {}
            try { await notifyOwner(sock, `🚫 ${senderNum} di-mute 5 mnt (spam/flood). Buka: !lanjut ${senderNum}`); } catch {}
          }
          markDrop('spam-' + spam, from);
          return;
        }
      }

      // ===== Antilink grup (hanya jika di-ON-kan per grup via !antilink on) =====
      // Admin/owner dikecualikan. Butuh bot jadi admin untuk hapus pesan.
      if (isGroup && !isOwner && !isCmd && group.isAntilinkOn(from) && group.hasLink(text)) {
        try {
          const meta = await sock.groupMetadata(from);
          const me = meta.participants.find((p) => p.id === sender);
          const admin = me?.admin === 'admin' || me?.admin === 'superadmin';
          const sNum = (sender || '').split('@')[0].replace(/\D/g, '');
          const oNum = (config.ownerNumber || '').replace(/\D/g, '');
          if (!admin && !(oNum && sNum === oNum)) {
            try { await sock.sendMessage(from, { delete: msg.key }); } catch {}
            if (!modWarnCooldown(from + '|antilink')) {
              try { await sock.sendMessage(from, { text: '🔗 Link tidak diizinkan di grup ini 🙏', mentions: [sender] }); } catch {}
            }
            markDrop('antilink', from);
            return;
          }
        } catch {}
      }

      // ===== Moderasi konten tidak pantas (porn/dll) =====
      // Grup: hapus pesan (butuh bot admin) + peringatan. Private: pesan lawan
      // tidak bisa dihapus via API WA -> peringatan + teruskan ke owner + mute
      // otomatis setelah MOD_MAX_PRIVATE pelanggaran.
      if (config.enableModeration && !isOwner) {
        const kind = mediaKind(msg);
        const scanText = `${text}\n${extraScanOf(msg)}`;
        let bad = containsBanned(scanText);
        if (!bad && kind && (kind === 'image' || kind === 'video' || kind === 'sticker') && config.modApiUrl && config.modApiKey) {
          try {
            const buf = await downloadMediaMessage(msg, 'buffer', {});
            if (buf && buf.length > 0 && buf.length <= 10 * 1024 * 1024) {
              if (await visualNsfw(buf, { url: config.modApiUrl, key: config.modApiKey })) bad = true;
            }
          } catch (e) { console.log('mod download err:', e.message); }
        }
        if (bad) {
          const label = kind || 'teks';
          if (isGroup && config.modDeleteGroup) {
            try { await sock.sendMessage(from, { delete: msg.key }); } catch {} // butuh bot admin
            if (!modWarnCooldown(from)) {
              try { await sock.sendMessage(from, { text: '⚠️ Pesan tidak pantas dihapus. Jaga chat tetap sopan ya 🙏', mentions: [sender] }); } catch {}
            }
            try { await forwardToOwner(sock, sender, msg.pushName, `[MODERASI GRUP ${label}] ${text.slice(0, 300)}`, msg); } catch {}
          } else if (!isGroup) {
            const n = addViolation(sender);
            const maxV = config.modMaxPrivate || 3;
            await sendHuman(sock, from, msg, 'Maaf, pesan seperti itu tidak bisa saya teruskan 🙏 Yuk jaga chat tetap sopan.');
            try { await forwardToOwner(sock, sender, msg.pushName, `[MODERASI PRIBADI ${label} #${n}] ${(text || '').slice(0, 300)}`, msg); } catch {}
            if (n >= maxV) {
              mutedUntil[from] = Date.now() + 30 * 60 * 1000;
              try { logEvt('mute', `Konten tak pantas ${senderNum} (${n}x) → mute 30mnt`); } catch {}
              try { await notifyOwner(sock, `🚫 ${senderNum} dimute 30 mnt (konten tidak pantas ${n}x). Buka: !lanjut ${senderNum}`); } catch {}
            }
          }
          return;
        }
      }

      // ===== AI baca gambar + VN masuk (asisten pribadi, private saja) =====
      // Gambar: foto + caption (atau tanpa caption) -> AI vision jawab isi gambar.
      // VN: audio -> transkrip Groq Whisper -> jadi teks untuk AI di bawah.
      if (!isGroup && !isOwner && config.enableAI && autoAi) {
        const mkind = mediaKind(msg);
        if (mkind === 'image' && !isCmd) {
          try {
            const buf = await downloadMediaMessage(msg, 'buffer', {});
            const ans = await aiVision(buf, text, {});
            if (ans) {
              const lang = detectLang(text || ans);
              learnChat(text || '[gambar]', ans, lang, senderNum);
              stats.aiOut += 1; bumpHour('ai');
              await sendHuman(sock, from, msg, withSleepNote(ans, isGroup));
              logReply(from, ans);
            } else {
              await sendHuman(sock, from, msg, 'Maaf, saya belum bisa baca gambar itu 🙏');
            }
          } catch (e) { await sendHuman(sock, from, msg, 'Gagal baca gambar: ' + String(e.message || e).slice(0, 150)); }
          return;
        }
        if (mkind === 'audio' && !text && !isCmd) {
          try {
            await sock.sendPresenceUpdate('composing', from);
            const buf = await downloadMediaMessage(msg, 'buffer', {});
            const tr = await transcribeGroq(buf, msg.message?.audioMessage?.mimetype || 'audio/ogg');
            if (tr) { text = tr; console.log(`[VN->teks] ${sender}: ${tr.slice(0, 80)}`); }
            else { await sendHuman(sock, from, msg, 'Maaf, VN-nya tidak jelas 🙏 Bisa ketik saja?'); return; }
          } catch (e) { await sendHuman(sock, from, msg, 'Gagal dengar VN: ' + String(e.message || e).slice(0, 150)); return; }
        }
      }

      // ===== Sambutan first-chat (sekali per nomor, chat pribadi saja) =====
      // First-chat: hanya sapaan saja (request owner), jawaban AI dibuang.
      let welcomePrefix = null;
      if (!isCmd && !isGroup && !isOwner && config.enableWelcome && text.length > 1 && !shouldSkip(text)) {
        if (!isKnownContact(sender, senderPn)) {
          markKnownContact(sender, senderPn);
          welcomePrefix = withSleepNote(welcomeText(msg.pushName), isGroup);
        }
      }

      // ===== Panggilan nama → langsung alihkan ke pemilik =====
      if (!isCmd && !isGroup && !isOwner && callsOwner(text)) {
        await redirectToOwner(sock, from, msg, sender, text, 'PANGGIL NAMA');
        return;
      }

      // ===== Pengingat natural tanpa prefix ("ingatkan besok jam 7 minum obat") =====
      // Jalan walau AI OFF — ini fitur scheduler, bukan AI. Prioritas di atas AI.
      if (!isCmd && !isGroup && !isOwner && text.length > 1 && sched.isReminderIntent(text)) {
        try {
          const natLang = detectLang(text);
          const natNum = (sender || '').split('@')[0].replace(/\D/g, '');
          const nat = sched.parseNatural(text);
          if (nat) {
            const item = sched.addOnce(from, nat.ms, nat.text);
            const confirm = item ? `⏰ Siap, saya ingatkan ${sched.fmtLeft(nat.ms)} lagi:\n${nat.text}\n\nLihat: *!jadwal* | Batal: *!batal 1*` : 'Pengingat penuh (max 100).';
            learnChat(text, confirm, natLang, natNum);
            stats.aiOut += 1; bumpHour('ai');
            await sendHuman(sock, from, msg, withSleepNote((welcomePrefix ? welcomePrefix + '\n\n' : '') + confirm, isGroup));
            logReply(from, confirm);
            return;
          }
        } catch {}
      }

      // ===== Auto-jawab AI di chat pribadi (tanpa !) — 1 BUBBLE =====
      // Grup: hanya perintah ! biar tidak spam. Pemilik: tidak dibalas AI.
      if (!isCmd && !isGroup && !isOwner && config.enableAI && autoAi && text.length > 1) {
        if (shouldSkip(text)) { markDrop('skip-pendek/otp', from); return; }
        const lang = detectLang(text);
        const senderNum = (sender || '').split('@')[0].replace(/\D/g, '');
        // First-chat: hanya sapaan saja, jawaban AI bawah dibuang (request owner)
        const one = async (body, bodyIsGreet = false) => {
          const msg1 = welcomePrefix || body;
          learnChat(text, body, lang, senderNum);
          stats.aiOut += 1; bumpHour('ai');
          await sendHuman(sock, from, msg, withSleepNote(msg1, isGroup));
          logReply(from, msg1);
        };
        // 0. Bahasa tidak dikenal -> langsung alihkan ke Tuan Afrial
        if (lang === 'unknown' || isUnknownLanguage(text)) {
          learnChat(text, '[redirect-unknown]', lang, senderNum);
          await redirectToOwner(sock, from, msg, sender, text, 'BAHASA TIDAK DIKENAL');
          return;
        }
        // 1. jawaban instan tanpa API (paling cepat) — tetap dibatasi 5 detik/chat biar tidak spam
        const fast = quickReply(text);
        if (fast) {
          if (!quickCooldown(from)) { markDrop('quick-cooldown', from); return; }
          await one(fast, isGreeting(text));
          return;
        }
        // 2. AI dengan cooldown (API gratis limit ~15 detik)
        const now = Date.now();
        const cd = (config.aiCooldown || 20) * 1000;
        if (now - (lastAiReply[from] || 0) < cd) { markDrop('cooldown', from); return; }
        lastAiReply[from] = now;
        try { await sock.sendPresenceUpdate('composing', from); } catch {}
        const ans = await aiReply(text, sender, msg.pushName, lang, senderNum);
        // 3. AI tidak paham / diminta alihkan -> ke Tuan Afrial
        if (ans && /(TIDAK_PAHAM|ALIHKAN)/.test(ans)) {
          const tag = /ALIHKAN/.test(ans) ? 'MINTA TUAN AFRIAL' : 'AI TIDAK PAHAM';
          learnChat(text, ans, lang, senderNum);
          await redirectToOwner(sock, from, msg, sender, text, tag);
          return;
        }
        if (ans) { await one(ans); }
        else {
          // AI mati/gagal: jawab profesional + teruskan ke owner (penting, boleh 2 bubble)
          const prof = lang === 'jv_ngoko' ? 'Ngapunten, kulo dereng saged paring jawaban sakniki. Pesan kakak kulo terusaken dhateng Tuan Afrial, enggal dipun tindak lanjuti. 🙏'
            : lang === 'jv_madya' ? 'Ngapunten, kulo dereng saged jawab sakniki. Pesan sampean kulo terusaken dhateng Tuan Afrial. 🙏'
            : lang === 'jv_krama' ? 'Pangapunten, kulo dereng saged paring jawaban sakmeniko. Pesan panjenengan kulo terusaken dhateng Tuan Afrial. 🙏'
            : (lang === 'en' || lang === 'en_slang') ? 'Apologies, I am unable to answer at the moment. Your message has been recorded and forwarded to Mr. Afrial for follow-up. 🙏'
            : 'Mohon maaf kak, saya belum bisa menjawab saat ini. Pesan kakak sudah saya catat dan diteruskan ke Tuan Afrial untuk ditindaklanjuti. 🙏';
          learnChat(text, prof, lang, senderNum);
          await sendHuman(sock, from, msg, withSleepNote(welcomePrefix || prof, isGroup));
          logReply(from, welcomePrefix || prof);
          await forwardToOwner(sock, sender, msg.pushName, `[AI OFFLINE] ${text}`, msg);
        }
        return;
      }
      if (!isCmd) {
        if (!isGroup && !isOwner) {
          if (!config.enableAI) markDrop('ai-disabled', from);
          else if (!autoAi) markDrop('autoai-off', from);
          else markDrop('ai-skip', from);
        }
        return;
      }

      const [cmdRaw, ...rest] = text.slice(1).split(' ');
      const arg = rest.join(' ').trim();
      const c = cmdRaw.toLowerCase();

      // ===== Anti-spam BOT (non-owner): cooldown 3 detik + drop duplikat 30 detik =====
      // Owner bebas agar bisa administrasi cepat. !hadir/!pilih tetap kena cooldown
      // ringan agar rekap vote tidak dobel.
      if (!isOwner) {
        if (!cmdCooldown(sender, 3000)) { markDrop('cmd-cooldown', from); return; }
        if (dupCheck(sender, text, 30000)) { markDrop('cmd-duplikat', from); return; }
      }

      // --- ping ---
      if (c === 'ping') {
        await sock.sendMessage(from, { text: `Pong! ✅\nUptime: ${uptimeText()}` }, { quoted: msg });
        return;
      }
      if (c === 'menu' || c === 'help') {
        await sock.sendMessage(from, { text: personalMenu(BOT_NAME) }, { quoted: msg });
        return;
      }

      // --- sticker gambar ---
      if (c === 'sticker' || c === 's') {
        if (!config.enableSticker) return;
        const ctx = msg.message?.extendedTextMessage?.contextInfo
          || msg.message?.imageMessage?.contextInfo
          || msg.message?.videoMessage?.contextInfo;
        const quoted = ctx?.quotedMessage;
        // dukung viewOnce & ephemeral: unwrap satu level
        const unwrap = (m) => m?.viewOnceMessage?.message || m?.viewOnceMessageV2?.message
          || m?.ephemeralMessage?.message || m;
        const directImg = unwrap(msg.message)?.imageMessage;
        const quotedImg = unwrap(quoted)?.imageMessage;
        let target = null;
        if (directImg) target = msg;
        else if (quotedImg) {
          // bentuk WAMessage valid untuk downloadMediaMessage (Baileys 6.x)
          target = {
            key: { ...msg.key, participant: ctx?.participant || msg.key.participant },
            message: { imageMessage: quotedImg }
          };
        }
        if (!target) {
          await sock.sendMessage(from, { text: 'Kirim gambar + caption *!sticker* atau reply gambar.' }, { quoted: msg });
          return;
        }
        try {
          const buf = await downloadMediaMessage(target, 'buffer', {});
          if (!buf || !buf.length) throw new Error('media kosong');
          const webp = await makeStickerBuffer(buf);
          await sock.sendMessage(from, { sticker: webp }, { quoted: msg });
        } catch (e) {
          await sock.sendMessage(from, { text: 'Gagal bikin stiker: ' + String(e.message || e).slice(0, 200) }, { quoted: msg });
        }
        return;
      }

      // --- stiker teks ---
      if (c === 'stext') {
        if (!arg) {
          await sock.sendMessage(from, { text: 'Contoh: *!stext halo dunia*' }, { quoted: msg });
          return;
        }
        if (arg.length > 120) {
          await sock.sendMessage(from, { text: 'Teks max 120 karakter.' }, { quoted: msg });
          return;
        }
        try {
          const webp = await makeTextSticker(arg);
          await sock.sendMessage(from, { sticker: webp }, { quoted: msg });
        } catch (e) {
          await sock.sendMessage(from, { text: 'Gagal: ' + e.message }, { quoted: msg });
        }
        return;
      }

      // --- VN / TTS (asisten pribadi) ---
      // Google TTS = MP3. VN WA wajib OGG/Opus → convert via ffmpeg bila ada,
      // kalau ffmpeg tidak ada kirim sebagai audio biasa (tetap bisa diputar).
      // Owner bisa kirim ke chat lain: !tts 628xxx halo sayang
      if (c === 'tts' || c === 'vn' || c === 'suara') {
        if (!arg) {
          await sock.sendMessage(from, { text: 'Contoh: *!tts halo, ini AfriIX*\nOwner ke nomor lain: *!tts 628xxx halo*' }, { quoted: msg });
          return;
        }
        if (!isOwner) {
          const h = heavyCheck(sender, 'tts', 15000);
          if (!h.ok) { await sock.sendMessage(from, { text: `⏳ Tunggu ${h.left} detik dulu ya sebelum bikin VN lagi.` }, { quoted: msg }); return; }
        }
        let targetJid = from;
        let ttsText = arg;
        if (isOwner) {
          const m = arg.match(/^(\d{10,16})\s+([\s\S]+)/);
          if (m) { targetJid = m[1] + '@s.whatsapp.net'; ttsText = m[2]; }
        }
        try {
          await sock.sendPresenceUpdate('recording', targetJid);
          const buf = await ttsBuffer(ttsText.slice(0, 300), 'id');
          const tmpIn = path.join(os.tmpdir(), `tts-${Date.now()}.mp3`);
          const tmpOut = path.join(os.tmpdir(), `tts-${Date.now()}.ogg`);
          let sent = false;
          try {
            fs.writeFileSync(tmpIn, buf);
            await run('ffmpeg', ['-y', '-v', 'error', '-i', tmpIn, '-c:a', 'libopus', '-b:a', '64k', tmpOut], 20000);
            const ogg = fs.readFileSync(tmpOut);
            if (ogg && ogg.length) {
              await sock.sendMessage(targetJid, { audio: ogg, mimetype: 'audio/ogg; codecs=opus', ptt: true }, targetJid === from ? { quoted: msg } : undefined);
              sent = true;
            }
          } catch {}
          finally { try { fs.unlinkSync(tmpIn); } catch {} try { fs.unlinkSync(tmpOut); } catch {} }
          if (!sent) {
            // fallback: audio biasa (bukan VN) — selalu bisa diputar
            await sock.sendMessage(targetJid, { audio: buf, mimetype: 'audio/mpeg' }, targetJid === from ? { quoted: msg } : undefined);
          }
          if (targetJid !== from) await sock.sendMessage(from, { text: `✅ VN terkirim ke ${targetJid.split('@')[0]}` }, { quoted: msg });
        } catch (e) {
          await sock.sendMessage(from, { text: 'Gagal bikin VN: ' + String(e.message || e).slice(0, 150) }, { quoted: msg });
        }
        return;
      }

      // --- AI ---
      if (c === 'ai') {
        if (!arg) {
          await sock.sendMessage(from, { text: 'Contoh: *!ai buatkan caption santai*' }, { quoted: msg });
          return;
        }
        if (!isOwner) {
          const cdAi = Math.max(10, Math.min(config.aiCooldown || 20, 60)) * 1000;
          if (Date.now() - (lastAiReply[from] || 0) < cdAi) {
            await sock.sendMessage(from, { text: `⏳ AI lagi cooldown, coba lagi ${Math.ceil((cdAi - (Date.now() - lastAiReply[from])) / 1000)} detik ya.` }, { quoted: msg });
            markDrop('ai-cmd-cooldown', from);
            return;
          }
          lastAiReply[from] = Date.now();
        }
        const aiLang = detectLang(arg);
        const aiNum = (sender || '').split('@')[0].replace(/\D/g, '');
        if (!isGroup && !isOwner && (aiLang === 'unknown' || isUnknownLanguage(arg))) {
          learnChat(arg, '[redirect-unknown]', aiLang, aiNum);
          await redirectToOwner(sock, from, msg, sender, arg, 'BAHASA TIDAK DIKENAL');
          return;
        }
        const fast = quickReply(arg);
        if (fast) {
          stats.aiOut += 1; bumpHour('ai');
          learnChat(arg, fast, aiLang, aiNum);
          await sendHuman(sock, from, msg, withSleepNote(fast, isGroup));
          logReply(from, fast);
          return;
        }
        try { await sock.sendPresenceUpdate('composing', from); } catch {}
        const ans = await aiReply(arg, sender, msg.pushName, aiLang, aiNum);
        if (ans && /(TIDAK_PAHAM|ALIHKAN)/.test(ans)) {
          if (!isGroup && !isOwner) {
            const tag = /ALIHKAN/.test(ans) ? 'MINTA TUAN AFRIAL' : 'AI TIDAK PAHAM';
            await redirectToOwner(sock, from, msg, sender, arg, tag);
          } else {
            await sendHuman(sock, from, msg, 'Saya kurang paham maksudnya 🙏');
          }
          return;
        }
        if (ans) { stats.aiOut += 1; bumpHour('ai'); learnChat(arg, ans, aiLang, aiNum); await sendHuman(sock, from, msg, withSleepNote(ans, isGroup)); logReply(from, ans); }
        else await sendHuman(sock, from, msg, withSleepNote('Mohon maaf, layanan AI sedang gangguan. Silakan coba beberapa saat lagi, atau ketik !lapor + keluhan kakak agar diteruskan ke Tuan Afrial. 🙏', isGroup));
        return;
      }

      // --- lapor ke pemilik (semua orang bisa pakai) ---
      if (c === 'lapor') {
        if (!arg) {
          await sock.sendMessage(from, { text: 'Contoh: *!lapor ada yang spam di grup*' }, { quoted: msg });
          return;
        }
        if (arg.length > 500) {
          await sock.sendMessage(from, { text: 'Laporan max 500 karakter.' }, { quoted: msg });
          return;
        }
        await forwardToOwner(sock, sender, msg.pushName, `[LAPORAN] ${arg.slice(0, 500)}`, msg);
        await sock.sendMessage(from, { text: 'Laporan diteruskan ke Tuan Afrial ✅' }, { quoted: msg });
        return;
      }

      // --- perintah pemilik: selalu sunyi ke orang lain, notif hanya ke pemilik ---
      // Non-pemilik: didiamkan total (tidak ada balasan apa pun).
      // Pemilik di grup: pesan perintah dihapus + notif ke DM pemilik, grup bersih.
      async function ownerNotify(text) {
        if (isGroup) {
          try { await sock.sendMessage(from, { delete: msg.key }); } catch {} // butuh bot jadi admin
          await notifyOwner(sock, text);
        } else {
          await sock.sendMessage(from, { text }, { quoted: msg });
        }
      }
      // --- auto on/off (khusus pemilik) + TOMBOL ON/OFF ---
      // FIX: arg case-insensitive (On/OFF/mati/hidup/1/0), tanpa arg kirim tombol.
      // Tap tombol masuk sebagai "!auto on" / "!auto off" via getButtonId().
      if (c === 'auto' || c === 'aion' || c === 'aioff' || c === 'aionoff') {
        if (!isOwner) return;
        const a = (arg || '').toLowerCase().trim();
        const isOn = ['on', '1', 'hidup', 'hidupkan', 'aktif', 'nyala', 'mulai'].includes(a) || c === 'aion';
        const isOff = ['off', '0', 'mati', 'matikan', 'nonaktif', 'padam'].includes(a) || c === 'aioff';
        if (isOff) {
          autoAi = false;
          await ownerNotify('🔴 *AI OFF*\nBot mati — chat masuk tidak dijawab.');
          // kirim tombol juga biar gampang nyalakan lagi
          try { await sendAutoToggle(sock, isGroup ? (config.ownerNumber.replace(/\D/g, '') + '@s.whatsapp.net') : from, msg, false, null); } catch {}
        } else if (isOn) {
          autoAi = true;
          await ownerNotify('🟢 *AI ON*\nBot hidup — chat pribadi dijawab otomatis.');
          try { await sendAutoToggle(sock, isGroup ? (config.ownerNumber.replace(/\D/g, '') + '@s.whatsapp.net') : from, msg, false, null); } catch {}
        } else {
          // tanpa arg / arg tidak dikenal -> kirim tombol ON/OFF
          if (isGroup) {
            try { await sock.sendMessage(from, { delete: msg.key }); } catch {}
            try { await sendAutoToggle(sock, config.ownerNumber.replace(/\D/g, '') + '@s.whatsapp.net', msg, false, null); } catch {}
            await notifyOwner(sock, autoStatusText() + '\n\n*!lanjut 628xxx* = bot ikut chat lagi\n*!sudah 628xxx* = tandai ditangani');
          } else {
            await sendAutoToggle(sock, from, msg, true, ownerNotify);
          }
        }
        return;
      }
      // shortcut owner: !on / !off (tanpa kata auto)
      if ((c === 'on' || c === 'off') && isOwner && !arg) {
        autoAi = (c === 'on');
        await ownerNotify(autoAi ? '🟢 *AI ON*\nBot hidup.' : '🔴 *AI OFF*\nBot mati.');
        return;
      }
      if (c === 'lanjut') {
        if (!isOwner) return;
        const num = (arg.match(/\d+/) || [''])[0];
        if (!num) {
          await ownerNotify('Contoh: *!lanjut 6281234567890*');
          return;
        }
        sessionGuard.clearEscalationAny(clearEscalation, num + '@s.whatsapp.net', num + '@lid', null);
        await ownerNotify(`✅ Bot ikut chat lagi ke ${num}.`);
        return;
      }
      if (c === 'sudah') {
        if (!isOwner) return;
        const num = (arg.match(/\d+/) || [''])[0];
        if (!num) {
          await ownerNotify('Contoh: *!sudah 6281234567890* (= sudah ditangani, batalkan pengingat)');
          return;
        }
        sessionGuard.clearEscalationAny(clearEscalation, num + '@s.whatsapp.net', num + '@lid', null);
        await ownerNotify(`✅ ${num} ditandai sudah ditangani. Pengingat dibatalkan.`);
        return;
      }
      if (c === 'block' || c === 'blokir') {
        if (!isOwner) return;
        const num = (arg.match(/\d+/) || [''])[0];
        if (!num) {
          await ownerNotify('Contoh: *!block 6281234567890* (= nomor tidak bisa chat bot lagi)');
          return;
        }
        try {
          await sock.updateBlockStatus(num + '@s.whatsapp.net', 'block');
          await ownerNotify(`🚫 ${num} diblokir. Buka: *!unblock ${num}*`);
        } catch (e) {
          await ownerNotify('Gagal blokir: ' + String(e.message || e).slice(0, 200));
        }
        return;
      }
      if (c === 'unblock') {
        if (!isOwner) return;
        const num = (arg.match(/\d+/) || [''])[0];
        if (!num) {
          await ownerNotify('Contoh: *!unblock 6281234567890*');
          return;
        }
        try {
          await sock.updateBlockStatus(num + '@s.whatsapp.net', 'unblock');
          await ownerNotify(`✅ ${num} dibuka blokirnya.`);
        } catch (e) {
          await ownerNotify('Gagal unblock: ' + String(e.message || e).slice(0, 200));
        }
        return;
      }
      if (c === 'sesi') {
        if (!isOwner) return;
        const ck = sessionGuard.checkCreds();
        await ownerNotify(`🔐 *SESSION*\nDir: ${sessionGuard.SESSION_DIR}\nCreds: ${ck.ok ? 'OK ✅' : 'RUSAK ❌ (' + ck.reason + ')'}\nReconnect attempt: ${reconnectAttempts}\nBaileys: 6.7.24\n\nKalau creds RUSAK + bot tidak konek: backup otomatis tersimpan, pairing ulang dengan: node index.js`);
        return;
      }
      if (c === 'status') {
        if (!isOwner) return;
        const nMute = Object.values(mutedUntil).filter((e) => e > Date.now()).length;
        const tidurInfo = isSleeping() ? `🌙 TIDUR (jam ${jakartaHour()}:00 WIB)` : `☀️ Terjaga (jam ${jakartaHour()}:00 WIB)`;
        const dndLeft = sched.getDnd();
        const dndInfo = dndLeft ? `\nDND: AKTIF 🔕 (sisa ${sched.fmtLeft(dndLeft - Date.now())})` : '';
        await ownerNotify(`🤖 *AfriIX*\nWA: ${stats.connected ? 'Terhubung 🟢' : 'PUTUS 🔴'} (${stats.user})\nAuto-AI: ${autoAi ? 'ON 🟢' : 'OFF 🔴'}${dndInfo}\nMode: ${tidurInfo}\nUptime: ${uptimeText()}\nMasuk: ${stats.msgIn} | AI: ${stats.aiOut} | Alih: ${stats.redirects}\nMute aktif: ${nMute}\nTerakhir: ${stats.lastFrom} (${stats.lastAt})`);
        return;
      }

      if (c === 'otak') {
        if (!isOwner) return;
        const { brainStats } = require('./lib/ai');
        await ownerNotify(`🤖 *AfriIX*\n${brainStats()}\nReferensi tersimpan: data-ai-ref.json`);
        return;
      }
      if (c === 'profil') {
        const num = ((arg.match(/\d+/) || [])[0] || (sender || '').split('@')[0].replace(/\D/g, '')).replace(/\D/g, '');
        if (!isOwner && num !== senderNum) return; // non-owner hanya boleh lihat profil sendiri
        try {
          const { userProfile } = require('./lib/ai');
          const p = userProfile(num);
          if (!p) { await sock.sendMessage(from, { text: 'Belum ada memori untuk nomor itu. Ngobrol dulu beberapa kali ya.' }, { quoted: msg }); return; }
          await sock.sendMessage(from, { text: `👤 *Profil ${num}*\nNama: ${p.name || '-'}\nKota: ${p.city || '-'}\nChat: ${p.chats}x | Bahasa dominan: ${p.lang}\nSejak: ${p.first} | Terakhir: ${p.last}` }, { quoted: msg });
        } catch (e) { await sock.sendMessage(from, { text: 'Gagal baca profil.' }, { quoted: msg }); }
        return;
      }
      if (c === 'laporan') {
        if (!isOwner) return;
        const nMute = Object.values(mutedUntil).filter((e) => e > Date.now()).length;
        await ownerNotify(`📊 *LAPORAN AfriIX*\nWA: ${stats.connected ? 'Terhubung 🟢' : 'PUTUS 🔴'} (${stats.user})\nAuto-AI: ${autoAi ? 'ON 🟢' : 'OFF 🔴'}\nUptime: ${uptimeText()}\nMasuk: ${stats.msgIn} | AI: ${stats.aiOut} | Alih: ${stats.redirects}\nMute aktif: ${nMute}\nTerakhir: ${stats.lastFrom} (${stats.lastAt})\n\nMode: asisten pribadi (tanpa jualan).`);
        return;
      }
      if (c === 'backup') {
        if (!isOwner) return;
        try {
          const r = require('./lib/backup').doBackup('manual');
          await ownerNotify(r.ok ? `💾 Backup OK: ${r.dest} (${r.files} file, max 7 disimpan)` : 'Backup gagal: ' + r.err);
        } catch (e) { await ownerNotify('Backup gagal: ' + String(e.message || e).slice(0, 150)); }
        return;
      }

      // --- download via yt-dlp ---
      if (c === 'dl') {
        const dlUrl = (arg.split(/\s+/)[0] || '').trim();
        if (!isSafeDlUrl(dlUrl)) {
          await sock.sendMessage(from, { text: 'Contoh: *!dl https://vt.tiktok.com/xxx*' }, { quoted: msg });
          return;
        }
        if (!isOwner) {
          const h = heavyCheck(sender, 'dl', 60000);
          if (!h.ok) { await sock.sendMessage(from, { text: `⏳ Download dibatasi 1x/menit. Coba lagi ${h.left} detik.` }, { quoted: msg }); return; }
        }
        await sock.sendMessage(from, { text: '⏳ Downloading...' }, { quoted: msg });
        try {
          await run('yt-dlp', ['--version'], 15000);
        } catch {
          await sock.sendMessage(from, { text: 'yt-dlp belum terpasang. Install: *pkg install yt-dlp -y* (Termux) atau *sudo apt install -y yt-dlp* (VPS)' }, { quoted: msg });
          return;
        }
        try {
          const tmp = path.join(os.tmpdir(), `dl-${Date.now()}.mp4`);
          await run('yt-dlp', [
            '-f', 'bv*[height<=720]+ba/b[height<=720]/b',
            '--no-playlist', '--max-filesize', '60M',
            '--merge-output-format', 'mp4', '-o', tmp, dlUrl
          ], 120000);
          const stat = fs.statSync(tmp);
          if (stat.size > 60 * 1024 * 1024) {
            await sock.sendMessage(from, { text: 'File >60MB, tidak bisa dikirim via WA.' }, { quoted: msg });
          } else {
            await sock.sendMessage(from, { video: fs.readFileSync(tmp), caption: '✅ Selesai' }, { quoted: msg });
          }
          fs.unlink(tmp, () => {});
        } catch (e) {
          await sock.sendMessage(from, { text: 'Gagal download: ' + e.message.slice(0, 300) }, { quoted: msg });
        }
        return;
      }

      // --- catatan + pengingat waktu (per-user, privasi terjaga) ---
      // Dukung natural: "!ingat besok jam 7 minum obat" / "!ingat nanti sore rapat"
      if (c === 'ingat') {
        if (!arg) {
          await sock.sendMessage(from, { text: 'Contoh:\n*!ingat beli bensin* (catatan)\n*!ingat 10m minum obat* (pengingat)\n*!ingat besok jam 7 minum obat* (natural)\n*!jadwal* (daftar pengingat)' }, { quoted: msg });
          return;
        }
        const d = sched.parseDuration(arg);
        if (d) {
          const item = sched.addOnce(from, d.ms, d.text);
          await sock.sendMessage(from, { text: item ? `⏰ Siap, saya ingatkan ${sched.fmtLeft(d.ms)} lagi:\n${d.text}` : 'Pengingat penuh (max 100).' }, { quoted: msg });
          return;
        }
        const nat = sched.parseNatural(arg);
        if (nat) {
          const item = sched.addOnce(from, nat.ms, nat.text);
          await sock.sendMessage(from, { text: item ? `⏰ Siap, saya ingatkan ${sched.fmtLeft(nat.ms)} lagi:\n${nat.text}` : 'Pengingat penuh (max 100).' }, { quoted: msg });
          return;
        }
        const n = reminder.add(sender, arg);
        await sock.sendMessage(from, { text: `✅ Disimpan (#${n})` }, { quoted: msg });
        return;
      }
      if (c === 'jadwal') {
        const list = sched.listOnce(from);
        await sock.sendMessage(from, { text: list.length ? '*⏰ PENGINGAT:*\n' + list.map((t, i) => `${i + 1}. ${sched.fmtLeft(t.at - Date.now())} lagi — ${t.text}`).join('\n') + '\n\n*!batal 1* = batalkan' : 'Tidak ada pengingat. Buat: *!ingat 10m minum obat*' }, { quoted: msg });
        return;
      }
      if (c === 'batal') {
        const x = sched.cancelOnce(from, parseInt(arg, 10));
        await sock.sendMessage(from, { text: x ? `🗑️ Dibatalkan: ${x.text}` : 'Nomor tidak ada. Cek *!jadwal*' }, { quoted: msg });
        return;
      }
      // --- jangan ganggu (owner): bot diam total kecuali owner ---
      if (c === 'dnd') {
        if (!isOwner) return;
        if (!arg || arg === 'status') {
          const left = sched.getDnd();
          await ownerNotify(left ? `🔕 DND aktif, sisa ${sched.fmtLeft(left - Date.now())}. Matikan: *!dnd off*` : '🔔 DND mati. Nyalakan: *!dnd 2j*');
          return;
        }
        if (/^off|mati$/i.test(arg)) {
          sched.setDnd(0);
          await ownerNotify('🔔 DND mati. Bot normal lagi.');
          return;
        }
        const d = sched.parseDuration(arg + ' x');
        if (!d) {
          await ownerNotify('Contoh: *!dnd 2j* / *!dnd 30m* / *!dnd off*');
          return;
        }
        sched.setDnd(d.ms);
        await ownerNotify(`🔕 DND aktif ${sched.fmtLeft(d.ms)}. Bot diam kecuali perintah owner.`);
        return;
      }
      // --- tugas rutin harian (owner): !rutin 07:00 minum vitamin ---
      if (c === 'rutin') {
        if (!isOwner) return;
        const sub = (arg.split(/\s+/)[0] || '').toLowerCase();
        if (sub === 'list' || !arg) {
          const list = sched.listRoutine(from);
          await ownerNotify(list.length ? '*🔁 RUTIN HARIAN:*\n' + list.map((t, i) => `${i + 1}. ${t.clock} — ${t.text}`).join('\n') + '\n\n*!rutin hapus 1*' : 'Kosong. Contoh: *!rutin 07:00 minum vitamin*');
          return;
        }
        if (sub === 'hapus') {
          const x = sched.delRoutine(from, parseInt(arg.split(/\s+/)[1], 10));
          await ownerNotify(x ? `🗑️ Rutin dihapus: ${x.clock} ${x.text}` : 'Nomor tidak ada.');
          return;
        }
        const m = arg.match(/^\s*([01]?\d|2[0-3])[:.]([0-5]\d)\s+([\s\S]+)$/);
        if (!m) {
          await ownerNotify('Contoh: *!rutin 07:00 minum vitamin*\n*!rutin list* / *!rutin hapus 1*');
          return;
        }
        const item = sched.addRoutine(from, sched.parseClock(`${m[1]}:${m[2]}`), m[3].trim().slice(0, 300));
        await ownerNotify(item ? `🔁 Rutin tiap ${item.clock} WIB:\n${item.text}` : 'Rutin penuh (max 50).');
        return;
      }
      // --- info cepat (tanpa API key, semua orang bisa pakai) ---
      if (c === 'cuaca') {
        try {
          await sock.sendMessage(from, { text: await info.cuaca(arg || 'Jakarta') }, { quoted: msg });
        } catch (e) { await sock.sendMessage(from, { text: 'Gagal cuaca: ' + String(e.message || e).slice(0, 150) }, { quoted: msg }); }
        return;
      }
      if (c === 'sholat' || c === 'jadwal-sholat') {
        try {
          await sock.sendMessage(from, { text: await info.sholat(arg || 'Jakarta') }, { quoted: msg });
        } catch (e) { await sock.sendMessage(from, { text: 'Gagal jadwal: ' + String(e.message || e).slice(0, 150) }, { quoted: msg }); }
        return;
      }
      if (c === 'kurs') {
        try {
          await sock.sendMessage(from, { text: await info.kurs() }, { quoted: msg });
        } catch (e) { await sock.sendMessage(from, { text: 'Gagal kurs: ' + String(e.message || e).slice(0, 150) }, { quoted: msg }); }
        return;
      }
      if (c === 'list' || c === 'todo') {
        await sock.sendMessage(from, { text: reminder.listText(sender) }, { quoted: msg });
        return;
      }
      if (c === 'selesai') {
        const x = reminder.done(sender, parseInt(arg, 10));
        await sock.sendMessage(from, { text: x ? `✅ Selesai: ${x.text}` : 'Nomor tidak ada. Cek *!list*' }, { quoted: msg });
        return;
      }
      if (c === 'hapus') {
        const x = reminder.hapus(sender, parseInt(arg, 10));
        await sock.sendMessage(from, { text: x ? `🗑️ Dihapus: ${x.text}` : 'Nomor tidak ada.' }, { quoted: msg });
        return;
      }

      if (c === 'absen') {
        try {
          group.startAbsen(from, arg || 'Absen');
          const meta = isGroup ? await sock.groupMetadata(from) : null;
          const names = meta ? meta.participants.map((p) => '@' + p.id.split('@')[0]) : [];
          await sock.sendMessage(from, { text: `📋 *ABSEN: ${String(arg || 'Absen').slice(0, 100)}*\n${new Date().toLocaleString('id-ID')}\n\nKetik *!hadir* untuk tercatat.\nLihat: *!rekap*\n\n${names.slice(0, 30).join(' ')}`, mentions: meta ? meta.participants.map((p) => p.id) : [] }, { quoted: msg });
        } catch (e) {
          await sock.sendMessage(from, { text: '📋 Absen dimulai! Ketik: *!hadir*' }, { quoted: msg });
        }
        return;
      }
      if (c === 'hadir') {
        const a = group.markHadir(from, sender, msg.pushName);
        await sock.sendMessage(from, { text: a ? `✅ ${msg.pushName || 'Kamu'} tercatat hadir! (*!rekap* untuk daftar)` : 'Belum ada absen aktif. Mulai: *!absen [judul]*' }, { quoted: msg });
        return;
      }
      if (c === 'rekap') {
        await sock.sendMessage(from, { text: group.rekapAbsen(from) }, { quoted: msg });
        return;
      }
      // --- voting grup ---
      if (c === 'vote') {
        if (!isGroup) { await sock.sendMessage(from, { text: 'Khusus grup.' }, { quoted: msg }); return; }
        if (!arg) {
          await sock.sendMessage(from, { text: 'Contoh: *!vote makan dimana? | padang | warteg | mie ayam*\n*!pilih 1* = pilih\n*!hasil* = hasil\n*!votetutup* = tutup (admin/owner)' }, { quoted: msg });
          return;
        }
        // "!vote 2" = shortcut pilih
        if (/^\d+$/.test(arg.trim())) {
          const r = group.castVote(from, sender, parseInt(arg.trim(), 10));
          await sock.sendMessage(from, { text: r.ok ? `✅ Pilihanmu: *${r.pick}*` : r.err }, { quoted: msg });
          return;
        }
        const r = group.startVote(from, sender, arg);
        if (r.err) { await sock.sendMessage(from, { text: r.err }, { quoted: msg }); return; }
        await sock.sendMessage(from, { text: `📊 *VOTE DIMULAI: ${r.q}*\n\n` + r.opts.map((o, i) => `${i + 1}. ${o}`).join('\n') + '\n\nCara pilih: *!pilih <nomor>*\nHasil: *!hasil*' }, { quoted: msg });
        return;
      }
      if (c === 'pilih') {
        if (!isGroup) { await sock.sendMessage(from, { text: 'Khusus grup.' }, { quoted: msg }); return; }
        const r = group.castVote(from, sender, parseInt(arg, 10));
        await sock.sendMessage(from, { text: r.ok ? `✅ Pilihanmu: *${r.pick}*` : (r.err || 'Gagal.') }, { quoted: msg });
        return;
      }
      if (c === 'hasil') {
        await sock.sendMessage(from, { text: group.voteResult(from) }, { quoted: msg });
        return;
      }
      if (c === 'votetutup' || c === 'tutupvote') {
        if (!isGroup) { await sock.sendMessage(from, { text: 'Khusus grup.' }, { quoted: msg }); return; }
        try {
          const meta = await sock.groupMetadata(from);
          const me = meta.participants.find((p) => p.id === sender);
          const isAdmin = me?.admin === 'admin' || me?.admin === 'superadmin';
          const ownerNum = (config.ownerNumber || '').replace(/\D/g, '');
          const senderNum = (sender || '').split('@')[0].replace(/\D/g, '');
          if (!isAdmin && !(ownerNum && senderNum === ownerNum) && !isOwner) {
            await sock.sendMessage(from, { text: 'Khusus admin grup ya 🙏' }, { quoted: msg });
            return;
          }
        } catch {}
        await sock.sendMessage(from, { text: group.closeVote(from) }, { quoted: msg });
        return;
      }
      // --- antilink grup (admin/owner) ---
      if (c === 'antilink') {
        if (!isGroup) { await sock.sendMessage(from, { text: 'Khusus grup.' }, { quoted: msg }); return; }
        const sub = (arg || '').toLowerCase().trim();
        if (!sub || sub === 'status') {
          await sock.sendMessage(from, { text: group.isAntilinkOn(from) ? '🔗 Antilink: *ON* — link otomatis dihapus (bot harus admin). Matikan: *!antilink off*' : '🔗 Antilink: *OFF*. Nyalakan: *!antilink on*' }, { quoted: msg });
          return;
        }
        try {
          const meta = await sock.groupMetadata(from);
          const me = meta.participants.find((p) => p.id === sender);
          const isAdmin = me?.admin === 'admin' || me?.admin === 'superadmin';
          const ownerNum = (config.ownerNumber || '').replace(/\D/g, '');
          const senderNum = (sender || '').split('@')[0].replace(/\D/g, '');
          if (!isAdmin && !(ownerNum && senderNum === ownerNum) && !isOwner) {
            await sock.sendMessage(from, { text: 'Khusus admin grup ya 🙏' }, { quoted: msg });
            return;
          }
        } catch {}
        if (['on', '1', 'aktif'].includes(sub)) { group.setAntilink(from, true); await sock.sendMessage(from, { text: '🔗 Antilink *ON*. Link akan dihapus otomatis.' }, { quoted: msg }); }
        else if (['off', '0', 'mati'].includes(sub)) { group.setAntilink(from, false); await sock.sendMessage(from, { text: '🔗 Antilink *OFF*.' }, { quoted: msg }); }
        else await sock.sendMessage(from, { text: 'Contoh: *!antilink on* / *!antilink off*' }, { quoted: msg });
        return;
      }
      // --- welcome grup (admin/owner) ---
      if (c === 'welcome') {
        if (!isGroup) { await sock.sendMessage(from, { text: 'Khusus grup.' }, { quoted: msg }); return; }
        const sub = (arg || '').toLowerCase().trim();
        if (!sub || sub === 'status') {
          await sock.sendMessage(from, { text: group.isWelcomeOn(from) ? '👋 Welcome: *ON*. Custom: *!welcometext Halo {nama} selamat datang di {grup}* / Matikan: *!welcome off*' : '👋 Welcome: *OFF*. Nyalakan: *!welcome on*' }, { quoted: msg });
          return;
        }
        try {
          const meta = await sock.groupMetadata(from);
          const me = meta.participants.find((p) => p.id === sender);
          const isAdmin = me?.admin === 'admin' || me?.admin === 'superadmin';
          const ownerNum = (config.ownerNumber || '').replace(/\D/g, '');
          const senderNum = (sender || '').split('@')[0].replace(/\D/g, '');
          if (!isAdmin && !(ownerNum && senderNum === ownerNum) && !isOwner) {
            await sock.sendMessage(from, { text: 'Khusus admin grup ya 🙏' }, { quoted: msg });
            return;
          }
        } catch {}
        if (['on', '1', 'aktif'].includes(sub)) { group.setWelcome(from, true); await sock.sendMessage(from, { text: '👋 Welcome *ON*.' }, { quoted: msg }); }
        else if (['off', '0', 'mati'].includes(sub)) { group.setWelcome(from, false); await sock.sendMessage(from, { text: '👋 Welcome *OFF*.' }, { quoted: msg }); }
        else await sock.sendMessage(from, { text: 'Contoh: *!welcome on* / *!welcome off*' }, { quoted: msg });
        return;
      }
      if (c === 'welcometext') {
        if (!isGroup) { await sock.sendMessage(from, { text: 'Khusus grup.' }, { quoted: msg }); return; }
        if (!arg) { await sock.sendMessage(from, { text: 'Contoh: *!welcometext Halo {nama} selamat datang di {grup} 🎉*' }, { quoted: msg }); return; }
        try {
          const meta = await sock.groupMetadata(from);
          const me = meta.participants.find((p) => p.id === sender);
          const isAdmin = me?.admin === 'admin' || me?.admin === 'superadmin';
          const ownerNum = (config.ownerNumber || '').replace(/\D/g, '');
          const senderNum = (sender || '').split('@')[0].replace(/\D/g, '');
          if (!isAdmin && !(ownerNum && senderNum === ownerNum) && !isOwner) {
            await sock.sendMessage(from, { text: 'Khusus admin grup ya 🙏' }, { quoted: msg });
            return;
          }
        } catch {}
        group.setWelcomeText(from, arg);
        await sock.sendMessage(from, { text: '✅ Teks welcome disimpan + welcome ON.' }, { quoted: msg });
        return;
      }
      if (c === 'tagall') {
        if (!isGroup) {
          await sock.sendMessage(from, { text: 'Khusus grup.' }, { quoted: msg });
          return;
        }
        if (!isOwner) {
          const h = heavyCheck(from + '|' + sender, 'tagall', 60000);
          if (!h.ok) { await sock.sendMessage(from, { text: `⏳ Tagall dibatasi 1x/menit. Coba lagi ${h.left} detik.` }, { quoted: msg }); return; }
        }
        try {
          const meta = await sock.groupMetadata(from);
          const senderNum = (sender || '').split('@')[0].replace(/\D/g, '');
          const ownerNum = (config.ownerNumber || '').replace(/\D/g, '');
          const me = meta.participants.find((p) => p.id === sender || p.id.split('@')[0].replace(/\D/g, '') === senderNum);
          const isAdmin = me?.admin === 'admin' || me?.admin === 'superadmin';
          const isOwner = ownerNum && senderNum === ownerNum;
          if (!isAdmin && !isOwner) {
            await sock.sendMessage(from, { text: 'Khusus admin grup ya 🙏' }, { quoted: msg });
            return;
          }
          const mentions = meta.participants.map((p) => p.id);
          const safeArg = String(arg || 'Halo semua!').slice(0, 200);
          await sock.sendMessage(from, { text: `📢 *${safeArg}*\n` + meta.participants.map((p) => '@' + p.id.split('@')[0]).join('\n'), mentions }, { quoted: msg });
        } catch (e) {
          await sock.sendMessage(from, { text: 'Gagal tagall.' }, { quoted: msg });
        }
        return;
      }

      // --- tools keren ---
      if (c.startsWith('tr-')) {
        const to = (c.slice(3) || 'en').replace(/[^a-z-]/g, '').slice(0, 10) || 'en';
        if (!arg) {
          await sock.sendMessage(from, { text: 'Contoh: *!tr-en halo apa kabar*' }, { quoted: msg });
          return;
        }
        if (arg.length > 1000) {
          await sock.sendMessage(from, { text: 'Teks max 1000 karakter.' }, { quoted: msg });
          return;
        }
        try {
          const out = await tools.translate(arg.slice(0, 1000), to);
          await sock.sendMessage(from, { text: out || 'Gagal translate.' }, { quoted: msg });
        } catch (e) {
          await sock.sendMessage(from, { text: 'Gagal translate: ' + String(e.message || '').slice(0, 150) }, { quoted: msg });
        }
        return;
      }
      if (c === 'short') {
        const urlArg = (arg.split(/\s+/)[0] || '').trim();
        if (!urlArg) {
          await sock.sendMessage(from, { text: 'Contoh: *!short https://link-panjang...*' }, { quoted: msg });
          return;
        }
        try {
          const out = await tools.shortlink(urlArg);
          await sock.sendMessage(from, { text: `🔗 ${out}` }, { quoted: msg });
        } catch (e) {
          await sock.sendMessage(from, { text: 'Gagal shortlink: ' + String(e.message || '').slice(0, 150) }, { quoted: msg });
        }
        return;
      }
      if (c === 'qr') {
        if (!arg) {
          await sock.sendMessage(from, { text: 'Contoh: *!qr teks apa aja*' }, { quoted: msg });
          return;
        }
        if (arg.length > 1000) {
          await sock.sendMessage(from, { text: 'Teks QR max 1000 karakter.' }, { quoted: msg });
          return;
        }
        try {
          const buf = await tools.qrBuffer(arg);
          await sock.sendMessage(from, { image: buf, caption: '✅ QR jadi' }, { quoted: msg });
        } catch {
          await sock.sendMessage(from, { text: 'Gagal bikin QR.' }, { quoted: msg });
        }
        return;
      }
      if (c === 'calc') {
        if (!arg) {
          await sock.sendMessage(from, { text: 'Contoh: *!calc 12*8+5*' }, { quoted: msg });
          return;
        }
        try {
          await sock.sendMessage(from, { text: `🧮 ${arg} = *${tools.calc(arg)}*` }, { quoted: msg });
        } catch {
          await sock.sendMessage(from, { text: 'Ekspresi tidak valid.' }, { quoted: msg });
        }
        return;
      }
      if (c === 'gambar' || c === 'image' || c === 'img') {
        if (!arg || arg.trim().length < 3) {
          await sock.sendMessage(from, { text: 'Contoh: *!gambar kucing astronot di bulan*' }, { quoted: msg });
          return;
        }
        if (arg.length > 500) {
          await sock.sendMessage(from, { text: 'Deskripsi max 500 karakter.' }, { quoted: msg });
          return;
        }
        try {
          await sock.sendPresenceUpdate('composing', from);
          const buf = await tools.pollinationsImage(arg);
          await sock.sendMessage(from, { image: buf, caption: `🎨 ${arg.slice(0, 200)}` }, { quoted: msg });
        } catch (e) {
          await sock.sendMessage(from, { text: 'Gagal bikin gambar: ' + String(e.message || '').slice(0, 150) }, { quoted: msg });
        }
        return;
      }

      // perintah tidak dikenal
      await sock.sendMessage(from, { text: 'Perintah tidak dikenal. Ketik *!menu*' }, { quoted: msg });
    } catch (e) {
      console.log('handler err:', e.message);
    }
  });

  // ===== Welcome/goodbye member grup (hanya grup yang di-ON-kan via !welcome on) =====
  if (!global.__welcomeOn) {
    global.__welcomeOn = true;
    sock.ev.on('group-participants.update', async ({ id, participants, action }) => {
      try {
        if (!group.isWelcomeOn(id)) return;
        if (sched.getDnd()) return;
        let meta = null;
        try { meta = await sock.groupMetadata(id); } catch {}
        const gname = meta?.subject || 'grup ini';
        for (const p of (participants || [])) {
          const num = String(p || '').split('@')[0].replace(/\D/g, '');
          const name = num ? '@' + num : 'kak';
          if (action === 'add') {
            await sock.sendMessage(id, { text: group.welcomeTextFor(id, name, gname, false), mentions: [p] });
          } else if (action === 'remove' || action === 'leave') {
            await sock.sendMessage(id, { text: group.welcomeTextFor(id, name, gname, true) });
          }
        }
      } catch (e) { console.log('welcome err:', String(e?.message || e).slice(0, 120)); }
    });
  }
  } catch (e) {
    console.log('start err:', e.message);
    scheduleReconnect(5000);
  } finally {
    startInProgress = false;
  }
}

start();
