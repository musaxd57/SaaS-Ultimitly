import "server-only";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { reportError } from "@/lib/report-error";
import { logEvent } from "@/lib/event-log";
import { getPaddleWebhookSecret, isPaddleConfigured, paddleRequest, signPaddleWebhook } from "@/lib/payments/paddle";
import { runAsPaddleReplay } from "@/lib/payments/paddle-replay-context";
import { PADDLE_PAID_STATES, PADDLE_TXN_NOT_FOUND, readPaddleTransaction, type PaddleTransactionFacts } from "@/lib/billing/paddle-transaction-status";
import { recordPaidCheckout } from "@/lib/billing/checkout-paid";

// ---------------------------------------------------------------------------
// ÖDEME DOĞRULANIR DOĞRULANMAZ PLAN AÇILIR (kurucu 11-18 akşam: "10 dakika bir bekleme kuralı olmamalı. Ödeme ekranı tamamlanınca Lixus işlem
// kimliğini alıp Paddle'dan hemen kontrol etmeli … plan bir kez etkinleşir"; tasarım `docs/TASARIM-2026-11-18-odeme-aninda-dogrulama.md`).
//
// Planı açan TEK kod yolu bildirim işleyicisidir (`api/webhooks/paddle`). Bu çekirdek onu Paddle'ın bildirimini BEKLEMEDEN çalıştırır:
// işlemi ve aboneliği Paddle'dan OKUR, kimliği doğrular ve okunan aboneliği işleyiciye süreç içinde, kendi imzamızla verir (ödeme olayı
// yeniden işlemenin kullandığı yol — kopya işleyici yok). Böylece bildirim de bizim okumamız da AYNI kurallardan geçer (onay kaydından
// işletme çözümü, fiyat denetimi, sıra koruması, bekleyen ödeme kaydının kapanması); ikisi aynı anda gelse plan bir kez yazılır.
//
// KİMLİK (kurucu: "aynı işletme ve aynı satın alma doğrulanabiliyorsa … e-posta veya plan adı yetmez; belirsizse operatöre"):
//   (a) onay kaydı ÇAĞIRANIN işletmesinindir (çağıran doğrular: oturum ya da bekleyen ödeme satırı),
//   (b) Paddle'daki İŞLEM o onay kaydını taşır,
//   (c) okunan ABONELİK o işlemin aboneliğidir (kimlik eşit) ve başka bir onay kaydı taşımaz.
// Biri tutmazsa HİÇBİR ŞEY yazılmaz → "bekliyor" (kalıcı "ödeme alındı" kaydı ikinci ödeme ekranını zaten engeller; belirsizlik operatöre
// saatlik süpürgenin alarmıyla düşer). Paddle okunamazsa → "doğrulanamadı" (çağıran yeniden sorar).
// ---------------------------------------------------------------------------

/** Anahtar (VARSAYILAN KAPALI, yalnız "1"): açılışta sandbox denemesiyle birlikte açılır (iki sekme · olay gecikmesi · kayıp olay). */
export function instantCheckoutLinkEnabled(): boolean {
  return process.env.BILLING_INSTANT_LINK_ENABLED === "1";
}

export type CheckoutVerifyResult =
  /** Abonelik hesaba bağlı ve plan açık. */
  | { state: "active" }
  /** Ödeme / abonelik henüz hazır değil ya da kimlik doğrulanamadı — hiçbir şey açılmadı. `reason` kapalı küme (teşhis; müşteriye gitmez). */
  | { state: "awaiting"; reason: "not_paid" | "no_subscription_yet" | "identity_mismatch" | "not_applied" | "subscription_not_entitled" }
  /** Paddle okunamadı / yapılandırma eksik / işleyici geçici hata verdi — sonra yeniden sorulur. */
  | { state: "unverified"; reason: "not_configured" | "transaction_unreadable" | "transaction_not_found" | "subscription_unreadable" | "apply_failed" };

/** Hak tanıyan yerel abonelik durumları (plan açık). */
const ENTITLED: ReadonlySet<string> = new Set(["active", "trialing"]);

type SubscriptionObject = Record<string, unknown>;
export type CheckoutVerifyDeliver = (req: NextRequest) => Promise<Response>;

