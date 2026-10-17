import { type NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { RESUME_PENDING_LOCK } from "@/lib/billing/resume";
import { jsonOk, unauthorized, readTextCapped, MAX_WEBHOOK_BODY_BYTES, BodyTooLargeError, payloadTooLarge } from "@/lib/api";
import { reportError, redactSensitive } from "@/lib/report-error";
import { alertOnTransition, clearAlertState } from "@/lib/alert-state";
import { clearCheckoutPending } from "@/lib/billing/checkout-pending";
import { adoptCorrelation, currentCorrelation, newCorrelationId, runWithCorrelation } from "@/lib/correlation";
import { logEvent } from "@/lib/event-log";
import {
  getPaddleWebhookSecret,
  verifyPaddleSignature,
  paddlePriceToPlanCode,
  paddleStatusToLocal,
} from "@/lib/payments/paddle";
import { NEEDS_REVIEW_PREFIX, isRedactedPaddlePayload, redactPaddlePayload } from "@/lib/data-retention";
import {
  PADDLE_API_KEY_ALERT_EVENTS,
  PAYMENT_REVIEW_ACTION,
  minimalApiKeyPayload,
  paddleApiKeyAlertPhrase,
  paddleApiKeyFacts,
} from "@/lib/billing/payment-review";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Paddle Billing webhook (Faz 2). DORMANT until PADDLE_WEBHOOK_SECRET is set —
// returns 200 {disabled:true} and stores nothing, so it can't be abused before
// billing goes live. When configured it:
//   1. verifies the Paddle-Signature HMAC against the RAW body (replay-guarded),
//   2. records the event idempotently (providerEventId = event_id),
//   3. if the event carries our organizationId (set as custom_data at checkout)
//      and the org exists, reflects it into Subscription / Invoice.
// Org-linking is null-safe: until the checkout that stamps custom_data exists,
// events are simply recorded — never crashes, never touches the wrong org.
//
// The paywall stays OFF (BILLING_ENFORCED); this only keeps the billing source
// of truth in sync. Turning enforcement on is a separate, deliberate step.
// ---------------------------------------------------------------------------

type PaddleEvent = {
  event_id?: string;
  event_type?: string;
  occurred_at?: string; // ISO instant the event happened (Paddle-assigned)
  data?: Record<string, unknown>;
};

/** Paddle'ın bildiğimiz abonelik durumları (`paddleStatusToLocal`); dışındaki değer alarm üretir. */
const KNOWN_PADDLE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing", "past_due", "paused", "canceled"]);

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

// A checkout consent is only trusted as a checkout nonce for a short window (the
// user is at the Paddle overlay). Generous — a slow checkout still lands inside it.
const CONSENT_TTL_MS = 24 * 60 * 60 * 1000;
// Clock skew tolerance between Paddle and us when judging occurred_at.
const CONSENT_SKEW_MS = 5 * 60 * 1000;

/**
 * Is a consent still acceptable as the org-binding nonce for an event that occurred
 * at `occurredAt`? Freshness is judged against the Paddle-SIGNED event time, NOT the
 * webhook's arrival time — so a late-delivered retry of a REAL payment (Paddle outage
 * / re-drive hours later) still binds and the customer keeps the entitlement they paid
 * for. A future occurred_at (beyond clock skew) is anomalous → fail-closed. When an
 * event carries no occurred_at (rare — Paddle always sends one), fall back to arrival
 * time so a signature-valid event isn't dropped; occurred_at is inside the signed body
 * so this fallback can't be attacker-extended.
 */
function consentAcceptable(createdAt: Date, occurredAt: Date | null, now: number): boolean {
  if (occurredAt) {
    const t = occurredAt.getTime();
    if (t > now + CONSENT_SKEW_MS) return false; // occurs in the future → anomalous
    const age = t - createdAt.getTime();
    if (age < -CONSENT_SKEW_MS) return false; // event predates its own consent → anomalous
    return age <= CONSENT_TTL_MS; // consent too old at payment time → stale
  }
  return now - createdAt.getTime() <= CONSENT_TTL_MS; // no signed time → arrival-time fallback
}

/** First subscription/transaction item's Paddle price id, if any. */
function eventPriceIdFromData(data: Record<string, unknown> | undefined): string | null {
  const items = data?.items;
  if (Array.isArray(items) && items.length > 0) {
    const first = items[0] as Record<string, unknown>;
    const price = first?.price as Record<string, unknown> | undefined;
    return str(price?.id) ?? str(first?.price_id);
  }
  return null;
}

/** Legacy resolution (events with no consentId): match the EXISTING subscription
 *  by its providerRef — NEVER the client-sent org id. Returns null if unknown. */
async function orgFromProviderRef(data: Record<string, unknown> | undefined): Promise<string | null> {
  const refs = [str(data?.id), str(data?.subscription_id)].filter((v): v is string => Boolean(v));
  if (refs.length === 0) return null;
  const sub = await prisma.subscription.findFirst({
    // provider pinned: providerRef formats are provider-specific, and the new
    // @@unique([provider, providerRef]) guarantees uniqueness only per provider.
    where: { provider: "paddle", providerRef: { in: refs } },
    select: { organizationId: true },
  });
  return sub?.organizationId ?? null;
}

/**
 * Resolve the organizationId a Paddle object belongs to — WITHOUT ever trusting the
 * client-sent custom_data.organizationId.
 *   1. KNOWN subscription first: a subscription's whole lifecycle (updated / past_due /
 *      canceled) echoes the ORIGINAL consentId, which is long stale a month later. Match
 *      data.id / subscription_id against a Subscription.providerRef we already stored —
 *      authoritative, never goes stale. This is what keeps late lifecycle events applying.
 *   2. FIRST-time link only (no local sub yet, e.g. subscription.created / first
 *      transaction): require a FRESH, session-derived CheckoutConsent whose priceId
 *      matches. Freshness is judged by the signed occurred_at (a late retry of a real
 *      payment still binds; a future/stale occurred_at fails closed).
 *   • The raw custom_data.organizationId is NEVER used in either path.
 */
async function resolveOrgId(
  data: Record<string, unknown> | undefined,
  eventPriceId: string | null,
  occurredAt: Date | null,
): Promise<string | null> {
  // 1. Already-known subscription → resolve by its stored providerRef.
  const viaRef = await orgFromProviderRef(data);
  if (viaRef) return viaRef;

  // 2. First-time link → a fresh, session-derived consent is required.
  const cd =
    data?.custom_data && typeof data.custom_data === "object"
      ? (data.custom_data as Record<string, unknown>)
      : null;
  const consentId = cd && typeof cd.consentId === "string" && cd.consentId.length > 0 ? cd.consentId : null;
  if (!consentId) return null; // no known sub + no consent → nothing (never the raw org)

  const row = await prisma.checkoutConsent.findUnique({
    where: { id: consentId },
    select: { organizationId: true, priceId: true, createdAt: true },
  });
  if (!row) return null; // unknown consent → do NOT fall back to a client org id
  if (!consentAcceptable(row.createdAt, occurredAt, Date.now())) return null;
  if (eventPriceId && row.priceId && eventPriceId !== row.priceId) return null; // price mismatch
  return row.organizationId; // authoritative — session-derived
}

/** Ödeme alınmış / alınacak abonelik durumları: bunlar bir işletmeye bağlanamazsa operatöre haber verilir. */
const PAYING_SUBSCRIPTION_STATUSES: ReadonlySet<string> = new Set(["active", "trialing", "past_due"]);

/**
 * BAĞLANAMAYAN ÖDEME SESSİZ KALMAZ (15 ajan A10 F1, 10-01): imzası doğru bir ödeme olayı hiçbir işletmeye bağlanamadığında (onay
 * yok / bilinmiyor / 24 saatten eski, fiyat uyuşmuyor, işletme silinmiş — ör. ödeme sayfası bir gün sonra tamamlandı, panelden elle
 * abonelik açıldı) olay "işlendi" sayılıp DÜŞÜYORDU: müşteri ödüyor, hesap denemede kalıyor, kimse bilmiyordu. Karar AYNEN (bağlama
 * kuralı ve satır durumu değişmez); eklenen YALNIZ operatör alarmı — Paddle kimliğiyle anahtarlı geçiş tabanlı (aynı abonelik / işlem
 * yinelenince yeni e-posta yok, 24 saatte bir hatırlatma). Alarma yalnız Paddle kimlikleri ve olay türü girer (müşteri verisi yok).
 */
async function alertUnlinkedPayment(kind: "subscription" | "transaction", data: Record<string, unknown>, reason: string): Promise<void> {
  const id = str(data.id) ?? "unknown";
  const customer = str(data.customer_id);
  // İşletmesiz satıra Paddle abonelik / işlem kimliği YAZILMAZ (işletme silinince bu satırlar kademeyle gitmez; kimlik operatör
  // e-postasında zaten var — Haiku güvenlik incelemesi 10-12).
  await logEvent("billing.webhook.unlinked", { eventType: kind, reason: reason.includes("işletme") ? "org_missing" : "no_fresh_consent" });
  await alertOnTransition(
    `paddle-webhook:unlinked:${id}`,
    "paddle-webhook-unlinked-payment",
    new Error(
      `Paddle ${kind} ${id}${customer ? ` (müşteri ${customer})` : ""} hiçbir işletmeye bağlanamadı (${reason}) — ödeme alınmış olabilir. ` +
        `${reason.includes("işletme silindi") ? PAYMENT_REVIEW_ACTION.org_deleted : PAYMENT_REVIEW_ACTION.unlinked}`,
    ),
  );
}

/**
 * Ödeme S2 (kurucu 10-16; U42): ödemeli abonelik olayı işlenirken işletme SİLİNDİYSE (ya da zaten yoksa) olay kaybolmaz ve hesap geri
 * AÇILMAZ: abonelik satırı yazılmaz (webhook işletme yaratmaz; yabancı anahtar silinmiş işletmeye satır yazdırmaz), olay "işlendi" sayılmaz
 * (`needs_review: org_deleted`, ham olay saklı → incelenebilir / yeniden işlenebilir) ve operatöre "bağlanamayan ödeme" alarmı gider
 * (Paddle aboneliği canlı olabilir → elle iptal). Ödemesiz olay (iptal) için alarm yok.
 */
type SubscriptionOutcome = { review?: "org_deleted" | "unlinked" };

async function applySubscriptionEvent(
  data: Record<string, unknown>,
  occurredAt: Date | null,
): Promise<SubscriptionOutcome | void> {
  const organizationId = await resolveOrgId(data, eventPriceIdFromData(data), occurredAt);
  const paying = PAYING_SUBSCRIPTION_STATUSES.has(str(data.status) ?? "");
  if (!organizationId) {
    // not linked yet → recorded only (+ operatör alarmı, yalnız ödemeli durumda). Ödemeli olay "işlendi" SAYILMAZ (ödeme S2): bağlantı
    // düzeltilince Paddle'dan yeniden gönderilip işlenebilir; ham olay saklı.
    if (paying) {
      await alertUnlinkedPayment("subscription", data, "onay yok / eski / fiyat uyuşmuyor");
      return { review: "unlinked" };
    }
    return;
  }
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
  if (!org) {
    // never write against an org that isn't ours
    if (paying) {
      await alertUnlinkedPayment("subscription", data, "işletme bulunamadı");
      return { review: "org_deleted" };
    }
    return;
  }

  // Ordering guard: Paddle can deliver events out of order (and retries them).
  // Never let an OLDER event overwrite a fresher state — a late `subscription.
  // updated` (past_due) arriving after the `active`/`canceled` that superseded
  // it would otherwise flip access the wrong way. The veto is enforced ATOMICALLY
  // in the update's WHERE below (D2): a read-then-upsert let two CONCURRENT
  // deliveries both pass a stale read and the older one apply last. Strictly
  // older events drop; an equal timestamp (same-ms events / reprocessed retry)
  // re-applies idempotently rather than being lost.
  // This read only feeds the pastDueSince anchor (existence + current value) —
  // a race on it can at worst shift the dunning anchor by the gap between two
  // near-simultaneous past_due events (minutes; the access decision reads the paid period end, not this anchor).
  const existing = await prisma.subscription.findUnique({
    where: { organizationId },
    select: { lastEventAt: true, pastDueSince: true, providerRef: true, status: true },
  });

  const providerRef = str(data.id);
  const status = paddleStatusToLocal(str(data.status));

  // 🚨 ABONELİK KİMLİĞİ (K4, kurucu onayı 09-30): kayıtlı abonelikten FARKLI bir aboneliğin olayı satırı yalnız o abonelik
  // AKTİFLEŞİYORSA değiştirir (yeni abonelik eskisinin yerine geçer). Aksi hâlde (eski aboneliğin iptali, ödeme gecikmesi,
  // güncellemesi) yalnız kaydedilir: iki ödeme akışı açılıp olaylar ters sırada gelince ESKİ aboneliğin iptali, taze onay
  // kaydıyla kuruluşa bağlanıp yeni AKTİF aboneliği "iptal edildi" yazıyordu (Codex 3-7). Kayıtlı kimlik yoksa (ilk bağ) eski yol.
  // Kartla deneme (10-17, Haiku): kayıtlı abonelik İPTAL EDİLMİŞKEN yeni aboneliğin DENEME olayı da yerine geçer (ölü abonelik yeni kartlı
  // denemeyi "iptal" göstermesin). Sıra koruması (aşağıda) eski olayı yine düşürür.
  const replacesCanceledWithTrial = status === "trialing" && existing?.status === "canceled";
  if (existing?.providerRef && providerRef && existing.providerRef !== providerRef && status !== "active" && !replacesCanceledWithTrial) return;
  // 🚨 İKİNCİ AKTİF ABONELİK (kurucu onayı 10-10): kayıtlı abonelik İPTAL EDİLMEMİŞKEN farklı bir abonelik aktifleşiyor (ör. webhook gelmeden
  // ikinci ödeme ekranında ikinci ödeme). Yeni abonelik yine yerine geçer (K4 — müşteri davranışı DEĞİŞMEZ) ama eskisi Paddle'da
  // faturalanmaya devam edebilir → operatöre YENİ abonelik başına bir kez alarm (geçiş tabanlı). Alarm YALNIZ yazım uygulandıktan SONRA
  // (`settlePending`): sıra korumasıyla düşen gecikmiş eski olay ("eski abonelik aktif") yanlış alarm üretmesin (Haiku incelemesi).
  const replacesLiveSubscription =
    existing?.providerRef && providerRef && existing.providerRef !== providerRef && status === "active" && existing.status !== "canceled"
      ? { from: existing.providerRef, fromStatus: existing.status }
      : null;

  // First subscription item's price → plan code (env-mapped).
  let planCode: string | null = null;
  let unmappedPriceId: string | null = null;
  const items = data.items;
  if (Array.isArray(items) && items.length > 0) {
    const first = items[0] as Record<string, unknown>;
    const price = first.price as Record<string, unknown> | undefined;
    const priceId = str(price?.id) ?? str(first.price_id);
    planCode = paddlePriceToPlanCode(priceId);
    // ⚠️ "FİYAT YOK" ile "FİYAT VAR AMA HARİTADA YOK" AYRI ŞEYLER (denetim, 08-01).
    // İkincisi sessiz bir plan bozulmasıdır: aşağıdaki `updateData` planCode'u
    // atlar ama `status`'ü YAZAR → satır `active` olur, plan kodu ESKİ değerinde
    // kalır. Yani İşletme satın alan müşteri Pro sınırlarında kalabilir (ya da
    // tersi, fazla hak). Hiçbir yerde iz yoktu: bu dosyada `reportError` yalnız
    // para birimi eksikliğinde ve genel catch'te çağrılıyordu.
    // Tetikleyici uzak değil: Paddle tarafında fiyat rotasyonu/arşivleme, yıllık
    // fiyat, kampanya fiyatı ya da panelden elle plan değişikliği.
    if (!planCode && priceId) unmappedPriceId = priceId;
  }

  // current_billing_period.ends_at → period end.
  let currentPeriodEnd: Date | null = null;
  const period = data.current_billing_period as Record<string, unknown> | undefined;
  const endsAt = str(period?.ends_at);
  if (endsAt) {
    const d = new Date(endsAt);
    if (!Number.isNaN(d.getTime())) currentPeriodEnd = d;
  }
  // 🚨 ÖDEME GECİKMESİNDE "ÖDENMİŞ DÖNEM SONU" İLERLEMEZ (Opus 10-16 N1; kurucu: "Geçerli ödenmiş dönem bitince ücretli otomatik işler
  // dursun … Ek 14 gün istemiyorum"). Erişim kararı `past_due` iken bu alana bakar (`getEntitlement`). Paddle peşin faturalar: yenileme
  // ödemesi düştüğünde abonelik dönemi büyük olasılıkla ÖDENMEMİŞ yeni döneme ilerlemiştir (belge bu ortamdan okunamadı — sandbox'ta
  // doğrulanacak); `ends_at`'i yazmak ödemeyen müşteriye ~bir dönem ücretsiz erişim verirdi. Kural: `past_due` olayında yazılan değer
  // ödenmemiş dönemin BAŞI (= ödenmiş dönemin sonu); olayda yoksa hiçbir şey yazılmaz (kayıtlı ödenmiş dönem sonu kalır). Kayıtlı değerle
  // `min` almak gereksiz ve zararlı: başı varken kayıtlı değer ancak kaçırılmış bir yenileme olayında daha küçüktür ve ödenmiş dönemi erken
  // keserdi (mutasyon N1b). BİLİNEN SINIR: dönem ilerlemeden düşen bir tahsilatta (ör. dönem ortası) baş geçmişte kalır → erişim kapanır
  // (ek süre doğmayan güvenli yön); kesin çözüm ayrı "ödenmiş dönem sonu" alanı (migration, kurucu sorusu). Ödeme doğrulanınca `active`
  // olayı gerçek dönem sonunu yazar.
  // Yalnız Paddle'ın GERÇEK `past_due`u (Opus 10-16 P3-1). Tanınmayan / eksik durum da yerelde `past_due`a eşlenir (kapalı yön) ama o olay
  // ödenmiş dönem hakkında HİÇBİR ŞEY söylemez → dönem sonuna DOKUNULMAZ (Haiku 10-16): kayıtlı değer kalır — ödemiş müşteri dönem
  // ortasında kesilmez, ödeme gecikmesiyle kapanmış erişim de olaydaki (ödenmemiş olabilecek) dönem sonuyla yeniden AÇILMAZ. Alarm (↓).
  const rawStatus = str(data.status);
  const knownStatus = rawStatus != null && KNOWN_PADDLE_SUBSCRIPTION_STATUSES.has(rawStatus);
  if (rawStatus === "past_due") {
    const startsAt = str(period?.starts_at);
    const start = startsAt ? new Date(startsAt) : null;
    currentPeriodEnd = start != null && !Number.isNaN(start.getTime()) ? start : null;
  } else if (!knownStatus) {
    currentPeriodEnd = null; // yazılmaz (aşağıdaki güncelleme yalnız dolu değeri yazar); yeni satırda boş → erişim kapalı yön
    // Tanınmayan / eksik durum sessiz kalmaz (kişisel veri yok: yalnız sağlayıcının durum adı ve abonelik kimliği). Webhook yanıtını
    // BEKLETMEZ (e-posta zaman aşımı yanıtı geciktirmesin); e-posta bağlam başına kısılır.
    void reportError(
      "paddle-unknown-status",
      new Error(`Paddle bilinmeyen abonelik durumu: ${JSON.stringify(rawStatus)} (abonelik ${JSON.stringify(str(data.id))}) — erişim kapalı yönde ödeme gecikmesi sayıldı, ödenmiş dönem sonuna dokunulmadı; durum adını eşlemeye ekleyin`),
    ).catch(() => {});
  }

  // scheduled_change with action "cancel" → cancel at period end.
  const scheduled = data.scheduled_change as Record<string, unknown> | undefined;
  const cancelAtPeriodEnd = str(scheduled?.action) === "cancel";

  // pastDueSince: stamp ONCE on the first transition INTO past_due and keep it
  // stable across every following dunning retry; clear it the moment we leave
  // past_due. (Kurucu 10-16: erişim kararı artık ek süre değil ödenmiş dönem
  // sonudur — `getEntitlement`; bu damga ödeme gecikmesinin başlangıç kaydı ve
  // hesap süpürgesi gibi okuyucular için kalır.)
  const pastDueSince =
    status === "past_due" ? (existing?.pastDueSince ?? occurredAt ?? new Date()) : null;

  // The Paddle customer id, persisted from an event whose org was resolved
  // AUTHORITATIVELY above (consent/providerRef — never the raw custom_data org).
  // KVKK erasure attributes Paddle-generated customer.* events through this.
  const customerId = str(data.customer_id);

  const updateData = {
    ...(planCode ? { planCode } : {}),
    status,
    provider: "paddle",
    ...(providerRef ? { providerRef } : {}),
    ...(currentPeriodEnd ? { currentPeriodEnd } : {}),
    // Once a real paid subscription activates, our local reverse-trial marker
    // is moot — clear it so trialEndsAt can never make a paying org look
    // "expired" if future code reads it without checking status.
    // Ödemeye geçen hesapta eski deneme bitiş SEBEBİ de kalkar (operatörün / ilan kuralının "deneme bitti" notu ödeyen müşteriye — sonra
    // iptal etse bile — gösterilmesin; Haiku 10-17).
    ...(status === "active" ? { trialEndsAt: null, trialEndReason: null } : {}),
    // KARTLA DENEME (kurucu 10-17): Paddle'da deneme süreli abonelik `trialing` gelir ve deneme dönemi `current_billing_period`tır. Yerel
    // deneme bitişi (kartsız denemeden kalan) YAZILMAZSA erişim o tarihte kapanırdı — Paddle ise deneme bitince tahsil edecekken. Paddle'ın
    // deneme sonu yazılır; dönem sonu yoksa dokunulmaz (`trialing` + boş bitiş zaten kapalı yön — `getEntitlement`). Bugün deneme süreli
    // fiyat yok → bu dal tetiklenmiyordu (gizli hata); doğrulama P1, `docs/TASARIM-2026-10-17-paddle-devam-ettir-ve-kartla-deneme.md`.
    ...(status === "trialing" && currentPeriodEnd ? { trialEndsAt: currentPeriodEnd, trialEndReason: null } : {}),
    cancelAtPeriodEnd,
    pastDueSince,
    ...(occurredAt ? { lastEventAt: occurredAt } : {}),
    ...(customerId ? { customerId } : {}),
  };
  // Guarded, atomic apply: only an event NOT older than the freshest applied one
  // may write (evaluated inside the UPDATE — no read-check-write window). An
  // event with no occurred_at applies unconditionally, as before.
  const orderingGuard = occurredAt
    ? { OR: [{ lastEventAt: null }, { lastEventAt: { lte: occurredAt } }] }
    : {};
  // 🚨 ABONELİK KİMLİĞİ ATOMİK (K4 ikinci tur, Codex 10-01): yukarıdaki kimlik kontrolü BAYAT okumaya bakar — eski aboneliğin
  // iptali satırı (A) okuduktan sonra yeni abonelik (B) aktifleşirse güncelleme yalnız kuruluş + olay zamanına bakıp satırı
  // yeniden "A / iptal" yapıyordu. Aktifleşmeyen olay ancak satır HÂLÂ kendi aboneliğiyse (ya da kimliksizse) yazar; şart
  // UPDATE'in içinde değerlendirilir (okuma-yazma penceresi yok). Aktifleşen olay (yeni abonelik eskisinin yerine geçer) serbest.
  // Kartla deneme (10-17): İPTAL edilmiş kayıtlı aboneliğin yerine yeni aboneliğin DENEME olayı da geçer — koşul burada da (atomik) aynı.
  const identityGuard =
    providerRef && status !== "active"
      ? { OR: [{ providerRef: null }, { providerRef }, ...(status === "trialing" ? [{ status: "canceled" }] : [])] }
      : {};
  const guardedWhere = { organizationId, AND: [orderingGuard, identityGuard] };

  // Settles a pending in-app plan change ONLY when this event actually applied
  // (ordering guard passed) AND it carries the pending TARGET price (holder) —
  // an unrelated subscription event must not clear someone else's guard.
  const eventPriceId = eventPriceIdFromData(data);
  const settlePending = async () => {
    // Olay günlüğü (takip numarası): abonelik satırı bu olayla GERÇEKTEN yazıldı (sıra koruması geçti).
    await logEvent("billing.subscription.applied", { status, plan: planCode ?? undefined, subscriptionRef: providerRef ?? undefined }, { organizationId });
    // "Ödemeniz işleniyor" kilidi (kurucu onayı 10-10): abonelik AKTİF olarak yazıldı → yeni ödeme ekranı kilidi kalkar.
    // Kartla deneme: kart eklendi (`trialing`) → "Ödemeniz işleniyor" kilidi de kalkar (Haiku 10-17).
    if (status === "trialing") await clearCheckoutPending(organizationId);
    if (status === "active") {
      await clearCheckoutPending(organizationId);
      // I4 C (10-17): "Aboneliği devam ettir"in "işleniyor" kilidi abonelik etkin yazılınca kalkar (holder fiyat — herhangi etkin olay yeter).
      await prisma.systemLock.deleteMany({ where: { name: RESUME_PENDING_LOCK(organizationId) } }).catch(() => {});
    }
    if (replacesLiveSubscription) {
      await alertOnTransition(
        `paddle-webhook:second-subscription:${organizationId}:${providerRef}`,
        "paddle-webhook-second-subscription",
        new Error(
          `İşletme ${organizationId}: kayıtlı abonelik ${replacesLiveSubscription.from} (durum ${replacesLiveSubscription.fromStatus}) iptal edilmeden yeni abonelik ${providerRef} aktifleşti — iki abonelik birden faturalanıyor olabilir; Paddle panelinden eskisini kontrol edin`,
        ),
      );
    }
    // STRICT match only: the event must carry the pending TARGET price. A lock
    // without a matching event (incl. any legacy null-holder row) expires via
    // its 15-min TTL instead of being cleared by an unrelated event.
    if (!eventPriceId) return;
    await prisma.systemLock
      .deleteMany({ where: { name: `plan-change-pending:${organizationId}`, holder: eventPriceId } })
      .catch(() => {});
  };
  // ⚠️ SESSİZ PLAN BOZULMASI ARTIK SAYFALANIR (denetim, 08-01). Yalnız GEÇİŞTE
  // uyarılır: `subscription.*` olayları dunning sırasında tekrar tekrar gelir,
  // her olayda alarm üretmek Sentry+e-posta seli olurdu. Atomik `SystemLock`
  // claim'i (repoda `plan-change-pending:{org}` emsali) org+fiyat başına TEK
  // uyarı garanti eder; kilit yazımı hata verirse alarm ATLANIR (uyarı yolu
  // asla webhook'u düşürmez — Paddle 5xx'te retry eder ve olay tekrarlanır).
  if (unmappedPriceId) {
    const key = `paddle-unmapped-price:${organizationId}:${unmappedPriceId}`;
    const now = new Date();
    const nextAllowed = new Date(now.getTime() + 30 * 86_400_000);
    try {
      // ⚠️ SÜRE GERÇEKTEN UYGULANMALI (denetim, 08-01). İlk yazımda yalnız
      // `createMany + skipDuplicates` vardı: `lockedUntil` yazılıyor ama HİÇBİR
      // yerde okunmuyordu ve `SystemLock` için genel bir süpürge de yok → alarm
      // (org, fiyat) başına ÖMÜRDE BİR kez atıyordu. Operatör env haritasını
      // düzeltip sorun aylar sonra aynı fiyatta tekrarlarsa İKİNCİ uyarı hiç
      // gelmezdi. Şimdi: satır yoksa yarat, varsa YALNIZ süresi dolmuşsa yenile —
      // ikisi de atomik, ikisinden biri "bu uyarıyı ben atıyorum" der.
      const created = await prisma.systemLock.createMany({
        data: [{ name: key, lockedUntil: nextAllowed }],
        skipDuplicates: true,
      });
      const renewed =
        created.count === 1
          ? { count: 0 }
          : await prisma.systemLock.updateMany({
              where: { name: key, lockedUntil: { lte: now } },
              data: { lockedUntil: nextAllowed },
            });
      const claimed = { count: created.count + renewed.count };
      if (claimed.count === 1) {
        // ⚠️ 30 GÜNLÜK PENCERE — sonucu okumadan claim etmek, tek bir e-posta
        // hatasında operatörü BİR AY sessiz bırakırdı (denetim, 08-01).
        // ⚠️ CONTEXT PENCERE ANAHTARIYLA AYNI GRANÜLERLİKTE OLMALI (denetim,
        // 08-01 — üçüncü tur). Sabit bir context, `reportError`'un 10 dakikalık
        // throttle'ını pencereden KABA yapıyordu: ikinci bir org (ya da ikinci
        // bir fiyat) 10 dk içinde gelirse `throttled:true` döner, geri alma
        // bilinçli olarak atlanır ve o 30 GÜNLÜK pencere HİÇ e-posta gitmeden
        // yanardı — bu düzeltmenin kendi gerekçesi olan sessizlik geri gelirdi.
        const outcome = await reportError(
          `paddle-webhook unmapped-price org=${organizationId} price=${unmappedPriceId}`,
          new Error(
            `org=${organizationId} priceId=${unmappedPriceId} — Paddle fiyatı env haritasında YOK; ` +
              `abonelik durumu yazılıyor ama plan kodu ESKİ değerinde kalıyor (satın alınan plan uygulanmıyor).`,
          ),
        );
        if (outcome?.configured && !outcome.notified && !outcome.throttled) {
          // Bildirim gitmedi → pencereyi geri al, sonraki olay yeniden denesin.
          // ⚠️ EPOCH 0 DEĞİL: pencereyi tamamen serbest bırakmak, Paddle'ın kendi
          // retry'ları altında sönümlemeyi kaldırırdı. 15 dk sonra yeniden
          // denenir — 30 günlük pencere boşuna yanmaz, sel de olmaz.
          await prisma.systemLock
            .updateMany({
              where: { name: key },
              data: { lockedUntil: new Date(now.getTime() + 15 * 60 * 1000) },
            })
            .catch(() => {});
        }
      }
    } catch {
      // Uyarı yolu asla ana akışı bozmaz.
    }
  }

  if (existing) {
    const resU = await prisma.subscription.updateMany({
      where: guardedWhere,
      data: updateData,
    });
    if (resU.count === 1) await settlePending();
    else if (paying && !(await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } }))) {
      // 🚨 U42 / ödeme S2: 0 satır İKİ şey demek olabilir — daha taze olay zaten yazılmış (bayat, sessiz düşer) YA DA işletme bu olay
      // işlenirken SİLİNDİ (abonelik kademeyle gitti). İkincisinde ödeme alınmış olabilir → alarm + inceleme. Silme tarafı ön kontrolde
      // abonelik satırını KİLİTLER (`account/delete`, Opus F2): güncelleme önce commit olduysa silme onu görüp 409 der; silme kilidi
      // aldıysa güncelleme bekler ve buraya 0 satırla düşer.
      await alertUnlinkedPayment("subscription", data, "işletme silindi (olay işlenirken)");
      return { review: "org_deleted" };
    }
    return; // count 0 + işletme var → a fresher event already applied → stale, dropped
  }
  try {
    await prisma.subscription.create({
      data: {
        organizationId,
        planCode: planCode ?? "free",
        status,
        provider: "paddle",
        providerRef,
        currentPeriodEnd,
        cancelAtPeriodEnd,
        pastDueSince,
        lastEventAt: occurredAt,
        customerId,
        // Kartla deneme: ilk olay `trialing` ise Paddle'ın deneme sonu (güncelleme yoluyla aynı kural — boş bırakılırsa kapalı yön).
        ...(status === "trialing" && currentPeriodEnd ? { trialEndsAt: currentPeriodEnd } : {}),
      },
    });
    await settlePending();
  } catch (err) {
    // Concurrent first-event race: another delivery created the row between our
    // read and this create (organizationId is unique). Fall back to the guarded
    // update — the ordering WHERE decides which of the two events sticks.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const resF = await prisma.subscription.updateMany({
        where: guardedWhere,
        data: updateData,
      });
      if (resF.count === 1) await settlePending();
      return;
    }
    // İşletme okuma ile yazma ARASINDA silindi (ödeme S2): yabancı anahtar satırı reddeder — hesap geri açılmaz. 500 + Paddle'ın sonsuz
    // yeniden denemesi yerine inceleme + (ödemeliyse) alarm.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
      if (paying) {
        await alertUnlinkedPayment("subscription", data, "işletme silindi (olay işlenirken)");
        return { review: "org_deleted" };
      }
      return;
    }
    throw err;
  }
}

