import "server-only";

import { createHmac, timingSafeEqual } from "crypto";
import { reportError } from "@/lib/report-error";

// ---------------------------------------------------------------------------
// Paddle Billing client (Faz 2). DORMANT until PADDLE_WEBHOOK_SECRET (webhook)
// and/or PADDLE_API_KEY (server API) are set — exactly like the Iyzico adapter:
// no SDK, no dependency, no build change, nothing called automatically. The
// signature verifier and the mappers are pure & unit-tested.
//
// Why Paddle: the business runs under an Italian Partita IVA selling to Turkish
// customers. Paddle is a Merchant of Record — it is the seller of record and
// collects/remits VAT in every jurisdiction, so the owner never registers for
// VAT abroad. The dormant iyzico fallback (webhook + client) was REMOVED
// 2026-07-16 (Codex audit): Paddle is locked in as MoR, and a half-built
// webhook with placeholder shared-secret auth was a foot-gun waiting for
// someone to set IYZICO_WEBHOOK_SECRET. If a Turkish entity ever needs
// iyzico, rebuild it with real signature verification (git history has the old code).
//
// Webhook signature (Paddle Billing):
//   header  Paddle-Signature: ts=<unix>;h1=<hex hmac>
//   signed  `${ts}:${rawRequestBody}`   (RAW body bytes, not re-serialized)
//   hmac    HMAC_SHA256(signed, notificationSecret) compared in constant time
// ---------------------------------------------------------------------------

export type PaddleConfig = { apiKey: string; environment: "sandbox" | "production"; baseUrl: string };

/** Server-API config (checkout/transaction calls). Null until PADDLE_API_KEY set. */
export function getPaddleConfig(): PaddleConfig | null {
  const apiKey = process.env.PADDLE_API_KEY?.trim();
  if (!apiKey) return null;
  const environment = process.env.PADDLE_ENV?.trim() === "production" ? "production" : "sandbox";
  const baseUrl = environment === "production" ? "https://api.paddle.com" : "https://sandbox-api.paddle.com";
  return { apiKey, environment, baseUrl };
}

export function isPaddleConfigured(): boolean {
  return getPaddleConfig() !== null;
}

/** Webhook signing secret (independent of the API key). Null → webhook dormant. */
export function getPaddleWebhookSecret(): string | null {
  return process.env.PADDLE_WEBHOOK_SECRET?.trim() || null;
}

// Reject a webhook whose timestamp is older/newer than this — replay defence.
const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

/**
 * Verify a Paddle-Signature header against the RAW request body. Pure &
 * deterministic (pass `now` in tests). Returns true only on a fresh, matching
 * HMAC. Never throws.
 */
export function verifyPaddleSignature(opts: {
  signatureHeader: string | null | undefined;
  rawBody: string;
  secret: string;
  now?: number; // unix seconds — injectable for tests
  toleranceSeconds?: number;
}): boolean {
  const { signatureHeader, rawBody, secret } = opts;
  if (!signatureHeader || !secret) return false;

  // Parse "ts=...;h1=...(;h1=...)" — tolerate spacing and multiple h1 values.
  let ts = "";
  const h1s: string[] = [];
  for (const part of signatureHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    if (key === "ts") ts = val;
    else if (key === "h1") h1s.push(val);
  }
  if (!ts || h1s.length === 0) return false;

  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) return false;
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const tolerance = opts.toleranceSeconds ?? SIGNATURE_TOLERANCE_SECONDS;
  if (Math.abs(now - tsNum) > tolerance) return false;

  const expected = createHmac("sha256", secret).update(`${ts}:${rawBody}`, "utf8").digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  return h1s.some((h1) => {
    let provided: Buffer;
    try {
      provided = Buffer.from(h1, "hex");
    } catch {
      return false;
    }
    return provided.length === expectedBuf.length && timingSafeEqual(provided, expectedBuf);
  });
}

/**
 * Map a Paddle price id (from a webhook's subscription item) to our plan code.
 * Configured via env so the same code works in sandbox and production without a
 * rebuild. Unknown price → null (event is stored but no plan change is applied).
 */
export function paddlePriceToPlanCode(priceId: string | null | undefined): string | null {
  if (!priceId) return null;
  const map: Record<string, string> = {};
  const baslangic = process.env.PADDLE_PRICE_BASLANGIC?.trim();
  const pro = process.env.PADDLE_PRICE_PRO?.trim();
  const isletme = process.env.PADDLE_PRICE_ISLETME?.trim();
  if (baslangic) map[baslangic] = "free"; // "Başlangıç" — legacy code "free"
  if (pro) map[pro] = "pro";
  if (isletme) map[isletme] = "business";
  return map[priceId] ?? null;
}

