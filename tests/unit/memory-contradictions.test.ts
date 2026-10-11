import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
vi.mock("server-only", () => ({}));
import { complaintTopics, detectContradictions, ITEM_TOPIC_TO_KB, CONTRADICTION_MIN_GUESTS } from "@/modules/intelligence/memory/contradictions";

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
