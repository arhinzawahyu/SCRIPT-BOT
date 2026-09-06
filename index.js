const {
  makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  Browsers,
  jidNormalizedUser,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const readline = require("readline");
const fs = require("fs");
const path = require("path");
const colors = require("colors");
const moment = require("moment-timezone");

let useCode = true;
let loggedInNumber;
let welcomeMessage = false;

const configPath = path.join(__dirname, "config.json");
let config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

let {
  autoReadStatus,
  autoLikeStatus,
  downloadMediaStatus,
  sensorNomor,
  antiTelpon,
  autoKickStory,
  autoViewOnce,
  aiEnabled,
  aiWhitelist,
  geminiApiKey,
  geminiModel,
  blackList,
  whiteList,
  emojis,
} = config;
// default
if (typeof autoViewOnce === "undefined") { autoViewOnce = true; config.autoViewOnce = true; }
if (typeof aiEnabled === "undefined") { aiEnabled = true; config.aiEnabled = true; }
if (!Array.isArray(aiWhitelist)) { aiWhitelist = []; config.aiWhitelist = []; }
if (typeof geminiApiKey === "undefined") { geminiApiKey = ""; config.geminiApiKey = ""; }
if (typeof geminiModel === "undefined") { geminiModel = "gemini-1.5-flash"; config.geminiModel = "gemini-1.5-flash"; }
let reconnect440Count = 0;
let last440Time = 0;
let isConnecting = false;
// AI active chats: Map<jid, timeout>
const aiActiveChats = new Map();
const AI_TIMEOUT_MS = 15 * 60 * 1000; // 15 menit auto off jika tidak ada chat

function logCuy(message, type = "green") {
  moment.locale("id");
  const now = moment().tz("Asia/Jakarta");
  console.log(
    `\n${now.format(" dddd ").bgRed}${now.format(" D MMMM YYYY ").bgYellow.black}${now.format(" HH:mm:ss ").bgWhite.black}\n`
  );
  console.log(`${message.bold[type]}`);
}

const updateConfig = (key, value) => {
  config[key] = value;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 4), "utf-8");
};

// ================= LOGGER KE FILE + BACKUP & HEALTH CHECK =================
const LOG_DIR = path.join(__dirname, "logs");
const ERROR_LOG = path.join(LOG_DIR, "error.log");
const SESSION_BACKUP_DIR = path.join(__dirname, "sessions_backup");
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

function writeLog(level, msg) {
  try {
    const ts = moment().tz("Asia/Jakarta").format("YYYY-MM-DD HH:mm:ss");
    const line = `[${ts}] [${level}] ${msg}\n`;
    fs.appendFileSync(ERROR_LOG, line);
    // rotasi sederhana: jika > 2MB, reset
    const stat = fs.statSync(ERROR_LOG);
    if (stat.size > 2 * 1024 * 1024) {
      fs.writeFileSync(ERROR_LOG, `[${ts}] log rotated - file >2MB\n`);
    }
  } catch (_) {}
}
function logErrorToFile(msg) { writeLog("ERROR", msg); }
function logInfoToFile(msg) { writeLog("INFO", msg); }

function backupSessions() {
  try {
    const sessionPath = path.join(__dirname, "sessions");
    if (!fs.existsSync(sessionPath) || fs.readdirSync(sessionPath).length === 0) return;
    if (!fs.existsSync(SESSION_BACKUP_DIR)) fs.mkdirSync(SESSION_BACKUP_DIR, { recursive: true });
    const ts = moment().tz("Asia/Jakarta").format("YYYY-MM-DD_HH-mm");
    const dest = path.join(SESSION_BACKUP_DIR, `backup_${ts}`);
    if (fs.existsSync(dest)) return; // sudah backup jam ini
    fs.cpSync(sessionPath, dest, { recursive: true });
    logCuy(`Backup sessions ke ${dest}`, "green");
    logInfoToFile(`Backup sessions ke ${dest}`);
    // hapus backup > 7 hari
    const files = fs.readdirSync(SESSION_BACKUP_DIR);
    if (files.length > 24 * 7) {
      files.sort();
      const toDelete = files.slice(0, files.length - 24 * 7);
      toDelete.forEach(f => {
        try { fs.rmSync(path.join(SESSION_BACKUP_DIR, f), { recursive: true, force: true }); } catch (_) {}
      });
    }
  } catch (e) {
    logErrorToFile(`backupSessions gagal: ${e.message}`);
  }
}
let currentSock = null;
let healthInterval = null;
let backupInterval = null;
let lastActiveTime = Date.now();
function startHealthCheck() {
  if (healthInterval) clearInterval(healthInterval);
  healthInterval = setInterval(() => {
    const idleMin = Math.floor((Date.now() - lastActiveTime) / 60000);
    // cek sock masih hidup
    const isAlive = currentSock && currentSock.user && currentSock.ws && currentSock.ws.readyState === 1;
    if (!isAlive) {
      logCuy(`HealthCheck: koneksi mati/idle ${idleMin} menit, reconnect...`, "yellow");
      logErrorToFile(`HealthCheck reconnect idle ${idleMin}m`);
      try { currentSock?.end?.(); } catch (_) {}
      setTimeout(() => connectToWhatsApp(), 3000);
    } else {
      // kirim presence biar tidak dianggap idle
      try { currentSock.sendPresenceUpdate("available"); } catch (_) {}
      logInfoToFile(`HealthCheck OK idle ${idleMin}m`);
    }
  }, 5 * 60 * 1000); // 5 menit
  // backup tiap 60 menit
  if (backupInterval) clearInterval(backupInterval);
  backupInterval = setInterval(backupSessions, 60 * 60 * 1000);
}

// ================= FIX HELPER UNTUK VIEWONCE & CLOSED SESSION =================
function unwrapMessage(msg) {
  if (!msg) return null;
  // unwrap berlapis: ephemeral -> viewOnce -> documentWithCaption
  let cur = msg;
  // ephemeralMessage
  if (cur.ephemeralMessage) cur = cur.ephemeralMessage.message;
  // viewOnce wrappers
  if (cur.viewOnceMessage) cur = cur.viewOnceMessage.message;
  if (cur.viewOnceMessageV2) cur = cur.viewOnceMessageV2.message;
  if (cur.viewOnceMessageV2Extension) cur = cur.viewOnceMessageV2Extension.message;
  // documentWithCaption kadang bungkus image
  if (cur.documentWithCaptionMessage) cur = cur.documentWithCaptionMessage.message;
  return cur;
}

function getViewOnceContent(quotedMsg) {
  if (!quotedMsg) return null;
  // quotedMsg sudah = quotedMessage (isi dari contextInfo.quotedMessage)
  // Coba unwrap dulu
  let unwrapped = unwrapMessage(quotedMsg);
  if (!unwrapped) return null;

  // setelah unwrap, cek tipe
  if (unwrapped.imageMessage) return { type: "image", msg: unwrapped.imageMessage, raw: unwrapped };
  if (unwrapped.videoMessage) return { type: "video", msg: unwrapped.videoMessage, raw: unwrapped };
  if (unwrapped.audioMessage) return { type: "audio", msg: unwrapped.audioMessage, raw: unwrapped };

  // jika belum ketemu, coba cek langsung tanpa unwrap penuh (kadang quotedMsg langsung viewOnceMessage)
  // fallback: cek original quotedMsg keys
  const keys = Object.keys(quotedMsg);
  for (const k of keys) {
    if (k.includes("viewOnce")) {
      const inner = unwrapMessage(quotedMsg[k]?.message || quotedMsg[k]);
      if (inner?.imageMessage) return { type: "image", msg: inner.imageMessage, raw: inner };
      if (inner?.videoMessage) return { type: "video", msg: inner.videoMessage, raw: inner };
      if (inner?.audioMessage) return { type: "audio", msg: inner.audioMessage, raw: inner };
    }
  }
  return null;
}