const deliverToRoute: CheckoutVerifyDeliver = async (req) => (await import("@/app/api/webhooks/paddle/route")).POST(req);

/** Aboneliğin Paddle'daki TAM nesnesi (`data`); okunamazsa null. Asla fırlatmaz. */
async function readPaddleSubscriptionObject(subscriptionId: string): Promise<SubscriptionObject | null> {
  try {
    const body = (await paddleRequest(`/subscriptions/${encodeURIComponent(subscriptionId)}`)) as { data?: unknown } | null;
    return body?.data && typeof body.data === "object" && !Array.isArray(body.data) ? (body.data as SubscriptionObject) : null;
  } catch {
    return null;
  }
}

const text = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

/** Abonelik nesnesinin taşıdığı onay kaydı kimliği (yoksa null). */
function consentOf(sub: SubscriptionObject): string | null {
  const cd = sub.custom_data && typeof sub.custom_data === "object" ? (sub.custom_data as Record<string, unknown>) : null;
  return text(cd?.consentId);
}

/**
 * Okunan abonelikten işleyiciye verilecek olay gövdesi. Saf.
 *  · Olay kimliği abonelik + Paddle'ın "son güncelleme" anından türer → aynı okuma iki kez gelirse işleyici kopya sayar.
 *  · Olay zamanı Paddle'ın "son güncelleme" anıdır (yoksa okuma anı) → işleyicinin sıra koruması gerçek bildirimlerle aynı eksende çalışır:
 *    daha yeni gerçek bildirim uygulanır, daha eskisi düşer.
 *  · Onay kaydı kimliği DOĞRULANMIŞ işlemden yazılır: abonelik nesnesi onu taşımıyorsa da işleyici işletmeyi onay kaydından çözebilsin
 *    (abonelik ↔ işlem bağı ve işlem ↔ onay bağı bu çekirdekte Paddle'dan okunarak doğrulandı).
 */
export function buildSubscriptionReadEvent(sub: SubscriptionObject, consentId: string, readAt: Date): { eventId: string; body: string } {
  const subscriptionId = text(sub.id) ?? "";
  const updated = text(sub.updated_at);
  const updatedAt = updated && !Number.isNaN(new Date(updated).getTime()) ? new Date(updated) : readAt;
  const eventId = `evt_lixusread_${subscriptionId}_${updatedAt.getTime()}`;
  const customData = sub.custom_data && typeof sub.custom_data === "object" && !Array.isArray(sub.custom_data) ? (sub.custom_data as Record<string, unknown>) : {};
  const body = JSON.stringify({
    event_id: eventId,
    event_type: "subscription.updated",
    occurred_at: updatedAt.toISOString(),
    data: { ...sub, custom_data: { ...customData, consentId } },
  });
  return { eventId, body };
}

async function linkedSubscription(organizationId: string, subscriptionId: string): Promise<{ status: string } | null> {
  const local = await prisma.subscription.findUnique({ where: { organizationId }, select: { provider: true, providerRef: true, status: true } });
  return local?.provider === "paddle" && local.providerRef === subscriptionId ? { status: local.status } : null;
}

/**
 * Ödemeyi Paddle'dan doğrula ve aboneliği hesaba bağla. Asla fırlatmaz.
 *
 * `consentId` ÇAĞIRANIN doğruladığı, `organizationId` işletmesine ait onay kaydıdır (oturum ya da bekleyen ödeme satırı); `transactionId`
 * yalnız OKUMA anahtarıdır (istemciden gelebilir) — işletme hiçbir zaman ondan çıkarılmaz.
 */
