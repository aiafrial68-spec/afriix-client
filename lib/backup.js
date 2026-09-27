// Backup data otomatis — penting saat bot dijual (data pembeli aman).
// File yang dibackup: otak AI, catatan, known-contact, data customer/bot, trial.
// TIDAK ikut: .env (rahasia), session/, node_modules/, logs/.
// Dipakai: startBackup() sekali di start(), !backup manual oleh owner.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..');
const BACKUP_DIR = path.join(DIR, 'backup');
const FILES = [
  'data-ai-ref.json',
  'data-todo.json',
  'data-known.json',
  'data-customers.json',
  'data-bots.json',
  'data-trial.json',
  'afriix-brain.json',
];

function doBackup(tag = 'auto') {
  try {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dest = path.join(BACKUP_DIR, `backup-${tag}-${ts}`);
    fs.mkdirSync(dest, { recursive: true });
    let n = 0;
    for (const f of FILES) {
      const src = path.join(DIR, f);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(dest, f));
        n++;
      }
    }
    // prune: sisakan 7 backup terbaru
    const all = fs.readdirSync(BACKUP_DIR)
      .map((d) => path.join(BACKUP_DIR, d))
      .filter((p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } })
      .sort();
    while (all.length > 7) {
      const old = all.shift();
      try { fs.rmSync(old, { recursive: true, force: true }); } catch {}
    }
    return { ok: true, dest, files: n };
  } catch (e) {
    return { ok: false, err: e.message };
  }
}

// Backup 1x sehari jam 03:00 WIB + sekali saat bot start (tahan restart).
function startBackup() {
  if (global.__backupOn) return;
  global.__backupOn = true;
  try {
    const r = doBackup('start');
    console.log(r.ok ? `💾 Backup awal: ${r.dest} (${r.files} file)` : 'backup err: ' + r.err);
  } catch (e) { console.log('backup err:', e.message); }
  let lastDay = '';
  setInterval(() => {
    try {
      const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
      const today = now.toISOString().slice(0, 10);
      if (now.getHours() === 3 && lastDay !== today) {
        lastDay = today;
        const r = doBackup('auto');
        console.log(r.ok ? `💾 Backup harian: ${r.dest}` : 'backup err: ' + r.err);
      }
    } catch {}
  }, 60 * 1000).unref?.();
}

module.exports = { doBackup, startBackup, BACKUP_DIR };