// ========== GEMINI AI HELPER ==========
async function callGemini(userMessage, senderName) {
  if (!geminiApiKey || geminiApiKey.trim() === "") {
    return "maaf api key gemini belum diisi, isi dulu di config.json geminiApiKey";
  }
  const prompt = `kamu adalah teman chat manusia indonesia, jawab santai tanpa huruf kapital sama sekali, jangan pakai kapital di awal kalimat pun, jangan formal, pakai bahasa gaul sehari hari, singkat, kadang typo dikit, jangan pakai tanda baca berlebihan, jangan ngaku ai. nama lawan chat: ${senderName}. balas chat ini: "${userMessage}"`;
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiApiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.9, maxOutputTokens: 200 } })
    });
    const data = await res.json();
    let text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    if (!text) {
      logErrorToFile(`gemini empty response: ${JSON.stringify(data).slice(0,500)}`);
      return "hehe bentar ya lagi error";
    }
    // paksa lowercase tanpa kapital + trim
    text = text.toLowerCase().trim();
    // hilangkan kapital yang lolos
    text = text.replace(/^[A-Z]/, m => m.toLowerCase());
    return text;
  } catch (e) {
    logErrorToFile(`gemini error: ${e.message}`);
    return "aduh error bentar ya";
  }
}
async function sendHumanTyping(sock, jid, text) {
  try {
    const len = text.length;
    const base = Math.min(8000, Math.max(1500, len * 45)); // 45ms per char
    const jitter = Math.floor(Math.random() * 2000) + 500;
    const delay = base + jitter;
    await sock.sendPresenceUpdate("composing", jid);
    await new Promise(r => setTimeout(r, delay));
    await sock.sendPresenceUpdate("paused", jid);
  } catch (_) {}
}

async function safeDownloadMedia(sock, msg, type, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      let targetMsg = msg;
      try {
        targetMsg = await sock.updateMediaMessage(msg);
      } catch (_) {}
      const buffer = await downloadMediaMessage(
        targetMsg,
        "buffer",
        {},
        {
          logger: pino({ level: "fatal" }),
          reuploadRequest: sock.updateMediaMessage,
        }
      );
      if (buffer) {
        if (attempt > 1) logCuy(`Berhasil unduh ${type} di percobaan ke-${attempt}`, "green");
        logInfoToFile(`safeDownload ${type} success attempt ${attempt}`);
        return buffer;
      }
    } catch (error) {
      const isClosed = error.message.includes("closed session") || error.message.includes("Decrypted");
      const errMsg = `safeDownload ${type} attempt ${attempt}/${retries} gagal: ${error.message}`;
      logErrorToFile(errMsg);
      if (isClosed) {
        logCuy(`Percobaan ${attempt}/${retries} gagal unduh ${type}: sesi tertutup, retry 1.5s...`, "yellow");
      } else {
        logCuy(`Percobaan ${attempt}/${retries} gagal unduh ${type}: ${error.message}`, "red");
      }
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 1500 * attempt)); // backoff 1.5s, 3s, 4.5s
        continue;
      } else {
        if (isClosed) {
          logCuy(`Gagal unduh ${type} setelah ${retries}x: sesi tertutup / pesan tidak bisa didekripsi. Coba reply lagi dengan cepat sebelum media kadaluarsa.`, "red");
        } else {
          logCuy(`Gagal mengunduh media (${type}) setelah ${retries}x: ${error.message}`, "red");
        }
        return null;
      }
    }
  }
  return null;
}

// Handler khusus viewonce biar bisa dipakai .vo dan trigger cantik
async function handleViewOnce(sock, msg, myJid, reply) {
  if (!msg.isQuoted || !msg.quoted || !msg.quoted.quotedMessage) {
    await reply("Reply/balas pesan sekali liat dengan perintah *.vo* atau ketik *cantik* sambil reply pesan sekali liatnya.\nContoh: reply foto sekali liat lalu ketik `cantik` / `cantik bgtt` / `.vo`");
    return;
  }

  const quotedMsg = msg.quoted.quotedMessage;
  const viewOnceData = getViewOnceContent(quotedMsg);

  // Fallback lama untuk kompatibilitas
  if (!viewOnceData) {
    // coba cara lama (langsung imageMessage tanpa wrapper)
    if (quotedMsg.imageMessage || quotedMsg.videoMessage || quotedMsg.audioMessage) {
      const type = quotedMsg.imageMessage ? "image" : quotedMsg.videoMessage ? "video" : "audio";
      const msgToDownload = {
        message: { [`${type}Message`]: quotedMsg[`${type}Message`] },
        key: msg.quoted.key,
      };
      const buffer = await safeDownloadMedia(sock, msgToDownload, type === "image" ? "gambar" : type);
      if (buffer) {
        const sendObj = type === "image" ? { image: Buffer.from(buffer) } : type === "video" ? { video: Buffer.from(buffer) } : { audio: Buffer.from(buffer), mimetype: "audio/ogg; codecs=opus" };
        await sock.sendMessage(myJid, sendObj, { quoted: msg });
        logCuy(`Berhasil mengambil ${type} sekali liat (fallback)`, "blue");
      } else {
        await reply("Gagal mengunduh media, media mungkin sudah kadaluarsa atau terkena *closed session*. Coba ulangi lebih cepat.");
      }
      return;
    }
    await reply("Pesan yang kamu reply bukan pesan sekali liat (foto/video/audio viewonce). Pastikan kamu reply pesan *sekali liat* yang asli.");
    logCuy("Pesan yang kamu reply bukan viewonce", "yellow");
    return;
  }

  const { type } = viewOnceData;
  // Buat structure untuk download: harus pertahankan wrapper viewOnce biar Baileys bisa decrypt
  // Cara paling aman: kirim full quotedMessage sebagai message + key asli
  const msgToDownload = {
    message: quotedMsg, // biarkan full wrapper, Baileys akan unwrap internal
    key: msg.quoted.key,
  };

  // Alternatif jika gagal, coba dengan unwrapped raw
  let buffer = await safeDownloadMedia(sock, msgToDownload, type === "image" ? "gambar" : type);
  if (!buffer && viewOnceData.raw) {
    const fallbackMsg = {
      message: viewOnceData.raw,
      key: msg.quoted.key,
    };
    // coba fallback dengan raw imageMessage saja
    const simpleMsg = {
      message: { [`${type}Message`]: viewOnceData.msg },
      key: msg.quoted.key,
    };
    buffer = await safeDownloadMedia(sock, simpleMsg, type);
  }

  if (buffer) {
    if (type === "image") {
      await sock.sendMessage(myJid, { image: Buffer.from(buffer), caption: viewOnceData.msg.caption || "" }, { quoted: msg });
      logCuy("Berhasil mengambil gambar sekali liat (cantik/.vo)", "blue");
    } else if (type === "video") {
      await sock.sendMessage(myJid, { video: Buffer.from(buffer), caption: viewOnceData.msg.caption || "" }, { quoted: msg });
      logCuy("Berhasil mengambil video sekali liat (cantik/.vo)", "blue");
    } else if (type === "audio") {
      await sock.sendMessage(myJid, { audio: Buffer.from(buffer), mimetype: "audio/ogg; codecs=opus" }, { quoted: msg });
      logCuy("Berhasil mengambil audio sekali liat (cantik/.vo)", "blue");
    }
  } else {
    await reply("Gagal mengunduh media viewonce. Penyebab umum: *Decrypted message with closed session* = pesan sudah kadaluarsa / sesi enkripsi sudah tertutup. Solusi: minta pengirim kirim ulang dan langsung reply dengan `.vo` / `cantik` secepatnya (jangan tunggu lama).");
  }
}

