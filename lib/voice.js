// Voice Note AI — asisten pribadi.
// 1) !tts teks -> voice note (Google TTS, tanpa API key)
// 2) VN masuk -> transkrip via Groq Whisper -> diteruskan ke AI teks
const axios = require('axios');
const config = require('../config');

async function ttsBuffer(text, lang = 'id') {
  const q = String(text || '').slice(0, 300).trim();
  if (!q) throw new Error('teks kosong');
  const tl = (lang || 'id').slice(0, 5);
  const url = 'https://translate.google.com/translate_tts?ie=UTF-8&tl=' + encodeURIComponent(tl) +
    '&q=' + encodeURIComponent(q) + '&client=tw-ob';
  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 20000,
    headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://translate.google.com/' },
  });
  if (!res.data || !res.data.length) throw new Error('TTS gagal');
  return Buffer.from(res.data);
}

async function transcribeGroq(audioBuffer, mime = 'audio/ogg') {
  const key = config.ai.key;
  if (!key) throw new Error('AI_API_KEY kosong (transkrip butuh KEY1 Groq).');
  if (!audioBuffer || !audioBuffer.length) throw new Error('audio kosong');
  if (audioBuffer.length > 20 * 1024 * 1024) throw new Error('VN >20MB');
  const fd = new FormData();
  fd.append('file', new Blob([audioBuffer], { type: mime }), 'vn.ogg');
  fd.append('model', config.ai.whisperModel || 'whisper-large-v3-turbo');
  fd.append('language', 'id');
  const res = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', fd, {
    headers: { Authorization: `Bearer ${key}` },
    timeout: 60000,
  });
  return (res.data?.text || '').trim() || null;
}

module.exports = { ttsBuffer, transcribeGroq };
