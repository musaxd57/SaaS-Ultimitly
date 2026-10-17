import "server-only";

// Thin server-only marker over the pure implementation. The split exists for
// operator scripts (scripts/*.ts run under tsx, where the "server-only" package
// does not resolve): app code keeps importing "@/lib/crypto" and keeps the Next
// build-time guard; scripts import "../src/lib/crypto-core" directly. Same
// single implementation either way — nothing is duplicated.
export * from "./crypto-core";
