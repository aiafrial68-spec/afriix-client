#!/bin/bash
# AfriIX one-shot setup untuk Ubuntu 22.04/24.04 (VPS).
# Jalankan SEKALI sebagai user biasa (bukan root):  bash ~/wa-cs-bot/setup-server.sh
# Kode bot harus sudah ada di ~/wa-cs-bot (scp/git clone dulu, lihat runbook migrasi).
set -euo pipefail

BOT_DIR="$HOME/wa-cs-bot"
if [ ! -d "$BOT_DIR" ]; then
  echo "❌ $BOT_DIR tidak ada. Transfer kode dulu (scp/git), baru jalankan script ini."
  exit 1
fi

echo "== 1/5 System deps (ffmpeg, python, build tools, timezone) =="
sudo apt update
sudo apt install -y curl git ffmpeg python3 build-essential ca-certificates
sudo timedatectl set-timezone Asia/Jakarta || true
node -v 2>/dev/null || true

if ! command -v node >/dev/null 2>&1; then
  echo "== 2/5 Install Node.js 22.x =="
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt install -y nodejs
fi
node -v
npm -v

echo "== 3/5 yt-dlp (binary resmi, untuk !dl) =="
if ! command -v yt-dlp >/dev/null 2>&1; then
  sudo curl -fsSL -o /usr/local/bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp
  sudo chmod +x /usr/local/bin/yt-dlp
fi
yt-dlp --version || echo "⚠️ yt-dlp gagal, !dl tidak akan jalan sampai ini diperbaiki"

echo "== 4/5 Dependencies bot =="
cd "$BOT_DIR"
npm install --omit=dev --legacy-peer-deps

echo "== 5/5 pm2 + firewall =="
if ! command -v pm2 >/dev/null 2>&1; then
  sudo npm install -g pm2
fi
# Dashboard bind 127.0.0.1 (lihat .env DASH_HOST) -> JANGAN buka port 3000 ke publik.
# Akses dashboard via SSH tunnel: ssh -L 3000:localhost:3000 user@vps
if command -v ufw >/dev/null 2>&1; then
  sudo ufw allow OpenSSH >/dev/null 2>&1 || true
  sudo ufw deny 3000/tcp >/dev/null 2>&1 || true
fi

echo "== 6/5 pm2-logrotate (anti logs/ bengkak) =="
pm2 install pm2-logrotate >/dev/null 2>&1 || true
pm2 set pm2-logrotate:max_size 10M >/dev/null 2>&1 || true
pm2 set pm2-logrotate:retain 5 >/dev/null 2>&1 || true

echo ""
echo "== Selesai ✅ =="
echo "Lanjut manual di $BOT_DIR:"
echo "  1. cp .env.example .env && nano .env   (BOT_NUMBER, OWNER_NUMBER, DASH_TOKEN acak ≥8 char, AI key bila ada)"
echo "  2. node index.js   (pairing code -> tautkan di HP, tes chat, lalu Ctrl+C)"
echo "  3. pm2 start ecosystem.config.js && pm2 save"
echo "  4. pm2 startup   (jalankan perintah sudo yang dicetak pm2, agar hidup lagi setelah reboot)"
echo "  5. pm2 logs afriix --lines 50   (pastikan 'terhubung sebagai ...')"
