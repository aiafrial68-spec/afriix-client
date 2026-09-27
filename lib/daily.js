// Statistik harian otomatis ke owner — asisten pribadi.
// Kirim 1x sehari jam DAILY_REPORT_HOUR (WIB) berisi ringkasan.
// Pakai di index.js: startDaily({ getState, notifyOwner })
function jakartaNow() {
  try {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  } catch {
    return new Date();
  }
}

function startDaily({ getState, notifyOwner, hour }) {
  const h = hour ?? 21;
  let lastSent = '';
  const tick = async () => {
    try {
      const now = jakartaNow();
      const today = now.toISOString().slice(0, 10);
      if (now.getHours() === h && lastSent !== today + '-' + h) {
        lastSent = today + '-' + h;
        const st = getState();
        const txt = `📊 *LAPORAN HARIAN AfriIX*\nTanggal: ${today}\nWA: ${st.connected ? 'Terhubung 🟢' : 'PUTUS 🔴'}\nAuto-AI: ${st.autoAi ? 'ON 🟢' : 'OFF 🔴'}\nPesan masuk: ${st.msgIn}\nBalasan AI: ${st.aiOut}\nDialihkan ke owner: ${st.redirects}\nTerakhir dari: ${st.lastFrom} (${st.lastAt})\nMute aktif: ${(st.muted || []).length}`;
        await notifyOwner(txt);
      }
    } catch {}
  };
  setInterval(tick, 60 * 1000).unref?.();
  return { tick };
}

module.exports = { startDaily };
