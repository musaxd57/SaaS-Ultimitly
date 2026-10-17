import "server-only";

import { prisma } from "@/lib/db";
import { planByCode } from "./plans";
import { trialCardRequired } from "./trial-card-gate";

// ---------------------------------------------------------------------------
// Subscription entitlements (Faz 2). SAFE BY DESIGN — see ROADMAP "en kritik
// risk: canlı müşterileri yanlışlıkla paywall'a düşürmemek".
//
//   * An org with NO Subscription row → grandfathered → active → UNLIMITED.
//     (This is the backfill-by-default: every existing customer stays unblocked.)
//   * Enforcement only ever happens when BILLING_ENFORCED=true.
//
// Nothing here is wired into property creation yet — turning the paywall ON is a
// deliberate, separate step taken only after existing orgs are confirmed active.
// ---------------------------------------------------------------------------

export type Entitlement = {
  planCode: string;
  planName: string;
  propertyLimit: number | null; // null = unlimited
  status: string;
  active: boolean; // may the org use paid features right now?
  grandfathered: boolean; // existing org, no subscription row
  trialing: boolean; // currently inside the free reverse-trial
  trialEndsAt: Date | null;
  trialDaysLeft: number | null; // whole days left (0 once past), null when not trialing
  trialExpired: boolean; // a trial whose end date has passed (effect gated by enforcement)
  /** Kartla deneme kapısı (kurucu 10-17, migration 74): yüksek riskli denemede kart isteniyor → sınırlı mod (anahtar + zorunluluk açıkken). */
  cardRequired: boolean;
  /**
   * Yenileme iptal edildi, abonelik dönem sonunda bitecek (Paddle `scheduled_change.action = cancel`) — kurucu 10-17: "iptal edince o tarihe
   * kadar aldığı paketi kullanmaya devam eder, ekranda yazsın". `periodEnd` ödenmiş dönemin sonu (bilinmiyorsa null).
   */
  cancelAtPeriodEnd: boolean;
  periodEnd: Date | null;
};

const ACTIVE_STATUSES = new Set(["active", "trialing", "grandfathered"]);

// ÖDEME GECİKMESİNDE EK SÜRE YOK (kurucu kararı 10-16: "Geçerli ödenmiş dönem bitince ücretli otomatik işler dursun; yenileme ödemesi
// doğrulanınca açılsın. Ek 14 gün istemiyorum."). `past_due` = yenileme ödemesi alınamadı. Erişim YALNIZ zaten ödenmiş dönem sürüyorsa
// (`currentPeriodEnd` gelecekte) açık kalır; dönem bittiyse kapanır. Paddle yeniden denemeyi kendisi yapar; ödeme doğrulanınca (`active`
// olayı) erişim ANINDA açılır. Müşteri yeni ödeme ekranına değil "Aboneliği yönet"e (kart güncelle → Paddle aynı işlemi yeniden dener)
// yönlendirilir — körlemesine yeniden ödeme yok. Eski 14 günlük ek süre (`BILLING_PAST_DUE_GRACE_DAYS`) KALDIRILDI. Kurucu ağı aşağıda aynen.

// Reverse trial: every new signup gets full Pro free for this many days (no
// card). If they don't upgrade, access pauses — ONLY once billing is enforced.
export const TRIAL_DAYS = Number(process.env.TRIAL_DAYS) || 14;

