const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const aiStats = { requests: 0, success: 0, failed: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, estimated: 0, lastAt: '-', lastModel: '-', lastMs: 0 };
function recordUsage(data, model, startedAt) {
  const usage = data?.usage || {};
  const input = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0;
  const output = Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0;
  const total = Number(usage.total_tokens ?? (input + output)) || 0;
  aiStats.inputTokens += input;
  aiStats.outputTokens += output;
  aiStats.totalTokens += total;
  aiStats.estimated += input + output ? 0 : 1;
  aiStats.lastAt = new Date().toISOString();
  aiStats.lastModel = model || '-';
  aiStats.lastMs = Date.now() - startedAt;
}
function aiTelemetry() { return { ...aiStats }; }

const history = {}; // ingatan per pengirim (RAM, max 100)

// ============ DETEKSI BAHASA (ngoko/madya/krama/ID/EN/slang) ============
const JV_INGGIL = ['panjenengan', 'dalem', 'kulo', 'suwun', 'matur', 'nuwun', 'dhawah', 'nggih', 'mboten', 'saget', 'kagem', 'dipun', 'wonten', 'pripun', 'sugeng', 'pangapunten', 'sare', 'dhahar'];
const JV_MADYA = ['sampean', 'sampeyan', 'monggo', 'teng', 'niki', 'niku', 'menopo', 'kaleh', 'saking', 'dumateng'];
const JV_NGOKO = ['piye', 'kabare', 'apik', 'kowe', 'koe', 'iku', 'iki', 'opo', 'sopo', 'ngopo', 'mangan', 'turu', 'dolan', 'ngopi', 'rek', 'ae', 'kok', 'wis', 'wes', 'ora', 'ojok', 'ayo'];
const ID_WORDS = ['yang', 'dan', 'dengan', 'untuk', 'dari', 'kamu', 'saya', 'tolong', 'bantu', 'berapa', 'gimana', 'kenapa', 'bisa', 'sudah', 'belum', 'jangan', 'lagi', 'banget'];
const EN_SLANG = ['wanna', 'gonna', 'gotta', 'lol', 'lmao', 'bro', 'dude', 'yo', 'yeah', 'yep', 'btw', 'idk', 'tbh', 'ngl', 'bruh', "what's up", 'whatsup'];
const EN_WORDS = ['the', 'you', 'your', 'what', 'how', 'are', 'please', 'thanks', 'thank', 'hello', 'good', 'morning', 'evening', 'where', 'when', 'why', 'could', 'would'];

function hits(low, list) {
  let n = 0;
  for (const w of list) {
    if (new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(low)) n++;
  }
  return n;
}
function detectLang(text) {
  const t = (text || '').trim();
  if (!t) return 'id';
  if (/[\u0600-\u06FF\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF\u0E00-\u0E7F\u0400-\u04FF]/.test(t)) return 'unknown';
  const low = ' ' + t.toLowerCase() + ' ';
  const inggil = hits(low, JV_INGGIL), madya = hits(low, JV_MADYA), ngoko = hits(low, JV_NGOKO);
  const id = hits(low, ID_WORDS), en = hits(low, EN_WORDS) + hits(low, EN_SLANG) * 1.5;
  if (inggil > 0 && inggil >= madya) return 'jv_krama';
  if (madya > 0 && madya >= ngoko) return 'jv_madya';
  const best = Math.max(ngoko, id, en);
  if (best === 0) return 'id';
  if (en === best && en > id) return hits(low, EN_SLANG) > 0 ? 'en_slang' : 'en';
  if (ngoko === best) return 'jv_ngoko';
  return 'id';
}
const LANG_LABEL = { jv_ngoko: 'Jawa ngoko', jv_madya: 'Jawa madya', jv_krama: 'Jawa krama inggil', id: 'Indonesia', en: 'Inggris', en_slang: 'Inggris gaul', unknown: 'tidak dikenal' };

