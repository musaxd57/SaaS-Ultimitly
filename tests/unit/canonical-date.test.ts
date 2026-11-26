import { describe, it, expect } from "vitest";
import { canonicalDate } from "@/lib/channels/ingest";

// ---------------------------------------------------------------------------
// Y6 (Codex 10-07, 15c8663): sağlayıcı tarihi yalnız ISO 8601 + takvimde olan gün. Eskiden çıplak `new Date()`:
//   "2026-02-30" → 2 Mart (uydurma gün) · "1" → 2001 · "October 10 2026" → sunucu saatinde okunur.
// Geçerli ISO biçimleri (canlı sağlayıcının gönderdiği) değişmez.
// ---------------------------------------------------------------------------

describe("canonicalDate — katı ISO + takvim", () => {
  it.each([["2026-02-30"], ["2026-13-01"], ["2026-00-10"], ["1"], ["2026"], ["October 10 2026"], ["10/10/2026"], ["2026-02-30T10:00:00Z"]])(
    "🚨 %s → null (eskiden geçerli bir tarih uyduruluyordu)",
    (v) => {
      expect(canonicalDate(v)).toBeNull();
    },
  );

  it.each([
    ["2026-06-01", "2026-06-01T00:00:00.000Z"],
    ["2026-06-09T10:00:00Z", "2026-06-09T10:00:00.000Z"],
    ["2026-06-09T10:00:00.000000Z", "2026-06-09T10:00:00.000Z"],
    ["2026-06-09T13:00:00+03:00", "2026-06-09T10:00:00.000Z"],
    ["2028-02-29", "2028-02-29T00:00:00.000Z"],
  ])("KONTROL: %s → %s (eskisiyle aynı)", (v, iso) => {
    expect(canonicalDate(v)?.toISOString()).toBe(iso);
  });

  it("KONTROL: dize olmayan / boş / NUL'lu değer", () => {
    expect(canonicalDate(null)).toBeNull();
    expect(canonicalDate(20260601)).toBeNull();
    expect(canonicalDate("")).toBeNull();
    expect(canonicalDate("2026-06-01\u0000")?.toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });
});
