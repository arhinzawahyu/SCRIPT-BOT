const { config, localCfg, WEBHOOK_URL } = require("./config");
const { logErrorToFile, logCuy } = require("./logger");

function cfgStr(v) { return typeof v === "string" ? v.trim().replace(/^"|"$/g, "") : ""; }
function pickStr(...vals) { for (const v of vals) { const s = cfgStr(v); if (s) return s; } return ""; }

// Webhook secret priority: env BOT_WEBHOOK_SECRET, then bot.config.json (gitignored).
function webSecret() { return pickStr(process.env.BOT_WEBHOOK_SECRET, localCfg.webhookSecret); }
function webSecretSrc() {
  if (cfgStr(process.env.BOT_WEBHOOK_SECRET)) return "env";
  if (cfgStr(localCfg.webhookSecret)) return "bot.config.json";
  return "";
}
function webHeaders() {
  const s = webSecret();
  return { "Content-Type": "application/json", ...(s ? { "x-webhook-secret": s } : {}) };
}

let lastWebErr = "";

// Dashboard webhook MUST be public https. Reject http/local SSRF.
function webBase() {
  const raw = String(WEBHOOK_URL || config.webhookUrl || "").replace(/\/$/, "");
  if (!raw) return "";
  let u;
  try { u = new URL(raw); } catch { return ""; }
  if (u.protocol !== "https:") { logErrorToFile("webhookUrl harus https"); return ""; }
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" ||
      host.startsWith("10.") || host.startsWith("192.168.") || host.startsWith("172.")) {
    logErrorToFile("webhookUrl menolak host privat");
    return "";
  }
  return raw;
}

function dashboardLink() { return webBase() || "dashboard web"; }

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
      lastWebErr = `upload: HTTP ${res.status}`;
      logErrorToFile(`upload web gagal: ${res.status}`);
      logCuy(`Oops upload ke dashboard gagal HTTP ${res.status}. Cek WEBHOOK_SECRET web vs bot.config.json`, "red");
    }
    return res.ok;
  } catch (e) { lastWebErr = `upload: ${e.message}`; logErrorToFile(`upload web gagal: ${e.message}`); return false; }
}

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

module.exports = {
  forwardToWebsite, uploadMediaToWebsite, fetchPendingLoginCode,
  markLoginCodeSent, mintLoginCodes, webDiag, dashboardLink, getLastWebErr: () => lastWebErr,
};