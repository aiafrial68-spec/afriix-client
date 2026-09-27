const QUOTES = [
  "Fokus ke tujuan, bukan ke omongan orang. — Anon",
  "Pelan-pelan yang penting jalan. Konsisten > semangat sesaat.",
  "Gagal sekali bukan berarti gagal selamanya.",
  "Jaga privasi, jaga energi, jaga lingkaran.",
  "Kerja cerdas, istirahat cukup, jangan lupa makan.",
  "Hari ini capek, besok bangga.",
  "Sedikit tapi rutin lebih kuat dari banyak tapi sekali.",
  "Jangan bandingkan chapter 1-mu dengan chapter 20 orang lain."
];

const JOKES = [
  "Kenapa programmer benci alam? Kebanyakan bug.",
  "Kenapa WiFi putus? Karena dia butuh ruang... dan sinyal.",
  "Katanya move on itu susah, padahal tinggal uninstall... eh.",
  "Hidup itu kayak baterai, kadang full semangat, kadang lowbat butuh rebahan.",
  "Jangan begadang terus, nanti kangen... eh, nanti sakit.",
  "Motivasi terbaik adalah tagihan yang jatuh tempo."
];

function random(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

module.exports = { QUOTES, JOKES, random };
