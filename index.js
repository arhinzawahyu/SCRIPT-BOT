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
  blackList,
  whiteList,
  emojis,
} = config;

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

async function safeDownloadMedia(sock, msg, type) {
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
    return buffer;
  } catch (error) {
    logCuy(`Gagal mengunduh media (${type}): ${error.message}`, "red");
    return null;
  }
}

async function connectToWhatsApp() {
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
    keepAliveIntervalMs: 30000,
    browser: Browsers.macOS("Chrome"),
    shouldSyncHistoryMessage: () => true,
    syncFullHistory: true,
    generateHighQualityLinkPreview: true,
  });

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
                  const code = await sock.requestPairingCode(waNumber, "ARHINZA0");
                  console.log(
                    "\nCek notifikasi wangsafmu dan masukin kode login wangsaf:".blue.bold,
                    code.bold.red
                  );
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
            connectToWhatsApp();
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

    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect.error?.output.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) {
        logCuy("Mencoba menghubungkan ke wangsaf...\n", "cyan");
        connectToWhatsApp();
      } else {
        logCuy("Nampaknya kamu telah logout dari wangsaf, silahkan login ke wangsaf kembali!", "red");
        fs.rmdirSync(sessionPath, { recursive: true, force: true });
        connectToWhatsApp();
      }
    } else if (connection === "open") {
      logCuy("Berhasil Terhubung ke wangsaf");
      loggedInNumber = sock.user.id.split("@")[0].split(":")[0];
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

Ketik *#menu* untuk melihat menu perintah yang tersedia.`;

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
          await sock.sendMessage(`${loggedInNumber}@s.whatsapp.net`, { text: messageInfo });
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

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message) return;

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
    const myJid = `${loggedInNumber}@s.whatsapp.net`;

    if (prefix && msg.key.fromMe) {
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
              `mana argumennya ?\ncontoh ketik : \`#on autolike\`\n\nArgumen yang tersedia:\n\n\`#on autoread\`\nuntuk mengaktifkan fitur autoread story\n\n\`#on autolike\`\nuntuk mengaktifkan fitur autolike story\n\n\`#on dlmedia\`\nuntuk mengaktifkan fitur download media(foto,video, dan audio) dari story\n\n\`#on sensornomor\`\nuntuk mengaktifkan sensor nomor\n\n\`#on antitelpon\`\nuntuk mengaktifkan anti-telpon\n\n\`#on kickstory\`\nuntuk mengaktifkan auto kick story grup`
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
                default:
                  await reply(
                    `Argumen tidak valid: ${arg}. Pilihan yang tersedia: autoread, autolike, dlmedia, sensornomor, kickstory dan antitelpon`
                  );
              }
            }
          }
          break;

        case "off":
          if (msg.args[0].trim() === "") {
            await reply(
              `mana argumennya ?\ncontoh ketik : \`#off autolike\`\n\nArgumen yang tersedia:\n\n\`#off autoread\`\nuntuk menonaktifkan fitur autoread story\n\n\`#off autolike\`\nuntuk menonaktifkan fitur autolike story\n\n\`#off dlmedia\`\nuntuk menonaktifkan fitur download media(foto,video, dan audio) dari story\n\n\`#off sensornomor\`\nuntuk menonaktifkan sensor nomor\n\n\`#off antitelpon\`\nuntuk menonaktifkan anti-telpon\n\n\`#off kickstory\`\nuntuk menonaktifkan auto kick story grup`
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
                default:
                  await reply(
                    `Argumen tidak valid: ${arg}. Pilihan yang tersedia: autoread, autolike, dlmedia, sensornomor, kickstory dan antitelpon`
                  );
              }
            }
          }
          break;

        case "add":
          if (msg.args[0].trim() === "") {
            await reply(
              `mana argumennya ?\ncontoh ketik :\n\`#add blacklist 628123456789\`\n\nArgumen yang tersedia:\n\n\`#add blacklist nomornya\`\nuntuk menambahkan nomor ke blacklist\n\n\`#add whitelist nomornya\`\nuntuk menambahkan nomor ke whitelist\n\n\`#add emojis emojinya\`\nuntuk menambahkan emoji ke daftar emojis`
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
              } else {
                await reply(
                  `Argumen tidak valid: ${arg}. Pilihan yang tersedia: blacklist, whitelist, emojis`
                );
              }
            }
          }
          break;

        case "remove":
          if (msg.args[0].trim() === "") {
            await reply(
              `mana argumennya ?\ncontoh ketik :\n\`#remove blacklist 628123456789\`\n\nArgumen yang tersedia:\n\n\`#remove blacklist nomornya\`\nuntuk menghapus nomor dari blacklist\n\n\`#remove whitelist nomornya\`\nuntuk menghapus nomor dari whitelist\n\n\`#remove emojis emojinya\`\nuntuk menghapus emoji dari daftar emojis`
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
              } else {
                await reply(
                  `Argumen tidak valid: ${arg}. Pilihan yang tersedia: blacklist, whitelist, emojis`
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

Perintah Viewonce:
\`#viewonce\`
Mengambil/download foto, video, audio dari pesan sementara/sekali liat dari yang kamu reply`
          );
          break;

        case "viewonce":
          if (msg.isQuoted && msg.quoted && msg.quoted.quotedMessage) {
            const quotedMsg = msg.quoted.quotedMessage;

            if (quotedMsg.imageMessage) {
              const msgToDownload = {
                message: { imageMessage: quotedMsg.imageMessage },
                key: msg.quoted.key,
              };
              const buffer = await safeDownloadMedia(sock, msgToDownload, "gambar");
              if (buffer) {
                await sock.sendMessage(myJid, { image: Buffer.from(buffer) }, { quoted: msg });
                logCuy("Berhasil mengambil gambar sekali liat dari yang kamu reply", "blue");
              } else {
                await reply("Gagal mengunduh gambar, media mungkin sudah kadaluarsa di server WhatsApp.");
              }
            } else if (quotedMsg.videoMessage) {
              const msgToDownload = {
                message: { videoMessage: quotedMsg.videoMessage },
                key: msg.quoted.key,
              };
              const buffer = await safeDownloadMedia(sock, msgToDownload, "video");
              if (buffer) {
                await sock.sendMessage(myJid, { video: Buffer.from(buffer) }, { quoted: msg });
                logCuy("Berhasil mengambil video sekali liat dari yang kamu reply", "blue");
              } else {
                await reply("Gagal mengunduh video, media mungkin sudah kadaluarsa di server WhatsApp.");
              }
            } else if (quotedMsg.audioMessage) {
              const msgToDownload = {
                message: { audioMessage: quotedMsg.audioMessage },
                key: msg.quoted.key,
              };
              const buffer = await safeDownloadMedia(sock, msgToDownload, "audio");
              if (buffer) {
                await sock.sendMessage(myJid, { audio: Buffer.from(buffer) }, { quoted: msg });
                logCuy("Berhasil mengambil audio sekali liat dari yang kamu reply", "blue");
              } else {
                await reply("Gagal mengunduh audio, media mungkin sudah kadaluarsa di server WhatsApp.");
              }
            } else {
              await reply(
                "Pesan yang kamu reply bukan pesan yang bertipe foto, video, audio dan sekali liat"
              );
              logCuy(
                "Pesan yang kamu reply bukan pesan yang bertipe foto, video, audio dan sekali liat",
                "yellow"
              );
            }
          } else {
            await reply("Reply/balas pesan sekali liat dengan perintah #viewonce");
          }
          break;

        case "info": {
          const infoMessage = `Informasi Status Fitur:
          - Auto Read Status: ${autoReadStatus ? "*Aktif*" : "*Nonaktif*"}
          - Auto Like Status: ${autoLikeStatus ? "*Aktif*" : "*Nonaktif*"}
          - Download Media Status: ${downloadMediaStatus ? "*Aktif*" : "*Nonaktif*"}
          - Sensor Nomor: ${sensorNomor ? "*Aktif*" : "*Nonaktif*"}
          - Anti Telpon: ${antiTelpon ? "*Aktif*" : "*Nonaktif*"}
          - Auto Kick tag Story: ${autoKickStory ? "*Aktif*" : "*Nonaktif*"}`;

          const formatList = (list) =>
            list.map((number) => `\u25CF ${sensorNum(number)}`).join("\n");

          const formatEmojiList = (list) => list.join(", ");

          const blacklistMessage =
            blackList.length > 0 ? `Blacklist:\n${formatList(blackList)}` : "Blacklist kosong.";
          const whitelistMessage =
            whiteList.length > 0 ? `Whitelist:\n${formatList(whiteList)}` : "Whitelist kosong.";
          const emojisMessage =
            emojis.length > 0 ? `Emojis:\n${formatEmojiList(emojis)}` : "Emojis kosong.";

          const listMessage = `\n\n${blacklistMessage}\n\n${whitelistMessage}\n\n${emojisMessage}\n\nKetik \`#add\` untuk menambahkan nomor atau emoji ke blacklist, whitelist, dan emojis\nKetik \`#remove\` untuk menghapus nomor atau emoji dari blacklist, whitelist, dan emojis\nKetik \`#on\` untuk mengaktifkan fitur\nKetik \`#off\` untuk menonaktifkan fitur\nKetik \`#menu\` untuk melihat menu perintah yang tersedia`;

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
    }
  });
}

connectToWhatsApp();
