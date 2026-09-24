import { NextResponse } from "next/server";
import sql, { initDb } from "@/lib/db";
import { s3Delete } from "@/lib/s3";

type RouteContext = { params: Promise<{ id: string }> };

export async function PUT(req: Request, { params }: RouteContext) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const { caption } = await req.json().catch(() => ({}));
  const text = String(caption ?? "").slice(0, 1000);
  await initDb();
  await sql`UPDATE media_items SET caption = ${text} WHERE id = ${id}`;
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: RouteContext) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: "bad id" }, { status: 400 });
  await initDb();
  const rows = await sql`DELETE FROM media_items WHERE id = ${id} RETURNING s3_key`;
  const key = rows.length > 0 ? (rows[0].s3_key as string | null) : null;
  if (key) {
    try { await s3Delete(key); } catch {}
  }
  return NextResponse.json({ ok: true });
}
