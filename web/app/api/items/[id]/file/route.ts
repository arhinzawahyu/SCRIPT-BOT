import { NextRequest, NextResponse } from "next/server";
import sql, { initDb } from "@/lib/db";
import { s3Get } from "@/lib/s3";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: RouteContext) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: "bad id" }, { status: 400 });
  await initDb();
  const rows = await sql`SELECT mime, s3_key FROM media_items WHERE id = ${id}`;
  if (rows.length === 0 || !rows[0].s3_key) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const dl = req.nextUrl.searchParams.get("download") === "1";
  const ext = String(rows[0].mime).includes("mp4") ? "mp4" : String(rows[0].mime).includes("ogg") || String(rows[0].mime).includes("audio") ? "ogg" : "jpg";
  try {
    const { body } = await s3Get(rows[0].s3_key as string);
    return new NextResponse(new Uint8Array(body), {
      headers: {
        "Content-Type": (rows[0].mime as string) || "application/octet-stream",
        "Cache-Control": "private, max-age=3600",
        "Content-Disposition": `${dl ? "attachment" : "inline"}; filename="wa-${id}.${ext}"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "storage gagal" }, { status: 502 });
  }
}