/**
 * Ödeme S1 (kurucu 10-16): olay geçerli ama fatura için gereken veri bozuk / eksik (tutar, para birimi) → fatura YAZILMAZ (yanlış "ödendi"
 * kaydı defteri bozar), olay "işlendi" SAYILMAZ (Paddle'dan yeniden gönderilince tekrar işlenir; ham olay `WebhookEvent`te saklı — kaybolmaz)
 * ve işlem başına TEK operatör alarmı (24 sa hatırlatma). Aynı işlemin doğru olayı gelince fatura yazılır, alarm temizlenir.
 */
/** `Invoice.amountMinor` (PostgreSQL int4) üst sınırı. */
const INT4_MAX = 2_147_483_647;

type TransactionOutcome = { review?: "invalid_amount" | "missing_currency" | "unlinked" | "org_deleted" };

async function alertInvalidTransaction(providerRef: string, review: "invalid_amount" | "missing_currency"): Promise<void> {
  await alertOnTransition(
    `paddle-webhook:txn-invalid:${providerRef}`,
    "paddle-webhook-invalid-transaction",
    new Error(
      // Opus F5: gerçek eylemi söyle — Paddle'dan yeniden gönderim AYNI veriyi getirir, düzeltilmiş olay kendiliğinden gelmez.
      `Paddle işlem ${providerRef}: ${PAYMENT_REVIEW_ACTION[review]} Olay Operasyon Teşhisi → Ödeme incelemesi listesinde.`,
    ),
  );
}

