// Tools grup: voting, antilink, welcome/goodbye, absen tercatat.
// Semua state tahan restart (file JSON), ringan untuk Termux.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..');
const VOTE_FILE = path.join(DIR, 'data-vote.json');
const ANTILINK_FILE = path.join(DIR, 'data-antilink.json');
const WELCOME_FILE = path.join(DIR, 'data-welcome.json');
const ABSEN_FILE = path.join(DIR, 'data-absen.json');

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

// ================= VOTING =================
// !vote makan dimana? | padang | warteg | mie ayam  -> mulai (1 vote aktif per grup)
// !pilih 2 / !vote 2 ->投票
// !hasil -> hasil sementara, !votetutup -> tutup + hasil akhir
function getVote(chatJid) {
  const all = loadJson(VOTE_FILE, {});
  return all[chatJid] || null;
}
function startVote(chatJid, by, raw) {
  const parts = String(raw || '').split('|').map((s) => s.trim()).filter(Boolean);
  if (parts.length < 3) return { err: 'Contoh: *!vote makan dimana? | padang | warteg | mie ayam*\n(min. 2 opsi, max 10)' };
  if (parts.length > 11) return { err: 'Max 10 opsi ya.' };
  const q = parts[0].slice(0, 200);
  const opts = parts.slice(1, 11).map((s) => s.slice(0, 60));
  const all = loadJson(VOTE_FILE, {});
  all[chatJid] = { q, opts, votes: {}, by, at: Date.now() };
  saveJson(VOTE_FILE, all);
  return { ok: true, q, opts };
}
function castVote(chatJid, voterJid, n) {
  const all = loadJson(VOTE_FILE, {});
  const v = all[chatJid];
  if (!v) return { err: 'Belum ada voting. Mulai: *!vote tanya? | opsi1 | opsi2*' };
  if (!Number.isInteger(n) || n < 1 || n > v.opts.length) return { err: `Pilih 1–${v.opts.length}. Contoh: *!pilih 1*` };
  v.votes[voterJid] = n;
  saveJson(VOTE_FILE, all);
  return { ok: true, pick: v.opts[n - 1] };
}
function voteResult(chatJid) {
  const v = getVote(chatJid);
  if (!v) return 'Belum ada voting aktif. Mulai: *!vote tanya? | opsi1 | opsi2*';
  const count = v.opts.map(() => 0);
  for (const n of Object.values(v.votes)) if (n >= 1 && n <= count.length) count[n - 1]++;
  const total = Object.keys(v.votes).length;
  const lines = v.opts.map((o, i) => {
    const c = count[i];
    const pct = total ? Math.round((c / total) * 100) : 0;
    const bar = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));
    return `${i + 1}. ${o}\n   ${bar} ${c} suara (${pct}%)`;
  });
  return `📊 *VOTE: ${v.q}*\n${total} pemilih\n\n${lines.join('\n')}\n\nCara pilih: *!pilih <nomor>*`;
}
function closeVote(chatJid) {
  const all = loadJson(VOTE_FILE, {});
  const v = all[chatJid];
  if (!v) return 'Tidak ada voting aktif.';
  delete all[chatJid];
  saveJson(VOTE_FILE, all);
  const count = v.opts.map(() => 0);
  for (const n of Object.values(v.votes)) if (n >= 1 && n <= count.length) count[n - 1]++;
  const total = Object.keys(v.votes).length;
  let win = 0;
  count.forEach((c, i) => { if (c > count[win]) win = i; });
  return `🏁 *VOTING DITUTUP: ${v.q}*\n${total} pemilih\nPemenang: *${v.opts[win]}* (${count[win]} suara)\n\n` +
    v.opts.map((o, i) => `${i + 1}. ${o} — ${count[i]}`).join('\n');
}

