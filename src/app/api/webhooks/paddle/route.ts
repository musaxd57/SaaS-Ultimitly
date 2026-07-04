import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { jsonOk, unauthorized } from "@/lib/api";
import { reportError } from "@/lib/report-error";
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
  data?: Record<string, unknown>;
};

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Resolve the organizationId a Paddle object refers to (set at checkout). */
function orgIdFromCustomData(data: Record<string, unknown> | undefined): string | null {
  const cd = data?.custom_data;
  if (cd && typeof cd === "object") {
    const id = (cd as Record<string, unknown>).organizationId;
    if (typeof id === "string" && id.length > 0) return id;
  }
  return null;
}

async function applySubscriptionEvent(data: Record<string, unknown>): Promise<void> {
  const organizationId = orgIdFromCustomData(data);
  if (!organizationId) return; // not linked yet → recorded only
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
  if (!org) return; // never write against an org that isn't ours

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

  await prisma.subscription.upsert({
    where: { organizationId },
    create: {
      organizationId,
      planCode: planCode ?? "free",
      status,
      provider: "paddle",
      providerRef,
      currentPeriodEnd,
      cancelAtPeriodEnd,
    },
    update: {
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
    },
  });
}

async function applyTransactionEvent(data: Record<string, unknown>): Promise<void> {
  const organizationId = orgIdFromCustomData(data);
  if (!organizationId) return;
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
  if (!org) return;

  const providerRef = str(data.id);
  // Idempotency: one Invoice per Paddle transaction id.
  if (providerRef) {
    const existing = await prisma.invoice.findFirst({ where: { provider: "paddle", providerRef } });
    if (existing) return;
  }

  // Paddle amounts are minor-unit strings (e.g. "44900").
  const details = data.details as Record<string, unknown> | undefined;
  const totals = details?.totals as Record<string, unknown> | undefined;
  const grand = str(totals?.grand_total) ?? str((data.totals as Record<string, unknown> | undefined)?.grand_total);
  const amountMinor = grand ? Number.parseInt(grand, 10) : NaN;
  const currency = str(data.currency_code) ?? "TRY";

  const sub = await prisma.subscription.findUnique({ where: { organizationId }, select: { id: true } });

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
        await applySubscriptionEvent(data);
      } else if (eventType === "transaction.completed" || eventType === "transaction.paid") {
        await applyTransactionEvent(data);
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
        .update({ where: { providerEventId }, data: { status: "error", error: String(err).slice(0, 500) } })
        .catch(() => {});
    }
    // Still 200 so Paddle doesn't retry-storm on a transient storage hiccup.
  }

  return jsonOk({ ok: true });
}
