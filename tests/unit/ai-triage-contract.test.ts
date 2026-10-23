import { describe, it, expect } from "vitest";
import {
  clampConfidence,
  clampTriageSource,
  packMissingInfo,
  parseMissingInfo,
  buildTriageData,
  isTriageStale,
  MISSING_INFO_MAX_ITEMS,
  MISSING_INFO_MAX_CHARS,
  ACTION_SUGGESTION_MAX_CHARS,
} from "@/lib/ai/triage";

// ---------------------------------------------------------------------------
// m48 — TRİYAJ SÖZLEŞMESİ (saf fonksiyonlar)
//
// Model çıktısı DAİMA daraltılır, asla olduğu gibi kabul edilmez. Bu dosya o
// daraltmanın her kenarını pinler; yazma yollarının entegrasyon testleri ayrı.
// ---------------------------------------------------------------------------

describe("clampConfidence — `typeof === number` YETMEZ", () => {
  it("🚨 NaN ve Infinity REDDEDİLİR (ikisinin de typeof'u 'number')", () => {
    // Bunlar geçseydi: arayüzde "%NaN" görünürdü VE ileride bir eşik
    // karşılaştırması (`aiConfidence < 0.5`) NaN ile DAİMA false döndüğü için
    // "düşük güvenlileri işaretle" özelliği sessizce hiç çalışmazdı.
    expect(clampConfidence(Number.NaN)).toBeNull();
    expect(clampConfidence(Number.POSITIVE_INFINITY)).toBeNull();
    expect(clampConfidence(Number.NEGATIVE_INFINITY)).toBeNull();
    // KONTROL: kapı "her şeyi reddet"e dönmedi.
    expect(clampConfidence(0.83)).toBe(0.83);
  });

  it("0..1 dışına ÇIKAMAZ (model 1.4 yazarsa arayüz %140 göstermez)", () => {
    expect(clampConfidence(1.4)).toBe(1);
    expect(clampConfidence(-0.2)).toBe(0);
    expect(clampConfidence(0)).toBe(0);
    expect(clampConfidence(1)).toBe(1);
  });

  it("sayı olmayan her şey NULL", () => {
    for (const v of ["0.9", null, undefined, {}, [], true]) {
      expect(clampConfidence(v)).toBeNull();
    }
  });
});

describe("clampTriageSource — kapalı set", () => {
  it("yalnız 'model' ve 'keyword' geçer; bilinmeyen NULL olur (uydurulmaz)", () => {
    expect(clampTriageSource("model")).toBe("model");
    expect(clampTriageSource("keyword")).toBe("keyword");
    for (const v of ["MODEL", "ai", "", null, 7]) expect(clampTriageSource(v)).toBeNull();
  });
});

describe("clampActionSuggestion — 300 karakter, trim, boş → NULL", () => {
  it("kırpar, kırpmadan önce trim eder, boşu NULL yapar", async () => {
    const { clampActionSuggestion } = await import("@/lib/ai/triage");
    expect(clampActionSuggestion("  " + "y".repeat(400) + "  ")).toHaveLength(300);
    expect(clampActionSuggestion("  kısa  ")).toBe("kısa");
    expect(clampActionSuggestion("   ")).toBeNull();
    expect(clampActionSuggestion(null)).toBeNull();
    expect(clampActionSuggestion(42)).toBeNull();
  });
});

describe("missingInfo — sözleşme kodla AYNI: 5 öğe × 80 karakter", () => {
  it("sınırlar `ai/index.ts` ile birebir", () => {
    // ⚠️ Tasarım belgesi bir dönem 5 × 120 diyordu; iki farklı sınır aynı
    // verinin iki farklı kırpılmış hâlini üretir ve hangisi doğru belirsizleşir.
    expect(MISSING_INFO_MAX_ITEMS).toBe(5);
    expect(MISSING_INFO_MAX_CHARS).toBe(80);
    expect(ACTION_SUGGESTION_MAX_CHARS).toBe(300);
  });

  it("6. öğe düşer, 81. karakter kesilir", () => {
    const packed = packMissingInfo(["a", "b", "c", "d", "e", "f"]);
    expect(parseMissingInfo(packed)).toEqual(["a", "b", "c", "d", "e"]);
    const long = packMissingInfo(["x".repeat(200)]);
    expect(parseMissingInfo(long)[0]).toHaveLength(80);
  });

  it("boş/geçersiz liste NULL olur (boş dizi YAZILMAZ)", () => {
    // "analiz var ama boş" ile "analiz yok" karıştırılmasın; ayrımı kaynak
    // kolonu taşıyor.
    expect(packMissingInfo([])).toBeNull();
    expect(packMissingInfo(["", "   "])).toBeNull();
    expect(packMissingInfo("dizi değil")).toBeNull();
    expect(packMissingInfo(null)).toBeNull();
    // Karışık dizide yalnız string'ler kalır.
    expect(parseMissingInfo(packMissingInfo(["foto", 42, null, "oda no"]))).toEqual([
      "foto",
      "oda no",
    ]);
  });
});

describe("parseMissingInfo — ASLA fırlatmaz (server component koruması)", () => {
  it("bozuk JSON, dizi-olmayan JSON ve null → [] (sayfa çizilmeye devam eder)", () => {
    // 🚨 Bu değer `/inbox` sayfasında okunuyor ve orası bir SERVER COMPONENT:
    // fırlayan bir istisna TÜM SAYFAYI 500'ler, yalnız o kartı değil.
    expect(parseMissingInfo("{bozuk")).toEqual([]);
    expect(parseMissingInfo('{"a":1}')).toEqual([]); // geçerli JSON, YANLIŞ şekil
    expect(parseMissingInfo("null")).toEqual([]);
    expect(parseMissingInfo(null)).toEqual([]);
    expect(parseMissingInfo("")).toEqual([]);
    // Dizi içinde string olmayanlar elenir — `.map()` patlamaz.
    expect(parseMissingInfo('["a",1,{"b":2}]')).toEqual(["a"]);
    // KONTROL: geçerli girdi GERÇEKTEN okunuyor. Bu olmadan "her zaman []"
    // mutasyonu da yeşil geçerdi.
    expect(parseMissingInfo('["foto","oda"]')).toEqual(["foto", "oda"]);
  });
});

