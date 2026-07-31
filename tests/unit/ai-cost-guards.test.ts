import { describe, it, expect, afterEach, vi } from "vitest";
import { KB_ITEM_CAP, KB_CHAR_BUDGET, packKnowledgeBase } from "@/lib/ai/prompts";
import { dailyAiCallCap } from "@/lib/ai/daily-budget";
import { readFileSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// AI MALİYET TAVANLARI.
//
// Denetimde ölçüldü: kod tabanında hiçbir yerde günlük/toplam AI harcama tavanı
// YOKTU. Dakikalık limitler tek isteği yavaşlatır ama toplamı sınırlamaz — bir
// hesap günde on binlerce çağrı yapabiliyordu. Ayrıca istem BOYUTUNUN da tavanı
// yoktu: bilgi tabanı kalemi 20.000 karaktere kadar çıkabiliyor ve `/api/ai/test`
// kalemleri sınırsız çekiyordu. Yani saldırgan hem çağrı sayısını HEM çağrı
// başına maliyeti kontrol edebiliyordu.
//
// Bu dosya iki tavanı da sözleşmeye çevirir.
// ---------------------------------------------------------------------------

describe("bilgi tabanı istem bütçesi", () => {
  const item = (n: number, len: number) => ({
    category: "general",
    title: `k${n}`,
    content: "x".repeat(len),
  });

  it("boş bilgi tabanı açıkça belirtilir (model 'bilgim yok' diye uydurmasın)", () => {
    const { text, omitted } = packKnowledgeBase([]);
    expect(text).toContain("bilgi tabanı boş");
    expect(omitted).toBe(0);
  });

  it("bütçe içindeki kalemlerin HEPSİ geçer, hiçbiri kırpılmaz", () => {
    const items = [item(1, 100), item(2, 100), item(3, 100)];
    const { text, omitted } = packKnowledgeBase(items);
    expect(omitted).toBe(0);
    for (const i of items) expect(text).toContain(i.title);
  });

  it("KARAKTER bütçesi aşılırsa kesilir — adet tavanı tek başına maliyeti sınırlamaz", () => {
    // 30 kalem × 20.000 karakter = 600.000 karakter; adet tavanı bunu durdurmaz.
    const items = Array.from({ length: KB_ITEM_CAP }, (_, i) => item(i, 20_000));
    const { text, omitted } = packKnowledgeBase(items);
    expect(omitted).toBeGreaterThan(0);
    expect(text.length).toBeLessThan(KB_CHAR_BUDGET + 20_000 + 500); // 1 kalem + not payı
  });

  it("KESME MODELE SÖYLENİR: atlanan kalem varsa 'bilgi yok' demesi YASAKLANIR", () => {
    const items = Array.from({ length: 5 }, (_, i) => item(i, 20_000));
    const { text, omitted } = packKnowledgeBase(items);
    expect(omitted).toBeGreaterThan(0);
    expect(text).toContain("insana devret");
    expect(text).toMatch(/\d+ kalemi yer sınırı/);
  });

  it("tek kalem bütçeden büyükse yine de geçer (boş bağlam göndermektense)", () => {
    const { text, omitted } = packKnowledgeBase([item(1, KB_CHAR_BUDGET * 2)]);
    expect(omitted).toBe(0);
    expect(text).toContain("k1");
  });

  it("adet tavanı TEK KAYNAKTAN okunuyor — iki AI rotası da aynı sabiti kullanır", () => {
    // Kardeş rotalar ayrışırsa test kartı üretimi yanlış temsil eder.
    const roots = [
      "src/app/api/ai/test/route.ts",
      "src/app/api/conversations/[id]/ai-suggest/route.ts",
    ];
    for (const rel of roots) {
      const src = readFileSync(path.resolve(__dirname, "../../", rel), "utf8");
      expect(src, rel).toContain("take: KB_ITEM_CAP");
      expect(src, rel).toMatch(/from "@\/lib\/ai\/prompts"/);
    }
  });
});

describe("günlük org AI bütçesi", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("varsayılan tavan makul: normal kullanımın üstünde, suistimalin altında", () => {
    expect(dailyAiCallCap()).toBeGreaterThanOrEqual(300);
    expect(dailyAiCallCap()).toBeLessThanOrEqual(5000);
  });

  it("env ile ayarlanabilir", () => {
    vi.stubEnv("AI_DAILY_CALL_CAP", "1200");
    expect(dailyAiCallCap()).toBe(1200);
  });

  it("bozuk env değeri güvenli varsayılana düşer (sessizce sınırsız OLMAZ)", () => {
    for (const bad of ["", "0", "-5", "abc", "1e6", "0x10", "9999999"]) {
      vi.stubEnv("AI_DAILY_CALL_CAP", bad);
      expect(dailyAiCallCap(), bad).toBeGreaterThanOrEqual(300);
      expect(dailyAiCallCap(), bad).toBeLessThanOrEqual(5000);
    }
  });

  it("AI harcayan HER rota günlük bütçeden geçiyor (kaynak-tarama pini)", () => {
    // Yeni bir AI rotası bütçesiz eklenirse burası kırmızı olur.
    const spenders = [
      "src/app/api/ai/test/route.ts",
      "src/app/api/conversations/[id]/ai-suggest/route.ts",
      "src/app/api/conversations/[id]/translate-message/route.ts",
      "src/app/api/conversations/[id]/reply/route.ts",
      "src/app/api/hazirlik/summary/route.ts",
    ];
    for (const rel of spenders) {
      const src = readFileSync(path.resolve(__dirname, "../../", rel), "utf8");
      expect(src, rel).toContain("consumeDailyAiBudget");
    }
  });
});

// ---------------------------------------------------------------------------
// TAKVİM BESLEMESİ ETKİNLİK TAVANI.
//
// Ağ katmanı 10 MB'da kesiyor ama bu içerik tavanı DEĞİL: ölçüldü, 10 MB'lık bir
// feed ~119.000 rezervasyon satırı üretiyordu ve içe aktarma her satır için ayrı
// transaction koştuğu için tek istek yüz binlerce DB gidiş-dönüşüne dönüşüyordu.
// Besleme URL'ini müşteri girdiği için tetiklemesi bedava.
// ---------------------------------------------------------------------------
describe("iCal etkinlik tavanı", () => {
  function feed(events: number): string {
    const body = Array.from(
      { length: events },
      (_, i) =>
        `BEGIN:VEVENT\nUID:e${i}@x\nDTSTART;VALUE=DATE:20260801\nDTEND;VALUE=DATE:20260803\nSUMMARY:Rez ${i}\nEND:VEVENT`,
    ).join("\n");
    return `BEGIN:VCALENDAR\n${body}\nEND:VCALENDAR`;
  }

  it("normal boyutlu besleme tam olarak ayrıştırılır", async () => {
    const { parseIcs } = await import("@/lib/import/ics");
    expect(parseIcs(feed(50))).toHaveLength(50);
  });

  it("devasa besleme TAVANDA kesilir (kardeş CSV ayrıştırıcısıyla parite)", async () => {
    const { parseIcs } = await import("@/lib/import/ics");
    const parsed = parseIcs(feed(12_000));
    expect(parsed.length).toBe(10_000);
  });

  it("kesme SESSİZ olur — meşru bir feed'in şişmesi tüm senkronu durdurmaz", async () => {
    const { parseIcs } = await import("@/lib/import/ics");
    expect(() => parseIcs(feed(11_000))).not.toThrow();
  });
});
