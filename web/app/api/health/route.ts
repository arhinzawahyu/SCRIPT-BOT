import { NextResponse } from "next/server";
import { initDb } from "@/lib/db";

export async function GET() {
  try {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL belum diisi");
    if (!process.env.WEBHOOK_SECRET || process.env.WEBHOOK_SECRET.length < 32) throw new Error("WEBHOOK_SECRET belum diisi");
    if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) throw new Error("SESSION_SECRET belum diisi");
    if (!process.env.S3_BUCKET || !process.env.AWS_ENDPOINT_URL_S3) throw new Error("S3 belum dikonfigurasi");
    await initDb();
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
