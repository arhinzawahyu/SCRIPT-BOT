# BOT WA v3 — Auto Read Story & ViewOnce

Bot WhatsApp ringan jalan di mana saja dengan `node index.js` (Termux/VPS/Windows/Linux).

## Jalankan
```bash
npm install
node index.js
```

## Fitur
- Auto Read/Like Story, Download Media, Sensor Nomor, Anti Telpon
- ViewOnce: `.vo` atau kata `cantik/keren/lucu` (contoh `anjay lucu dehh`) — deteksi intinya
- Menu ringkas `#menu`, info mudah `#info`, backup ringan `#backup`

Lihat `PANDUAN_TERMUX.md` untuk panduan lengkap Termux 100% & backup hemat.

## Struktur Push GitHub
Yang di-push: `index.js`, `package.json`, `config.json`, `ecosystem.config.js`, `PANDUAN_TERMUX.md`, `README.md`
Yang di-ignore (tidak di-push): `node_modules/`, `sessions/`, `sessions_backup/`, `logs/`
