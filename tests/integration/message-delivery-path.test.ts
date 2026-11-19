import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty, PROPERTY_EXISTED_BEFORE } from "../helpers/db";
import { FakeOutboundProvider } from "../helpers/fake-channel";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// GİDEN MESAJIN TESLİM YOLU (`Message.deliveryPath`, migration 98 — Codex 11-17 / kurucu 11-18). Gerçek PostgreSQL + gerçek rota çözümü
// (`sendOnChannel` mock'lanmaz; sağlayıcı fake'i). Bizim yazdığımız giden satır yolunu taşır: dış kanala doğrudan → "direct", kalıcı kuyruk →
// "queue", iç QR → "qr", hedef yok → "local". Kanaldan EŞİTLENEN giden satır NULL kalır. Teslim SONUCU değildir — yalnız yol.
// (QR misafir rotası, QR ev sahibi cevabı / "yeniden etkinleştir" işareti, otomatik cevap ve kapanış nezaketi kendi test dosyalarında pinli.)
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
import { POST as replyRoute } from "@/app/api/conversations/[id]/reply/route";
import { importCanonicalThread } from "@/lib/ingest/write-service";
import type { CanonicalReservation } from "@/lib/channels/ingest";
import { DELIVERY_PATHS, deliveryPathOfLocalOutcome, isDeliveryPath } from "@/lib/delivery-path";
import { DEMO_ORG_ID } from "@/lib/demo-tenant/constants";

const fake = new FakeOutboundProvider();

async function seed(conv: { channel: string; externalReservationId: string | null }) {
  // Kanalı olmayan konuşmaya yazma yalnız DEMO hesabında yaşar (başka hesapta "İç kayıt" — `lib/internal-record.ts`).
  const { orgId, propertyId } =
    conv.externalReservationId === null
      ? await (async () => {
          await prisma.organization.create({ data: { id: DEMO_ORG_ID, name: "Demo" } });
          const p = await prisma.property.create({ data: { organizationId: DEMO_ORG_ID, createdAt: PROPERTY_EXISTED_BEFORE, name: "Lale Demo" } });
          return { orgId: DEMO_ORG_ID, propertyId: p.id };
        })()
      : await makeOrgWithProperty();
  session = { userId: "u1", organizationId: orgId, role: "owner", email: "o@t.com", name: "Owner", sessionEpoch: 0 } as SessionPayload;
  const conversation = await prisma.conversation.create({
    data: { propertyId, channel: conv.channel, guestIdentifier: "Alex", status: "waiting", externalReservationId: conv.externalReservationId },
  });
  if (conv.externalReservationId) fake.registerReservation(conv.externalReservationId, "tok-A");
  return { orgId, propertyId, conversationId: conversation.id };
}

