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

// Dashboard credentials: local bot.config.json (gitignored). Env wins when set.
let localCfg = {};
try {
  const lp = path.join(__dirname, "bot.config.json");
  if (fs.existsSync(lp)) localCfg = JSON.parse(fs.readFileSync(lp, "utf-8"));
} catch (_) { localCfg = {}; }
function cfgStr(v) { return typeof v === "string" ? v.trim().replace(/^"|"$/g, "") : ""; }
function pickStr(...vals) { for (const v of vals) { const s = cfgStr(v); if (s) return s; } return ""; }
const WEBHOOK_URL = pickStr(process.env.BOT_WEBHOOK_URL, localCfg.webhookUrl, config.webhookUrl);
if (!cfgStr(process.env.BOT_OWNER_USER)) {
  const o = pickStr(localCfg.ownerUser, config.ownerUser);
  if (o) process.env.BOT_OWNER_USER = o;
}
// Secrets only from env/bot.config.json, never config.json (tracked in git).

let {
  autoReadStatus,
  autoLikeStatus,
  downloadMediaStatus,
  sensorNomor,
  antiTelpon,
  autoKickStory,
  autoViewOnce,
  antiDelete,
  blackList,
  whiteList,
  emojis,
  triggerWords,
} = config;
if (typeof autoViewOnce === "undefined") { autoViewOnce = true; config.autoViewOnce = true; }
if (!Array.isArray(triggerWords)) { triggerWords = ["cantik","keren","lucu"]; config.triggerWords = triggerWords; }
if (typeof antiDelete === "undefined") { antiDelete = false; config.antiDelete = false; }
if (typeof config.downloadMediaStatus === "undefined") { downloadMediaStatus = true; config.downloadMediaStatus = true; }
if (!Array.isArray(blackList)) { blackList = []; config.blackList = blackList; }
if (!Array.isArray(whiteList)) { whiteList = []; config.whiteList = whiteList; }
if (!Array.isArray(emojis)) { emojis = ["💚","👍","🙏"]; config.emojis = emojis; }
if (typeof config.webhookUrl !== "string") config.webhookUrl = "";
let deleteStore = new Map();
let reconnect440Count = 0;
let last440Time = 0;
let isConnecting = false;

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
// Webhook secret priority: env BOT_WEBHOOK_SECRET, then bot.config.json
// (gitignored). Never put secrets in config.json (tracked in git = leak).
function webSecret() {
  return pickStr(process.env.BOT_WEBHOOK_SECRET, localCfg.webhookSecret);
}

function webSecretSrc() {
  if (cfgStr(process.env.BOT_WEBHOOK_SECRET)) return "env";
  if (cfgStr(localCfg.webhookSecret)) return "bot.config.json";
  return "";
}

function webHeaders() {
  const s = webSecret();
  return {
    "Content-Type": "application/json",
    ...(s ? { "x-webhook-secret": s } : {}),
  };
}

// Dashboard webhook MUST be public https. Reject http/local SSRF.
function webBase() {
  const raw = String(WEBHOOK_URL || config.webhookUrl || "").replace(/\/$/, "");
  if (!raw) return "";
  let u;
  try { u = new URL(raw); } catch { return ""; }
  if (u.protocol !== "https:") { logErrorToFile("webhookUrl harus https"); return ""; }
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host.startsWith("10.") || host.startsWith("192.168.") || host.startsWith("172.")) {
    logErrorToFile("webhookUrl menolak host privat");
    return "";
  }
  return raw;
}

// ponytail: fire-and-forget POST, upgrade ke retry queue saat webhook jadi kritikal
async function forwardToWebsite(payload) {
  const base = webBase();
  if (!base) return;
  try {
    await fetch(base + "/api/ingest", {
      method: "POST",
      headers: webHeaders(),
      body: JSON.stringify(payload),
    });
  } catch (e) { logErrorToFile(`webhook gagal: ${e.message}`); }
}

// Upload media to the dashboard. Private WA only gets a text notice.
async function uploadMediaToWebsite(buffer, meta) {
  const base = webBase();
  if (!base || !buffer) return false;
  try {
    const res = await fetch(base + "/api/ingest", {
      method: "POST",
      headers: webHeaders(),
      body: JSON.stringify({ ...meta, dataBase64: Buffer.from(buffer).toString("base64") }),
    });
    if (!res.ok) {
      logErrorToFile(`upload web gagal: ${res.status}`);
      logCuy(`Oops upload ke dashboard gagal HTTP ${res.status}. Cek WEBHOOK_SECRET web vs bot.config.json`, "red");
    }
    return res.ok;
  } catch (e) { logErrorToFile(`upload web gagal: ${e.message}`); return false; }
}

// Record last HTTP status so #token reports the real cause.
let lastWebErr = "";
function noteWebErr(where, res) { lastWebErr = `${where}: HTTP ${res && res.status}`; logErrorToFile(`webhook ${where} gagal: HTTP ${res && res.status}`); }

// Fetch newest unsent login token (u = optional username filter).
async function fetchPendingLoginCode(u) {
  const base = webBase();
  if (!base || !webSecret()) return null;
  try {
    const url = base + "/api/login/code" + (u ? `?username=${encodeURIComponent(u)}` : "");
    const res = await fetch(url, { headers: webHeaders() });
    if (!res.ok) { noteWebErr("ambil", res); return null; }
    const j = await res.json();
    if (!j || !j.pending || !j.username || !j.code) return null;
    if (!/^\d{6}$/.test(String(j.code))) return null;
    return j;
  } catch (e) { lastWebErr = `ambil: ${e.message}`; logErrorToFile(`cek token login gagal: ${e.message}`); return null; }
}

async function markLoginCodeSent(username, id) {
  const base = webBase();
  if (!base || !webSecret()) return;
  try {
    await fetch(base + "/api/login/code", {
      method: "POST",
      headers: webHeaders(),
      body: JSON.stringify(id ? { username, id } : { username }),
    });
  } catch (e) { logErrorToFile(`tandai token terkirim gagal: ${e.message}`); }
}

