import { NextRequest, NextResponse } from "next/server";
import sql, { initDb } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { verifyPreSession, createSession } from "@/lib/auth";
import { hashLoginCode } from "@/lib/loginCode";
import { loginAllowed, loginFailed, loginReset } from "@/lib/ratelimit";
import crypto from "crypto";

export async function GET(req: NextRequest) {
  const user = verifyPreSession(req.cookies.get("wa_pre")?.value);
  if (!user) return NextResponse.json({ pending: false }, { status: 401 });
  await initDb();
  const rows = await sql`SELECT sent FROM login_codes
    WHERE username = ${user} AND used = FALSE AND expires_at > NOW()
    ORDER BY id DESC LIMIT 1`;
  if (rows.length === 0) return NextResponse.json({ pending: true });
  return NextResponse.json({ pending: !rows[0].sent });
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!loginAllowed(ip)) {
    return NextResponse.json({ error: "terlalu banyak percobaan, coba 10 menit lagi" }, { status: 429 });
  }
  const preUser = verifyPreSession(req.cookies.get("wa_pre")?.value);
  if (!preUser) {
    return NextResponse.json({ error: "sesi tahap satu kedaluwarsa, ulangi dari awal" }, { status: 401 });
  }
  const { username, password, token } = await req.json().catch(() => ({}));
  if (String(username || "").trim().toLowerCase() !== preUser || typeof password !== "string" || !/^\d{6}$/.test(String(token))) {
    loginFailed(ip);
    return NextResponse.json({ error: "username atau password salah" }, { status: 401 });
  }
  await initDb();
  const admins = await sql`SELECT username, password_hash FROM admins WHERE username = ${preUser}`;
  if (admins.length === 0 || !verifyPassword(password, admins[0].password_hash as string)) {
    loginFailed(ip);
    return NextResponse.json({ error: "username atau password salah" }, { status: 401 });
  }
  const codes = await sql`SELECT id, code_hash, attempts FROM login_codes
    WHERE username = ${preUser} AND used = FALSE AND expires_at > NOW()
    ORDER BY id DESC LIMIT 1`;
  if (codes.length === 0) {
    return NextResponse.json({ error: "token kedaluwarsa, ulangi dari awal" }, { status: 401 });
  }
  const row = codes[0] as any;
  if (Number(row.attempts) >= 5) {
    await sql`DELETE FROM login_codes WHERE id = ${row.id}`;
    loginFailed(ip);
    return NextResponse.json({ error: "token dikunci, ulangi dari awal" }, { status: 429 });
  }
  const got = hashLoginCode(String(token));
  const want = String(row.code_hash);
  const ok = got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
  if (!ok) {
    await sql`UPDATE login_codes SET attempts = attempts + 1 WHERE id = ${row.id}`;
    loginFailed(ip);
    return NextResponse.json({ error: "username atau password salah" }, { status: 401 });
  }
  await sql`DELETE FROM login_codes WHERE username = ${preUser}`;
  loginReset(ip);
  let full: string;
  try {
    full = createSession(preUser);
  } catch {
    return NextResponse.json({ error: "server belum dikonfigurasi" }, { status: 500 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set("wa_sess", full, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: 12 * 60 * 60,
  });
  res.cookies.set("wa_pre", "", { path: "/", maxAge: 0 });
  return res;
}
