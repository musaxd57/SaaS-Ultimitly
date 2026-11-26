import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// İÇ NOT — veritabanı arızası (dilim D1). Ayrı dosya: Prisma temsilcisi casusu sonraki testlere sızmasın (casus dosya başında BİR kez
// kurulur, `armed` ile açılır). Sabitlenen: yazma / okuma arızası 500 olur ve sessizce "kaydedildi" / "boş liste" gibi görünmez; BAŞKA bir
// tekil dizinin çakışması (P2002, farklı sütunlar) tekrar sayılıp yutulmaz; kendi dizinimizin çakışmasında var olan satır bulunamazsa da
// yutulmaz.
// ---------------------------------------------------------------------------

let session: SessionPayload | null = null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/report-error", async (orig) => ({
  ...(await orig<typeof import("@/lib/report-error")>()),
  reportError: vi.fn(async () => {}),
}));

import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import { GET as listGet, POST as createPost } from "@/app/api/internal-notes/route";

let txFailure: null | (() => Error) = null;
const originalTransaction = prisma.$transaction.bind(prisma) as (...a: unknown[]) => Promise<unknown>;
vi.spyOn(prisma, "$transaction").mockImplementation(((...args: unknown[]) => {
  if (txFailure) return Promise.reject(txFailure());
  return originalTransaction(...args);
}) as never);

let findManyDown = false;
const originalFindMany = prisma.internalNote.findMany.bind(prisma.internalNote);
vi.spyOn(prisma.internalNote, "findMany").mockImplementation(((args: Parameters<typeof originalFindMany>[0]) => {
  if (findManyDown) return Promise.reject(new Error("db down"));
  return originalFindMany(args);
}) as never);

const p2002 = (target: string[]) =>
  new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test", meta: { target } });

const post = (body: unknown) =>
  createPost(
    new NextRequest("http://localhost/api/internal-notes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({}) },
  );

async function world() {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const user = await prisma.user.create({ data: { organizationId: orgId, name: "Sahip", email: `o-${orgId}@x.com`, passwordHash: "x", role: "owner" } });
  const conversation = await prisma.conversation.create({ data: { propertyId, channel: "airbnb", guestIdentifier: "Ada" } });
  session = { userId: user.id, organizationId: orgId, role: "owner", email: user.email, name: user.name, sessionEpoch: 0 };
  return { conversationId: conversation.id };
}

describe("iç not — veritabanı arızası", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
  });
  afterEach(() => {
    txFailure = null;
    findManyDown = false;
  });

  it("yazma arızası → 500, satır yok", async () => {
    const w = await world();
    txFailure = () => new Error("db down");
    expect((await post({ conversationId: w.conversationId, body: "not" })).status).toBe(500);
    txFailure = null;
    expect(await prisma.internalNote.count()).toBe(0);
  });

  it("🚨 BAŞKA tekil dizinin çakışması (P2002, farklı sütunlar) tekrar sayılıp yutulmaz → 500", async () => {
    const w = await world();
    txFailure = () => p2002(["id"]);
    expect((await post({ conversationId: w.conversationId, body: "not", requestId: "a".repeat(32) })).status).toBe(500);
  });

  it("kendi dizinimizin çakışması ama var olan satır okunamıyor (yok) → yutulmaz, 500", async () => {
    const w = await world();
    txFailure = () => p2002(["organizationId", "clientRequestId"]);
    expect((await post({ conversationId: w.conversationId, body: "not", requestId: "b".repeat(32) })).status).toBe(500);
  });

  it("okuma arızası → 500 (boş liste gibi görünmez)", async () => {
    const w = await world();
    findManyDown = true;
    expect((await listGet(new NextRequest(`http://localhost/api/internal-notes?conversationId=${w.conversationId}`), { params: Promise.resolve({}) })).status).toBe(500);
  });
});