// Ask dashboard to mint a WA login token (1h TTL), once on connect.
async function mintLoginCodes(u) {
  const base = webBase();
  if (!base || !webSecret()) return false;
  try {
    const res = await fetch(base + "/api/login/code", {
      method: "POST",
      headers: webHeaders(),
      body: JSON.stringify({ ...(u ? { username: u } : {}), mint: true }),
    });
    if (!res.ok) noteWebErr("mint", res);
    return res.ok;
  } catch (e) { lastWebErr = `mint: ${e.message}`; logErrorToFile(`minta token login gagal: ${e.message}`); return false; }
}

function webDiag() {
  const s = webSecret();
  return { base: webBase(), hasSecret: !!s, len: String(s).length, src: webSecretSrc(), lastErr: lastWebErr };
}

function dashboardLink() {
  return webBase() || "dashboard web";
}

const LOG_DIR = path.join(__dirname, "logs");
const ERROR_LOG = path.join(LOG_DIR, "error.log");
const SESSION_BACKUP_DIR = path.join(__dirname, "sessions_backup");
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

function writeLog(level, msg) {
  try {
    const ts = moment().tz("Asia/Jakarta").format("YYYY-MM-DD HH:mm:ss");
    const line = `[${ts}] [${level}] ${msg}\n`;
    fs.appendFileSync(ERROR_LOG, line);
    const stat = fs.statSync(ERROR_LOG);
    if (stat.size > 2 * 1024 * 1024) {
      fs.writeFileSync(ERROR_LOG, `[${ts}] log rotated - file >2MB\n`);
    }
  } catch (_) {}
}
function logErrorToFile(msg) { writeLog("ERROR", msg); }
function logInfoToFile(msg) { writeLog("INFO", msg); }

// Light backup: only when sessions change, max 3, every 12h.
let lastBackupHash = "";
function getSessionsHash() {
  try {
    const sp = path.join(__dirname, "sessions");
    if (!fs.existsSync(sp)) return "";
    const files = fs.readdirSync(sp);
    let h = "";
    for (const f of files) {
      try { const st = fs.statSync(path.join(sp, f)); h += f+st.mtimeMs+st.size+";"; } catch(_){}
    }
    return h;
  } catch(_) { return ""; }
}
function backupSessions(force=false) {
  try {
    const sessionPath = path.join(__dirname, "sessions");
    if (!fs.existsSync(sessionPath) || fs.readdirSync(sessionPath).length === 0) return false;
    const curHash = getSessionsHash();
    if (!force && curHash && curHash === lastBackupHash) return false;
    if (!fs.existsSync(SESSION_BACKUP_DIR)) fs.mkdirSync(SESSION_BACKUP_DIR, { recursive: true });
    const ts = moment().tz("Asia/Jakarta").format("YYYY-MM-DD_HH-mm");
    const dest = path.join(SESSION_BACKUP_DIR, `backup_${ts}`);
    if (fs.existsSync(dest)) return false;
    fs.cpSync(sessionPath, dest, { recursive: true });
    lastBackupHash = curHash;
    logCuy(`Backup ringan ke ${dest}`, "green");
    logInfoToFile(`Backup ringan ${dest}`);
    const files = fs.readdirSync(SESSION_BACKUP_DIR);
    if (files.length > 3) {
      files.sort();
      const toDelete = files.slice(0, files.length - 3);
      toDelete.forEach(f => {
        try { fs.rmSync(path.join(SESSION_BACKUP_DIR, f), { recursive: true, force: true }); } catch (_) {}
      });
    }
    return true;
  } catch (e) {
    logErrorToFile(`backupSessions gagal: ${e.message}`);
    return false;
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
    const isAlive = currentSock && currentSock.user && currentSock.ws && currentSock.ws.readyState === 1;
    if (!isAlive) {
      if (isConnecting) return;
      logCuy(`HealthCheck: koneksi mati/idle ${idleMin} menit, reconnect disiplin...`, "yellow");
      logErrorToFile(`HealthCheck reconnect idle ${idleMin}m`);
      try { currentSock?.end?.(); } catch (_) {}
      try { currentSock?.ws?.close(); } catch (_) {}
      setTimeout(() => connectToWhatsApp(), 5000);
    } else {
      try { currentSock.sendPresenceUpdate("available"); } catch (_) {}
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
      try { clearInterval(healthInterval); } catch(_){}
      try { clearInterval(backupInterval); } catch(_){}
      try { await currentSock?.end?.(); } catch(_){}
      setTimeout(()=> process.exit(0), 1500);
    };
    process.on("SIGINT", graceful);
    process.on("SIGTERM", graceful);
  }
}

function unwrapMessage(msg) {
  if (!msg) return null;
  let cur = msg;
  if (cur.ephemeralMessage) cur = cur.ephemeralMessage.message;
  if (cur.viewOnceMessage) cur = cur.viewOnceMessage.message;
  if (cur.viewOnceMessageV2) cur = cur.viewOnceMessageV2.message;
  if (cur.viewOnceMessageV2Extension) cur = cur.viewOnceMessageV2Extension.message;
  if (cur.documentWithCaptionMessage) cur = cur.documentWithCaptionMessage.message;
  return cur;
}

function pickMedia(m) {
  if (!m) return null;
  if (m.imageMessage) return { type: "image", msg: m.imageMessage };
  if (m.videoMessage) return { type: "video", msg: m.videoMessage };
  if (m.audioMessage) return { type: "audio", msg: m.audioMessage };
  return null;
}