async function applyTransactionEvent(
  data: Record<string, unknown>,
  occurredAt: Date | null,
): Promise<TransactionOutcome | void> {
  // Transactions skip the price-match (their line items differ from the sub price);
  // the consent freshness (by occurred_at) + org binding still apply.
  const organizationId = await resolveOrgId(data, null, occurredAt);
  if (!organizationId) {
    await alertUnlinkedPayment("transaction", data, "onay yok / eski");
    return { review: "unlinked" };
  }
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
  if (!org) {
    await alertUnlinkedPayment("transaction", data, "işletme bulunamadı");
    return { review: "org_deleted" };
  }

  const providerRef = str(data.id);
  // Idempotency: one Invoice per Paddle transaction id. Without a providerRef we
  // have no dedup key and events can be reprocessed on retry, so skip rather than
  // create an undeduplicatable row a retry would duplicate. (Real Paddle
  // transaction events always carry an id.)
  if (!providerRef) return;
  const existing = await prisma.invoice.findFirst({ where: { provider: "paddle", providerRef } });
  if (existing) return;

  // Paddle amounts are minor-unit strings (e.g. "44900").
  const details = data.details as Record<string, unknown> | undefined;
  const totals = details?.totals as Record<string, unknown> | undefined;
  const grand = str(totals?.grand_total) ?? str((data.totals as Record<string, unknown> | undefined)?.grand_total);
  // 🚨 U39 / ödeme S1: tutar YALNIZ tam rakam dizisi ve `Invoice.amountMinor` sütununa (int4) sığan değer. Eskiden `parseInt` "100abc"i
  // 100, "1e3"ü 1, "-500"ü -500 okuyor, eksik tutar 0 "ödenmiş" fatura oluyordu; aynı işlemin sonraki DOĞRU olayı var olan fatura
  // yüzünden hiç işlenmiyordu. Gerçek sıfır ("0") geçerli. Sütunu aşan tutar (Opus F4) veritabanı hatası → 500 → sonsuz yeniden deneme
  // yerine aynı inceleme yoluna düşer.
  const amountMinor =
    grand !== null && /^\d{1,10}$/.test(grand.trim()) && Number(grand.trim()) <= INT4_MAX ? Number(grand.trim()) : null;
  if (amountMinor === null) {
    await alertInvalidTransaction(providerRef, "invalid_amount");
    return { review: "invalid_amount" };
  }

  // FAIL-CLOSED on a missing currency. This row is the billing record of a real
  // charge; the currency belongs to the EVENT, and Paddle sends currency_code on
  // every transaction. If it is ever absent we do NOT invent one — stamping the
  // deployment's currency (or the old hardcoded "TRY") would silently mislabel a
  // charge that may have been taken in another currency, and no conversion has
  // happened. Skip the row and page instead: a missing invoice is recoverable
  // from Paddle, a wrong one corrupts the books.
  const currency = str(data.currency_code);
  if (!currency) {
    await alertInvalidTransaction(providerRef, "missing_currency");
    return { review: "missing_currency" };
  }

  const sub = await prisma.subscription.findUnique({ where: { organizationId }, select: { id: true } });

  try {
    await prisma.invoice.create({
      data: {
        organizationId,
        subscriptionId: sub?.id ?? null,
        amountMinor,
        currency,
        status: "paid",
        provider: "paddle",
        providerRef,
        paidAt: new Date(),
      },
    });
    await logEvent("billing.invoice.recorded", { transactionRef: providerRef, amountMinor, currency }, { organizationId });
    // Aynı işlemin önceki olayı bozuk veri yüzünden alarm verdiyse fatura artık yazıldı → alarm kapanır (ödeme S1).
    await clearAlertState(`paddle-webhook:txn-invalid:${providerRef}`);
    // ...ve o olayın inceleme satırı kapanır (Opus F11): yoksa "Ödeme incelemesi" listesinde, iş bittiği hâlde sonsuza kadar kalırdı.
    // İz korunur (durum "processed", not "resolved: <eski kod>"). Yalnız bu işlemin tutar / para birimi incelemeleri.
    await prisma.webhookEvent
      .updateMany({
        where: {
          provider: "paddle",
          status: "error",
          error: { in: [`${NEEDS_REVIEW_PREFIX} invalid_amount`, `${NEEDS_REVIEW_PREFIX} missing_currency`] },
          payloadJson: { contains: JSON.stringify(providerRef) },
        },
        data: { status: "processed", processedAt: new Date(), error: "resolved: later event recorded the invoice" },
      })
      .catch(() => {});
  } catch (err) {
    // Concurrent delivery of the same transaction: the findFirst above is only a
    // fast-path — @@unique([provider, providerRef]) (D1) is the real arbiter. The
    // loser of the race lands here; first write wins, nothing to do.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return;
    throw err;
  }
}

