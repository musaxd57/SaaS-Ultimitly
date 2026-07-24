import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// Codex #7: photo-folder cleanup during account erasure swallowed FS errors
// entirely — the user was told "deleted" while files could remain on disk with
// nobody ever knowing. The erasure must still SUCCEED (DB rows are gone either
// way), but the leftover must become VISIBLE via reportError.

vi.mock("node:fs/promises", async (orig) => {
  const actual = await orig<typeof import("node:fs/promises")>();
  return { ...actual, rm: vi.fn(async () => { throw new Error("EACCES: permission denied"); }) };
});
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(async () => {}) }));

import { deleteAccountData } from "@/lib/data-retention";
import { reportError } from "@/lib/report-error";
import { rm } from "node:fs/promises";

describe("deleteAccountData — photo cleanup failure visibility", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
  });

  it("erasure still succeeds on an FS failure, but the failure is REPORTED (not swallowed)", async () => {
    const org = await prisma.organization.create({ data: { name: "Silinecek Org" } });

    await expect(deleteAccountData(org.id)).resolves.toBeUndefined();

    // The DB erasure completed…
    expect(await prisma.organization.findUnique({ where: { id: org.id } })).toBeNull();
    // …the cleanup was attempted…
    expect(vi.mocked(rm)).toHaveBeenCalledTimes(1);
    // …and the leftover-files failure is now VISIBLE to the operator.
    expect(vi.mocked(reportError)).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(reportError).mock.calls[0][0])).toContain("photo cleanup");
  });

  it("ChatUsage silme org-delete ile AYNI transaction'da (Codex P3): başarılı erasure'da sayaçlar da gider", async () => {
    const org = await prisma.organization.create({ data: { name: "Sayaçlı Org" } });
    const property = await prisma.property.create({ data: { organizationId: org.id, name: "Daire" } });
    await prisma.chatUsage.create({ data: { propertyId: property.id, day: "2026-07-16", count: 3 } });
    expect(await prisma.chatUsage.count({ where: { propertyId: property.id } })).toBe(1);

    await expect(deleteAccountData(org.id)).resolves.toBeUndefined();

    // Org gitti VE FK'sız ChatUsage de aynı tx içinde temizlendi (tx atomik).
    expect(await prisma.organization.findUnique({ where: { id: org.id } })).toBeNull();
    expect(await prisma.chatUsage.count({ where: { propertyId: property.id } })).toBe(0);
  });
});
