import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { POST as CREATE } from "@/app/api/kb/route";
import { planLimitsFor } from "@/lib/billing/plan-limits";

// ---------------------------------------------------------------------------
// KB istek kimliği — eş zamanlı iki yeniden denemenin plan sınırındaki yarışı (Haiku 10-14). AYRI DOSYA: Prisma temsilcisine casus
// sonraki testlere sızar (CLAUDE.md çalışma dersi). Yarış belirlenimli kurulur: ilk "var mı?" okuması boş döner (öteki deneme henüz
// yazmamış), kalem ise sayım anında VAR (öteki deneme arada yazdı) → sınır dolu görünür. Beklenen: sınır hatası DEĞİL, o kalem döner.
// ---------------------------------------------------------------------------

const RID = "d4c3b2a1f0e9d8c7b6a5948372615049";
const createReq = (body: unknown) =>
  new NextRequest("http://localhost/api/kb", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

describe("KB istek kimliği — plan sınırında eş zamanlı deneme", () => {
  let propertyId: string;
  beforeEach(async () => {
    await resetDb();
    const made = await makeOrgWithProperty();
    propertyId = made.propertyId;
    session = { userId: "u", organizationId: made.orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("🚨 ilk okuma boş, sayımda sınır dolu (öteki deneme yazdı) → 200 + o kalem, sınır hatası yok", async () => {
    const limit = planLimitsFor("business").kbItemsPerProperty;
    for (let i = 0; i < limit - 1; i++) {
      await prisma.knowledgeBaseItem.create({ data: { propertyId, title: `k${i}`, content: "x".repeat(10), isActive: true } });
    }
    // Öteki denemenin yazdığı kalem (sınır şimdi dolu).
    const winner = await prisma.knowledgeBaseItem.create({
      data: { propertyId, category: "wifi", title: "Wi-Fi", content: "Ağ adı: Lale_5G.", isActive: true, clientRequestId: RID },
    });
    const real = prisma.knowledgeBaseItem.findUnique.bind(prisma.knowledgeBaseItem);
    let calls = 0;
    vi.spyOn(prisma.knowledgeBaseItem, "findUnique").mockImplementation(((args: never) => {
      calls++;
      return calls === 1 ? Promise.resolve(null) : real(args);
    }) as never);
    const res = await CREATE(
      createReq({ propertyId, category: "wifi", title: "Wi-Fi", content: "Ağ adı: Lale_5G.", isActive: true, requestId: RID }),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { id: string }).id).toBe(winner.id);
    expect(await prisma.knowledgeBaseItem.count({ where: { propertyId } })).toBe(limit);
  });
});
