// Pengingat waktu + tugas rutin + DND — asisten pribadi (tanpa API key).
// - !ingat 10m minum obat -> sekali, tahan restart (data-schedule.json)
// - !rutin 07:00 minum vitamin -> tiap hari jam WIB (data-routine.json)
// - !dnd 2j / !dnd off -> bot diam total kecuali owner (data-dnd.json)
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..');
const SCHED_FILE = path.join(DIR, 'data-schedule.json');
const ROUTINE_FILE = path.join(DIR, 'data-routine.json');
const DND_FILE = path.join(DIR, 'data-dnd.json');

function loadJson(p, fb) {
  try {
    if (fs.existsSync(p)) {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      return j ?? fb;
    }
  } catch {}
  return fb;
}
function saveJson(p, obj) {
  try { fs.writeFileSync(p, JSON.stringify(obj, null, 2)); } catch {}
}

// "10m minum obat" / "2j rapat" / "1 hari bayar kos" -> { ms, text } atau null
function parseDuration(s) {
  const m = String(s || '').match(/^\s*(\d+)\s*(menit|mnt|min|m|jam|j|h|hari|d)\b\s*([\s\S]*)$/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const u = m[2].toLowerCase();
  const text = (m[3] || '').trim();
  if (!n || n <= 0 || !text) return null;
  const ms = (/^menit|^mnt|^min$|^m$/.test(u)) ? n * 60000
    : (/^hari$|^d$/.test(u) ? n * 86400000 : n * 3600000);
  if (ms > 30 * 86400000) return null; // max 30 hari
  return { ms, text: text.slice(0, 300), unit: u };
}

// "07:00" / "7.30" -> "07:30" atau null (jam WIB)
function parseClock(s) {
  const m = String(s || '').match(/^\s*([01]?\d|2[0-3])[:.]([0-5]\d)\s*$/);
  if (!m) return null;
  return `${String(m[1]).padStart(2, '0')}:${m[2]}`;
}

// ---- WIB helpers untuk parser natural ----
function wibNow() {
  try {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  } catch {
    return new Date();
  }
}
const DAY_MAP = { minggu: 0, ahad: 0, senin: 1, selasa: 2, rabu: 3, kamis: 4, jumat: 5, sabtu: 6 };
function adjustHour(h, meridiem) {
  // meridiem: pagi/siang/sore/malam/sore/malam + am/pm
  if (!meridiem) return h;
  const m = meridiem.toLowerCase();
  if (/^(pagi|morning|am)$/.test(m)) return h === 12 ? 0 : h; // 12 pagi = 0
  if (/^(siang|sore|malam|evening|pm)$/.test(m)) return h < 12 ? h + 12 : h; // 7 malam = 19
  return h;
}
function stampFromWib(targetWib, nowWib) {
  const diff = targetWib.getTime() - nowWib.getTime();
  return Date.now() + diff;
}
// Bersihkan kata pemicu + ekspresi waktu dari teks agar sisa = isi pengingat
function cleanReminderText(raw) {
  let t = String(raw || '');
  t = t.replace(/^(tolong|toll?ong|coba|ya|kak|mas|bang|min(ta)?)\s+/i, '');
  t = t.replace(/^(ingatkan?(lah)?|ingetin|ingetkeun|reminder|kasih\s+tau|kasih\s+tahu|kabari|bangunin|inget)\s+(aku|saya|gue|aq|sy)?\s*/i, '');
  t = t.replace(/^(aku|saya|gue)\s+(mau\s+)?di(ingatkan?|ingetin)\s*/i, '');
  // buang ekspresi waktu di awal ("besok jam 7 ", "dalam 10 menit ", "nanti sore ")
  t = t.replace(/^((dalam|dlm|sekitar|sekitaran)\s+\d+\s*(detik|menit|mnt|min|jam|j|h|hari)(\s+lagi|\s+ke\s+depan)?\s+)/i, '');
  t = t.replace(/^((besok|lusa|hari\s+ini|nanti|ntar)\s*(pagi|siang|sore|malam)?\s*(jam|pukul|pkl\.?|at)?\s*\d{1,2}([:.]\d{2})?\s*(pagi|siang|sore|malam|am|pm|wib|wita|wit)?\s*)/i, '');
  t = t.replace(/^((jam|pukul|pkl\.?)\s*\d{1,2}([:.]\d{2})?\s*(pagi|siang|sore|malam|am|pm|wib|wita|wit)?\s*)/i, '');
  t = t.replace(/^((hari\s+)?(senin|selasa|rabu|kamis|jumat|sabtu|minggu|ahad)\s*(jam|pukul)?\s*\d{0,2}([:.]\d{2})?\s*(pagi|siang|sore|malam)?\s*)/i, '');
  t = t.replace(/^((pagi|siang|sore|malam)\s+ini\s*)/i, '');
  t = t.replace(/^(untuk|buat|supaya|agar|biar|bahwa|:|-|\s)+/i, '');
  // buang ekspresi waktu di akhir (" ... besok jam 7")
  t = t.replace(/\s+(besok|lusa)(\s+jam|\s+pukul|\s+pkl)?\s*\d{0,2}([:.]\d{2})?\s*(pagi|siang|sore|malam)?\s*$/i, '');
  t = t.replace(/\s+dalam\s+\d+\s*(detik|menit|mnt|min|jam|j|h|hari)(\s+lagi)?\s*$/i, '');
  t = t.replace(/\s+(nanti|ntar)(\s+jam|\s+pukul)?\s*\d{0,2}([:.]\d{2})?\s*(sore|malam|siang|pagi)?\s*$/i, '');
  return t.trim().slice(0, 300);
}

// "ingatkan besok jam 7 minum obat" / "besok pagi minum vitamin"
// "nanti sore rapat" / "senin jam 8 meeting" / "dalam 10 menit matikan kompor"
// Return { ms, text } atau null. Dipakai !ingat + auto-detect tanpa prefix.
function parseNatural(s) {
  const raw = String(s || '');
  const low = ' ' + raw.toLowerCase().replace(/\./g, ':') + ' ';
  const nowW = wibNow();
  let target = null;

  // 1) relatif: "dalam 10 menit / 5 menit lagi / 2 jam lagi"
  let m = low.match(/dalam\s+(\d+)\s*(detik|menit|mnt|min|jam|j|h|hari)\b(\s+lagi|\s+ke\s+depan)?/);
  if (!m) m = low.match(/\b(\d+)\s*(menit|mnt|min|jam|j|h)\s+lagi\b/);
  if (m) {
    const n = parseInt(m[1], 10);
    const u = m[2];
    if (n > 0) {
      const ms = /detik/.test(u) ? n * 1000
        : (/menit|mnt|min/.test(u) ? n * 60000
        : (/hari/.test(u) ? n * 86400000 : n * 3600000));
      if (ms > 0 && ms <= 30 * 86400000) {
        const text = cleanReminderText(raw.replace(m[0], ' '));
        if (text) return { ms, text };
      }
    }
  }

  // helper ekstrak jam: "jam 7", "pukul 19:30", "jam 7 malam", "07:30"
  const jamRe = /(?:jam|pukul|pkl|at)\s*(\d{1,2})(?::(\d{2}))?\s*(pagi|siang|sore|malam|am|pm|wib|wita|wit)?/;
  const jm = low.match(jamRe);
  const jmHour = jm ? parseInt(jm[1], 10) : null;
  const jmMin = jm && jm[2] ? parseInt(jm[2], 10) : 0;
  const jmMer = jm && jm[3] ? jm[3] : null;
  const hasJam = jm && jmHour >= 0 && jmHour <= 23 && jmMin >= 0 && jmMin <= 59;

  // 2) "besok ..." / "lusa ..."
  const dayOff = /besok/.test(low) ? 1 : (/lusa/.test(low) ? 2 : 0);
  if (dayOff) {
    let h = 7, mi = 0; // default besok pagi jam 7
    if (/pagi/.test(low) && !hasJam) { h = 7; }
    else if (/siang/.test(low) && !hasJam) { h = 12; }
    else if (/sore/.test(low) && !hasJam) { h = 16; }
    else if (/(malam|malem)/.test(low) && !hasJam) { h = 19; }
    if (hasJam) { h = adjustHour(jmHour > 12 ? jmHour : jmHour % 24, jmMer); if (!jmMer && jmHour <= 11) {
      // "besok jam 7" tanpa meridiem: pagi=7, tapi "besok jam 5 sore" sudah ketangkap di atas
      if (/sore/.test(low)) h = jmHour + 12; else if (/(malam|malem)/.test(low)) h = jmHour + 12;
    } mi = jmMin; }
    target = new Date(nowW);
    target.setDate(target.getDate() + dayOff);
    target.setHours(h, mi, 0, 0);
    const text = cleanReminderText(raw);
    if (text) return { ms: Math.max(60000, stampFromWib(target, nowW) - Date.now()), text };
  }

  // 3) nama hari: "senin jam 8 meeting"
  const dm = low.match(/(senin|selasa|rabu|kamis|jumat|sabtu|minggu|ahad)/);
  if (dm) {
    const want = DAY_MAP[dm[1]] ?? 1;
    let h = 8, mi = 0;
    if (hasJam) { h = adjustHour(jmHour, jmMer); mi = jmMin; }
    else if (/pagi/.test(low)) h = 7; else if (/siang/.test(low)) h = 12;
    else if (/sore/.test(low)) h = 16; else if (/(malam|malem)/.test(low)) h = 19;
    target = new Date(nowW);
    let delta = (want - target.getDay() + 7) % 7;
    // kalau hari ini dan jam sudah lewat -> minggu depan
    const probe = new Date(target); probe.setHours(h, mi, 0, 0);
    if (delta === 0 && probe.getTime() <= target.getTime()) delta = 7;
    if (delta === 0 && !hasJam) delta = 7; // "senin" doang = senin depan
    target.setDate(target.getDate() + delta);
    target.setHours(h, mi, 0, 0);
    const text = cleanReminderText(raw);
    if (text) return { ms: Math.max(60000, stampFromWib(target, nowW) - Date.now()), text };
  }

  // 4) "nanti sore/malam/siang" atau "nanti jam X"
  if (/\bnanti\b|\bntar\b/.test(low)) {
    let h = null, mi = 0;
    if (hasJam) { h = adjustHour(jmHour, jmMer); mi = jmMin; }
    else if (/pagi/.test(low)) h = 7; else if (/siang/.test(low)) h = 12;
    else if (/sore/.test(low)) h = 16; else if (/(malam|malem)/.test(low)) h = 19;
    else h = nowW.getHours() + 1; // "nanti" doang = 1 jam lagi
    target = new Date(nowW);
    target.setHours(h, mi, 0, 0);
    let ms = stampFromWib(target, nowW) - Date.now();
    if (ms <= 0) { target.setDate(target.getDate() + 1); ms = stampFromWib(target, nowW) - Date.now(); }
    const text = cleanReminderText(raw);
    if (text && ms > 0 && ms <= 30 * 86400000) return { ms, text };
  }

  // 5) "jam X / pukul X" hari ini (atau besok kalau sudah lewat)
  if (hasJam && !/besok|lusa|senin|selasa|rabu|kamis|jumat|sabtu|minggu|ahad|nanti|ntar/.test(low)) {
    let h = adjustHour(jmHour, jmMer);
    // tanpa meridiem + jam kecil (1-11) + sekarang sudah sore -> asumsikan malam? tidak, tetap hari ini/besok
    target = new Date(nowW);
    target.setHours(h, jmMin, 0, 0);
    let ms = stampFromWib(target, nowW) - Date.now();
    if (ms <= 60000) { target.setDate(target.getDate() + 1); ms = stampFromWib(target, nowW) - Date.now(); }
    const text = cleanReminderText(raw);
    if (text && ms > 0 && ms <= 30 * 86400000) return { ms, text };
  }

  // 6) "pagi/siang/sore/malam ini + aktivitas"
  if (/(pagi|siang|sore|malam|malem)\s+(ini|nanti)/.test(low)) {
    let h = /pagi/.test(low) ? 7 : /siang/.test(low) ? 12 : /(malam|malem)/.test(low) ? 19 : 16;
    target = new Date(nowW);
    target.setHours(h, 0, 0, 0);
    let ms = stampFromWib(target, nowW) - Date.now();
    if (ms <= 0) { target.setDate(target.getDate() + 1); ms = stampFromWib(target, nowW) - Date.now(); }
    const text = cleanReminderText(raw);
    if (text && ms > 0) return { ms, text };
  }

  return null;
}

// Intent pengingat natural tanpa prefix (private chat): harus ada kata kunci ingatkan
function isReminderIntent(s) {
  const low = String(s || '').toLowerCase();
  return /(ingatkan?|ingetin|ingetkeun|reminder|kasih\s+tau|kasih\s+tahu|kabari|bangunin|jangan\s+lupa|tolong\s+ing)/.test(low);
}

function fmtLeft(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), mnt = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}h ${h}j`;
  if (h > 0) return `${h}j ${mnt}m`;
  return `${mnt}m ${s % 60}d`;
}

let sender = null; // (to, text) => Promise — dipasang saat start()
const timers = new Map();

function fireSched(item) {
  timers.delete(item.id);
  const list = loadJson(SCHED_FILE, []).filter((x) => x.id !== item.id);
  saveJson(SCHED_FILE, list);
  try { sender?.(item.to, `⏰ *Pengingat:* ${item.text}`); } catch {}
}

function armSched(item) {
  const delay = item.at - Date.now();
  if (delay <= 0) { fireSched(item); return; }
  if (timers.has(item.id)) clearTimeout(timers.get(item.id));
  const t = setTimeout(() => fireSched(item), Math.min(delay, 2 ** 31 - 1));
  timers.set(item.id, t);
}

function addOnce(to, ms, text) {
  const list = loadJson(SCHED_FILE, []);
  if (list.length >= 100) return null;
  const item = { id: Date.now().toString(36) + Math.floor(Math.random() * 999), to, at: Date.now() + ms, text };
  list.push(item);
  saveJson(SCHED_FILE, list);
  armSched(item);
  return item;
}

function listOnce(to) {
  return loadJson(SCHED_FILE, []).filter((x) => x.to === to);
}

function cancelOnce(to, idx) {
  const all = loadJson(SCHED_FILE, []);
  const mine = all.filter((x) => x.to === to);
  const item = mine[idx - 1];
  if (!item) return null;
  if (timers.has(item.id)) { clearTimeout(timers.get(item.id)); timers.delete(item.id); }
  saveJson(SCHED_FILE, all.filter((x) => x.id !== item.id));
  return item;
}

// ---- rutin harian ----
function addRoutine(to, clock, text) {
  const list = loadJson(ROUTINE_FILE, []);
  if (list.length >= 50) return null;
  const item = { id: Date.now().toString(36) + Math.floor(Math.random() * 999), to, clock, text, lastSent: '' };
  list.push(item);
  saveJson(ROUTINE_FILE, list);
  return item;
}
function listRoutine(to) {
  return loadJson(ROUTINE_FILE, []).filter((x) => !to || x.to === to);
}
function delRoutine(to, idx) {
  const all = loadJson(ROUTINE_FILE, []);
  const mine = all.filter((x) => x.to === to);
  const item = mine[idx - 1];
  if (!item) return null;
  saveJson(ROUTINE_FILE, all.filter((x) => x.id !== item.id));
  return item;
}
function jakartaHM() {
  try {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
    const p = (n) => String(n).padStart(2, '0');
    return { hm: `${p(now.getHours())}:${p(now.getMinutes())}`, date: now.toISOString().slice(0, 10) };
  } catch {
    const n = new Date();
    const p = (x) => String(x).padStart(2, '0');
    return { hm: `${p(n.getHours())}:${p(n.getMinutes())}`, date: n.toISOString().slice(0, 10) };
  }
}
function tickRoutine() {
  try {
    const { hm, date } = jakartaHM();
    const list = loadJson(ROUTINE_FILE, []);
    let changed = false;
    for (const r of list) {
      if (r.clock === hm && r.lastSent !== date) {
        r.lastSent = date;
        changed = true;
        try { sender?.(r.to, `🔁 *Rutin ${r.clock}:* ${r.text}`); } catch {}
      }
    }
    if (changed) saveJson(ROUTINE_FILE, list);
  } catch {}
}

// ---- DND ----
function getDnd() {
  const j = loadJson(DND_FILE, null);
  const until = j?.until || 0;
  return until > Date.now() ? until : 0;
}
function setDnd(ms) {
  const until = ms > 0 ? Date.now() + ms : 0;
  saveJson(DND_FILE, { until });
  return until;
}

// Dijalankan di start(): refresh pengirim (socket baru tiap reconnect) + jadwal ulang.
function startSchedulers(sendFn) {
  sender = sendFn; // selalu refresh — socket ganti tiap reconnect
  if (global.__schedOn) return;
  global.__schedOn = true;
  try {
    for (const item of loadJson(SCHED_FILE, [])) {
      if (item.at > Date.now()) armSched(item);
      else fireSched(item); // kelewat saat mati -> kirim langsung
    }
  } catch {}
  setInterval(tickRoutine, 30 * 1000).unref?.();
}

module.exports = {
  parseDuration, parseClock, parseNatural, isReminderIntent, fmtLeft,
  addOnce, listOnce, cancelOnce,
  addRoutine, listRoutine, delRoutine,
  getDnd, setDnd,
  startSchedulers,
};
