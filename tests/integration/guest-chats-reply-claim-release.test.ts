import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// Claude 2. dalga #4 (10-21): QR sohbetinde ev sahibi cevabının yazımı düşerse sahiplenme HEMEN bırakılır — yoksa aynı metinle yeniden
// deneme 120 sn boyunca sahte "az önce gönderildi" (409) alıyor, cevap hiç kaydedilmiyordu. prisma temsilcisine spyOn → AYRI dosya.
let session: SessionPayload | null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { POST } from "@/app/api/guest-chats/[id]/reply/route";

function call(id: string, body: string) {
  const req = new Request(`http://localhost/api/guest-chats/${id}/reply`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body }),
  });
  return POST(req as never, { params: Promise.resolve({ id }) });
}

describe("POST /api/guest-chats/[id]/reply — yazım düşünce sahiplenme bırakılır", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(() => vi.restoreAllMocks());

  it("🚨 ilk deneme yazımda düşer → aynı metinle yeniden deneme 201 (409 değil), cevap TEK kez kaydedilir", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    session = { userId: "u", organizationId: orgId, role: "owner", email: "o@x.com", name: "Ev Sahibi", sessionEpoch: 0 };
    const convo = await prisma.conversation.create({
      data: { propertyId, channel: "chat", guestIdentifier: "Misafir", status: "answered", externalReservationId: `qr-chat:${propertyId}:r1` },
    });
    const spy = vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(new Error("db down (test)"));
    await expect(call(convo.id, "Havlular dolapta.")).rejects.toThrow("db down");
    spy.mockRestore();
    const retry = await call(convo.id, "Havlular dolapta.");
    expect(retry.status).toBe(201);
    expect(await prisma.message.count({ where: { conversationId: convo.id, body: "Havlular dolapta." } })).toBe(1);
  });

  it("KONTROL: başarılı cevabın hemen ardından aynı metin yine 409 (çift tıklama koruması duruyor)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    session = { userId: "u", organizationId: orgId, role: "owner", email: "o@x.com", name: "Ev Sahibi", sessionEpoch: 0 };
    const convo = await prisma.conversation.create({
      data: { propertyId, channel: "chat", guestIdentifier: "Misafir", status: "answered", externalReservationId: `qr-chat:${propertyId}:r2` },
    });
    expect((await call(convo.id, "Havlular dolapta.")).status).toBe(201);
    expect((await call(convo.id, "Havlular dolapta.")).status).toBe(409);
  });
});
