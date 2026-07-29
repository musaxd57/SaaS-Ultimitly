import "server-only";

// Server-only marker over the pure accessor (see crypto.ts for why the split
// exists). App code imports THIS path — the accessor-bypass source-scan pin
// keys on it — while operator scripts reach the core directly under tsx.
export * from "./calendar-source-url-core";
