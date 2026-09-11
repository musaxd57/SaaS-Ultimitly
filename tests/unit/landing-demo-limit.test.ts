import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEMO_HOURLY_LIMIT } from "@/lib/constants";

// ---------------------------------------------------------------------------
// LANDING DEMOSU — çip sayısı ↔ saatlik hak (kurucu, 2026-09-11:
// "saatlik 6 olduğunu belli ediyormuyuz çip sayısını 8e çıkar o zaman orda saatlik").
//
// 🚨 ÖLÇÜLEN KUSUR: hazır soru çipi sayısı (6) ile IP başına saatlik hak (6)
// BİREBİR eşitti — ziyaretçi altı çipin altısına tıklarsa kendi yazacağı tek
// soru için hak KALMIYORDU. Ve limit hiçbir yerde YAZMIYORDU: 429 metni
// "kısa bir süre bekleyin" diyordu, oysa pencere BİR SAAT.
// ---------------------------------------------------------------------------

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
const DEMO = "src/components/marketing/landing-demo.tsx";
const ROUTE = "src/app/api/demo/ai/route.ts";

describe("landing demo — çip sayısı ve saatlik hak", () => {
  it("🚨 SEKİZ çip var (kurucu isteği)", () => {
    const src = read(DEMO);
    const block = /const SAMPLES: string\[\] = \[([\s\S]*?)\n\];/.exec(src);
    expect(block, "SAMPLES dizisi bulunamadı").toBeTruthy();
    const chips = block![1].split("\n").filter((l) => l.trim().startsWith('"'));
    expect(chips.length).toBe(8);
  });

  it("🚨 SAATLİK HAK ÇİP SAYISINDAN BÜYÜK — tüm çiplere tıklayan ziyaretçinin hakkı kalır", () => {
    const src = read(DEMO);
    const block = /const SAMPLES: string\[\] = \[([\s\S]*?)\n\];/.exec(src)!;
    const chipCount = block[1].split("\n").filter((l) => l.trim().startsWith('"')).length;
    expect(DEMO_HOURLY_LIMIT).toBeGreaterThan(chipCount);
  });

  it("🚨 TEK KAYNAK: rota sabiti kullanır, çıplak sayı YAZMAZ", () => {
    const src = read(ROUTE);
    expect(src).toContain("DEMO_HOURLY_LIMIT");
    // Eski hâl: `rateLimit(..., 6, 60 * 60_000)` — sayı rotaya gömülüydü.
    expect(src).toMatch(/rateLimit\(`demo-ai:\$\{clientIp\(req\)\}`,\s*DEMO_HOURLY_LIMIT/);
  });

  it("🚨 LİMİT KULLANICIYA GÖRÜNÜR (aynı sabitten)", () => {
    const src = read(DEMO);
    expect(src).toContain("DEMO_HOURLY_LIMIT");
    expect(src).toMatch(/Saatte \{DEMO_HOURLY_LIMIT\} soru/);
  });

  // 🚨 BU PİN BU TURDA TERS ÇEVRİLDİ ve gerekçesi burada kalıyor.
  // Önce "bütçe doğrulamadan SONRA tüketilir" diye yazmıştım; YANLIŞTI. O depo
  // kuralı KİMLİKLİ rotalar içindir ve `leads`i AÇIKÇA istisna tutar: anonim
  // rotada rate limit bir KOTA değil KÖTÜYE KULLANIM KONTROLÜDÜR. `demo/ai`
  // `leads` ile aynı sınıftadır (kimliksiz, halka açık); sonraya alınca saldırgan
  // sınırsız geçersiz gövde yollayıp hiçbir bütçe tüketmeden rotayı dövebiliyordu.
  it("🚨 ANONİM ROTA: bütçe doğrulamadan ÖNCE tüketilir (kötüye kullanım kontrolü)", () => {
    const src = read(ROUTE);
    const validateAt = src.indexOf('badRequest({ message: "Bir mesaj yazın." })');
    const limitAt = src.indexOf("rateLimit(`demo-ai:");
    expect(validateAt, "doğrulama satırı bulunamadı").toBeGreaterThan(-1);
    expect(limitAt, "rateLimit çağrısı bulunamadı").toBeGreaterThan(-1);
    expect(limitAt).toBeLessThan(validateAt);
  });

  it("429 metni PENCEREYİ söyler ('kısa bir süre' değil)", () => {
    const src = read(ROUTE);
    expect(src).toMatch(/saatte \$\{DEMO_HOURLY_LIMIT\} soru/);
  });
});
