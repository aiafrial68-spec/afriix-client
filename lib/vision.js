// AI baca gambar (vision) — asisten pribadi, bukan jualan.
// Pakai endpoint OpenAI-compatible yang sama (Groq) + model vision khusus.
// Cara pakai dari index.js: aiVision(buffer, caption, { lang })
const axios = require('axios');
const config = require('../config');

function bufToDataUri(buf, mime = 'image/jpeg') {
  return `data:${mime};base64,${buf.toString('base64')}`;
}

async function aiVision(imgBuffer, caption = '', opts = {}) {
  const key = config.ai.key;
  const url = config.ai.url;
  if (!key || !url) throw new Error('AI_API_KEY kosong (vision butuh KEY1 Groq).');
  if (!imgBuffer || !imgBuffer.length) throw new Error('gambar kosong');
  if (imgBuffer.length > 8 * 1024 * 1024) throw new Error('gambar >8MB');
  const q = (caption || '').slice(0, 500) || 'Tolong jelaskan isi gambar ini dalam 1-2 kalimat santai seperti manusia.';
  const dataUri = bufToDataUri(imgBuffer, 'image/jpeg');
  const body = (model) => ({
    model,
    messages: [
      { role: 'system', content: (config.ai.systemPrompt || '') + '\nKamu bisa melihat gambar. Jawab maksimal 2 kalimat pendek, natural.' },
      {
        role: 'user',
        content: [
          { type: 'text', text: q },
          { type: 'image_url', image_url: { url: dataUri } },
        ],
      },
    ],
    max_tokens: 250,
    temperature: 0.7,
  });
  // Model vision aktif di Groq (2026). llama-3.2-vision sudah dimatikan (400).
  const candidates = [...new Set([
    config.ai.visionModel,
    'qwen/qwen3.8-27b',
    'meta-llama/llama-4-maverick-17b-128e-instruct',
    'meta-llama/llama-4-scout-17b-16e-instruct',
  ].filter(Boolean))];
  let lastErr = null;
  for (const model of candidates) {
    try {
      const res = await axios.post(url, body(model),
        { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, timeout: 30000 });
      let txt = res.data?.choices?.[0]?.message?.content?.trim() || '';
      const parts = txt.split(/(?<=[.!?])\s+/);
      if (parts.length > 2) txt = parts.slice(0, 2).join(' ');
      if (txt.length > 400) txt = txt.slice(0, 397).trim() + '...';
      if (txt) return txt;
      lastErr = new Error(`model ${model}: respon kosong`);
    } catch (e) {
      lastErr = new Error(`model ${model}: ${(e.response?.data?.error?.message || e.message || '').slice(0, 200)}`);
      // 400 = model tidak berlaku → coba model berikutnya; error lain (401/429) langsung berhenti
      const status = e.response?.status;
      if (status && status !== 400 && status !== 404) break;
    }
  }
  throw lastErr || new Error('vision gagal');
}

module.exports = { aiVision };
