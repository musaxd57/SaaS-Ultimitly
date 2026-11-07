import "server-only";

// Server-only marker over the pure accessor (see crypto.ts for why the split
// exists). App code imports THIS path — the accessor-bypass source-scan pin
// keys on it — while operator scripts reach the core directly under tsx.
export * from "./calendar-source-url-core";

/**
 * Phase-4 contract switch. Default OFF: create keeps dual-writing the real URL
 * into BOTH columns (today's behavior, byte-identical). "1" flips create to
 * store the sentinel in the plaintext column — a FORWARD-ONLY commitment for
 * every row written while on (their URL then lives only in urlEnc), so this is
 * flipped per-env, deliberately, per the design doc's phase-4 preconditions.
 * Any other value = OFF (unrecognized == the safe direction).
 */
export function calendarUrlContractEnabled(): boolean {
  return process.env.CALENDAR_URL_CONTRACT_ENABLED === "1";
}
