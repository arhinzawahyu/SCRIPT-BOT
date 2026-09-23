const moment = require("moment-timezone");
const { config, sensorNum } = require("./config");
const { state } = require("./state");
const { logCuy, logErrorToFile } = require("./logger");
const { getViewOnceContent, unwrapMessage } = require("./media");
const { handleViewOnce } = require("./viewonce");
const { handleStatus } = require("./status");
const { handleCommand } = require("./commands");
const { forwardToWebsite } = require("./webhook");

const deleteStore = new Map();

function myJid() { return state.loggedInNumber ? `${state.loggedInNumber}@s.whatsapp.net` : null; }

// antiDelete: forward a copy of deleted messages to owner private chat
async function sendAntiDelete(sock, store, chatJid) {
  if (!store || !state.loggedInNumber) return false;
  const sender = store.pushName || store.senderNum || "?";
  const where = chatJid?.endsWith("@g.us") ? " di grup" : "";
  const info = `🗑️ *Pesan dihapus* dari *${sender}*${where}\nWaktu: ${moment().tz("Asia/Jakarta").format("DD-MM-YYYY HH:mm:ss")}`;
  const jidMy = `${state.loggedInNumber}@s.whatsapp.net`;
  const t = store.type;
  const label = t === "text" || t === "extendedText" ? "Isinya:" : t === "image" ? "(gambar dihapus) Caption:" : `(media ${t} dihapus tanpa caption)`;
  await sock.sendMessage(jidMy, { text: `${info}\n\n${label}\n${store.text || "(kosong)"}` });
  forwardToWebsite({ kind: "delete", sender: store.senderNum || sender, name: sender, caption: store.text || "", created_at: new Date().toISOString() });
  logCuy(`antiDelete: forward pesan terhapus dari ${sender}`, "yellow");
  return true;
}

const handleDeleted = async (sock, id, chatJid, senderNum) => {
  if (!config.antiDelete || !state.loggedInNumber || !id) return;
  const store = deleteStore.get(id);
  if (store?.senderNum && !senderNum) senderNum = store.senderNum;
  if (store) deleteStore.delete(id);
  await sendAntiDelete(sock, { ...store, senderNum: senderNum || (chatJid ? chatJid.split("@")[0] : "?") }, chatJid);
};

