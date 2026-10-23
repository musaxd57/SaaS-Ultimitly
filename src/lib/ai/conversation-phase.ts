import { nightsBetween, todayKey } from "@/modules/availability/core";
import { lexicalClosingOnly } from "./closing-turn";

// ---------------------------------------------------------------------------
// YETKİLİ KONUŞMA DURUMU (kurucu talimatı 09-07 "BOUNDED CONVERSATION CONTEXT" §6) — SAF. Girdi kalıcı kayıtlardan, konuşmanın
// TAMAMINDAN hesaplanır (`operator-replies.ts` `loadConversationPhase`); son mesaj penceresinden ÇIKARILMAZ.
//
//   phase: first_contact (misafire hiç teslim edilmiş cevap yok) · closing (kapanışa uygun nokta [`closableAfter`] VE son konuşma
//          cevabından sonra misafirin yazdıklarının HEPSİ yalnız teşekkür / onay — kapanış sessizliğinin SÖZCÜK yüklemi) · ongoing.
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
  /** Son KONUŞMA cevabından (otomatik şablon mesajı hariç) sonraki misafir mesajı sayısı (tavan `PHASE_UNANSWERED_SCAN`). */
  unansweredGuestMessageCount: number;
  /** Tavan aşıldı: sayı alt sınırdır. */
  unansweredCapped: boolean;
  lastInteractionAt: Date | null;
  /** Son KONUŞMA cevabının anı (otomatik şablon mesajı hariç); yoksa null. Zaman bağlamı bundan ölçülür. */
  lastReplyAt: Date | null;
}

export function deriveConversationPhase(input: {
  deliveredReplyCount: number;
  /** Son KONUŞMA cevabından sonraki misafir mesajları (kronolojik; en çok `PHASE_UNANSWERED_SCAN` + 1). */
  unansweredGuestTexts: readonly string[];
  /** Kapanış ön şartı (`closing-turn.ts` `closableAfter`): misafir yazdıktan sonra bir cevap var VE yapay zekânın son cevabı soru /
   *  teklif değil. Yükleyici hesaplar. */
  closable: boolean;
  lastInteractionAt: Date | null;
  lastReplyAt?: Date | null;
}): ConversationPhaseState {
  const delivered = Number.isInteger(input.deliveredReplyCount) && input.deliveredReplyCount > 0 ? input.deliveredReplyCount : 0;
  const capped = input.unansweredGuestTexts.length > PHASE_UNANSWERED_SCAN;
  const texts = input.unansweredGuestTexts.slice(0, PHASE_UNANSWERED_SCAN);
  const phase: ConversationPhase =
    delivered === 0
      ? "first_contact"
      : input.closable && !capped && lexicalClosingOnly(texts) // boş liste kapanış değil (yüklem en az bir mesaj ister)
        ? "closing"
        : "ongoing";
  return {
    phase,
    hasPriorDeliveredReply: delivered > 0,
    isFirstOperatorReply: delivered === 0,
    deliveredReplyCount: delivered,
    unansweredGuestMessageCount: texts.length,
    unansweredCapped: capped,
    lastInteractionAt: input.lastInteractionAt,
    lastReplyAt: input.lastReplyAt ?? null,
  };
}

/** İstem bloğu için olgular (konuşma kayıtları bloğu, bayrak `AI_CONVERSATION_STATE_ENABLED`). Saf. */
export interface ConversationPhaseFacts {
  phase: ConversationPhase;
  deliveredReplyCount: number;
  /** Son konuşma cevabından bu yana (yoksa null). */
  sinceLastReply: InteractionGap | null;
}

export function conversationPhaseFacts(s: ConversationPhaseState, now: Date, timeZone: string): ConversationPhaseFacts {
  return { phase: s.phase, deliveredReplyCount: s.deliveredReplyCount, sinceLastReply: interactionGap(s.lastReplyAt, now, timeZone) };
}

/**
 * ZAMAN BAĞLAMI (talimat 09-07 §4 "geçen süre, oturum arası, yeni gün"): son etkileşimden bu yana geçen dakika, org saat diliminde
 * takvim günü farkı (0 = aynı gün) ve YENİ OTURUM (kurucu kararı 10-09: "6 saat sessizlik" — `NEW_SESSION_GAP_MINUTES`). Geçersiz / yok →
 * null; saat kayması (son etkileşim gelecekte) → 0.
 */
export const NEW_SESSION_GAP_MINUTES = 6 * 60;

export interface InteractionGap {
  elapsedMinutes: number;
  calendarDaysApart: number;
  /** En az `NEW_SESSION_GAP_MINUTES` sessizlik (takvim günü değişimi tek başına yeni oturum DEĞİL — kurucu seçimi). */
  newSession: boolean;
}

export function interactionGap(lastInteractionAt: Date | null, now: Date, timeZone: string): InteractionGap | null {
  if (!lastInteractionAt || Number.isNaN(lastInteractionAt.getTime()) || Number.isNaN(now.getTime())) return null;
  const ms = now.getTime() - lastInteractionAt.getTime();
  if (ms <= 0) return { elapsedMinutes: 0, calendarDaysApart: 0, newSession: false };
  const elapsedMinutes = Math.floor(ms / 60_000);
  return {
    elapsedMinutes,
    newSession: elapsedMinutes >= NEW_SESSION_GAP_MINUTES,
    calendarDaysApart: Math.max(0, nightsBetween(todayKey(lastInteractionAt, timeZone), todayKey(now, timeZone))),
  };
}
