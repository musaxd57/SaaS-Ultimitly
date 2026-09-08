import { classifyFallback } from "@/lib/ai/fallback";

// ---------------------------------------------------------------------------
// SİNYAL TÜRETİMİ (V1) — saf, deterministik, LLM'siz.
//
// Kurucu: Signal = source · category · sentiment · severity · confidence · reservation ·
// occurred_at. Kaynaklar V1'de ikidir:
//   · guest_message: gelen misafir mesajı, kelime ağı (`classifyFallback`) intent'i. "general"
//     sinyal DEĞİLDİR (gürültü). Güven kelime ağının verdiği mütevazı değerdir (0.55–0.7).
//   · reservation: iptal (`reservation.cancelled`) ve tarih değişikliği (`reservation.updated`
//     + changedFields ∋ arrivalDate|departureDate). Güven 1.0 (canonical satır gerçeği).
// occurredAt: mesaj için mesajın GERÇEK zamanı (sağlayıcı createdAt'i); rezervasyon olayı için
// olayın gözlem zamanı (iptalin gerçek anı sağlayıcıdan gelmez — iddia edilmez).
// PII: metin/ad TAŞINMAZ; yalnız kategori, ölçüler, opak id'ler.
// ---------------------------------------------------------------------------

export const SIGNAL_SOURCES = ["guest_message", "reservation"] as const;
export type SignalSource = (typeof SIGNAL_SOURCES)[number];
export const SIGNAL_KINDS = ["message.intent", "reservation.cancelled", "reservation.dates_changed"] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];
export type Sentiment = "negative" | "neutral" | "positive";

export interface SignalDraft {
  organizationId: string;
  propertyId: string;
  reservationId: string | null;
  conversationId: string | null;
  source: SignalSource;
  kind: SignalKind;
  category: string;
  sentiment: Sentiment;
  severity: number;
  confidence: number;
  occurredAt: Date;
  sourceEventId: string | null;
  sourceEntityType: "message" | "reservation";
  sourceEntityId: string;
  dedupeKey: string;
}

const NEGATIVE_INTENTS = new Set(["complaint", "refund", "early_departure"]);
const SEVERITY: Record<string, number> = {
  complaint: 0.7,
  refund: 0.6,
  early_departure: 0.6,
  human_request: 0.4,
};

export interface MessageForSignal {
  id: string;
  direction: string;
  authorType: string | null;
  body: string;
  createdAt: Date;
  conversation: { id: string; propertyId: string; reservationId: string | null };
}

/** Gelen misafir mesajı → en fazla BİR sinyal (intent). Host/AI/sistem satırı → null. */
export function deriveMessageSignal(
  organizationId: string,
  message: MessageForSignal,
  sourceEventId: string | null,
): SignalDraft | null {
  if (message.direction !== "inbound") return null;
  if (message.authorType && message.authorType !== "guest") return null;
  const body = message.body?.trim();
  if (!body) return null;
  const c = classifyFallback(body);
  if (c.intent === "general") return null;
  return {
    organizationId,
    propertyId: message.conversation.propertyId,
    reservationId: message.conversation.reservationId,
    conversationId: message.conversation.id,
    source: "guest_message",
    kind: "message.intent",
    category: c.intent,
    sentiment: NEGATIVE_INTENTS.has(c.intent) ? "negative" : "neutral",
    severity: SEVERITY[c.intent] ?? 0.2,
    confidence: Math.min(0.95, Math.max(0, c.confidence)),
    occurredAt: message.createdAt,
    sourceEventId,
    sourceEntityType: "message",
    sourceEntityId: message.id,
    // Mesaj başına TEK intent sinyali: aynı mesaj kaç event'ten gelirse gelsin tekrar üretilmez.
    dedupeKey: `${organizationId}:message.intent:${message.id}`,
  };
}

export const DATE_FIELDS = ["arrivalDate", "departureDate"] as const;

export interface ReservationEventForSignal {
  id: string;
  kind: string;
  occurredAt: Date;
  changedFields: string[];
}

export function deriveReservationSignal(
  organizationId: string,
  event: ReservationEventForSignal,
  reservation: { id: string; propertyId: string },
): SignalDraft | null {
  if (event.kind === "reservation.cancelled") {
    return {
      organizationId,
      propertyId: reservation.propertyId,
      reservationId: reservation.id,
      conversationId: null,
      source: "reservation",
      kind: "reservation.cancelled",
      category: "cancellation",
      sentiment: "negative",
      severity: 0.5,
      confidence: 1,
      occurredAt: event.occurredAt,
      sourceEventId: event.id,
      sourceEntityType: "reservation",
      sourceEntityId: reservation.id,
      // Rezervasyon başına TEK iptal sinyali (replay / tekrar iptal event'i çoğaltmaz).
      dedupeKey: `${organizationId}:reservation.cancelled:${reservation.id}`,
    };
  }
  if (event.kind === "reservation.updated" && event.changedFields.some((f) => (DATE_FIELDS as readonly string[]).includes(f))) {
    return {
      organizationId,
      propertyId: reservation.propertyId,
      reservationId: reservation.id,
      conversationId: null,
      source: "reservation",
      kind: "reservation.dates_changed",
      category: "date_change",
      sentiment: "neutral",
      severity: 0.3,
      confidence: 1,
      occurredAt: event.occurredAt,
      sourceEventId: event.id,
      sourceEntityType: "reservation",
      sourceEntityId: reservation.id,
      // Her tarih değişikliği ayrı sinyal; aynı EVENT ikinci kez işlenince tekrar üretilmez.
      dedupeKey: `${organizationId}:reservation.dates_changed:${reservation.id}:${event.id}`,
    };
  }
  return null;
}
