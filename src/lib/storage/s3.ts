import "server-only";

import { createHash, createHmac } from "node:crypto";
import type { StorageConfig } from "./config";

// ---------------------------------------------------------------------------
// Minimal AWS Signature V4 for an S3-compatible provider (AWS S3 / Cloudflare
// R2, path-style addressing). NO SDK dependency on purpose (repo convention —
// the CSV parser precedent): presigning is pure crypto, and PUT/DELETE are one
// signed fetch each. Everything is deterministic given (config, key, now), so
// tests pin exact behavior offline — no bucket required.
//
// Secret handling: the secret key ONLY enters the HMAC chain below. It is never
// logged, never embedded in a URL or header, and errors carry status codes only.
// ---------------------------------------------------------------------------

const SERVICE = "s3";
/** Signed GET URLs are SHORT-LIVED: default 5 minutes, hard cap 15. */
export const SIGNED_URL_DEFAULT_TTL_S = 300;
export const SIGNED_URL_MAX_TTL_S = 900;

const sha256Hex = (data: string | Uint8Array): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string): Buffer => createHmac("sha256", key).update(data).digest();

/** RFC 3986 encoding (S3 canonical form): also escapes ! ' ( ) * . */
function rfc3986(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

/** Encode an object key for the canonical URI: each segment encoded, slashes kept. */
function encodeKeyPath(key: string): string {
  return key.split("/").map(rfc3986).join("/");
}

function amzTimestamps(now: Date): { amzDate: string; dateStamp: string } {
  const iso = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z"); // YYYYMMDDTHHMMSSZ
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

function signingKey(secret: string, dateStamp: string, region: string): Buffer {
  const kDate = hmac("AWS4" + secret, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, SERVICE);
  return hmac(kService, "aws4_request");
}

/**
 * Presign a GET for one object — the ONLY way a stored photo is ever served.
 * Query-string SigV4 with UNSIGNED-PAYLOAD; TTL clamped to [1s, 15min].
 */
export function presignGetUrl(
  config: StorageConfig,
  key: string,
  opts: { expiresSeconds?: number; now?: Date } = {},
): string {
  const now = opts.now ?? new Date();
  const expires = Math.min(SIGNED_URL_MAX_TTL_S, Math.max(1, Math.floor(opts.expiresSeconds ?? SIGNED_URL_DEFAULT_TTL_S)));
  const { amzDate, dateStamp } = amzTimestamps(now);
  const host = new URL(config.endpoint).host;
  const scope = `${dateStamp}/${config.region}/${SERVICE}/aws4_request`;
  const canonicalUri = `/${rfc3986(config.bucket)}/${encodeKeyPath(key)}`;

  // Already in canonical (sorted-by-name) order.
  const query: [string, string][] = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${config.accessKeyId}/${scope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(expires)],
    ["X-Amz-SignedHeaders", "host"],
  ];
  const canonicalQuery = query.map(([k, v]) => `${rfc3986(k)}=${rfc3986(v)}`).join("&");

  const canonicalRequest = ["GET", canonicalUri, canonicalQuery, `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const signature = createHmac("sha256", signingKey(config.secretAccessKey, dateStamp, config.region))
    .update(stringToSign)
    .digest("hex");

  return `${config.endpoint}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/** Header-signed request pieces for PUT/DELETE (server-to-provider calls). */
export function signedRequest(
  config: StorageConfig,
  method: "PUT" | "DELETE",
  key: string,
  payload: Uint8Array | null,
  now: Date = new Date(),
): { url: string; headers: Record<string, string> } {
  const { amzDate, dateStamp } = amzTimestamps(now);
  const host = new URL(config.endpoint).host;
  const scope = `${dateStamp}/${config.region}/${SERVICE}/aws4_request`;
  const canonicalUri = `/${rfc3986(config.bucket)}/${encodeKeyPath(key)}`;
  const payloadHash = sha256Hex(payload ?? new Uint8Array(0));

  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const canonicalRequest = [method, canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const signature = createHmac("sha256", signingKey(config.secretAccessKey, dateStamp, config.region))
    .update(stringToSign)
    .digest("hex");

  return {
    url: `${config.endpoint}${canonicalUri}`,
    headers: {
      "x-amz-date": amzDate,
      "x-amz-content-sha256": payloadHash,
      authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}
