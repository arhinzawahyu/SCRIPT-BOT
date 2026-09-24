export const USERNAME_RE = /^[a-z0-9_-]{3,32}$/;

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

async function check(cookie: string | undefined, wantStage: string, secret: string): Promise<string | null> {
  if (!cookie || !secret || secret.length < 32) return null;
  const parts = cookie.split(".");
  if (parts.length !== 4) return null;
  const [stage, user, expStr, sig] = parts;
  if (stage !== wantStage || !user || !USERNAME_RE.test(user)) return null;
  if (!/^\d+$/.test(expStr) || !/^[0-9a-f]{64}$/.test(sig)) return null;
  const expected = await hmacHex(secret, `${stage}.${user}.${expStr}`);
  if (sig.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;
  if (Number(expStr) < Math.floor(Date.now() / 1000)) return null;
  return user;
}

export function verifySessionEdge(cookie: string | undefined, secret: string): Promise<string | null> {
  return check(cookie, "full", secret);
}

export function verifyPreSessionEdge(cookie: string | undefined, secret: string): Promise<string | null> {
  return check(cookie, "pre", secret);
}
