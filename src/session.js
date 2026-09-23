const fs = require("fs");
const path = require("path");
const moment = require("moment-timezone");
const { logCuy, logErrorToFile, logInfoToFile } = require("./logger");

const SESSION_PATH = path.join(__dirname, "..", "sessions");
const SESSION_BACKUP_DIR = path.join(__dirname, "..", "sessions_backup");
let lastBackupHash = "";

function getSessionsHash() {
  try {
    if (!fs.existsSync(SESSION_PATH)) return "";
    const files = fs.readdirSync(SESSION_PATH);
    let h = "";
    for (const f of files) {
      try { const st = fs.statSync(path.join(SESSION_PATH, f)); h += f + st.mtimeMs + st.size + ";"; } catch (_) {}
    }
    return h;
  } catch (_) { return ""; }
}

// Light backup: only when sessions change, max 3.
function backupSessions(force = false) {
  try {
    if (!fs.existsSync(SESSION_PATH) || fs.readdirSync(SESSION_PATH).length === 0) return false;
    const curHash = getSessionsHash();
    if (!force && curHash && curHash === lastBackupHash) return false;
    if (!fs.existsSync(SESSION_BACKUP_DIR)) fs.mkdirSync(SESSION_BACKUP_DIR, { recursive: true });
    const ts = moment().tz("Asia/Jakarta").format("YYYY-MM-DD_HH-mm");
    const dest = path.join(SESSION_BACKUP_DIR, `backup_${ts}`);
    if (fs.existsSync(dest)) return false;
    fs.cpSync(SESSION_PATH, dest, { recursive: true });
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

module.exports = { backupSessions };