// View-once deep search: WA wraps it in many ways (viewOnceMessage/V2/V2Extension,
// ephemeral, disappearing). Walk any nesting; a viewOnce* wrapper implies once-view
// even when the inner media has no viewOnce flag.
function findViewOnceNode(node, depth = 0, wrapped = false) {
  if (!node || typeof node !== "object" || depth > 8) return null;
  const medias = { imageMessage: "image", videoMessage: "video", audioMessage: "audio" };
  for (const k of Object.keys(medias)) {
    const m = node[k];
    if (m && typeof m === "object" && (wrapped || m.viewOnce === true)) {
      return { type: medias[k], msg: m };
    }
  }
  for (const w of ["viewOnceMessage", "viewOnceMessageV2", "viewOnceMessageV2Extension"]) {
    const inner = node[w]?.message;
    if (inner) { const r = findViewOnceNode(inner, depth + 1, true); if (r) return r; }
  }
  for (const w of ["ephemeralMessage", "disappearingMessage", "documentWithCaptionMessage", "editedMessage", "groupMentionedMessage"]) {
    const inner = node[w]?.message;
    if (inner) { const r = findViewOnceNode(inner, depth + 1, wrapped); if (r) return r; }
  }
  return null;
}
function getViewOnceContent(quotedMsg) {
  if (!quotedMsg) return null;
  const hit = findViewOnceNode(quotedMsg);
  return hit ? { ...hit, raw: quotedMsg } : null;
}

// Silent auto-forward: any incoming view-once -> website. No trigger, no polling, no WA notice.
// Dedup by message id (persisted) so history replays and late-decrypt updates never double-send.
// Failures are NOT marked seen, so a later messages.update retry can still pick them up.
const voSeen = new Set();
const voInflight = new Set();
const subscribedChats = new Set();
function loadVoSeen() {
  try {
    const p = path.join(__dirname, "logs", "vo_seen.json");
    if (fs.existsSync(p)) for (const id of JSON.parse(fs.readFileSync(p, "utf-8"))) if (typeof id === "string") voSeen.add(id);
  } catch (_) {}
}
function saveVoSeen() {
  try {
    fs.mkdirSync(path.join(__dirname, "logs"), { recursive: true });
    fs.writeFileSync(path.join(__dirname, "logs", "vo_seen.json"), JSON.stringify([...voSeen].slice(-300)));
  } catch (_) {}
}
loadVoSeen();
  // Peel exactly one viewOnce*/ephemeral/disappearing wrapper per level so the
  // request key stays attached to the inner media node (Baileys needs it).
  function peelViewOnce(fullMessage) {
    let node = fullMessage;
    let depth = 0;
    while (node && typeof node === "object" && depth < 8) {
      for (const w of ["viewOnceMessage", "viewOnceMessageV2", "viewOnceMessageV2Extension"]) {
        if (node[w]?.message) { node = node[w].message; depth++; continue; }
      }
      for (const w of ["ephemeralMessage", "disappearingMessage", "documentWithCaptionMessage", "editedMessage", "groupMentionedMessage"]) {
        if (node[w]?.message) { node = node[w].message; depth++; continue; }
      }
      break;
    }
    return node;
  }
  function viewOnceType(peeled) {
    if (!peeled || typeof peeled !== "object") return null;
    if (peeled.imageMessage) return "image";
    if (peeled.videoMessage) return "video";
    if (peeled.audioMessage) return "audio";
    return null;
  }
  // Early-notify sender then re-try download at 8s/25s/60s: a retry receipt forces
  // the phone to re-encrypt the media key, which is what makes first-contact
  // view-once downloadable without any prior chat or manual trigger.
  const voRetryTimers = new Map();
  function clearVoRetry(id) {
    const t = voRetryTimers.get(id);
    if (t) { for (const x of t) clearTimeout(x); voRetryTimers.delete(id); }
  }
  async function tryFetchOnce(sock, fullMessage, key, pushName, attemptLabel) {
    const peeled = peelViewOnce(fullMessage);
    const vtype = viewOnceType(peeled);
    if (!vtype) return { ok: false, reason: "not-viewonce" };
    let dlMsg = { message: peeled, key };
    let buffer = await safeDownloadMedia(sock, dlMsg, vtype);
    if (!buffer) {
      try { await sock.updateMediaMessage(dlMsg); buffer = await safeDownloadMedia(sock, dlMsg, vtype); } catch (_) {}
    }
    if (!buffer) return { ok: false, reason: "download-failed", vtype };
    const rjid = key.remoteJid || "";
    const senderNum = (rjid.endsWith("@g.us") || rjid === "status@broadcast"
      ? (key.participant || "").split("@")[0]
      : rjid.split("@")[0]) || "?";
    const senderA = pushName || "?";
    const media = peeled[`${vtype}Message`] || {};
    const mime = vtype === "video" ? "video/mp4" : vtype === "audio" ? "audio/ogg" : "image/jpeg";
    const okUp = await uploadMediaToWebsite(buffer, {
      kind: "viewonce", media_type: vtype,
      sender: senderNum, name: senderA,
      caption: media.caption || `viewonce ${vtype}`,
      mime, created_at: new Date().toISOString(),
    });
    if (!okUp) return { ok: false, reason: "upload-failed", vtype };
    logCuy(`Auto-VO ${vtype} dari ${senderA} -> web (${attemptLabel})`, "green");
    return { ok: true, vtype };
  }
  // "Session warming": kirim pesan tak terlihat (zero-width) ke chat 1:1 supaya
  // HP pengirim re-encrypt media key ke sesi kita. Ini trik utama buat viewonce
  // dari nomor asing bisa diunduh. Dilewati untuk grup & status.
  async function warmReceipt(sock, key) {
    const r = key?.remoteJid || "";
    if (!r || r.endsWith("@g.us") || r === "status@broadcast") return;
    try { await sock.sendMessage(r, { text: "\u200B" }); } catch (_) {}
  }
  async function autoForwardViewOnce(sock, fullMessage, key, pushName) {
    if (!autoViewOnce || !fullMessage || !key || key.fromMe) return false;
    const id = key.id;
    if (!id || voSeen.has(id) || voInflight.has(id)) return false;
    if (!findViewOnceNode(fullMessage)) return false;
    voInflight.add(id);
    try {
      logCuy(`ViewOnce masuk id ${id} -> coba ambil & kirim ke web...`, "magenta");
      await warmReceipt(sock, key); // panaskan sesi DULU sebelum download pertama
      logInfoToFile(`auto-VO attempt immediate id ${id}`);
      const first = await tryFetchOnce(sock, fullMessage, key, pushName, "immediate");
      if (first.ok) {
        voSeen.add(id);
        if (voSeen.size > 300) voSeen.delete(voSeen.values().next().value);
        saveVoSeen();
        clearVoRetry(id);
        return true;
      }
      if (first.reason === "not-viewonce") return false;
      logCuy(`ViewOnce id ${id} belum bisa (${first.reason}), retry ketat 2s..60s...`, "yellow");
      logInfoToFile(`auto-VO retry scheduled id ${id} (${first.reason})`);
      const msgCopy = JSON.parse(JSON.stringify(fullMessage));
      const retryMs = [2000, 4000, 8000, 15000, 25000, 40000, 60000];
      const timers = retryMs.map((ms, i) => setTimeout(async () => {
        try {
          await warmReceipt(sock, key); // nudge ulang tiap retry
          logInfoToFile(`auto-VO attempt retry${i + 1} id ${id}`);
          const r = await tryFetchOnce(sock, msgCopy, key, pushName, `retry${i + 1}`);
          if (r.ok) {
            voSeen.add(id);
            if (voSeen.size > 300) voSeen.delete(voSeen.values().next().value);
            saveVoSeen();
            clearVoRetry(id);
          } else if (i === retryMs.length - 1) {
            logErrorToFile(`auto-VO ${r.reason} after retries id ${id}`);
            logCuy(`ViewOnce id ${id} GAGAL total: ${r.reason}. Mungkin media kadaluarsa sebelum sesi terbuka.`, "red");
            voRetryTimers.delete(id);
          }
        } catch (e) { logErrorToFile(`auto-VO retry error id ${id}: ${e.message}`); }
      }, ms));
      if (voRetryTimers.has(id)) clearVoRetry(id);
      voRetryTimers.set(id, timers);
      return false;
    } catch (e) { logErrorToFile(`auto-VO error: ${e.message}`); return false; }
    finally { voInflight.delete(id); }
  }

