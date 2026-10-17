import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// #189 ISITMA BAĞLANTISI ("yüklem var, argüman yok" dersi): KB yazma rotaları (ekle / düzenle / sil / kopyala) yazdıktan
// sonra O MÜLKÜN vektör ısıtmasını, zamanlanmış senkron da süreç başına açılış ısıtmasını GERÇEKTEN çağırıyor mu. Isıtmanın
// kendisi `kb-vector-warm.test.ts`te.
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
const warmOne = vi.fn();
const warmAll = vi.fn();
vi.mock("@/lib/ai/embeddings/kb-warm", () => ({
  warmPropertyKbVectorsBestEffort: (...a: unknown[]) => warmOne(...a),
  warmAllKbVectorsOnce: (...a: unknown[]) => warmAll(...a),
}));

import { POST as CREATE } from "@/app/api/kb/route";
import { PATCH, DELETE } from "@/app/api/kb/[id]/route";
import { POST as COPY } from "@/app/api/kb/[id]/copy/route";
import { runScheduledSync } from "@/lib/scheduled-sync";

const json = (url: string, method: string, body?: unknown) =>
  new NextRequest(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }), headers: { "content-type": "application/json" } });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const noParams = { params: Promise.resolve({} as Record<string, never>) };

describe("ısıtma bağlantısı", () => {
  let orgId: string;
  let propertyId: string;
  beforeEach(async () => {
    await resetDb();
    warmOne.mockReset();
    warmAll.mockReset();
    ({ orgId, propertyId } = await makeOrgWithProperty());
    await prisma.user.create({ data: { organizationId: orgId, name: "h", email: "h@x.com", passwordHash: "x", role: "owner" } });
    session = { userId: "u1", organizationId: orgId, role: "owner", email: "h@x.com", name: "h", sessionEpoch: 0 };
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("ekle / düzenle / sil: yazılan mülk ısıtılır", async () => {
    const res = await CREATE(json("http://localhost/api/kb", "POST", { propertyId, category: "general", title: "Otopark", content: "Bina altında.", isActive: true }), noParams);
    expect(res.status).toBe(201);
    expect(warmOne).toHaveBeenLastCalledWith(propertyId);
    const id = ((await res.json()) as { id: string }).id;
    warmOne.mockReset();
    expect((await PATCH(json(`http://localhost/api/kb/${id}`, "PATCH", { content: "Bina altında, B2." }), ctx(id))).status).toBe(200);
    expect(warmOne).toHaveBeenLastCalledWith(propertyId);
    warmOne.mockReset();
    expect((await DELETE(json(`http://localhost/api/kb/${id}`, "DELETE"), ctx(id))).status).toBe(200);
    expect(warmOne).toHaveBeenLastCalledWith(propertyId);
  });

  it("kopyala: HEDEF mülk ısıtılır", async () => {
    const other = await prisma.property.create({ data: { organizationId: orgId, name: "Lale 2" } });
    const src = await prisma.knowledgeBaseItem.create({
      data: { propertyId, category: "general", title: "Çöp", content: "Konteyner arkada.", isActive: true, source: "host_manual", reviewState: "approved" },
    });
    const res = await COPY(json(`http://localhost/api/kb/${src.id}/copy`, "POST", { targetPropertyIds: [other.id] }), ctx(src.id));
    expect(res.status).toBe(200);
    expect(warmOne).toHaveBeenCalledWith(other.id);
  });

  it("zamanlanmış senkron: açılış ısıtmasını çağırır", async () => {
    await runScheduledSync();
    expect(warmAll).toHaveBeenCalled();
  });
});
