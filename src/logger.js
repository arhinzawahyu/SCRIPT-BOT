const fs = require("fs");
const path = require("path");
const moment = require("moment-timezone");
require("colors");

const LOG_DIR = path.join(__dirname, "..", "logs");
const ERROR_LOG = path.join(LOG_DIR, "error.log");
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

function logCuy(message, type = "green") {
  moment.locale("id");
  const now = moment().tz("Asia/Jakarta");
  console.log(
    `\n${now.format(" dddd ").bgRed}${now.format(" D MMMM YYYY ").bgYellow.black}${now.format(" HH:mm:ss ").bgWhite.black}\n`
  );
  console.log(`${message.bold[type]}`);
}

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

module.exports = { logCuy, logErrorToFile, logInfoToFile };