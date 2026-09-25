import "server-only";

import { prisma } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db-errors";
import { reportError } from "@/lib/report-error";

// ---------------------------------------------------------------------------
// recordRiskEvent — the ONLY writer of RiskEvent rows (Codex #32).
//
// Contract:
//  * Called strictly AFTER the final deterministic code decision (gate verdict
//    or keyword escalation) — never from raw model output, never on dryRun.
//  * NEVER throws and never blocks/repeats delivery: a persist failure is
//    reported (reportError) and swallowed — analytics must not change
//    messaging semantics.
//  * Retry-idempotent at the DB level via @@unique([organizationId, surface,
//    triggerId, finalDecision]) — the duplicate hit is silently absorbed (targeted P2002
//    only; any other violation still gets reported).
//  * PII-FREE: CLOSED-SET clamps only — an unknown value becomes NULL, so no
//    guest text, name, phone, e-mail or prompt fragment can ever land here.
// ---------------------------------------------------------------------------

// "guest_chat" (QR concierge) — şema yorumundaki "QR may join later" bu turda
// gerçekleşti: canlıda her soruya devir gözlendi ama SEBEP hiçbir yere
// yazılmadığı için teşhis yalnız yeniden üretimle yapılabiliyordu.
const SURFACES = new Set(["auto_reply", "alerts", "guest_chat"]);
// "no_reply" (09-25, kurucu: kapanış mesajına sessizlik): hiçbir şey gönderilmedi ve insana da bırakılmadı —
// misafir yalnız teşekkür/onay/övgü yazdı (`ai/closing-turn.ts`). Raporların "insana kaldı" sayımına KARIŞMAZ.
const DECISIONS = new Set(["auto_sent", "human_review", "no_reply"]);
const LEVELS = new Set(["none", "low", "medium", "high"]);
// CLOSED SETS, not sanitization: stripping separators from free text still
// leaks concatenated names/digits ("adalovelace555…"). A value either IS one
// of the known codes or it becomes NULL — guest text can never survive.
// QR kapısının HER dalı AYRI kodla izlenir (hangi kapının kapattığı canlıda
// görünsün): tek "low_confidence_or_risky" kovası teşhis için yetersizdi.
// ⚠️ Burada eskiden "dokuz dal" ve "mustEscalate" yazıyordu; ikisi de BAYATLADI
// (dal sayısı büyüdü, fonksiyonun adı `evaluateEscalation`). Sayı yazmıyoruz —
// parite artık mekanik (`tests/unit/risk-event-reason-parity.test.ts`).
const REASONS = new Set([
  "escalated_to_human", "low_confidence_or_risky", "keyword_escalated", "gate_passed",
  // guest_chat (QR) — `evaluateEscalation` dallarıyla BİREBİR:
  "guest_name_injection", "model_unavailable", "escalate_intent", "model_risk_type",
  "keyword_risk_type", "injection", "model_risk_level", "low_confidence",
  "informational_low_confidence", "unsourced_claim", "absence_admission",
  // 🚨 GEÇMİŞTEKİ injection (displacement) — `injection`dan AYRI kod, çünkü
  // canlıda "güncel mesaj mı yoksa saklanmış bir yük mü kapattı" sorusu farklı
  // bir teşhis. Bu satır 09-12'de EKLENDİ ve eklenmesi bir TEST tarafından
  // zorlandı: kod yeni gerekçeyi yazıyordu ama `clampTo` onu tanımadığı için
  // sessizce NULL'a düşürüyordu — kapı doğru çalışırken teşhis körleşiyordu.
  "history_injection",
  // Çıktı vetosu (Codex §A, 09-12): misafire GİDECEK metin son kez denetlenir.
  "placeholder_in_reply", "unverified_commitment",
  // Müsaitlik vetosu (09-24): doğrulanmamış takvim iddiası / ertelemeyen cevap. Kanal yolunda da
  // yazılır (düşük güven kovasından AYRI, raporda kendi satırı).
  "availability_claim", "availability_unconfirmed",
  // Hassas istekte erteleyen cevap para söylüyor (dilim 8, `availability-claims.ts` `price_claim`).
  "price_claim",
  // Anlama katmanının risk niyeti (09-24, `semantic/intent-risk.ts`; yalnız anlama katmanı açıkken).
  "understanding_risk",
  // Doğrulanmış erken giriş (09-24, `lib/early-checkin`): koddan kurulan onay metni otomatik gönderildi.
  "early_checkin_verified",
  // Bilgi sorusu (dilim 6): host kuralından koddan kurulan politika metni (ücret + "karar ev sahibinin") gönderildi.
  "early_checkin_policy",
  // Saat kaynağı çelişkisi (P4-b kodda, 09-25): mülk ayarı ↔ bilgi tabanı giriş/çıkış saati çelişkili alana değen cevap.
  "kb_time_conflict",
  // Cevap misafirin dilinde değil (09-25, `ai/language-signal.ts`; yalnız kanal kapısı — QR'da bilinçli yok).
  "reply_language_mismatch",
  // Kapanış mesajı → cevap gerekmedi (09-25, `ai/closing-turn.ts`): sözcük yolu / iki modelin uyuştuğu anlam yolu.
  "closing_ack", "closing_ack_semantic",
  // Eylem beyanı (MÇ §4, `ai/action-claims.ts`; bayrak kapalıyken yazılmaz): cevap makbuzsuz bir eylem iddia etti /
  // beyan istenip gelmedi. Kanal + QR; raporda kendi satırı.
  "action_claim", "action_claim_undeclared",
]);
/**
 * 🚨 PARİTE: QR kapısının her `EscalationReason` değeri BURADA da olmalı.
 * `clampTo` tanımadığı değeri sessizce `null` yapar (fail-safe, doğru) — ama o
 * sessizlik yeni bir dal eklendiğinde teşhisi öldürür. Mekanik pin:
 * `tests/unit/risk-event-reason-parity.test.ts`.
 */
