import { describe, it, expect } from "vitest";
import { decisionExpiryDayKey, effectiveDecisionStatus, liveDecisionDayKey } from "@/lib/decisions/core";

// ---------------------------------------------------------------------------
// Tur 5 D5 (11-05, ölçüldü, çürütücüyle yeniden üretildi): tarih değişikliği kartının hedef günü YOK (`decisionDayKey` null — pinli
// tasarım), bu yüzden konaklama bittikten aylar sonra da "Karar bekliyor" kalıyor, Dikkat Gerektirenler'de (önem 92) ve rozette
// sayılıyordu. Görünen gün aynen; YALNIZ süre hükmü konaklamanın çıkış gününe bağlanır.
// ---------------------------------------------------------------------------

const res = { id: "r1", arrivalKey: "2026-11-01", departureKey: "2026-11-07" };
const pendingStatus = (dayKey: string | null, today: string) =>
  effectiveDecisionStatus("pending", { hostRepliedAfter: false, reservationCancelled: false, dayKey, todayKey: today });

describe("karar kartının süre günü", () => {
  it("🚨 tarih değişikliği kartı: konaklama bitince süresi geçmiş; bitmeden (çıkış günü dahil) bekliyor", () => {
    const d = { kind: "date_change" as const, dayKey: null, reservationId: "r1" };
    expect(liveDecisionDayKey(d, res)).toBeNull(); // görünen gün değişmedi (pinli tasarım)
    expect(decisionExpiryDayKey(d, res)).toBe("2026-11-07");
    expect(pendingStatus(decisionExpiryDayKey(d, res), "2026-12-20")).toBe("expired");
    expect(pendingStatus(decisionExpiryDayKey(d, res), "2026-11-07")).toBe("pending");
  });

  it("rezervasyonsuz tarih değişikliği kartı konuşmanın rezervasyonunu izler; BAŞKA rezervasyonun kartı izlemez", () => {
    expect(decisionExpiryDayKey({ kind: "date_change", dayKey: null, reservationId: null }, res)).toBe("2026-11-07");
    expect(decisionExpiryDayKey({ kind: "date_change", dayKey: null, reservationId: "r-other" }, res)).toBeNull();
  });

  it("KONTROL: rezervasyon yoksa gün yok (süresiz — bugünkü pinli davranış)", () => {
    expect(decisionExpiryDayKey({ kind: "date_change", dayKey: null, reservationId: null }, null)).toBeNull();
  });

  it("KONTROL: erken giriş / geç çıkış kartı canlı günüyle aynı (değişmedi)", () => {
    const ec = { kind: "early_checkin" as const, dayKey: "2026-10-30", reservationId: "r1" };
    const lc = { kind: "late_checkout" as const, dayKey: null, reservationId: "r1" };
    expect(decisionExpiryDayKey(ec, res)).toBe(liveDecisionDayKey(ec, res));
    expect(decisionExpiryDayKey(lc, res)).toBe(liveDecisionDayKey(lc, res));
  });
});
