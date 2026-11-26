import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// BİLGİ TABANI YAZMA KANCASI — DAVRANIŞSAL (S1; kaynak taraması `tests/unit/kb-write-hook-pin.test.ts` tek yönlüdür). Ekle / düzenle /
// değişmeyen kaydet / sil / kopyala → `afterKbItemsChanged` DOĞRU işletme + mülk(ler)le çağrılır; Mülk Hafızası gerçekten eşitlenir.
// Kanca gerçek fonksiyonuyla çalışır (yalnız izlenir).
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/kb/after-change", async (orig) => {
  const actual = await orig<typeof import("@/lib/kb/after-change")>();
  return { afterKbItemsChanged: vi.fn(actual.afterKbItemsChanged) };
});

import { POST as CREATE } from "@/app/api/kb/route";
import { PATCH, DELETE } from "@/app/api/kb/[id]/route";
import { POST as COPY } from "@/app/api/kb/[id]/copy/route";
import { afterKbItemsChanged } from "@/lib/kb/after-change";

const json = (url: string, method: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}),
  });
const ctxFor = (id: string) => ({ params: Promise.resolve({ id }) });
const hook = vi.mocked(afterKbItemsChanged);

describe("bilgi tabanı yazma kancası", () => {
  let orgId: string;
  let propertyId: string;
  beforeEach(async () => {
    await resetDb();
    hook.mockClear();
    ({ orgId, propertyId } = await makeOrgWithProperty());
    session = { userId: "u", organizationId: orgId, role: "owner", email: "o@x.com", name: "O" } as SessionPayload;
  });

  it("ekle → düzenle → değişmeyen kaydet → sil: her biri kancayı o mülkle çağırır; hafıza kalemi silinince retired", async () => {
    const created = await CREATE(json("/api/kb", "POST", { propertyId, category: "parking", title: "Otopark", content: "Otopark ücretsizdir." }), {
      params: Promise.resolve({}),
    } as never);
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    expect(hook).toHaveBeenLastCalledWith({ organizationId: orgId, propertyIds: [propertyId] });
    expect(await prisma.propertyMemory.count({ where: { propertyId, source: "kb_item", sourceRef: id } })).toBe(1);

    expect((await PATCH(json(`/api/kb/${id}`, "PATCH", { content: "Otopark ücretsizdir, 2 araç." }), ctxFor(id))).status).toBe(200);
    expect((await PATCH(json(`/api/kb/${id}`, "PATCH", { content: "Otopark ücretsizdir, 2 araç." }), ctxFor(id))).status).toBe(200);
    expect((await DELETE(json(`/api/kb/${id}`, "DELETE"), ctxFor(id))).status).toBe(200);
    expect(hook).toHaveBeenCalledTimes(4);
    for (const call of hook.mock.calls) expect(call[0]).toEqual({ organizationId: orgId, propertyIds: [propertyId] });
    expect(await prisma.propertyMemory.findFirst({ where: { propertyId, sourceRef: id }, select: { status: true } })).toMatchObject({ status: "retired" });
  });

  it("kopyala → hedef mülklerin hepsiyle TEK çağrı; hedef yoksa da zararsız (boş liste)", async () => {
    const item = await prisma.knowledgeBaseItem.create({ data: { propertyId, category: "wifi", title: "Wi-Fi", content: "Ağ LaleNet", isActive: true } });
    const t1 = await prisma.property.create({ data: { organizationId: orgId, name: "Daire 2", checkInTime: "15:00", checkOutTime: "11:00" } });
    const t2 = await prisma.property.create({ data: { organizationId: orgId, name: "Daire 3", checkInTime: "15:00", checkOutTime: "11:00" } });
    expect((await COPY(json(`/api/kb/${item.id}/copy`, "POST", { targetPropertyIds: [t1.id, t2.id] }), ctxFor(item.id))).status).toBe(200);
    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook.mock.calls[0][0].organizationId).toBe(orgId);
    expect([...hook.mock.calls[0][0].propertyIds].sort()).toEqual([t1.id, t2.id].sort());
  });
});