// ============ OTAK: simpan tiap chat sebagai referensi ============
const BRAIN_FILE = path.join(__dirname, '..', 'data-ai-ref.json');
const brain = { chats: 0, byLang: {}, slang: {}, phrases: {}, users: {}, examples: [] };
try {
  if (fs.existsSync(BRAIN_FILE)) Object.assign(brain, JSON.parse(fs.readFileSync(BRAIN_FILE, 'utf8') || '{}'));
} catch {}
let saveT = null;
function saveBrain() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    try {
      if (brain.examples.length > 200) brain.examples = brain.examples.slice(-200);
      const sk = Object.keys(brain.slang);
      if (sk.length > 300) for (const k of sk.slice(0, sk.length - 300)) delete brain.slang[k];
      fs.writeFileSync(BRAIN_FILE, JSON.stringify(brain, null, 1));
    } catch {}
  }, 1500);
  try { saveT.unref?.(); } catch {}
}
/** Asah otak: panggil SETIAP ada chat (cepat maupun AI). */
/** Ekstrak memori user: nama ("namaku X", "panggil aku X") + kota ("aku di X", "dari X").
 *  Formal: SEMUA kontak dipanggil "kak" — umur/gender TIDAK disimpan. */
function extractMemory(inText) {
  const mem = {};
  const t = String(inText || '');
  let m = t.match(/(?:nama\s*(aku|saya|gue|ku)?\s*(adalah|itu|:\s*)?\s*|panggil\s+(aku|saya)\s+|panggil\s+aja\s+)([A-Za-z]{2,20})/i);
  if (m) {
    const nm = (m[4] || '').trim().slice(0, 20);
    if (nm && !/^(yang|dan|ini|itu|bang|kak|mas|bro)$/i.test(nm)) mem.name = nm;
  }
  m = t.match(/(?:aku|saya|gue|tinggal|domisili)\s+(?:di|dari|asal)\s+([A-Za-z\u00C0-\u024F\s]{3,25})/i);
  if (m) {
    const city = m[1].trim().split(/\s+/).slice(0, 2).join(' ');
    if (city.length >= 3) mem.city = city;
  }
  return mem;
}
function learnChat(inText, outText, lang, senderNum) {
  try {
    brain.chats++;
    brain.byLang[lang] = (brain.byLang[lang] || 0) + 1;
    const words = (inText || '').toLowerCase().replace(/[^a-z'\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 2 && w.length <= 16);
    for (const w of words.slice(0, 25)) {
      if (/^(yang|dan|dengan|untuk|dari|the|and|apa|ini|itu|iya)$/.test(w)) continue;
      brain.slang[w] = (brain.slang[w] || 0) + 1;
    }
    for (let i = 0; i < Math.min(words.length - 1, 10); i++) {
      const ph = words[i] + ' ' + words[i + 1];
      if (ph.length >= 5 && ph.length <= 30) brain.phrases[ph] = (brain.phrases[ph] || 0) + 1;
    }
    if (senderNum) {
      const u = brain.users[senderNum] || { n: 0, lang: 'id', first: new Date().toISOString().slice(0, 10) };
      u.n++; u.lang = lang; u.last = new Date().toISOString().slice(0, 10);
      const extra = extractMemory(inText);
      if (extra.name) u.name = extra.name;
      if (extra.city) u.city = extra.city;
      // bersih-bersih sisa data umur/gender era lama (fitur dicabut, sapaan selalu "kak")
      if (u.age !== undefined) delete u.age;
      if (u.gender !== undefined) delete u.gender;
      if (u.addr !== undefined) delete u.addr;
      // bahasa dominan: hitung sederhana, update hanya jika sudah 3+ chat
      if (!u.langCount) u.langCount = {};
      u.langCount[lang] = (u.langCount[lang] || 0) + 1;
      if (u.n >= 3) {
        let best = u.lang, bestN = 0;
        for (const [k, v] of Object.entries(u.langCount)) if (v > bestN) { bestN = v; best = k; }
        u.lang = best;
      }
      brain.users[senderNum] = u;
    }
    if (inText && outText) brain.examples.push({ i: inText.slice(0, 120), o: outText.slice(0, 120), l: lang });
    saveBrain();
  } catch {}
}
function topSlang(n = 12) {
  return Object.entries(brain.slang).sort((a, b) => b[1] - a[1]).slice(0, n).map(([w]) => w);
}
function brainStats() {
  const us = Object.values(brain.users || {});
  const named = us.filter((u) => u.name).length;
  return `🧠 Otak: ${brain.chats} chat | ${Object.entries(brain.byLang).map(([k, v]) => `${k}=${v}`).join(', ') || '-'}\nUser dikenal: ${us.length} (${named} bernama)\nKata top: ${topSlang(10).join(', ') || '-'}`;
}
// Ringkasan terstruktur untuk dashboard modern (tanpa contoh chat penuh — hemat RAM).
function brainSummary() {
  const top = (o, n) => Object.entries(o || {}).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, c]) => ({ k, c }));
  return {
    chats: brain.chats || 0,
    byLang: brain.byLang || {},
    users: Object.keys(brain.users || {}).length,
    topSlang: top(brain.slang, 12),
    topPhrases: top(brain.phrases, 8),
  };
}
function resetBrain() {
  brain.chats = 0; brain.byLang = {}; brain.slang = {}; brain.phrases = {}; brain.users = {}; brain.examples = [];
  saveBrain();
}

