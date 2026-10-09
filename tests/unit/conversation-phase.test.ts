import { describe, it, expect } from "vitest";
import { deriveConversationPhase, interactionGap, PHASE_UNANSWERED_SCAN } from "@/lib/ai/conversation-phase";

// Talimat 09-07 §6 — yetkili konuşma durumu (saf türetim). Girdi konuşmanın TAMAMINDAN gelir (yükleyici entegrasyonda sınanır).
const at = new Date("2026-10-09T10:00:00Z");

describe("deriveConversationPhase", () => {
  it("teslim edilmiş cevap yok → first_contact (misafir ne yazmış olursa olsun)", () => {
    for (const texts of [[], ["Merhaba"], ["Teşekkürler"]]) {
      expect(deriveConversationPhase({ deliveredReplyCount: 0, unansweredGuestTexts: texts, lastInteractionAt: at })).toMatchObject({
        phase: "first_contact",
        hasPriorDeliveredReply: false,
        isFirstOperatorReply: true,
        deliveredReplyCount: 0,
      });
    }
  });

  it("cevaptan sonra yalnız teşekkür / onay → closing", () => {
    expect(deriveConversationPhase({ deliveredReplyCount: 2, unansweredGuestTexts: ["Teşekkürler", "👍"], lastInteractionAt: at })).toMatchObject({
      phase: "closing",
      hasPriorDeliveredReply: true,
      isFirstOperatorReply: false,
      unansweredGuestMessageCount: 2,
    });
  });

  it.each([
    [["Teşekkürler", "Bir gece daha kalabilir miyiz?"]],
    [["Anladım teşekkürler ama 12'de gelebilir miyiz?"]],
    [[]],
  ])("🚨 soru / istek varsa ya da cevapsız mesaj yoksa closing DEĞİL → ongoing (%j)", (texts) => {
    expect(deriveConversationPhase({ deliveredReplyCount: 1, unansweredGuestTexts: texts, lastInteractionAt: at }).phase).toBe("ongoing");
  });

  it("🚨 cevapsız mesaj tavanı aşıldı → kapanış hükmü VERİLMEZ (ongoing), sayı alt sınır olarak işaretli", () => {
    const texts = Array.from({ length: PHASE_UNANSWERED_SCAN + 1 }, () => "Teşekkürler");
    const s = deriveConversationPhase({ deliveredReplyCount: 1, unansweredGuestTexts: texts, lastInteractionAt: at });
    expect(s).toMatchObject({ phase: "ongoing", unansweredCapped: true, unansweredGuestMessageCount: PHASE_UNANSWERED_SCAN });
  });

  it("bozuk sayı (negatif / kesirli) 0 sayılır", () => {
    expect(deriveConversationPhase({ deliveredReplyCount: -3, unansweredGuestTexts: [], lastInteractionAt: null }).phase).toBe("first_contact");
    expect(deriveConversationPhase({ deliveredReplyCount: 1.5, unansweredGuestTexts: [], lastInteractionAt: null }).deliveredReplyCount).toBe(0);
  });
});

describe("interactionGap — zaman bağlamı (nesnel)", () => {
  const TZ = "Europe/Istanbul";
  it("aynı gün / gece yarısını geçen kısa aralık / günler", () => {
    // 23:50 → 00:10 İstanbul: 20 dk ama YENİ takvim günü.
    expect(interactionGap(new Date("2026-10-08T20:50:00Z"), new Date("2026-10-08T21:10:00Z"), TZ)).toEqual({ elapsedMinutes: 20, calendarDaysApart: 1 });
    expect(interactionGap(new Date("2026-10-09T06:00:00Z"), new Date("2026-10-09T09:30:00Z"), TZ)).toEqual({ elapsedMinutes: 210, calendarDaysApart: 0 });
    expect(interactionGap(new Date("2026-10-01T09:00:00Z"), new Date("2026-10-09T09:00:00Z"), TZ)).toEqual({ elapsedMinutes: 11_520, calendarDaysApart: 8 });
  });
  it("🚨 saat dilimi günü belirler (UTC değil)", () => {
    // 21:30Z = İstanbul 00:30 (ertesi gün); UTC'de aynı gün olurdu.
    expect(interactionGap(new Date("2026-10-08T20:00:00Z"), new Date("2026-10-08T21:30:00Z"), TZ)?.calendarDaysApart).toBe(1);
    expect(interactionGap(new Date("2026-10-08T20:00:00Z"), new Date("2026-10-08T21:30:00Z"), "UTC")?.calendarDaysApart).toBe(0);
  });
  it("yok / geçersiz → null; gelecekteki an → 0", () => {
    expect(interactionGap(null, at, TZ)).toBeNull();
    expect(interactionGap(new Date("x"), at, TZ)).toBeNull();
    expect(interactionGap(new Date(at.getTime() + 60_000), at, TZ)).toEqual({ elapsedMinutes: 0, calendarDaysApart: 0 });
  });
});
