// Lightweight in-memory rate limiter (fixed window). Protects sensitive
// endpoints (login, register, AI) from abuse and brute-force. Per-instance —
// good enough as a first line of defence; pair with a network/WAF layer for
// multi-instance guarantees.

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/**
 * Record one hit for `key` and report whether it is within `limit` per
 * `windowMs`. When the limit is exceeded, `retryAfter` (seconds) tells the
 * caller how long to wait.
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    sweep(now);
    return { ok: true, retryAfter: 0 };
  }

  if (bucket.count >= limit) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }

  bucket.count += 1;
  return { ok: true, retryAfter: 0 };
}

/** Best-effort client IP from common proxy headers (Railway/Vercel set these). */
export function clientIp(req: Request): string {
  // If Cloudflare sits in front of this request, it sets its OWN header with the
  // true edge-verified client IP — prefer it over X-Forwarded-For, which can grow
  // extra (still-spoofable) leftmost hops once a CF-terminated request reaches us.
  const cfIp = req.headers.get("cf-connecting-ip");
  if (cfIp?.trim()) return cfIp.trim();

  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    // Trust the RIGHTMOST hop (appended by the platform proxy, e.g. Railway), not
    // the leftmost which is client-supplied and trivially spoofable.
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1]!;
  }
  return req.headers.get("x-real-ip") ?? "unknown";
}

/** Test helper: clear all buckets. */
export function __resetRateLimit() {
  buckets.clear();
}

// Drop expired buckets occasionally so the map can't grow without bound.
function sweep(now: number) {
  if (buckets.size < 5000) return;
  for (const [key, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(key);
  }
}
