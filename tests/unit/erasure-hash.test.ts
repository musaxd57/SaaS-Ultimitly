import { describe, it, expect } from "vitest";
import {
  tombstoneKeyHash,
  normalizeTombstoneValue,
  buildTombstoneKeys,
} from "@/lib/erasure";

const ORG = "org_test_1";

// Tombstone hashing invariants: deterministic (lookups must re-derive), format-
// normalized (the same real-world identifier always matches), versioned,
// tenant-domain-separated, and NEVER reversible/containing the raw value.
describe("erasure tombstone hashing", () => {
  it("same email in different case/spacing hashes identically; different emails differ; v1-prefixed hex", () => {
    const a = tombstoneKeyHash(ORG, "guest_email", "Ada.Lovelace@Example.COM ");
    const b = tombstoneKeyHash(ORG, "guest_email", "ada.lovelace@example.com");
    const c = tombstoneKeyHash(ORG, "guest_email", "grace.hopper@example.com");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^v1:[0-9a-f]{64}$/); // versioned HMAC-SHA256 hex — no raw value survives
    // Assert the raw value doesn't survive using a needle with NON-hex characters
    // ("lovelace" → l,o,v ∉ [0-9a-f]) so it can never collide with the digest. An
    // earlier `not.toContain("ada")` was fragile: "ada" is valid hex and can appear
    // in a digest by chance.
    expect(a).not.toContain("lovelace");
  });

  it("same phone in different formatting hashes identically (digits-only normalize)", () => {
    const a = tombstoneKeyHash(ORG, "guest_phone", "+90 (555) 123-45-67");
    const b = tombstoneKeyHash(ORG, "guest_phone", "905551234567");
    expect(a).toBe(b);
  });

  it("junk-short phone numbers are rejected (collision safety)", () => {
    expect(normalizeTombstoneValue("guest_phone", "12345")).toBeNull();
    expect(tombstoneKeyHash(ORG, "guest_phone", "123")).toBeNull();
  });

  it("the SAME raw value under DIFFERENT key types produces different hashes (type-domain separation)", () => {
    const asRef = tombstoneKeyHash(ORG, "source_reference", "value-x");
    const asGuest = tombstoneKeyHash(ORG, "guest_external_id", "value-x");
    expect(asRef).not.toBe(asGuest);
  });

  it("the SAME identifier in DIFFERENT tenants produces different hashes (org-domain separation)", () => {
    const inA = tombstoneKeyHash("org_a", "guest_email", "ada@example.com");
    const inB = tombstoneKeyHash("org_b", "guest_email", "ada@example.com");
    expect(inA).not.toBe(inB); // a leaked table can never be correlated across tenants
  });

  it("buildTombstoneKeys skips empty/weak identifiers and keeps the usable ones", () => {
    const keys = buildTombstoneKeys(ORG, {
      sourceReference: "res-1",
      guestExternalId: null,
      guestEmail: "  ",
      guestPhone: "555",
    });
    expect(keys).toHaveLength(1);
    expect(keys[0].keyType).toBe("source_reference");
  });
});
