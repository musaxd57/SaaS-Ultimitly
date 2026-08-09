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

/** Best-effort client IP from common proxy headers (Railway/Vercel set these).
 *  Takes anything that carries `headers` (NextRequest, Request, or the server
 *  component `headers()` result) so the operator diagnostics card can show the
 *  SAME answer the rate limiter uses — a second implementation would drift. */
export function clientIp(req: { headers: Headers }): string {
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
    const parts = parseForwardedFor(xff);
    if (parts.length) return pickClientHop(parts, trustedProxyHops());
  }
  // ⚠️ BAYRAK KAPALIYKEN `x-real-ip`'E DÜŞÜLMEZ (denetim, 08-01). Bayrağın
  // varlık sebebi "bu başlık platformca eziliyor mu bilmiyoruz" — ama XFF
  // taşımayan bir istekte bayrak yokmuş gibi davranılıyordu. Böyle bir yolda
  // (doğrudan origin bağlantısı, ya da ileride bir edge değişikliği) saldırgan
  // her istekte başlığı değiştirip hız-limiti kimliğini SINIRSIZCA döndürebilir,
  // yani tüm per-IP limitleri fiilen kapanır. "unknown" ise herkesi tek kovaya
  // koyar: limit GEVŞER ama TAKLİT EDİLEMEZ — yön kuralı gereği güvenli taraf.
  return "unknown";
}

/**
 * Tek bir XFF adımını kimlik olarak kullanılabilir hâle getir: köşeli parantezi
 * ve PORTU at.
 *
 * NEDEN ÖNEMLİ: port bırakılırsa aynı istemcinin her TCP bağlantısı AYRI bir
 * limit kovası olur — yani o istemci için hız limiti fiilen kapanır. Bugün
 * gözlenen zincirde port yok, ama seçilen adım artık en dıştaki proxy'nin
 * istemci için yazdığı giriş (hop sayımı sonrası) ve port taşıyabilecek olan tam
 * da odur.
 *
 *  `[2001:db8::1]:443` → `2001:db8::1`   (parantezli IPv6 + port)
 *  `[2001:db8::1]`     → `2001:db8::1`
 *  `203.0.113.7:51324` → `203.0.113.7`   (IPv4 + port: TEK iki nokta)
 *  `2001:db8::1`       → `2001:db8::1`   (çıplak IPv6: ≥2 iki nokta, DOKUNMA)
 */
function normalizeForwardedHop(raw: string): string {
  if (!raw) return "";
  if (raw.startsWith("[")) {
    const end = raw.indexOf("]");
    return end > 1 ? raw.slice(1, end) : raw;
  }
  const first = raw.indexOf(":");
  // Tek iki nokta = "adres:port". Birden fazlaysa çıplak IPv6'dır, bölmek bozar.
  if (first > 0 && first === raw.lastIndexOf(":")) return raw.slice(0, first);
  return raw;
}

/** `a, b, c` → ["a","b","c"] (boş parçalar atılır, port/parantez temizlenir). */
export function parseForwardedFor(xff: string): string[] {
  return xff.split(",").map((s) => normalizeForwardedHop(s.trim())).filter(Boolean);
}

