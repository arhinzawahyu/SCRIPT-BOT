# Panduan Bot WA — Jalan Dimanapun (Node index.js)

Bot jalan cukup dengan `node index.js` di **mana saja**: Termux, VPS, Windows, Linux, Mac. Tidak perlu `start-termux.sh` (sudah dihapus, fokus `node index.js`).

## Jalankan (Semua Platform)

```bash
npm install          # pertama kali saja
node index.js        # jalan langsung
# atau
npm start
```

Login:
- Jika belum ada `sessions/`, bot tanya pairing code (ketik `y` lalu nomor `62xxxx`) atau QR (`n`).
- Setelah login biarkan terminal hidup.

## Perintah Ringkas (Ketik di chat kamu sendiri)

```
#menu                → menu ringkas
#info                → info lengkap (fitur, list, cara pakai — sudah singkat)
#on autoread         → nyalakan baca story otomatis
#off autovo          → matikan auto viewonce
#add whitelist 62812xxx
#remove whitelist 62812xxx
#backup              → backup sessions manual (ringan, max 3)
```

Semua penjelasan di `#info` sudah dibuat **pendek & mudah dipahami**.

## ViewOnce (Foto/Video Sekali Liat)

**Auto:** `Auto-VO ON` (`#on autovo`) => foto sekali liat langsung auto kesimpan & dikirim ke chat kamu tanpa ketik apa pun.

**Manual (jika Auto-VO OFF atau gagal auto):**
Reply foto sekali liat lalu ketik:
```
.vo
atau kata yang mengandung: cantik / keren / lucu
contoh: "cantik", "anjayyy lucu dehh", "keren bgtt", "woi cantiknya"
```
Bot deteksi **intinya** — ada kata `cantik`/`keren`/`lucu` dimanapun di kalimat => langsung ambil viewonce. Harus **reply** pesan viewonce-nya.

Tips disiplin hindari *closed session*:
- Reply cepat (<1 menit)
- Jangan buka viewonce di HP lain dulu
- Jangan restart bot saat ada viewonce pending
- Fix disiplin: unwrap `viewOnceMessageV2`+`ephemeralMessage`, `reuploadRequest`, retry 3x backoff, filter `type !== "notify"`, healthcheck 5 menit + reconnect tidak dobel.

## Backup Hemat (Tidak Memberatkan Server/Termux)

- **Otomatis:** tiap **12 jam sekali**, hanya jika `sessions/` berubah (hash check), max **3 backup** saja di `sessions_backup/` — hemat storage & I/O Termux.
- **Manual:** ketik `#backup` kapan saja (force backup).
- Tidak ada compress berat, tidak spam tiap jam (dulu 24*7 = 168 backup, sekarang max 3).
- Log `logs/error.log` rotate 2MB, healthcheck log tiap 30 menit (bukan tiap 5 menit) biar hemat.

## Jalan 100% di Termux (Fix)

Termux sering mati karena sleep / low memory. Fix disiplin sudah diterapkan:

1. **Jalan foreground (paling stabil di Termux):**
```bash
termux-wake-lock
node index.js
# jangan minimize Termux lama, matikan battery optimization untuk Termux:
# Settings → Battery → Battery Optimization → Don't optimize Termux
```

2. **Jalan background pakai PM2 (VPS lebih cocok, Termux bisa tapi berat):**
```bash
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 logs wa-bot
```
`ecosystem.config.js` sudah ringan: single instance, `max_memory_restart 300M`, `autorestart`, `exp_backoff` — tidak makan RAM.

3. **Tips 100% jalan di Termux:**
- Jangan buka banyak app berat bersamaan
- `pkg update && pkg upgrade` rutin
- Hapus `sessions_backup` lama jika penuh (sekarang auto max 3)
- Jika `440` 3x => `rm -rf sessions` lalu pairing ulang sekali
- Bot sudah ada `SIGINT/SIGTERM` graceful close — jangan kill paksa

Kode 100% portable:
- Semua path pakai `__dirname` => `node /sdcard/SCRIPT-BOT/index.js` atau `node index.js` dari folder manapun tetap jalan
- Tidak ada `bash start-termux.sh` lagi
- Tidak ada fitur AI berat (sudah dihapus) => hemat CPU/RAM Termux
- Tidak ada `fetch` ke Gemini => tidak boros kuota

## Bisa Dimanapun

- `sessions/`, `logs/`, `config.json`, `sessions_backup/` semua pakai `__dirname`
- Contoh jalan dari mana saja:
```bash
node /data/data/com.termux/files/home/SCRIPT-BOT/index.js
node C:\arhinzawahyu\SCRIPT-BOT\index.js
npm start
```

## Struktur Penting

- `sessions/` — jangan hapus sembarang (auto backup ringan ada)
- `sessions_backup/` — max 3, hapus otomatis yang lama
- `logs/error.log` — rotate 2MB
- `config.json` — setting fitur (tanpa AI lagi)
