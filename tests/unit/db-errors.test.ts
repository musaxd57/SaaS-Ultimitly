import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { isUniqueViolation } from "@/lib/db-errors";

// Codex rule: a dedupe-hit catch must recognize ONLY the constraint it targets —
// any other P2002 (or any other error) must keep propagating.

function p2002(target: unknown) {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "6.2.1",
    meta: { target },
  });
}

describe("isUniqueViolation", () => {
  it("matches the exact column set (array form)", () => {
    expect(isUniqueViolation(p2002(["conversationId", "externalId"]), ["conversationId", "externalId"])).toBe(true);
    expect(isUniqueViolation(p2002(["externalId", "conversationId"]), ["conversationId", "externalId"])).toBe(true);
  });

  it("REJECTS a different unique constraint (never swallow foreign P2002s)", () => {
    expect(isUniqueViolation(p2002(["propertyId", "sourceReference"]), ["conversationId", "externalId"])).toBe(false);
    expect(isUniqueViolation(p2002(["conversationId"]), ["conversationId", "externalId"])).toBe(false); // subset ≠ match
  });

  it("tolerates the index-name string form", () => {
    expect(isUniqueViolation(p2002("Message_conversationId_externalId_key"), ["conversationId", "externalId"])).toBe(true);
    expect(isUniqueViolation(p2002("Reservation_propertyId_sourceReference_key"), ["conversationId", "externalId"])).toBe(false);
  });

  it("rejects non-P2002 and non-Prisma errors", () => {
    const other = new Prisma.PrismaClientKnownRequestError("fk", { code: "P2003", clientVersion: "6.2.1", meta: {} });
    expect(isUniqueViolation(other, ["conversationId", "externalId"])).toBe(false);
    expect(isUniqueViolation(new Error("P2002"), ["conversationId", "externalId"])).toBe(false);
  });
});