async function connectToWhatsApp() {
  if (isConnecting) { logCuy("Sudah ada percobaan konek, skip duplikat...", "yellow"); return; }
  isConnecting = true;
  // tutup sock lama biar tidak bentrok 440
  try { if (currentSock?.ws) currentSock.ws.close(); } catch (_) {}
  try { if (currentSock?.end) currentSock.end(); } catch (_) {}

  const sessionPath = path.join(__dirname, "sessions");
  const sessionExists =
    fs.existsSync(sessionPath) && fs.readdirSync(sessionPath).length > 0;

  const { state, saveCreds } = await useMultiFileAuthState("sessions");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: pino({ level: "silent" }),
    auth: state,
    printQRInTerminal: !useCode,
    defaultQueryTimeoutMs: undefined,
    keepAliveIntervalMs: 25000,
    browser: Browsers.ubuntu("Chrome"), // ganti ke ubuntu biar tidak 440 di beberapa WA
    shouldSyncHistoryMessage: () => false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: true,
    markOnlineOnConnect: false, // jangan mark online terus biar tidak dianggap dobel
    retryRequestDelayMs: 2000,
    emitOwnEvents: false,
  });
  currentSock = sock;
  lastActiveTime = Date.now();

  if (useCode && !sessionExists) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    logCuy(
      "Halo sepertinya kamu belum login, Mau login wangsaf pakai pairing code?\nSilahkan balas dengan (y/n)\nketik y untuk setuju atau ketik n untuk login menggunakan qrcode",
      "cyan"
    );

    const askPairingCode = () => {
      rl.question(
        "\nApakah kamu ingin menggunakan pairing code untuk login ke wangsaf? (y/n): ".yellow.bold,
        async (answer) => {
          if (answer.toLowerCase() === "y" || answer.trim() === "") {
            logCuy(
              "Wokeh kalau gitu silahkan masukkan nomor wangsafmu!\ncatatan : awali dengan 62 contoh 628123456789",
              "cyan"
            );
            const askWaNumber = () => {
              rl.question(
                "\nMasukkan nomor wangsaf Anda: ".yellow.bold,
                async (waNumber) => {
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
                    console.log(
                      "\nCek notifikasi wangsafmu dan masukin kode login wangsaf:".blue.bold,
                      code.bold.red
                    );
                  } catch (e) {
                    logCuy(`Gagal minta pairing code: ${e.message}`, "red");
                    logCuy("Coba ulangi atau gunakan QR code (ketik n)", "yellow");
                  }
                  rl.close();
                }
              );
            };
            askWaNumber();
          } else if (answer.toLowerCase() === "n") {
            useCode = false;
            logCuy(
              "Buka wangsafmu lalu klik titik tiga di kanan atas kemudian klik perangkat tertaut setelah itu Silahkan scan QR code dibawah untuk login ke wangsaf",
              "cyan"
            );
            // Jangan panggil connectToWhatsApp() lagi biar tidak dobel socket, cukup update printQR
            rl.close();
          } else {
            logCuy('Input tidak valid. Silakan masukkan "y" atau "n".', "red");
            askPairingCode();
          }
        }
      );
    };

    askPairingCode();
  }

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;
    lastActiveTime = Date.now();
    if (connection === "close") isConnecting = false;
    if (connection === "open") isConnecting = false;

    if (connection === "close") {
      const statusCode = lastDisconnect.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      // jangan log 440 berisik lagi, cukup sekali
      if (statusCode !== 440) {
        logCuy(`Koneksi terputus. Code: ${statusCode} | Reconnect: ${shouldReconnect}`, "yellow");
      }
      logErrorToFile(`connection close code ${statusCode} reconnect=${shouldReconnect} err=${lastDisconnect.error?.message} stack=${lastDisconnect.error?.stack || ""}`);
      // FIX 440 connectionReplaced = silent handle tanpa spam warning
      if (statusCode === 440) {
        const now = Date.now();
        if (now - last440Time < 60000) reconnect440Count++; else reconnect440Count = 1;
        last440Time = now;
        if (reconnect440Count >= 3) {
          logCuy("Koneksi 440 3x - sessions mungkin dobel/korup. Hapus sessions & pairing ulang 1x saja:", "red");
          logCuy("  rm -rf sessions && node index.js  (di HP hapus Perangkat Tertaut lama)", "yellow");
          return; // stop biar tidak loop spam
        }
        // retry diam-diam tanpa warning panjang
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
        if (fs.existsSync(sessionPath)) fs.rmSync(sessionPath, { recursive: true, force: true });
        setTimeout(() => connectToWhatsApp(), 3000);
      }
    } else if (connection === "open") {
      logCuy("Berhasil Terhubung ke wangsaf");
      logInfoToFile("connection open");
      loggedInNumber = sock.user.id.split("@")[0].split(":")[0];
      // mulai health check + backup saat sudah open
      startHealthCheck();
      backupSessions();
      let displayedLoggedInNumber = loggedInNumber;

      if (sensorNomor) {
        displayedLoggedInNumber =
          displayedLoggedInNumber.slice(0, 3) + "****" + displayedLoggedInNumber.slice(-2);
      }

      const messageInfo = `Bot *AutoReadStoryWhatsApp* Aktif!
Kamu berhasil login dengan nomor: ${displayedLoggedInNumber}

info status fitur:
- Auto Read Status: ${autoReadStatus ? "*Aktif*" : "*Nonaktif*"}
- Auto Like Status: ${autoLikeStatus ? "*Aktif*" : "*Nonaktif*"}
- Download Media Status: ${downloadMediaStatus ? "*Aktif*" : "*Nonaktif*"}
- Sensor Nomor: ${sensorNomor ? "*Aktif*" : "*Nonaktif*"}
- Anti Telpon: ${antiTelpon ? "*Aktif*" : "*Nonaktif*"}
- Auto Kick tag Story: ${autoKickStory ? "*Aktif*" : "*Nonaktif*"}
- Auto ViewOnce: ${autoViewOnce ? "*Aktif*" : "*Nonaktif*"}

Ketik *#menu* untuk melihat menu perintah yang tersedia.
Fitur baru: *AUTO* viewonce langsung ke-forward tanpa .vo (ketik #off autovo untuk matikan) + *.vo* / *cantik* tetap bisa`;

      console.log(
        "kamu berhasil login dengan nomor:".green.bold,
        displayedLoggedInNumber.yellow.bold
      );
      console.log(
        "Bot sudah aktif!\n\nSelamat menikmati fitur auto read story whatsapp by".green.bold,
        "Zaaa\n".red.bold
      );

      if (!welcomeMessage) {
        setTimeout(async () => {
          try {
            await sock.sendMessage(`${loggedInNumber}@s.whatsapp.net`, { text: messageInfo });
          } catch {}
          welcomeMessage = true;
        }, 5000);
      }
    }
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("call", (call) => {
    const { id, status, from } = call[0];
    if (status === "offer" && antiTelpon) return sock.rejectCall(id, from);
  });

  // Anti crash untuk closed session + log ke file (cukup sekali)
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

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    lastActiveTime = Date.now();
    // FIX: hanya proses notify, abaikan append biar tidak dobel download & cegah closed session double decrypt
    if (type !== "notify") return;
    const msg = messages[0];
    if (!msg.message) return;

    // Abaikan status broadcast yang sudah dihapus/reaction
    if (msg.message.protocolMessage || msg.message.reactionMessage) return;

    msg.type = msg.message.imageMessage
      ? "imageMessage"
      : msg.message.videoMessage
      ? "videoMessage"
      : msg.message.audioMessage
      ? "audioMessage"
      : msg.message.extendedTextMessage
      ? "extendedTextMessage"
      : Object.keys(msg.message)[0];

    msg.text =
      msg.type === "conversation"
        ? msg.message.conversation
        : msg.type === "extendedTextMessage"
        ? msg.message.extendedTextMessage.text
        : msg.message[msg.type]?.caption || "";

    // Ambil text juga dari viewOnce yang baru (kadang caption di dalam viewOnce)
    if (!msg.text) {
      // coba ambil dari unwrap untuk deteksi cantik di caption?
      const unwrapped = unwrapMessage(msg.message);
      msg.text = unwrapped?.extendedTextMessage?.text || unwrapped?.conversation || "";
    }

    msg.isQuoted =
      msg.type === "extendedTextMessage"
        ? msg.message.extendedTextMessage.contextInfo?.quotedMessage
        : msg.type === "imageMessage"
        ? msg.message.imageMessage.contextInfo?.quotedMessage
        : msg.type === "videoMessage"
        ? msg.message.videoMessage.contextInfo?.quotedMessage
        : msg.type === "audioMessage"
        ? msg.message.audioMessage.contextInfo?.quotedMessage
        : null;

    msg.quoted = msg.isQuoted
      ? msg.message.extendedTextMessage?.contextInfo ||
        msg.message.imageMessage?.contextInfo ||
        msg.message.videoMessage?.contextInfo ||
        msg.message.audioMessage?.contextInfo
      : null;

    const prefixes = [".", "#", "!", "/"];
    const prefix = prefixes.find((p) => msg.text.startsWith(p));
    const myJid = loggedInNumber ? `${loggedInNumber}@s.whatsapp.net` : null;

    // ========== AUTO VIEWONCE TANPA TRIGGER (BARU) ==========
    if (autoViewOnce && myJid && !msg.key.fromMe && msg.key.remoteJid !== "status@broadcast") {
      // deteksi viewOnce: cek wrapper ATAU flag viewOnce di dalam image/video
      const directViewOnceRaw = getViewOnceContent(msg.message);
      const isRealViewOnce = directViewOnceRaw && (
        JSON.stringify(msg.message).toLowerCase().includes("viewonce") ||
        directViewOnceRaw.msg?.viewOnce === true ||
        directViewOnceRaw.msg?.viewOnceV2 === true
      );
      const directViewOnce = isRealViewOnce ? directViewOnceRaw : null;
      if (directViewOnceRaw && !isRealViewOnce) {
        // debug: terdeteksi image tapi bukan viewOnce, abaikan
        logInfoToFile(`skip auto: bukan viewOnce asli dari ${msg.key.remoteJid}`);
      }
      if (directViewOnce) {
        const sender = msg.pushName || msg.key.remoteJid.split("@")[0];
        const senderJid = msg.key.remoteJid;
        const typeLabel = directViewOnce.type === "image" ? "foto" : directViewOnce.type === "video" ? "video" : "audio";
        logCuy(`Auto-viewonce terdeteksi dari ${sender} (${senderJid}) tipe ${typeLabel} -> download otomatis...`, "cyan");
        logInfoToFile(`auto viewonce from ${senderJid} type ${directViewOnce.type}`);
        try {
          // Buat object untuk download: pakai msg asli biar key & wrapper tetap utuh
          const msgToDownload = { message: msg.message, key: msg.key };
          let buffer = await safeDownloadMedia(sock, msgToDownload, typeLabel);
          // fallback: coba dengan unwrapped raw
          if (!buffer && directViewOnce.raw) {
            const simpleMsg = { message: directViewOnce.raw, key: msg.key };
            const altMsg = { message: { [`${directViewOnce.type}Message`]: directViewOnce.msg }, key: msg.key };
            buffer = await safeDownloadMedia(sock, altMsg, typeLabel) || await safeDownloadMedia(sock, simpleMsg, typeLabel);
          }
          if (buffer) {
            const caption = directViewOnce.msg.caption || "";
            const infoText = `📥 *Auto ViewOnce* dari *${sender}* (${senderJid})\nTipe: ${typeLabel}${caption ? `\nCaption: ${caption}` : ""}\nWaktu: ${moment().tz("Asia/Jakarta").format("DD-MM-YYYY HH:mm:ss")}`;
            if (directViewOnce.type === "image") {
              await sock.sendMessage(myJid, { image: Buffer.from(buffer), caption: infoText });
            } else if (directViewOnce.type === "video") {
              await sock.sendMessage(myJid, { video: Buffer.from(buffer), caption: infoText });
            } else if (directViewOnce.type === "audio") {
              await sock.sendMessage(myJid, { audio: Buffer.from(buffer), mimetype: "audio/ogg; codecs=opus" });
              await sock.sendMessage(myJid, { text: infoText });
            }
            logCuy(`Berhasil auto-forward ${typeLabel} viewonce dari ${sender}`, "green");
            // jangan return, biar tetap lanjut cek lain tapi jangan proses sebagai perintah
          } else {
            await sock.sendMessage(myJid, { text: `⚠️ Gagal auto-download viewonce ${typeLabel} dari *${sender}* (${senderJid}). Kemungkinan *closed session* / media kadaluarsa. Coba suruh kirim ulang.` });
            logErrorToFile(`auto viewonce gagal download ${typeLabel} dari ${senderJid}`);
          }
        } catch (e) {
          logErrorToFile(`auto viewonce error ${senderJid}: ${e.message}`);
          logCuy(`Error auto viewonce: ${e.message}`, "red");
        }
        // tetap lanjut biar status handler tidak kepotong, tapi jangan proses cantik/prefix untuk pesan viewonce ini
        // return; // uncomment jika mau stop total setelah auto
      }
    }

    // ========== GEMINI AI TRIGGER OALAH / HAHAHA ==========
    const cleanText = msg.text.trim().toLowerCase();
    const cleanRaw = msg.text.trim();
    // kamu yang trigger: reply chat dengan "oalah" -> AI on untuk nomor itu, "HAHAHA" -> AI off
    if (msg.key.fromMe) {
      if (/^oalah$/i.test(cleanText)) {
        let targetJid = null;
        let targetNum = null;
        if (msg.isQuoted && msg.quoted) {
          // ambil dari quoted (orang yang kamu reply)
          const qKey = msg.quoted.key || msg.quoted;
          targetJid = qKey.participant || qKey.remoteJid || msg.key.remoteJid;
          // untuk private chat, remoteJid sudah nomor orang itu
          if (msg.key.remoteJid !== myJid && !msg.key.remoteJid.includes("@g.us")) targetJid = msg.key.remoteJid;
          // kalau reply di grup, ambil participant
          if (msg.quoted.key?.participant) targetJid = msg.quoted.key.participant;
          else if (msg.isQuoted && msg.quoted.key?.remoteJid) targetJid = msg.quoted.key.remoteJid;
        }
        // fallback: jika tidak reply, pakai remoteJid chat saat itu (private chat)
        if (!targetJid && msg.key.remoteJid !== myJid && !msg.key.remoteJid.includes("@g.us")) targetJid = msg.key.remoteJid;
        if (targetJid) {
          targetNum = targetJid.split("@")[0].split(":")[0];
          // cek whitelist jika ada
          if (aiWhitelist.length > 0 && !aiWhitelist.includes(targetNum)) {
            await sock.sendMessage(myJid, { text: `nomor ${targetNum} belum di whitelist ai. tambah dulu: #add aiwhitelist ${targetNum}` }, { quoted: msg });
          } else {
            aiActiveChats.set(targetJid, Date.now() + AI_TIMEOUT_MS);
            logCuy(`AI ON untuk ${targetJid} (trigger oalah)`, "cyan");
            logInfoToFile(`AI ON ${targetJid}`);
            await sock.sendMessage(myJid, { text: `ai on untuk ${targetNum} - semua chat dari dia bakal dibales ai lowercase 15 menit. ketik HAHAHA sambil reply chat dia untuk stop` }, { quoted: msg });
          }
        } else {
          await sock.sendMessage(myJid, { text: `reply chat orangnya dulu baru ketik oalah` }, { quoted: msg });
        }
        return;
      }
      if (/^hahaha$/i.test(cleanText)) {
        let targetJid = null;
        if (msg.isQuoted && msg.quoted?.key) {
          targetJid = msg.quoted.key.participant || msg.quoted.key.remoteJid;
          if (msg.key.remoteJid !== myJid && !msg.key.remoteJid.includes("@g.us")) targetJid = msg.key.remoteJid;
          if (msg.quoted.key.participant) targetJid = msg.quoted.key.participant;
        }
        if (!targetJid && msg.key.remoteJid !== myJid && !msg.key.remoteJid.includes("@g.us")) targetJid = msg.key.remoteJid;
        if (targetJid) {
          aiActiveChats.delete(targetJid);
          const num = targetJid.split("@")[0];
          logCuy(`AI OFF untuk ${targetJid} (trigger HAHAHA)`, "yellow");
          logInfoToFile(`AI OFF ${targetJid}`);
          await sock.sendMessage(myJid, { text: `ai off untuk ${num} - stop bales otomatis` }, { quoted: msg });
        } else {
          // HAHAHA tanpa reply = matikan semua
          aiActiveChats.clear();
          await sock.sendMessage(myJid, { text: `ai off semua chat` }, { quoted: msg });
        }
        return;
      }
    }
    // auto balas AI untuk incoming yang sudah di-ON
    if (!msg.key.fromMe && aiEnabled && aiActiveChats.has(msg.key.remoteJid) && msg.key.remoteJid !== "status@broadcast") {
      const senderJid = msg.key.remoteJid;
      const senderNum = senderJid.split("@")[0].split(":")[0];
      if (aiWhitelist.length > 0 && !aiWhitelist.includes(senderNum)) {
        logInfoToFile(`AI skip ${senderJid} tidak di whitelist`);
      } else {
        // cek timeout
        const exp = aiActiveChats.get(senderJid);
        if (exp && Date.now() > exp) {
          aiActiveChats.delete(senderJid);
          logCuy(`AI timeout untuk ${senderJid}`, "yellow");
        } else {
          // perpanjang timeout tiap ada chat baru
          aiActiveChats.set(senderJid, Date.now() + AI_TIMEOUT_MS);
          const senderName = msg.pushName || senderNum;
          const userText = msg.text || "(media)";
          if (!geminiApiKey) {
            await sock.sendMessage(senderJid, { text: "maaf ai belum disetting apikeynya" });
            return;
          }
          logCuy(`AI balas ke ${senderName} (${senderNum}): "${userText}"`, "cyan");
          logInfoToFile(`AI trigger ${senderJid}: ${userText}`);
          const aiReply = await callGemini(userText, senderName);
          await sendHumanTyping(sock, senderJid, aiReply);
          await sock.sendMessage(senderJid, { text: aiReply });
          logCuy(`AI terkirim ke ${senderNum}: "${aiReply}"`, "green");
          return; // jangan lanjut ke handler lain
        }
      }
    }
    // untuk grup: cek participant juga
    if (!msg.key.fromMe && aiEnabled && msg.key.remoteJid.includes("@g.us") && msg.key.participant) {
      const participantJid = msg.key.participant;
      if (aiActiveChats.has(participantJid)) {
        const senderNum = participantJid.split("@")[0].split(":")[0];
        if (aiWhitelist.length === 0 || aiWhitelist.includes(senderNum)) {
          const exp = aiActiveChats.get(participantJid);
          if (exp && Date.now() > exp) {
            aiActiveChats.delete(participantJid);
          } else {
            aiActiveChats.set(participantJid, Date.now() + AI_TIMEOUT_MS);
            const userText = msg.text || "(media grup)";
            const aiReply = await callGemini(userText, msg.pushName || senderNum);
            await sendHumanTyping(sock, msg.key.remoteJid, aiReply);
            await sock.sendMessage(msg.key.remoteJid, { text: aiReply, mentions: [participantJid] });
            return;
          }
        }
      }
    }

    // ========== FITUR CANTIK & JELEK (TRIGGER TANPA PREFIX) ==========
    // User mau: ketik cantik / cantikk nyooo / cantiknyooo / cantik bgtt dll -> auto ambil viewonce
    // Juga jelek wuu -> sama
    const isCantikTrigger = /^(cantik|jelek)/i.test(cleanText) && msg.key.fromMe;
    // Contoh match: cantik, cantikk, cantiknyooo, cantik bgtt, cantik wuu, jelek, jelekk, jelek wuu
    // Hanya jalan kalau reply ke viewonce
    if (isCantikTrigger && myJid) {
      const reply = async (text) =>
        sock.sendMessage(myJid, { text }, { quoted: msg });
      // Cek apakah ini reply viewonce
      if (msg.isQuoted && msg.quoted && msg.quoted.quotedMessage) {
        const quotedMsg = msg.quoted.quotedMessage;
        const viewOnceData = getViewOnceContent(quotedMsg);
        const isViewOnce = !!viewOnceData || quotedMsg.imageMessage || quotedMsg.videoMessage || quotedMsg.audioMessage;
        if (isViewOnce) {
          logCuy(`Trigger cantik/jelek terdeteksi: "${msg.text}" -> mengambil viewonce...`, "cyan");
          await handleViewOnce(sock, msg, myJid, reply);
          return; // jangan lanjut ke switch
        }
      }
      // Jika tidak reply viewonce tapi tetap ketik cantik, kasih hint
      // Biar tidak spam, hanya beri hint kalau dia memang reply tapi bukan viewonce
      if (msg.isQuoted) {
        await sock.sendMessage(myJid, { text: `Trigger *${msg.text}* terdeteksi tapi pesan yang di-reply bukan viewonce. Reply foto/video sekali liat lalu ketik *cantik* lagi.` }, { quoted: msg });
        return;
      }
    }

    if (prefix && msg.key.fromMe && myJid) {
      msg.cmd = msg.text.trim().split(" ")[0].replace(prefix, "").toLowerCase();
      msg.args = msg.text.replace(/^\S*\b/g, "").trim().split("|");

      const reply = async (text) =>
        sock.sendMessage(myJid, { text }, { quoted: msg });

      const validateNumber = async (commandname, type, sc, data) => {
        if (!data) {
          await reply(
            `Nomor harus diisi.\ncontoh ketik :\n\`${commandname} blacklist 628123456789\`\n\nArgumen yang tersedia:\n\n\`${commandname} blacklist nomornya\`\nuntuk ${type} nomor ${sc} blacklist\n\n\`${commandname} whitelist nomornya\`\nuntuk ${type} nomor ${sc} whitelist`
          );
          return false;
        }
        if (!/^\d+$/.test(data)) {
          await reply(
            `Nomor harus berupa angka.\ncontoh ketik :\n\`${commandname} blacklist 628123456789\`\n\nArgumen yang tersedia:\n\n\`${commandname} blacklist nomornya\`\nuntuk ${type} nomor ${sc} blacklist\n\n\`${commandname} whitelist nomornya\`\nuntuk ${type} nomor ${sc} whitelist`
          );
          return false;
        }
        return true;
      };

      const sensorNum = (num) =>
        sensorNomor ? num.slice(0, 3) + "****" + num.slice(-2) : num;

      switch (msg.cmd) {
        case "on":
          if (msg.args[0].trim() === "") {
            await reply(
              `mana argumennya ?\ncontoh ketik : \`#on autolike\`\n\nArgumen yang tersedia:\n\n\`#on autoread\`\nuntuk mengaktifkan fitur autoread story\n\n\`#on autolike\`\nuntuk mengaktifkan fitur autolike story\n\n\`#on dlmedia\`\nuntuk mengaktifkan fitur download media(foto,video, dan audio) dari story\n\n\`#on sensornomor\`\nuntuk mengaktifkan sensor nomor\n\n\`#on antitelpon\`\nuntuk mengaktifkan anti-telpon\n\n\`#on kickstory\`\nuntuk mengaktifkan auto kick story grup\n\n\`#on autovo\`\nuntuk mengaktifkan auto viewonce\n\n\`#on ai\`\nuntuk mengaktifkan ai gemini`
            );
          } else {
            for (const arg of msg.args) {
              switch (arg.trim().toLowerCase()) {
                case "autoread":
                  autoReadStatus = true;
                  updateConfig("autoReadStatus", true);
                  logCuy("Kamu mengaktifkan fitur Auto Read Status", "blue");
                  await reply("Auto Read Status aktif");
                  break;
                case "autolike":
                  autoLikeStatus = true;
                  updateConfig("autoLikeStatus", true);
                  logCuy("Kamu mengaktifkan fitur Auto Like Status", "blue");
                  await reply("Auto Like Status aktif");
                  break;
                case "dlmedia":
                  downloadMediaStatus = true;
                  updateConfig("downloadMediaStatus", true);
                  logCuy("Kamu mengaktifkan fitur Download Media Status", "blue");
                  await reply("Download Media Status aktif");
                  break;
                case "sensornomor":
                  sensorNomor = true;
                  updateConfig("sensorNomor", true);
                  logCuy("Kamu mengaktifkan fitur sensorNomor", "blue");
                  await reply("Sensor Nomor aktif");
                  break;
                case "antitelpon":
                  antiTelpon = true;
                  updateConfig("antiTelpon", true);
                  logCuy("Kamu mengaktifkan fitur Anti-telpon", "blue");
                  await reply("Anti-telpon aktif");
                  break;
                case "kickstory":
                  autoKickStory = true;
                  updateConfig("autoKickStory", true);
                  logCuy("Kamu mengaktifkan fitur auto kick tag grup di story", "blue");
                  await reply("Auto Kick Tag Grup di Story aktif");
                  break;
                case "autovo":
                case "viewonce":
                case "vo":
                  autoViewOnce = true;
                  updateConfig("autoViewOnce", true);
                  logCuy("Kamu mengaktifkan fitur Auto ViewOnce", "blue");
                  await reply("Auto ViewOnce aktif - foto sekali liat langsung auto ke-forward tanpa #vo");
                  break;
                case "ai":
                case "gemini":
                  aiEnabled = true;
                  updateConfig("aiEnabled", true);
                  logCuy("Kamu mengaktifkan AI Gemini", "blue");
                  await reply("AI Gemini aktif - reply chat dengan oalah untuk ON, HAHAHA untuk OFF");
                  break;
                default:
                  await reply(
                    `Argumen tidak valid: ${arg}. Pilihan yang tersedia: autoread, autolike, dlmedia, sensornomor, kickstory, autovo, ai dan antitelpon`
                  );
              }
            }
          }
          break;

        case "off":
          if (msg.args[0].trim() === "") {
            await reply(
              `mana argumennya ?\ncontoh ketik : \`#off autolike\`\n\nArgumen yang tersedia:\n\n\`#off autoread\`\nuntuk menonaktifkan fitur autoread story\n\n\`#off autolike\`\nuntuk menonaktifkan fitur autolike story\n\n\`#off dlmedia\`\nuntuk menonaktifkan fitur download media(foto,video, dan audio) dari story\n\n\`#off sensornomor\`\nuntuk menonaktifkan sensor nomor\n\n\`#off antitelpon\`\nuntuk menonaktifkan anti-telpon\n\n\`#off kickstory\`\nuntuk menonaktifkan auto kick story grup\n\n\`#off autovo\`\nuntuk menonaktifkan auto viewonce\n\n\`#off ai\`\nuntuk menonaktifkan ai gemini`
            );
          } else {
            for (const arg of msg.args) {
              switch (arg.trim().toLowerCase()) {
                case "autoread":
                  autoReadStatus = false;
                  updateConfig("autoReadStatus", false);
                  logCuy("Kamu mematikan fitur Auto Read Status", "blue");
                  await reply("Auto Read Status nonaktif");
                  break;
                case "autolike":
                  autoLikeStatus = false;
                  updateConfig("autoLikeStatus", false);
                  logCuy("Kamu mematikan fitur Auto Like Status", "blue");
                  await reply("Auto Like Status nonaktif");
                  break;
                case "dlmedia":
                  downloadMediaStatus = false;
                  updateConfig("downloadMediaStatus", false);
                  logCuy("Kamu mematikan fitur Download Media Status", "blue");
                  await reply("Download Media Status nonaktif");
                  break;
                case "sensornomor":
                  sensorNomor = false;
                  updateConfig("sensorNomor", false);
                  logCuy("Kamu mematikan fitur Sensor Nomor", "blue");
                  await reply("Sensor Nomor nonaktif");
                  break;
                case "antitelpon":
                  antiTelpon = false;
                  updateConfig("antiTelpon", false);
                  logCuy("Kamu mematikan fitur Anti-telpon", "blue");
                  await reply("Anti-telpon nonaktif");
                  break;
                case "kickstory":
                  autoKickStory = false;
                  updateConfig("autoKickStory", false);
                  logCuy("Kamu mematikan fitur auto kick tag grup di story", "blue");
                  await reply("Auto Kick Tag Grup di Story nonaktif");
                  break;
                case "autovo":
                case "viewonce":
                case "vo":
                  autoViewOnce = false;
                  updateConfig("autoViewOnce", false);
                  logCuy("Kamu mematikan fitur Auto ViewOnce", "blue");
                  await reply("Auto ViewOnce nonaktif - harus pakai .vo / cantik manual");
                  break;
                case "ai":
                case "gemini":
                  aiEnabled = false;
                  updateConfig("aiEnabled", false);
                  aiActiveChats.clear();
                  logCuy("Kamu mematikan AI Gemini", "blue");
                  await reply("AI Gemini nonaktif");
                  break;
                default:
                  await reply(
                    `Argumen tidak valid: ${arg}. Pilihan yang tersedia: autoread, autolike, dlmedia, sensornomor, kickstory, autovo, ai dan antitelpon`
                  );
              }
            }
          }
          break;

        case "add":
          if (msg.args[0].trim() === "") {
            await reply(
              `mana argumennya ?\ncontoh ketik :\n\`#add blacklist 628123456789\`\n\nArgumen yang tersedia:\n\n\`#add blacklist nomornya\`\nuntuk menambahkan nomor ke blacklist\n\n\`#add whitelist nomornya\`\nuntuk menambahkan nomor ke whitelist\n\n\`#add aiwhitelist nomornya\`\nuntuk menambahkan nomor ke whitelist ai (cuma nomor ini yang dibales ai)\n\n\`#add emojis emojinya\`\nuntuk menambahkan emoji ke daftar emojis`
            );
          } else {
            for (const arg of msg.args) {
              const [list, data] = arg.trim().split(" ");

              if (list === "emojis") {
                const emojiRegex = /^[\p{Emoji}\u200D\uFE0F]$/gu;
                if (!data) {
                  await reply("emoji harus diisi.\ncontoh ketik :\n`#add emojis 👍`");
                  continue;
                }
                if (!emojiRegex.test(data)) {
                  await reply("hanya boleh mengisi 1 emoji.\ncontoh ketik :\n`#add emojis 👍`");
                  continue;
                }
                if (!emojis.includes(data)) {
                  emojis.push(data);
                  updateConfig("emojis", emojis);
                  logCuy(`Kamu menambahkan emoji ${data} ke daftar emojis`, "blue");
                  await reply(`emoji ${data} berhasil ditambahkan ke daftar emojis`);
                } else {
                  await reply(`emoji ${data} sudah ada di daftar emojis`);
                }
              } else if (list === "blacklist") {
                const isValid = await validateNumber("#add", "menambahkan", "ke", data);
                if (!isValid) continue;
                const displayNumber = sensorNum(data);
                if (!blackList.includes(data)) {
                  blackList.push(data);
                  updateConfig("blackList", blackList);
                  logCuy(`Kamu menambahkan nomor ${displayNumber} ke blacklist`, "blue");
                  await reply(`Nomor ${displayNumber} berhasil ditambahkan ke blacklist`);
                } else {
                  await reply(`Nomor ${displayNumber} sudah ada di blacklist`);
                }
              } else if (list === "whitelist") {
                const isValid = await validateNumber("#add", "menambahkan", "ke", data);
                if (!isValid) continue;
                const displayNumber = sensorNum(data);
                if (!whiteList.includes(data)) {
                  whiteList.push(data);
                  updateConfig("whiteList", whiteList);
                  logCuy(`Kamu menambahkan nomor ${displayNumber} ke whitelist`, "blue");
                  await reply(`Nomor ${displayNumber} berhasil ditambahkan ke whitelist`);
                } else {
                  await reply(`Nomor ${displayNumber} sudah ada di whitelist`);
                }
              } else if (list === "aiwhitelist" || list === "ai") {
                const isValid = await validateNumber("#add", "menambahkan", "ke", data);
                if (!isValid) continue;
                const displayNumber = sensorNum(data);
                if (!aiWhitelist.includes(data)) {
                  aiWhitelist.push(data);
                  updateConfig("aiWhitelist", aiWhitelist);
                  logCuy(`Kamu menambahkan nomor ${displayNumber} ke ai whitelist`, "blue");
                  await reply(`Nomor ${displayNumber} berhasil ditambahkan ke ai whitelist - cuma nomor ini yang dibales ai`);
                } else {
                  await reply(`Nomor ${displayNumber} sudah ada di ai whitelist`);
                }
              } else {
                await reply(
                  `Argumen tidak valid: ${arg}. Pilihan yang tersedia: blacklist, whitelist, aiwhitelist, emojis`
                );
              }
            }
          }
          break;

        case "remove":
          if (msg.args[0].trim() === "") {
            await reply(
              `mana argumennya ?\ncontoh ketik :\n\`#remove blacklist 628123456789\`\n\nArgumen yang tersedia:\n\n\`#remove blacklist nomornya\`\nuntuk menghapus nomor dari blacklist\n\n\`#remove whitelist nomornya\`\nuntuk menghapus nomor dari whitelist\n\n\`#remove aiwhitelist nomornya\`\nuntuk menghapus nomor dari ai whitelist\n\n\`#remove emojis emojinya\`\nuntuk menghapus emoji dari daftar emojis`
            );
          } else {
            for (const arg of msg.args) {
              const [list, data] = arg.trim().split(" ");

              if (list === "emojis") {
                const emojiRegex = /^[\p{Emoji}\u200D\uFE0F]$/gu;
                if (!data) {
                  await reply("emoji harus diisi.\ncontoh ketik :\n`#remove emojis 👍`");
                  continue;
                }
                if (!emojiRegex.test(data)) {
                  await reply("hanya boleh mengisi 1 emoji.\ncontoh ketik :\n`#remove emojis 👍`");
                  continue;
                }
                if (emojis.length === 1) {
                  await reply(
                    "Tidak bisa menghapus emoji terakhir. Harus ada minimal satu emoji.\n\nKetik `#info` untuk mengecek daftar emoji yang tersedia"
                  );
                  continue;
                }
                if (emojis.includes(data)) {
                  emojis = emojis.filter((n) => n !== data);
                  updateConfig("emojis", emojis);
                  logCuy(`Kamu menghapus emoji ${data} dari emojis`, "blue");
                  await reply(`emoji ${data} berhasil dihapus dari daftar emojis`);
                } else {
                  await reply(
                    `emoji ${data} tidak ada di daftar emojis\n\nKetik \`#info\` untuk mengecek daftar emoji yang tersedia`
                  );
                }
              } else if (list === "blacklist") {
                const isValid = await validateNumber("#remove", "menghapus", "dari", data);
                if (!isValid) continue;
                const displayNumber = sensorNum(data);
                if (blackList.includes(data)) {
                  blackList = blackList.filter((n) => n !== data);
                  updateConfig("blackList", blackList);
                  logCuy(`Kamu menghapus nomor ${displayNumber} dari blacklist`, "blue");
                  await reply(`Nomor ${displayNumber} berhasil dihapus dari blacklist`);
                } else {
                  await reply(
                    `Nomor ${displayNumber} tidak ada di blacklist\n\nKetik \`#info\` untuk mengecek daftar nomor yang tersedia`
                  );
                }
              } else if (list === "whitelist") {
                const isValid = await validateNumber("#remove", "menghapus", "dari", data);
                if (!isValid) continue;
                const displayNumber = sensorNum(data);
                if (whiteList.includes(data)) {
                  whiteList = whiteList.filter((n) => n !== data);
                  updateConfig("whiteList", whiteList);
                  logCuy(`Kamu menghapus nomor ${displayNumber} dari whitelist`, "blue");
                  await reply(`Nomor ${displayNumber} berhasil dihapus dari whitelist`);
                } else {
                  await reply(
                    `Nomor ${displayNumber} tidak ada di whitelist\n\nKetik \`#info\` untuk mengecek daftar nomor yang tersedia`
                  );
                }
              } else if (list === "aiwhitelist" || list === "ai") {
                const isValid = await validateNumber("#remove", "menghapus", "dari", data);
                if (!isValid) continue;
                const displayNumber = sensorNum(data);
                if (aiWhitelist.includes(data)) {
                  aiWhitelist = aiWhitelist.filter((n) => n !== data);
                  updateConfig("aiWhitelist", aiWhitelist);
                  logCuy(`Kamu menghapus nomor ${displayNumber} dari ai whitelist`, "blue");
                  await reply(`Nomor ${displayNumber} berhasil dihapus dari ai whitelist`);
                } else {
                  await reply(`Nomor ${displayNumber} tidak ada di ai whitelist`);
                }
              } else {
                await reply(
                  `Argumen tidak valid: ${arg}. Pilihan yang tersedia: blacklist, whitelist, aiwhitelist, emojis`
                );
              }
            }
          }
          break;

        case "menu":
          await reply(
            `Daftar Menu:
contoh penggunaan: #on autolike

Perintah On:
\`#on autoread\`
Mengaktifkan fitur autoread story

\`#on autolike\`
Mengaktifkan fitur autolike story

\`#on dlmedia\`
Mengaktifkan fitur download media (foto, video, dan audio) dari story

\`#on sensornomor\`
Mengaktifkan sensor nomor

\`#on antitelpon\`
Mengaktifkan anti telpon

\`#on kickstory\`
Mengaktifkan auto kick story tag grup

Perintah Off:
\`#off autoread\`
Menonaktifkan fitur autoread story

\`#off autolike\`
Menonaktifkan fitur autolike story

\`#off dlmedia\`
Menonaktifkan fitur download media (foto, video, dan audio) dari story

\`#off sensornomor\`
Menonaktifkan sensor nomor

\`#off antitelpon\`
Menonaktifkan anti telpon

\`#off kickstory\`
Menonaktifkan auto kick story tag grup

Perintah Add:
\`#add blacklist nomornya\`
Menambahkan nomor ke blacklist

\`#add whitelist nomornya\`
Menambahkan nomor ke whitelist

\`#add emojis emojinya\`
Menambahkan emoji ke daftar emojis

Perintah Remove:
\`#remove blacklist nomornya\`
Menghapus nomor dari blacklist

\`#remove whitelist nomornya\`
Menghapus nomor dari whitelist

\`#remove emojis emojinya\`
Menghapus emoji dari daftar emojis

Perintah Info:
\`#info\`
Menampilkan informasi status fitur, daftar nomor/emoji yang ada di blacklist, whitelist dan emojis

Perintah Viewonce (FIX CLOSED SESSION + TERMUX + AUTO):
\`#viewonce\` / \`.vo\` / \`.vv\`
Mengambil foto/video/audio sekali liat yang kamu reply
*Baru auto:* foto sekali liat **langsung auto ke-forward** ke chat kamu tanpa perlu ketik apa pun (bisa dimatikan dengan \`#off autovo\`)
*Manual:* bisa juga ketik *cantik*, *cantiknyooo*, *cantikk bgtt*, *jelek wuu* sambil reply viewonce -> auto ambil
\`#on autovo\` aktifkan auto viewonce
\`#off autovo\` matikan auto

Perintah AI Gemini (lowercase human):
\`oalah\` (reply chat orang) -> AI ON untuk nomor itu 15 menit (cuma whitelist ai yang dibales)
\`HAHAHA\` (reply chat) -> AI OFF untuk nomor itu
\`#add aiwhitelist 628xxx\` tambah nomor yang boleh dibales ai
\`#on ai\` / \`#off ai\` global on/off
\`#set apikey AIza...\` / \`#apikey AIza...\` set key langsung dari WA
\`#info\` cek key kepasang (masked)`
          );
          break;

        // FIX: .vo alias + viewonce dengan unwrap baru
        case "viewonce":
        case "vo":
        case "vv":
        case "view_once":
        case " Kasus":
          await handleViewOnce(sock, msg, myJid, reply);
          break;

        case "set":
        case "setkey":
        case "setapikey":
        case "apikey":
        case "gemini": {
          const raw = msg.args.join("|").trim();
          const key = raw.split(" ").pop().trim();
          const sub = msg.args[0]?.trim().toLowerCase();
          // format: #set apikey AIza... atau #set gemini AIza... atau #apikey AIza...
          let newKey = "";
          if (msg.cmd === "apikey" || msg.cmd === "gemini") newKey = msg.args.join(" ").trim().split(" ").pop();
          else if (sub === "apikey" || sub === "gemini" || sub === "key") newKey = raw.replace(/^(apikey|gemini|key)\s+/i, "").trim();
          else newKey = key;

          if (!newKey || newKey.length < 20) {
            await reply(`cara pakai:\n\`#set apikey AIzaSy...\`\n\`#apikey AIzaSy...\`\n\nambil key gratis di https://aistudio.google.com/api-keys\n\nkey sekarang: ${geminiApiKey ? geminiApiKey.slice(0,8)+"****"+geminiApiKey.slice(-4) : "belum diisi"}`);
            break;
          }
          if (!newKey.startsWith("AIza")) {
            await reply(`key tidak valid, harus diawali AIza...\ncontoh: #set apikey AIzaSy...`);
            break;
          }
          geminiApiKey = newKey;
          updateConfig("geminiApiKey", newKey);
          logCuy(`API Key Gemini diupdate`, "green");
          logInfoToFile(`gemini key updated`);
          await reply(`api key gemini berhasil disimpan: ${newKey.slice(0,8)}****${newKey.slice(-4)}\nmodel: ${geminiModel}\n\ntest: reply chat dengan oalah`);
          break;
        }

        case "info": {
          const maskedKey = geminiApiKey ? geminiApiKey.slice(0,8)+"****"+geminiApiKey.slice(-4) : "belum diisi (pakai #set apikey AIza...)";
          const infoMessage = `Informasi Status Fitur:
          - Auto Read Status: ${autoReadStatus ? "*Aktif*" : "*Nonaktif*"}
          - Auto Like Status: ${autoLikeStatus ? "*Aktif*" : "*Nonaktif*"}
          - Download Media Status: ${downloadMediaStatus ? "*Aktif*" : "*Nonaktif*"}
          - Sensor Nomor: ${sensorNomor ? "*Aktif*" : "*Nonaktif*"}
          - Anti Telpon: ${antiTelpon ? "*Aktif*" : "*Nonaktif*"}
          - Auto Kick tag Story: ${autoKickStory ? "*Aktif*" : "*Nonaktif*"}
          - Auto ViewOnce: ${autoViewOnce ? "*Aktif* (auto forward tanpa trigger)" : "*Nonaktif* (pakai .vo/cantik)"}
          - AI Gemini: ${aiEnabled ? "*Aktif*" : "*Nonaktif*"} | Key: ${maskedKey} | Active: ${aiActiveChats.size} chat | Model: ${geminiModel}`;

          const formatList = (list) =>
            list.map((number) => `\u25CF ${sensorNum(number)}`).join("\n");

          const formatEmojiList = (list) => list.join(", ");

          const blacklistMessage =
            blackList.length > 0 ? `Blacklist:\n${formatList(blackList)}` : "Blacklist kosong.";
          const whitelistMessage =
            whiteList.length > 0 ? `Whitelist:\n${formatList(whiteList)}` : "Whitelist kosong.";
          const aiWhitelistMessage = aiWhitelist.length > 0 ? `AI Whitelist:\n${formatList(aiWhitelist)}` : "AI Whitelist kosong (semua nomor boleh ai jika di-ON via oalah).";
          const emojisMessage =
            emojis.length > 0 ? `Emojis:\n${formatEmojiList(emojis)}` : "Emojis kosong.";
          const aiActiveMessage = aiActiveChats.size > 0 ? `AI Active Chats:\n${Array.from(aiActiveChats.keys()).map(j=>`\u25CF ${sensorNum(j.split("@")[0])}`).join("\n")}` : "AI Active kosong.";

          const listMessage = `\n\n${blacklistMessage}\n\n${whitelistMessage}\n\n${aiWhitelistMessage}\n\n${aiActiveMessage}\n\n${emojisMessage}\n\nKetik \`#set apikey AIza...\` untuk set key gemini\nKetik \`#add aiwhitelist nomornya\` untuk ai\nKetik \`#on ai\` / \`#off ai\` untuk AI\nKetik \`oalah\` (reply chat) untuk ON ai, \`HAHAHA\` untuk OFF`;

          await reply(infoMessage + listMessage);
          break;
        }
      }
    }

    if (autoKickStory && msg.message.groupStatusMentionMessage && !msg.key.fromMe) {
      const groupId = msg.key.remoteJid;
      const participant =
        msg.key.participantAlt && !msg.key.participantAlt.includes("@lid")
          ? msg.key.participantAlt
          : msg.key.participant;

      try {
        const groupMetadata = await sock.groupMetadata(groupId);
        const groupName = groupMetadata.subject;
        const botNumber = sock.user.id.split(":")[0] + "@s.whatsapp.net";
        const isAdmin = groupMetadata.participants.some(
          (member) => member.phoneNumber === botNumber && member.admin !== null
        );

        if (isAdmin) {
          await sock.sendMessage(
            groupId,
            {
              text: `@${participant.split("@")[0]} terdeteksi tag grup di story, kamu akan dikick.`,
              mentions: [participant],
            },
            { quoted: msg }
          );
          await sock.groupParticipantsUpdate(groupId, [participant], "remove");
          logCuy(
            `Kamu mengeluarkan seseorang dari group ${groupName} karena telah tag grup di story.`,
            "red"
          );
        } else {
          logCuy(`Kamu bukan admin di grup ${groupName} jadi tidak bisa kick.`, "yellow");
        }
      } catch (e) {
        logCuy(`Gagal kick story: ${e.message}`, "red");
      }
    }

    if (
      msg.key.remoteJid === "status@broadcast" &&
      msg.key.remoteJidAlt !== `${loggedInNumber}@s.whatsapp.net` &&
      autoReadStatus
    ) {
      let senderNumber = msg.key.remoteJidAlt
        ? msg.key.remoteJidAlt.split("@")[0]
        : "Tidak diketahui";
      const senderName = msg.pushName || "Tidak diketahui";
      const displaySenderNumber =
        senderNumber !== "Tidak diketahui" ? sensorNum(senderNumber) : senderNumber;

      if (msg.message.protocolMessage) {
        logCuy(`Status dari ${senderName} (${displaySenderNumber}) telah dihapus.`, "red");
        return;
      }

      if (msg.message.reactionMessage) return;

      if (blackList.includes(senderNumber)) {
        logCuy(
          `${senderName} (${displaySenderNumber}) membuat status tapi karena ada di blacklist. Status tidak akan dilihat.`,
          "yellow"
        );
        return;
      }

      if (whiteList.length > 0 && !whiteList.includes(senderNumber)) {
        logCuy(
          `${senderName} (${displaySenderNumber}) membuat status tapi karena tidak ada di whitelist. Status tidak akan dilihat.`,
          "yellow"
        );
        return;
      }

      if (!msg.key.remoteJid || !msg.key.remoteJidAlt) return;

      const myself = jidNormalizedUser(sock.user.id);
      const emojiToReact = emojis[Math.floor(Math.random() * emojis.length)];

      try {
        await sock.readMessages([msg.key]);

        if (autoLikeStatus) {
          await sock.sendMessage(
            msg.key.remoteJid,
            { react: { key: msg.key, text: emojiToReact } },
            { statusJidList: [msg.key.remoteJidAlt, myself] }
          );
        }

        logCuy(
          `Berhasil melihat ${autoLikeStatus ? "dan menyukai " : ""}status dari: ${senderName} (${displaySenderNumber})`,
          "green"
        );

        const caption =
          msg.message.imageMessage?.caption ||
          msg.message.videoMessage?.caption ||
          msg.message.extendedTextMessage?.text ||
          "Tidak ada caption";

        if (downloadMediaStatus) {
          if (msg.type === "imageMessage" || msg.type === "videoMessage") {
            const mediaType = msg.type === "imageMessage" ? "image" : "video";
            const mediaLabel = mediaType === "image" ? "gambar" : "video";
            const messageContent = `Status ${mediaLabel} dari *${senderName}* (${displaySenderNumber}) telah dilihat ${autoLikeStatus ? "dan disukai" : ""}`;

            const buffer = await safeDownloadMedia(sock, msg, mediaLabel);
            if (buffer) {
              await sock.sendMessage(`${loggedInNumber}@s.whatsapp.net`, {
                [mediaType]: Buffer.from(buffer),
                caption: `${messageContent} dengan caption : "*${caption}*"`,
              });
            } else {
              await sock.sendMessage(`${loggedInNumber}@s.whatsapp.net`, {
                text: `${messageContent} namun gagal mengunggah media ${mediaLabel} dari *${senderName}* (${displaySenderNumber}). Media mungkin sudah kadaluarsa.`,
              });
            }
          } else if (msg.type === "audioMessage") {
            const messageContent = `Status audio dari *${senderName}* (${displaySenderNumber}) telah dilihat ${autoLikeStatus ? "dan disukai" : ""}. Berikut audionya.`;
            await sock.sendMessage(`${loggedInNumber}@s.whatsapp.net`, { text: messageContent });

            const buffer = await safeDownloadMedia(sock, msg, "audio");
            if (buffer) {
              await sock.sendMessage(`${loggedInNumber}@s.whatsapp.net`, {
                audio: Buffer.from(buffer),
                caption: "",
              });
            } else {
              await sock.sendMessage(`${loggedInNumber}@s.whatsapp.net`, {
                text: `Gagal mengunggah audio dari status audio dari *${senderName}* (${displaySenderNumber}). Media mungkin sudah kadaluarsa.`,
              });
            }
          } else {
            const messageContent = `Status teks dari *${senderName}* (${displaySenderNumber}) telah dilihat ${autoLikeStatus ? "dan disukai" : ""} dengan caption: "*${caption}*"`;
            await sock.sendMessage(`${loggedInNumber}@s.whatsapp.net`, { text: messageContent });
          }
        } else {
          const messageContent = `Status dari *${senderName}* (${displaySenderNumber}) telah dilihat ${autoLikeStatus ? "dan disukai" : ""}`;
          await sock.sendMessage(`${loggedInNumber}@s.whatsapp.net`, { text: messageContent });
        }
      } catch (e) {
        logErrorToFile(`handle status error: ${e.message} ${e.stack || ""}`);
        if (String(e).includes("closed session") || String(e).includes("Decrypted")) {
          logCuy("Abaikan closed session di status", "yellow");
        } else {
          logCuy(`Error handle status: ${e.message}`, "red");
        }
      }
    }
  });
}

connectToWhatsApp();