/** Map a Paddle subscription status to our local Subscription.status vocabulary. */
export function paddleStatusToLocal(status: string | null | undefined): string {
  switch (status) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "past_due":
      return "past_due";
    case "paused":
      return "past_due"; // inactive but recoverable → not in ACTIVE_STATUSES
    case "canceled":
      return "canceled";
    default:
      // Unknown/missing status → treat as NOT active. Never gift premium access
      // on an unrecognized value; the 14-day dunning grace still keeps a genuine
      // paying customer active while their real status is resolved.
      return "past_due";
  }
}

export type PortalLinks = {
  /** Homepage of the customer portal — change plan / cancel / update payment. */
  overview: string;
  /** Deep link straight to the cancellation form for this subscription (if any). */
  cancel: string | null;
};

/**
 * Create a Paddle-hosted customer-portal session for one subscription and return
 * its authenticated links. Paddle's portal is where the customer changes plan
 * (Paddle owns the proration — upgrade immediate, downgrade at period end),
 * cancels, and updates their card, so we never touch the money math ourselves.
 * Sessions are single-use + short-lived → generate on demand, never cache.
 * Never throws — returns null on any failure (missing config, API error).
 */
export async function createPortalSession(subscriptionId: string): Promise<PortalLinks | null> {
  if (!subscriptionId || !isPaddleConfigured()) return null;
  try {
    // The portal session is keyed by CUSTOMER, so resolve the customer id from
    // the subscription first (we only persist the subscription id / providerRef).
    const sub = (await paddleRequest(`/subscriptions/${encodeURIComponent(subscriptionId)}`)) as {
      data?: { customer_id?: string };
    };
    const customerId = sub?.data?.customer_id;
    if (!customerId) {
      await reportError("paddle-portal", new Error("subscription lookup returned no customer_id"));
      return null;
    }

    const res = (await paddleRequest(`/customers/${encodeURIComponent(customerId)}/portal-sessions`, {
      method: "POST",
      body: { subscription_ids: [subscriptionId] },
    })) as {
      data?: {
        urls?: {
          general?: { overview?: string };
          subscriptions?: Array<{ id?: string; cancel_subscription?: string }>;
        };
      };
    };
    const overview = res?.data?.urls?.general?.overview;
    if (!overview) {
      await reportError("paddle-portal", new Error("portal session returned no overview url"));
      return null;
    }
    const cancel =
      res?.data?.urls?.subscriptions?.find((s) => s.id === subscriptionId)?.cancel_subscription ?? null;
    return { overview, cancel };
  } catch (err) {
    // e.g. "Paddle HTTP 404 (entity_not_found) env=production resource=subscriptions"
    // → the stored subscription id doesn't exist in the current Paddle environment.
    await reportError("paddle-portal", err);
    return null;
  }
}

/**
 * Low-level Paddle Billing API call (e.g. create a transaction for checkout).
 * Only usable when PADDLE_API_KEY is set; never invoked automatically. Throws if
 * not configured.
 */
