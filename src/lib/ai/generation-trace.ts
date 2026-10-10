import "server-only";

import { prisma } from "@/lib/db";
import { reportError } from "@/lib/report-error";
import type { LlmUsage } from "@/lib/ai/types";

// ---------------------------------------------------------------------------
// YAPAY ZEKÂ ÜRETİM İZİ (migration 60, kurucu onayı 10-09 "tamamını hazırla"; tasarım `docs/TASARIM-2026-10-09-migration-paketi-60.md` §D).
//
// Her cevap kararı için bir satır: model + istem sürümü, KB kanıtı (kimlik + sürüm), kapı kararı + gerekçe, gecikme, token, taslak ve
// gönderilen metin. Amaç kurucunun kalite konsolu (salt-okuma) — müşteriye giden HİÇBİR şeyi değiştirmez.
//
// Sözleşme:
//   · Anahtar `AI_GENERATION_TRACE_ENABLED` (tam "1"; VARSAYILAN KAPALI). Kapalıyken DB'ye dokunulmaz.
//   · Tek INSERT beklenir ama ASLA fırlatmaz: her arıza `reportError` + yut (karar zaten verilmiş ve RiskEvent ile kaydedilmiştir).
//   · Kapalı kümeler kıskaçlanır (bilinmeyen yüzey / karar → satır YAZILMAZ; sahte etiket üretmektense iz eksik kalır).
//   · Metin (§D-1 a, kurucu "mesajlarla aynı saklama"): saklama süpürgesi + misafir silmesi null'lar (`scrub-scope-parity`).
//   · 🚨 EĞİTİM YASAĞI: bu tablo hiçbir dışa aktarma / ince ayar yoluna bağlanmaz — okuyan modüller kapalı listede
//     (`tests/unit/ai-generation-readers.test.ts`).
// ---------------------------------------------------------------------------

export const AI_GENERATION_TRACE_FLAG = "AI_GENERATION_TRACE_ENABLED";
export function aiGenerationTraceEnabled(): boolean {
  return process.env.AI_GENERATION_TRACE_ENABLED === "1";
}

export const AI_GENERATION_SURFACES = ["channel_auto", "channel_suggest", "qr", "decision_text"] as const;
export type AiGenerationSurface = (typeof AI_GENERATION_SURFACES)[number];
export const AI_GENERATION_DECISIONS = ["auto_sent", "human_review", "no_reply"] as const;
export type AiGenerationDecision = (typeof AI_GENERATION_DECISIONS)[number];

/** Metin tavanı: cevap deposu tavanından geniş, kötü niyetli / bozuk girdide satırı şişirmez. */
export const AI_GENERATION_TEXT_CAP = 8_000;
const EVIDENCE_CAP = 8_000;

export interface AiGenerationInput {
  organizationId: string;
  propertyId?: string | null;
  reservationId?: string | null;
  /** ZORUNLU: saklama / silme metni konuşmadan bulur (şemada NOT NULL). */
  conversationId: string;
  triggerMessageId?: string | null;
  surface: AiGenerationSurface;
  /** İstenen model (sağlayıcı sunulan modeli bildirirse o yazılır). */
  model: string;
  promptVersion: string;
  decision: AiGenerationDecision;
  gateReason?: string | null;
  kbEvidenceJson?: string | null;
  latencyMs?: number | null;
  llm?: LlmUsage | null;
  draftText?: string | null;
  sentText?: string | null;
}

function intOrNull(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 2_147_483_647 ? v : null;
}

function textOrNull(v: string | null | undefined): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\u0000/g, "");
  if (!t.trim()) return null;
  return t.length > AI_GENERATION_TEXT_CAP ? t.slice(0, AI_GENERATION_TEXT_CAP) : t;
}

/** `RiskEvent` kanıt sözleşmesi: ayrıştırılabilir JSON NESNESİ ve tavan altı; değilse NULL (kırpılmaz — yarım JSON yanıltır). */
function evidenceOrNull(v: string | null | undefined): string | null {
  if (typeof v !== "string" || v.length === 0 || v.length > EVIDENCE_CAP) return null;
  try {
    const parsed: unknown = JSON.parse(v);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? v : null;
  } catch {
    return null;
  }
}

/** Saf: girdi → satır (ya da kapalı küme dışıysa null). Test edilebilir; DB yok. */
export function aiGenerationRow(input: AiGenerationInput) {
  if (!(AI_GENERATION_SURFACES as readonly string[]).includes(input.surface)) return null;
  if (!(AI_GENERATION_DECISIONS as readonly string[]).includes(input.decision)) return null;
  const model = (input.llm?.m || input.model || "").trim().slice(0, 120);
  const promptVersion = (input.promptVersion || "").trim().slice(0, 64);
  if (!model || !promptVersion || !input.organizationId || !input.conversationId) return null;
  return {
    organizationId: input.organizationId,
    propertyId: input.propertyId ?? null,
    reservationId: input.reservationId ?? null,
    conversationId: input.conversationId,
    triggerMessageId: input.triggerMessageId ?? null,
    surface: input.surface,
    model,
    promptVersion,
    decision: input.decision,
    gateReason: input.gateReason ? input.gateReason.slice(0, 64) : null,
    kbEvidenceJson: evidenceOrNull(input.kbEvidenceJson),
    latencyMs: intOrNull(input.latencyMs),
    promptTokens: intOrNull(input.llm?.pt),
    completionTokens: intOrNull(input.llm?.ct),
    reasoningTokens: intOrNull(input.llm?.rt),
    draftText: textOrNull(input.draftText),
    // Gönderilen metin YALNIZ gönderim kararında anlamlıdır; tutulan / cevapsız kararda yazılmaz.
    sentText: input.decision === "auto_sent" ? textOrNull(input.sentText) : null,
  };
}

/** Anahtar açıksa bir iz satırı yazar. ASLA fırlatmaz. */
export async function recordAiGeneration(input: AiGenerationInput): Promise<void> {
  if (!aiGenerationTraceEnabled()) return;
  try {
    const row = aiGenerationRow(input);
    if (!row) return;
    await prisma.aiGeneration.create({ data: row });
  } catch (err) {
    void reportError(`ai-generation-trace org=${input.organizationId}`, err);
  }
}
