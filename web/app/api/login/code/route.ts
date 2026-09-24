import { NextRequest, NextResponse } from "next/server";
import sql, { initDb } from "@/lib/db";
import { USERNAME_RE } from "@/lib/auth";
import { newLoginCode, hashLoginCode, openLoginCode, sealLoginCode } from "@/lib/loginCode";
import { rateLimit } from "@/lib/ratelimit";

function botAuth(req: NextRequest): boolean {
  const secret = process.env.WEBHOOK_SECRET || "";
  const got = req.headers.get("x-webhook-secret") || "";
  if (!secret || secret.length < 32 || !got || got.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ secret.charCodeAt(i);
  return diff === 0;
}

// Bot polling: ambil 1 box terbaru yang belum dikirim.
// Box dibuka dengan openLoginCode di server, lalu plaintext dikirim ke bot
// lewat koneksi ini saja. DB hanya simpan box terenkripsi + hash.
export async function GET(req: NextRequest) {
  if (!botAuth(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const username = String(req.nextUrl.searchParams.get("username") || "").trim().toLowerCase();
  await initDb();
  const rows = username && USERNAME_RE.test(username)
    ? await sql`SELECT id, username, code_box FROM login_codes
        WHERE username = ${username} AND sent = FALSE AND used = FALSE AND expires_at > NOW()
        ORDER BY id DESC LIMIT 1`
    : await sql`SELECT id, username, code_box FROM login_codes
        WHERE sent = FALSE AND used = FALSE AND expires_at > NOW()
        ORDER BY id DESC LIMIT 1`;
  if (rows.length === 0) return NextResponse.json({ pending: false });
  const code = openLoginCode(String(rows[0].code_box || ""));
  if (!code) {
    await sql`DELETE FROM login_codes WHERE id = ${rows[0].id}`;
    return NextResponse.json({ pending: false });
  }
  return NextResponse.json({ pending: true, id: rows[0].id, username: rows[0].username, code });
}

// Bot mint: buatkan 1 box token untuk owner (atau semua admin bila BOT_OWNER_USER
// kosong), umur 1 jam. Bot auth via x-webhook-secret. Anti-basi: token yang
// dibuat > 5 menit tapi belum dipakai langsung revoke + ganti baru, agar kode
// yang dikirim ke WA selalu segar.
export async function POST(req: NextRequest) {
  if (!botAuth(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "bot";
  if (!rateLimit(`code:${ip}`, 30, 60_000)) {
    return NextResponse.json({ error: "rate limited" }, { status: 429 });
  }
  await initDb();
  const body = await req.json().catch(() => ({} as any));
  const nameRaw = String(body.username || "").trim().toLowerCase().slice(0, 32);
  if (nameRaw && !USERNAME_RE.test(nameRaw)) {
    return NextResponse.json({ error: "bad username" }, { status: 400 });
  }

  // Bila lapor pengiriman: { username } atau { id } tanpa code
  // = tanda sudah dikirim. Harus sebutkan id spesifik agar tidak
  // menandai token lain yang baru dibuat.
  if (!body.mint) {
    const name = nameRaw;
    if (!USERNAME_RE.test(name)) return NextResponse.json({ error: "bad username" }, { status: 400 });
    const id = Number(body.id) || 0;
    if (id > 0) {
      await sql`UPDATE login_codes SET sent = TRUE, sent_at = NOW(), code_box = ''
        WHERE id = ${id} AND username = ${name} AND sent = FALSE AND used = FALSE AND expires_at > NOW()`;
    } else {
      await sql`UPDATE login_codes SET sent = TRUE, sent_at = NOW(), code_box = ''
        WHERE id = (SELECT id FROM login_codes WHERE username = ${name}
          AND sent = FALSE AND used = FALSE AND expires_at > NOW()
          ORDER BY id DESC LIMIT 1)`;
    }
    return NextResponse.json({ ok: true });
  }

  const targets: string[] = nameRaw
    ? [nameRaw]
    : (await sql`SELECT username FROM admins`).map((r: any) => String(r.username));
  const made: string[] = [];
  // Batas global: tanpa sesi login yang menunggu, token yang belum dipakai
  // tidak boleh menumpuk. Cegah spam WA saat bot reconnect berulang.
  const pendingCount = await sql`SELECT COUNT(*)::int AS c FROM login_codes
    WHERE sent = FALSE AND used = FALSE AND expires_at > NOW()`;
  if (Number(pendingCount[0]?.c || 0) >= 3) {
    return NextResponse.json({ ok: true, minted: [], skipped: "too-many-pending" });
  }
  for (const target of targets) {
    if (!USERNAME_RE.test(target)) continue;
    const valid = await sql`SELECT id FROM login_codes
      WHERE username = ${target} AND sent = FALSE AND used = FALSE AND expires_at > NOW()
      ORDER BY id DESC LIMIT 1`;
    if (valid.length > 0) {
      made.push(target);
      continue;
    }
    // Token yang sudah dikirim tapi belum dipakai = biarkan, user mungkin
    // sedang mengetik. Hanya hapus yang kedaluwarsa. JANGAN revoke umur
    // 5 menit: itu penyebab token lama jadi invalid lalu token baru
    // dibuat dan dikirim lagi = spam WA.
    await sql`DELETE FROM login_codes
      WHERE username = ${target} AND used = FALSE AND expires_at < NOW()`;
    const code = newLoginCode();
    let box: string;
    try {
      box = sealLoginCode(code);
    } catch {
      return NextResponse.json({ error: "server belum dikonfigurasi" }, { status: 500 });
    }
    await sql`INSERT INTO login_codes (username, code_hash, code_box, expires_at)
      VALUES (${target}, ${hashLoginCode(code)}, ${box}, NOW() + INTERVAL '1 hour')`;
    made.push(target);
  }
  return NextResponse.json({ ok: true, minted: made });
}