// ================= ANTILINK =================
// !antilink on/off/status (khusus admin/owner). Kalau on: link dihapus (bot harus admin) + peringatan 1x/mnt.
const LINK_RE = /(https?:\/\/|www\.|wa\.me\/|chat\.whatsapp\.com\/|t\.me\/|bit\.ly\/|vt\.tiktok\.com\/)/i;
function isAntilinkOn(chatJid) {
  const all = loadJson(ANTILINK_FILE, {});
  return !!all[chatJid];
}
function setAntilink(chatJid, on) {
  const all = loadJson(ANTILINK_FILE, {});
  if (on) all[chatJid] = { on: true, at: new Date().toISOString() };
  else delete all[chatJid];
  saveJson(ANTILINK_FILE, all);
}
function hasLink(text) {
  return LINK_RE.test(String(text || ''));
}

// ================= WELCOME =================
// !welcome on/off/status + !welcometext <teks> (mendukung {nama} {grup}).
// Event group-participants.update dipasang di index.js.
function isWelcomeOn(chatJid) {
  const all = loadJson(WELCOME_FILE, {});
  return !!all[chatJid]?.on;
}
function setWelcome(chatJid, on) {
  const all = loadJson(WELCOME_FILE, {});
  const cur = all[chatJid] || {};
  cur.on = !!on;
  all[chatJid] = cur;
  saveJson(WELCOME_FILE, all);
}
function setWelcomeText(chatJid, text) {
  const all = loadJson(WELCOME_FILE, {});
  const cur = all[chatJid] || { on: true };
  cur.text = String(text || '').slice(0, 300);
  cur.on = true;
  all[chatJid] = cur;
  saveJson(WELCOME_FILE, all);
}
function welcomeTextFor(chatJid, name, groupName, isBye) {
  const all = loadJson(WELCOME_FILE, {});
  const custom = all[chatJid]?.text || '';
  const fill = (t) => t.replace(/\{nama\}/gi, name).replace(/\{grup\}/gi, groupName);
  if (custom) return fill(custom);
  if (isBye) return `👋 ${name} keluar dari *${groupName}*. Sampai jumpa!`;
  return `👋 Halo ${name}, selamat datang di *${groupName}*! 🎉\nKetik *!menu* untuk lihat fitur bot.`;
}

// ================= ABSEN TERCATAT =================
// !absen [judul] -> mulai sesi (tag member). !hadir -> catat. !rekap -> daftar. Otomatis tutup 12 jam.
function startAbsen(chatJid, title) {
  const all = loadJson(ABSEN_FILE, {});
  all[chatJid] = { title: String(title || 'Absen').slice(0, 100), at: Date.now(), hadir: {} };
  saveJson(ABSEN_FILE, all);
  return all[chatJid];
}
function markHadir(chatJid, userJid, pushName) {
  const all = loadJson(ABSEN_FILE, {});
  const a = all[chatJid];
  if (!a) return null;
  if (Date.now() - a.at > 12 * 3600000) { delete all[chatJid]; saveJson(ABSEN_FILE, all); return null; }
  const num = String(userJid || '').split('@')[0];
  a.hadir[num] = { name: String(pushName || num).slice(0, 30), at: new Date().toISOString() };
  saveJson(ABSEN_FILE, all);
  return a;
}
function rekapAbsen(chatJid) {
  const all = loadJson(ABSEN_FILE, {});
  const a = all[chatJid];
  if (!a) return 'Belum ada absen aktif. Mulai: *!absen [judul]* lalu anggota ketik *!hadir*';
  const list = Object.entries(a.hadir);
  if (!list.length) return `📋 *${a.title}*\nBelum ada yang hadir. Ketik *!hadir*`;
  return `📋 *${a.title}* (${list.length} hadir)\n` + list.map(([num, v], i) => `${i + 1}. ${v.name} (@${num})`).join('\n');
}

module.exports = {
  getVote, startVote, castVote, voteResult, closeVote,
  isAntilinkOn, setAntilink, hasLink,
  isWelcomeOn, setWelcome, setWelcomeText, welcomeTextFor,
  startAbsen, markHadir, rekapAbsen,
};