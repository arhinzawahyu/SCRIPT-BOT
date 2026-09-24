import { NextResponse } from "next/server";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set("wa_sess", "", { path: "/", maxAge: 0, secure: true, httpOnly: true, sameSite: "strict" });
  res.cookies.set("wa_pre", "", { path: "/", maxAge: 0, secure: true, httpOnly: true, sameSite: "strict" });
  return res;
}
