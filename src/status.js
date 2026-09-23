const { jidNormalizedUser } = require("@whiskeysockets/baileys");
const { config, sensorNum } = require("./config");
const { state } = require("./state");
const { safeDownloadMedia } = require("./media");
const { uploadMediaToWebsite, forwardToWebsite, dashboardLink } = require("./webhook");
const { logCuy, logErrorToFile } = require("./logger");

async function handleStatus(sock, msg) {
  const loggedInNumber = state.loggedInNumber;
  if (!loggedInNumber) return;

  let senderNumber = msg.key.remoteJidAlt ? msg.key.remoteJidAlt.split("@")[0] : "Tidak diketahui";
  const senderName = msg.pushName || "Tidak diketahui";
  const displaySenderNumber = senderNumber !== "Tidak diketahui" ? sensorNum(senderNumber) : senderNumber;

  if (msg.message.protocolMessage) {
    logCuy(`Status dari ${senderName} (${displaySenderNumber}) telah dihapus.`, "red");
    return;
  }
  if (msg.message.reactionMessage) return;

  if (config.blackList.includes(senderNumber)) {
    logCuy(`${senderName} (${displaySenderNumber}) membuat status tapi karena ada di blacklist. Status tidak akan dilihat.`, "yellow");
    return;
  }
  if (config.whiteList.length > 0 && !config.whiteList.includes(senderNumber)) {
    logCuy(`${senderName} (${displaySenderNumber}) membuat status tapi karena tidak ada di whitelist. Status tidak akan dilihat.`, "yellow");
    return;
  }
  if (!msg.key.remoteJid || !msg.key.remoteJidAlt) return;

  const myself = jidNormalizedUser(sock.user.id);
  const emojiToReact = config.emojis[Math.floor(Math.random() * config.emojis.length)];
  const myjid = `${loggedInNumber}@s.whatsapp.net`;

  try {
    await sock.readMessages([msg.key]);

    if (config.autoLikeStatus) {
      await sock.sendMessage(
        msg.key.remoteJid,
        { react: { key: msg.key, text: emojiToReact } },
        { statusJidList: [msg.key.remoteJidAlt, myself] }
      );
    }

    logCuy(`Berhasil melihat ${config.autoLikeStatus ? "dan menyukai " : ""}status dari: ${senderName} (${displaySenderNumber})`, "green");

    const caption =
      msg.message.imageMessage?.caption ||
      msg.message.videoMessage?.caption ||
      msg.message.extendedTextMessage?.text ||
      "Tidak ada caption";

    if (config.downloadMediaStatus) {
      if (msg.type === "imageMessage" || msg.type === "videoMessage") {
        const mediaType = msg.type === "imageMessage" ? "image" : "video";
        const mediaLabel = mediaType === "image" ? "gambar" : "video";
        const messageContent = `Status ${mediaLabel} dari *${senderName}* (${displaySenderNumber}) telah dilihat ${config.autoLikeStatus ? "dan disukai" : ""}`;

        const buffer = await safeDownloadMedia(sock, msg, mediaLabel);
        const mime = mediaType === "video" ? "video/mp4" : "image/jpeg";
        const okUpload = await uploadMediaToWebsite(buffer, {
          kind: "status", media_type: mediaType,
          sender: senderNumber, name: senderName,
          caption: `${messageContent} dengan caption: "${caption}"`,
          mime, created_at: new Date().toISOString(),
        });
        if (buffer) {
          await sock.sendMessage(myjid, {
            text: `${messageContent} tersimpan di dashboard${okUpload ? "" : " (upload gagal)"}. Buka: ${dashboardLink()}`,
          });
        } else {
          await sock.sendMessage(myjid, {
            text: `${messageContent} namun gagal mengunggah media ${mediaLabel} dari *${senderName}* (${displaySenderNumber}). Media mungkin sudah kadaluarsa.`,
          });
        }
      } else if (msg.type === "audioMessage") {
        const messageContent = `Status audio dari *${senderName}* (${displaySenderNumber}) telah dilihat ${config.autoLikeStatus ? "dan disukai" : ""}. Berikut audionya.`;
        await sock.sendMessage(myjid, { text: messageContent });

        const buffer = await safeDownloadMedia(sock, msg, "audio");
        const okUpload = await uploadMediaToWebsite(buffer, {
          kind: "status", media_type: "audio",
          sender: senderNumber, name: senderName,
          caption: messageContent, mime: "audio/ogg",
          created_at: new Date().toISOString(),
        });
        if (buffer) {
          await sock.sendMessage(myjid, {
            text: `${messageContent} tersimpan di dashboard${okUpload ? "" : " (upload gagal)"}. Buka: ${dashboardLink()}`,
          });
        } else {
          await sock.sendMessage(myjid, {
            text: `Gagal mengunggah audio dari status audio dari *${senderName}* (${displaySenderNumber}). Media mungkin sudah kadaluarsa.`,
          });
        }
      } else {
        const messageContent = `Status teks dari *${senderName}* (${displaySenderNumber}) telah dilihat ${config.autoLikeStatus ? "dan disukai" : ""} dengan caption: "*${caption}*"`;
        await sock.sendMessage(myjid, { text: messageContent });
        forwardToWebsite({ kind: "status", media_type: "text", sender: senderNumber, name: senderName, caption, created_at: new Date().toISOString() });
      }
    } else {
      const messageContent = `Status dari *${senderName}* (${displaySenderNumber}) telah dilihat ${config.autoLikeStatus ? "dan disukai" : ""}`;
      await sock.sendMessage(myjid, { text: messageContent });
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

module.exports = { handleStatus };