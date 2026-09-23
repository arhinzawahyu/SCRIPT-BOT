# WA Bot v3

Personal WhatsApp bot for archiving stories and view-once media. Runs with just `node index.js` on Termux, VPS, Windows, or Linux.

## Run

```bash
npm install
node index.js
```

First login uses pairing code or QR, then keep the terminal alive.

## Features

- Auto read/like stories, media download, number masking, call rejection
- View-once auto-save when `#on autovo` is on, or manual: reply the view-once photo then send `.vo`
- Custom trigger words, e.g. `cantik`, `keren`, `lucu`, add with `#add trigger <word>`
- Short commands: `#menu` for menu, `#info` for full status, `#backup` for session backup

Full Termux guide: `TERMUX_GUIDE.md`.

Optional dashboard webhook: set `BOT_WEBHOOK_URL` / `BOT_WEBHOOK_SECRET` via env or `bot.config.json` (see `bot.config.example.json`).

## Notes

Never commit `sessions/`, `bot.config.json`, `logs/`, `.env*`. `config.json` holds feature flags only, no secrets.

---

Arhinza - github.com/arhinzawahyu
