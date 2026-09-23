const { downloadMediaMessage } = require("@whiskeysockets/baileys");
const pino = require("pino");
const { logCuy, logErrorToFile, logInfoToFile } = require("./logger");

// Peel one viewOnce*/ephemeral/disappearing wrapper per level.
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

// View-once deep search: WA wraps it in many ways (viewOnceMessage/V2/V2Extension,
// ephemeral, disappearing). A viewOnce* wrapper implies once-view even when the
// inner media has no viewOnce flag.
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
      logErrorToFile(`safeDownload ${type} attempt ${attempt}/${retries} gagal: ${error.message}`);
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

module.exports = { unwrapMessage, findViewOnceNode, getViewOnceContent, quotedDownloadKey, safeDownloadMedia };