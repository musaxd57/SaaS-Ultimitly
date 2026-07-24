import type { Priority, ReplyTone } from "@/lib/constants";

export interface KbContext {
  category: string;
  title: string;
  content: string;
}

export interface ReservationContext {
  guestName: string;
  arrivalDate: Date | string;
  departureDate: Date | string;
  status: string;
  /** The guest's own previously-stated check-out time ("HH:MM"), if known. */
  guestCheckoutTime?: string | null;
}

/** Neighbouring bookings for the SAME property — for turnover-day reasoning. */
export interface AdjacencyContext {
  /** Nearest prior booking's check-out date (same property), or null. */
  previousDeparture?: Date | string | null;
  /** Nearest following booking's check-in date (same property), or null. */
  nextArrival?: Date | string | null;
}

export interface PropertyContext {
  name: string;
  checkInTime: string;
  checkOutTime: string;
  address?: string | null;
  city?: string | null;
}

export interface HistoryMessage {
  direction: "inbound" | "outbound";
  body: string;
}

export interface SuggestReplyInput {
  guestMessage: string;
  property: PropertyContext;
  reservation?: ReservationContext | null;
  knowledgeBase: KbContext[];
  history?: HistoryMessage[];
  tone: ReplyTone;
  language: string;
  /** Distilled guide of the host's own reply style (optional, learned). */
  styleProfile?: string | null;
  /** Neighbouring bookings (same property) for early-checkin/late-checkout calls. */
  adjacency?: AdjacencyContext | null;
  /**
   * Host-configured late-checkout / stay-extension offer (their own price/terms),
   * or null/empty when not set. Surfaced ONLY on an actual late-checkout / extend
   * request — an explicit, host-scoped exception to the "never quote a price" rule.
   * The reply stays payment-method-neutral and still defers final confirmation to
   * the host. Empty/absent → today's behavior (no price, defer to host).
   */
  lateCheckoutOfferText?: string | null;
  /**
   * PUBLIC anonymous surface (QR concierge) where the caller has ALREADY
   * verified an active stay but deliberately passes no reservation PII.
   * Suppresses the "prospective guest / complete your booking" framing while
   * KEEPING the no-secrets policy (it's still an open channel).
   */
  verifiedActiveStay?: boolean;
}

export interface SuggestReplyResult {
  intent: string;
  /** 0..1 */
  confidence: number;
  reply: string;
  risk: string | null;
  priority: Priority;
  source: "openai" | "fallback";
  /** What the human operator should do (not what the AI replied). */
  actionSuggestion: string | null;
  /** Overall risk classification for this message. */
  riskLevel: "none" | "low" | "medium" | "high";
  /** BCP-47 language tag detected from the guest message. */
  detectedLanguage: string;
  /**
   * WHY the message is risky — a LABEL, never a decision (the send gate stays
   * in code and only ever tightens on it). Null when not risky / unknown.
   * One of RISK_TYPES (unknown model output is clamped to null).
   */
  riskType: string | null;
  /** Evidence: which context grounded the reply (e.g. "kb:wifi", "reservation:checkOutTime", "property:checkInTime", "history"). */
  usedSources: string[];
  /** What was missing to answer fully (short phrases; empty when nothing). */
  missingInfo: string[];
  /** The guest's own stated departure/check-out time as "HH:MM" (24h), or null. */
  statedCheckoutTime: string | null;
}

export interface ClassifyResult {
  intent: string;
  priority: Priority;
  isComplaint: boolean;
  confidence: number;
}
