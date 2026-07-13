import "server-only";

import https from "node:https";
import http from "node:http";
import { lookup as dnsLookup } from "node:dns";
import type { Readable } from "node:stream";
import { isPrivateAddress } from "./private-host";

// ---------------------------------------------------------------------------
// DNS-rebind (TOCTOU) hardened fetch for host-supplied iCal feeds (Codex #22).
//
// Built on node:https / node:http — NOT undici — on purpose: node core is
// present and API-stable on EVERY Node version the image might ship (no
// dependency to install, no built-in-vs-node_modules undici major-mismatch,
// no engine floor to prove in a container). net/tls's own `lookup` option is
// the pin point: the socket calls our resolver ONCE at connect time and
// connects to exactly what it returns, so there is no second resolution to
// race. TLS servername/SNI stays the hostname (cert validation unchanged,
// never relaxed). Each request owns its socket and closes it on end/error —
// no shared Agent to leak.
// ---------------------------------------------------------------------------

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address?: string | { address: string; family: number }[],
  family?: number,
) => void;

export type Lookup = (
  hostname: string,
  options: { all?: boolean; family?: number; hints?: number },
  callback: LookupCallback,
) => void;

/**
 * A dns.lookup-compatible resolver that REJECTS the whole connection unless
 * EVERY A/AAAA answer is public. Rejecting the set (not filtering to a public
 * sibling) is what defeats a poisoned multi-record answer. Exported for tests.
 */
export const validatingLookup: Lookup = (hostname, options, callback) => {
  // Always resolve the full set for validation (verbatim → IPv4-mapped IPv6 is
  // seen as-is, e.g. ::ffff:169.254.169.254, and handled by isPrivateAddress).
  dnsLookup(hostname, { all: true, verbatim: true, family: options.family, hints: options.hints }, (err, addresses) => {
    if (err) return callback(err);
    const list = Array.isArray(addresses) ? addresses : addresses ? [addresses] : [];
    if (list.length === 0) {
      return callback(Object.assign(new Error(`SSRF: no address for ${hostname}`), { code: "ENOTFOUND" }));
    }
    for (const a of list) {
      if (isPrivateAddress(a.address)) {
        return callback(
          Object.assign(new Error(`SSRF: blocked private address ${a.address} for ${hostname}`), { code: "EACCES" }),
        );
      }
    }
    if (options.all) return callback(null, list.map((a) => ({ address: a.address, family: a.family })));
    return callback(null, list[0].address, list[0].family);
  });
};

/**
 * Read a Readable to a string with a HARD byte cap enforced WHILE streaming —
 * a chunked / lying Content-Length body is aborted the moment it crosses the
 * cap instead of being buffered whole first. Exported for isolated testing.
 */
export function readStreamCapped(stream: Readable, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    stream.on("data", (c: Buffer) => {
      total += c.length;
      if (total > maxBytes) {
        stream.destroy();
        reject(new Error("feed too large"));
        return;
      }
      chunks.push(c);
    });
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    stream.on("error", reject);
  });
}

export interface FeedFetchOptions {
  maxBytes: number;
  timeoutMs: number;
  userAgent: string;
  /** Test-only: swap the resolver so a test can reach a loopback server that the
   *  production validatingLookup would (correctly) refuse. */
  lookupOverride?: Lookup;
}

/**
 * GET a host-supplied feed URL and return its body text. Enforces: pinned
 * public-only IP (via lookup), NO redirect following (a 3xx is a failure, not a
 * hop — nothing to re-resolve), a declared+streamed byte cap, and a connect/
 * idle timeout. HTTPS keeps full cert validation; legacy http is still allowed
 * (the create route requires https for new sources).
 */
export function fetchFeedText(rawUrl: string, opts: FeedFetchOptions): Promise<string> {
  const url = new URL(rawUrl);
  const isHttps = url.protocol === "https:";
  if (!isHttps && url.protocol !== "http:") {
    return Promise.reject(new Error(`unsupported protocol ${url.protocol}`));
  }
  const mod = isHttps ? https : http;
  const lookup = opts.lookupOverride ?? validatingLookup;

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    const done = (text: string) => {
      if (settled) return;
      settled = true;
      resolve(text);
    };

    const req = mod.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: {
          "User-Agent": opts.userAgent,
          // Ask for no compression: node:http won't auto-decompress, and iCal is
          // small text — keep the byte-cap counting the real payload.
          "Accept-Encoding": "identity",
          "Cache-Control": "no-cache",
        },
        // PIN: connect only to an address validatingLookup approved as public.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dns.lookup overloads are wider than the socket's callback shape
        lookup: lookup as any,
        // SNI = the original hostname; cert is validated against it (unchanged).
        servername: isHttps ? url.hostname : undefined,
        timeout: opts.timeoutMs,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        // redirect:"manual" equivalent — never follow a redirect (a 30x could aim
        // at an internal host); a 3xx (or any non-2xx) is a hard failure.
        if (status < 200 || status >= 300) {
          res.destroy();
          return fail(new Error(`HTTP ${status}`));
        }
        const declared = Number(res.headers["content-length"]);
        if (Number.isFinite(declared) && declared > opts.maxBytes) {
          res.destroy();
          return fail(new Error("feed too large"));
        }
        readStreamCapped(res, opts.maxBytes).then(done, fail);
      },
    );
    // Idle/connect timeout: node emits 'timeout' without aborting — we destroy.
    req.on("timeout", () => {
      req.destroy(new Error("feed timeout"));
    });
    req.on("error", fail);
    req.end();
  });
}
