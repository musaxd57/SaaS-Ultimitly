import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  fieldTimeHits,
  __resetFieldTimeHitsCache,
  __fieldTimeHitsCacheStats,
  __setFieldTimeHitsCacheLimits,
} from "@/lib/ai/retrieval/time-fields";
import { buildKbIndex } from "@/lib/ai/retrieval/index-cache";

// ---------------------------------------------------------------------------
// SAAT OKUYUCUSU — SONUÇ ÖNBELLEĞİ + SAATSİZ CÜMLE ATLAMASI (09-28 CPU denetimi, ölçüldü). Okuyucu doğrusal ama pahalı (~10–16
// µs/karakter) ve aynı metni tekrar tekrar okuyordu: dizin her 10 dakikada bir parça parça, Bilgi Tabanı sayfası her açılışta tüm
// mülklerin kalemlerini, istem her cevapta. Ölçüm (tek çekirdek): 60 kalemlik gerçekçi bilgi tabanının dizini 1,4 sn (2k/kalem), 10,6
// sn (20k/kalem); kötü niyetli içerik ("1," × 20k) 19,7 sn — olay döngüsü TÜM kiracılar için kilitli. Önbellek + atlama ÇIKTIYI
// DEĞİŞTİRMEZ: eski ↔ yeni 29.719 metin × başlık × kategori karışımında fark 0 (09-28).
// ---------------------------------------------------------------------------

function ms(f: () => unknown): number {
  const t0 = performance.now();
  f();
  return performance.now() - t0;
}

const rep = (unit: string, n: number) => unit.repeat(Math.ceil(n / unit.length)).slice(0, n);

beforeEach(() => __resetFieldTimeHitsCache());
afterEach(() => __setFieldTimeHitsCacheLimits());

describe("önbellek", () => {
  it("🚨 aynı girdinin ikinci okuması hesaplanmaz (kötü niyetli 24k kalem: ilk okuma pahalı, ikincisi önbellekten)", () => {
    fieldTimeHits("ısınma", "Giriş 15:00, çıkış 11:00.", "general");
    const text = rep("1,", 24_000);
    const first = ms(() => fieldTimeHits("Kalem", text, "general"));
    const second = ms(() => fieldTimeHits("Kalem", text, "general"));
    expect(first).toBeGreaterThan(20); // gerçekten okundu (ölçüm anlamlı)
    expect(second).toBeLessThan(Math.min(10, first / 5));
  });

  it("🚨 dizin yeniden kurulurken (10 dakikalık önbellek süresi, her bilgi tabanı yazımı) aynı parçalar yeniden okunmaz", () => {
    const content = rep("Giriş saati 15:00, çıkış 11:00. Wi-Fi ağı Lale-5G. Otopark binanın arkasında, ücretsiz. Çöpler 20:00'den sonra. ", 6_000);
    const items = Array.from({ length: 20 }, (_, i) => ({ id: `k${i}`, title: `Kalem ${i}`, content: `${content} #${i}`, category: "general", updatedAt: new Date(1_700_000_000_000 + i) }));
    buildKbIndex(items.slice(0, 1) as never); // ısınma
    const first = ms(() => buildKbIndex(items as never));
    const second = ms(() => buildKbIndex(items as never));
    expect(first).toBeGreaterThan(30);
    expect(second).toBeLessThan(first / 2);
  });

  it("anahtar başlığı, metni ve kategoriyi AYIRIR (biri değişince önbellekten eski sonuç dönmez)", () => {
    const t = "Saat 15:00'te.";
    expect(fieldTimeHits("", t, "checkin").map((h) => h.field)).toEqual(["checkin"]);
    expect(fieldTimeHits("", t, "checkout").map((h) => h.field)).toEqual(["checkout"]);
    expect(fieldTimeHits("", t, null)).toEqual([]);
    expect(fieldTimeHits("", t, undefined)).toEqual([]);
    expect(fieldTimeHits("Giriş", "15:00", "general").map((h) => h.field)).toEqual(["checkin"]);
    expect(fieldTimeHits("Çıkış", "15:00", "general").map((h) => h.field)).toEqual(["checkout"]);
    expect(fieldTimeHits("Çıkış", "16:00", "general").map((h) => h.time)).toEqual(["16:00"]);
    // Birleştirme sınırı belirsiz değil: ("Giriş", "Çıkış 11:00") ≠ ("Giriş Çıkış", "11:00").
    expect(fieldTimeHits("Giriş", "Çıkış 11:00", "general").map((h) => h.field)).toEqual(["checkout"]);
    expect(fieldTimeHits("Giriş Çıkış", "11:00", "general")).toEqual([]);
  });

  it("dönüş YENİ kopya: çağıranın değişikliği önbelleği bozmaz (hesaplanan da önbellekten dönen de)", () => {
    const first = fieldTimeHits("Giriş", "Giriş 15:00.", "general");
    const snapshot = JSON.stringify(first);
    first[0].time = "03:00";
    first.push({ field: "checkout", time: "11:00", via: "clause", clause: "x" });
    const second = fieldTimeHits("Giriş", "Giriş 15:00.", "general"); // önbellekten
    expect(JSON.stringify(second)).toBe(snapshot);
    second[0].field = "checkout";
    second.length = 0;
    expect(JSON.stringify(fieldTimeHits("Giriş", "Giriş 15:00.", "general"))).toBe(snapshot);
  });

  it("üretim sınırları: 2.000 giriş, 4M karakter girdi", () => {
    expect(__fieldTimeHitsCacheStats().limits).toEqual({ entries: 2_000, chars: 4_000_000 });
  });

  it("sınırlı: giriş sayısı ve karakter toplamı aşılınca en eskisi çıkar (sınırlar testte küçültülür)", () => {
    __setFieldTimeHitsCacheLimits({ entries: 5, chars: 1_000 });
    // Uzunlukları farklı girdiler: yeniden hesaplanıp eklenen girdi karakter toplamını değiştirir (önbellekte mi, ölçülebilir).
    const small = (i: number) => `Giriş 15:00 ${"x".repeat(i)}`;
    for (let i = 0; i < 8; i++) fieldTimeHits("Giriş", small(i), "general");
    expect(__fieldTimeHitsCacheStats().entries).toBe(5);
    // En eskiler çıktı, en yeniler kaldı: #7 önbellekte (toplam değişmez), #0 değil (yeniden eklenir, en eskiyi çıkarır → değişir).
    const before = __fieldTimeHitsCacheStats().chars;
    fieldTimeHits("Giriş", small(7), "general");
    expect(__fieldTimeHitsCacheStats().chars).toBe(before);
    fieldTimeHits("Giriş", small(0), "general");
    expect(__fieldTimeHitsCacheStats().chars).not.toBe(before);
    // Kullanılan girdi tazelenir (en eski DEĞİL, en uzun süre kullanılmayan çıkar): şimdi sıra 4,5,6,7,0 → 4'e dokun → yeni girdi 5'i çıkarır.
    fieldTimeHits("Giriş", small(4), "general");
    fieldTimeHits("Giriş", small(9), "general");
    const afterTouch = __fieldTimeHitsCacheStats().chars;
    fieldTimeHits("Giriş", small(4), "general");
    expect(__fieldTimeHitsCacheStats().chars).toBe(afterTouch);
    __resetFieldTimeHitsCache();
    const text = (i: number) => `Giriş 15:00. ${"a ".repeat(140)}${i}`; // ~300 karakter
    for (let i = 0; i < 5; i++) fieldTimeHits("Giriş", text(i), "general");
    const stats = __fieldTimeHitsCacheStats();
    expect(stats.chars).toBeLessThanOrEqual(1_000);
    expect(stats.entries).toBe(3);
  });

  it("tavandan büyük tek girdi önbelleğe girmez (her şeyi silip yerleşmez)", () => {
    __setFieldTimeHitsCacheLimits({ chars: 1_000 });
    fieldTimeHits("Giriş", "Giriş 15:00 küçük", "general");
    const huge = `Giriş 15:00. ${"a ".repeat(600)}`;
    expect(fieldTimeHits("Giriş", huge, "general").map((h) => h.time)).toEqual(["15:00"]);
    expect(__fieldTimeHitsCacheStats().entries).toBe(1);
  });

  it("saat taşımayan metin önbelleğe girmez (okuma zaten yok)", () => {
    fieldTimeHits("Giriş", "Anahtar kutuda.", "general");
    fieldTimeHits("Giriş", "Giriş 15:00", "local_tips");
    expect(__fieldTimeHitsCacheStats().entries).toBe(0);
  });
});