/**
 * Kaç proxy'nin X-Forwarded-For'a KENDİ gördüğü adresi eklediği. Yalnız BİZİM
 * altyapımızın eklediği adımlar sayılır — istemci ancak SOLA ekleme yapabilir,
 * sağdaki N adımı yazan hep bizim proxy'lerimizdir.
 *
 * Default 1 = "en sağdakine güven" (bugüne kadarki davranış). Railway'de canlı
 * zincir `<istemci>, <railway-edge>` biçiminde iki adım olduğu için doğru değer
 * 2'dir; env verilmeden davranış DEĞİŞMEZ.
 *
 * ⚠️ HANGİ YÖNDE YANILMAK GÜVENLİ: DÜŞÜK tahmin güvenli, YÜKSEK tahmin tehlikeli.
 *  • Az sayarsan (gerçek 3, sen 2) altyapının bir adresini seçersin → herkes tek
 *    kovaya düşer; limit gevşer ama kimse kimliğini SEÇEMEZ.
 *  • Fazla sayarsan (gerçek 2, sen 3) saldırgan zincire tam 1 sahte adres ekleyip
 *    uzunluğu beklentine getirir ve seçilen adım ONUN yazdığı değer olur → her
 *    istekte kimlik değiştirip limiti tamamen atlar.
 * Bu yüzden emin değilsen KÜÇÜK değer seç; /admin teşhis kartı hangi ayarın hangi
 * adresi seçtiğini önizler, karar oradan verilir.
 *
 * NOT (2026-07-31 araştırma): Railway'in edge'inin istemcinin gönderdiği XFF'i
 * SİLİP silmediği topluluk kaynaklarında ÇELİŞKİLİ, resmî sayfalar da okunamadı.
 * Sağdan sayım bu soruya BAĞIMLI DEĞİL: edge siliyorsa zincir zaten `<istemci>,
 * <edge>`; silmiyorsa saldırganın eklediği çöp SOLDA birikir ve sağdan sayım yine
 * doğru adımı bulur. "En soldakini al" kuralı ise yalnız silme doğruysa güvenli —
 * o yüzden bilerek seçilmedi.
 */
export function trustedProxyHops(): number {
  // SIKI ayrıştırma: `Number()` gevşektir (`0x2`→2, `2e0`→2, `2.9`→2) ve bir
  // yazım hatasının sessizce "2" olarak okunması, güvenlik açısından fazla-tahmin
  // yönünde (tehlikeli yön) bir sapma üretebilirdi. Yalnız düz tam sayı kabul,
  // gerisi güvenli varsayılana (1) düşer.
  const raw = process.env.TRUSTED_PROXY_HOPS?.trim();
  if (!raw || !/^\d{1,2}$/.test(raw)) return 1;
  const n = Number(raw);
  // 🚨 ARALIK DIŞI DEĞER 10'A CLAMP'LENMEZ, 1'E DÜŞER (P1 #7, 08-09 (2)).
  //
  // Eski hâl `Math.min(n, 10)` idi ve bir YAZIM HATASINI TEHLİKELİ YÖNE
  // yuvarlıyordu: `"11"` → 10, yani "on adım geri say". Bu dosyanın kendi
  // asimetri kuralı bunun tersini söylüyor — AZ tahmin güvenli (herkes tek
  // kovaya düşer, kimlik seçilemez), FAZLA tahmin TEHLİKELİ (saldırgan zinciri
  // beklenen uzunluğa getirip seçilen adımı KENDİ yazar). Bir tavan aşımı
  // "kullanıcı ne istediğini biliyor" değil "değer bozuk" demektir ve bozuk
  // değerin gideceği yer güvenli varsayılandır.
  //
  // ⚠️ CANLIDA ETKİSİ YOK: Railway'de `TRUSTED_PROXY_HOPS=2`. Bu satır yalnız
  // 11+ yazan bir yazım hatasının sonucunu değiştirir.
  return n >= 1 && n <= 10 ? n : 1;
}

/**
 * Zincirden istemcinin adresini seç.
 *
 * NEDEN SAĞDAN SAYIYORUZ: istemci istediği kadar sahte adresi SOLA ekleyebilir;
 * sağdaki adımları bizim proxy'lerimiz yazar ve taklit edilemez. `hops` kadar
 * adımı geriye sayınca, dış proxy'mizin GÖRDÜĞÜ adres çıkar.
 *
 * FAIL-SAFE: zincir beklenenden KISAysa (topoloji değişti, bir adım kayboldu)
 * istemcinin yazdığı bir değere düşmek yerine en sağdakine döneriz — o zaman
 * herkes tek kovaya düşer (limit gevşer) ama kimse kimliğini taklit EDEMEZ.
 * Yanlış yönün güvenli tarafı budur.
 */
export function pickClientHop(parts: string[], hops: number): string {
  if (parts.length === 0) return "unknown";
  if (parts.length < hops) return parts[parts.length - 1]!;
  return parts[parts.length - hops]!;
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
