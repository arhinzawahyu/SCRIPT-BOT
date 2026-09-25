import { NextRequest, NextResponse } from "next/server";
import sql, { initDb } from "@/lib/db";
import { verifySession } from "@/lib/auth";
import { rateLimit } from "@/lib/ratelimit";
import { s3Enabled, s3Put, newObjectKey } from "@/lib/s3";

const KINDS = new Set(["viewonce", "status", "delete"]);
const MTYPES = new Set(["image", "video", "audio", "text"]);
// Batas upload manual: file langsung (bukan base64) agar hemat memori dan sesuai body Vercel.
const MAX_FILE = 4 * 1024 * 1024;
const MAX_CAPTION = 1000;

function magicOk(buf: Buffer, media_type: string, mime: string): boolean {
  if (media_type === "text") return true;
  if (buf.length < 12) return false;
  const hex = (n: number) => buf.subarray(0, n).toString("hex");
  if (media_type === "image") {
    if (hex(2) === "ffd8") return true;
    if (hex(8) === "89504e470d0a1a0a") return true;
    if (buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") return true;
    return mime === "image/jpeg" || mime === "image/png" || mime === "image/webp";
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
  const user = verifySession(req.cookies.get("wa_sess")?.value);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!rateLimit(`upload:${user}:${ip}`, 20, 60_000)) {
    return NextResponse.json({ error: "terlalu banyak upload, coba sebentar lagi" }, { status: 429 });
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "form tidak valid" }, { status: 400 });
  }
  const kind = String(form.get("kind") || "viewonce");
  if (!KINDS.has(kind)) return NextResponse.json({ error: "jenis arsip salah" }, { status: 400 });
  const mediaTypeRaw = String(form.get("media_type") || "");
  const autoType = kind === "delete" || kind === "status" ? "text" : "image";
  const media_type = mediaTypeRaw ? mediaTypeRaw : autoType;
  if (!MTYPES.has(media_type)) return NextResponse.json({ error: "jenis media salah" }, { status: 400 });
  const hasKindMedia = (kind === "delete" && media_type === "text") || kind !== "delete";
  if (!hasKindMedia) return NextResponse.json({ error: "jenis media tidak cocok" }, { status: 400 });

  const sender = String(form.get("sender") || "").slice(0, 32);
  const sender_name = String(form.get("sender_name") || form.get("name") || "").slice(0, 80);
  const caption = String(form.get("caption") || "").slice(0, MAX_CAPTION);
  const file = form.get("file");
  const isFile = typeof File !== "undefined" && file instanceof File && file.size > 0;
  if (media_type === "text" && !caption.trim()) {
    return NextResponse.json({ error: "teks wajib diisi" }, { status: 400 });
  }
  if (media_type !== "text" && !isFile) {
    return NextResponse.json({ error: "file wajib diisi" }, { status: 400 });
  }
  if (!s3Enabled()) {
    return NextResponse.json({ error: "storage belum dikonfigurasi" }, { status: 500 });
  }

  let mime = "text/plain";
  let buf: Buffer | null = null;
  if (isFile) {
    const f = file as File;
    if (f.size > MAX_FILE) {
      return NextResponse.json({ error: "file maksimal 4 MB" }, { status: 413 });
    }
    mime = (f.type || "").slice(0, 80) || (media_type === "video" ? "video/mp4" : media_type === "audio" ? "audio/ogg" : "image/jpeg");
    buf = Buffer.from(await f.arrayBuffer());
    if (!magicOk(buf, media_type, mime)) {
      return NextResponse.json({ error: "format file tidak didukung" }, { status: 415 });
    }
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