/**
 * Başlık GERÇEK bir Paddle teslimatının ŞEKLİNİ taşıyor mu?
 *
 * Amaç bir güvenlik kararı DEĞİL (kabul/ret kararını `verifyPaddleSignature`
 * verir, o hiç değişmedi) — yalnız ALARM GÜRÜLTÜSÜNÜ elemek. Sıradan bir
 * internet tarayıcısı `ts=<unix>;h1=<64 hex>` üretmez; bir anahtar uyuşmazlığı
 * ise DAİMA bu şekli üretir.
 */
function looksLikePaddleDelivery(header: string | null): boolean {
  if (!header) return false;
  let ts = "";
  let h1 = "";
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k === "ts") ts = v;
    else if (k === "h1" && !h1) h1 = v;
  }
  return /^\d{10,}$/.test(ts) && /^[0-9a-f]{64}$/i.test(h1);
}

/**
 * Onay kaydının zincirine katıl: `custom_data.consentId` (istemci verisi) YALNIZ satırı bulmak için; numara satırdan okunur ve yalnız onay
 * `resolveOrgId`deki tazelik kuralını geçiyorsa (eski onaya bağlanan yenileme olayı kendi numarasında kalır). İşletme ATANMAZ — olayın
 * işletmesi yalnız bağlama kuralının kendisinden (`resolveOrgId`) gelir (iki kural ayrışmasın). Asla fırlatmaz.
 */
