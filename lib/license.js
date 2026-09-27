// Lisensi per-pelanggan: 1 kunci = 1 nomor bot.
// Skema: LICENSE_KEY = base64url(payload).base64url(signature)
//   payload = { n: "628xxx", e: "2026-12-31" | "lifetime", p: "basic" }
//   signature = Ed25519(privateKey, payloadB64)
// Public key tertanam di bawah. PRIVATE KEY hanya dipegang owner (JANGAN commit,
// JANGAN kasih ke pelanggan). Pelanggan tidak bisa palsukan kunci tanpa private key.
//
// Cara owner bikin kunci (sekali saja + per pelanggan): lihat .env.example bagian LISENSI.
const crypto = require('crypto');

// GANTI dengan public key milikmu (base64 SPKI, satu baris). Bisa juga via env LICENSE_PUBLIC_KEY.
const EMBEDDED_PUBLIC_KEY = process.env.LICENSE_PUBLIC_KEY || 'MCowBQYDK2VwAyEAqAfmXd16pHZIbht08D9+6Ybq/pBn092r09Nhrne4/sk=';

function b64uToBuf(s) {
  return Buffer.from(String(s || ''), 'base64url');
}

function loadPublicKey() {
  const b64 = (EMBEDDED_PUBLIC_KEY || '').trim();
  if (!b64 || b64 === 'GANTI_DENGAN_PUBLIC_KEY_MILIKMU') return { key: null, dev: true };
  try {
    const key = crypto.createPublicKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'spki' });
    return { key, dev: false };
  } catch (e) {
    return { key: null, dev: false, err: e.message };
  }
}

// Return { ok, reason, payload }. botNumber = nomor dari .env (digits saja).
function verifyLicense(licenseKey, botNumber) {
  const { key, dev, err } = loadPublicKey();
  const num = String(botNumber || '').replace(/\D/g, '');
// Public key wajib dipasang sebelum rilis; lisensi selalu wajib valid.
  if (dev) {
    return { ok: false, reason: 'public key lisensi belum dipasang. Hubungi penjual.' };
  }
  if (err) return { ok: false, reason: 'public key rusak: ' + err };
  if (!licenseKey) return { ok: false, reason: 'LICENSE_KEY kosong. Hubungi penjual untuk kunci lisensi.' };
  const parts = String(licenseKey).trim().split('.');
  if (parts.length !== 2) return { ok: false, reason: 'format LICENSE_KEY salah.' };
  const [payloadB64, sigB64] = parts;
  let payload;
  try {
    payload = JSON.parse(b64uToBuf(payloadB64).toString('utf8'));
  } catch {
    return { ok: false, reason: 'payload lisensi rusak.' };
  }
  const licNum = String(payload.n || '').replace(/\D/g, '');
  if (!licNum) return { ok: false, reason: 'lisensi tanpa nomor bot.' };
  if (num && licNum !== num) {
    return { ok: false, reason: `lisensi untuk nomor ${licNum}, tapi BOT_NUMBER=${num}. 1 lisensi = 1 nomor.` };
  }
  // Masa berlaku: "lifetime"/"" = selamanya, atau YYYY-MM-DD
  const exp = String(payload.e || 'lifetime').toLowerCase();
  if (exp && exp !== 'lifetime') {
    const until = new Date(exp + 'T23:59:59+07:00');
    if (isNaN(until.getTime())) return { ok: false, reason: 'tanggal kedaluwarsa lisensi salah.' };
    if (Date.now() > until.getTime()) return { ok: false, reason: `lisensi kedaluwarsa (${exp}). Perpanjang ke penjual.` };
  }
  let sig;
  try {
    sig = b64uToBuf(sigB64);
  } catch {
    return { ok: false, reason: 'signature lisensi rusak.' };
  }
  let valid = false;
  try {
    valid = crypto.verify(null, Buffer.from(payloadB64, 'utf8'), key, sig);
  } catch (e) {
    return { ok: false, reason: 'gagal verifikasi: ' + e.message };
  }
  if (!valid) return { ok: false, reason: 'signature tidak valid (kunci palsu / rusak).' };
  return { ok: true, reason: 'lisensi valid', payload };
}

// ===== MODE TRIAL (jualan): pembeli tanpa kunci dapat trial N hari =====
// Hanya berlaku saat public key SUDAH dipasang (mode produksi).
// Saat masih DEV (public key placeholder), trial nonaktif — owner bebas.
const fs = require('fs');
const path = require('path');
const TRIAL_FILE = path.join(__dirname, '..', 'data-trial.json');
const TRIAL_DAYS = parseInt(process.env.TRIAL_DAYS || '7', 10);

function trialState() {
  try {
    if (fs.existsSync(TRIAL_FILE)) {
      const j = JSON.parse(fs.readFileSync(TRIAL_FILE, 'utf8') || '{}');
      if (j.startedAt) return j;
    }
  } catch {}
  const st = { startedAt: new Date().toISOString() };
  try { fs.writeFileSync(TRIAL_FILE, JSON.stringify(st, null, 2)); } catch {}
  return st;
}

function trialCheck() {
  const { dev } = loadPublicKey();
  if (dev) return { active: false, daysLeft: Infinity, reason: 'DEV (tanpa public key, trial nonaktif)' };
  const st = trialState();
  const start = new Date(st.startedAt).getTime() || Date.now();
  const usedDays = Math.floor((Date.now() - start) / (24 * 3600 * 1000));
  const daysLeft = TRIAL_DAYS - usedDays;
  return {
    active: true,
    daysLeft,
    ok: daysLeft >= 0,
    reason: daysLeft < 0
      ? `masa trial ${TRIAL_DAYS} hari habis. Hubungi penjual untuk LICENSE_KEY.`
      : `TRIAL ${daysLeft} hari tersisa. Hubungi penjual untuk lisensi permanen.`,
  };
}

// Simpan kunci lisensi ke .env (untuk !aktivasi). Return { ok, reason }.
function saveLicenseKey(key) {
  const clean = String(key || '').trim();
  if (!clean || !clean.includes('.')) return { ok: false, reason: 'format kunci salah (tempel utuh dari penjual).' };
  try {
    const envPath = path.join(__dirname, '..', '.env');
    let raw = '';
    try { raw = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : ''; } catch {}
    if (/^LICENSE_KEY=.*$/m.test(raw)) {
      raw = raw.replace(/^LICENSE_KEY=.*$/m, 'LICENSE_KEY=' + clean);
    } else {
      if (raw && !raw.endsWith('\n')) raw += '\n';
      raw += 'LICENSE_KEY=' + clean + '\n';
    }
    fs.writeFileSync(envPath, raw);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'gagal simpan .env: ' + e.message };
  }
}

module.exports = { verifyLicense, loadPublicKey, trialCheck, saveLicenseKey, TRIAL_DAYS };
