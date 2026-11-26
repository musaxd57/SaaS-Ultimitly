import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// 🚨 GÖLGE KAYIT GÖNDERİMİ BOZMAZ (kurucu 11-13, taslak ↔ gönderilen metin bağı): bağ yazımı patlasa da misafire giden mesaj gönderilmiş ve
// kaydedilmiştir; rota 201 döner, arıza yalnız raporlanır. Servis bu dosyada taklit edilir (Prisma temsilcisine casus kurmak sonraki testlere
// sızardı — CLAUDE.md).
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/messaging", async (orig) => ({
  ...(await orig<typeof import("@/lib/messaging")>()),
  sendOnChannel: vi.fn(async () => ({ ok: true, id: "sent-1" })),
}));
vi.mock("@/lib/hospitable-credentials", () => ({ getOrgHospitableToken: vi.fn(async () => "tok") }));
const record = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@/lib/reply-draft/service", () => ({ recordReplyDraftLink: record.fn }));
const report = vi.hoisted(() => ({ fn: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/report-error", () => ({ reportError: report.fn }));

import { POST } from "@/app/api/conversations/[id]/reply/route";

describe("taslak bağı arızası gönderimi bozmaz", () => {
  let conversationId: string;
  let orgId: string;
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    orgId = (await prisma.organization.create({ data: { name: "Org" } })).id;
    const property = await prisma.property.create({ data: { organizationId: orgId, name: "Lale 5" } });
    conversationId = (
      await prisma.conversation.create({
        data: { propertyId: property.id, guestIdentifier: "Deniz", channel: "airbnb", externalReservationId: "res-1", status: "waiting" },
      })
    ).id;
    session = { userId: "u", organizationId: orgId, role: "owner", email: "o@x.com", name: "Owner", sessionEpoch: 0 };
  });

  const send = (body: unknown) =>
    POST(new NextRequest(`http://localhost/api/conversations/${conversationId}/reply`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), {
      params: Promise.resolve({ id: conversationId }),
    });

  it("bağ yazımı fırlatırsa: 201, mesaj kayıtlı, arıza raporlandı", async () => {
    record.fn.mockRejectedValueOnce(new Error("db down"));
    const res = await send({ body: "Merhaba", draftUse: "seeded" });
    expect(res.status).toBe(201);
    expect(await prisma.message.count({ where: { conversationId, direction: "outbound" } })).toBe(1);
    expect(report.fn).toHaveBeenCalledWith("reply-draft.link", expect.any(Error));
  });

  it("ipucu eşlemesi: seeded → seeded, aiAssisted / approved → approved, ipucu yok → null; 'code' → hiç çağrılmaz; misafire giden metin geçer", async () => {
    record.fn.mockResolvedValue("recorded");
    await send({ body: "A", draftUse: "seeded" });
    await send({ body: "B", aiAssisted: true });
    await send({ body: "C" });
    await send({ body: "D", draftUse: "code" });
    expect(record.fn.mock.calls.map((c) => [c[0].sentBody, c[0].draftUse])).toEqual([
      ["A", "seeded"],
      ["B", "approved"],
      ["C", null],
    ]);
    expect(record.fn.mock.calls[0][0]).toMatchObject({ organizationId: orgId, conversationId });
  });

  it("gönderim başarısızsa bağ çağrılmaz", async () => {
    const { sendOnChannel } = await import("@/lib/messaging");
    vi.mocked(sendOnChannel).mockResolvedValueOnce({ ok: false, error: "Hospitable HTTP 400 (bad_request)" } as never);
    const res = await send({ body: "X", draftUse: "seeded" });
    expect(res.status).toBe(502);
    expect(record.fn).not.toHaveBeenCalled();
  });
});