async function reply(conversationId: string, body = "Havlular dolapta.") {
  const res = await replyRoute(
    new NextRequest(`http://localhost/api/conversations/${conversationId}/reply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body, senderName: "Owner" }),
    }),
    { params: Promise.resolve({ id: conversationId }) },
  );
  return res.status;
}

const outboundPaths = async (conversationId: string) =>
  (await prisma.message.findMany({ where: { conversationId, direction: "outbound" }, select: { deliveryPath: true } })).map((m) => m.deliveryPath);

beforeEach(async () => {
  await resetDb();
  __resetRateLimit();
  fake.reset();
  vi.unstubAllEnvs();
  tokenFor.mockResolvedValue("tok-A");
  __setOutboundAdapterForTest("hospitable", fake.adapter());
});
afterEach(() => {
  __setOutboundAdapterForTest("hospitable", null);
  vi.unstubAllEnvs();
});

describe("ev sahibi cevabı (`sendHostMessage`) — satır yolunu taşır", () => {
  it("🚨 KIRMIZI-ÖNCE: kanala bağlı konuşma, doğrudan gönderim → 'direct'", async () => {
    const { conversationId } = await seed({ channel: "airbnb", externalReservationId: "res-dp" });
    expect(await reply(conversationId)).toBe(201);
    expect(fake.deliveries).toHaveLength(1);
    expect(await outboundPaths(conversationId)).toEqual(["direct"]);
  });

  it("🚨 kanal hedefi olmayan konuşma → 'local' (misafire hiçbir kanaldan gitmedi)", async () => {
    const { conversationId } = await seed({ channel: "airbnb", externalReservationId: null });
    expect(await reply(conversationId)).toBe(201);
    expect(await outboundPaths(conversationId)).toEqual(["local"]);
  });

  it("🚨 iç QR konuşması → 'qr'", async () => {
    const { conversationId } = await seed({ channel: "chat", externalReservationId: "qr-chat:abc" });
    expect(await reply(conversationId)).toBe(201);
    expect(await outboundPaths(conversationId)).toEqual(["qr"]);
  });

  it("🚨 kalıcı kuyruk açık, kanala bağlı → 'queue' (satır kuyruk satırıyla aynı işlemde yazılır)", async () => {
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", "*");
    const { conversationId } = await seed({ channel: "airbnb", externalReservationId: "res-dpq" });
    expect(await reply(conversationId)).toBe(202);
    expect(await prisma.messageOutbox.count({ where: { conversationId } })).toBe(1);
    expect(await outboundPaths(conversationId)).toEqual(["queue"]);
  });

  it("KONTROL: kuyruk açık ama hedef yok → kuyruğa girmez, 'local'", async () => {
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", "*");
    const { conversationId } = await seed({ channel: "email", externalReservationId: null });
    expect(await reply(conversationId)).toBe(201);
    expect(await outboundPaths(conversationId)).toEqual(["local"]);
  });
});

describe("kanaldan eşitlenen giden mesaj", () => {
  const thread = (externalId: string): CanonicalReservation => ({
    externalId,
    code: "DPCODE",
    channel: "airbnb",
    status: "confirmed",
    arrivalDate: new Date(Date.now() + 5 * 86_400_000),
    departureDate: new Date(Date.now() + 8 * 86_400_000),
    guest: { externalId: "g-dp", name: "Alex", givenName: "Alex", email: null, phone: null },
    totalAmount: null,
    currency: null,
    conversationExternalId: "conv-dp",
    conversationLanguage: null,
    lastMessageAt: new Date(),
    terminal: false,
  });

  it("🚨 senkronun içe aktardığı giden (ve gelen) satır NULL kalır — bizim yazmadığımız mesaja yol uydurulmaz", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await prisma.$transaction((tx) =>
      importCanonicalThread(
        tx,
        propertyId,
        thread("res-dp-sync"),
        [
          { externalId: "prov-in-1", direction: "inbound", senderName: "Alex", body: "Merhaba", createdAt: new Date(Date.now() - 60_000) },
          { externalId: "prov-out-1", direction: "outbound", senderName: "Ev Sahibi", body: "Hoş geldiniz.", createdAt: new Date() },
        ],
        null,
        { organizationId: orgId, provider: "hospitable", connectionId: null },
      ),
    );
    const rows = await prisma.message.findMany({ select: { direction: true, deliveryPath: true }, orderBy: { createdAt: "asc" } });
    expect(rows).toEqual([
      { direction: "inbound", deliveryPath: null },
      { direction: "outbound", deliveryPath: null },
    ]);
  });
});

describe("kapalı küme (tek kaynak)", () => {
  it("dört değer; yerel rota sonucu → yol", () => {
    expect([...DELIVERY_PATHS]).toEqual(["direct", "queue", "qr", "local"]);
    expect(isDeliveryPath("queue")).toBe(true);
    expect(isDeliveryPath("sent")).toBe(false);
    expect(deliveryPathOfLocalOutcome(null)).toBe("direct");
    expect(deliveryPathOfLocalOutcome("qr_visible")).toBe("qr");
    expect(deliveryPathOfLocalOutcome("local_only")).toBe("local");
  });
});
