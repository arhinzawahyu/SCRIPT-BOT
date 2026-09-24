import { NextRequest, NextResponse } from "next/server";
import sql, { initDb } from "@/lib/db";
import { verifyPassword, hashPassword } from "@/lib/password";
import { verifySession } from "@/lib/auth";
import { rateLimit } from "@/lib/ratelimit";

export async function POST(req: NextRequest) {
  const user = verifySession(req.cookies.get("wa_sess")?.value);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!rateLimit(`pw:${user}:${ip}`, 5, 10 * 60_000)) {
    return NextResponse.json({ error: "terlalu banyak percobaan, coba 10 menit lagi" }, { status: 429 });
  }
  const { oldPassword, newPassword } = await req.json().catch(() => ({}));
  if (typeof oldPassword !== "string" || typeof newPassword !== "string" || newPassword.length < 8 || newPassword.length > 200) {
    return NextResponse.json({ error: "password baru minimal 8 karakter" }, { status: 400 });
  }
  await initDb();
  const rows = await sql`SELECT password_hash FROM admins WHERE username = ${user}`;
  if (rows.length === 0 || !verifyPassword(oldPassword, rows[0].password_hash as string)) {
    return NextResponse.json({ error: "password lama salah" }, { status: 401 });
  }
  await sql`UPDATE admins SET password_hash = ${hashPassword(newPassword)} WHERE username = ${user}`;
  return NextResponse.json({ ok: true });
}
