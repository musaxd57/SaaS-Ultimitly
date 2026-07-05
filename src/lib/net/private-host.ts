/**
 * True when a hostname is a literal loopback / link-local / private / cloud-
 * metadata target. String-only (no DNS) so it's cheap and can never false-reject
 * a legitimate public feed on a transient DNS hiccup. Used to guard host-supplied
 * fetch targets (iCal calendar-source URLs) against the most direct SSRF vectors
 * (http://127.0.0.1, http://169.254.169.254, http://10.x, localhost, [::1]).
 *
 * Residual (documented, follow-up): a public hostname that DNS-resolves to a
 * private IP, or a public host that 302-redirects to an internal one, is NOT
 * caught here — closing those needs DNS resolution + a redirect-validating
 * dispatcher. This guard blocks the literal-address cases, which are the common
 * metadata/loopback attacks.
 */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, ""); // strip IPv6 [..] brackets
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) {
    return true;
  }
  // IPv6 loopback / unspecified / link-local (fe80::/10) / unique-local (fc00::/7)
  if (h === "::1" || h === "::" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) {
    return true;
  }
  // IPv4 (incl. IPv4-mapped ::ffff:a.b.c.d)
  const mapped = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  const ip = mapped ? mapped[1] : h;
  const parts = ip.split(".");
  if (parts.length === 4 && parts.every((x) => /^\d+$/.test(x))) {
    const [a, b] = parts.map((n) => Number(n));
    if (a === 0 || a === 127 || a === 10) return true; // this-network, loopback, private
    if (a === 169 && b === 254) return true; // link-local + cloud metadata (169.254.169.254)
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT (100.64.0.0/10)
  }
  return false;
}
