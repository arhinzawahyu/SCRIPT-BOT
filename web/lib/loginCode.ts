import crypto from "crypto";

export function newLoginCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashLoginCode(code: string): string {
  return crypto.createHash("sha256").update(`wa-login:${code}`).digest("hex");
}

function relayKey(): Buffer {
  const s = process.env.WEBHOOK_SECRET || "";
  if (s.length < 32) throw new Error("WEBHOOK_SECRET belum diisi (min 32 karakter)");
  return crypto.createHash("sha256").update(s).digest();
}

// Box terenkripsi untuk relay via bot polling. DB bocor = box opaque saja.
export function sealLoginCode(code: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", relayKey(), iv);
  const enc = Buffer.concat([c.update(code, "utf8"), c.final(), c.getAuthTag()]);
  return `${iv.toString("base64")}.${enc.toString("base64")}`;
}

export function openLoginCode(box: string): string | null {
  try {
    const [ivB64, encB64] = String(box).split(".");
    const iv = Buffer.from(ivB64, "base64");
    const enc = Buffer.from(encB64, "base64");
    if (iv.length !== 12 || enc.length < 17) return null;
    const tag = enc.subarray(-16);
    const d = crypto.createDecipheriv("aes-256-gcm", relayKey(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc.subarray(0, -16)), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}
