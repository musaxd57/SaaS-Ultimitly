// Distributed fixed-window rate limiter. The AUTHORITY is a PostgreSQL counter
// row (one atomic INSERT ... ON CONFLICT per hit, decided on the DB clock), so
// limits hold across replicas AND survive deploys/restarts — the old in-memory
// map silently reset on both. The map is kept as a per-instance FALLBACK: if the
// DB is unreachable the endpoint still gets local protection instead of a 500
// (fail-open only across instances, never fully open).

import { prisma } from "@/lib/db";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

type Verdict = { ok: boolean; retryAfter: number };

/**
 * Record one hit for `key` and report whether it is within `limit` per
 * `windowMs`. When the limit is exceeded, `retryAfter` (seconds) tells the
 * caller how long to wait.
 *
 * One statement per hit: insert the row (fresh window) or, if it exists,
 * reset-in-place when expired else increment. All time math uses the DB clock
 * in UTC — `resetAt` is a Prisma-convention timestamp(3) storing UTC wall time,
 * so comparisons must use `now() AT TIME ZONE 'utc'`, NEVER bare `now()`
 * (session timezone would silently shift windows by hours).
 */
export async function rateLimit(key: string, limit: number, windowMs: number): Promise<Verdict> {
  const windowSeconds = windowMs / 1000;
  try {
    const rows = await prisma.$queryRaw<Array<{ count: number; retry: number }>>`
      INSERT INTO "RateLimitCounter" AS r ("key", "count", "resetAt")
      VALUES (
        ${key},
        1,
        (now() AT TIME ZONE 'utc') + make_interval(secs => ${windowSeconds}::float8)
      )
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE
          WHEN r."resetAt" <= (now() AT TIME ZONE 'utc') THEN 1
          ELSE r."count" + 1
        END,
        "resetAt" = CASE
          WHEN r."resetAt" <= (now() AT TIME ZONE 'utc')
            THEN (now() AT TIME ZONE 'utc') + make_interval(secs => ${windowSeconds}::float8)
          ELSE r."resetAt"
        END
      RETURNING
        r."count"::int AS count,
        CEIL(GREATEST(1, EXTRACT(EPOCH FROM (r."resetAt" - (now() AT TIME ZONE 'utc')))))::int AS retry
    `;
    const row = rows[0];
    if (!row) return memoryRateLimit(key, limit, windowMs); // defensive — RETURNING always yields 1 row
    if (Number(row.count) <= limit) return { ok: true, retryAfter: 0 };
    return { ok: false, retryAfter: Math.max(1, Number(row.retry)) };
  } catch (err) {
    warnDbUnavailable(err);
    return memoryRateLimit(key, limit, windowMs);
  }
}

// Throttled operational warning — a DB outage would otherwise log per request.
let lastDbWarnAt = 0;
function warnDbUnavailable(err: unknown) {
  const now = Date.now();
  if (now - lastDbWarnAt < 60_000) return;
  lastDbWarnAt = now;
  const msg = err instanceof Error ? `${err.name}: ${err.message.slice(0, 200)}` : "unknown";
  console.error(`[rate-limit] DB sayacına ulaşılamadı, yerel (instance-içi) sayaç devrede :: ${msg}`);
}

/** The old per-instance limiter, now the DB-error fallback. Same semantics. */
function memoryRateLimit(key: string, limit: number, windowMs: number): Verdict {
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

/**
 * Delete counters whose window ended (they would be reset-in-place on a next
 * hit anyway — this only bounds table size for keys that never return, e.g.
 * one-off IPs). Called from the scheduled sync; safe to run anywhere, anytime.
 */
export async function sweepExpiredRateLimits(now: Date = new Date()): Promise<number> {
  const r = await prisma.rateLimitCounter.deleteMany({
    where: { resetAt: { lt: new Date(now.getTime() - 60_000) } },
  });
  return r.count;
}

/** Best-effort client IP from common proxy headers (Railway/Vercel set these). */
export function clientIp(req: Request): string {
  // Cloudflare's edge-verified client IP — but ONLY when the deployment says the
  // origin is actually locked behind Cloudflare (TRUST_CF_HEADER=1). The Railway
  // app domain is reachable DIRECTLY (that's how the Paddle webhook works), and a
  // direct client can set cf-connecting-ip to any value per request, rotating its
  // rate-limit identity at will. Default OFF = trust only the rightmost XFF hop,
  // which the platform proxy appends and the client cannot control.
  if (process.env.TRUST_CF_HEADER === "1") {
    const cfIp = req.headers.get("cf-connecting-ip");
    if (cfIp?.trim()) return cfIp.trim();
  }

  // Railway documents X-Real-IP as the edge-set client IP; if its proxy chain
  // ever appends an INTERNAL hop as the rightmost XFF entry, every client would
  // collapse into one shared rate-limit bucket. TRUST_X_REAL_IP=1 makes
  // x-real-ip authoritative — but ONLY flip it after verifying a LIVE request's
  // headers on the actual deployment (Codex 07-24 #6): if the platform passed a
  // client-supplied x-real-ip through instead of overwriting it, trusting it
  // would let a client rotate its rate-limit identity per request. Default OFF
  // keeps today's rightmost-XFF behaviour.
  if (process.env.TRUST_X_REAL_IP === "1") {
    const realIp = req.headers.get("x-real-ip");
    if (realIp?.trim()) return realIp.trim();
  }

  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    // Trust the RIGHTMOST hop (appended by the platform proxy, e.g. Railway), not
    // the leftmost which is client-supplied and trivially spoofable.
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1]!;
  }
  return req.headers.get("x-real-ip") ?? "unknown";
}

/** Test helper: clear the in-memory fallback buckets (the DB rows are wiped by
 *  each test's resetDb). Kept synchronous — existing tests call it fire-and-forget. */
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
