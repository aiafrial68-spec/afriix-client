const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'data-todo.json');

function normUser(jidOrNum) {
  if (!jidOrNum) return 'unknown';
  // dukung JID (@s.whatsapp.net/@lid/@g.us) maupun nomor mentah
  const s = String(jidOrNum).split('@')[0].replace(/\D/g, '');
  return s || String(jidOrNum).slice(0, 32);
}

function loadMap() {
  try {
    if (!fs.existsSync(FILE)) return {};
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8') || '{}');
    // migrasi format lama (array global) -> arsipkan, mulai per-user agar privasi terjaga
    if (Array.isArray(raw)) {
      try { fs.writeFileSync(FILE + '.legacy-bak', JSON.stringify(raw, null, 2)); } catch {}
      return {};
    }
    return (raw && typeof raw === 'object') ? raw : {};
  } catch { return {}; }
}
function saveMap(m) {
  // batasi: max 200 user x 50 item agar file tidak bengkak
  const keys = Object.keys(m);
  if (keys.length > 200) {
    keys.slice(0, keys.length - 200).forEach((k) => delete m[k]);
  }
  fs.writeFileSync(FILE, JSON.stringify(m, null, 2));
}
function add(userJid, text) {
  const u = normUser(userJid);
  const clean = String(text || '').slice(0, 500).trim();
  if (!clean) return 0;
  const m = loadMap();
  if (!m[u]) m[u] = [];
  if (m[u].length >= 50) m[u].shift(); // FIFO, max 50/user
  m[u].push({ text: clean, done: false, at: new Date().toISOString() });
  saveMap(m);
  return m[u].length;
}
function listText(userJid) {
  const u = normUser(userJid);
  const list = loadMap()[u] || [];
  if (!list.length) return 'Catatan kosong. Tambah: *!ingat beli bensin besok*';
  return '*CATATANMU:*\n' + list.map((t, i) => `${i + 1}. ${t.done ? '✅' : '⬜'} ${t.text}`).join('\n') +
    '\n\n*!selesai 1* = tandai selesai\n*!hapus 1* = hapus';
}
function done(userJid, idx) {
  const u = normUser(userJid);
  const m = loadMap();
  const list = m[u] || [];
  const i = idx - 1;
  if (!list[i]) return null;
  list[i].done = true;
  saveMap(m);
  return list[i];
}
function hapus(userJid, idx) {
  const u = normUser(userJid);
  const m = loadMap();
  const list = m[u] || [];
  const i = idx - 1;
  if (!list[i]) return null;
  const [x] = list.splice(i, 1);
  saveMap(m);
  return x;
}

module.exports = { add, listText, done, hapus };