function registerHandlers(sock) {
  // Deleted messages arrive via protocolMessage REVOKE and messages.update.
  sock.ev.on("messages.update", async (updates) => {
    if (!config.antiDelete || !state.loggedInNumber) return;
    if (!Array.isArray(updates)) return;
    for (const upd of updates) {
      try {
        const stub = upd.update?.messageStubType;
        if (stub !== 87 && stub !== 32) continue;
        await handleDeleted(sock, upd.key?.id, upd.key?.remoteJid, upd.key?.participant);
      } catch (e) {
        logErrorToFile(`antiDelete error: ${e.message}`);
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    try {
      state.lastActiveTime = Date.now();
      const msg = messages[0];
      // notify only; append causes double download/decrypt
      if (type !== "notify") return;
      if (!msg.message) return;
      if (msg.message.reactionMessage) return;

      // ProtocolMessage REVOKE (type 0) = sender-deleted message.
      if (msg.message.protocolMessage) {
        const pm = msg.message.protocolMessage;
        if (pm.type === 0 && config.antiDelete && !msg.key.fromMe && state.loggedInNumber) {
          try { await handleDeleted(sock, pm.key?.id, msg.key.remoteJid, pm.key?.participant || msg.key.participant); }
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

      // Also grab text from wrapped messages (viewonce/ephemeral...).
      if (!msg.text) {
        const unwrapped = unwrapMessage(msg.message);
        msg.text = unwrapped?.extendedTextMessage?.text || unwrapped?.conversation || "";
      }

      // antiDelete stores text only (max 200), no media buffers.
      if (config.antiDelete && !msg.key.fromMe &&
          (msg.type === "conversation" || msg.type === "extendedTextMessage" ||
           msg.type === "imageMessage" || msg.type === "videoMessage" || msg.type === "audioMessage")) {
        const textOnly = msg.type === "conversation" || msg.type === "extendedTextMessage"
          ? msg.text : (msg.message[msg.type]?.caption || "");
        const storeType = msg.type === "conversation" ? "text" : msg.type === "extendedTextMessage" ? "extendedText" :
          msg.type === "imageMessage" ? "image" : msg.type === "videoMessage" ? "video" : "audio";
        try {
          deleteStore.set(msg.key.id, { text: textOnly, type: storeType, pushName: msg.pushName, ts: Date.now() });
          if (deleteStore.size > 200) deleteStore.delete(deleteStore.keys().next().value);
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
      const mj = myJid();

      // Terminal feedback untuk verifikasi: (nomor) -> pesan
      if (!msg.key.fromMe) {
        const rjid = msg.key.remoteJid || "";
        if (rjid.endsWith("@g.us")) {
          logCuy(`(grup ${msg.key.participant?.split("@")[0] || "?"}) -> ${msg.text.trim() || `[${msg.type}]`}`, "cyan");
        } else if (rjid !== "status@broadcast") {
          logCuy(`(${rjid.split("@")[0]}) -> ${msg.text.trim() || `[${msg.type}]`}`, "cyan");
        }
      }

      // VIEWONCE: reply dari owner dengan teks APA PUN yang meng-quote pesan
      // viewonce -> ambil dari salinan quote dan simpan ke dashboard. Bot tidak
      // pernah kirim pesan apa pun ke kontak (hanya balas ke diri sendiri).
      if (msg.key.fromMe && mj && msg.quoted?.quotedMessage && getViewOnceContent(msg.quoted.quotedMessage)) {
        logCuy(`Reply viewonce terdeteksi: "${msg.text}" -> ambil & simpan...`, "cyan");
        const reply = (t) => sock.sendMessage(mj, { text: t }, { quoted: msg });
        await handleViewOnce(sock, msg, mj, reply);
        return;
      }

      if (prefix && msg.key.fromMe && mj) {
        msg.cmd = msg.text.trim().split(" ")[0].replace(prefix, "").toLowerCase();
        msg.args = msg.text.replace(/^\S*\b/g, "").trim().split("|");
        const reply = async (text) => sock.sendMessage(mj, { text }, { quoted: msg });
        await handleCommand(sock, msg, mj, reply);
      }

      // Kick member yang tag grup di story (hanya jika admin).
      if (config.autoKickStory && msg.message.groupStatusMentionMessage && !msg.key.fromMe) {
        const groupId = msg.key.remoteJid;
        const participant = msg.key.participantAlt && !msg.key.participantAlt.includes("@lid")
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
            await sock.sendMessage(groupId, {
              text: `@${participant.split("@")[0]} terdeteksi tag grup di story, kamu akan dikick.`,
              mentions: [participant],
            }, { quoted: msg });
            await sock.groupParticipantsUpdate(groupId, [participant], "remove");
            logCuy(`Kamu mengeluarkan seseorang dari group ${groupName} karena telah tag grup di story.`, "red");
          } else {
            logCuy(`Kamu bukan admin di grup ${groupName} jadi tidak bisa kick.`, "yellow");
          }
        } catch (e) {
          logCuy(`Gagal kick story: ${e.message}`, "red");
        }
      }

      if (msg.key.remoteJid === "status@broadcast" &&
          msg.key.remoteJidAlt !== `${state.loggedInNumber}@s.whatsapp.net` &&
          config.autoReadStatus) {
        await handleStatus(sock, msg);
      }
    } catch (e) {
      const em = String(e?.message || e);
      logErrorToFile(`messages.upsert outer error: ${em} ${e?.stack || ""}`);
      if (em.includes("closed session") || em.includes("Decrypted") || em.includes("Session closed")) {
        logCuy("Abaikan closed session di handler utama (disiplin)", "yellow");
      } else {
        logCuy(`Error handler: ${em.slice(0, 120)}`, "red");
      }
    }
  });
}

module.exports = { registerHandlers };