function buildPrompt(lang, senderNum) {
  const base = config.ai.systemPrompt || '';
  const slang = topSlang(12).join(', ');
  const u = (senderNum && brain.users[senderNum]) || null;
  let rule = '';
  if (lang === 'jv_ngoko') rule = 'Balas Jawa NGOKO santai (piye, kowe, apik, wes, ora). Max 2 kalimat pendek.';
  else if (lang === 'jv_madya') rule = 'Balas Jawa KRAMA MADYA (sampean, monggo, teng). Sopan tengah.';
  else if (lang === 'jv_krama') rule = 'Balas Jawa KRAMA INGGIL alus (kulo, panjenengan, matur nuwun, nggih, mboten). Sangat sopan.';
  else if (lang === 'en_slang') rule = "Reply in chill English slang, 1-2 short sentences.";
  else if (lang === 'en') rule = 'Reply in casual English, 1-2 short sentences.';
  else rule = 'Balas Bahasa Indonesia santai, 1-2 kalimat pendek.';
  // Memori user: nama + kota + histori bahasa — biar terasa kenal, bukan template.
  // Formal: SEMUA user dipanggil "kak" (tanpa mas/mbak/pak/bu/dek).
  let memLine = '';
  if (u) {
    const bits = [];
    if (u.name) bits.push(`namanya ${u.name}`);
    if (u.city) bits.push(`di ${u.city}`);
    bits.push(`dominan ${u.lang} (${u.n}x chat)`);
    memLine = ` Ingat user ini: ${bits.join(', ')}. Sapa dengan nama sesekali, jangan tiap pesan.`;
  }
  // Few-shot: 2 contoh jawaban se-bahasa terakhir biar gaya konsisten
  let exLine = '';
  try {
    const same = (brain.examples || []).filter((e) => e.l === lang).slice(-2);
    if (same.length) exLine = `\nContoh gayamu sebelumnya (tirulah gayanya, jangan diulang kata-katanya):\n` +
      same.map((e) => `User: ${e.i}\nKamu: ${e.o}`).join('\n');
  } catch {}
  return `${base}\n${rule}\nBahasa user: ${LANG_LABEL[lang] || lang}.${memLine}${slang ? `\nGaya kata manusia (pakai natural bila cocok): ${slang}.` : ''}${exLine}\nPenting: variasikan kalimat pembuka, jangan selalu "Halo kak" / "Siap". Jangan mengulang jawaban persis dari riwayat.\nSapaan FORMAL: panggil SEMUA user dengan sebutan "kak" saja — jangan pernah pakai mas/mbak/pak/bu/dek/bro/sis.`;
}

