import { type NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { jsonOk, unauthorized } from "@/lib/api";
import { reportError, redactSensitive } from "@/lib/report-error";
import {
  getPaddleWebhookSecret,
  verifyPaddleSignature,
  paddlePriceToPlanCode,
  paddleStatusToLocal,
} from "@/lib/payments/paddle";

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
    where: { providerRef: { in: refs } },
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

async function applySubscriptionEvent(
  data: Record<string, unknown>,
  occurredAt: Date | null,
): Promise<void> {
  const organizationId = await resolveOrgId(data, eventPriceIdFromData(data), occurredAt);
  if (!organizationId) return; // not linked yet → recorded only
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
  if (!org) return; // never write against an org that isn't ours

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
  // near-simultaneous past_due events (minutes vs a 14-day grace: immaterial).
  const existing = await prisma.subscription.findUnique({
    where: { organizationId },
    select: { lastEventAt: true, pastDueSince: true },
  });

  const providerRef = str(data.id);
  const status = paddleStatusToLocal(str(data.status));

  // First subscription item's price → plan code (env-mapped).
  let planCode: string | null = null;
  const items = data.items;
  if (Array.isArray(items) && items.length > 0) {
    const first = items[0] as Record<string, unknown>;
    const price = first.price as Record<string, unknown> | undefined;
    planCode = paddlePriceToPlanCode(str(price?.id) ?? str(first.price_id));
  }

  // current_billing_period.ends_at → period end.
  let currentPeriodEnd: Date | null = null;
  const period = data.current_billing_period as Record<string, unknown> | undefined;
  const endsAt = str(period?.ends_at);
  if (endsAt) {
    const d = new Date(endsAt);
    if (!Number.isNaN(d.getTime())) currentPeriodEnd = d;
  }

  // scheduled_change with action "cancel" → cancel at period end.
  const scheduled = data.scheduled_change as Record<string, unknown> | undefined;
  const cancelAtPeriodEnd = str(scheduled?.action) === "cancel";

  // Dunning-grace anchor: stamp pastDueSince ONCE on the first transition INTO
  // past_due and keep it stable across every following dunning retry; clear it
  // the moment we leave past_due. getEntitlement counts the grace window from
  // here instead of the auto-bumping updatedAt (which each retry pushed forward,
  // so the window never elapsed and an unpaid org kept premium indefinitely).
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
    ...(status === "active" ? { trialEndsAt: null } : {}),
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

  if (existing) {
    await prisma.subscription.updateMany({
      where: { organizationId, ...orderingGuard },
      data: updateData,
    });
    return; // count 0 → a fresher event already applied → stale, dropped
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
      },
    });
  } catch (err) {
    // Concurrent first-event race: another delivery created the row between our
    // read and this create (organizationId is unique). Fall back to the guarded
    // update — the ordering WHERE decides which of the two events sticks.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      await prisma.subscription.updateMany({
        where: { organizationId, ...orderingGuard },
        data: updateData,
      });
      return;
    }
    throw err;
  }
}

async function applyTransactionEvent(
  data: Record<string, unknown>,
  occurredAt: Date | null,
): Promise<void> {
  // Transactions skip the price-match (their line items differ from the sub price);
  // the consent freshness (by occurred_at) + org binding still apply.
  const organizationId = await resolveOrgId(data, null, occurredAt);
  if (!organizationId) return;
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
  if (!org) return;

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
  const amountMinor = grand ? Number.parseInt(grand, 10) : NaN;
  const currency = str(data.currency_code) ?? "TRY";

  const sub = await prisma.subscription.findUnique({ where: { organizationId }, select: { id: true } });

  try {
    await prisma.invoice.create({
      data: {
        organizationId,
        subscriptionId: sub?.id ?? null,
        amountMinor: Number.isFinite(amountMinor) ? amountMinor : 0,
        currency,
        status: "paid",
        provider: "paddle",
        providerRef,
        paidAt: new Date(),
      },
    });
  } catch (err) {
    // Concurrent delivery of the same transaction: the findFirst above is only a
    // fast-path — @@unique([provider, providerRef]) (D1) is the real arbiter. The
    // loser of the race lands here; first write wins, nothing to do.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return;
    throw err;
  }
}

export async function POST(req: NextRequest) {
  const secret = getPaddleWebhookSecret();
  if (!secret) return NextResponse.json({ disabled: true }, { status: 200 });

  // Signature is over the RAW bytes — read text BEFORE any JSON parse.
  const rawBody = await req.text();
  const ok = verifyPaddleSignature({
    signatureHeader: req.headers.get("paddle-signature"),
    rawBody,
    secret,
  });
  if (!ok) return unauthorized();

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

  try {
    // Idempotency: only a SUCCESSFULLY processed event is a true duplicate. A row
    // still in "received"/"error" means a prior attempt threw before finishing
    // (DB hiccup/deadlock) — Paddle WILL retry the same event_id, and we MUST
    // reprocess it, else the subscription/invoice mutation is lost forever (a
    // paying customer could stay locked out). The apply handlers are idempotent
    // (subscription upsert-by-org, invoice dedup-by-providerRef), so re-running
    // is safe. Upsert reuses the existing row instead of colliding on its id.
    if (providerEventId) {
      const existing = await prisma.webhookEvent.findUnique({ where: { providerEventId } });
      if (existing?.status === "processed") return jsonOk({ ok: true, duplicate: true });
      await prisma.webhookEvent.upsert({
        where: { providerEventId },
        create: { provider: "paddle", eventType, providerEventId, payloadJson: rawBody, status: "received" },
        update: { status: "received", eventType, payloadJson: rawBody, error: null },
      });
    } else {
      await prisma.webhookEvent.create({
        data: { provider: "paddle", eventType, providerEventId: null, payloadJson: rawBody, status: "received" },
      });
    }

    const data = event?.data;
    if (data && eventType) {
      if (eventType.startsWith("subscription.")) {
        await applySubscriptionEvent(data, occurredAt);
      } else if (eventType === "transaction.completed" || eventType === "transaction.paid") {
        await applyTransactionEvent(data, occurredAt);
      }
      if (providerEventId) {
        await prisma.webhookEvent.update({
          where: { providerEventId },
          data: { status: "processed", processedAt: new Date() },
        });
      }
    }
  } catch (err) {
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
