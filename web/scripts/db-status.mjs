// ponytail: tabel dibuat otomatis via initDb(), tanpa file SQL terpisah.
import { neon } from "@neondatabase/serverless";
import fs from "fs";

try {
  if (!process.env.DATABASE_URL) {
    const raw = fs.readFileSync(new URL("./../.env.local", import.meta.url), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (!m) continue;
      let v = m[2].trim().replace(/^"|"$/g, "");
      if (!process.env[m[1]]) process.env[m[1]] = v;
    }
  }
} catch {}

async function main() {
  const url = process.env.DATABASE_URL || "";
  if (!url) {
    console.error("Set DATABASE_URL dulu (pakai URL baru hasil reset, bukan yang bocor di chat).");
    process.exit(1);
  }
  const sql = neon(url);
  const tables = ["admins", "media_items", "login_codes"];
  for (const t of tables) {
    const r = await sql`SELECT to_regclass(${t}) AS c`;
    console.log(`${t}: ${r[0].c ?? "BELUM ADA"}`);
  }
}

main().catch((e) => {
  console.error("db:status gagal:", e?.message || e);
  process.exit(1);
});
