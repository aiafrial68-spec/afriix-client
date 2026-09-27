// Info cepat tanpa API key — asisten pribadi.
// !cuaca <kota> (Open-Meteo, gratis) | !sholat <kota> (AlAdhan, gratis) | !kurs (ER-API, gratis)
const axios = require('axios');

async function cuaca(kota) {
  const q = String(kota || '').slice(0, 60).trim();
  if (!q) throw new Error('Contoh: *!cuaca solo*');
  const g = await axios.get('https://geocoding-api.open-meteo.com/v1/search', {
    params: { name: q, count: 1, language: 'id' }, timeout: 15000,
  });
  const loc = g.data?.results?.[0];
  if (!loc) throw new Error(`Kota "${q}" tidak ketemu.`);
  const w = await axios.get('https://api.open-meteo.com/v1/forecast', {
    params: {
      latitude: loc.latitude, longitude: loc.longitude,
      current: 'temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m',
      daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max',
      timezone: 'Asia/Jakarta',
    }, timeout: 15000,
  });
  const c = w.data?.current || {};
  const d = w.data?.daily || {};
  const WMO = { 0: 'Cerah ☀️', 1: 'Cerah berawan 🌤️', 2: 'Berawan ⛅', 3: 'Mendung ☁️', 45: 'Berkabut 🌫️', 48: 'Berkabut ❄️', 51: 'Gerimis 🌦️', 53: 'Gerimis 🌦️', 55: 'Gerimis lebat 🌧️', 61: 'Hujan ringan 🌧️', 63: 'Hujan 🌧️', 65: 'Hujan lebat ⛈️', 80: 'Hujan lokal 🌧️', 95: 'Badai petir ⛈️' };
  return `🌤️ *${loc.name}*\n${WMO[c.weather_code] || 'Cuaca: ' + (c.weather_code ?? '-')}\nSuhu ${c.temperature_2m ?? '-'}°C (max ${d.temperature_2m_max?.[0] ?? '-'} / min ${d.temperature_2m_min?.[0] ?? '-'}°C)\nLembap ${c.relative_humidity_2m ?? '-'}% · Angin ${c.wind_speed_10m ?? '-'} km/jam\nPeluang hujan hari ini ${d.precipitation_probability_max?.[0] ?? '-'}%`;
}

async function sholat(kota) {
  const q = String(kota || 'Jakarta').slice(0, 60).trim() || 'Jakarta';
  const r = await axios.get('https://api.aladhan.com/v1/timingsByCity', {
    params: { city: q, country: 'Indonesia', method: 20 }, timeout: 15000,
  });
  const t = r.data?.data?.timings;
  if (!t) throw new Error('Jadwal tidak ketemu.');
  const clean = (s) => String(s || '').slice(0, 5);
  return `🕌 *Jadwal sholat ${q}*\nSubuh ${clean(t.Fajr)} · Terbit ${clean(t.Sunrise)}\nDzuhur ${clean(t.Dhuhr)} · Ashar ${clean(t.Asr)}\nMaghrib ${clean(t.Maghrib)} · Isya ${clean(t.Isha)}`;
}

async function kurs() {
  const r = await axios.get('https://open.er-api.com/v6/latest/USD', { timeout: 15000 });
  const idr = r.data?.rates?.IDR;
  if (!idr) throw new Error('Kurs tidak ketemu.');
  const fmt = (n) => 'Rp ' + Math.round(n).toLocaleString('id-ID');
  return `💱 *Kurs hari ini*\n1 USD = ${fmt(idr)}\n1 juta IDR ≈ ${(1000000 / idr).toFixed(2)} USD`;
}

module.exports = { cuaca, sholat, kurs };
