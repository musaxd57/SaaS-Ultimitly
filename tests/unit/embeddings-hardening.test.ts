import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  embedTexts,
  clearEmbeddingCache,
  embeddingCacheStats,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_CACHE_MAX,
  EMBEDDING_TOTAL_DEADLINE_MS,
} from "@/lib/ai/embeddings/provider";

// ---------------------------------------------------------------------------
// EMBEDDING SERTLEŞTİRME (kurucu iş emri 09-12) — üç madde UYGULANDI, iki madde
// ÖLÇÜLEREK REDDEDİLDİ. Gerekçeler kodda; burası DAVRANIŞ pini.
//
// 🚨 HÂLÂ ÜCRETLİ SERVİS ÇAĞRILMIYOR: her çağrı `fetch` MOCK'lu ve modülün
// üretimde çağıranı yok (mimari pin ayrı dosyada).
// ---------------------------------------------------------------------------

const unit = (seed = 3) => Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 0 ? seed : 0));
const okBody = (count: number) => ({
  data: Array.from({ length: count }, (_, index) => ({ index, embedding: unit() })),
});
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  clearEmbeddingCache();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("① ÖNBELLEK — aynı metin ikinci kez ÜCRET ÜRETMEZ", () => {
  it("🚨 ikinci çağrı ağa ÇIKMAZ ve AYNI vektörü verir", async () => {
    const f = vi.fn(async () => ok(okBody(1)));
    vi.stubGlobal("fetch", f);
    const a = await embedTexts(["havlular nerede"]);
    const b = await embedTexts(["havlular nerede"]);
    expect(f).toHaveBeenCalledTimes(1);
    expect(b).toEqual(a);
    expect(embeddingCacheStats()).toMatchObject({ hits: 1, misses: 1 });
  });

  it("KISMİ isabet: yalnız EKSİK metinler sağlayıcıya gider, sıra KORUNUR", async () => {
    // İlk çağrı "a"yı önbelleğe koyar.
    vi.stubGlobal("fetch", vi.fn(async () => ok({ data: [{ index: 0, embedding: unit(1) }] })));
    await embedTexts(["a"]);
    // İkinci çağrıda yalnız "b" istenmeli — ama sonuç ["a","b"] SIRASINDA dönmeli.
    const f = vi.fn(async (_u: unknown, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { input: string[] };
      expect(body.input).toEqual(["b"]); // 🚨 "a" TEKRAR İSTENMEZ
      return ok({ data: [{ index: 0, embedding: unit(5) }] });
    });
    vi.stubGlobal("fetch", f as unknown as typeof fetch);
    const out = await embedTexts(["a", "b"]);
    expect(f).toHaveBeenCalledTimes(1);
    expect(out).not.toBeNull();
    expect(out![0][0]).toBeCloseTo(1, 10); // "a" — önbellekten
    expect(out![1][0]).toBeCloseTo(1, 10); // "b" — ağdan
    expect(out).toHaveLength(2);
  });

  it("🚨 ANAHTAR İÇERİKTİR → BAYATLAMA İMKÂNSIZ (metin değişirse anahtar değişir)", async () => {
    const f = vi.fn(async () => ok(okBody(1)));
    vi.stubGlobal("fetch", f);
    await embedTexts(["wifi şifresi 1111"]);
    await embedTexts(["wifi şifresi 2222"]);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("🚨 ARIZA ÖNBELLEĞE GİRMEZ — sonraki çağrı yeniden dener", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    expect(await embedTexts(["x"])).toBeNull();
    const f = vi.fn(async () => ok(okBody(1)));
    vi.stubGlobal("fetch", f);
    expect(await embedTexts(["x"])).not.toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("MODEL değişirse önbellek çarpışmaz (anahtar modeli içerir)", async () => {
    const f = vi.fn(async () => ok(okBody(1)));
    vi.stubGlobal("fetch", f);
    await embedTexts(["aynı metin"]);
    vi.stubEnv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-large");
    await embedTexts(["aynı metin"]);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("TAVAN var — sınırsız büyümez (bellek sızıntısı yok)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok(okBody(1))));
    for (let i = 0; i < EMBEDDING_CACHE_MAX + 20; i++) await embedTexts([`metin ${i}`]);
    expect(embeddingCacheStats().size).toBeLessThanOrEqual(EMBEDDING_CACHE_MAX);
  });

  it("🚨 HAM MİSAFİR METNİ SAKLANMAZ — anahtar özettir", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok(okBody(1))));
    await embedTexts(["Ahmet Yılmaz 0532 111 22 33"]);
    const keys = embeddingCacheStats().sampleKeys.join(" ");
    expect(keys).not.toContain("Ahmet");
    expect(keys).not.toContain("0532");
    // Anti-vakumluk: gerçekten bir anahtar var.
    expect(embeddingCacheStats().size).toBe(1);
  });
});

describe("② TEKRAR DENEME — geçici arıza kaybedilmez, kalıcı arıza ısrar etmez", () => {
  it("🚨 429 TEKRAR DENENİR ve sonunda başarır", async () => {
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        n += 1;
        return n === 1 ? new Response("{}", { status: 429 }) : ok(okBody(1));
      }),
    );
    const out = await embedTexts(["x"]);
    expect(out).not.toBeNull();
    expect(n).toBe(2);
  });

  it("5xx tekrar denenir", async () => {
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        n += 1;
        return n < 3 ? new Response("{}", { status: 503 }) : ok(okBody(1));
      }),
    );
    expect(await embedTexts(["x"])).not.toBeNull();
    expect(n).toBe(3);
  });

  it("🚨 4xx TEKRAR DENENMEZ — kalıcı hatada ısrar hem para hem gecikme yakar", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 400 }));
    vi.stubGlobal("fetch", f);
    expect(await embedTexts(["x"])).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("401 de tekrar denenmez (kimlik hatası kendiliğinden düzelmez)", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 401 }));
    vi.stubGlobal("fetch", f);
    expect(await embedTexts(["x"])).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("DENEME SAYISI SINIRLI — sonsuza kadar denemez", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 500 }));
    vi.stubGlobal("fetch", f);
    expect(await embedTexts(["x"])).toBeNull();
    expect(f.mock.calls.length).toBeLessThanOrEqual(3);
    expect(f.mock.calls.length).toBeGreaterThan(1); // gerçekten denedi
  });

  it("🚨 TOPLAM SÜRE SINIRI VAR — misafir sonsuza kadar beklemez", () => {
    // Sözleşme sabiti: her deneme kendi zaman aşımına sahip OLSA BİLE toplam
    // bütçe aşılamaz. Sayı burada pinli ki bir gün sessizce 60 sn olmasın.
    expect(EMBEDDING_TOTAL_DEADLINE_MS).toBeLessThanOrEqual(10_000);
  });
});

describe("③ IN-PLACE NORMALİZASYON — davranış AYNEN, tahsis yok", () => {
  it("vektör hâlâ L2 normalize ve geçerlilik kapısı KORUNUYOR", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok(okBody(1))));
    const out = await embedTexts(["x"]);
    const norm = Math.sqrt(out![0].reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1, 10);
  });

  it("🚨 NaN/sıfır vektör REDDİ in-place'te de duruyor (bu bir GÜVENLİK kapısı)", async () => {
    // Kurucu "normalize gereksiz, OpenAI zaten normalize döndürüyor" dedi.
    // Ölçüldü: doğru ama EKSİK — bu fonksiyon aynı zamanda GEÇERLİLİK kapısı.
    const bad = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 0 ? NaN : 0));
    vi.stubGlobal("fetch", vi.fn(async () => ok({ data: [{ index: 0, embedding: bad }] })));
    expect(await embedTexts(["x"])).toBeNull();

    const zero = new Array(EMBEDDING_DIMENSIONS).fill(0);
    vi.stubGlobal("fetch", vi.fn(async () => ok({ data: [{ index: 0, embedding: zero }] })));
    expect(await embedTexts(["y"])).toBeNull();
  });
});
