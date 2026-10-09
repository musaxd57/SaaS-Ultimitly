import { nightsBetween, todayKey } from "@/modules/availability/core";
import { lexicalClosingOnly } from "./closing-turn";

// ---------------------------------------------------------------------------
// YETKİLİ KONUŞMA DURUMU (kurucu talimatı 09-07 "BOUNDED CONVERSATION CONTEXT" §6) — SAF. Girdi kalıcı kayıtlardan, konuşmanın
// TAMAMINDAN hesaplanır (`operator-replies.ts` `loadConversationPhase`); son mesaj penceresinden ÇIKARILMAZ.
//
//   phase: first_contact (misafire hiç teslim edilmiş cevap yok) · closing (teslim edilmiş cevaptan sonra misafirin yazdıklarının
//          HEPSİ yalnız teşekkür / onay — kapanış sessizliğinin SÖZCÜK yüklemi, `closing-turn.ts`) · ongoing (diğer her şey).
//   hasPriorDeliveredReply / isFirstOperatorReply / deliveredReplyCount / unansweredGuestMessageCount / lastInteractionAt.
//
// Kapanış hükmü YALNIZ sözcük yüklemiyle ve bütün cevapsız mesajlar okunabildiyse verilir (tavan aşıldıysa ongoing): bu alan bir
// kapı DEĞİLDİR, hiçbir kararı gevşetmez. Henüz isteme bağlı değil (talimat: doğrulanmadan etkinleştirilmez).
// ---------------------------------------------------------------------------

export const CONVERSATION_PHASES = ["first_contact", "ongoing", "closing"] as const;
export type ConversationPhase = (typeof CONVERSATION_PHASES)[number];

/** Kapanış hükmü için okunan en fazla cevapsız misafir mesajı. */
export const PHASE_UNANSWERED_SCAN = 20;

export interface ConversationPhaseState {
  phase: ConversationPhase;
  hasPriorDeliveredReply: boolean;
  isFirstOperatorReply: boolean;
  deliveredReplyCount: number;
  /** Son teslim edilmiş cevaptan sonraki misafir mesajı sayısı (tavan `PHASE_UNANSWERED_SCAN`; üstü "+1" ile işaretli). */
  unansweredGuestMessageCount: number;
  /** Tavan aşıldı: sayı alt sınırdır. */
  unansweredCapped: boolean;
  lastInteractionAt: Date | null;
}

export function deriveConversationPhase(input: {
  deliveredReplyCount: number;
  /** Son teslim edilmiş cevaptan sonraki misafir mesajları (kronolojik; en çok `PHASE_UNANSWERED_SCAN` + 1). */
  unansweredGuestTexts: readonly string[];
  lastInteractionAt: Date | null;
}): ConversationPhaseState {
  const delivered = Number.isInteger(input.deliveredReplyCount) && input.deliveredReplyCount > 0 ? input.deliveredReplyCount : 0;
  const capped = input.unansweredGuestTexts.length > PHASE_UNANSWERED_SCAN;
  const texts = input.unansweredGuestTexts.slice(0, PHASE_UNANSWERED_SCAN);
  const phase: ConversationPhase =
    delivered === 0 ? "first_contact" : !capped && lexicalClosingOnly(texts) ? "closing" : "ongoing"; // boş liste kapanış değil (yüklem en az bir mesaj ister)
  return {
    phase,
    hasPriorDeliveredReply: delivered > 0,
    isFirstOperatorReply: delivered === 0,
    deliveredReplyCount: delivered,
    unansweredGuestMessageCount: texts.length,
    unansweredCapped: capped,
    lastInteractionAt: input.lastInteractionAt,
  };
}

/**
 * ZAMAN BAĞLAMI (talimat 09-07 §4 "geçen süre, oturum arası, yeni gün") — yalnız NESNEL değerler: son etkileşimden bu yana geçen dakika
 * ve org saat diliminde takvim günü farkı (0 = aynı gün). "Yeni oturum" eşiği bir ürün kararıdır → burada YOK. Geçersiz / yok → null;
 * saat kayması (son etkileşim gelecekte) → 0.
 */
export interface InteractionGap {
  elapsedMinutes: number;
  calendarDaysApart: number;
}

export function interactionGap(lastInteractionAt: Date | null, now: Date, timeZone: string): InteractionGap | null {
  if (!lastInteractionAt || Number.isNaN(lastInteractionAt.getTime()) || Number.isNaN(now.getTime())) return null;
  const ms = now.getTime() - lastInteractionAt.getTime();
  if (ms <= 0) return { elapsedMinutes: 0, calendarDaysApart: 0 };
  return {
    elapsedMinutes: Math.floor(ms / 60_000),
    calendarDaysApart: Math.max(0, nightsBetween(todayKey(lastInteractionAt, timeZone), todayKey(now, timeZone))),
  };
}
