// ---------------------------------------------------------------------------
// KAPI KANITI (09-25, mesaj anlama çekirdeği denetimi): "garip bir karar neden verildi?" sorusu karar kaydından
// cevaplanabilsin. Kapı (`automation.ts autoReplyGateFailure`) on dört ayrı güvenlik kontrolünü tek `blocked`
// gerekçesinde topluyordu: sözcüksel bir net mi (kelime ağı), modelin kendi etiketi mi, güven mi kapattı — kayıtta
// ayırt edilemiyordu. Burada iki şey kaydedilir, ikisi de KARAR DEĞİL (kapı bu modülü okumaz):
//  · `d` — `blocked` gerekçesinde kapıyı İLK kapatan kontrol (kapalı küme).
//  · Sinyal ayrımı: SÖZCÜKSEL UYARILAR (`lx`, kelime ağının etiketleri — düşük kesinlikli, yalnız tutar) ile
//    MODELİN hükmü (`mi/mt/ml`) ayrı alanlarda. Anlama katmanının risk niyeti zaten `ir` alanında.
// Amaç ölçmek: "yalnız kelime ağının tuttuğu" mesajlar (model ve anlama katmanı risk görmedi) canlı trafikte ne
// kadar — sözcüksel yetkiyi azaltma kararı bu sayıya dayanır (bugün değişmez: birleşim kuralı AYNEN).
// PII YOK: yalnız kapalı-küme kodlar. Saf; tek bağımlılık eylem beyanı kod kümesi (`action-claims.ts`, o da saf).
// ---------------------------------------------------------------------------
import { actionClaimEvidence, cleanActionClaimEvidence, type ClaimedActionsDeclaration } from "./action-claims";

/** `blocked` gerekçesinin ayrıntısı — kapının kontrol sırasıyla. */
export const GATE_BLOCK_DETAILS = [
  "not_model", // model cevabı yok (şablon/yedek)
  "model_intent", // modelin niyeti şikâyet/iade/erken ayrılış
  "lexical_intent", // kelime ağı: cevapsız mesajlarda şikâyet/iade/erken ayrılış/insan talebi
  "lexical_risk", // kelime ağı: yüksek riskli etiket (acil, kural ihlali, ayrımcılık, …)
  "lexical_injection", // son mesajda istem enjeksiyonu kalıbı
  "context_injection", // geçmişte ya da misafir adında istem enjeksiyonu kalıbı
  "model_risk_label", // modelin yüksek riskli etiketi
  "model_risk_level", // modelin risk düzeyi orta/yüksek
  "reply_absence", // cevap "bilgim yok" itirafı
  "reply_output_veto", // cevapta yer tutucu / makbuzsuz eylem iddiası
  "confidence_invalid",
  "low_confidence",
  // Konuşma öğeleri kipi (09-26): cevap yalnız beyan ettiği güvenli istekleri kapsar.
  "items_undeclared", // beyan yok / bozuk
  "items_touch_held", // bırakılan ya da bilinmeyen istek beyan edildi
  "items_nothing_answered", // hiçbir güvenli istek cevaplanmadı (gönderecek bir şey yok)
  "items_payment_held", // ödeme öğesi tutuluyken cevapta ödeme yöntemi / yeri
] as const;
export type GateBlockDetail = (typeof GATE_BLOCK_DETAILS)[number];

/** Kelime ağının üretebileceği etiketler (`detectRiskType` kümesi + bağlam enjeksiyonu). */
export const LEXICAL_ALERTS = [
  "prompt_injection",
  "context_injection",
  "safety_emergency",
  "review_threat",
  "platform_policy",
  "money_refund",
  "cancellation",
  "discrimination",
  "rule_violation",
  "human_request",
  "complaint",
] as const;

/**
 * Modelin kapıyı kapatabilecek niyetleri ve risk etiketleri — TEK KAYNAK: kapı (`automation.ts`
 * `NEVER_AUTO_REPLY_INTENTS` / `HIGH_STAKES_RISK_TYPES`) kümelerini buradan kurar, kanıt ile kapı ayrışamaz.
 */
export const NEVER_AUTO_REPLY_INTENT_LIST = ["complaint", "refund", "early_departure"] as const;
export const HIGH_STAKES_RISK_TYPE_LIST = [
  "money_refund", "cancellation", "review_threat", "platform_policy", "safety_emergency", "discrimination",
  "access_security", "prompt_injection", "complaint", "human_request", "rule_violation",
] as const;
const MODEL_INTENTS: ReadonlySet<string> = new Set(NEVER_AUTO_REPLY_INTENT_LIST);
const MODEL_RISK_TYPES: ReadonlySet<string> = new Set(HIGH_STAKES_RISK_TYPE_LIST);
const MODEL_RISK_LEVELS: ReadonlySet<string> = new Set(["medium", "high"]);

export interface GateEvidence {
  /** `blocked` ayrıntısı (yalnız gerekçe `blocked` iken). */
  d?: string;
  /** Kelime ağı uyarıları — cevapsız misafir mesajları + bağlam (sıralı, tekil). */
  lx: string[];
  /** Modelin kapatıcı niyeti. */
  mi?: string;
  /** Modelin yüksek riskli etiketi. */
  mt?: string;
  /** Modelin orta/yüksek risk düzeyi. */
  ml?: string;
  /** Modelin eylem beyanı (MÇ §4): kapalı-küme kodlar ya da `["unknown"]`; beyan istenmediyse alan yok. */
  ma?: string[];
}

const DETAIL_SET: ReadonlySet<string> = new Set(GATE_BLOCK_DETAILS);
const ALERT_SET: ReadonlySet<string> = new Set(LEXICAL_ALERTS);

/** Kanıtı yeniden kurar: tanınmayan her değer düşer (serbest metin sızamaz). */
export function cleanGateEvidence(x: GateEvidence | undefined): GateEvidence | undefined {
  if (!x || !Array.isArray(x.lx)) return undefined;
  const lx = [...new Set(x.lx.filter((a) => ALERT_SET.has(a)))].sort();
  return {
    ...(typeof x.d === "string" && DETAIL_SET.has(x.d) ? { d: x.d } : {}),
    lx,
    ...(typeof x.mi === "string" && MODEL_INTENTS.has(x.mi) ? { mi: x.mi } : {}),
    ...(typeof x.mt === "string" && MODEL_RISK_TYPES.has(x.mt) ? { mt: x.mt } : {}),
    ...(typeof x.ml === "string" && MODEL_RISK_LEVELS.has(x.ml) ? { ml: x.ml } : {}),
    ...(() => {
      const ma = cleanActionClaimEvidence(x.ma);
      return ma ? { ma } : {};
    })(),
  };
}

/** Model tarafı sinyaller (kapının kümeleriyle aynı; yalnız kapatıcı olanlar yazılır). */
export function modelGateSignals(result: {
  intent: string;
  riskType?: string | null;
  riskLevel: string;
  claimedActions?: ClaimedActionsDeclaration | null;
}): Pick<GateEvidence, "mi" | "mt" | "ml" | "ma"> {
  const ma = actionClaimEvidence(result.claimedActions);
  return {
    ...(MODEL_INTENTS.has(result.intent) ? { mi: result.intent } : {}),
    ...(result.riskType && MODEL_RISK_TYPES.has(result.riskType) ? { mt: result.riskType } : {}),
    ...(MODEL_RISK_LEVELS.has(result.riskLevel) ? { ml: result.riskLevel } : {}),
    ...(ma ? { ma } : {}),
  };
}
