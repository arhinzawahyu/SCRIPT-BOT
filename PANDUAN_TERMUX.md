# Panduan Jalan di Termux (Fix Closed Session + .vo + Trigger Cantik)

## Masalah yang di-Fix
1. **Termux mati / sleep** -> pakai `termux-wake-lock` + loop auto-restart
2. **Decrypted message with closed session** -> fix unwrap `viewOnceMessageV2` + `reuploadRequest` + handle `ephemeralMessage`
3. **Fitur .vo tidak jalan** -> sekarang alias: `.vo` `.vv` `#vo` `#viewonce` semua bisa, plus fix download
4. **Trigger cantik** -> ketik `cantik`, `cantikk`, `cantiknyooo`, `cantik bgtt`, `jelek wuu` sambil **REPLY** pesan sekali liat -> bot otomatis ambil fotonya diam-diam

## Cara Install di Termux

```bash
# 1. Update termux
pkg update -y && pkg upgrade -y
pkg install -y nodejs git

# 2. Pindah ke folder bot (sesuaikan path kamu)
cd /sdcard/SCRIPT-BOT
# atau jika copy via git:
# git clone <repo-kamu> && cd SCRIPT-BOT

# 3. Install deps (WAJIB karena ada pino yang dulu belum ada)
npm install

# 4. Jalankan (pilih salah satu)

# Cara A: Simpel + auto restart (REKOMENDASI TERMUX)
bash start-termux.sh

# Cara B: Pakai PM2 biar background terus jalan walau Termux di-minimize
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
# cek status
pm2 logs wa-bot
```

Agar bot tetap jalan saat layar mati:
```bash
termux-wake-lock
# buka Settings Android -> Battery -> Optimasi -> JANGAN optimasi Termux
```

## Cara Pakai Fitur ViewOnce Baru

### 1. Pakai .vo (prefix bebas)
Reply foto/video sekali liat, lalu ketik salah satu:
```
.vo
.vv
#vo
#viewonce
.viewonce
!vo
/vo
```

### 2. Pakai trigger cantik* (TANPA prefix, sesuai request)
Reply foto sekali liat, lalu ketik **apa saja yang diawali cantik/jelek**:
```
cantik
cantikkk
cantiknyooo
cantikk nyooo
cantik bgtt wuu
cantik poll
jelek
jelek wuu
jelekkk
```
Semua diawali `cantik` atau `jelek` (case-insensitive) akan otomatis ambil media viewonce. **Harus reply** pesan viewonce-nya!

### 3. Tips biar tidak Closed Session lagi
Error `Decrypted message with closed session` terjadi kalau:
- Pesan viewonce sudah dibuka orang lain dulu
- Kelamaan tidak di-reply (sesi enkripsi tertutup)
- Bot restart / ganti device

Solusi fix di kode baru:
- Unwrap `viewOnceMessageV2` + `viewOnceMessageV2Extension` + `ephemeralMessage`
- Pakai `sock.updateMediaMessage` sebagai `reuploadRequest`
- Filter `type !== "notify"` biar tidak dobel decrypt

Tips pakai: **langsung reply dalam < 1 menit** setelah pesan viewonce masuk, jangan tunggu lama.

## Perintah Lain Tetap Jalan
```
#menu
#info
#on autoread
#off autoread
dll tetap pakai . atau # atau ! atau /
```

## Jika Mau Ganti Trigger Kata
Buka `index.js` baris:
```js
const isCantikTrigger = /^(cantik|jelek|cantik\w*|jelek\w*)/i.test(cleanText)
```
Ganti `cantik|jelek` jadi kata yang kamu mau, misal `sayang|hai`.


