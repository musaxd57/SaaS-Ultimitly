import "server-only";

// Server-only marker over the pure implementation (crypto.ts precedent):
// operator scripts import "./email-core" directly under tsx; app code imports
// THIS path and keeps the Next build-time guard. One implementation, no copy.
export * from "./email-core";
