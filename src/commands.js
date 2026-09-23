const { config, updateConfig, sensorNum } = require("./config");
const { logCuy } = require("./logger");
const { webDiag, fetchPendingLoginCode, mintLoginCodes, markLoginCodeSent } = require("./webhook");
const { backupSessions } = require("./session");
const { handleViewOnce } = require("./viewonce");

async function handleCommand(sock, msg, myJid, reply) {
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

  const FEATURES = { autoread: "Auto Read Status", autolike: "Auto Like Status", dlmedia: "Download Media Status", sensornomor: "Sensor Nomor", antitelpon: "Anti Telepon", kickstory: "Auto Kick Story", antidelete: "Anti Delete" };

  switch (msg.cmd) {
    case "on":
    case "off": {
      const enabling = msg.cmd === "on";
      const verbOn = enabling ? "mengaktifkan" : "menonaktifkan";
      const helpList = Object.entries(FEATURES).map(([k, v]) => `\`#${msg.cmd} ${k}\`\nuntuk ${verbOn} fitur ${v.toLowerCase()}`).join("\n\n");
      if (msg.args[0].trim() === "") {
        await reply(`mana argumennya ?\ncontoh ketik : \`#${msg.cmd} autolike\`\n\nArgumen yang tersedia:\n\n${helpList}`);
      } else {
        for (const arg of msg.args) {
          const key = arg.trim().toLowerCase();
          if (!FEATURES[key]) {
            await reply(`Argumen tidak valid: ${arg}. Pilihan: ${Object.keys(FEATURES).join(", ")}`);
            continue;
          }
          config[key] = enabling;
          updateConfig(key, enabling);
          logCuy(`Kamu ${verbOn} fitur ${FEATURES[key]}`, "blue");
          await reply(`${FEATURES[key]} ${enabling ? "aktif" : "nonaktif"}`);
        }
      }
      break;
    }

    case "add":
    case "remove": {
      const removing = msg.cmd === "remove";
      const verb = removing ? "menghapus" : "menambahkan";
      const helpList = [
        `\`#${msg.cmd} blacklist nomornya\`\nuntuk ${verb} nomor ${removing ? "dari" : "ke"} blacklist`,
        `\`#${msg.cmd} whitelist nomornya\`\nuntuk ${verb} nomor ${removing ? "dari" : "ke"} whitelist`,
        `\`#${msg.cmd} emojis emojinya\`\nuntuk ${verb} emoji ${removing ? "dari" : "ke"} daftar emojis`,
      ].join("\n\n");
      if (msg.args[0].trim() === "") {
        await reply(`mana argumennya ?\ncontoh ketik :\n\`#${msg.cmd} blacklist 628123456789\`\n\nArgumen yang tersedia:\n\n${helpList}`);
      } else {
        for (const arg of msg.args) {
          const [list, data] = arg.trim().split(" ");

          if (list === "emojis") {
            const emojiRegex = /^[\p{Emoji}\u200D\uFE0F]$/gu;
            if (!data) { await reply("emoji harus diisi.\ncontoh ketik :\n`#add emojis 👍`"); continue; }
            if (!emojiRegex.test(data)) { await reply("hanya boleh mengisi 1 emoji.\ncontoh ketik :\n`#add emojis 👍`"); continue; }
            if (removing && config.emojis.length === 1) {
              await reply("Tidak bisa menghapus emoji terakhir. Harus ada minimal satu emoji.\n\nKetik `#info` untuk mengecek daftar emoji.");
              continue;
            }
            const idx = config.emojis.indexOf(data);
            if (!removing && idx !== -1) { await reply(`emoji ${data} sudah ada di daftar emojis`); continue; }
            if (removing && idx === -1) { await reply(`emoji ${data} tidak ada di daftar emojis\n\nKetik \`#info\` untuk mengecek daftar emoji`); continue; }
            if (removing) config.emojis.splice(idx, 1); else config.emojis.push(data);
            updateConfig("emojis", config.emojis);
            logCuy(`Kamu ${verb} emoji ${data} ${removing ? "dari" : "ke"} daftar emojis`, "blue");
            await reply(`emoji ${data} berhasil ${removing ? "dihapus dari" : "ditambahkan ke"} daftar emojis`);
          } else if (list === "blacklist" || list === "whitelist") {
            const isValid = await validateNumber(`#${msg.cmd}`, verb, removing ? "dari" : "ke", data);
            if (!isValid) continue;
            const arr = list === "blacklist" ? config.blackList : config.whiteList;
            const displayNumber = sensorNum(data);
            const idx = arr.indexOf(data);
            if (!removing && idx !== -1) { await reply(`Nomor ${displayNumber} sudah ada di ${list}`); continue; }
            if (removing && idx === -1) { await reply(`Nomor ${displayNumber} tidak ada di ${list}\n\nKetik \`#info\` untuk mengecek daftar nomor`); continue; }
            if (removing) arr.splice(idx, 1); else arr.push(data);
            updateConfig(list, arr);
            logCuy(`Kamu ${verb} nomor ${displayNumber} ${removing ? "dari" : "ke"} ${list}`, "blue");
            await reply(`Nomor ${displayNumber} berhasil ${removing ? "dihapus dari" : "ditambahkan ke"} ${list}`);
          } else {
            await reply(`Argumen tidak valid: ${arg}. Pilihan yang tersedia: blacklist, whitelist, emojis`);
          }
        }
      }
      break;
    }

    case "menu": {
      const onList = [];
      const offList = [];
      for (const [name, key] of [["sensor", "sensorNomor"], ["autoread", "autoReadStatus"], ["autolike", "autoLikeStatus"], ["dlmedia", "downloadMediaStatus"], ["anticall", "antiTelpon"], ["kickstory", "autoKickStory"], ["antidelete", "antiDelete"]]) {
        (config[key] ? onList : offList).push(name);
      }
      const infoMessage = `┌─ MENU BOT WHATSAPP
│
├─ STATUS
│  ON: ${onList.join(", ") || "-"}
│  OFF: ${offList.join(", ") || "-"}
│
├─ PENGATURAN
│  #on / #off lalu nama fitur
│  Opsi: autoread, autolike, dlmedia, sensornomor, antitelpon, kickstory, antidelete
│
├─ KELOLA DAFTAR
│  #add / #remove lalu nama daftar
│  Opsi: blacklist, whitelist, emojis
│
├─ SISTEM
│  #info (Status lengkap)
│  #backup (Backup manual)
│  #token (Kode login dashboard)
│  #web (Cek dashboard webhook)
│
├─ VIEWONCE
│  Balas pesan sekali liat dengan teks APA PUN → tersimpan ke dashboard
│
└──────────────────`;
      await reply(infoMessage);
      break;
    }

    case "vo":
    case "vv":
    case "viewonce":
    case "view_once":
      await handleViewOnce(sock, msg, myJid, reply);
      break;

    case "set":
    case "setkey":
    case "setapikey":
    case "apikey":
    case "gemini":
      await reply(`Fitur AI sudah dihapus di versi ini jadi tidak perlu apikey lagi.\nKetik #menu untuk lihat fitur yang tersedia.\n\nJika butuh backup manual ketik #backup`);
      break;

    case "info": {
      const on = (v) => (v ? "ON" : "OFF");
      const infoMessage = `*INFO BOT*
----------
FITUR (ubah: #on/#off)
  Autoread : ${on(config.autoReadStatus)} - baca story otomatis
  Autolike : ${on(config.autoLikeStatus)} - like story otomatis
  Download : ${on(config.downloadMediaStatus)} - simpan media story
  Sensor   : ${on(config.sensorNomor)} - sembunyikan nomor
  AntiTelpon : ${on(config.antiTelpon)} - tolak panggilan
  KickStory : ${on(config.autoKickStory)} - kick yg tag grup di story
  AntiDel : ${on(config.antiDelete)} - forward pesan yg dihapus pengirim

LIST
  Blacklist: ${config.blackList.length ? config.blackList.map((n) => sensorNum(n)).join(", ") : "kosong"}
  Whitelist: ${config.whiteList.length ? config.whiteList.map((n) => sensorNum(n)).join(", ") : "kosong (semua diizinkan)"}
  Emoji: ${config.emojis.join(" ")}
  Backup: ringan 12 jam sekali (max 3) - ketik #backup untuk manual

CARA PAKAI SINGKAT
  #on autoread - nyalakan autoread
  #off autolike - matikan autolike
  #add whitelist 62812xxx - izinkan nomor
  #info - status lengkap
  ViewOnce: balas pesan sekali liat dengan teks apa pun → dashboard
\nKetik #menu untuk menu ringkas.
Termux 100% : cukup node index.js, auto backup ringan, tidak berat storage.`;
      await reply(infoMessage);
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

module.exports = { handleCommand };