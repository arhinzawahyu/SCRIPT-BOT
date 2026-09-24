import { NextRequest, NextResponse } from "next/server";
import sql, { initDb } from "@/lib/db";

const KINDS = new Set(["viewonce", "status", "delete"]);
const MEDIA_TYPES = new Set(["image", "video", "audio", "text"]);

function boundedInt(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.trunc(parsed))) : fallback;
}

export async function GET(req: NextRequest) {
  const kind = req.nextUrl.searchParams.get("kind") || "viewonce";
  if (!KINDS.has(kind)) return NextResponse.json({ error: "bad kind" }, { status: 400 });
  const mediaType = req.nextUrl.searchParams.get("media_type") || "all";
  if (mediaType !== "all" && !MEDIA_TYPES.has(mediaType)) return NextResponse.json({ error: "bad media type" }, { status: 400 });
  const q = (req.nextUrl.searchParams.get("q") || "").trim().slice(0, 100);
  const limit = boundedInt(req.nextUrl.searchParams.get("limit"), 30, 1, 60);
  const offset = boundedInt(req.nextUrl.searchParams.get("offset"), 0, 0, 1_000_000);
  await initDb();
  const like = `%${q}%`;
  const rows = q && mediaType !== "all"
    ? await sql`SELECT id, kind, media_type, sender, sender_name, caption, mime, size_bytes AS size, created_at FROM media_items
      WHERE kind = ${kind} AND media_type = ${mediaType} AND (sender ILIKE ${like} OR sender_name ILIKE ${like} OR caption ILIKE ${like})
      ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`
    : q
      ? await sql`SELECT id, kind, media_type, sender, sender_name, caption, mime, size_bytes AS size, created_at FROM media_items
        WHERE kind = ${kind} AND (sender ILIKE ${like} OR sender_name ILIKE ${like} OR caption ILIKE ${like})
        ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`
      : mediaType !== "all"
        ? await sql`SELECT id, kind, media_type, sender, sender_name, caption, mime, size_bytes AS size, created_at FROM media_items
          WHERE kind = ${kind} AND media_type = ${mediaType} ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`
        : await sql`SELECT id, kind, media_type, sender, sender_name, caption, mime, size_bytes AS size, created_at FROM media_items
          WHERE kind = ${kind} ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`;
  const count = q && mediaType !== "all"
    ? await sql`SELECT COUNT(*)::int AS c FROM media_items WHERE kind = ${kind} AND media_type = ${mediaType} AND (sender ILIKE ${like} OR sender_name ILIKE ${like} OR caption ILIKE ${like})`
    : q
      ? await sql`SELECT COUNT(*)::int AS c FROM media_items WHERE kind = ${kind} AND (sender ILIKE ${like} OR sender_name ILIKE ${like} OR caption ILIKE ${like})`
      : mediaType !== "all"
        ? await sql`SELECT COUNT(*)::int AS c FROM media_items WHERE kind = ${kind} AND media_type = ${mediaType}`
        : await sql`SELECT COUNT(*)::int AS c FROM media_items WHERE kind = ${kind}`;
  return NextResponse.json({ items: rows, total: count[0].c }, { headers: { "Cache-Control": "private, no-store" } });
}