describe("saatsiz cümle okunmaz", () => {
  it("🚨 20k karakterlik saatsiz cümleler + tek saatli cümle: yalnız saatli cümle çözümlenir", () => {
    fieldTimeHits("ısınma", "Giriş 15:00, çıkış 11:00.", "general");
    __resetFieldTimeHitsCache();
    // Cümleler TEKRARSIZ (tekrarlı dolgu çağrı içi notla zaten ucuzdu — atlama kaldırılınca bu pin yaşıyordu, mutasyon 09-28).
    const WORDS = ["otopark", "bahçe", "mutfak", "salon", "balkon", "çamaşır", "ütü", "havlu", "çarşaf", "yastık", "kilim", "perde"];
    const tag = (i: number) => {
      let s = "";
      for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(97 + ((n - 1) % 26)) + s;
      return s;
    };
    const filler = Array.from({ length: 700 }, (_, i) => `Not ${tag(i)}: ${WORDS[i % 12]} ve ${WORDS[(i * 7 + 3) % 12]} temiz, ${tag(i * 31 + 7)} tarafta.`).join(" ");
    expect(/\d/.test(filler)).toBe(false);
    const text = `Giriş 15:00. ${filler}`;
    let hits: ReturnType<typeof fieldTimeHits> = [];
    expect(ms(() => (hits = fieldTimeHits("Kurallar", text, "general")))).toBeLessThan(40);
    expect(hits.map((h) => [h.field, h.time])).toEqual([["checkin", "15:00"]]);
  });

  it("KONTROL — gece yarısı / noon sözcüklü cümle rakamsız da okunur", () => {
    expect(fieldTimeHits("Çıkış", "Otopark ücretsiz. Çıkış gece yarısı.", "general").map((h) => [h.field, h.time])).toEqual([["checkout", "00:00"]]);
    expect(fieldTimeHits("Check-out", "Parking is free. Check-out is at noon.", "general").map((h) => [h.field, h.time])).toEqual([["checkout", "12:00"]]);
  });
});
