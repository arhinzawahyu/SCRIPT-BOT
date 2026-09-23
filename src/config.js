const fs = require("fs");
const path = require("path");

const configPath = path.join(__dirname, "..", "config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

// Dashboard credentials: local bot.config.json (gitignored). Env wins when set.
let localCfg = {};
try {
  const lp = path.join(__dirname, "..", "bot.config.json");
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

// Defaults (never overwrite existing values).
if (typeof config.antiDelete === "undefined") config.antiDelete = false;
if (typeof config.downloadMediaStatus === "undefined") config.downloadMediaStatus = true;
if (!Array.isArray(config.blackList)) config.blackList = [];
if (!Array.isArray(config.whiteList)) config.whiteList = [];
if (!Array.isArray(config.emojis)) config.emojis = ["💖", "👍", "🙏"];
if (typeof config.webhookUrl !== "string") config.webhookUrl = "";

function updateConfig(key, value) {
  config[key] = value;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 4), "utf-8");
}

function sensorNum(num) {
  const n = String(num == null ? "" : num);
  return config.sensorNomor ? n.slice(0, 3) + "****" + n.slice(-2) : n;
}

module.exports = { config, updateConfig, localCfg, WEBHOOK_URL, sensorNum };