describe("buildTriageData — HER alan AÇIKÇA yazılır", () => {
  const now = new Date("2026-08-09T10:00:00.000Z");

  it("🚨 kelime yolunda analiz alanları `null` — `undefined` DEĞİL", () => {
    // Prisma `undefined`i "bu kolona DOKUNMA" diye yorumlar. Kelime yolunda
    // alanlar atlanırsa ÖNCEKİ escalation'ın MODEL analizi hayatta kalır ve
    // arayüz onu YENİ analiz sanar. "Temizleme yok, ATOMİK YENİLEME var"
    // kararının tek anlamı budur.
    const d = buildTriageData({ source: "keyword", triggerMessageId: "m1", now });
    expect(d.aiActionSuggestion).toBeNull();
    expect(d.aiMissingInfoJson).toBeNull();
    expect(d.aiConfidence).toBeNull();
    // Altı anahtarın HEPSİ var (biri eksikse Prisma o kolona dokunmaz).
    expect(Object.keys(d).sort()).toEqual(
      [
        "aiActionSuggestion",
        "aiConfidence",
        "aiMissingInfoJson",
        "aiTriageSource",
        "aiTriageTriggerMessageId",
        "aiTriagedAt",
      ].sort(),
    );
    for (const v of Object.values(d)) expect(v).not.toBeUndefined();
  });

  it("model yolunda analiz alanları DOLAR ve kırpılır", () => {
    const d = buildTriageData({
      source: "model",
      actionSuggestion: "  " + "y".repeat(400) + "  ",
      missingInfo: ["foto", "oda"],
      confidence: 0.91,
      triggerMessageId: "m9",
      now,
    });
    expect(d.aiTriageSource).toBe("model");
    expect(d.aiActionSuggestion).toHaveLength(300);
    expect(parseMissingInfo(d.aiMissingInfoJson)).toEqual(["foto", "oda"]);
    expect(d.aiConfidence).toBe(0.91);
    expect(d.aiTriageTriggerMessageId).toBe("m9");
    expect(d.aiTriagedAt).toBe(now);
  });
});

describe("isTriageStale — fail-safe yön 'bayat say'", () => {
  const t0 = new Date("2026-08-09T10:00:00.000Z");
  const t1 = new Date("2026-08-09T11:00:00.000Z");

  it("tetikleyici mesaj SON inbound ile aynıysa TAZE, farklıysa BAYAT", () => {
    expect(
      isTriageStale({ triggerMessageId: "m1", latestInboundMessageId: "m1", triagedAt: t0, lastMessageAt: t0 }),
    ).toBe(false);
    expect(
      isTriageStale({ triggerMessageId: "m1", latestInboundMessageId: "m2", triagedAt: t0, lastMessageAt: t1 }),
    ).toBe(true);
  });

  // 🚨 BU İKİ VAKA OLMADAN id DALI PİNSİZDİ (kendi mutasyonum yakaladı, 08-09).
  // İlk yazımımda tüm fikstürler öyle seçilmişti ki id dalı ile damga dalı AYNI
  // cevabı veriyordu; `if (triggerMessageId && latest)` bloğunu tamamen silen
  // mutasyon YEŞİL geçti. Aşağıdakiler iki dalın ÇELİŞTİĞİ noktalar — id dalı
  // AUTORİTE olduğu için hüküm ondan gelir.
  it("id dalı damga dalını EZER: aynı mesaj ama damga sonrası lastMessageAt ilerlemiş → TAZE", () => {
    // Gerçek karşılığı: analiz son inbound mesaj için yazıldı, sonra bir
    // OUTBOUND mesaj `lastMessageAt`i ilerletti. Misafirden yeni bir şey
    // gelmedi → tavsiye hâlâ geçerli.
    expect(
      isTriageStale({ triggerMessageId: "m1", latestInboundMessageId: "m1", triagedAt: t0, lastMessageAt: t1 }),
    ).toBe(false);
  });

  it("id dalı damga dalını EZER: farklı mesaj ama damga daha yeni → BAYAT", () => {
    // Gerçek karşılığı: `count === 0` penceresi — triyaj ESKİ mesaja ait kaldı
    // ama satır sonradan başka bir yazmayla damgalandı. Misafirin son sözü
    // analiz edilmedi → tavsiyeye güvenilmez.
    expect(
      isTriageStale({ triggerMessageId: "m1", latestInboundMessageId: "m2", triagedAt: t1, lastMessageAt: t0 }),
    ).toBe(true);
  });

  it("id çözülemiyorsa damgaya düşer (mesaj anonimleşmiş/silinmiş olabilir)", () => {
    expect(
      isTriageStale({ triggerMessageId: null, latestInboundMessageId: null, triagedAt: t0, lastMessageAt: t1 }),
    ).toBe(true);
    expect(
      isTriageStale({ triggerMessageId: null, latestInboundMessageId: null, triagedAt: t1, lastMessageAt: t0 }),
    ).toBe(false);
  });

  it("🚨 hiçbir ölçü yoksa BAYAT sayılır — bilinmeyenin güvenli yönü", () => {
    expect(
      isTriageStale({ triggerMessageId: null, latestInboundMessageId: null, triagedAt: null, lastMessageAt: null }),
    ).toBe(true);
  });
});
