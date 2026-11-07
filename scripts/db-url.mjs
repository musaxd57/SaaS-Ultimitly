// Pure helper shared by the destructive-command gate (guard-local-db.mjs) and
// its tests. Kept free of side effects so importing it never triggers the gate.

/**
 * True when the URL carries a query parameter that overrides the host. libpq / Prisma read `?host=` and `?hostaddr=`
 * INSTEAD of the authority part, so "postgresql://u@localhost:5432/db?host=prod-db.example" is a REMOTE database
 * (10-01, 15-agent review A02-F9). Shared by every "is this database local?" guard.
 */
export function hasHostOverrideParam(url) {
  try {
    for (const key of new URL(url ?? "").searchParams.keys()) {
      if (/^(?:host|hostaddr)$/i.test(key)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** True only when the URL parses, its host is a loopback address and no query parameter overrides that host. */
export function isLocalDatabaseUrl(url) {
  try {
    const h = new URL(url ?? "").hostname;
    if (hasHostOverrideParam(url)) return false;
    return h === "localhost" || h === "127.0.0.1" || h === "::1";
  } catch {
    return false; // unparseable / empty → treat as non-local (refuse)
  }
}