export async function verifyAndLinkCheckout(input: {
  organizationId: string;
  consentId: string;
  transactionId: string;
  now?: Date;
  /** Yalnız test: Paddle okumaları ve süreç içi teslim. */
  deps?: {
    readTransaction?: (id: string) => Promise<PaddleTransactionFacts | typeof PADDLE_TXN_NOT_FOUND | null>;
    readSubscription?: (id: string) => Promise<SubscriptionObject | null>;
    deliver?: CheckoutVerifyDeliver;
  };
}): Promise<CheckoutVerifyResult> {
  const now = input.now ?? new Date();
  try {
    const secret = getPaddleWebhookSecret();
    if (!isPaddleConfigured() || !secret) return { state: "unverified", reason: "not_configured" };
    const readTransaction = input.deps?.readTransaction ?? readPaddleTransaction;
    const readSubscription = input.deps?.readSubscription ?? readPaddleSubscriptionObject;
    const deliver = input.deps?.deliver ?? deliverToRoute;

    const txn = await readTransaction(input.transactionId);
    if (txn === null) return { state: "unverified", reason: "transaction_unreadable" };
    if (txn === PADDLE_TXN_NOT_FOUND) return { state: "unverified", reason: "transaction_not_found" };
    // (b) İşlem BU onay kaydını taşımalı. Taşımıyorsa (başkasının işlemi / onaysız işlem) hiçbir şey yazılmaz.
    if (txn.consentId !== input.consentId) return { state: "awaiting", reason: "identity_mismatch" };
    if (!txn.status || !PADDLE_PAID_STATES.has(txn.status)) return { state: "awaiting", reason: "not_paid" };

    // Ödeme sunucuca görüldü → kalıcı "ödeme alındı" kaydı (yoksa yazılır; aboneliği yerelde bağlıysa kapanır). İkinci ödeme ekranı bundan
    // sonra açılmaz — abonelik birazdan bağlanamasa da.
    await recordPaidCheckout({ transactionId: input.transactionId, consentId: input.consentId, subscriptionId: txn.subscriptionId, origin: txn.origin, paidAt: now });
    // Paddle parayı aldığını söylüyor ama aboneliği henüz kurmamış (belgelenen ara durum): çağıran kısa aralıkla yeniden sorar.
    if (!txn.subscriptionId) return { state: "awaiting", reason: "no_subscription_yet" };

    // Ödeme ↔ abonelik bağı satırda (migration 98): operatör teşhisi ve süpürge buradan okur.
    await prisma.checkoutIntent.updateMany({
      where: { providerRef: input.transactionId, organizationId: input.organizationId, OR: [{ subscriptionRef: null }, { subscriptionRef: { not: txn.subscriptionId } }] },
      data: { subscriptionRef: txn.subscriptionId },
    });

    const already = await linkedSubscription(input.organizationId, txn.subscriptionId);
    if (already) return ENTITLED.has(already.status) ? { state: "active" } : { state: "awaiting", reason: "subscription_not_entitled" };

    const sub = await readSubscription(txn.subscriptionId);
    if (!sub) return { state: "unverified", reason: "subscription_unreadable" };
    // (c) Okunan abonelik işlemin aboneliği olmalı ve BAŞKA bir onay kaydı taşımamalı.
    const carried = consentOf(sub);
    if (text(sub.id) !== txn.subscriptionId || (carried !== null && carried !== input.consentId)) return { state: "awaiting", reason: "identity_mismatch" };

    const event = buildSubscriptionReadEvent(sub, input.consentId, now);
    const request = new NextRequest("http://internal.invalid/api/webhooks/paddle", {
      method: "POST",
      headers: { "content-type": "application/json", "paddle-signature": signPaddleWebhook(event.body, secret, Math.floor(Date.now() / 1000)) },
      body: event.body,
    });
    // Kendi imzamızla süreç içi teslim: işleyici bunu "Paddle'ın gerçek teslimi" saymaz (imza alarmlarının durumuna dokunmaz).
    const res = await runAsPaddleReplay(() => deliver(request));
    if (!res.ok) return { state: "unverified", reason: "apply_failed" };

    const linked = await linkedSubscription(input.organizationId, txn.subscriptionId);
    if (!linked) return { state: "awaiting", reason: "not_applied" }; // işleyici bağlamadı (onay eski / fiyat uyuşmuyor / inceleme) → operatör
    await logEvent("billing.checkout.instant_linked", { consentId: input.consentId, transactionRef: input.transactionId }, { organizationId: input.organizationId });
    return ENTITLED.has(linked.status) ? { state: "active" } : { state: "awaiting", reason: "subscription_not_entitled" };
  } catch (err) {
    await reportError("checkout-verify", err).catch(() => {});
    return { state: "unverified", reason: "apply_failed" };
  }
}