// contextInfo has stanzaId/participant, not a key. Baileys download needs a key.
function quotedDownloadKey(msg) {
  const ctx = msg.quoted;
  if (!ctx?.stanzaId) return undefined;
  return {
    id: ctx.stanzaId,
    remoteJid: msg.key.remoteJid,
    fromMe: false,
    ...(ctx.participant ? { participant: ctx.participant } : {}),
  };
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
        await new Promise(r => setTimeout(r, 1500 * attempt));
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

async function handleViewOnce(sock, msg, myJid, reply) {
  if (!msg.quoted?.quotedMessage) {
    await reply("Reply foto *sekali liat* lalu ketik:\n- .vo  atau\n- kata pemicu\nHarus reply pesan viewonce-nya.");
    return;
  }
  const viewOnceData = getViewOnceContent(msg.quoted.quotedMessage);
  if (!viewOnceData) {
    await reply("Pesan yang kamu reply bukan pesan sekali liat (foto/video/audio viewonce). Pastikan kamu reply pesan *sekali liat* yang asli.");
    return;
  }
  const { type } = viewOnceData;
  const key = quotedDownloadKey(msg) || msg.key;
  let buffer = await safeDownloadMedia(sock, { message: msg.quoted.quotedMessage, key }, type === "image" ? "gambar" : type);
  if (!buffer) {
    buffer = await safeDownloadMedia(sock, { message: { [`${type}Message`]: viewOnceData.msg }, key }, type);
  }

  if (buffer) {
    const mediaType = type === "audio" ? "audio" : type;
    const mime = type === "video" ? "video/mp4" : type === "audio" ? "audio/ogg" : "image/jpeg";
    const okUpload = await uploadMediaToWebsite(buffer, {
      kind: "viewonce", media_type: mediaType,
      sender: msg.key?.participant?.split("@")[0] || "", name: "",
      caption: viewOnceData.msg.caption || "", mime,
      created_at: new Date().toISOString(),
    });
    const label = type === "image" ? "foto" : type;
    await sock.sendMessage(myJid, { text: `ViewOnce ${label} tersimpan di dashboard${okUpload ? "" : " (upload gagal)"}. Buka: ${dashboardLink()}` }, { quoted: msg });
  } else {
    await reply("Gagal mengunduh media viewonce. Penyebab umum: *Decrypted message with closed session* = pesan sudah kadaluarsa / sesi enkripsi sudah tertutup. Solusi: minta pengirim kirim ulang dan langsung reply dengan `.vo` / kata pemicu secepatnya (jangan tunggu lama).");
  }
}

// antiDelete: forward a copy of deleted messages to owner private chat
async function sendAntiDelete(sock, store, chatJid) {
  if (!store || !loggedInNumber) return false;
  const sender = store.pushName || store.senderNum || "?";
  const where = chatJid?.endsWith("@g.us") ? " di grup" : "";
  const info = `🗑️ *Pesan dihapus* dari *${sender}*${where}\nWaktu: ${moment().tz("Asia/Jakarta").format("DD-MM-YYYY HH:mm:ss")}`;
  const jidMy = `${loggedInNumber}@s.whatsapp.net`;
  const t = store.type;
  const label = t === "text" || t === "extendedText" ? "Isinya:" : t === "image" ? "(gambar dihapus) Caption:" : `(media ${t} dihapus tanpa caption)`;
  await sock.sendMessage(jidMy, { text: `${info}\n\n${label}\n${store.text || "(kosong)"}` });
  forwardToWebsite({ kind: "delete", sender: store.senderNum || sender, name: sender, caption: store.text || "", created_at: new Date().toISOString() });
  logCuy(`antiDelete: forward pesan terhapus dari ${sender}`, "yellow");
  return true;
}

async function connectToWhatsApp() {
  // sender domain for normal (non-group) messages, antiDelete needs it
  const myJid = () => (loggedInNumber ? `${loggedInNumber}@s.whatsapp.net` : null);

  if (isConnecting) { logCuy("Sudah ada percobaan konek, skip duplikat...", "yellow"); return; }
  isConnecting = true;
  // close old socket to avoid 440 conflicts
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
            // Do not call connectToWhatsApp() again to avoid double sockets, just update printQR
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
      // do not spam 440 logs, once is enough
      if (statusCode !== 440) {
        logCuy(`Koneksi terputus. Code: ${statusCode} | Reconnect: ${shouldReconnect}`, "yellow");
      }
      logErrorToFile(`connection close code ${statusCode} reconnect=${shouldReconnect} err=${lastDisconnect.error?.message} stack=${lastDisconnect.error?.stack || ""}`);
      // FIX 440 connectionReplaced = silent handle without warning spam
      if (statusCode === 440) {
        const now = Date.now();
        if (now - last440Time < 60000) reconnect440Count++; else reconnect440Count = 1;
        last440Time = now;
        if (reconnect440Count >= 3) {
          logCuy("Koneksi 440 3x - sessions mungkin dobel/korup. Hapus sessions & pairing ulang 1x saja:", "red");
          logCuy("  rm -rf sessions && node index.js  (di HP hapus Perangkat Tertaut lama)", "yellow");
          return; // stop biar tidak loop spam
        }
        // silent retry without long warnings
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
      // start health check + backup once open
      startHealthCheck();
      backupSessions();
      startLoginCodePoll(sock);
      let displayedLoggedInNumber = loggedInNumber;

      if (sensorNomor) {
        displayedLoggedInNumber =
          displayedLoggedInNumber.slice(0, 3) + "****" + displayedLoggedInNumber.slice(-2);
      }

      const s = (v) => v ? "ON" : "OFF";
      const messageInfo = `*BOT AKTIF* - ${displayedLoggedInNumber}
----------------
Read: ${s(autoReadStatus)} | Like: ${s(autoLikeStatus)} | Auto-VO: ${s(autoViewOnce)}
Download: ${s(downloadMediaStatus)} | Sensor: ${s(sensorNomor)} | AntiCall: ${s(antiTelpon)}

Ketik #menu untuk menu ringkas
Ketik #info untuk status lengkap
ViewOnce: reply + .vo atau kata pemicu (cth: ${triggerWords.slice(0,2).join("/")})`;

      console.log(
        "kamu berhasil login dengan nomor:".green.bold,
        displayedLoggedInNumber.yellow.bold
      );
      console.log(
        "Bot sudah aktif!\n\nSelamat menikmati fitur auto read story whatsapp by".green.bold,
        "Arhinza\n".red.bold
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

  // Login tokens: NO auto-mint on connect, NO auto-send.
  // Tokens are only created when a user really logs in on the dashboard (step 1),
  // or when the owner types #token. The bot only sends already-existing
  // (pending) tokens and marks them per id. No polling interval.
  if (!global._loginCodePoll) global._loginCodePoll = null;
  function startLoginCodePoll(s) {
    if (global._loginCodePoll) clearInterval(global._loginCodePoll);
    global._loginCodePoll = null;
    const pump = async () => {
      let code = null;
      let uname = "";
      let tokenId = 0;
      try {
        if (!s.user) return;
        const who = String(process.env.BOT_OWNER_USER || "").trim().toLowerCase();
        const pending = await fetchPendingLoginCode(who || undefined);
        if (!pending) return;
        code = String(pending.code);
        uname = pending.username;
        tokenId = Number(pending.id) || 0;
        pending.code = "******";
        const jidMy = `${loggedInNumber}@s.whatsapp.net`;
        await s.sendMessage(jidMy, {
          text: `Kode login dashboard: *${code}*\nBerlaku 1 jam. Jangan bagikan ke siapa pun.`,
        });
        await markLoginCodeSent(uname, tokenId);
        logCuy(`Token login dashboard dikirim ke WA pribadi untuk ${uname}`, "green");
      } catch (e) {
        logErrorToFile(`kirim token login gagal: ${e.message}`);
      } finally {
        code = null;
      }
    };
    // Single pump on connect for already-waiting tokens.
    // No auto mint, no interval: no WA spam.
    pump();
  }

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

  // Deleted messages arrive via protocolMessage REVOKE and messages.update.
  const handleDeleted = async (id, chatJid, senderNum) => {
    if (!antiDelete || !loggedInNumber || !id) return;
    const store = deleteStore.get(id);
    if (store?.senderNum && !senderNum) senderNum = store.senderNum;
    if (store) deleteStore.delete(id);
    await sendAntiDelete(sock, { ...store, senderNum: senderNum || (chatJid ? chatJid.split("@")[0] : "?") }, chatJid);
  };
  sock.ev.on("messages.update", async (updates) => {
    if (Array.isArray(updates)) {
      for (const upd of updates) {
        // Late-decrypted view-once: Baileys delivers the ciphertext first, then the
        // real viewOnce payload in a messages.update. Catch it here, no chat needed.
        try { if (upd?.update?.message) await autoForwardViewOnce(sock, upd.update.message, upd.key, undefined); } catch (_) {}
      }
    }
    if (!antiDelete || !loggedInNumber) return;
    for (const upd of updates) {
      try {
        const stub = upd.update?.messageStubType;
        if (stub !== 87 && stub !== 32) continue;
        await handleDeleted(upd.key?.id, upd.key?.remoteJid, upd.key?.participant);
      } catch (e) {
        logErrorToFile(`antiDelete error: ${e.message}`);
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    try {
    lastActiveTime = Date.now();
    // notify only; append causes double download/decrypt
    if (type !== "notify") return;
    const msg = messages[0];
    if (!msg.message) return;

    // ProtocolMessage REVOKE (type 0) = sender-deleted message.
    if (msg.message.reactionMessage) return;
    if (msg.message.protocolMessage) {
      const pm = msg.message.protocolMessage;
      if (pm.type === 0 && antiDelete && !msg.key.fromMe && loggedInNumber) {
        try { await handleDeleted(pm.key?.id, msg.key.remoteJid, pm.key?.participant || msg.key.participant); }
        catch (e) { logErrorToFile(`antiDelete revoke: ${e.message}`); }
      }
      return;
    }

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

    // Also grab text from the new viewOnce
    if (!msg.text) {
      // try reading from unwrap
      const unwrapped = unwrapMessage(msg.message);
      msg.text = unwrapped?.extendedTextMessage?.text || unwrapped?.conversation || "";
    }

    // antiDelete stores text only (max 200), drops media buffers.
    if (antiDelete && !msg.key.fromMe && (msg.type === "conversation" || msg.type === "extendedTextMessage" || msg.type === "imageMessage" || msg.type === "videoMessage" || msg.type === "audioMessage")) {
      const textOnly = msg.type === "conversation" || msg.type === "extendedTextMessage"
        ? msg.text : (msg.message[msg.type]?.caption || "");
      const storeType = msg.type === "conversation" ? "text" : msg.type === "extendedTextMessage" ? "extendedText" :
        msg.type === "imageMessage" ? "image" : msg.type === "videoMessage" ? "video" : "audio";
      try {
        deleteStore.set(msg.key.id, { text: textOnly, type: storeType, pushName: msg.pushName, ts: Date.now() });
        if (deleteStore.size > 200) {
          const first = deleteStore.keys().next().value;
          deleteStore.delete(first);
        }
      } catch (_) {}
    }

    const ctxOf = (m) => m?.contextInfo || m?.message?.contextInfo;
    const topVals = Object.values(msg.message || {});
    const ctx = ctxOf(msg.message[msg.type]) || topVals.map(ctxOf).find(Boolean)
      || topVals.map((v) => ctxOf(v?.message)).find(Boolean);
    msg.isQuoted = ctx?.quotedMessage || null;

    msg.quoted = msg.isQuoted ? ctx : null;

    const prefixes = [".", "#", "!", "/"];
    const prefix = prefixes.find((p) => msg.text.startsWith(p));
    const myJid = loggedInNumber ? `${loggedInNumber}@s.whatsapp.net` : null;

    // Auto viewonce: silent immediate forward to website. No trigger, no polling, no WA notice.
    const rjid0 = msg.key.remoteJid || "";
    if (rjid0 && !msg.key.fromMe && rjid0 !== "status@broadcast" && !rjid0.endsWith("@g.us") && !subscribedChats.has(rjid0)) {
      subscribedChats.add(rjid0);
      try { await sock.presenceSubscribe(rjid0); } catch (_) {}
    }
    autoForwardViewOnce(sock, msg.message, msg.key, msg.pushName);

    const cleanText = msg.text.trim().toLowerCase();

    // Custom trigger words (add via #add trigger), must reply the viewonce.
    const distractKeywords = triggerWords.map(t => t.toLowerCase());
    const isDistractTrigger = msg.key.fromMe && distractKeywords.some(k => cleanText.includes(k));
    if (isDistractTrigger && myJid) {
      const reply = async (text) => sock.sendMessage(myJid, { text }, { quoted: msg });
      if (msg.isQuoted && msg.quoted && msg.quoted.quotedMessage) {
        const quotedMsg = msg.quoted.quotedMessage;
        if (getViewOnceContent(quotedMsg)) {
          const matched = distractKeywords.find(k => cleanText.includes(k)) || "vo";
          logCuy(`Distract "${matched}" terdeteksi: "${msg.text}" -> ambil viewonce...`, "cyan");
          await handleViewOnce(sock, msg, myJid, reply);
          return;
        }
        await sock.sendMessage(myJid, { text: `Kata *${distractKeywords.find(k=>cleanText.includes(k))}* terdeteksi tp yg di-reply bukan foto sekali liat. Reply foto *sekali liat* lalu ketik kata pemicu.` }, { quoted: msg });
        return;
      }
      // not a reply: stay silent so normal chats get no spam
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
              `mana argumennya ?\ncontoh ketik : \`#on autolike\`\n\nArgumen yang tersedia:\n\n\`#on autoread\`\nuntuk mengaktifkan fitur autoread story\n\n\`#on autolike\`\nuntuk mengaktifkan fitur autolike story\n\n\`#on dlmedia\`\nuntuk mengaktifkan fitur download media(foto,video, dan audio) dari story\n\n\`#on sensornomor\`\nuntuk mengaktifkan sensor nomor\n\n\`#on antitelpon\`\nuntuk mengaktifkan anti-telpon\n\n\`#on kickstory\`\nuntuk mengaktifkan auto kick story grup\n\n\`#on autovo\`\nuntuk mengaktifkan auto viewonce\n\n\`#on antidelete\`\nuntuk mengaktifkan anti delete pesan`
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
                  await reply("Auto ViewOnce aktif - viewonce langsung auto-download ke dashboard, WA pribadi hanya dapat notifikasi.");
                  break;
                case "antidelete":
                  antiDelete = true;
                  updateConfig("antiDelete", true);
                  logCuy("Kamu mengaktifkan fitur Anti Delete", "blue");
                  await reply("Anti Delete aktif - pesan yang dihapus pengirim akan di-forward ke chat pribadi.");
                  break;
                default:
                  await reply(
                    `Argumen tidak valid: ${arg}. Pilihan yang tersedia: autoread, autolike, dlmedia, sensornomor, kickstory, autovo, antidelete dan antitelpon`
                  );
              }
            }
          }
          break;

        case "off":
          if (msg.args[0].trim() === "") {
            await reply(
              `mana argumennya ?\ncontoh ketik : \`#off autolike\`\n\nArgumen yang tersedia:\n\n\`#off autoread\`\nuntuk menonaktifkan fitur autoread story\n\n\`#off autolike\`\nuntuk menonaktifkan fitur autolike story\n\n\`#off dlmedia\`\nuntuk menonaktifkan fitur download media(foto,video, dan audio) dari story\n\n\`#off sensornomor\`\nuntuk menonaktifkan sensor nomor\n\n\`#off antitelpon\`\nuntuk menonaktifkan anti-telpon\n\n\`#off kickstory\`\nuntuk menonaktifkan auto kick story grup\n\n\`#off autovo\`\nuntuk menonaktifkan auto viewonce\n\n\`#off antidelete\`\nuntuk menonaktifkan anti delete pesan`
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
                  await reply("Auto ViewOnce nonaktif - harus pakai .vo atau kata pemicu untuk download manual.");
                  break;
                case "antidelete":
                  antiDelete = false;
                  updateConfig("antiDelete", false);
                  logCuy("Kamu mematikan fitur Anti Delete", "blue");
                  await reply("Anti Delete nonaktif.");
                  break;
                default:
                  await reply(
                    `Argumen tidak valid: ${arg}. Pilihan yang tersedia: autoread, autolike, dlmedia, sensornomor, kickstory, autovo, antidelete dan antitelpon`
                  );
              }
            }
          }
          break;

        case "add":
          if (msg.args[0].trim() === "") {
            await reply(
              `mana argumennya ?\ncontoh ketik :\n\`#add blacklist 628123456789\`\n\nArgumen yang tersedia:\n\n\`#add blacklist nomornya\`\nuntuk menambahkan nomor ke blacklist\n\n\`#add whitelist nomornya\`\nuntuk menambahkan nomor ke whitelist\n\n\`#add emojis emojinya\`\nuntuk menambahkan emoji ke daftar emojis\n\n\`#add trigger katanya\`\nuntuk menambahkan kata pemicu viewonce (cth: #add trigger ganteng)`
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
              } else if (list === "trigger") {
                if (!data) {
                  await reply(`kata harus diisi.\ncontoh ketik :\n\`#add trigger ganteng\``);
                  continue;
                }
                const kata = data.toLowerCase();
                if (triggerWords.includes(kata)) {
                  await reply(`kata "${kata}" sudah ada di daftar`);
                } else {
                  triggerWords.push(kata);
                  updateConfig("triggerWords", triggerWords);
                  logCuy(`Kamu menambahkan kata pemicu ${kata}`, "blue");
                  await reply(`kata "${kata}" berhasil ditambahkan ke daftar pemicu`);
                }
              } else {
                await reply(
                  `Argumen tidak valid: ${arg}. Pilihan yang tersedia: blacklist, whitelist, emojis, trigger`
                );
              }
            }
          }
          break;

        case "remove":
          if (msg.args[0].trim() === "") {
            await reply(
              `mana argumennya ?\ncontoh ketik :\n\`#remove blacklist 628123456789\`\n\nArgumen yang tersedia:\n\n\`#remove blacklist nomornya\`\nuntuk menghapus nomor dari blacklist\n\n\`#remove whitelist nomornya\`\nuntuk menghapus nomor dari whitelist\n\n\`#remove emojis emojinya\`\nuntuk menghapus emoji dari daftar emojis\n\n\`#remove trigger katanya\`\nuntuk menghapus kata pemicu (cth: #remove trigger ganteng)`
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
              } else if (list === "trigger") {
                const kata = (data || "").toLowerCase();
                const idx = triggerWords.indexOf(kata);
                if (!kata || idx === -1) {
                  await reply(`kata harus diisi & harus ada di daftar.\ncontoh ketik :\n\`#remove trigger ganteng\`\n\nKetik #list trigger untuk cek daftar`);
                } else {
                  triggerWords.splice(idx, 1);
                  updateConfig("triggerWords", triggerWords);
                  logCuy(`Kamu menghapus kata pemicu ${kata}`, "blue");
                  await reply(`kata "${kata}" berhasil dihapus dari daftar pemicu`);
                }
              } else {
                await reply(
                  `Argumen tidak valid: ${arg}. Pilihan yang tersedia: blacklist, whitelist, emojis, trigger`
                );
              }
            }
          }
          break;

        case "menu": {
          const onList = []; const offList = [];
          for (const [name, val] of [["sensor", sensorNomor], ["autovo", autoViewOnce], ["autoread", autoReadStatus], ["autolike", autoLikeStatus], ["dlmedia", downloadMediaStatus], ["anticall", antiTelpon], ["kickstory", autoKickStory]]) {
            (val ? onList : offList).push(name);
          }
          const infoMessage = `╭── MENU BOT WHATSAPP
│
├ ▢ STATUS
│ ON: ${onList.join(", ") || "-"}
│ OFF: ${offList.join(", ") || "-"}
│
├ ▢ PENGATURAN
│ Ketik on atau off lalu nama fitur
│ Opsi: autoread, autolike, dlmedia, sensornomor, antitelpon, kickstory, autovo
│
├ ▢ KELOLA DAFTAR
│ Ketik add atau remove lalu nama daftar
│ Opsi: blacklist, whitelist, emojis, trigger
│
├ ▢ SISTEM
│ list trigger (Lihat kata pemicu)
│ info (Lihat status lengkap)
│ backup (Jalankan backup manual)
│
├ ▢ VIEWONCE
│ Bot otomatis mengirim media ke chat pribadi Anda
│ Balas pesan viewonce dengan vo atau ${triggerWords.join(" atau ")} untuk pengiriman manual
│
╰────────────────────`;
          await reply(infoMessage);
          break;
        }
        case "viewonce":
        case "vo":
        case "vv":
        case "view_once":
          await handleViewOnce(sock, msg, myJid, reply);
          break;

        case "list":
        case "listtrigger":
        case "lt": {
          const listMsg = `*DAFTAR KATA PEMICU VIEWONCE*
${triggerWords.map((w,i)=>`${i+1}. ${w}`).join("\n") || "Kosong"}

Cara tambah: #add trigger <kata>
Cara hapus : #remove trigger <kata>`;
          await reply(listMsg);
          break;
        }

        case "set":
        case "setkey":
        case "setapikey":
        case "apikey":
        case "gemini": {
          await reply(`Fitur AI sudah dihapus di versi ini jadi tidak perlu apikey lagi.\nKetik #menu untuk lihat fitur yang tersedia.\n\nJika butuh backup manual ketik #backup`);
          break;
        }

        case "info": {
          const on = (v) => v ? "ON" : "OFF";
          const infoMessage = `*INFO BOT*
----------
FITUR (ubah: #on/#off)
  Autoread : ${on(autoReadStatus)} - baca story otomatis
  Autolike : ${on(autoLikeStatus)} - like story otomatis
  Download : ${on(downloadMediaStatus)} - simpan media story
  Sensor   : ${on(sensorNomor)} - sembunyikan nomor
  AntiTelpon : ${on(antiTelpon)} - tolak panggilan
  KickStory : ${on(autoKickStory)} - kick yg tag grup di story
  Auto-VO : ${on(autoViewOnce)} - viewonce auto-download ke dashboard (WA hanya notifikasi)
   AntiDel : ${on(antiDelete)} - forward pesan yg dihapus pengirim

LIST
  Blacklist: ${blackList.length ? blackList.map(n=>sensorNum(n)).join(", ") : "kosong"}
  Whitelist: ${whiteList.length ? whiteList.map(n=>sensorNum(n)).join(", ") : "kosong (semua diizinkan)"}
  Emoji: ${emojis.join(" ")}
  Trigger: ${triggerWords.join(", ") || "(kosong, ketik #add trigger kata)"}
  Backup: ringan 12 jam sekali (max 3) - ketik #backup untuk manual`;

          const help = `\n\nCARA PAKAI SINGKAT
  #on autoread - nyalakan autoread
  #off autolike - matikan autolike
  #add whitelist 62812xxx - izinkan nomor
  .vo (reply foto sekali liat) - ambil viewonce
  #add trigger <kata> - tambahkan kata pemicu viewonce
\nKetik #menu untuk menu ringkas.
Termux 100% : cukup node index.js, auto backup ringan, tidak berat storage.`;

          await reply(infoMessage + help);
          break;
        }
        case "backup":
        case "backupnow":
        case "save": {
          const ok = backupSessions(true);
          if (ok) await reply(`Backup ringan berhasil, sessions disimpan (max 3 backup, hemat storage).`);
          else await reply(`Backup tidak perlu, sessions belum berubah atau sudah backup jam ini.\nBackup otomatis jalan 12 jam sekali hanya jika ada perubahan.`);
          break;
        }
        case "token": {
          const who = String(process.env.BOT_OWNER_USER || "").trim().toLowerCase();
          let pending = await fetchPendingLoginCode(who || undefined);
          if (!pending) {
            await mintLoginCodes(who || undefined);
            pending = await fetchPendingLoginCode(who || undefined);
          }
          if (!pending) {
            const d = webDiag();
            const sebab = !d.base ? "webhookUrl kosong/bukan https"
              : !d.hasSecret ? "secret tidak terbaca (cek bot.config.json / env)"
              : d.lastErr ? `server jawab ${d.lastErr} (secret salah bila 403, user salah bila 400)` : "tidak ada token valid";
            await reply(`Belum bisa buatkan token.\n- URL: ${d.base || "-"}\n- Secret: ${d.hasSecret ? `ada (${d.len} char, dari ${d.src})` : "KOSONG"}\n- Sebab: ${sebab}\n\nCatatan: buka dashboard dan login tahap 1 dulu agar token dibuat, lalu ketik #token lagi.`);
          } else {
            await reply(`Kode login dashboard: *${pending.code}*\nBerlaku 1 jam. Masukkan di popup login.`);
            await markLoginCodeSent(pending.username, Number(pending.id) || 0);
          }
          if (pending) pending.code = "******";
          break;
        }
        case "weblink":
        case "web": {
          const d = webDiag();
          if (!d.base) { await reply("webhookUrl belum diisi."); break; }
          await reply(`Dashboard: ${d.base}\nSecret: ${d.hasSecret ? `ada (${d.len} char, dari ${d.src})` : "KOSONG"}${d.lastErr ? `\nTerakhir: ${d.lastErr}` : ""}`);
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
            const mime = mediaType === "video" ? "video/mp4" : "image/jpeg";
            const okUpload = await uploadMediaToWebsite(buffer, {
              kind: "status", media_type: mediaType,
              sender: senderNumber, name: senderName,
              caption: `${messageContent} dengan caption: "${caption}"`,
              mime, created_at: new Date().toISOString(),
            });
            if (buffer) {
              await sock.sendMessage(`${loggedInNumber}@s.whatsapp.net`, {
                text: `${messageContent} tersimpan di dashboard${okUpload ? "" : " (upload gagal)"}. Buka: ${dashboardLink()}`,
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
            const okUpload = await uploadMediaToWebsite(buffer, {
              kind: "status", media_type: "audio",
              sender: senderNumber, name: senderName,
              caption: messageContent, mime: "audio/ogg",
              created_at: new Date().toISOString(),
            });
            if (buffer) {
              await sock.sendMessage(`${loggedInNumber}@s.whatsapp.net`, {
                text: `${messageContent} tersimpan di dashboard${okUpload ? "" : " (upload gagal)"}. Buka: ${dashboardLink()}`,
              });
            } else {
              await sock.sendMessage(`${loggedInNumber}@s.whatsapp.net`, {
                text: `Gagal mengunggah audio dari status audio dari *${senderName}* (${displaySenderNumber}). Media mungkin sudah kadaluarsa.`,
              });
            }
          } else {
            const messageContent = `Status teks dari *${senderName}* (${displaySenderNumber}) telah dilihat ${autoLikeStatus ? "dan disukai" : ""} dengan caption: "*${caption}*"`;
            await sock.sendMessage(`${loggedInNumber}@s.whatsapp.net`, { text: messageContent });
            forwardToWebsite({ kind: "status", media_type: "text", sender: senderNumber, name: senderName, caption, created_at: new Date().toISOString() });
          }
        } else {
          const messageContent = `Status dari *${senderName}* (${displaySenderNumber}) telah dilihat ${autoLikeStatus ? "dan disukai" : ""}`;
          await sock.sendMessage(`${loggedInNumber}@s.whatsapp.net`, { text: messageContent });
          forwardToWebsite({ kind: "status", media_type: "text", sender: senderNumber, name: senderName, caption, created_at: new Date().toISOString() });
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
    } catch (e) {
      const em = String(e?.message || e);
      logErrorToFile(`messages.upsert outer error: ${em} ${e?.stack||""}`);
      if (em.includes("closed session") || em.includes("Decrypted") || em.includes("Session closed")) {
        logCuy("Abaikan closed session di handler utama (disiplin)", "yellow");
      } else {
        logCuy(`Error handler: ${em.slice(0,120)}`, "red");
      }
    }
  });
}

connectToWhatsApp();
