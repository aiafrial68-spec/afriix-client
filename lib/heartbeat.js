// Heartbeat ke dashboard owner (OPT-IN).
// Aktif bila MONITOR_URL diisi. Gagal kirim = diam, bot tetap jalan normal.
// Data terkirim: nomor bot, uptime, status koneksi WA, hitung pesan. Tanpa isi chat.
function startHeartbeat({ url, token, intervalSec, getState }) {
  if (!url) return null;
  const endpoint = String(url).replace(/\/$/, '') + '/api/heartbeat';
  const send = async () => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15000);
      await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (token || '') },
        body: JSON.stringify({ ...(typeof getState === 'function' ? getState() : {}), at: Date.now() }),
        signal: ctrl.signal
      });
      clearTimeout(t);
    } catch {}
  };
  send();
  const iv = setInterval(send, Math.max(10, intervalSec || 10) * 1000);
  try { iv.unref?.(); } catch {}
  return iv;
}

module.exports = { startHeartbeat };
