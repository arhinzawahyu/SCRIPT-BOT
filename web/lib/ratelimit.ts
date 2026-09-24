// ponytail: rate limit in-memory, pindah ke KV saat multi instance
const hits = new Map<string, number[]>();
const fails = new Map<string, number[]>();

function prune(map: Map<string, number[]>, now: number, windowMs: number) {
  for (const [k, arr] of map) {
    const fresh = arr.filter((t) => now - t < windowMs);
    if (fresh.length === 0) map.delete(k);
    else map.set(k, fresh);
  }
}

export function rateLimit(key: string, limit = 30, windowMs = 60_000): boolean {
  const now = Date.now();
  prune(hits, now, windowMs);
  const arr = hits.get(key) || [];
  if (arr.length >= limit) return false;
  arr.push(now);
  hits.set(key, arr);
  return true;
}

export function loginAllowed(ip: string): boolean {
  const now = Date.now();
  prune(fails, now, 10 * 60_000);
  return (fails.get(ip) || []).length < 10;
}

export function loginFailed(ip: string) {
  const arr = fails.get(ip) || [];
  arr.push(Date.now());
  fails.set(ip, arr);
}

export function loginReset(ip: string) {
  fails.delete(ip);
}
