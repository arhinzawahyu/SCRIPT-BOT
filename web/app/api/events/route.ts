import { NextRequest, NextResponse } from "next/server";
import sql, { initDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const KINDS = new Set(["viewonce", "status", "delete"]);

export async function GET(req: NextRequest) {
  const kind = req.nextUrl.searchParams.get("kind") || "viewonce";
  if (!KINDS.has(kind)) return NextResponse.json({ error: "bad kind" }, { status: 400 });
  const since = Math.max(Number(req.nextUrl.searchParams.get("since") || 0), 0) || 0;
  await initDb();
  if (!since) {
    const top = await sql`SELECT id FROM media_items WHERE kind = ${kind} ORDER BY id DESC LIMIT 1`;
    return NextResponse.json({ items: [], latest: (top[0]?.id as number) ?? 0 }, { headers: { "Cache-Control": "private, no-store" } });
  }
  const rows = await sql`SELECT id, media_type, sender, sender_name, caption, size_bytes AS size, created_at
    FROM media_items WHERE kind = ${kind} AND id > ${since} ORDER BY id ASC LIMIT 30`;
  return NextResponse.json({ items: rows, latest: rows.length ? rows[rows.length - 1].id : since }, { headers: { "Cache-Control": "private, no-store" } });
}
