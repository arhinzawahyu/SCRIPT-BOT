const { makeWASocket, DisconnectReason, useMultiFileAuthState, Browsers, fetchLatestBaileysVersion } = require("@whiskeysockets/baileys");
const pino = require("pino");
const readline = require("readline");
const fs = require("fs");
const path = require("path");
const { config } = require("./config");
const { state } = require("./state");
const { logCuy, logErrorToFile, logInfoToFile } = require("./logger");
const { fetchPendingLoginCode, markLoginCodeSent } = require("./webhook");
const { backupSessions } = require("./session");
const { registerHandlers } = require("./handlers");

const SESSION_PATH = path.join(__dirname, "..", "sessions");

let reconnect440Count = 0;
let last440Time = 0;
let healthInterval = null;
let backupInterval = null;

// Signature ASCII banner (term-safe, no emoji)
const BANNER = [
  " .###.  ####.  #...#  #####  #...#  #####  .###.",
  " #...#  #...#  #...#  ..#..  ##..#  ...#.  #...#",
  " #####  ####.  #####  ..#..  #.#.#  ..#..  #####",
  " #...#  #.#..  #...#  ..#..  #..##  .#...  #...#",
  " #...#  #..##  #...#  #####  #...#  #####  #...#",
  "",
  "A R H I N Z A",
  "",
  "wa-bot-arhinza (c) Arhinza",
  "Auto read / like story Whatsapp | ViewOnce | AntiCall",
].join("\n");

function startHealthCheck() {
  if (healthInterval) clearInterval(healthInterval);
  healthInterval = setInterval(() => {
    const idleMin = Math.floor((Date.now() - state.lastActiveTime) / 60000);
    const sc = state.currentSock;
    // ws.isOpen adalah getter resmi Baileys (websocket.js).
    const isAlive = sc && sc.user && sc.ws && (sc.ws.isOpen ?? sc.ws.socket?.readyState === 1);
    if (!isAlive) {
      if (state.isConnecting) return;
      logCuy(`HealthCheck: koneksi mati/idle ${idleMin} menit, reconnect disiplin...`, "yellow");
      logErrorToFile(`HealthCheck reconnect idle ${idleMin}m`);
      try { sc?.end?.(); } catch (_) {}
      try { sc?.ws?.close(); } catch (_) {}
      setTimeout(() => connectToWhatsApp(), 5000);
    } else {
      try { sc.sendPresenceUpdate("available"); } catch (_) {}
      if (idleMin % 30 === 0) logInfoToFile(`HealthCheck OK idle ${idleMin}m`);
    }
  }, 5 * 60 * 1000);
  if (backupInterval) clearInterval(backupInterval);
  backupInterval = setInterval(() => backupSessions(false), 12 * 60 * 60 * 1000);
  // SIGINT/SIGTERM: close gracefully so sessions do not corrupt
  if (!global._sigHandled) {
    global._sigHandled = true;
    const graceful = async () => {
      logCuy("Menerima sinyal shutdown, menutup koneksi disiplin...", "yellow");
      logInfoToFile("SIGINT/SIGTERM graceful close");
      try { clearInterval(healthInterval); } catch (_) {}
      try { clearInterval(backupInterval); } catch (_) {}
      try { await state.currentSock?.end?.(); } catch (_) {}
      setTimeout(() => process.exit(0), 1500);
    };
    process.on("SIGINT", graceful);
    process.on("SIGTERM", graceful);
  }
}

// Login tokens: NO auto-mint, NO interval. Tokens are only created when a user
// really logs in on the dashboard (step 1), or when the owner types #token.
function startLoginCodePoll(s) {
  if (global._loginCodePoll) clearInterval(global._loginCodePoll);
  global._loginCodePoll = null;
  const pump = async () => {
    try {
      if (!s.user) return;
      const who = String(process.env.BOT_OWNER_USER || "").trim().toLowerCase();
      const pending = await fetchPendingLoginCode(who || undefined);
      if (!pending) return;
      const code = String(pending.code);
      pending.code = "******";
      await s.sendMessage(`${state.loggedInNumber}@s.whatsapp.net`, {
        text: `Kode login dashboard: *${code}*\nBerlaku 1 jam. Jangan bagikan ke siapa pun.`,
      });
      await markLoginCodeSent(pending.username, Number(pending.id) || 0);
      logCuy(`Token login dashboard dikirim ke WA pribadi untuk ${pending.username}`, "green");
    } catch (e) {
      logErrorToFile(`kirim token login gagal: ${e.message}`);
    }
  };
  // Single pump on connect for already-waiting tokens.
  pump();
}

