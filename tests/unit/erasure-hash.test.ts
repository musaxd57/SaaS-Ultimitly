import { describe, it, expect } from "vitest";
import {
  tombstoneKeyHash,
  normalizeTombstoneValue,
  buildTombstoneKeys,
} from "@/lib/erasure";

// Tombstone hashing invariants: deterministic (lookups must re-derive), format-
// normalized (the same real-world identifier always matches), and NEVER
// reversible/containing the raw value (the whole point is storing no PII).
describe("erasure tombstone hashing", () => {
  it("same email in different case/spacing hashes identically; different emails differ", () => {
    const a = tombstoneKeyHash("guest_email", "Ada.Lovelace@Example.COM ");
    const b = tombstoneKeyHash("guest_email", "ada.lovelace@example.com");
    const c = tombstoneKeyHash("guest_email", "grace.hopper@example.com");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/); // HMAC-SHA256 hex — no raw value survives
    expect(a).not.toContain("ada");
  });

  it("same phone in different formatting hashes identically (digits-only normalize)", () => {
    const a = tombstoneKeyHash("guest_phone", "+90 (555) 123-45-67");
    const b = tombstoneKeyHash("guest_phone", "905551234567");
    expect(a).toBe(b);
  });

  it("junk-short phone numbers are rejected (collision safety)", () => {
    expect(normalizeTombstoneValue("guest_phone", "12345")).toBeNull();
    expect(tombstoneKeyHash("guest_phone", "123")).toBeNull();
  });

  it("the SAME raw value under DIFFERENT key types produces different hashes (type-domain separation)", () => {
    const asRef = tombstoneKeyHash("source_reference", "value-x");
    const asGuest = tombstoneKeyHash("guest_external_id", "value-x");
    expect(asRef).not.toBe(asGuest);
  });

  it("buildTombstoneKeys skips empty/weak identifiers and keeps the usable ones", () => {
    const keys = buildTombstoneKeys({
      sourceReference: "res-1",
      guestExternalId: null,
      guestEmail: "  ",
      guestPhone: "555",
    });
    expect(keys).toHaveLength(1);
    expect(keys[0].keyType).toBe("source_reference");
  });
});
