import { NextResponse } from "next/server";

export async function POST() {
  const prod = process.env.NODE_ENV === "production";
  const res = NextResponse.json({ ok: true });
  res.cookies.set("wa_sess", "", { path: "/", maxAge: 0, secure: prod, httpOnly: true, sameSite: "lax" });
  res.cookies.set("wa_pre", "", { path: "/", maxAge: 0, secure: prod, httpOnly: true, sameSite: "lax" });
  return res;
}
