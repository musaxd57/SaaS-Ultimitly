import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty, PROPERTY_EXISTED_BEFORE } from "../helpers/db";
import { FakeOutboundProvider } from "../helpers/fake-channel";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Codex 11-17 C1 — "Mesaj gönderildi" ≠ kanala gitti. "Yeni konuşma" ile açılan (kanal hedefi olmayan) konuşmada ev sahibinin cevabı
// HİÇBİR kanala gitmez (`resolveOutboundRoute` → local), ama rota gerçek kanal teslimiyle AYNI 201 yanıtını veriyordu; ekran "Mesaj
// gönderildi." diyordu. Artık her başarılı yanıt bir `delivery` sonucu taşır (`DeliveryOutcome`). `sendOnChannel` MOCK'LANMAZ: gerçek
// rota çözümü + ortak sağlayıcı fake'i (sağlayıcıya ulaşan deneme sayısı gerçeğin kendisi).
//
// 🚨 11-18 akşam (kurucu: "'Gönder' yalnız gerçek bir alıcı varsa görünür … eski yerel kayıtlar 'İç kayıt' olarak korunur"): alıcısı olmayan
// kayda cevap artık YAZILMAZ — rota reddeder (409 `internal_record`), hiçbir satır oluşmaz (`lib/internal-record.ts`). "Kaydedildi,
// gönderilmedi" (`local_only`) sonucu yalnız DEMO hesabında kalır (kurgusal veri; ürünü göstermek için yazma akışı orada çalışır).
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
import { DEMO_ORG_ID } from "@/lib/demo-tenant/constants";
import { INTERNAL_RECORD_NO_SEND_TEXT, isInternalRecord } from "@/lib/internal-record";

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

/** Demo hesabında (muaf) kanal hedefi olmayan konuşma. */
async function seedDemo(channel: string) {
  await prisma.organization.create({ data: { id: DEMO_ORG_ID, name: "Demo" } });
  const property = await prisma.property.create({ data: { organizationId: DEMO_ORG_ID, createdAt: PROPERTY_EXISTED_BEFORE, name: "Lale Demo" } });
  session = { userId: "u-demo", organizationId: DEMO_ORG_ID, role: "owner", email: "d@t.com", name: "Demo", sessionEpoch: 0 } as SessionPayload;
  const conversation = await prisma.conversation.create({
    data: { propertyId: property.id, channel, guestIdentifier: "Alex", status: "waiting", externalReservationId: null },
  });
  return { conversationId: conversation.id };
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

  it("🚨 alıcısı olmayan kayıt (elle açılmış, 'Airbnb' seçilmiş) → 409 'internal_record': HİÇBİR şey yazılmaz, sağlayıcıya SIFIR deneme", async () => {
    const { conversationId } = await seed({ channel: "airbnb", externalReservationId: null });
    const before = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    const r = await reply(conversationId);
    expect(r.status).toBe(409);
    expect(r.json).toEqual({ error: INTERNAL_RECORD_NO_SEND_TEXT, code: "internal_record" });
    expect(fake.attempts).toHaveLength(0);
    // ⬅️ ESKİDE: cevap "kaydedildi, gönderilmedi" diye saklanıyor ve konuşma "Cevaplandı" oluyordu (kimseye gitmeyen bir cevap satırı).
    expect(await prisma.message.count({ where: { conversationId } })).toBe(0);
    expect(await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).toEqual(before);
  });

  it("KONTROL — DEMO hesabı muaf: kanal hedefi olmayan konuşmada cevap bugünkü gibi kaydedilir → 201 + delivery 'local_only'", async () => {
    const { conversationId } = await seedDemo("airbnb");
    const r = await reply(conversationId);
    expect(r.status).toBe(201);
    expect(r.json.delivery).toBe("local_only");
    expect(fake.attempts).toHaveLength(0);
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

  it("KONTROL — kalıcı kuyruk açık ama hedef yok → kuyruğa girmez: demo hesabında 201 + 'local_only', başka hesapta 409 (ret kuyruktan önce)", async () => {
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", "*");
    const demo = await seedDemo("email");
    const r = await reply(demo.conversationId);
    expect(r.status).toBe(201);
    expect(r.json.delivery).toBe("local_only");
    const other = await seed({ channel: "email", externalReservationId: null });
    expect((await reply(other.conversationId)).status).toBe(409);
    expect(await prisma.messageOutbox.count()).toBe(0);
  });
});

describe("iç kayıt yüklemi (tek kural, gönderimle aynı rota çözümü)", () => {
  it("kanal kimliği yok → iç kayıt; kanal konuşması ve iç QR sohbeti değil; demo hesabı muaf", () => {
    expect(isInternalRecord({ externalReservationId: null }, "org-1")).toBe(true);
    expect(isInternalRecord({ externalReservationId: "" }, "org-1")).toBe(true);
    expect(isInternalRecord({}, "org-1")).toBe(true);
    expect(isInternalRecord({ externalReservationId: "res-1" }, "org-1")).toBe(false);
    expect(isInternalRecord({ externalReservationId: "qr-chat:abc" }, "org-1")).toBe(false);
    expect(isInternalRecord({ externalReservationId: null }, DEMO_ORG_ID)).toBe(false);
  });
});
