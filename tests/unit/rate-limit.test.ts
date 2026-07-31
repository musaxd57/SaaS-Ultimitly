import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { prisma } from "../helpers/db";
import {
  rateLimit,
  clientIp,
  sweepExpiredRateLimits,
  __resetRateLimit,
  trustedProxyHops,
  pickClientHop,
  parseForwardedFor,
} from "@/lib/rate-limit";

// Dağıtık (DB-destekli) sabit-pencere limiter. Otorite Postgres satırı: limitler
// replikalar arasında ve deploy/restart sonrasında da tutar. DB hatasında yerel
// bellek sayacı devrede kalır (koruma asla tamamen kapanmaz).

describe("rateLimit (DB-backed)", () => {
  beforeEach(async () => {
    __resetRateLimit();
    await prisma.rateLimitCounter.deleteMany();
    vi.restoreAllMocks();
  });

  it("allows up to the limit, then blocks with a retry-after", async () => {
    const key = "k";
    for (let i = 0; i < 3; i++) {
      expect((await rateLimit(key, 3, 60_000)).ok).toBe(true);
    }
    const blocked = await rateLimit(key, 3, 60_000);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
    expect(blocked.retryAfter).toBeLessThanOrEqual(61);
  });

  it("tracks keys independently", async () => {
    expect((await rateLimit("a", 1, 60_000)).ok).toBe(true);
    expect((await rateLimit("a", 1, 60_000)).ok).toBe(false);
    expect((await rateLimit("b", 1, 60_000)).ok).toBe(true); // different key unaffected
  });

  it("resets after the window elapses (expired row is reset in place)", async () => {
    expect((await rateLimit("w", 1, 60_000)).ok).toBe(true);
    expect((await rateLimit("w", 1, 60_000)).ok).toBe(false);
    // Deterministic expiry: force the window end into the past instead of sleeping.
    await prisma.rateLimitCounter.update({
      where: { key: "w" },
      data: { resetAt: new Date(Date.now() - 1000) },
    });
    expect((await rateLimit("w", 1, 60_000)).ok).toBe(true);
    const row = await prisma.rateLimitCounter.findUniqueOrThrow({ where: { key: "w" } });
    expect(row.count).toBe(1); // fresh window, not a stale continuation
  });

  it("PARALEL isteklerde atomiktir: limit 5 iken 10 eşzamanlı istekten tam 5'i geçer", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => rateLimit("burst", 5, 60_000)),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    const row = await prisma.rateLimitCounter.findUniqueOrThrow({ where: { key: "burst" } });
    expect(row.count).toBe(10); // her hit sayıldı, karar count<=limit ile verildi
  });

  it("DB hatasında yerel bellek sayacına düşer — koruma tamamen kapanmaz", async () => {
    vi.spyOn(prisma, "$queryRaw").mockRejectedValue(new Error("db down"));
    expect((await rateLimit("fb", 2, 60_000)).ok).toBe(true);
    expect((await rateLimit("fb", 2, 60_000)).ok).toBe(true);
    const blocked = await rateLimit("fb", 2, 60_000);
    expect(blocked.ok).toBe(false); // bellek fallback'i de sınırı uyguluyor
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it("sweepExpiredRateLimits yalnız süresi geçmiş satırları siler", async () => {
    await prisma.rateLimitCounter.createMany({
      data: [
        { key: "old", count: 3, resetAt: new Date(Date.now() - 10 * 60_000) },
        { key: "live", count: 1, resetAt: new Date(Date.now() + 60_000) },
      ],
    });
    const swept = await sweepExpiredRateLimits();
    expect(swept).toBe(1);
    expect(await prisma.rateLimitCounter.findUnique({ where: { key: "old" } })).toBeNull();
    expect(await prisma.rateLimitCounter.findUnique({ where: { key: "live" } })).not.toBeNull();
  });
});

