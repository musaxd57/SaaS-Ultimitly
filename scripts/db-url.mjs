// Pure helper shared by the destructive-command gate (guard-local-db.mjs) and
// its tests. Kept free of side effects so importing it never triggers the gate.

/** True only when the URL parses and its host is a loopback address. */
export function isLocalDatabaseUrl(url) {
  try {
    const h = new URL(url ?? "").hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "::1";
  } catch {
    return false; // unparseable / empty → treat as non-local (refuse)
  }
}
