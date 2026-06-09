import "server-only";

import { createHmac, randomBytes } from "crypto";

// ---------------------------------------------------------------------------
// Iyzico client (Faz 2). DORMANT until IYZICO_API_KEY + IYZICO_SECRET_KEY are
// set — exactly like the Sentry hook, no SDK, no build changes. Nothing here is
// called automatically anywhere; the checkout/subscription flow will use it once
// sandbox keys exist. The auth-header builder is pure & unit-tested.
//
// Auth scheme: IYZWSv2.
//   payload   = randomKey + uriPath + requestBody
//   signature = HMAC_SHA256(payload, secretKey)  (hex)
//   header    = "IYZWSv2 " + base64("apiKey:..&randomKey:..&signature:..")
// ---------------------------------------------------------------------------

export type IyzicoConfig = { apiKey: string; secretKey: string; baseUrl: string };

export function getIyzicoConfig(): IyzicoConfig | null {
  const apiKey = process.env.IYZICO_API_KEY?.trim();
  const secretKey = process.env.IYZICO_SECRET_KEY?.trim();
  if (!apiKey || !secretKey) return null;
  const baseUrl = process.env.IYZICO_BASE_URL?.trim() || "https://sandbox-api.iyzipay.com";
  return { apiKey, secretKey, baseUrl };
}

export function isIyzicoConfigured(): boolean {
  return getIyzicoConfig() !== null;
}

/** Build an IYZWSv2 Authorization header. Deterministic given `randomKey`. */
export function buildAuthHeader(params: {
  apiKey: string;
  secretKey: string;
  uriPath: string;
  body: string;
  randomKey?: string;
}): { authorization: string; randomKey: string } {
  const randomKey = params.randomKey ?? `${Date.now()}${randomBytes(8).toString("hex")}`;
  const payload = randomKey + params.uriPath + params.body;
  const signature = createHmac("sha256", params.secretKey).update(payload, "utf8").digest("hex");
  const authParams = [`apiKey:${params.apiKey}`, `randomKey:${randomKey}`, `signature:${signature}`].join("&");
  const authorization = `IYZWSv2 ${Buffer.from(authParams).toString("base64")}`;
  return { authorization, randomKey };
}

/**
 * Low-level POST to Iyzico. Only callable when configured; never invoked
 * automatically. Returns parsed JSON. Throws if not configured.
 */
export async function iyzicoRequest(uriPath: string, body: Record<string, unknown>): Promise<unknown> {
  const cfg = getIyzicoConfig();
  if (!cfg) throw new Error("Iyzico yapılandırılmadı (IYZICO_API_KEY/IYZICO_SECRET_KEY yok).");

  const bodyStr = JSON.stringify(body);
  const { authorization, randomKey } = buildAuthHeader({
    apiKey: cfg.apiKey,
    secretKey: cfg.secretKey,
    uriPath,
    body: bodyStr,
  });

  const res = await fetch(cfg.baseUrl + uriPath, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authorization,
      "x-iyzi-rnd": randomKey,
    },
    body: bodyStr,
    signal: AbortSignal.timeout(15000),
  });
  return res.json();
}
