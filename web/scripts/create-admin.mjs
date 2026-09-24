import crypto from "crypto";
import { neon } from "@neondatabase/serverless";
import fs from "fs";

function loadDotEnvLocal() {
  try {
    if (process.env.DATABASE_URL) return;
    const raw = fs.readFileSync(new URL("./../.env.local", import.meta.url), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (!m) continue;
      let v = m[2].trim().replace(/^"|"$/g, "");
      if (!process.env[m[1]]) process.env[m[1]] = v;
    }
  } catch {}
}
loadDotEnvLocal();

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

function validUser(u) {
  return /^[a-z0-9_-]{3,32}$/.test(u);
}

const user = String(process.env.ADMIN_USER || "").trim().toLowerCase();
const pass = process.env.ADMIN_PASS || "";
const url = process.env.DATABASE_URL || "";
if (!validUser(user)) {
  console.error("ADMIN_USER 3-32 char, huruf kecil/angka/_/-.");
  process.exit(1);
}
if (!url) {
  console.error("Set DATABASE_URL dulu.");
  process.exit(1);
}
if (pass.length < 8 || pass.length > 200) {
  console.error("ADMIN_PASS 8-200 karakter.");
  process.exit(1);
}
const sql = neon(url);
await sql`CREATE TABLE IF NOT EXISTS admins (
  id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())`;
await sql`INSERT INTO admins (username, password_hash) VALUES (${user}, ${hashPassword(pass)})
  ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash`;
console.log(`Admin "${user}" tersimpan. Hapus ADMIN_PASS dari env sekarang.`);