async function adoptConsentChain(data: Record<string, unknown> | undefined, occurredAt: Date | null): Promise<void> {
  try {
    const cd = data?.custom_data && typeof data.custom_data === "object" ? (data.custom_data as Record<string, unknown>) : null;
    const consentId = cd && typeof cd.consentId === "string" && cd.consentId.length > 0 && cd.consentId.length <= 64 ? cd.consentId : null;
    if (!consentId) return;
    const row = await prisma.checkoutConsent.findUnique({
      where: { id: consentId },
      select: { correlationId: true, createdAt: true },
    });
    if (!row?.correlationId || !consentAcceptable(row.createdAt, occurredAt, Date.now())) return;
    adoptCorrelation(row.correlationId);
  } catch {
    /* iz yalnız teşhis içindir; webhook'u bozmaz */
  }
}

/** Paddle API anahtarı olayları (kurucu 10-17: anahtar süresiz oluşturulmuştu → 1 yıl bitişli + dönebilir anahtara geçilecek). */
const PADDLE_API_KEY_EVENTS: ReadonlySet<string> = new Set(PADDLE_API_KEY_ALERT_EVENTS);

/**
 * Operatör uyarısı (`reportError` → Sentry + uyarı e-postası). Anahtarın KENDİSİ (maskeli olsa da) yazılmaz — yalnız Paddle'daki adı, bitiş
 * tarihi ve olay türü. Asla fırlatmaz (uyarı düşerse olay yine işlenmiş sayılır; kalıcı iz Operasyon Teşhisi'ndeki satır).
 */
