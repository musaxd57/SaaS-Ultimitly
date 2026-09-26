import "server-only";

// ---------------------------------------------------------------------------
// P2 HTTPS-pin (Codex). A SINGLE predicate: "is this base URL safe to send a
// secret to?" — used by the runtime clients that carry a credential (Bearer API
// key / per-tenant token / OAuth client_secret) to an env-overridable EXTERNAL
// endpoint: hospitable.ts, hospitable-oauth.ts, supply-ai.ts, shadow-ai.ts.
//
// The matching BOOT gate lives in scripts/env-check.mjs (plain ESM, runs BEFORE
// the TS runtime) so a wrong http:// override fails the deploy before any
// traffic starts — same rule, enforced twice (fail-fast at boot + defence in
// depth at the call site, so no credential ever rides plaintext).
//
//   production : https:// ONLY.
//   dev / test : https://, OR http:// to LOCALHOST (so a local mock / an
//                injected test transport works). Non-localhost http is refused
//                even in dev/test — the localhost carve-out is deliberately
//                narrow.
//
// NEVER log the URL from here — a base URL can carry a token in its path/query;
// callers surface a field NAME / a fixed reason, never the value. DATABASE_URL
// and Railway-internal service addresses are deliberately NOT run through this:
// they are not credential-bearing external HTTP(S) endpoints.
// ---------------------------------------------------------------------------

// `new URL(...).hostname` renders IPv6 WITH brackets (e.g. "[::1]"), so the
// loopback set matches that exact form.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * True when `rawUrl` is an acceptable target for a secret-bearing request.
 * Unparseable / empty / non-http(s) → false (fail closed).
 */
export function isSecureExternalUrl(rawUrl: string | undefined | null): boolean {
  if (!rawUrl) return false;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol === "https:") return true;
  if (parsed.protocol === "http:" && process.env.NODE_ENV !== "production") {
    return LOCAL_HOSTS.has(parsed.hostname.toLowerCase());
  }
  return false;
}
