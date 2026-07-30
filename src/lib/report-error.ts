import "server-only";

// Server-only marker over the pure implementation (crypto.ts precedent).
// The FULL reporter — redaction, Sentry envelope client, email leg, throttle —
// lives in report-error-core.ts so operator scripts (tsx, where "server-only"
// doesn't resolve) can exercise the REAL code path end to end. App code
// imports THIS path. One implementation, nothing duplicated.
export * from "./report-error-core";
