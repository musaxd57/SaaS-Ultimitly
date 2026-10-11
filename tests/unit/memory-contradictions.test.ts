import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
vi.mock("server-only", () => ({}));
import {
  complaintTopics,
  detectContradictions,
  ITEM_TOPIC_TO_KB,
  CONTRADICTION_MIN_GUESTS,
  messageIsAbout,
} from "@/modules/intelligence/memory/contradictions";

// ---------------------------------------------------------------------------
// DEĞİŞMEZ 13 / karar 26 (kurucu 10-11) — olası çelişki uyarısının SAF kararı. (1) bilgi tabanı ↔ şikâyet: son 30 günde ≥3 AYRI misafir
// aynı konuda sorun bildirdi; (2) bilgi tabanı ↔ bilgi tabanı / mülk ayarı (saat). "Bilerek böyle" işareti, kalem sonradan değişmediyse
// uyarıyı kaldırır.
// ---------------------------------------------------------------------------

const NOW = new Date("2026-10-11T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const item = (conversationId: string, messageId: string, kind: string, at = day(1)) => ({ conversationId, messageId, kind, createdAt: at });
const fact = (id: string, category: string, over: Partial<{ observedAt: Date; humanOverrideAt: Date | null; kbItemId: string }> = {}) => ({
  id,
  category,
  kbItemId: over.kbItemId ?? `kb-${id}`,
  observedAt: over.observedAt ?? day(60),
  humanOverrideAt: over.humanOverrideAt ?? null,
});

describe("complaintTopics — aynı misafir mesajında şikâyet + konu", () => {
  it("yalnız AYNI mesajda şikâyet + eşlenen konu sayılır", () => {
    expect(complaintTopics([item("c1", "m1", "complaint_issue"), item("c1", "m1", "wifi")])).toEqual([
      { conversationId: "c1", kbCategory: "wifi", at: day(1) },
    ]);
    expect(complaintTopics([item("c1", "m1", "wifi")])).toEqual([]); // soru, şikâyet değil
    expect(complaintTopics([item("c1", "m1", "complaint_issue")])).toEqual([]); // konusuz şikâyet
    expect(complaintTopics([item("c1", "m1", "complaint_issue"), item("c1", "m2", "wifi")])).toEqual([]); // farklı mesajlar
    expect(complaintTopics([item("c1", "m1", "complaint_issue"), item("c1", "m1", "amenities")])).toEqual([]); // belirsiz konu eşlenmez
  });
  it("eşleme yalnız açık konular; bilinmeyen anlama niyeti yok", () => {
    expect(ITEM_TOPIC_TO_KB).toMatchObject({ wifi: "wifi", parking: "parking", cleaning_linen: "cleaning", access_keys: "checkin" });
    expect(Object.keys(ITEM_TOPIC_TO_KB)).not.toContain("amenities");
  });
});

describe("messageIsAbout — mesajın somut konularının TAMAMI bu kategoriye ait mi (Haiku 4. tur)", () => {
  it.each([
    ["Wi-Fi çalışmıyor.", "wifi", true],
    ["İnternet iki saattir yok", "wifi", true],
    ["The wifi keeps dropping", "wifi", true],
    ["Otopark dolu, park edemedik", "parking", true],
    ["Oda çok kirliydi, havlu da yok", "cleaning", true],
    ["Kapı kodu çalışmıyor", "checkin", true],
    ["Wi-Fi çalışmıyor, ne yapalım?", "wifi", true],
    // Konu yalnız SORU bölümünde: şikâyet konusu değil.
    ["Wi-Fi şifresi ne?", "wifi", false],
    ["İnternet var mı?", "wifi", false],
    // Karışık: başka somut konu da var → belirsiz → hayır.
    ["Gürültüden uyuyamadık. Bu arada Wi-Fi ağı hangisi?", "wifi", false],
    ["Oda kirli, Wi-Fi şifresi ne?", "wifi", false],
    ["Oda kirli, Wi-Fi şifresi ne?", "cleaning", false],
    // Başka somut konu + konunun SORU OLMAYAN bölümü: yine belirsiz → hayır (mutasyon D1: "tamamı" kuralı tek başına).
    ["Gürültüden uyuyamadık, Wi-Fi şifresini de aldık.", "wifi", false],
    // Konusu okunamayan / boş / eşlemesi olmayan kategori → hayır.
    ["", "wifi", false],
    ["Çok kötü bir deneyimdi.", "wifi", false],
    ["Wi-Fi çalışmıyor.", "rules", false],
  ])("%s · %s → %s", (body, cat, expected) => expect(messageIsAbout(body as string, cat as string)).toBe(expected));

  it("8.000 karakteri aşan metin okunmaz (pahalı sözlük taraması yok — mutasyon D6)", () => {
    expect(messageIsAbout(`Wi-Fi çalışmıyor. ${"a".repeat(8_000)}`, "wifi")).toBe(false);
    expect(messageIsAbout(`Wi-Fi çalışmıyor. ${"a ".repeat(3_000)}`, "wifi")).toBe(true);
  });

  it("complaintTopics metin verilince yalnız konusu doğrulanan mesajı sayar; metni olmayan mesaj sayılmaz", () => {
    const items = [item("c1", "m1", "complaint_issue"), item("c1", "m1", "wifi"), item("c2", "m2", "complaint_issue"), item("c2", "m2", "wifi")];
    const bodies = new Map([
      ["m1", "Wi-Fi çalışmıyor."],
      ["m2", "Gürültüden uyuyamadık. Wi-Fi ağı hangisi?"],
    ]);
    expect(complaintTopics(items, bodies).map((t) => t.conversationId)).toEqual(["c1"]);
    expect(complaintTopics(items, new Map())).toEqual([]);
  });
});

describe("detectContradictions", () => {
  const topics = (n: number, category = "wifi", at = day(2)) =>
    Array.from({ length: n }, (_, i) => ({ conversationId: `c${i}`, kbCategory: category, at }));

  it(`🚨 bilgi tabanında kalem + ${CONTRADICTION_MIN_GUESTS} ayrı misafir aynı konuda sorun → uyarı (metin misafir sözü taşımaz)`, () => {
    const w = detectContradictions({ facts: [fact("f1", "wifi")], topics: topics(3), timeRows: [], now: NOW });
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ kind: "kb_vs_complaints", memoryIds: ["f1"] });
    expect(w[0].text).toBe('Bilgi tabanında "Wi-Fi" bilgisi var, ama son 30 günde 3 misafir bu konuda sorun bildirdi. Bilgi güncel mi?');
  });

  it("KONTROL: 2 misafir · aynı konuşmadan 3 mesaj · 30 günden eski · bilgi tabanında o konu yok → uyarı YOK", () => {
    expect(detectContradictions({ facts: [fact("f1", "wifi")], topics: topics(2), timeRows: [], now: NOW })).toEqual([]);
    const sameGuest = [0, 1, 2].map(() => ({ conversationId: "c1", kbCategory: "wifi", at: day(1) }));
    expect(detectContradictions({ facts: [fact("f1", "wifi")], topics: sameGuest, timeRows: [], now: NOW })).toEqual([]);
    expect(detectContradictions({ facts: [fact("f1", "wifi")], topics: topics(3, "wifi", day(31)), timeRows: [], now: NOW })).toEqual([]);
    expect(detectContradictions({ facts: [fact("f1", "parking")], topics: topics(3, "wifi"), timeRows: [], now: NOW })).toEqual([]);
  });

  it("🚨 'Bilerek böyle' (kalem sonradan değişmedi) → uyarı kalkar; kalem işaretten SONRA değiştiyse → uyarı geri gelir", () => {
    const acked = fact("f1", "wifi", { observedAt: day(60), humanOverrideAt: day(1) });
    expect(detectContradictions({ facts: [acked], topics: topics(3), timeRows: [], now: NOW })).toEqual([]);
    const changed = fact("f1", "wifi", { observedAt: day(0.5), humanOverrideAt: day(1) });
    expect(detectContradictions({ facts: [changed], topics: topics(3), timeRows: [], now: NOW })).toHaveLength(1);
    // Aynı konuda iki kalem: biri işaretsizse uyarı kalır.
    expect(detectContradictions({ facts: [acked, fact("f2", "wifi")], topics: topics(3), timeRows: [], now: NOW })[0].memoryIds).toEqual(["f1", "f2"]);
  });

  it("bilgi tabanı ↔ bilgi tabanı / mülk ayarı (saat): ilgili hafıza kalemleriyle; işaretlenince kalkar; kalemi olmayan satır yok", () => {
    const row = { text: "Giriş saati: mülk ayarı 15:00, bilgi tabanı 14:00.", itemIds: ["kb-f9"] };
    expect(detectContradictions({ facts: [fact("f9", "checkin")], topics: [], timeRows: [row], now: NOW })).toEqual([
      { kind: "kb_vs_kb", memoryIds: ["f9"], text: row.text },
    ]);
    expect(
      detectContradictions({ facts: [fact("f9", "checkin", { humanOverrideAt: day(1) })], topics: [], timeRows: [row], now: NOW }),
    ).toEqual([]);
    expect(detectContradictions({ facts: [], topics: [], timeRows: [row], now: NOW })).toEqual([]);
  });

  it("🚨 mülk ayarı ↔ bilgi tabanı satırı: işaret, mülk ayarı SONRADAN değiştiyse geçersiz (Haiku 4. tur)", () => {
    const acked = fact("f9", "checkin", { humanOverrideAt: day(2) });
    const row = (updated: Date | null) => ({ text: "Giriş saati çelişkisi", itemIds: ["kb-f9"], againstPropertyUpdatedAt: updated });
    expect(detectContradictions({ facts: [acked], topics: [], timeRows: [row(day(3))], now: NOW })).toEqual([]);
    expect(detectContradictions({ facts: [acked], topics: [], timeRows: [row(day(1))], now: NOW })).toHaveLength(1);
    expect(detectContradictions({ facts: [acked], topics: [], timeRows: [row(null)], now: NOW })).toEqual([]);
  });

  it("gelecek tarihli öğe sayılmaz (saat kayması)", () => {
    expect(detectContradictions({ facts: [fact("f1", "wifi")], topics: topics(3, "wifi", new Date(NOW.getTime() + 3_600_000)), timeRows: [], now: NOW })).toEqual([]);
  });
});

describe("🚨 yapay zekâya GİTMEZ (kurucu 10-11: yalnız ev sahibine uyarı)", () => {
  it("src/lib/ai altında hiçbir dosya çelişki modülünü / okuyucusunu kullanmaz", () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(f)) files.push(p);
      }
    };
    walk(join(process.cwd(), "src/lib/ai"));
    expect(files.length).toBeGreaterThan(50);
    const offenders = files.filter((f) => /getMemoryContradictions|memory\/contradictions|ContradictionWarning/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