/** End date for a trial starting now (or at `from`). */
export function trialEndDate(from: Date = new Date()): Date {
  return new Date(from.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Subscription row data for a brand-new signup: a Pro reverse-trial. Stored even
 * while billing is dormant — entitlement treats `trialing` exactly like
 * grandfathered until BILLING_ENFORCED is on, so it changes nothing today.
 */
export function newTrialSubscriptionData() {
  return {
    planCode: "pro",
    status: "trialing",
    provider: "trial",
    trialEndsAt: trialEndDate(),
  };
}

/** True only when billing is explicitly enforced. Default OFF → nothing blocked.
 *  Accepts both "true" (documented) and "1" (the convention every other feature
 *  flag uses) so an operator matching the "1" pattern can't silently leave
 *  enforcement off. */
export function billingEnforced(): boolean {
  const v = process.env.BILLING_ENFORCED;
  return v === "true" || v === "1";
}

/** Resolve an organization's current entitlement (permissive default). */
/**
 * Is this the founder's OWN org (internal access)? Keyed strictly off the
 * explicit PRIMARY_ORG_ID env — the founder's fixed org id — so it can never
 * accidentally cover a customer org. This is the ONE source for founder
 * treatment: the entitlement guard below forces access on, and the settings
 * page hides the customer billing card (plans / Paddle portal / invoices) —
 * internal access is an explicit entitlement, not a lookalike subscription.
 */
export function isFounderOrg(organizationId: string): boolean {
  return Boolean(process.env.PRIMARY_ORG_ID) && organizationId === process.env.PRIMARY_ORG_ID;
}

export async function getEntitlement(organizationId: string): Promise<Entitlement> {
  const sub = await prisma.subscription.findUnique({ where: { organizationId } });
  if (!sub) {
    return {
      planCode: "grandfathered",
      // Kullanıcıya görünen ad: "Mevcut müşteri" İÇ JARGONDU (faturalandırma
      // gelmeden önceki hesap demek) ve okuyan kişiye hiçbir şey anlatmıyordu.
      // Sahip olduğu şeyi söyle — `propertyLimit: null` zaten sınırsız.
      planName: "Tam erişim",
      propertyLimit: null,
      status: "grandfathered",
      active: true,
      grandfathered: true,
      trialing: false,
      trialEndsAt: null,
      trialDaysLeft: null,
      trialExpired: false,
      cardRequired: false,
      cancelAtPeriodEnd: false,
      periodEnd: null,
    };
  }
  const plan = planByCode(sub.planCode);
  const now = Date.now();
  const trialing = sub.status === "trialing";
  const trialEndsAt = sub.trialEndsAt ?? null;
  // A `trialing` subscription with NO end date is malformed (every legitimate
  // reverse-trial stamps trialEndsAt via newTrialSubscriptionData). Treat the
  // missing anchor as EXPIRED — fail-closed — so a Paddle webhook or a hand-edited
  // row that lands status="trialing" without a date can't grant an unlimited free
  // trial forever. Only bites under enforcement (see the trialExpired gate below).
  const trialExpired = trialing && (trialEndsAt == null || trialEndsAt.getTime() <= now);
  const trialDaysLeft =
    trialing && trialEndsAt != null
      ? Math.max(0, Math.ceil((trialEndsAt.getTime() - now) / 86_400_000))
      : null;

  let active = ACTIVE_STATUSES.has(sub.status);
  // Ödeme gecikmesi (kurucu 10-16): yalnız ZATEN ÖDENMİŞ dönem sürüyorsa açık; ek süre yok. Dönem sonu bilinmiyorsa kapalı (güvenli yön:
  // ödenmemiş erişim verilmez). `updatedAt`'e ASLA bakılmaz (her yeniden deneme olayı onu ileri atar).
  if (sub.status === "past_due" && sub.currentPeriodEnd != null && sub.currentPeriodEnd.getTime() > now) active = true;
  // An expired reverse-trial only loses access once billing is actually
  // enforced. Until then every org stays unblocked (dormant by design), so
  // flipping BILLING_ENFORCED off always restores access — the true kill-switch.
  if (trialExpired && billingEnforced()) active = false;
  // KARTLA DENEME (kurucu 10-17): süren KARTSIZ denemede risk yüksekse kart eklenene kadar sınırlı mod — yalnız faturalandırma zorunluyken
  // (aynı kill-switch). Kart Paddle'da eklenince abonelik sağlayıcısı "paddle" olur → bu dal hiç koşmaz.
  let cardRequired = false;
  if (trialing && !trialExpired && sub.provider === "trial" && billingEnforced()) {
    cardRequired = await trialCardRequired(organizationId);
    if (cardRequired) active = false;
  }

  // Founder safety net: the primary org (the founder's OWN org) must NEVER be
  // paywalled — not even by a real test payment that creates a Subscription row
  // which later lapses/expires, nor by a mis-mapped webhook. Force access on
  // WITHOUT distorting the displayed plan/status (those stay truthful).
  if (!active && isFounderOrg(organizationId)) {
    active = true;
  }

  return {
    planCode: sub.planCode,
    planName: plan?.name ?? sub.planCode,
    propertyLimit: plan ? plan.propertyLimit : null,
    status: sub.status,
    active,
    grandfathered: sub.status === "grandfathered",
    trialing,
    trialEndsAt,
    trialDaysLeft,
    trialExpired,
    cardRequired,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    periodEnd: sub.currentPeriodEnd ?? null,
  };
}

/**
 * May this org use PAID features right now (AI auto-reply, automated messages,
 * AI suggest/test, translate, QR)? Free/expired tier keeps browsing + manual
 * work but loses the OpenAI-spending automation. DORMANT-SAFE: always true while
 * BILLING_ENFORCED is off, so nothing is gated until the paywall is switched on.
 * Grandfathered/active/trialing orgs (incl. the founder) are always allowed.
 */
export async function premiumAllowed(organizationId: string): Promise<boolean> {
  if (!billingEnforced()) return true;
  return (await getEntitlement(organizationId)).active;
}

export type AddPropertyCheck = {
  allowed: boolean;
  reason?: "subscription_inactive" | "property_limit";
  limit?: number | null;
  current?: number;
};

/**
 * Whether the org may add another property. NON-BLOCKING unless billing is
 * enforced, so calling this today always returns { allowed: true }.
 */
export async function canAddProperty(organizationId: string): Promise<AddPropertyCheck> {
  if (!billingEnforced()) return { allowed: true };
  // 🚨 KURUCU MUAFİYETİ BURADA DA AÇIKÇA KURULUR (denetim, 08-09) — `limitsForOrg`
  // 07-31'de tam bu sebeple düzeltilmişti ama MÜLK kapıları atlanmıştı.
  // `getEntitlement`in kurucu ağı yalnız `active`'i zorluyor, `propertyLimit`i
  // DEĞİŞTİRMİYOR (kendi yorumu "planı/durumu bozmadan" diyor) ve kurucunun
  // GERÇEK bir Pro aboneliği var → limit 7. Kurucu org ~10 daire işletiyor ve
  // `BILLING_ENFORCED=true` canlı: yani ürünün sahibi kendi ürününde yeni daire
  // ekleyemiyordu. Yalnız `PRIMARY_ORG_ID`ye eşit org'u etkiler.
  if (isFounderOrg(organizationId)) return { allowed: true, limit: null };

  const ent = await getEntitlement(organizationId);
  if (!ent.active) return { allowed: false, reason: "subscription_inactive" };
  if (ent.propertyLimit == null) return { allowed: true, limit: null };

  const current = await prisma.property.count({ where: { organizationId } });
  if (current >= ent.propertyLimit) {
    return { allowed: false, reason: "property_limit", limit: ent.propertyLimit, current };
  }
  return { allowed: true, limit: ent.propertyLimit, current };
}