export async function paddleRequest(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<unknown> {
  const cfg = getPaddleConfig();
  if (!cfg) throw new Error("Paddle yapılandırılmadı (PADDLE_API_KEY yok).");
  const res = await fetch(cfg.baseUrl + path, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const body = (await res.json().catch(() => null)) as
    | { error?: { code?: string } }
    | null;
  if (!res.ok) {
    // Surface the failure with the HTTP status + Paddle's error code + which env
    // we hit + the resource type — NO ids (the sub/customer id isn't logged). This
    // is how we tell "sandbox subscription queried on the production API" (404
    // entity_not_found) apart from an auth/permission problem (403/401).
    const code = body?.error?.code ?? "unknown";
    const resource = path.replace(/^\//, "").split("/")[0] || "?";
    throw new Error(`Paddle HTTP ${res.status} (${code}) env=${cfg.environment} resource=${resource}`);
  }
  return body;
}

// ---------------------------------------------------------------------------
// In-app plan change (upgrade / downgrade). Paddle's hosted portal can't do this,
// so we drive PATCH /subscriptions/{id} ourselves. Paddle computes ALL proration;
// we only pass the target price + the billing mode and (for the confirm dialog)
// read back the amounts it previews. GATED behind PADDLE_PLAN_CHANGE_ENABLED at
// the route/UI layer — these helpers are inert unless called.
// ---------------------------------------------------------------------------

type PaddleProrationMode = "prorated_immediately" | "prorated_next_billing_period";
type PaddleTotals = { grand_total?: string; currency_code?: string };
type PaddleTxn = { details?: { totals?: PaddleTotals } };

/** Format a Paddle minor-unit total ("kuruş" string) as a tr-TR currency string. */
function formatPaddleTotal(minor: string | undefined, currency: string | null): string | null {
  if (minor === undefined) return null;
  const n = Number(minor);
  if (!Number.isFinite(n)) return null;
  const amount = n / 100;
  try {
    return currency
      ? new Intl.NumberFormat("tr-TR", { style: "currency", currency }).format(amount)
      : amount.toLocaleString("tr-TR");
  } catch {
    return amount.toLocaleString("tr-TR");
  }
}

export type PlanChangePreview = {
  mode: PaddleProrationMode;
  /** Charged NOW (upgrade / prorated_immediately). null for a period-end downgrade. */
  immediateTotal: string | null;
  /** The plan's recurring total after the change (next regular bill). */
  recurringTotal: string | null;
};

/**
 * Preview a plan change WITHOUT applying it — so the confirm dialog can show the
 * exact prorated charge Paddle will make. Best-effort: returns null on any failure
 * and parses defensively (a missing field → null amount, never a wrong number).
 * The real charge is always whatever Paddle computes on the apply call, not this.
 */
export async function previewSubscriptionUpdate(
  subscriptionId: string,
  priceId: string,
  mode: PaddleProrationMode,
  orgId?: string,
): Promise<PlanChangePreview | null> {
  if (!subscriptionId || !priceId || !isPaddleConfigured()) return null;
  try {
    const res = (await paddleRequest(`/subscriptions/${encodeURIComponent(subscriptionId)}/preview`, {
      method: "PATCH",
      body: { items: [{ price_id: priceId, quantity: 1 }], proration_billing_mode: mode },
    })) as {
      data?: {
        currency_code?: string;
        immediate_transaction?: PaddleTxn;
        recurring_transaction_details?: { totals?: PaddleTotals };
      };
    };
    const d = res?.data;
    const imm = d?.immediate_transaction?.details?.totals;
    const rec = d?.recurring_transaction_details?.totals;
    const currency = imm?.currency_code ?? rec?.currency_code ?? d?.currency_code ?? null;
    return {
      mode,
      immediateTotal: formatPaddleTotal(imm?.grand_total, currency),
      recurringTotal: formatPaddleTotal(rec?.grand_total, currency),
    };
  } catch (err) {
    // Don't page on an expected outcome (e.g. entity_not_found for a trialing org
    // with no Paddle sub); keep a STRUCTURED, org-tagged log line. Other failures page.
    if (isExpectedPaddleError(err)) {
      logExpectedPaddleOutcome("plan-preview", orgId, err);
    } else {
      await reportError("paddle-plan-preview", err);
    }
    return null;
  }
}

export type PlanUpdateResult =
  | { ok: true }
  // "definitive" = Paddle REJECTED the request (4xx) → NO mutation applied → safe to
  // retry. "ambiguous" = we don't know if it applied (5xx / request-timeout / network
  // / abort) → the PATCH may have gone through → must NOT blindly re-send.
  | { ok: false; kind: "definitive" | "ambiguous"; reason: string };

/**
 * Classify a failed Paddle mutation as definitely-not-applied vs maybe-applied.
 * paddleRequest throws "Paddle HTTP <status> (<code>)" on a non-2xx and lets a
 * network/AbortSignal-timeout error propagate raw. A 4xx (except 408 request-timeout)
 * means Paddle validated and rejected the call → nothing changed. Anything else — 5xx,
 * 408, or a thrown network/timeout with no HTTP status — might have applied.
 */
export function classifyPaddleFailure(err: unknown): "definitive" | "ambiguous" {
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.match(/Paddle HTTP (\d{3})/);
  if (m) {
    const status = Number(m[1]);
    if (status >= 400 && status < 500 && status !== 408) return "definitive"; // rejected, not applied
    return "ambiguous"; // 5xx / 408 → may have applied
  }
  return "ambiguous"; // AbortSignal timeout / network error / unknown → may have applied
}

/**
 * KNOWN, non-actionable Paddle outcomes — a declined card or a subscription that
 * doesn't exist are normal business/test states (a customer's card failed, or a
 * trialing org has no real Paddle subscription yet), NOT Lixus bugs. These must
 * NOT page Sentry + the alert e-mail (they flooded the founder's inbox during
 * self-testing); they stay in the console log, and the caller's controlled
 * response to the user is unchanged. Every OTHER failure (auth, validation, 5xx,
 * network) still pages so a genuine bug is never masked. Residual (documented):
 * a genuinely stale providerRef producing entity_not_found on APPLY won't page —
 * the reconcile/webhook path still settles sub-state, and the console keeps it.
 */
export function isExpectedPaddleError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const code = msg.match(/Paddle HTTP \d{3} \(([^)]+)\)/)?.[1] ?? "";
  return code === "subscription_payment_declined" || code === "entity_not_found" || code === "not_found";
}

/**
 * Structured log for a KNOWN, non-paging Paddle outcome (declined card / stale
 * providerRef). Deliberately NOT a bare free-form warn: emit operation + org +
 * Paddle's own "HTTP <status> (<code>) env=... resource=..." as one greppable
 * line. The documented residual — a stale providerRef hitting entity_not_found on
 * APPLY, which we choose not to page — can then be traced to the exact org for
 * reconciliation. Paddle's message already omits the sub/customer id (privacy);
 * `org` is our own tenant id, already present across audit/logs, never PII.
 */
function logExpectedPaddleOutcome(
  operation: "plan-preview" | "plan-change",
  orgId: string | undefined,
  err: unknown,
): void {
  const detail = err instanceof Error ? err.message : String(err);
  console.warn(
    `[paddle] expected outcome — not paged ${JSON.stringify({ operation, org: orgId ?? null, detail })}`,
  );
}

/**
 * Apply a plan change. Upgrade → prorated_immediately (charge the difference now).
 * Downgrade → prorated_next_billing_period (takes effect at renewal). Paddle owns
 * the proration + charge; our webhook then updates the local subscription row.
 * Never throws — on failure returns { ok:false, kind, reason } where reason is Paddle's
 * "HTTP <status> (<code>)" string (no ids). The caller MUST branch on `kind`: only a
 * "definitive" failure is safe to retry (Paddle has no general-API idempotency key, so
 * an "ambiguous" failure could double-apply if blindly re-sent).
 */
export async function updateSubscriptionPlan(
  subscriptionId: string,
  priceId: string,
  mode: PaddleProrationMode,
  orgId?: string,
): Promise<PlanUpdateResult> {
  if (!subscriptionId || !priceId || !isPaddleConfigured()) {
    return { ok: false, kind: "definitive", reason: "unconfigured" }; // no request sent → not applied
  }
  try {
    await paddleRequest(`/subscriptions/${encodeURIComponent(subscriptionId)}`, {
      method: "PATCH",
      body: { items: [{ price_id: priceId, quantity: 1 }], proration_billing_mode: mode },
    });
    return { ok: true };
  } catch (err) {
    // A declined card / stale providerRef is a normal outcome, not a bug — don't
    // page, but keep a STRUCTURED, org-tagged log line. The return contract
    // (kind/reason) is UNCHANGED, so the route's controlled user response is identical.
    if (isExpectedPaddleError(err)) {
      logExpectedPaddleOutcome("plan-change", orgId, err);
    } else {
      await reportError("paddle-plan-change", err);
    }
    return { ok: false, kind: classifyPaddleFailure(err), reason: err instanceof Error ? err.message : "unknown" };
  }
}

/**
 * The price id currently on a subscription's first item, per Paddle (GET). Used to
 * RECONCILE after an AMBIGUOUS plan-change failure: if this already equals the target
 * price, the PATCH did apply (its response was just lost) → treat as success. Never
 * throws → null on any failure, so an unreadable state stays "unknown", not "applied".
 */
export async function getSubscriptionCurrentPriceId(subscriptionId: string): Promise<string | null> {
  if (!subscriptionId || !isPaddleConfigured()) return null;
  try {
    const res = (await paddleRequest(`/subscriptions/${encodeURIComponent(subscriptionId)}`)) as {
      data?: { items?: Array<{ price?: { id?: string }; price_id?: string }> };
    };
    const items = res?.data?.items;
    if (Array.isArray(items) && items.length > 0) {
      const first = items[0];
      return first?.price?.id ?? first?.price_id ?? null;
    }
    return null;
  } catch (err) {
    await reportError("paddle-subscription-get", err);
    return null;
  }
}
