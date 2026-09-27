// Guard Signal/Noise session untuk Baileys (multi-file auth state).
// Masalah yang ditangani:
// - Bad MAC / No session / Invalid PreKey ID akibat migrasi LID (PN <-> @lid flip)
// - Session corrupt (creds.json rusak/hilang) -> backup & karantina, bukan rm -rf buta
// - Reconnect storm yang memicu rotasi pre-key agresif + risiko ban
const fs = require('fs');
const path = require('path');

const SESSION_DIR = path.resolve(__dirname, '..', process.env.SESSION_DIR || './session');

function ensureSessionDir() {
  try {
    if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(SESSION_DIR, 0o700); } catch {}
  } catch (e) { console.log('session dir err:', e.message); }
  return SESSION_DIR;
}

function credsPath() { return path.join(SESSION_DIR, 'creds.json'); }

// Cek cepat apakah creds masih valid (bukan corrupt). Return { ok, reason }.
function checkCreds() {
  const p = credsPath();
  try {
    if (!fs.existsSync(p)) return { ok: false, reason: 'no-creds' };
    const raw = fs.readFileSync(p, 'utf8');
    if (!raw || raw.length < 50) return { ok: false, reason: 'creds-too-small' };
    const j = JSON.parse(raw);
    // noiseKey & signedIdentityKey wajib ada untuk handshake Noise + Signal
    if (!j.noiseKey?.private || !j.noiseKey?.public) return { ok: false, reason: 'missing-noiseKey' };
    if (!j.signedIdentityKey?.private || !j.signedIdentityKey?.public) return { ok: false, reason: 'missing-signedIdentityKey' };
    if (!j.signedPreKey) return { ok: false, reason: 'missing-signedPreKey' };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'parse-error:' + String(e.message).slice(0, 80) };
  }
}

// Backup creds.json setiap koneksi open (keep 3 terakhir). Dipakai untuk restore manual.
function backupCreds() {
  try {
    const p = credsPath();
    if (!fs.existsSync(p)) return;
    fs.copyFileSync(p, p + '.bak');
    try { fs.chmodSync(p, 0o600); fs.chmodSync(p + '.bak', 0o600); } catch {}
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(p, path.join(SESSION_DIR, `creds-backup-${ts}.json`));
    // prune backup lama, sisakan 3
    const files = fs.readdirSync(SESSION_DIR)
      .filter((f) => f.startsWith('creds-backup-'))
      .sort();
    while (files.length > 3) {
      const old = files.shift();
      try { fs.unlinkSync(path.join(SESSION_DIR, old)); } catch {}
    }
  } catch (e) { console.log('backup creds err:', e.message); }
}

// Karantina session corrupt: rename folder, JANGAN hapus (agar bisa di-restore).
// Return path karantina atau null.
function quarantineSession(reason) {
  try {
    if (!fs.existsSync(SESSION_DIR)) return null;
    const ts = Date.now();
    const dest = `${SESSION_DIR}-corrupt-${ts}`;
    fs.renameSync(SESSION_DIR, dest);
    console.log(`⚠️ Session dikarantina (${reason}): ${SESSION_DIR} -> ${dest}`);
    ensureSessionDir();
    return dest;
  } catch (e) {
    console.log('quarantine err:', e.message);
    return null;
  }
}

// Nomor tampil untuk owner-forward/log: utamakan senderPn (nomor asli) bila ada,
// tapi JANGAN dipakai untuk kirim pesan (session terikat ke JID asli @lid).
function displayNumber(msg, sender) {
  const pn = msg?.key?.senderPn || msg?.key?.participantPn;
  const raw = (pn || sender || '').split('@')[0];
  return (raw || '').replace(/\D/g, '') || raw || '-';
}

// Varian kunci mute/cooldown: satu kontak bisa flip PN<->LID antar pesan.
// Cek semua varian agar redirect-mute tidak bocor saat JID berubah format.
function muteKeysFor(from, sender, senderPn) {
  const keys = new Set();
  if (from) keys.add(from);
  if (sender && sender !== from) keys.add(sender);
  if (senderPn && senderPn !== from && senderPn !== sender) keys.add(senderPn);
  // varian @s.whatsapp.net <-> @lid dengan user part sama (bila LID numerik beda, tidak match — aman)
  for (const jid of [...keys]) {
    const user = String(jid).split('@')[0];
    if (!user) continue;
    keys.add(user + '@s.whatsapp.net');
    keys.add(user + '@lid');
  }
  return [...keys];
}

function isMutedAny(mutedUntil, from, sender, senderPn) {
  const now = Date.now();
  for (const k of muteKeysFor(from, sender, senderPn)) {
    if (mutedUntil[k] && mutedUntil[k] > now) return true;
  }
  return false;
}

function clearEscalationAny(clearFn, from, sender, senderPn) {
  for (const k of muteKeysFor(from, sender, senderPn)) clearFn(k);
}

module.exports = {
  SESSION_DIR,
  ensureSessionDir,
  checkCreds,
  backupCreds,
  quarantineSession,
  displayNumber,
  muteKeysFor,
  isMutedAny,
  clearEscalationAny
};
