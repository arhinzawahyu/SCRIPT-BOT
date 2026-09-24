import crypto from "crypto";

const FULL_MAX_AGE = 12 * 60 * 60; // 12 jam
const PRE_MAX_AGE = 60 * 60; // 1 jam, samakan umur token login WA

export const USERNAME_RE = /^[a-z0-9_-]{3,32}$/;

function secret(): string {
  const s = process.env.SESSION_SECRET || "";
  if (!s || s.length < 32) throw new Error("SESSION_SECRET belum diisi (min 32 karakter)");
  return s;
}

function sign(value: string): string {
  return crypto.createHmac("sha256", secret()).update(value).digest("hex");
}

function makeToken(stage: string, username: string, maxAge: number): string {
  if (!USERNAME_RE.test(username)) throw new Error("bad username");
  const exp = Math.floor(Date.now() / 1000) + maxAge;
  const body = `${stage}.${username}.${exp}`;
  return `${body}.${sign(body)}`;
}

function checkToken(cookie: string | undefined, wantStage: string): string | null {
  try {
    if (!cookie) return null;
    const parts = cookie.split(".");
    if (parts.length !== 4) return null;
    const [stage, user, expStr, sig] = parts;
    if (stage !== wantStage || !user || !USERNAME_RE.test(user)) return null;
    const body = `${stage}.${user}.${expStr}`;
    const expected = sign(body);
    if (sig.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    if (Number(expStr) < Math.floor(Date.now() / 1000)) return null;
    return user;
  } catch {
    return null;
  }
}

export function createSession(username: string): string {
  return makeToken("full", username, FULL_MAX_AGE);
}

export function verifySession(cookie: string | undefined): string | null {
  return checkToken(cookie, "full");
}

export function createPreSession(username: string): string {
  return makeToken("pre", username, PRE_MAX_AGE);
}

export function verifyPreSession(cookie: string | undefined): string | null {
  return checkToken(cookie, "pre");
}
