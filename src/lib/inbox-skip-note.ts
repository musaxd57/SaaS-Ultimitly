import { HANDOFF_NOTICE_REASON } from "@/lib/ai/output-veto";

// ---------------------------------------------------------------------------
// Gelen kutusu "yapay zekâ neden cevap vermedi" notunun ANAHTARI (saf). Gerekçe kodu (`Conversation.skippedReason`) değişmez — on
// tüketicisi var (senkronun onarım mantığı `reservation_ended`e bağlı); not yalnız GÖSTERİMDE ayrılır:
//  · devir cümlesi tutuşu → "Misafir cevabınızı bekliyor" (K10)
//  · konaklama bitti AMA rezervasyon İPTAL → "Rezervasyon iptal edilmiş …" (kurucu 10-12: "hosta söylesin rezervasyon iptal edilmiş")
// ---------------------------------------------------------------------------

export const RESERVATION_CANCELLED_NOTE = "reservation_cancelled_note";

export function skipNoteReasonFor(input: {
  skippedReason: string | null;
  heldReason?: string | null;
  reservationStatus?: string | null;
}): string | null {
  if (input.skippedReason === "low_confidence_or_risky" && input.heldReason === HANDOFF_NOTICE_REASON) return HANDOFF_NOTICE_REASON;
  if (input.skippedReason === "reservation_ended" && input.reservationStatus === "cancelled") return RESERVATION_CANCELLED_NOTE;
  return input.skippedReason;
}
