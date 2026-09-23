# WA Bot Termux Guide — Run Anywhere (Node index.js)

The bot runs with just `node index.js` **anywhere**: Termux, VPS, Windows, Linux, Mac. No `start-termux.sh` (removed, focus is `node index.js`).

## Run (All Platforms)

```bash
npm install          # first time only
node index.js        # run directly
# or
npm start
```

Login:
- If `sessions/` does not exist yet, the bot asks for pairing code (type `y` then number `62xxxx`) or QR (`n`).
- After login keep the terminal alive.

## Quick Commands (Type in your own chat)

```
#menu                → short menu
#info                → full info (features, lists, usage — already concise)
#on autoread         → enable auto story read
#off autovo          → disable auto view-once
#add whitelist 62812xxx
#remove whitelist 62812xxx
#backup              → manual sessions backup (light, max 3)
```

All `#info` explanations are kept **short and easy to understand**.

## ViewOnce (One-View Photo/Video)

**Auto:** `Auto-VO ON` (`#on autovo`) => one-view photos auto-save and forward to your chat with no typing.

**Manual (if Auto-VO is OFF or auto fails):**
Reply the one-view photo then type:
```
.vo
or any message containing: cantik / keren / lucu
example: "cantik", "anjayyy lucu dehh", "keren bgtt", "woi cantiknya"
```
The bot detects the **core word** — `cantik`/`keren`/`lucu` anywhere in the sentence => fetch the view-once right away. Must **reply** the view-once message.

Discipline tips to avoid *closed session*:
- Reply fast (<1 minute)
- Do not open the view-once on another phone first
- Do not restart the bot while a view-once is pending
- Discipline fix: unwrap `viewOnceMessageV2`+`ephemeralMessage`, `reuploadRequest`, 3x backoff retry, `type !== "notify"` filter, 5-minute healthcheck + no-double reconnect.

## Light Backup (Easy on Server/Termux)

- **Automatic:** every **12 hours**, only if `sessions/` changed (hash check), max **3 backups** in `sessions_backup/` — saves Termux storage and I/O.
- **Manual:** type `#backup` anytime (force backup).
- No heavy compression, no hourly spam (was 24*7 = 168 backups, now max 3).
- `logs/error.log` rotates at 2MB, healthcheck log every 30 minutes (not every 5) to save resources.

## 100% on Termux (Fix)

Termux often dies from **sleep / Android killing the process** / low memory. Correct order:

1. **Wake lock first (REQUIRED, before start):**
```bash
termux-wake-lock
```
A "foreground service" notification appears — it means Android will not kill the bot even with the screen off.

2. **Disable battery optimization for Termux (most common cause):**
```
Settings → Apps → Termux → Battery → Unrestricted / Don't optimize
```
Or: Settings → Battery → Battery Optimization → find Termux → Don't optimize.
Without this, the OS treats Termux as a "background app" and kills it every 5-10 minutes.

3. **Run the bot:**
```bash
cd ~/SCRIPT-BOT
node index.js
```

4. **After login, do not swipe Termux away from "recent apps".** With `termux-wake-lock`, minimize with Home and come back to see logs.

5. **On strict phones (MIUI/Huawei/Xiaomi):**
```
Settings → Apps → Termux → Autostart ON
Settings → Apps → Termux → Lock in recents (lock icon)
```

6. **Optional — auto-restart on crash with PM2:**
```bash
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # needs tsu/root on Termux; without root it still runs manually
```
PM2 does **not** stop the OS from kidnapping the process with screen off — that is the job of `termux-wake-lock` + battery optimization.

7. **Routine to avoid 440 / closed session:**
```bash
pkg update && pkg upgrade
```
- If `440` 3x => `rm -rf sessions` then re-pair once
- Bot already handles `SIGINT/SIGTERM` graceful close — do not force kill
- Do not open many heavy apps at once

100% portable code:
- All paths use `__dirname` => `node /sdcard/SCRIPT-BOT/index.js` or `node index.js` from any folder works
- No more `bash start-termux.sh`
- No heavy AI features (removed) => saves Termux CPU/RAM
- No `fetch` to Gemini => saves data

## Run Anywhere

- `sessions/`, `logs/`, `config.json`, `sessions_backup/` all use `__dirname`
- Examples:
```bash
node /data/data/com.termux/files/home/SCRIPT-BOT/index.js
node C:\arhinzawahyu\SCRIPT-BOT\index.js
npm start
```

## Key Structure

- `sessions/` — do not delete carelessly (light auto backup exists)
- `sessions_backup/` — max 3, old ones auto-deleted
- `logs/error.log` — 2MB rotate
- `config.json` — feature flags (no AI)
