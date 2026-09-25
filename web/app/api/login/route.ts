import { NextRequest, NextResponse } from "next/server";
import sql, { initDb } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { createPreSession, USERNAME_RE } from "@/lib/auth";
import { newLoginCode, hashLoginCode, sealLoginCode } from "@/lib/loginCode";
import { loginAllowed, loginFailed, loginReset } from "@/lib/ratelimit";

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!loginAllowed(ip)) {
    return NextResponse.json({ error: "terlalu banyak percobaan, coba 10 menit lagi" }, { status: 429 });
  }
  const { username, password } = await req.json().catch(() => ({}));
  const name = String(username || "").trim().toLowerCase();
  if (!USERNAME_RE.test(name) || typeof password !== "string" || password.length < 1) {
    loginFailed(ip);
    return NextResponse.json({ error: "username atau password salah" }, { status: 401 });
  }
  await initDb();
  const rows = await sql`SELECT username, password_hash FROM admins WHERE username = ${name}`;
  if (rows.length === 0 || !verifyPassword(password, rows[0].password_hash as string)) {
    loginFailed(ip);
    return NextResponse.json({ error: "username atau password salah" }, { status: 401 });
  }
  loginReset(ip);
  const dbName = rows[0].username as string;
  // Bersihkan yang kedaluwarsa saja. Token valid dipakai ulang (bot bisa
  // membuatnya duluan saat connect), jadi JANGAN hapus milik user di sini.
  await sql`DELETE FROM login_codes WHERE expires_at < NOW()`;
  const existing = await sql`SELECT id FROM login_codes
    WHERE username = ${dbName} AND used = FALSE AND expires_at > NOW()
    ORDER BY id DESC LIMIT 1`;
  if (existing.length === 0) {
    const code = newLoginCode();
    let box: string;
    try {
      box = sealLoginCode(code);
    } catch {
      return NextResponse.json({ error: "server belum dikonfigurasi" }, { status: 500 });
    }
    await sql`INSERT INTO login_codes (username, code_hash, code_box, expires_at) VALUES (${dbName}, ${hashLoginCode(code)}, ${box}, NOW() + INTERVAL '1 hour')`;
  }
  let pre: string;
  try {
    pre = createPreSession(dbName);
  } catch {
    return NextResponse.json({ error: "server belum dikonfigurasi" }, { status: 500 });
  }
  const res = NextResponse.json({ ok: true, needToken: true });
  res.cookies.set("wa_pre", pre, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60,
  });
  return res;
}