export const ESCALATION_REASON_CODES: ReadonlySet<string> = REASONS;
// Exported: the shadow layer (shadow-ai.ts) clamps the second model's riskType
// to the SAME closed set so the two columns stay directly comparable.
export const RISK_TYPES = new Set([
  "complaint", "money_refund", "cancellation", "human_request", "review_threat",
  "platform_policy", "safety_emergency", "discrimination", "rule_violation",
  "access_security", "prompt_injection",
]);

function clampTo(set: Set<string>, v: string | null | undefined): string | null {
  return v && set.has(v) ? v : null;
}

export interface RiskEventInput {
  organizationId: string;
  propertyId?: string | null;
  conversationId?: string | null;
  surface: "auto_reply" | "alerts" | "guest_chat";
  /** The inbound Message id that forced this decision. */
  triggerId: string;
  finalDecision: "auto_sent" | "human_review" | "no_reply";
  /** null on the keyword path — there is no model verdict to report there. */
  riskLevel?: string | null;
  riskType?: string | null;
  reason?: string | null;
  confidence?: number | null;
  // --- A2: temellendirme sayaçları (hepsi opsiyonel; verilmezse NULL) -------
  /** Koda göre isteme GERÇEKTEN giren kalem sayısı. */
  kbRetrieved?: number | null;
  /** Adet tavanı yüzünden düşen kalem sayısı. */
  kbDropped?: number | null;
  /** Aktif ama onay kapısından geçmeyen (A1 `draft`) kalem sayısı. */
  kbPendingApproval?: number | null;
  /**
   * İsteme giren kalemlerin en yeni `updatedAt`'i. 🚨 SÜRÜM KİMLİĞİ DEĞİL,
   * yalnız tazelik işareti — "hangi bilgiye dayandı" sorusunu `kbEvidenceJson`
   * yanıtlar.
   */
  kbNewestUpdatedAt?: Date | null;
  /**
   * Yetkili İÇ DENETİM kanıtı (`buildKbEvidence`): kalem kimliği + kalem sürümü
   * + doğrulanmış kaynak etiketleri. İçerik/misafir metni TAŞIMAZ, misafire
   * dönen yanıta hiçbir yoldan girmez.
   */
  kbEvidenceJson?: string | null;
  /** Modelin BEYAN ettiği kaynak sayısı. */
  srcDeclared?: number | null;
  /** Gerçek girdiyle DOĞRULANAN kaynak sayısı (beyanın alt kümesi). */
  srcVerified?: number | null;
}

