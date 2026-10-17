import type { MessageUnderstanding } from "./understanding-schema";

// ---------------------------------------------------------------------------
// ANLAMA KATMANININ RİSK NİYETLERİ → KAPI (09-24). Saf: ağ yok, DB yok.
//
// Kapının şikâyet / acil durum / iptal-iade / insan talebi korumaları bugün KELİME AĞINA ve cevap modelinin
// KENDİ niyet etiketine dayanıyor. Kelime ağı dolaylı dili tanımıyor — ÖLÇÜLDÜ (09-24, `classifyFallback` +
// `detectRiskType` ikisi de engellemiyor): "My daughter cut her hand badly, where is the nearest hospital?" ·
// "Kapının kilidi takılıyor, dışarıda kaldık." · "Can I speak with the owner directly please?" · "Ev sahibiyle
// bizzat konuşabilir miyim?" · "I would like to get back the amount for the last two nights." · "There are ants
// all over the kitchen counter." · "Komşular gece boyunca bağırdı, hiç uyuyamadık." Bu mesajlarda tek savunma
// cevap modelinin kendi etiketidir; o da cevabını üretirken kendini "genel" diye etiketleyebilir. Anlama katmanı
// AYRI bir model çağrısıdır ve mesajı yazılış biçiminden bağımsız olarak kapalı bir niyet kümesine indirir —
// bu dosya o niyetlerden dördünü KAPIYA taşır (üçüncü bağımsız görüş).
//
// Sözleşme (CLAUDE.md anlam katmanı kuralları ile aynı):
//  · YALNIZ SIKILAŞTIRIR: sinyal bir otomatik gönderimi engelleyebilir, hiçbir zaman sebep olamaz.
//  · 🚨 BİRLEŞİM DEĞİŞMEZİ (09-24 üçüncü tur): hiçbir katmanın "risk yok"u başka bir katmanın riskini SİLEMEZ →
//    katman koştuysa sinyal HER ZAMAN karar verir (09-24'e kadarki `AI_INTENT_POLICY` gölge kipi KALDIRILDI; anahtar
//    artık okunmaz). Geri alma = katmanın kendisi (`AI_UNDERSTANDING_ENABLED`). Açma = eval + kurucu onayı.
//  · Katman kapalıysa / düştüyse sinyal YOK (eski davranış birebir); başarısızlık kanıtta ayrıca görünür.
//  · İnsan talebi: cevap modelinin KENDİ devir cevabı (`intent === "human_request"`) doğru cevaptır → muaf
//    (kelime ağındaki kuralla aynı: devri istemek devri engellemez).
// ---------------------------------------------------------------------------

/** Öncelik sırası: acil > şikâyet > iptal/iade > insan talebi (kanıtta tek kod yazılır). */
export const INTENT_RISK_KINDS = ["emergency", "complaint_issue", "cancellation_refund", "human_request"] as const;
export type IntentRiskKind = (typeof INTENT_RISK_KINDS)[number];

/** Kapının ve karar kaydının gerekçe kodu (kapalı küme; `risk-events.ts` REASONS ile parite). */
export const INTENT_RISK_REASON = "understanding_risk" as const;
export type IntentRiskReason = typeof INTENT_RISK_REASON;

/** Anlama katmanının en ağır risk niyeti; katman yoksa ya da risk niyeti yoksa `null`. */
export function understandingRiskOf(u: MessageUnderstanding | null | undefined): IntentRiskKind | null {
  if (!u || !Array.isArray(u.requests)) return null;
  for (const kind of INTENT_RISK_KINDS) {
    if (u.requests.some((r) => r.intent === kind)) return kind;
  }
  return null;
}

export interface IntentRiskEvaluation {
  /** Uygulanan karar. */
  reason: IntentRiskReason | null;
  /** 09-24'ten beri `reason`a EŞİT (gölge kip kaldırıldı); kanıt şeması (`ir.ev`) kararlı kalsın diye korunur. */
  enforceReason: IntentRiskReason | null;
  /** Sinyalin kendisi (muafiyetten önce); kanıt için. */
  kind: IntentRiskKind | null;
}

export function evaluateIntentRisk(
  kind: IntentRiskKind | null | undefined,
  opts: { modelIntent: string },
): IntentRiskEvaluation {
  const k = kind ?? null;
  // Devir cevabı insan talebinin DOĞRU cevabıdır; başka her risk niyeti (acil/şikâyet/iptal) devir cevabında
  // da taslakta kalır (devir metni o konunun cevabı değildir).
  const effective = k === "human_request" && opts.modelIntent === "human_request" ? null : k;
  const reason = effective ? INTENT_RISK_REASON : null;
  return { reason, enforceReason: reason, kind: k };
}

/**
 * Risk niyeti → konuşmanın risk etiketi (`RiskEvent.riskType` / `Conversation.lastRiskType` kapalı kümesi,
 * `risk-events.ts` RISK_TYPES; parite pinli). Yalnız cevap modeli ve kelime ağı etiket VERMEDİĞİNDE kullanılır —
 * host'a giden acil yükseltmenin rozeti boş kalmasın. İptal-iade tek niyettir; para riski öne çıkar.
 */
export function riskTypeOfIntentRisk(kind: IntentRiskKind | null | undefined): string | null {
  switch (kind) {
    case "emergency":
      return "safety_emergency";
    case "complaint_issue":
      return "complaint";
    case "cancellation_refund":
      return "money_refund";
    case "human_request":
      return "human_request";
    default:
      return null;
  }
}

/** Kanıt özeti (`kbEvidenceJson.ir`): yalnız kapalı-küme kodlar, metin/PII YOK. */
export function intentRiskEvidenceOf(e: IntentRiskEvaluation): { v: string; ev: string; k: string } {
  return { v: e.reason ?? "-", ev: e.enforceReason ?? "-", k: e.kind ?? "-" };
}