async function connectToWhatsApp() {
  if (state.isConnecting) { logCuy("Sudah ada percobaan konek, skip duplikat...", "yellow"); return; }
  state.isConnecting = true;
  // close old socket to avoid 440 conflicts
  try { if (state.currentSock?.ws) state.currentSock.ws.close(); } catch (_) {}
  try { if (state.currentSock?.end) state.currentSock.end(); } catch (_) {}

  const sessionExists = fs.existsSync(SESSION_PATH) && fs.readdirSync(SESSION_PATH).length > 0;

  const { state: authState, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: pino({ level: "error" }),
    auth: authState,
    printQRInTerminal: !state.useCode,
    defaultQueryTimeoutMs: undefined,
    keepAliveIntervalMs: 25000,
    browser: Browsers.ubuntu("Chrome"), // ubuntu agar tidak 440 di beberapa WA
    shouldSyncHistoryMessage: () => false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: true,
    markOnlineOnConnect: false, // anti-trigger: jangan tampil online terus
    retryRequestDelayMs: 2000,
    emitOwnEvents: false,
  });
  state.currentSock = sock;
  state.lastActiveTime = Date.now();

  if (state.useCode && !sessionExists) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    logCuy(
      "Halo sepertinya kamu belum login, Mau login wangsaf pakai pairing code?\nSilahkan balas dengan (y/n)\nketik y untuk setuju atau ketik n untuk login menggunakan qrcode",
      "cyan"
    );
    const askPairingCode = () => {
      rl.question("\nApakah kamu ingin menggunakan pairing code untuk login ke wangsaf? (y/n): ".yellow.bold, async (answer) => {
        if (answer.toLowerCase() === "y" || answer.trim() === "") {
          logCuy("Wokeh kalau gitu silahkan masukkan nomor wangsafmu!\ncatatan : awali dengan 62 contoh 628123456789", "cyan");
          const askWaNumber = () => {
            rl.question("\nMasukkan nomor wangsaf Anda: ".yellow.bold, async (waNumber) => {
              if (!/^\d+$/.test(waNumber)) {
                logCuy("Nomor harus berupa angka!\nSilakan masukkan nomor wangsaf kembali!", "red");
                return askWaNumber();
              }
              if (!waNumber.startsWith("62")) {
                logCuy("Nomor harus diawali dengan 62!\nContoh : 628123456789\nSilakan masukkan nomor wangsaf kembali!", "red");
                return askWaNumber();
              }
              try {
                const code = await sock.requestPairingCode(waNumber, "ARHINZA0");
                console.log("\nCek notifikasi wangsafmu dan masukin kode login wangsaf:".blue.bold, code.bold.red);
              } catch (e) {
                logCuy(`Gagal minta pairing code: ${e.message}`, "red");
                logCuy("Coba ulangi atau gunakan QR code (ketik n)", "yellow");
              }
              rl.close();
            });
          };
          askWaNumber();
        } else if (answer.toLowerCase() === "n") {
          state.useCode = false;
          logCuy("Buka wangsafmu lalu klik titik tiga di kanan atas kemudian klik perangkat tertaut setelah itu Silahkan scan QR code dibawah untuk login ke wangsaf", "cyan");
          rl.close();
        } else {
          logCuy('Input tidak valid. Silakan masukkan "y" atau "n".', "red");
          askPairingCode();
        }
      });
    };
    askPairingCode();
  }

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;
    state.lastActiveTime = Date.now();
    if (connection === "close" || connection === "open") state.isConnecting = false;

    if (connection === "close") {
      const statusCode = lastDisconnect.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      if (statusCode !== 440) {
        logCuy(`Koneksi terputus. Code: ${statusCode} | Reconnect: ${shouldReconnect}`, "yellow");
      }
      logErrorToFile(`connection close code ${statusCode} reconnect=${shouldReconnect} err=${lastDisconnect.error?.message} stack=${lastDisconnect.error?.stack || ""}`);
      if (statusCode === 440) {
        const now = Date.now();
        if (now - last440Time < 60000) reconnect440Count++; else reconnect440Count = 1;
        last440Time = now;
        if (reconnect440Count >= 3) {
          logCuy("Koneksi 440 3x - sessions mungkin dobel/korup. Hapus sessions & pairing ulang 1x saja:", "red");
          logCuy("  rm -rf sessions && node index.js  (di HP hapus Perangkat Tertaut lama)", "yellow");
          return; // stop biar tidak loop spam
        }
        setTimeout(() => connectToWhatsApp(), 10000);
        return;
      } else {
        reconnect440Count = 0;
      }
      if (statusCode === 408 || statusCode === 428) {
        logCuy("Timeout/Connection lost, retry 5 detik...", "yellow");
        setTimeout(() => connectToWhatsApp(), 5000);
        return;
      }
      if (shouldReconnect) {
        logCuy("Mencoba menghubungkan ulang dalam 3 detik...\n", "cyan");
        setTimeout(() => connectToWhatsApp(), 3000);
      } else {
        logCuy("Nampaknya kamu telah logout dari wangsaf, silahkan login ke wangsaf kembali!", "red");
        if (fs.existsSync(SESSION_PATH)) fs.rmSync(SESSION_PATH, { recursive: true, force: true });
        setTimeout(() => connectToWhatsApp(), 3000);
      }
    } else if (connection === "open") {
      logCuy("Berhasil Terhubung ke wangsaf");
      logInfoToFile("connection open");
      state.loggedInNumber = sock.user.id.split("@")[0].split(":")[0];
      startHealthCheck();
      backupSessions();
      startLoginCodePoll(sock);
      let displayedLoggedInNumber = state.loggedInNumber;
      if (config.sensorNomor) {
        displayedLoggedInNumber = displayedLoggedInNumber.slice(0, 3) + "****" + displayedLoggedInNumber.slice(-2);
      }
      const s = (v) => (v ? "ON" : "OFF");
      const messageInfo = `*BOT AKTIF* - ${displayedLoggedInNumber}
----------------
Read: ${s(config.autoReadStatus)} | Like: ${s(config.autoLikeStatus)}
Download: ${s(config.downloadMediaStatus)} | Sensor: ${s(config.sensorNomor)} | AntiCall: ${s(config.antiTelpon)}

Ketik #menu untuk menu ringkas
Ketik #info untuk status lengkap
ViewOnce: balas pesan sekali liat dengan teks APA PUN → tersimpan ke dashboard (tanpa otomatis, tanpa pemicu)`;

      console.log("kamu berhasil login dengan nomor:".green.bold, displayedLoggedInNumber.yellow.bold);
      console.log("Bot sudah aktif!".green.bold);
      console.log(BANNER.green.bold);

      if (!state.welcomeMessage) {
        setTimeout(async () => {
          try {
            await sock.sendMessage(`${state.loggedInNumber}@s.whatsapp.net`, { text: messageInfo });
          } catch {}
          state.welcomeMessage = true;
        }, 5000);
      }
    }
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("call", (call) => {
    const { id, status, from } = call[0];
    if (status === "offer" && config.antiTelpon) return sock.rejectCall(id, from);
  });

  // Ignore closed sessions so the bot does not crash.
  if (!global._waHandlersRegistered) {
    global._waHandlersRegistered = true;
    process.on("unhandledRejection", (err) => {
      const msg = String(err?.message || err);
      logErrorToFile(`unhandledRejection: ${msg} ${err?.stack || ""}`);
      if (msg.includes("closed session") || msg.includes("Decrypted")) {
        logCuy("Abaikan error closed session (unhandledRejection)", "yellow");
      } else {
        console.error("UnhandledRejection:", err);
      }
    });
    process.on("uncaughtException", (err) => {
      const msg = String(err?.message || err);
      logErrorToFile(`uncaughtException: ${msg} ${err?.stack || ""}`);
      if (msg.includes("closed session") || msg.includes("Decrypted")) {
        logCuy("Abaikan error closed session (uncaughtException)", "yellow");
      } else {
        console.error("UncaughtException:", err);
      }
    });
  }

  registerHandlers(sock);
}

module.exports = { connectToWhatsApp };