/**
 * Sayaç sözleşmesi: NEGATİF/KESİRLİ/NaN → NULL, KIRPMA YOK.
 *
 * `confidence` ile aynı gerekçe: -1'i 0'a çekmek sahte ama geçerli görünen bir
 * ÖLÇÜM üretir ve çağırandaki hatayı görünmez kılar. NULL "ölçülmedi" demektir
 * ve okuma tarafı (`classifyGrounding`) onu hüküm vermeden geçer.
 */
function countOrNull(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
}

/**
 * Kanıt gövdesi sözleşmesi: AYRIŞTIRILABİLİR JSON nesnesi ve tavan altı olmalı.
 *
 * 🚨 Serbest metin bu kolona SIZMAMALI. `RiskEvent` "PII yok" sözleşmesiyle
 * yaşıyor; ayrıştırılamayan bir gövdeyi saklamak, ilk hatalı çağıranda o sözü
 * sessizce öldürürdü. Ayrıştırılamayan/aşırı büyük değer NULL yazılır
 * (kırpılmaz — yarım JSON denetimi yanıltır).
 */
function evidenceOrNull(v: string | null | undefined): string | null {
  if (typeof v !== "string" || v.length === 0 || v.length > 8_000) return null;
  try {
    const parsed: unknown = JSON.parse(v);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return v;
  } catch {
    return null;
  }
}

/**
 * A2 sayaçlarını kolonlara çevirir.
 *
 * 🚨 TUTARSIZ ÇİFT İKİSİNİ DE DÜŞÜRÜR: `srcVerified` her zaman `srcDeclared`ın
 * ALT KÜMESİDİR (doğrulama yalnız eler, ekleyemez). Tersi bir çift çağıranda
 * hata demektir; yazılırsa "uydurma atıf" farkı NEGATİF çıkar ve teşhis
 * sessizce yanlış okunur. Yarısını yazmak da olmaz — yarım çift, olmayan bir
 * ölçümü varmış gibi gösterirdi.
 */
function groundingColumns(e: RiskEventInput) {
  const declared = countOrNull(e.srcDeclared);
  const verified = countOrNull(e.srcVerified);
  const consistent = declared === null || verified === null || verified <= declared;
  return {
    kbRetrieved: countOrNull(e.kbRetrieved),
    kbDropped: countOrNull(e.kbDropped),
    kbPendingApproval: countOrNull(e.kbPendingApproval),
    kbNewestUpdatedAt:
      e.kbNewestUpdatedAt instanceof Date && !Number.isNaN(e.kbNewestUpdatedAt.getTime())
        ? e.kbNewestUpdatedAt
        : null,
    kbEvidenceJson: evidenceOrNull(e.kbEvidenceJson),
    srcDeclared: consistent ? declared : null,
    srcVerified: consistent ? verified : null,
  };
}

export async function recordRiskEvent(e: RiskEventInput): Promise<void> {
  try {
    if (!SURFACES.has(e.surface) || !DECISIONS.has(e.finalDecision) || !e.triggerId) {
      await reportError("risk-event invalid input", new Error(`surface=${e.surface} decision=${e.finalDecision}`));
      return;
    }
    await prisma.riskEvent.create({
      data: {
        organizationId: e.organizationId,
        propertyId: e.propertyId ?? null,
        conversationId: e.conversationId ?? null,
        surface: e.surface,
        triggerId: e.triggerId,
        finalDecision: e.finalDecision,
        riskLevel: e.riskLevel && LEVELS.has(e.riskLevel) ? e.riskLevel : null,
        riskType: clampTo(RISK_TYPES, e.riskType),
        reason: clampTo(REASONS, e.reason),
        // In-range-or-NULL, never clamped: an out-of-range/NaN/Infinity value is
        // a bug signal — recording a fabricated valid-looking number would hide it.
        confidence:
          typeof e.confidence === "number" && Number.isFinite(e.confidence) && e.confidence >= 0 && e.confidence <= 1
            ? e.confidence
            : null,
        ...groundingColumns(e),
      },
    });
  } catch (err) {
    if (isUniqueViolation(err, ["organizationId", "surface", "triggerId", "finalDecision"])) return; // retry dedupe (tenant-scoped)
    await reportError("risk-event persist", err).catch(() => {});
  }
}
