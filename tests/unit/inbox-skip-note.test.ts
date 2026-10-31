import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { SKIP_REASON_LABELS } from "@/lib/inbox-skip-labels";
import { join } from "node:path";
import { RESERVATION_CANCELLED_NOTE, skipNoteReasonFor } from "@/lib/inbox-skip-note";
import { HANDOFF_NOTICE_REASON } from "@/lib/ai/output-veto";

// Kurucu 10-12: "hosta söylesin rezervasyon iptal edilmiş". Gerekçe kodu (`reservation_ended`) değişmez (senkron onarımı ona bağlı);
// gelen kutusu notu rezervasyon İPTALSE ayrı söylenir.
describe("gelen kutusu notu anahtarı", () => {
  it("bitmiş + iptal → iptal notu; bitmiş + iptal değil → konaklama bitti notu; devir tutuşu ve diğerleri değişmez", () => {
    expect(skipNoteReasonFor({ skippedReason: "reservation_ended", reservationStatus: "cancelled" })).toBe(RESERVATION_CANCELLED_NOTE);
    expect(skipNoteReasonFor({ skippedReason: "reservation_ended", reservationStatus: "confirmed" })).toBe("reservation_ended");
    expect(skipNoteReasonFor({ skippedReason: "reservation_ended", reservationStatus: null })).toBe("reservation_ended");
    expect(skipNoteReasonFor({ skippedReason: "low_confidence_or_risky", heldReason: HANDOFF_NOTICE_REASON })).toBe(HANDOFF_NOTICE_REASON);
    expect(skipNoteReasonFor({ skippedReason: "low_confidence_or_risky", heldReason: null, reservationStatus: "cancelled" })).toBe("low_confidence_or_risky");
    expect(skipNoteReasonFor({ skippedReason: null })).toBeNull();
  });

  it("sayfa notu bu fonksiyondan alır ve iptal notunun metni var (yapay zekâ cevap vermiyor, kullanımdan düşülmüyor)", () => {
    const page = readFileSync(join(process.cwd(), "src/app/(app)/inbox/[id]/page.tsx"), "utf8");
    expect(page).toMatch(/skipNoteReasonFor\(\{[\s\S]{0,200}reservationStatus:\s*conversation\.reservation\?\.status/);
    // Etiketler 10-21'de yaprak modüle taşındı (`inbox-skip-labels.ts`); sayfa oradan okur.
    expect(page).toContain('import { SKIP_REASON_LABELS, skipReasonActionFor } from "@/lib/inbox-skip-labels"');
    expect(SKIP_REASON_LABELS[RESERVATION_CANCELLED_NOTE]).toMatch(/^Rezervasyon iptal edilmiş — yapay zekâ cevap vermiyor/);
  });
});
