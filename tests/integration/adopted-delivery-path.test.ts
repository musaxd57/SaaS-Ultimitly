import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { FakeOutboundProvider } from "../helpers/fake-channel";
import { stayDay } from "../helpers/stay-dates";
import type { SessionPayload } from "@/lib/auth";
import type { CanonicalReservation } from "@/lib/channels/ingest";

// ---------------------------------------------------------------------------
// G1 TUR 2 YENİDEN ÜRETME — B1 DÜZELTMESİNİN TERS SINAMASI (`reconcile-channel.ts`, dev/gates `647ae3b0`).
// Düzeltmenin dayanağı: "Başka bir LİXUS gönderimi ya kuyruk satırında ya teslim yolu dolu satırda durur." Doğrudan yolda gönderim
// BAŞARILI olur ama senkron yanıt beklenirken mesajı içe almışsa kayıt tekil dizine çarpar (P2002) ve var olan satır "benimsenir"
// (`host-send.ts` yakalama dalı) — benimsenen satırın `deliveryPath`i NULL kalır. Aynı dal otomatik cevapta ve nezaket mesajında da var.
// Bu test yalnız sözleşme ihlalini gösterir: Lixus'un gönderdiği mesaj "kanaldan eşitlendi" (yol NULL) görünür.
// ---------------------------------------------------------------------------

const { tokenFor } = vi.hoisted(() => ({
  tokenFor: vi.fn<(orgId: string) => Promise<string | null>>(async () => "tok-A"),
}));
vi.mock("@/lib/hospitable-credentials", () => ({
  getOrgHospitableToken: tokenFor,
  handleProviderAuthFailure: vi.fn(async () => {}),
}));
vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) },
}));
let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { __setOutboundAdapterForTest } from "@/lib/channels";
import { __resetRateLimit } from "@/lib/rate-limit";
import { importCanonicalThread } from "@/lib/ingest/write-service";
import { POST as replyRoute } from "@/app/api/conversations/[id]/reply/route";

const fake = new FakeOutboundProvider();
const RES = "res-g1-t2-adopt";
const BODY = "Havluları getiriyoruz.";

function canonical(): CanonicalReservation {
  return {
    externalId: RES, code: "T2A", channel: "airbnb", status: "confirmed", arrivalDate: stayDay(1), departureDate: stayDay(4),
    guest: { externalId: "g-t2", name: "Alex", givenName: "Alex", email: null, phone: null }, totalAmount: null, currency: null,
    conversationExternalId: "conv-t2", conversationLanguage: null, lastMessageAt: new Date(), terminal: false,
  };
}

describe("(G1 11-19 T2-B5) benimsenen (senkronun önce yazdığı) cevap satırının teslim yolu", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    fake.reset();
    tokenFor.mockResolvedValue("tok-A");
  });
  afterEach(() => {
    __setOutboundAdapterForTest("hospitable", null);
    vi.unstubAllEnvs();
  });

  it("KONTROL (yeşil): olağan doğrudan gönderimde satırın yolu 'direct'", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    session = { userId: "u1", organizationId: orgId, role: "owner", email: "o@t.com", name: "Owner", sessionEpoch: 0 } as SessionPayload;
    const c = await prisma.conversation.create({ data: { propertyId, channel: "airbnb", guestIdentifier: "Alex", status: "waiting", externalReservationId: RES } });
    fake.registerReservation(RES, "tok-A");
    __setOutboundAdapterForTest("hospitable", fake.adapter());
    const res = await replyRoute(
      new NextRequest(`http://localhost/api/conversations/${c.id}/reply`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body: BODY, senderName: "Owner" }) }),
      { params: Promise.resolve({ id: c.id }) },
    );
    expect(res.status).toBe(201);
    expect((await prisma.message.findFirstOrThrow({ where: { conversationId: c.id, direction: "outbound" } })).deliveryPath).toBe("direct");
  });

  it("🚨 senkron yanıt beklenirken mesajı içe aldıysa benimsenen satırın yolu 'direct' (eski: NULL — 'kanaldan eşitlendi' gibi)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    session = { userId: "u1", organizationId: orgId, role: "owner", email: "o@t.com", name: "Owner", sessionEpoch: 0 } as SessionPayload;
    const c = await prisma.conversation.create({ data: { propertyId, channel: "airbnb", guestIdentifier: "Alex", status: "waiting", externalReservationId: RES } });
    fake.registerReservation(RES, "tok-A");
    const real = fake.adapter();
    __setOutboundAdapterForTest("hospitable", {
      ...real,
      send: async (destination, body, credential) => {
        const out = await real.send(destination, body, credential); // kanal kabul etti (kimlik döndü)
        const d = fake.deliveries[0]!;
        await prisma.$transaction((tx) =>
          importCanonicalThread(tx, propertyId, canonical(), [{ externalId: d.providerMessageId, direction: "outbound", senderName: "Owner", body: d.body, createdAt: d.at }], null, {
            organizationId: orgId,
            provider: "hospitable",
            connectionId: null,
          }),
        );
        return out;
      },
    });
    const res = await replyRoute(
      new NextRequest(`http://localhost/api/conversations/${c.id}/reply`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body: BODY, senderName: "Owner" }) }),
      { params: Promise.resolve({ id: c.id }) },
    );
    expect(res.status).toBe(201);
    const rows = await prisma.message.findMany({ where: { conversationId: c.id, direction: "outbound" }, select: { externalId: true, deliveryPath: true } });
    expect(rows).toHaveLength(1); // benimsendi (çift satır yok)
    expect(rows[0]!.deliveryPath).toBe("direct"); // gerçek: null
  });
});
