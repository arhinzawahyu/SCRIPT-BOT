#!/data/data/com.termux/files/usr/bin/bash
# Script auto jalan di Termux - anti sleep & auto restart
# by fix: termux + closed session + trigger cantik

echo "=== BOT WA TERMUX STARTER ==="

# 1. Wake lock biar Termux tidak sleep
termux-wake-lock 2>/dev/null || echo "termux-wake-lock tidak tersedia, lanjut..."

# 2. Cek Node.js
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js belum terinstall, install dulu..."
  pkg update -y && pkg install -y nodejs git
fi

# 3. Install deps jika belum
if [ ! -d "node_modules" ]; then
  echo "Install dependencies..."
  npm install
fi

# 4. Fungsi jalan dengan auto restart jika error / closed session
while true; do
  echo ""
  echo "Menjalankan bot... $(date)"
  echo "Fitur: .vo / cantik* untuk ambil viewonce (fix closed session)"
  node index.js
  EXIT_CODE=$?
  echo ""
  echo "Bot berhenti dengan code $EXIT_CODE. Restart dalam 3 detik..."
  echo "Jika mau stop total tekan CTRL+C 2x cepat"
  sleep 3
done
