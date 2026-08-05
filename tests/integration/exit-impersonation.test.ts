import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// Drive exitImpersonation against a mocked session + cookie layer, real DB.
// NOTE: the factory must not reference top-level spy vars (vi.mock is hoisted) —
// it creates fresh vi.fn()s and we reach them via vi.mocked() after import.
let currentSession: SessionPayload | null = null;
vi.mock("@/lib/auth", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth")>();
  return {
    ...actual,
    getSession: vi.fn(async () => currentSession),
    setSessionCookie: vi.fn(async () => {}),
    clearSessionCookie: vi.fn(async () => {}),
  };
});

import { setSessionCookie, clearSessionCookie } from "@/lib/auth";
import { exitImpersonation, enterOrganization } from "@/lib/admin";

const mockSet = vi.mocked(setSessionCookie);
const mockClear = vi.mocked(clearSessionCookie);

describe("exitImpersonation fail-safe", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    currentSession = null;
  });

  it("clears the session when the operator's own user record is gone (no stuck impersonation)", async () => {
    const custOrg = await prisma.organization.create({ data: { name: "Customer Org" } });
    // Impersonating, but the actor (operator) id does NOT exist in the DB.
    currentSession = {
      userId: "customer-user",
      organizationId: custOrg.id,
      role: "owner",
      email: "customer@x.com",
      name: "Customer",
      sessionEpoch: 0,
      actorUserId: "missing-operator",
      actorEmail: "operator@x.com",
    };

    const result = await exitImpersonation();

    expect(result).toBe(false);
    // Fail-safe: drop to login rather than leave the operator inside the customer org.
    expect(mockClear).toHaveBeenCalledTimes(1);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("restores the operator's own session on a normal exit", async () => {
    const custOrg = await prisma.organization.create({ data: { name: "Customer Org" } });
    const opOrg = await prisma.organization.create({ data: { name: "Operator Org" } });
    const operator = await prisma.user.create({
      data: { organizationId: opOrg.id, name: "Op", email: "op@x.com", passwordHash: "x", role: "owner" },
    });
    currentSession = {
      userId: "customer-user",
      organizationId: custOrg.id,
      role: "owner",
      email: "customer@x.com",
      name: "Customer",
      sessionEpoch: 0,
      actorUserId: operator.id,
      actorEmail: "op@x.com",
    };

    const result = await exitImpersonation();

    expect(result).toBe(true);
    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockClear).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 🚨 `mfa` İDDİASI HER İKİ GEÇİŞTE DE TAŞINIR (08-05).
//
// `enterOrganization` ve `exitImpersonation` payload'ı SIFIRDAN kuruyor. İddia
// taşınmazsa operatör, müşteri org'una girer girmez `isSuperAdmin` false alır —
// ve `api.ts:54` fail-closed olduğu için oturum KOMPLE düşer: operatör ne
// içeride çalışabilir ne org değiştirebilir. Çıkışta taşınmazsa aynı şey kendi
// panelinde olur.
//
// ⚠️ BU TESTLER MUTASYONLA GEREKÇELENDİ: iki taşımayı da tek tek silдим ve
// mevcut 24 testin HİÇBİRİ kırmızıya dönmedi — yani sessiz bir ürün arızasıydı.
// Yükseltme DEĞİL aktarım: iddia zaten o oturumda vardı.
// ---------------------------------------------------------------------------
describe("mfa iddiası impersonation geçişlerinde taşınır", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    currentSession = null;
  });

  async function seedPair() {
    const opOrg = await prisma.organization.create({ data: { name: "Op Org" } });
    const op = await prisma.user.create({
      data: { organizationId: opOrg.id, name: "Op", email: "op@lixusai.com", passwordHash: "x", role: "owner" },
    });
    const custOrg = await prisma.organization.create({ data: { name: "Cust Org" } });
    const cust = await prisma.user.create({
      data: { organizationId: custOrg.id, name: "C", email: "c@x.com", passwordHash: "x", role: "owner" },
    });
    return { op, opOrg, cust, custOrg };
  }

  it("GİRİŞ: enterOrganization iddiayı yeni payload'a taşır", async () => {
    const { op, opOrg, custOrg } = await seedPair();
    const ok = await enterOrganization(
      {
        userId: op.id,
        organizationId: opOrg.id,
        role: "owner",
        email: op.email,
        name: "Op",
        sessionEpoch: 0,
        mfa: true,
      },
      custOrg.id,
    );
    expect(ok).toBe(true);
    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet.mock.calls[0][0].mfa).toBe(true);
  });

  it("ÇIKIŞ: exitImpersonation iddiayı geri taşır", async () => {
    const { op, cust, custOrg } = await seedPair();
    currentSession = {
      userId: cust.id,
      organizationId: custOrg.id,
      role: "owner",
      email: cust.email,
      name: "C",
      sessionEpoch: 0,
      actorUserId: op.id,
      actorEmail: op.email,
      actorName: "Op",
      actorSessionEpoch: 0,
      mfa: true,
    };
    expect(await exitImpersonation()).toBe(true);
    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet.mock.calls[0][0].mfa).toBe(true);
  });

  it("TERS YÖN: iddia YOKSA uydurulmaz (koşulsuz true mutasyonunu yasaklar)", async () => {
    const { op, opOrg, custOrg } = await seedPair();
    await enterOrganization(
      { userId: op.id, organizationId: opOrg.id, role: "owner", email: op.email, name: "Op", sessionEpoch: 0 },
      custOrg.id,
    );
    expect(mockSet.mock.calls[0][0].mfa).toBeUndefined();
  });
});
