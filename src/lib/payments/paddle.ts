import "server-only";

import { createHmac, timingSafeEqual } from "crypto";

// ---------------------------------------------------------------------------
// Paddle Billing client (Faz 2). DORMANT until PADDLE_WEBHOOK_SECRET (webhook)
// and/or PADDLE_API_KEY (server API) are set — exactly like the Iyzico adapter:
// no SDK, no dependency, no build change, nothing called automatically. The
// signature verifier and the mappers are pure & unit-tested.
//
// Why Paddle: the business runs under an Italian Partita IVA selling to Turkish
// customers. Paddle is a Merchant of Record — it is the seller of record and
// collects/remits VAT in every jurisdiction, so the owner never registers for
// VAT abroad. iyzico (Turkish-tax-registration only) stays DORMANT as a fallback
// if a Turkish entity is ever used; nothing here removes it.
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
    if (!customerId) return null;

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
    if (!overview) return null;
    const cancel =
      res?.data?.urls?.subscriptions?.find((s) => s.id === subscriptionId)?.cancel_subscription ?? null;
    return { overview, cancel };
  } catch {
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
  return res.json();
}
