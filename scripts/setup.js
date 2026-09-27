// Setup bot.config.json untuk machine baru (HP/VPS/PC).
// Bukan sekadar nulis file: setelah menulis, secret relay dicoba ke server
// sungguhan. Login gagal dengan "Secret relay: KOSONG" atau 403 jauh lebih
// sulit diagnosa daripada satu pesan error di sini.
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const CFG_PATH = path.join(__dirname, "..", "bot.config.json");
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// rl.question saja tidak bisa dipakai: kalau semua baris tiba sekaligus
// (piped input), baris kedua dan seterusnya hilang sebelum pertanyaan
// berikutnya terdaftar, lalu proses keluar 0 tanpa menulis apa pun. Antrean
// ini menahan baris yang datang cepat dan tetap interaktif kalau diketik
// manual satu per satu.
const queue = [];
const waiters = [];
let inputClosed = false;
rl.on("line", (line) => {
  const w = waiters.shift();
  if (w) w(line);
  else queue.push(line);
});
rl.on("close", () => {
  inputClosed = true;
  while (waiters.length) waiters.shift()("");
});

function ask(q, fallback = "") {
  process.stdout.write(`${q}${fallback ? ` [${fallback}]` : ""}: `);
  if (queue.length) return Promise.resolve(queue.shift().trim() || fallback);
  if (inputClosed) return Promise.resolve(fallback);
  return new Promise((res) => waiters.push((line) => res(line.trim() || fallback)));
}

(async () => {
  console.log("Isi bot.config.json. Kosongkan untuk pakai nilai yang sudah ada.\n");
  const webhookUrl = await ask("webhookUrl dashboard", "https://wa-bot-dashboard.vercel.app");
  const webhookSecret = await ask("webhookSecret (harus sama dengan WEBHOOK_SECRET di Vercel)");
  const loginRelaySecret = await ask("loginRelaySecret (harus sama dengan LOGIN_RELAY_SECRET di Vercel)");

  // process.exit() di sini bikin Node mati sebelum stdout selesai flush: kode
  // keluar jadi -1073740791 dan pesan bisa terpotong. process.exitCode
  // membiarkan proses keluar sendiri setelah semua output benar-benar ditulis.
  const stop = (code) => { rl.close(); process.exitCode = code; };

  if (!/^https:\/\//.test(webhookUrl)) {
    console.error("\nGagal: webhookUrl wajib https. Bot menolak http dan host privat.");
    return stop(1);
  }
  if (!loginRelaySecret) {
    console.error("\nGagal: loginRelaySecret wajib diisi. Tanpa itu tidak ada yang bisa masuk ke dashboard.");
    return stop(1);
  }
  if (webhookSecret && webhookSecret === loginRelaySecret) {
    console.error("\nGagal: webhookSecret sama dengan loginRelaySecret. Kalau secret ini bocor,");
    console.error("siapa pun bisa menarik OTP plaintext dan masuk. Pakai dua nilai berbeda.");
    return stop(1);
  }

  // Verifikasi relay saja. Endpoint ini read-only: GET tidak menulis apa pun ke
  // DB. webhookSecret tidak di-probe karena /api/ingest menulis data, dan tes
  // login tidak butuh ingest.
  const base = webhookUrl.replace(/\/$/, "");
  let ok = false;
  try {
    const res = await fetch(base + "/api/login/code", { headers: { "x-relay-secret": loginRelaySecret } });
    ok = res.status === 200;
    console.log(`\ncek server ${base} -> HTTP ${res.status}`);
    if (!ok) {
      console.log(
        res.status === 403
          ? "Secret relay ditolak. Nilai ini BEDA dari LOGIN_RELAY_SECRET di Vercel."
          : "Server menjawab selain 200. Cek webhookUrl dan apakah dashboard sudah ter-deploy."
      );
    }
  } catch (e) {
    console.log(`\ncek server gagal: ${e.message}`);
  }

  if (!ok) {
    const jawab = await ask("\nTulis file tetap? (y/n)", "n");
    if (jawab.toLowerCase() !== "y") return stop(1);
  }

  fs.writeFileSync(CFG_PATH, JSON.stringify({ webhookUrl, webhookSecret, loginRelaySecret }, null, 4) + "\n", "utf-8");
  console.log(`\nDitulis: ${CFG_PATH}`);
  console.log("Jalankan bot: node index.js");
  stop(ok ? 0 : 1);
})();
