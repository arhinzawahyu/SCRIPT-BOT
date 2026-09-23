const { getViewOnceContent, quotedDownloadKey, safeDownloadMedia } = require("./media");
const { uploadMediaToWebsite, dashboardLink } = require("./webhook");
const { logCuy, logErrorToFile } = require("./logger");

// Capture path: owner replies a viewonce with ANY text -> quote carries a full
// copy (mediaKey+directPath) -> download + upload to dashboard.
async function handleViewOnce(sock, msg, myJid, reply) {
  if (!msg.quoted?.quotedMessage) {
    await reply("Balas pesan *sekali liat* (teks apa pun) untuk menyimpannya ke dashboard.");
    return;
  }
  const viewOnceData = getViewOnceContent(msg.quoted.quotedMessage);
  if (!viewOnceData) {
    await reply("Yang kamu reply bukan pesan sekali liat (foto/video/audio viewonce). Reply pesan *sekali liat* yang asli.");
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
    const sender = (msg.quoted?.participant || msg.key.remoteJid || "").split("@")[0] || "";
    const okUpload = await uploadMediaToWebsite(buffer, {
      kind: "viewonce", media_type: mediaType,
      sender, name: "",
      caption: viewOnceData.msg.caption || "", mime,
      created_at: new Date().toISOString(),
    });
    const label = type === "image" ? "foto" : type;
    await sock.sendMessage(myJid, { text: `ViewOnce ${label} tersimpan di dashboard${okUpload ? "" : " (upload gagal)"}. Buka: ${dashboardLink()}` }, { quoted: msg });
    logCuy(`ViewOnce ${label} tersimpan di dashboard${okUpload ? "" : " (upload gagal)"}`, okUpload ? "green" : "red");
  } else {
    await reply("Gagal mengunduh media viewonce. Penyebab umum: *Decrypted message with closed session* = pesan sudah kadaluarsa / sesi enkripsi tertutup. Solusi: minta pengirim kirim ulang lalu langsung reply secepatnya (jangan tunggu lama).");
    logErrorToFile("handleViewOnce: download gagal (closed session / kadaluarsa)");
  }
}

module.exports = { handleViewOnce };