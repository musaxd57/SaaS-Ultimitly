import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { planLimitsFor } from "@/lib/billing/plan-limits";
import { defaultPlans } from "@/lib/billing/plans";

// ---------------------------------------------------------------------------
// PLAN SINIRLARI — kullanıcı kararı (2026-07-31).
//
// Paketler artık üç ölçüyle ayrışıyor: daire sayısı, KULLANIM HACMİ ve destek.
// Bu dosya iki şeyi pinler:
//  1. Sayıların KENDİSİ (planlar arası sıralama bozulmasın, biri sessizce
//     düşürülüp müşteriye söylenmiş olandan az verilmesin).
//  2. Fiyat kartındaki metnin kodla UYUŞMASI — kartta "günde 500" yazıp kodda
//     150 uygulamak, müşteriye söylenen ile satılanın ayrışmasıdır.
// ---------------------------------------------------------------------------

describe("plan sınırları", () => {
  it("üç planın da sınırları tanımlı", () => {
    for (const code of ["free", "pro", "business"]) {
      const l = planLimitsFor(code);
      expect(l.kbItemsPerProperty, code).toBeGreaterThan(0);
      expect(l.aiCallsPerDay, code).toBeGreaterThan(0);
      expect(l.qrQuestionsPerPropertyPerDay, code).toBeGreaterThan(0);
    }
  });

  it("kullanıcının belirlediği KB sayıları: 15 / 30 / 60", () => {
    expect(planLimitsFor("free").kbItemsPerProperty).toBe(15);
    expect(planLimitsFor("pro").kbItemsPerProperty).toBe(30);
    expect(planLimitsFor("business").kbItemsPerProperty).toBe(60);
  });

  it("SIRALAMA bozulmaz: üst plan her ölçüde daha cömert", () => {
    const [a, b, c] = ["free", "pro", "business"].map(planLimitsFor);
    for (const key of ["kbItemsPerProperty", "aiCallsPerDay", "qrQuestionsPerPropertyPerDay"] as const) {
      expect(a[key], key).toBeLessThan(b[key]);
      expect(b[key], key).toBeLessThan(c[key]);
    }
  });

  it("tek kayıt karakter tavanı HER planda aynı — bu ayrışma ölçüsü değil, kaçış kapatıcıdır", () => {
    // Adet sınırı konunca kullanıcı her şeyi tek kayda doldurabilirdi.
    const caps = ["free", "pro", "business"].map((c) => planLimitsFor(c).kbCharsPerItem);
    expect(new Set(caps).size).toBe(1);
    expect(caps[0]).toBe(3_000); // kullanıcı kararı; eski 20.000 istemi şişirmeye yetiyordu
  });

  it("bilinmeyen plan kodu EN GENİŞ sınırlara düşer (mevcut müşteriyi kesme)", () => {
    // Kimlik kapılarında fail-closed doğru; KULLANIM kapılarında fail-open doğru —
    // grandfathered/kurucu hesap sessizce kısıtlanmamalı.
    const unknown = planLimitsFor("grandfathered");
    expect(unknown).toEqual(planLimitsFor("business"));
  });

  it("plan katalogundaki HER kod için sınır tanımlı (yeni plan eklenirse görünür)", () => {
    for (const p of defaultPlans()) {
      expect(Object.keys(planLimitsFor(p.code)).length, p.code).toBeGreaterThan(0);
      // business'e düşmüş olmamalı — kendi satırı olmalı.
      if (p.code !== "business") {
        expect(planLimitsFor(p.code), p.code).not.toEqual(planLimitsFor("business"));
      }
    }
  });
});

describe("fiyat kartı metni kodla uyuşuyor", () => {
  const landing = readFileSync(
    path.resolve(__dirname, "../../src/components/marketing/landing-page.tsx"),
    "utf8",
  );

  it("her planın AI ve KB sayıları kartta DOĞRU yazıyor", () => {
    const rows: [string, string, string][] = [
      ["free", "150", "15"],
      ["pro", "500", "30"],
      ["business", "1.500", "60"],
    ];
    for (const [code, aiText, kbText] of rows) {
      const l = planLimitsFor(code);
      // Kod ile metin aynı sayıyı söylüyor mu?
      expect(Number(aiText.replace(".", "")), code).toBe(l.aiCallsPerDay);
      expect(Number(kbText), code).toBe(l.kbItemsPerProperty);
      // Metin gerçekten kartta var mı?
      expect(landing, code).toContain(`Günde ${aiText} AI yanıtı`);
      expect(landing, code).toContain(`Daire başına ${kbText} bilgi kaydı`);
    }
  });
});

describe("sınırların uygulandığı yerler (kaynak-tarama pini)", () => {
  const read = (rel: string) => readFileSync(path.resolve(__dirname, "../../", rel), "utf8");

  it("bilgi tabanı kapısı hem ADET hem KARAKTER kontrolü yapıyor", () => {
    const src = read("src/app/api/kb/route.ts");
    expect(src).toContain("limitsForOrg");
    expect(src).toContain("kbItemsPerProperty");
    expect(src).toContain("kbCharsPerItem");
  });

  it("günlük AI bütçesi PLANDAN okuyor (sabit sayı değil)", () => {
    const src = read("src/lib/ai/daily-budget.ts");
    expect(src).toContain("limitsForOrg");
    expect(src).toContain("aiCallsPerDay");
  });

  it("QR günlük tavanı PLANDAN okuyor", () => {
    const src = read("src/app/api/chat/[token]/route.ts");
    expect(src).toContain("limitsForOrg");
    expect(src).toContain("qrQuestionsPerPropertyPerDay");
  });
});