async function alertPaddleApiKey(eventType: string, data: unknown): Promise<void> {
  const { name, expiresOn } = paddleApiKeyFacts(data);
  await reportError(
    "paddle-api-key",
    new Error(
      `Paddle API anahtarı ${paddleApiKeyAlertPhrase(eventType)}: "${name}" (bitiş ${expiresOn}). Canlıda kullanılan anahtar buysa yeni anahtar oluşturup Railway'deki PADDLE_API_KEY değerini değiştirin; ödeme işlemleri eski anahtarla durur.`,
    ),
  ).catch(() => {});
}

export async function POST(req: NextRequest): Promise<Response> {
  // TAKİP NUMARASI (kurucu kararı 10-10): her teslimat kendi numarasıyla koşar; taze bir onay kaydına bağlanan ilk ödeme olayı numarayı o
  // kaydın SUNUCUDA yazılmış satırından alır (`adoptConsentChain`) → "onay → ödeme ekranı → Paddle → abonelik / fatura" tek numarayla aranır.
  if (!currentCorrelation()) return runWithCorrelation({ id: newCorrelationId(), organizationId: null }, () => POST(req));
  const secret = getPaddleWebhookSecret();
  if (!secret) {
    // 🚨 SESSİZ OLMAMALI. 200 dönmek Paddle'a "teslim edildi" der ve olay BİR
    // DAHA DENENMEZ: `PADDLE_WEBHOOK_SECRET` bir yazım hatası/rotasyon/env
    // kazasıyla düşerse her `subscription.*` ve `transaction.*` olayı KALICI
    // olarak kaybolur — müşteriler öder, yetki almaz, Invoice yazılmaz ve
    // hiçbir alarm çıkmaz. Ters teşvik: YANLIŞ bir anahtar (401 → Paddle
    // yeniden dener) EKSİK anahtardan daha iyi davranıyordu.
    // 200 KORUNUYOR (bkz. "DORMANT" testi: anahtarsız kurulumda rota sessizce
    // kapalı olmalı, 5xx sel açar) — eklenen tek şey GÖRÜNÜRLÜK.
    // 🚨 GEÇİŞ TABANLI (09-23): eskiden `reportError`ın bellek-içi 10 dk kısıtına
    // güveniyordu — kalıcı bir yapılandırma hatasında olay başına (günde onlarca) e-posta.
    // Artık bir kez + 24 saatte bir hatırlatma; ilk DOĞRULANMIŞ olay durumu temizler.
    await alertOnTransition(
      "paddle-webhook:dormant",
      "paddle-webhook-dormant",
      new Error("PADDLE_WEBHOOK_SECRET yok — gelen Paddle olayı ACK'lenip ATILDI"),
    );
    return NextResponse.json({ disabled: true }, { status: 200 });
  }

  // Signature is over the RAW bytes — read text BEFORE any JSON parse, but CAP it:
  // this is an anonymous public endpoint and the read happens before the signature
  // check, so an oversized body would otherwise be buffered into memory first (OOM).
  let rawBody: string;
  try {
    rawBody = await readTextCapped(req, MAX_WEBHOOK_BODY_BYTES);
  } catch (err) {
    if (err instanceof BodyTooLargeError) return payloadTooLarge();
    throw err;
  }
  const signatureHeader = req.headers.get("paddle-signature");
  const ok = verifyPaddleSignature({ signatureHeader, rawBody, secret });
  if (!ok) {
    // 🚨 EKSİK ANAHTAR ALARM VERİYORDU, YANLIŞ ANAHTAR VERMİYORDU (08-09 (2)).
    // Asimetri tersti: `PADDLE_WEBHOOK_SECRET` bir rotasyon/yazım hatasıyla
    // YANLIŞ olursa her olay 401 alır, Paddle sonlu sayıda yeniden dener ve pes
    // eder → olay KALICI kaybolur. Sonuç iki yönde de sessiz: iptal olmuş bir org
    // sonsuza kadar premium kalır, ödeyen müşterinin yükseltmesi `planCode`'a
    // hiç ulaşmaz. Üstteki dormant dalının yorumu "401 → Paddle yeniden dener"
    // diyerek bu hâli daha iyi sayıyordu; doğru, ama yalnız retry penceresi
    // DOLANA KADAR.
    //
    // ⚠️ ALARM YALNIZ "ŞEKLİ DOĞRU AMA DOĞRULANMIYOR" HÂLİNDE. Burası kimliksiz
    // ve halka açık bir uç nokta; her 404 tarayıcısına alarm yazmak kanalı
    // çöpe çevirirdi. Şekil kapısı (ts=<10+ hane>;h1=<64 hex>) sıradan tarayıcıyı
    // eler ve tam da teşhis etmek istediğimiz vakayı geçirir: GERÇEK bir Paddle
    // teslimatı, YANLIŞ anahtarla. Kasıtlı bir saldırgan yine tetikleyebilir —
    // `reportError`ın 10 dakikalık context throttle'ı e-posta tarafını sınırlar
    // (dormant dalı da aynı taviz üzerine kurulu).
    //
    // ⚠️ GÖVDE ALARMA GİRMEZ: ham payload müşteri adı/e-postası/adresi taşır.
    // 🚨 GEÇİŞ TABANLI (09-23): kimliksiz bir saldırgan şekli doğru başlıklarla bu dalı
    // istediği kadar tetikleyebiliyordu ve tek fren `reportError`ın bellek-içi 10 dk
    // kısıtıydı (günde ~144 e-posta, her yeniden başlatmada sıfırlanır). Artık durum
    // DB'de: bir kez + 24 saatte bir hatırlatma; ilk DOĞRULANMIŞ olay temizler.
    if (looksLikePaddleDelivery(signatureHeader)) {
      // TEŞHİS AYRIMI (ödeme denetimi 10-15, `docs/arastirma-2026-10-15/odeme.md` §4 #9-#10): imza anahtarımızla TUTUYOR ama zaman damgası
      // pencere dışındaysa sorun anahtar DEĞİL (saat farkı ya da eski bir teslimatın tekrarı). Eskiden ikisi de "anahtar yanlış" diyordu →
      // operatör doğru anahtarı boşuna değiştirirdi. Kabul / ret kararı AYNI (401); yalnız alarmın adı ve cümlesi ayrışır, ayrı durum
      // anahtarıyla (biri ötekini susturmaz).
      const keyMatches = verifyPaddleSignature({ signatureHeader, rawBody, secret, toleranceSeconds: Number.POSITIVE_INFINITY });
      if (keyMatches) {
        await alertOnTransition(
          "paddle-webhook:signature-stale",
          "paddle-webhook-signature-stale",
          new Error("Paddle imzası anahtarla tutuyor ama zaman damgası 5 dakikalık pencerenin dışında — sunucu saati kaymış ya da eski bir teslimat tekrar edilmiş olabilir (anahtar DOĞRU, değiştirmeyin)"),
        );
      } else {
        await alertOnTransition(
          "paddle-webhook:signature-mismatch",
          "paddle-webhook-signature-mismatch",
          new Error("Paddle imzası doğrulanmadı — webhook anahtarı yanlış/rotasyona uğramış olabilir"),
        );
      }
    }
    return unauthorized();
  }
  // İmza DOĞRULANDI → yapılandırma sağlam: yapılandırma alarmlarının durumu temizlenir
  // (bir sonraki bozulma yeniden ve HEMEN bildirilsin). Asla fırlatmaz.
  await clearAlertState("paddle-webhook:signature-mismatch");
  await clearAlertState("paddle-webhook:signature-stale");
  await clearAlertState("paddle-webhook:dormant");

  let event: PaddleEvent | null = null;
  try {
    event = JSON.parse(rawBody) as PaddleEvent;
  } catch {
    event = null;
  }

  const providerEventId = event?.event_id ?? null;
  const eventType = event?.event_type ?? null;
  const occurredAtRaw = event?.occurred_at ? new Date(event.occurred_at) : null;
  const occurredAt = occurredAtRaw && !Number.isNaN(occurredAtRaw.getTime()) ? occurredAtRaw : null;

  await adoptConsentChain(event?.data, occurredAt);
  await logEvent("billing.webhook.received", { eventType: eventType ?? undefined, providerEventId: providerEventId ?? undefined });

  try {
    // Idempotency: only a SUCCESSFULLY processed event is a true duplicate. A row
    // still in "received"/"error" means a prior attempt threw before finishing
    // (DB hiccup/deadlock) — Paddle WILL retry the same event_id, and we MUST
    // reprocess it, else the subscription/invoice mutation is lost forever (a
    // paying customer could stay locked out). The apply handlers are idempotent
    // (subscription upsert-by-org, invoice dedup-by-providerRef), so re-running
    // is safe. Upsert reuses the existing row instead of colliding on its id.
    // KÜÇÜLTME KARARI YENİDEN İŞLEMEDE KORUNUR (Codex 10-16, ölçüldü): "silinen hesap" olayı küçültülüp "inceleme" kaldıktan sonra Paddle
    // aynı olayı yeniden gönderince upsert HAM gövdeyi geri yazıyordu; ikinci işlemede gerekçe "unlinked" çıktığı için yeniden küçültülmüyordu
    // → ad / e-posta / adres geri geldi. Artık yeniden işleme saklı yüke HİÇ yazmaz (aynı olay kimliği = aynı gövde; ilk teslim yazdı): bir kez
    // küçültülmüş yük (silinen hesap / KVKK silme / 12 ay) ezilmez, okuma ile yazma arasında koşan küçültme işiyle yarış da yok (Haiku 10-16).
    // İşleme bellekteki gövdeyle sürer (finansal inceleme devam eder). Olay kimliksiz teslim (Paddle her zaman gönderir) eski davranışta.
    let storedMinimized = false;
    // API anahtarı olayı (her `api_key.*`) ham gövdeyle SAKLANMAZ: gövde anahtarın kendisini (maskeli olsa da) taşıyabilir (Haiku 10-17 gece
    // 2. tur) → ilk yazımdan önce anahtarsız küçük gövde.
    const storedBody = eventType?.startsWith("api_key.") ? minimalApiKeyPayload(event) : rawBody;
    if (providerEventId) {
      const existing = await prisma.webhookEvent.findUnique({ where: { providerEventId } });
      if (existing?.status === "processed") {
        await logEvent("billing.webhook.duplicate", { providerEventId });
        return jsonOk({ ok: true, duplicate: true });
      }
      storedMinimized = existing != null && isRedactedPaddlePayload(existing.payloadJson);
      await prisma.webhookEvent.upsert({
        where: { providerEventId },
        create: { provider: "paddle", eventType, providerEventId, payloadJson: storedBody, status: "received" },
        update: { status: "received", eventType, error: null },
      });
    } else {
      await prisma.webhookEvent.create({
        data: { provider: "paddle", eventType, providerEventId: null, payloadJson: storedBody, status: "received" },
      });
    }

    const data = event?.data;
    let reviewReason: string | null = null;
    if (data && eventType) {
      if (eventType.startsWith("subscription.")) {
        reviewReason = (await applySubscriptionEvent(data, occurredAt))?.review ?? null;
      } else if (eventType === "transaction.completed" || eventType === "transaction.paid") {
        reviewReason = (await applyTransactionEvent(data, occurredAt))?.review ?? null;
      } else if (eventType === "transaction.payment_failed") {
        // "Ödemeniz işleniyor" kilidi (kurucu sorusu 10-10: "ödeme alınamazsa 10 dk yeniden ödeyemiyor mu?"): ödeme başarısız → kilit ANINDA
        // kalkar, müşteri hemen yeniden dener. Yalnız kilit kaldırır, başka hiçbir şey yazmaz. (Paddle bildirim ayarında bu olay türü açık olmalı.)
        const failedOrg = await resolveOrgId(data, null, occurredAt);
        if (failedOrg) await clearCheckoutPending(failedOrg);
      } else if (PADDLE_API_KEY_EVENTS.has(eventType)) {
        // Kurucu 10-17 ("sakın unutmayalım"): Paddle API anahtarının süresi dolmadan / dolunca / iptalinde operatör uyarılır. Olay hiçbir
        // işletmeye ait değil, abonelik / fatura yazmaz. (Paddle bildirim hedefinde bu olay türleri işaretli olmalı.)
        await alertPaddleApiKey(eventType, data);
        // Olay İŞLENDİ sayılır — ödeme olayı değil, ödeme incelemesine düşmez (Haiku 10-17 gece 2. tur). Kalıcı iz (Opus O18): bu satır
        // Operasyon Teşhisi'nde 90 gün "Paddle API anahtarı" uyarısı olarak görünür (`paddleApiKeyAlerts`); e-posta kısılsa da kaybolmaz.
      }
      if (providerEventId) {
        // İnceleme gereken olay "işlendi" sayılmaz (ödeme S1): satır "error" + kısa kod kalır → Paddle'dan yeniden gönderilirse tekrar
        // işlenir (yalnız "processed" kopya sayılır). Paddle'a 200 döner (aynı bozuk veriyle sonsuz yeniden deneme olmasın).
        // Opus F1 (10-16): SİLİNMİŞ işletmenin olayında ham yük (ad / e-posta / adres) hemen küçültülür — hesap silmedeki redaksiyon
        // çoktan koştu ve "hesap silindi, her şey gider" sözü bozulmasın; inceleme için finansal iskelet (olay / abonelik / müşteri
        // kimliği, tutar, para birimi) kalır. Diğer inceleme kodları 12 ayda küçülür (`minimizeOldPaddleWebhooks`).
        await prisma.webhookEvent.update({
          where: { providerEventId },
          data: reviewReason
            ? {
                status: "error",
                error: `${NEEDS_REVIEW_PREFIX} ${reviewReason}`,
                ...(reviewReason === "org_deleted" && !storedMinimized ? { payloadJson: redactPaddlePayload(rawBody, "org-deleted") } : {}),
              }
            : { status: "processed", processedAt: new Date() },
        });
      }
      if (reviewReason) await logEvent("billing.webhook.failed", { eventType, reason: reviewReason });
      else await logEvent("billing.webhook.processed", { eventType });
    }
  } catch (err) {
    await logEvent("billing.webhook.failed", { eventType: eventType ?? undefined });
    await reportError("paddle-webhook", err);
    if (providerEventId) {
      await prisma.webhookEvent
        .update({ where: { providerEventId }, data: { status: "error", error: redactSensitive(String(err)).slice(0, 500) } })
        .catch(() => {});
    }
    // The signature was valid and the payload parsed — this is a RETRYABLE apply
    // failure (transient DB/storage error mid subscription/invoice mutation).
    // Return 5xx so Paddle re-delivers: the WebhookEvent stays "error" (only
    // "processed" counts as a duplicate, so a retry reprocesses it) and the apply
    // handlers are idempotent (subscription upsert-by-org, invoice dedup-by-
    // providerRef), so the retry completes the mutation exactly once. Permanent
    // bad requests keep their current non-retry-inducing behavior: invalid
    // signature → 401 above, unparseable payload → 200 below.
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }

  return jsonOk({ ok: true });
}
