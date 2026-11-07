import { describe, it, expect } from "vitest";
import { findTimeConflicts } from "@/lib/ai/prompts";
import { kbTimeConflicts } from "@/lib/kb-time-conflicts";

// ---------------------------------------------------------------------------
// AYNI KALEMDE İKİ KOŞULSUZ SAAT (Codex 09-27). Eski küme kuralı "mülkün değeri kümenin İÇİNDEYSE uyumlu" diyordu; pencere
// ("15:00'ten itibaren, en geç 22:00") için doğru ama "Çıkış 11:00. Çıkış 12:00." gibi kendi içinde çelişen kalemde 12:00'yi
// yutuyordu → istem çelişki listesi boş, gönderim kapısı saat gerekçesiyle tutmuyor, yapay zekâ misafire 12:00 diyebiliyordu.
// Kural: mülkün değeri kalemde KOŞULSUZ (sınır / aralık / gün koşulu olmadan) geçiyorsa ve kalem başka bir koşulsuz saat de
// söylüyorsa çelişkidir. Pencere uçları, müsaitlik / erken-geç istisnası ve gün koşulu ("hafta sonu 16:00") serbest kalır.
// ---------------------------------------------------------------------------

const PROP = { name: "Lale", checkInTime: "15:00", checkOutTime: "11:00" };
const conflicts = (category: string, title: string, content: string) =>
  findTimeConflicts(PROP as never, [{ category, title, content }] as never);

describe("🚨 aynı kalemde iki koşulsuz saat — gerçek çelişki", () => {
  it("Çıkış 11:00. Çıkış 12:00. → çıkış çelişkisi (12:00)", () => {
    expect(conflicts("checkout", "Çıkış", "Çıkış 11:00. Çıkış 12:00.")).toEqual([
      { field: "checkOutTime", propertyValue: "11:00", kbValues: ["12:00"] },
    ]);
  });
  it("Giriş 15:00. Giriş 14:00. → giriş çelişkisi (14:00)", () => {
    expect(conflicts("checkin", "Giriş", "Giriş 15:00. Giriş 14:00.")).toEqual([
      { field: "checkInTime", propertyValue: "15:00", kbValues: ["14:00"] },
    ]);
  });
  it("İngilizce: Check-out is at 11 am. Check-out is at 12:00. → çelişki", () => {
    expect(conflicts("checkout", "Check-out", "Check-out is at 11 am. Check-out is at 12:00.")).toEqual([
      { field: "checkOutTime", propertyValue: "11:00", kbValues: ["12:00"] },
    ]);
  });
  it("ev sahibi raporu da aynı kuralla gösterir", () => {
    const rows = kbTimeConflicts(PROP, [{ id: "k1", title: "Çıkış", category: "checkout", content: "Çıkış 11:00. Çıkış 12:00." }]);
    expect(rows.map((r) => ({ field: r.field, values: r.sides.map((s) => s.values) }))).toEqual([{ field: "checkout", values: [["12:00"]] }]);
  });
});

describe("pencere / koşul / gün — çelişki DEĞİL", () => {
  for (const [category, title, content] of [
    ["checkout", "Çıkış", "Çıkış 11:00, müsaitse 12:00'ye uzatılabilir."],
    ["checkin", "Giriş", "Giriş 15:00'ten itibaren, en geç 22:00."],
    ["checkin", "Giriş", "Giriş saati 15:00 ile 22:00 arasıdır."],
    ["checkout", "Çıkış", "Çıkış 10:00–11:00 arası yapılır."],
    ["checkin", "Giriş", "Giriş 15:00, hafta sonu 16:00."],
    ["checkin", "Check-in", "Check-in is from 15:00, 16:00 on Sundays."],
    ["checkin", "Giriş", "Giriş saati 15:00'tir. En geç 22:00'ye kadar giriş yapabilirsiniz."],
    ["checkin", "Check-in", "Check-in is at 15:00, 22:00 at the latest."],
  ] as const) {
    it(`${content}`, () => {
      expect(conflicts(category, title, content)).toEqual([]);
      expect(kbTimeConflicts(PROP, [{ id: "k1", title, category, content }])).toEqual([]);
    });
  }
});
