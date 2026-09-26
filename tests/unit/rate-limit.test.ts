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

  it("XFF yokken x-real-ip'e DÜŞMEZ — bayrak kapalıyken o başlık taklit edilebilir", () => {
    // ⚠️ DAVRANIŞ BİLEREK DEĞİŞTİ (denetim, 2026-08-01). Eskiden XFF yoksa
    // `x-real-ip` okunuyordu — `TRUST_X_REAL_IP` bayrağı KAPALI olsa bile.
    // Bayrağın varlık sebebi tam olarak "bu başlık platformca eziliyor mu
    // bilmiyoruz"du; XFF taşımayan bir yolda (doğrudan origin bağlantısı ya da
    // ileride bir edge değişikliği) saldırgan her istekte başlığı değiştirip
    // hız-limiti kimliğini SINIRSIZCA döndürebilir, yani tüm per-IP limitleri
    // fiilen kapanırdı. "unknown" herkesi tek kovaya koyar: limit GEVŞER ama
    // TAKLİT EDİLEMEZ — yön kuralı gereği güvenli taraf.
    expect(clientIp(new Request("http://x", { headers: { "x-real-ip": "9.9.9.9" } }))).toBe(
      "unknown",
    );
    expect(clientIp(new Request("http://x"))).toBe("unknown");
  });

  it("bayrak AÇIKKEN x-real-ip yine kullanılabilir (kaçış kapısı duruyor)", () => {
    vi.stubEnv("TRUST_X_REAL_IP", "1");
    expect(clientIp(new Request("http://x", { headers: { "x-real-ip": "9.9.9.9" } }))).toBe(
      "9.9.9.9",
    );
    vi.unstubAllEnvs();
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

// ---------------------------------------------------------------------------
// P1 #7 (08-09 (2)) — SPOOFING / EKSİK-FAZLA HOP / DOĞRUDAN BAĞLANTI
//
// `TRUSTED_PROXY_HOPS` bir SAYI TAHMİNİ değil, bir GÜVEN SINIRI beyanıdır.
// Yanlış yönde hata etmenin bedeli asimetrik (CLAUDE.md): AZ tahmin güvenli
// (herkes tek kovaya düşer, kimlik seçilemez), FAZLA tahmin TEHLİKELİ
// (saldırgan zinciri tam beklenen uzunluğa getirip seçilen adımı kendi yazar).
// Bu blok o asimetriyi davranışsal olarak tutar.
// ---------------------------------------------------------------------------
describe("P1 #7 — XFF spoofing ve hop sınırları", () => {
  it("🚨 SOLDAN uzatma kimliği DEĞİŞTİREMEZ (istemci yalnız soldan ekleyebilir)", () => {
    // Saldırgan kendi isteğine 5 sahte adım ekler; Railway kendi adresini SAĞA
    // ekler. Sağdan sayım bu yüzden taklit edilemez.
    const honest = pickClientHop(["88.254.11.170", "152.233.12.245"], 2);
    const spoofed = pickClientHop(
      ["1.1.1.1", "2.2.2.2", "3.3.3.3", "4.4.4.4", "5.5.5.5", "88.254.11.170", "152.233.12.245"],
      2,
    );
    expect(spoofed).toBe(honest); // sahte adımlar seçimi kaydırmadı
    expect(spoofed).toBe("88.254.11.170");
  });

  it("🚨 ZİNCİR BEKLENENDEN KISAYSA en sağda kalınır — taklit edilebilir değere DÜŞÜLMEZ", () => {
    // Fail-safe yön: limit gevşer (herkes tek kovada) ama kimlik saldırgana
    // yazdırılmaz. `hops=3` beklerken 2 adım gelirse en sağdaki alınır.
    expect(pickClientHop(["1.2.3.4", "5.6.7.8"], 3)).toBe("5.6.7.8");
    expect(pickClientHop(["9.9.9.9"], 5)).toBe("9.9.9.9");
  });

  it("🚨 FAZLA tahmin edilen hop, saldırganın yazdığı adımı SEÇMEZ (zincir yeterince uzunsa)", () => {
    // Zincir gerçekten uzunsa hops=4 dördüncü adımı seçer. Bu TEHLİKELİ yön ve
    // testin amacı davranışı gizlemek değil GÖRÜNÜR kılmak: değeri büyütmenin
    // sonucu, saldırgan kontrolündeki bir adıma kayabilmektir.
    const chain = ["ATTACKER", "b", "c", "GERCEK", "EDGE"];
    expect(pickClientHop(chain, 2)).toBe("GERCEK");
    expect(pickClientHop(chain, 5)).toBe("ATTACKER"); // ⚠️ fazla tahminin bedeli
  });

  it("DOĞRUDAN bağlantı (XFF yok) kimlik uydurmaz", () => {
    const direct = clientIp(new Request("http://x"));
    expect(direct).toBe("unknown"); // herkes tek kovada — ama sahte kimlik YOK
  });

  it("boş / bozuk XFF de kimlik uydurmaz", () => {
    for (const v of ["", "   ", ",,,"]) {
      expect(clientIp(new Request("http://x", { headers: { "x-forwarded-for": v } }))).toBe("unknown");
    }
  });

  it("trustedProxyHops: geçersiz/aşırı değerler GÜVENLİ yöne clamp'lenir", () => {
    const cases: [string | undefined, number][] = [
      // 🚨 `"11"` → 1 (10 DEĞİL). Eski kod `Math.min(n, 10)` ile bir yazım
      // hatasını TEHLİKELİ yöne yuvarlıyordu; aralık dışı değer artık güvenli
      // varsayılana düşer. Ölçüldü: bu testi yazarken kod 10 döndürüyordu.
      [undefined, 1], ["", 1], ["abc", 1], ["0", 1], ["-3", 1], ["999", 1],
      ["2", 2], ["10", 10], ["11", 1], ["99", 1], ["2.9", 1], ["0x2", 1],
    ];
    for (const [raw, expected] of cases) {
      if (raw === undefined) vi.stubEnv("TRUSTED_PROXY_HOPS", "");
      else vi.stubEnv("TRUSTED_PROXY_HOPS", raw);
      expect(trustedProxyHops(), `TRUSTED_PROXY_HOPS=${JSON.stringify(raw)}`).toBe(expected);
    }
    vi.unstubAllEnvs();
  });
});

// ---------------------------------------------------------------------------
// P1 #7 — BOOT ENV DOĞRULAMASI: UYARIR, DURDURMAZ
//
// ⚠️ Bu ayrım BİLİNÇLİ ve test-pinli: `TRUSTED_PROXY_HOPS` eksik/geçersizse
// boot UYARIR ama DURMAZ. Bir env kazasında üretimin ayakta kalması, hız
// limitinin bir süre global çalışmasından daha önemli — ve "mevcut prod'u
// doğrulamadan boot'ta durduracak değişiklik pushlanmaz" (kullanıcı direktifi).
// Biri bunu `errors`a taşırsa test kırmızı olur ve kararı bilerek vermiş olur.
// ---------------------------------------------------------------------------
describe("P1 #7 — boot env kapısı uyarır, DURDURMAZ", () => {
  it("eksik ve geçersiz değerde UYARI üretir", async () => {
    const { checkProductionEnv } = await import("../../scripts/env-check.mjs");
    for (const env of [{}, { TRUSTED_PROXY_HOPS: "11" }, { TRUSTED_PROXY_HOPS: "abc" }]) {
      const r = checkProductionEnv({ ...env } as Record<string, string>);
      expect(r.warnings.some((w: string) => w.includes("TRUSTED_PROXY_HOPS")), JSON.stringify(env)).toBe(true);
    }
  });

  it("🚨 ASLA `errors`a girmez — boot durmaz", () => {
    // Kaynak taraması değil, davranış: hata listesinde bu anahtar GEÇMEMELİ.
    return import("../../scripts/env-check.mjs").then(({ checkProductionEnv }) => {
      for (const env of [{}, { TRUSTED_PROXY_HOPS: "11" }]) {
        const r = checkProductionEnv({ ...env } as Record<string, string>);
        expect(r.errors.some((e: string) => e.includes("TRUSTED_PROXY_HOPS"))).toBe(false);
      }
    });
  });

  it("KONTROL: geçerli değerde uyarı YOK (gürültü üretmez)", async () => {
    const { checkProductionEnv } = await import("../../scripts/env-check.mjs");
    const r = checkProductionEnv({ TRUSTED_PROXY_HOPS: "2" } as Record<string, string>);
    expect(r.warnings.some((w: string) => w.includes("TRUSTED_PROXY_HOPS"))).toBe(false);
  });
});
