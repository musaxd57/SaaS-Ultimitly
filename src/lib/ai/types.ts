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
}

export interface ClassifyResult {
  intent: string;
  priority: Priority;
  isComplaint: boolean;
  confidence: number;
}
