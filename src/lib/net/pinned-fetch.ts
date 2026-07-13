import "server-only";

import { Agent } from "undici";
import { lookup as dnsLookup } from "node:dns";
import { isPrivateAddress } from "./private-host";

// ---------------------------------------------------------------------------
// DNS-rebind (TOCTOU) hardening for host-supplied fetches — the iCal feed
// pipeline (Codex #22 final).
//
// The gap: a pre-flight resolvesToPrivate() check and fetch()'s OWN resolution
// are two separate lookups. Between them an attacker's DNS can flip a public
// answer to a private one (rebind), so fetch connects to 127.0.0.1 / 169.254.*
// after the check passed.
//
// The fix: pin the connection to a VALIDATED address by owning the resolution
// the socket actually uses. undici's connector accepts a `lookup` (same
// contract as dns.lookup); net/tls calls it ONCE at connect time and connects
// to exactly what it returns — there is no second resolution to race. TLS
// servername/SNI stays the original hostname (undici sets it from the URL), so
// certificate validation is unchanged and never relaxed.
//
// Not IP literals: a URL whose host is already an IP skips lookup entirely, so
// this never runs for them — the string gate isPrivateHost() already rejects
// private literals before fetch, and a public IP literal cannot be rebound.
// ---------------------------------------------------------------------------

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address?: string | { address: string; family: number }[],
  family?: number,
) => void;

/**
 * A dns.lookup-compatible resolver that REJECTS the whole connection unless
 * EVERY A/AAAA answer is public. Rejecting the set (not filtering to a public
 * sibling) is what defeats a poisoned multi-record answer. Exported for tests.
 */
export function validatingLookup(
  hostname: string,
  options: { all?: boolean; family?: number; hints?: number },
  callback: LookupCallback,
): void {
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
    // All public → hand the socket the SAME addresses we validated.
    if (options.all) return callback(null, list.map((a) => ({ address: a.address, family: a.family })));
    return callback(null, list[0].address, list[0].family);
  });
}

let cachedAgent: Agent | undefined;

/**
 * A shared undici dispatcher that connects public host-supplied fetches only to
 * validated public IPs. Pass as `fetch(url, { dispatcher: pinnedPublicAgent() })`.
 * TLS/cert validation and redirect policy are the caller's fetch options — this
 * only governs which IP the socket may reach.
 */
export function pinnedPublicAgent(): Agent {
  if (!cachedAgent) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- undici's lookup type is stricter than dns.lookup's overloads
    cachedAgent = new Agent({ connect: { lookup: validatingLookup as any } });
  }
  return cachedAgent;
}