function getHistory(jid) {
  if (!history[jid]) history[jid] = [];
  return history[jid];
}
function pushHistory(jid, role, content) {
  const keys = Object.keys(history);
  if (!history[jid] && keys.length > 100) delete history[keys[0]];
  const h = getHistory(jid);
  h.push({ role, content: (content || '').slice(0, 400) });
  while (h.length > 16) h.shift(); // ingatan lebih panjang: 8x tukar pesan
}
// Cegah bot mengulang kalimat yang sama persis (terasa spam/template)
// NOTE: dipanggil SETELAH pushHistory, jadi abaikan 1 entri terakhir (pesan itu sendiri)
// dan bandingkan dengan jawaban sebelumnya.
function isRepeatReply(jid, txt) {
  try {
    const h = getHistory(jid).filter((m) => m.role === 'assistant');
    if (h.length < 2 || !txt) return false;
    const prev = h[h.length - 2];
    if (!prev?.content) return false;
    const a = prev.content.toLowerCase().trim(), b = String(txt).toLowerCase().trim();
    return !!(a && (a === b || (a.length > 20 && b.includes(a)) || (b.length > 20 && a.includes(b))));
  } catch { return false; }
}
// Profil user untuk !profil / dashboard
function userProfile(num) {
  const u = num && brain.users[num];
  if (!u) return null;
  return { chats: u.n || 0, lang: u.lang || 'id', name: u.name || '', city: u.city || '', first: u.first || '-', last: u.last || '-' };
}

function humanize(txt) {
  if (!txt) return null;
  let t = txt.trim();
  t = t.replace(/^(sebagai AI[^,.\n]*[,.\n]?)/i, '');
  t = t.replace(/saya adalah (AI|asisten AI|bot|model bahasa)[^,.\n]*[,.\n]?/gi, '');
  t = t.replace(/^(saya (sebuah|seorang) (AI|bot|asisten virtual))[^,.\n]*[,.\n]?/gi, '');
  t = t.replace(/\s+/g, ' ').trim();
  // 1 bubble: max 2 kalimat / 400 char
  const parts = t.split(/(?<=[.!?])\s+/);
  if (parts.length > 2) t = parts.slice(0, 2).join(' ');
  if (t.length > 400) t = t.slice(0, 397).trim() + '...';
  return t || null;
}

function isOllamaNative(url) {
  const u = (url || '').toLowerCase();
  // native Ollama: .../api/chat (cloud: ollama.com/api/chat, lokal: :11434/api/chat)
  // bukan OpenAI-compatible (.../v1/chat/completions)
  return u.includes('/api/chat') && !u.includes('/v1/');
}
function isLocalOllama(url) {
  const u = (url || '').toLowerCase();
  return u.includes('127.0.0.1') || u.includes('localhost') || u.includes(':11434');
}

async function aiWithOllamaNative(userText, jid, url, model, key, pushName, lang, senderNum) {
  const displayText = pushName ? `[${String(pushName).slice(0, 30)}]: ${userText}` : userText;
  const msgs = [
    { role: 'system', content: buildPrompt(lang || detectLang(userText), senderNum) },
    ...getHistory(jid),
    { role: 'user', content: displayText }
  ];
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;
  aiStats.requests++;
  const startedAt = Date.now();
  const res = await axios.post(
    url,
    { model, messages: msgs, stream: false, options: { temperature: 0.85, num_predict: 220 } },
    { headers, timeout: 30000 }
  );
  recordUsage(res.data, model, startedAt);
  aiStats.success++;
  const txt = (res.data?.message?.content || res.data?.response || '').trim();
  if (txt) {
    pushHistory(jid, 'user', userText);
    pushHistory(jid, 'assistant', txt);
  }
  return humanize(txt);
}

