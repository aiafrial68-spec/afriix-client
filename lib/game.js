// Game chat sederhana: tebak angka & suit. State tebak per (chat+user) agar di grup tidak tabrakan.
const tebakGames = {};

function keyOf(chatJid, userJid) {
  return `${chatJid}|${userJid || chatJid}`;
}

function sweep() {
  const now = Date.now();
  for (const k of Object.keys(tebakGames)) {
    if (now - (tebakGames[k].startedAt || 0) > 10 * 60 * 1000) delete tebakGames[k];
  }
  // batasi memori: max 200 game aktif
  const keys = Object.keys(tebakGames);
  if (keys.length > 200) keys.slice(0, keys.length - 200).forEach((k) => delete tebakGames[k]);
}

function tebakStart(chatJid, userJid) {
  sweep();
  const k = keyOf(chatJid, userJid);
  tebakGames[k] = { target: 1 + Math.floor(Math.random() * 100), left: 7, startedAt: Date.now() };
  return `🎮 *TEBAK ANGKA*\nAku sudah pilih angka 1–100.\nKamu punya 7x tebakan.\nKirim: *!tebak <angka>*\nContoh: *!tebak 50*`;
}

function tebakGuess(chatJid, userJid, n) {
  // dukung pemanggilan lama tebakGuess(jid, angka)
  if (typeof userJid === 'number') { n = userJid; userJid = chatJid; }
  const k = keyOf(chatJid, userJid);
  const g = tebakGames[k];
  if (!g) return tebakStart(chatJid, userJid);
  if (!Number.isInteger(n) || n < 1 || n > 100) return 'Tebak angka 1–100 ya. Contoh: *!tebak 50*';
  if (n === g.target) {
    const used = 8 - g.left;
    delete tebakGames[k];
    return `🎉 *BETUL!* Angkanya ${g.target}.\nKamu menang dalam ${used}x tebakan! Main lagi? Ketik *!tebak*`;
  }
  g.left -= 1;
  if (g.left <= 0) {
    const t = g.target;
    delete tebakGames[k];
    return `😅 *Habis!* Angkanya ${t}.\nKetik *!tebak* untuk main lagi.`;
  }
  const hint = n < g.target ? 'Kekecilan 🔺' : 'Kegedean 🔻';
  return `${n}? ${hint}\nSisa ${g.left}x tebakan.`;
}

const SUIT_EMOJI = { gunting: '✌️', batu: '✊', kertas: '🖐️' };
function suit(userPick) {
  const u = (userPick || '').toLowerCase();
  if (!SUIT_EMOJI[u]) return 'Pilih: *!suit gunting* / *!suit batu* / *!suit kertas*';
  const opts = Object.keys(SUIT_EMOJI);
  const b = opts[Math.floor(Math.random() * 3)];
  const win = (u === 'gunting' && b === 'kertas') || (u === 'batu' && b === 'gunting') || (u === 'kertas' && b === 'batu');
  const hasil = u === b ? 'Seri! 😐' : win ? 'Kamu menang! 🎉' : 'Aku menang! 😎';
  return `🎮 *SUIT*\nKamu: ${SUIT_EMOJI[u]} ${u}\nAku: ${SUIT_EMOJI[b]} ${b}\n${hasil}`;
}

function gameMenu() {
  return `🎮 *GAME CHAT*\n\n` +
    `*!tebak* — mulai tebak angka 1–100\n` +
    `*!tebak 50* — jawab tebakan\n` +
    `*!suit gunting/batu/kertas* — suit lawan bot`;
}

module.exports = { tebakStart, tebakGuess, suit, gameMenu };
