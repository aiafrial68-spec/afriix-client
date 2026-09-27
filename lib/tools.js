const axios = require('axios');

async function translate(text, to = 'en') {
  if (!text || text.length > 1000) throw new Error('Teks terlalu panjang (max 1000)');
  to = (to || 'en').toLowerCase().replace(/[^a-z-]/g, '').slice(0, 10) || 'en';
  const q = text.slice(0, 1000);
  // Coba autodetect dulu (MyMemory dukung auto|target), fallback ke tebakan id/en lama
  const pairs = [`auto|${to}`];
  const src = to === 'id' ? 'en' : 'id';
  pairs.push(`${src}|${to}`);
  let lastErr = null;
  for (const langpair of pairs) {
    try {
      const res = await axios.get('https://api.mymemory.translated.net/get', {
        params: { q, langpair }, timeout: 15000
      });
      const out = res.data?.responseData?.translatedText || null;
      // MyMemory kadang kembalikan error string "QUERY LENGTH LIMIT", "INVALID TARGET LANGUAGE", dsb
      if (out && !/^(QUERY LENGTH LIMIT|INVALID|MYMEMORY WARNING)/i.test(out)) return out;
      lastErr = new Error(out || 'translate gagal');
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Gagal translate.');
}

async function shortlink(url) {
  if (!url || url.length > 2048 || !/^https?:\/\/[^\s"'`$&|;<>]+$/i.test(url)) {
    throw new Error('URL tidak valid');
  }
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (['localhost', '127.0.0.1', '0.0.0.0'].includes(host) || /^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
      throw new Error('URL lokal diblokir');
    }
  } catch (e) {
    if (e.message.includes('diblokir')) throw e;
    throw new Error('URL tidak valid');
  }
  const res = await axios.get('https://is.gd/create.php', {
    params: { format: 'simple', url }, timeout: 15000
  });
  return (typeof res.data === 'string' ? res.data : null);
}

async function qrBuffer(text) {
  if (!text || text.length > 1000) throw new Error('Teks QR max 1000 karakter');
  const res = await axios.get('https://api.qrserver.com/v1/create-qr-code/', {
    params: { size: '512x512', data: text.slice(0, 1000) }, responseType: 'arraybuffer', timeout: 20000
  });
  return Buffer.from(res.data);
}

async function pollinationsImage(prompt, opts = {}) {
  if (!prompt || prompt.trim().length < 3) throw new Error('Deskripsi gambar min 3 karakter');
  if (prompt.length > 500) throw new Error('Deskripsi gambar max 500 karakter');
  const width = Math.min(2048, Math.max(256, parseInt(opts.width, 10) || 1024));
  const height = Math.min(2048, Math.max(256, parseInt(opts.height, 10) || 1024));
  const model = (opts.model || process.env.POLLINATIONS_MODEL || 'flux').replace(/[^a-z0-9-]/gi, '').slice(0, 30) || 'flux';
  const seed = opts.seed ?? Math.floor(Math.random() * 1000000);
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt.trim().slice(0, 500))}`;
  const res = await axios.get(url, {
    params: { width, height, seed, nologo: true, model },
    responseType: 'arraybuffer', timeout: 90000,
    headers: { Accept: 'image/*' }
  });
  const buf = Buffer.from(res.data);
  if (!buf || buf.length < 1024) throw new Error('Gambar kosong dari Pollinations');
  const ct = String(res.headers?.['content-type'] || '');
  if (ct.includes('application/json')) throw new Error('Pollinations menolak prompt');
  return buf;
}

function calc(expr) {
  if (!expr || expr.length > 100) throw new Error('ekspresi terlalu panjang');
  const clean = (expr || '').replace(/[^0-9+\-*/().%\s]/g, '');
  if (!clean || clean.length > 100) throw new Error('ekspresi tidak valid');
  if (/\/\s*0(?!\d)/.test(clean)) throw new Error('ekspresi tidak valid');
  // cegah kurung tak seimbang & operator ganda berbahaya
  const open = (clean.match(/\(/g) || []).length;
  const close = (clean.match(/\)/g) || []).length;
  if (open !== close) throw new Error('kurung tidak seimbang');
  if (/(\*\*){4,}|([+\-*/%]\s*){4,}/.test(clean)) throw new Error('ekspresi tidak valid');
  if (!/[0-9)]/.test(clean)) throw new Error('ekspresi tidak valid');
  // eslint-disable-next-line no-new-func
  const fn = new Function(`return (${clean})`);
  const out = fn();
  if (typeof out !== 'number' || !isFinite(out) || Math.abs(out) > 1e15) throw new Error('ekspresi tidak valid');
  return Math.round(out * 1e8) / 1e8;
}

module.exports = { translate, shortlink, qrBuffer, calc, pollinationsImage };