async function aiWithKey(userText, jid, url, model, key, pushName, lang, senderNum) {
  if (isOllamaNative(url)) {
    return aiWithOllamaNative(userText, jid, url, model, key, pushName, lang, senderNum);
  }
  const displayText = pushName ? `[${String(pushName).slice(0, 30)}]: ${userText}` : userText;
  const msgs = [
    { role: 'system', content: buildPrompt(lang || detectLang(userText), senderNum) },
    ...getHistory(jid),
    { role: 'user', content: displayText }
  ];
  aiStats.requests++;
  const startedAt = Date.now();
  recordUsage(res.data, model, startedAt);
  aiStats.success++;
  const txt = res.data?.choices?.[0]?.message?.content?.trim();
  if (txt) {
    pushHistory(jid, 'user', userText);
    pushHistory(jid, 'assistant', txt);
  }
  return humanize(txt);
}

let warnedNoKey = false;
// Cadangan gratis (tanpa key): Pollinations OpenAI-compatible. Dipakai terakhir.
async function aiFree(userText, jid, pushName, lang, senderNum) {
  const displayText = pushName ? `[${String(pushName).slice(0, 30)}]: ${userText}` : userText;
  const res = await axios.post('https://text.pollinations.ai/openai',
    {
      model: 'openai',
      messages: [
        { role: 'system', content: buildPrompt(lang || detectLang(userText), senderNum) },
        ...getHistory(jid),
        { role: 'user', content: displayText },
      ],
    },
    { headers: { 'Content-Type': 'application/json' }, timeout: 25000 });
  const txt = res.data?.choices?.[0]?.message?.content?.trim();
  if (txt) {
    pushHistory(jid, 'user', userText);
    pushHistory(jid, 'assistant', txt);
  }
  return humanize(txt);
}

async function aiReply(userText, jid = 'default', pushName = '', lang = '', senderNum = '') {
  lang = lang || detectLang(userText);
  const errors = [];
  const slots = [
    { url: config.ai.url, model: config.ai.model, key: config.ai.key, tag: 'KEY1' },
    { url: config.ai.url2, model: config.ai.model2, key: config.ai.key2, tag: 'KEY2' }
  ].filter((s) => s.url && s.model && (s.key || isLocalOllama(s.url)));
  if (!slots.length && !warnedNoKey) {
    warnedNoKey = true;
    console.log('[AI] AI_API_KEY kosong! Isi di .env (provider OpenAI-compatible, mis. Groq: console.groq.com).');
  }
  let firstR = null;
  for (const s of slots) {
    try {
      const r = await aiWithKey(userText, jid, s.url, s.model, s.key, pushName, lang, senderNum);
      if (r && !isRepeatReply(jid, r)) return r;
      if (r && !firstR) firstR = r; // cadangan bila semua slot jawabannya sama
    } catch (e) { aiStats.failed++; errors.push(s.tag + ': ' + (e.response?.data?.error?.message || e.message)); }
  }
  if (firstR) return firstR;
  // Cadangan gratis terakhir (tanpa key) agar bot tetap jawab saat key limit/mati
  try {
    const r = await aiFree(userText, jid, pushName, lang, senderNum);
    if (r) {
      if (errors.length) console.log('[AI] key gagal, pakai gratis:', errors.join(' | '));
      return r;
    }
  } catch (e) { errors.push('FREE: ' + (e.message || '')); }
  if (errors.length) console.log('[AI] semua gagal:', errors.join(' | '));
  return null;
}

module.exports = { aiReply, aiTelemetry, pushHistory, detectLang, learnChat, brainStats, brainSummary, resetBrain, LANG_LABEL, userProfile, isRepeatReply };