describe("clientIp", () => {
  it("uses the rightmost (trusted-proxy) x-forwarded-for hop, not the spoofable leftmost", () => {
    // "1.2.3.4" is client-supplied (spoofable); "5.6.7.8" is appended by the proxy.
    const req = new Request("http://x", { headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" } });
    expect(clientIp(req)).toBe("5.6.7.8");
    // A single value still works.
    expect(clientIp(new Request("http://x", { headers: { "x-forwarded-for": "9.9.9.9" } }))).toBe("9.9.9.9");
  });

  it("falls back to x-real-ip then 'unknown'", () => {
    expect(clientIp(new Request("http://x", { headers: { "x-real-ip": "9.9.9.9" } }))).toBe("9.9.9.9");
    expect(clientIp(new Request("http://x"))).toBe("unknown");
  });

  it("IGNORES cf-connecting-ip by default — a direct-to-origin client could set it freely", () => {
    const req = new Request("http://x", {
      headers: { "cf-connecting-ip": "3.3.3.3", "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    });
    expect(clientIp(req)).toBe("5.6.7.8"); // rightmost XFF hop (platform-appended)
  });

  it("IGNORES x-real-ip by default when XFF is present — flipping authority needs live-header verification", () => {
    const req = new Request("http://x", {
      headers: { "x-real-ip": "7.7.7.7", "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    });
    expect(clientIp(req)).toBe("5.6.7.8"); // today's behaviour pinned
  });

  it("prefers x-real-ip over XFF only when TRUST_X_REAL_IP=1 (verified Railway edge header)", () => {
    vi.stubEnv("TRUST_X_REAL_IP", "1");
    try {
      const req = new Request("http://x", {
        headers: { "x-real-ip": "7.7.7.7", "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
      });
      expect(clientIp(req)).toBe("7.7.7.7");
      // Absent/blank x-real-ip still falls back to the rightmost XFF hop.
      const noReal = new Request("http://x", { headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" } });
      expect(clientIp(noReal)).toBe("5.6.7.8");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("prefers cf-connecting-ip only when TRUST_CF_HEADER=1 (origin locked behind Cloudflare)", () => {
    vi.stubEnv("TRUST_CF_HEADER", "1");
    try {
      const req = new Request("http://x", {
        headers: { "cf-connecting-ip": "3.3.3.3", "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
      });
      expect(clientIp(req)).toBe("3.3.3.3");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

// ---------------------------------------------------------------------------
// GÜVENİLEN PROXY ADIMI (canlı gözlem, 2026-07-31).
//
// /admin teşhis kartı Railway'de gerçek zinciri gösterdi:
//   x-forwarded-for: 88.254.11.170, 152.233.12.245
//   88.254.11.170  → dynamic.ttnet.com.tr  = GERÇEK istemci
//   152.233.12.245 → datapacket.com        = Railway'in kendi edge'i
//
// Yani "en sağdakine güven" kuralı bu platformda HERKESİ tek adrese indiriyordu:
// bütün hız limitleri kişi başına değil GLOBAL çalışıyordu (bir saldırgan login
// kovasını doldurup tüm müşterileri 429'a düşürebilirdi). Doğru cevap sağdan
// `TRUSTED_PROXY_HOPS` kadar geri saymak. Default 1 = eski davranış, yani env
// verilmeden canlıda hiçbir şey değişmez.
// ---------------------------------------------------------------------------
describe("clientIp — TRUSTED_PROXY_HOPS", () => {
  afterEach(() => vi.unstubAllEnvs());

  const railwayChain = { "x-forwarded-for": "88.254.11.170, 152.233.12.245" };

  it("default (env yok) = 1 adım → bugünkü davranış birebir korunur", () => {
    expect(trustedProxyHops()).toBe(1);
    expect(clientIp(new Request("http://x", { headers: railwayChain }))).toBe("152.233.12.245");
  });

  it("hops=2 → Railway zincirinde GERÇEK istemciyi seçer", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "2");
    expect(clientIp(new Request("http://x", { headers: railwayChain }))).toBe("88.254.11.170");
  });

  it("SAHTE ADRES TAKLİT EDİLEMEZ: istemci sola ne eklerse eklesin doğru adım seçilir", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "2");
    // Saldırgan kendi isteğine XFF yazarsa zincir SOLDAN uzar; bizim proxy'lerimiz
    // hep en sağa yazdığı için sağdan sayım aynı adımı bulur.
    const spoofed = new Request("http://x", {
      headers: { "x-forwarded-for": "1.1.1.1, 2.2.2.2, 3.3.3.3, 88.254.11.170, 152.233.12.245" },
    });
    expect(clientIp(spoofed)).toBe("88.254.11.170");
  });

  it("FAIL-SAFE: zincir beklenenden kısaysa en sağdakine döner (taklit edilebilir değere DÜŞMEZ)", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "3");
    // Topoloji değişti / bir adım kayboldu: 3 bekliyoruz, 2 var. İstemcinin
    // yazdığı 88.254'e düşmek yerine en sağdaki altyapı adımında kalırız —
    // limit gevşer (herkes tek kova) ama kimse kimliğini seçemez.
    expect(clientIp(new Request("http://x", { headers: railwayChain }))).toBe("152.233.12.245");
  });

  it("bozuk/absürt env değerleri güvenli tarafa düşer", () => {
    for (const bad of ["", "0", "-3", "abc", "1.5"]) {
      vi.stubEnv("TRUSTED_PROXY_HOPS", bad);
      expect(trustedProxyHops(), bad).toBe(1);
    }
    // `0x2` / `2e0` / `2.9` gibi gevşek sayı yazımları da reddedilir: bir yazım
    // hatasının sessizce "2" okunması FAZLA-tahmin (tehlikeli) yönünde sapma
    // üretebilirdi. Anlamsız büyük değer de güvenli varsayılana düşer.
    for (const bad of ["0x2", "2e0", "2.9", "999", "two"]) {
      vi.stubEnv("TRUSTED_PROXY_HOPS", bad);
      expect(trustedProxyHops(), bad).toBe(1);
    }
    vi.stubEnv("TRUSTED_PROXY_HOPS", "10");
    expect(trustedProxyHops()).toBe(10); // makul üst sınır kabul edilir
  });

  it("pickClientHop saf fonksiyon olarak da doğru (teşhis kartı bunu önizliyor)", () => {
    expect(pickClientHop([], 2)).toBe("unknown");
    expect(pickClientHop(["a"], 1)).toBe("a");
    expect(pickClientHop(["a", "b"], 1)).toBe("b");
    expect(pickClientHop(["a", "b"], 2)).toBe("a");
    expect(pickClientHop(["a", "b", "c"], 2)).toBe("b");
  });

  it("parseForwardedFor boşlukları ve boş parçaları temizler", () => {
    expect(parseForwardedFor(" 1.1.1.1 ,, 2.2.2.2 ,")).toEqual(["1.1.1.1", "2.2.2.2"]);
  });

  it("PORT atılır: yoksa aynı istemcinin her bağlantısı ayrı kova olur (limit kapanır)", () => {
    expect(parseForwardedFor("203.0.113.7:51324, 152.233.12.245")).toEqual([
      "203.0.113.7",
      "152.233.12.245",
    ]);
    expect(parseForwardedFor("[2001:db8::1]:443, [2606:4700::1]:80")).toEqual([
      "2001:db8::1",
      "2606:4700::1",
    ]);
  });

  it("ÇIPLAK IPv6 bozulmaz (iki nokta bolluğu port sanılmamalı)", () => {
    expect(parseForwardedFor("2001:db8::1, 152.233.12.245")).toEqual(["2001:db8::1", "152.233.12.245"]);
    expect(parseForwardedFor("::1")).toEqual(["::1"]);
    expect(parseForwardedFor("[2001:db8::1]")).toEqual(["2001:db8::1"]);
  });

  it("⚠️ FAZLA TAHMİN TEHLİKELİ: hops gerçekten fazlaysa saldırgan seçilen adımı YAZAR", () => {
    // Bu test bir GÜVENCE değil, bir UYARIYI sözleşmeye çeviriyor. Fail-safe
    // yalnız zincir KISA olduğunda devreye girer; saldırgan zinciri beklenen
    // uzunluğa şişirirse devreye GİRMEZ ve seçilen adım onun yazdığı değerdir.
    // Bu yüzden hop sayısı ASLA fazla tahmin edilmemeli (az tahmin güvenli).
    vi.stubEnv("TRUSTED_PROXY_HOPS", "3");
    const padded = new Request("http://x", {
      // Altyapı gerçekte 1 adım ekliyor; saldırgan 2 sahte ekleyip 3'e tamamladı.
      headers: { "x-forwarded-for": "EVIL_A, EVIL_B, 152.233.12.245" },
    });
    expect(clientIp(padded)).toBe("EVIL_A");
    // Doğru ayarda (gerçek adım sayısı) aynı saldırı işe YARAMAZ:
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    expect(clientIp(padded)).toBe("152.233.12.245");
  });
});
