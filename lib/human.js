// Biar balasan terasa seperti manusia: typing + jeda wajar.
// DEFAULT 1 BUBBLE. Pecah jadi 2 hanya kalau opts.multi === true (penting).
async function sendHuman(sock, from, quoted, text, opts = {}) {
  if (!text) return;
  let parts = [text];
  if (opts.multi && text.length > 280) {
    const idx = text.search(/[.!?]\s/);
    if (idx > 80 && idx < 300) {
      parts = [text.slice(0, idx + 1).trim(), text.slice(idx + 1).trim()];
    } else {
      const mid = Math.floor(text.length / 2);
      const sp = text.lastIndexOf(' ', mid);
      parts = sp > 0 ? [text.slice(0, sp).trim(), text.slice(sp).trim()] : [text];
    }
  }
  for (const p of parts) {
    if (!p) continue;
    try { await sock.sendPresenceUpdate('composing', from); } catch {}
    // jeda mengetik: 0.8s + 15ms per karakter, max 2.5s. Responsif tapi tetap natural.
    const delay = Math.min(2500, Math.max(800, p.length * 15));
    await new Promise((r) => setTimeout(r, delay));
    try { await sock.sendPresenceUpdate('paused', from); } catch {}
    await sock.sendMessage(from, { text: p }, { quoted });
  }
}

// Sapaan murni (tanpa isi lain) — dipakai agar tidak sapa ganda
function isGreeting(text) {
  const t = (text || '').toLowerCase().trim();
  return /^(halo|hallo|hai|hi|pagi|siang|sore|malam|assalamu ?alaikum|assalamualaikum|permisi|hei|hey)(\s+(mas|mba|mbak|bang|kak|bro|sis|gan|pak|bu|om|tante|kakak|dek))?[.!,\s]*$/.test(t);
}

// Pesan super pendek ala manusia tidak perlu panggil AI (hemat + cepat)
function quickReply(text) {
  const t = (text || '').toLowerCase().trim();
  // sapaan + alamat opsional: "halo", "halo mas", "pagi kak", "assalamualaikum bang"
  if (isGreeting(t)) {
    const v = ['Halo kak 👋 Ada yang bisa saya bantu?', 'Halo kak, silakan. Perlu bantuan apa?', 'Halo kak 👋 Terima kasih sudah menghubungi Afrial. Ada yang bisa dibantu?'];
    return v[Math.floor(Math.random() * v.length)];
  }
  if (/^(apa kabar|gimana kabar|piye kabare|kabare piye)[?.!\s]*$/.test(t)) {
    const v = ['Baik, kamu gimana?', 'Aman, kamu sendiri gimana?', 'Apik, kowe piye?'];
    return v[Math.floor(Math.random() * v.length)];
  }
  if (/^(ok|oke|siap|sip|okei|mantap|gass?|gas)[.!🙏👍]*$/.test(t)) {
    const v = ['Oke 👍', 'Siap', 'Oke sip'];
    return v[Math.floor(Math.random() * v.length)];
  }
  if (/^(makasih|terima kasih|thanks|thank you|nuwun|matur|matur nuwun|matur suwun|suwun)[.!🙏]*$/.test(t)) {
    const v = ['Sama-sama 😊', 'Siap, sama-sama', 'Oke sama-sama'];
    return v[Math.floor(Math.random() * v.length)];
  }
  if (/^(lagi apa|lagi ngapain|lagi ngopo)[?.\s]*$/.test(t)) {
    const v = ['Lagi santai aja, kenapa?', 'Nggak ngapa-ngapain, ada apa?'];
    return v[Math.floor(Math.random() * v.length)];
  }
  // cek bot hidup tanpa panggil AI
  if (/^(tes|test|bot|ping|aktif|online)[?.!\s]*$/.test(t)) {
    const v = ['Aktif nih, ada apa?', 'Ya, online. Perlu apa?'];
    return v[Math.floor(Math.random() * v.length)];
  }
  return null;
}

function shouldSkip(text) {
  const t = (text || '').trim();
  if (t.length <= 1) return true;
  if (/^\d{4,8}$/.test(t)) return true; // kode OTP 4-8 digit, jangan dibalas AI (harga panjang tetap diproses)
  if (/^(stiker|sticker|!)/i.test(t)) return true;
  return false;
}

// Bahasa asing / tidak dikenal -> nanti diteruskan ke Tuan Afrial.
// 1. Aksara non-latin (Arab, Mandarin, Jepang, Korea, Thai, Cyrillic, dll)
// 2. Teks latin panjang tanpa vokal (kemungkinan gibberish) — tapi jangan false-positive untuk singkatan alay.
function isUnknownLanguage(text) {
  const t = (text || '').trim();
  if (!t || t.length < 4) return false;
  if (/[\u0600-\u06FF\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF\u0E00-\u0E7F\u0400-\u04FF\u0900-\u097F]/.test(t)) return true;
  const laugh = /^(wkwk+|haha+|hehe+|hihi+|xixi+|lol+)[\s.!]*$/i.test(t);
  if (laugh) return false;
  const low = t.toLowerCase();
  // kata Indonesia/Jawa umum -> pasti bukan bahasa asing, meski banyak konsonan (singkatan alay)
  if (/\b(yang|dan|atau|dengan|untuk|dari|ke|di|ini|itu|iya|gak|nggak|bang|kak|mas|mba|mbak|bro|gan|gan|saya|kamu|anda|tolong|bantu|minta|tanya|berapa|gimana|gmn|brngkt|berangkat|skrg|sekarang|jmpt|jemput|mtr|motor|bsa|bisa|dng|dengan|sdh|sudah|blm|belum|piye|kabare|apik|kowe|sampean|sampeyan|monggo|kulo|matur|nuwun|suwun|nggih|mboten|saget|teng|dolan|mangan|turu|ngopo|sopo|opo|iki|iku|ae|kok|toh|dong|deh|sih|nih|tuh|aja|aja|opo|pripun)\b/.test(low)) return false;
  const letters = low.replace(/[^a-z]/g, '');
  if (letters.length >= 15) {
    const vowels = (letters.match(/[aeiou]/g) || []).length;
    if (vowels / letters.length < 0.08) return true;
  }
  return false;
}

module.exports = { sendHuman, quickReply, isGreeting, shouldSkip, isUnknownLanguage };
