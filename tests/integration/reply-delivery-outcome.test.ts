import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { FakeOutboundProvider } from "../helpers/fake-channel";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Codex 11-17 C1 — "Mesaj gönderildi" ≠ kanala gitti. "Yeni konuşma" ile açılan (kanal hedefi olmayan) konuşmada ev sahibinin cevabı
// HİÇBİR kanala gitmez (`resolveOutboundRoute` → local), ama rota gerçek kanal teslimiyle AYNI 201 yanıtını veriyordu; ekran "Mesaj
// gönderildi." diyordu. Artık her başarılı yanıt bir `delivery` sonucu taşır (`DeliveryOutcome`). `sendOnChannel` MOCK'LANMAZ: gerçek
// rota çözümü + ortak sağlayıcı fake'i (sağlayıcıya ulaşan deneme sayısı gerçeğin kendisi).
//
// 🚨 DAVRANIŞ DEĞİŞMEZ (kurucu sorusu S-1…S-4): yerel cevap bugünkü gibi kaydedilir ve konuşmayı "Cevaplandı" yapar — yalnız yanıt dürüst.
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

const fake = new FakeOutboundProvider();

async function seed(conv: { channel: string; externalReservationId: string | null }) {
  const { orgId, propertyId } = await makeOrgWithProperty();
  session = { userId: "u1", organizationId: orgId, role: "owner", email: "o@t.com", name: "Owner", sessionEpoch: 0 } as SessionPayload;
  const conversation = await prisma.conversation.create({
    data: { propertyId, channel: conv.channel, guestIdentifier: "Alex", status: "waiting", externalReservationId: conv.externalReservationId },
  });
  if (conv.externalReservationId) fake.registerReservation(conv.externalReservationId, "tok-A");
  return { orgId, conversationId: conversation.id };
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
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe("C1 — cevap yanıtı teslim sonucunu taşır (gerçek rota çözümü)", () => {
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

  it("🚨 kanal hedefi olmayan konuşma (elle açılmış, 'Airbnb' seçilmiş) → 201 + delivery 'local_only', sağlayıcıya SIFIR deneme", async () => {
    const { conversationId } = await seed({ channel: "airbnb", externalReservationId: null });
    const r = await reply(conversationId);
    expect(r.status).toBe(201);
    expect(r.json.delivery).toBe("local_only");
    expect(fake.attempts).toHaveLength(0);
    // Davranış BUGÜNKÜ GİBİ (ürün kararı S-1 bekliyor): cevap kaydedilir, konuşma "Cevaplandı".
    expect(await prisma.message.count({ where: { conversationId, direction: "outbound", authorType: "host" } })).toBe(1);
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).status).toBe("answered");
  });

  it("KONTROL — kanala bağlı konuşma → 201 + delivery 'channel_accepted', sağlayıcıya 1 teslim", async () => {
    const { conversationId } = await seed({ channel: "airbnb", externalReservationId: "res-c1" });
    const r = await reply(conversationId);
    expect(r.status).toBe(201);
    expect(r.json.delivery).toBe("channel_accepted");
    expect(r.json.id).toEqual(expect.any(String)); // mesaj alanları yanıtta kalır (geriye uyum)
    expect(fake.deliveries).toHaveLength(1);
  });

  it("KONTROL — iç QR konuşması → 201 + delivery 'qr_visible' (misafir sohbet sayfasında görür), sağlayıcıya deneme yok", async () => {
    const { conversationId } = await seed({ channel: "qr", externalReservationId: "qr-chat:abc" });
    const r = await reply(conversationId);
    expect(r.status).toBe(201);
    expect(r.json.delivery).toBe("qr_visible");
    expect(fake.attempts).toHaveLength(0);
  });

  it("KONTROL — kalıcı kuyruk açık, kanala bağlı → 202 + delivery 'queued' (outbox.delivery bugünkü gibi 'pending')", async () => {
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", "*");
    const { conversationId } = await seed({ channel: "airbnb", externalReservationId: "res-c1q" });
    const r = await reply(conversationId);
    expect(r.status).toBe(202);
    expect(r.json.delivery).toBe("queued");
    expect(r.json.outbox).toMatchObject({ status: "queued", deduped: false, delivery: "pending" });
  });

  it("KONTROL — kalıcı kuyruk açık ama hedef yok → kuyruğa girmez, 201 + 'local_only' (bugünkü yol)", async () => {
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", "*");
    const { conversationId } = await seed({ channel: "email", externalReservationId: null });
    const r = await reply(conversationId);
    expect(r.status).toBe(201);
    expect(r.json.delivery).toBe("local_only");
    expect(await prisma.messageOutbox.count()).toBe(0);
  });
});
