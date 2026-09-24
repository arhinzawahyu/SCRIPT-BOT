import { NextRequest, NextResponse } from "next/server";
import sql, { initDb } from "@/lib/db";
import { rateLimit } from "@/lib/ratelimit";
import { s3Enabled, s3Put, newObjectKey } from "@/lib/s3";

const KINDS = new Set(["viewonce", "status", "delete"]);
const MTYPES = new Set(["image", "video", "audio", "text"]);
const MAX_BYTES = 8 * 1024 * 1024;

function magicOk(buf: Buffer, media_type: string, mime: string): boolean {
  if (media_type === "text") return true;
  if (buf.length < 12) return false;
  const hex = (n: number) => buf.subarray(0, n).toString("hex");
  if (media_type === "image") {
    if (hex(2) === "ffd8") return true; // jpeg
    if (hex(8) === "89504e470d0a1a0a") return true; // png
    if (buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") return true;
    return mime === "image/jpeg" || mime === "image/png" || mime === "image/webp" ? true : false;
  }
  if (media_type === "video") {
    return buf.subarray(4, 8).toString() === "ftyp" || mime === "video/mp4";
  }
  if (media_type === "audio") {
    return buf.subarray(0, 4).toString() === "OggS" || mime.startsWith("audio/");
  }
  return false;
}

export async function POST(req: NextRequest) {
  const secret = process.env.WEBHOOK_SECRET || "";
  const got = req.headers.get("x-webhook-secret") || "";
  if (!secret || got !== secret) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "bot";
  if (!rateLimit(`ingest:${ip}`, 60, 60_000)) {
    return NextResponse.json({ error: "rate limited" }, { status: 429 });
  }
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const kind = String(body.kind || body.type || "viewonce");
  if (!KINDS.has(kind)) return NextResponse.json({ error: "bad kind" }, { status: 400 });
  const media_type = MTYPES.has(body.media_type) ? body.media_type : kind === "delete" || kind === "status" ? "text" : "image";
  const sender = String(body.sender || "").slice(0, 32);
  const sender_name = String(body.name || body.sender_name || "").slice(0, 80);
  const caption = String(body.caption || "").slice(0, 1000);
  const mime = String(body.mime || (media_type === "video" ? "video/mp4" : media_type === "audio" ? "audio/ogg" : media_type === "text" ? "text/plain" : "image/jpeg")).slice(0, 80);
  let buf: Buffer | null = null;
  if (body.dataBase64) {
    try {
      buf = Buffer.from(String(body.dataBase64), "base64");
    } catch {
      return NextResponse.json({ error: "bad base64" }, { status: 400 });
    }
    if (buf.length > MAX_BYTES) {
      return NextResponse.json({ error: "file too large" }, { status: 413 });
    }
    if (!magicOk(buf, media_type, mime)) {
      return NextResponse.json({ error: "bad file signature" }, { status: 415 });
    }
  }
  if (!s3Enabled()) {
    return NextResponse.json({ error: "storage belum dikonfigurasi" }, { status: 500 });
  }
  await initDb();
  let s3_key: string | null = null;
  if (buf) {
    s3_key = newObjectKey(kind, mime);
    try {
      await s3Put(s3_key, buf, mime);
    } catch {
      return NextResponse.json({ error: "upload gagal" }, { status: 502 });
    }
  }
  const rows = await sql`
    INSERT INTO media_items (kind, media_type, sender, sender_name, caption, mime, s3_key, size_bytes)
    VALUES (${kind}, ${media_type}, ${sender}, ${sender_name}, ${caption}, ${mime}, ${s3_key as any}, ${buf ? buf.length : 0})
    RETURNING id`;
  return NextResponse.json({ ok: true, id: rows[0].id });
}
