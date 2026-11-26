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

  it("her planın AI, KB ve QR sayıları kartta DOĞRU yazıyor", () => {
    const rows: [string, string, string, string][] = [
      ["free", "150", "15", "50"],
      ["pro", "500", "30", "100"],
      ["business", "1.500", "60", "200"],
    ];
    for (const [code, aiText, kbText, qrText] of rows) {
      const l = planLimitsFor(code);
      // Kod ile metin aynı sayıyı söylüyor mu?
      expect(Number(aiText.replace(".", "")), code).toBe(l.aiCallsPerDay);
      expect(Number(kbText), code).toBe(l.kbItemsPerProperty);
      expect(Number(qrText), code).toBe(l.qrQuestionsPerPropertyPerDay);
      // Metin gerçekten kartta var mı?
      expect(landing, code).toContain(`Günde ${aiText} AI işlemi`);
      expect(landing, code).toContain(`Daire başına ${kbText} bilgi kaydı`);
      // QR kotası UYGULANIYORDU ama hiçbir yerde yazmıyordu — misafire "ev
      // sahibine ilettim" gidiyor ve host neden olduğunu göremiyordu.
      expect(landing, code).toContain(`QR concierge: daire başına günde ${qrText}`);
    }
  });

  it("KB sayısı AI'ın okuduğu tavanı AŞIYORSA kart bunu SÖYLEMEK zorunda", async () => {
    // İşletme 60 kayıt satıyor ama AI tek yanıtta en fazla KB_ITEM_CAP (30)
    // okuyor. "AI cevapları buradan üretir" demek, satılan 60'ın tamamının
    // kullanıldığını ima ederdi — müşteri parasının karşılığını almadığını
    // düşünür. Bu test, sayılardan biri değişirse metni yeniden yazmaya zorlar.
    const { KB_ITEM_CAP } = await import("@/lib/ai/prompts");
    for (const code of ["free", "pro", "business"]) {
      const l = planLimitsFor(code);
      if (l.kbItemsPerProperty <= KB_ITEM_CAP) continue;
      const row = landing.match(
        new RegExp(`Daire başına ${l.kbItemsPerProperty} bilgi kaydı[^"]*`),
      )?.[0];
      expect(row, `${code} satırı kartta yok`).toBeTruthy();
      expect(row, code).toContain(String(KB_ITEM_CAP));
    }
  });

  it("kart 'AI YANITI' DEMEZ — sayaç misafire giden yanıtı saymıyor", () => {
    // `consumeDailyAiBudget` yalnız panel içi işlemlerden çağrılıyor (öneri,
    // çeviri, test, hazırlık özeti); `applyChannelAutoReply` sayaca dokunmuyor.
    // "AI yanıtı" demek, müşterinin satın aldığını sandığı şeyle ölçülen şeyi
    // ayrıştırırdı — iade/itiraz üreten tipik senaryo (denetim, 07-31).
    expect(landing).not.toContain("AI yanıtı");
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
