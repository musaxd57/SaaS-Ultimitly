import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, PROPERTY_EXISTED_BEFORE } from "../helpers/db";
import { FakeOutboundProvider } from "../helpers/fake-channel";
import { createKbWithAutoMessage } from "../helpers/auto-message";
import { stayDay } from "../helpers/stay-dates";
import type { CanonicalMessage, CanonicalReservation } from "@/lib/channels/ingest";

// ---------------------------------------------------------------------------
// G1 YENİDEN ÜRETME (hata ayıklama turu 11-19) — ANAHTAR AÇILINCA (`CHANNEL_SEND_RECONCILE_ENABLED` + `DURABLE_OUTBOX_ENABLED`).
//
// Kuyruktaki YAŞAM DÖNGÜSÜ satırı (karşılama / giriş / çıkış) yerel mesaj taşımaz (`messageId: null` — "senkron sonra içe alır"). Belirsiz
// gönderimden sonra olağan 2 dakikalık senkron kanaldaki mesajı içe alıp YENİ bir yerel mesaja bağlar. Uzlaştırma
// (`reconcile-channel.ts`) "başka kayda ait" kimlikleri toplarken konuşmanın yerel mesajlarına bakar; yaşam döngüsü satırında dışlanacak
// "kendi mesajı" olmadığı için, KENDİ gönderiminin senkronla içe alınmış kopyasını "başka kayıt" sayar → kanalda açıkça görünen mesaj
// hiçbir bakışta doğrulanmaz; satır incelemeye "kanalda görünmüyor" koduyla düşer.
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

import { __setOutboundAdapterForTest } from "@/lib/channels";
import { drainOutboxOnce } from "@/lib/outbox/worker";
import { OUTBOX_MAX_ATTEMPTS } from "@/lib/outbox/state";
import { RECONCILE_CODES } from "@/lib/outbox/reconcile-match";
import { sendDueWelcomes } from "@/lib/automation";
import { importCanonicalThread } from "@/lib/ingest/write-service";

const fake = new FakeOutboundProvider();
const RES = "res-g1-lifecycle-1";

async function seedWelcome() {
  const org = await prisma.organization.create({
    data: { name: "Org", autoWelcome: true, autoWelcomeEnabledAt: new Date(0), aiSignature: "İsa", autoReplyHospitable: true, autoCheckin: true, autoCheckout: true },
  });
  const property = await prisma.property.create({ data: { createdAt: PROPERTY_EXISTED_BEFORE, organizationId: org.id, name: "Lale 3" } });
  await createKbWithAutoMessage({ data: { propertyId: property.id, category: "welcome", title: "K", content: "Merhaba {isim}, hoş geldiniz." } });
  const arrival = stayDay(3);
  const r = await prisma.reservation.create({
    data: {
      propertyId: property.id, guestName: "Bircan", arrivalDate: arrival, departureDate: stayDay(5), channel: "airbnb",
      status: "confirmed", sourceReference: RES,
    },
  });
  fake.registerReservation(RES, "tok-A");
  return { orgId: org.id, propertyId: property.id, reservationId: r.id, arrival };
}

/** Olağan senkronun içe alması: kanaldaki mesaj (bizim teslimimiz) konuşmaya yazılır — gerçek yazma servisi. */
async function syncImports(orgId: string, propertyId: string, reservationId: string, arrival: Date) {
  const d = fake.deliveries[0]!;
  const reservation: CanonicalReservation = {
    externalId: RES,
    code: "G1CODE",
    channel: "airbnb",
    status: "confirmed",
    arrivalDate: arrival,
    departureDate: stayDay(5),
    guest: { externalId: "g-g1", name: "Bircan Misafir", givenName: "Bircan", email: null, phone: null },
    totalAmount: null,
    currency: null,
    conversationExternalId: "conv-g1",
    conversationLanguage: null,
    lastMessageAt: d.at,
    terminal: false,
  };
  const messages: CanonicalMessage[] = [{ externalId: d.providerMessageId, direction: "outbound", senderName: "Ev Sahibi", body: d.body, createdAt: d.at }];
  await prisma.$transaction((tx) =>
    importCanonicalThread(tx, propertyId, reservation, messages, reservationId, { organizationId: orgId, provider: "hospitable", connectionId: null }),
  );
}

async function drainUntilSettled(clock: { t: number }) {
  for (let i = 0; i < OUTBOX_MAX_ATTEMPTS + 3; i++) {
    await drainOutboxOnce({ now: () => new Date(clock.t) });
    clock.t += 60 * 60_000;
  }
}

describe("(G1 11-19) kuyruk: otomatik mesajın uzlaştırması senkronun içe aldığı kendi kopyasını 'başka kayıt' saymaz (anahtar açılınca)", () => {
  beforeEach(async () => {
    await resetDb();
    fake.reset();
    tokenFor.mockResolvedValue("tok-A");
    __setOutboundAdapterForTest("hospitable", fake.adapter());
    vi.stubEnv("CHANNEL_SEND_RECONCILE_ENABLED", "1");
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", "*");
  });
  afterEach(() => {
    __setOutboundAdapterForTest("hospitable", null);
    vi.unstubAllEnvs();
  });

  it("KONTROL (bugün yeşil): senkron araya girmezse belirsiz karşılama kanaldan doğrulanır → 'sent'", async () => {
    const { orgId } = await seedWelcome();
    expect((await sendDueWelcomes(orgId)).sent).toBe(1);
    const row0 = await prisma.messageOutbox.findFirstOrThrow({ where: { organizationId: orgId } });
    expect(row0.messageId).toBeNull();
    fake.behave({ mode: "timeout", delivered: true });
    const clock = { t: Date.now() };
    await drainOutboxOnce({ now: () => new Date(clock.t) });
    expect((await prisma.messageOutbox.findUniqueOrThrow({ where: { id: row0.id } })).status).toBe("ambiguous");
    fake.behave({ mode: "succeed" });
    await drainUntilSettled(clock);
    expect(await prisma.messageOutbox.findUniqueOrThrow({ where: { id: row0.id } })).toMatchObject({ status: "sent", lastErrorCode: RECONCILE_CODES.seenByContent });
    expect(fake.attempts).toHaveLength(1);
  });

  it("🚨 senkron kanaldaki teslimi (bizim karşılamamız) önce içe alsa da uzlaştırma onu doğrular → 'sent' (kanıt: kanalda görüldü)", async () => {
    const { orgId, propertyId, reservationId, arrival } = await seedWelcome();
    expect((await sendDueWelcomes(orgId)).sent).toBe(1);
    const row0 = await prisma.messageOutbox.findFirstOrThrow({ where: { organizationId: orgId } });
    fake.behave({ mode: "timeout", delivered: true });
    const clock = { t: Date.now() };
    await drainOutboxOnce({ now: () => new Date(clock.t) });
    expect((await prisma.messageOutbox.findUniqueOrThrow({ where: { id: row0.id } })).status).toBe("ambiguous");
    expect(fake.deliveries).toHaveLength(1); // misafire ULAŞTI (sağlayıcı tarafı gerçeği)

    // İlk uzlaştırma bakışından önce olağan senkron (2 dk) kanaldaki mesajı içe alır.
    await syncImports(orgId, propertyId, reservationId, arrival);
    const imported = await prisma.message.findFirstOrThrow({ where: { externalId: fake.deliveries[0]!.providerMessageId } });
    expect(imported.direction).toBe("outbound");

    fake.behave({ mode: "succeed" });
    await drainUntilSettled(clock);
    const row = await prisma.messageOutbox.findUniqueOrThrow({ where: { id: row0.id } });
    // Tasarım AK-1 ("kanalda varsa gitmiştir"): sent + kanıt "kanalda görüldü". Eski davranış: review + "kanalda görünmüyor".
    expect({ status: row.status, lastErrorCode: row.lastErrorCode }).toEqual({ status: "sent", lastErrorCode: RECONCILE_CODES.seenByContent });
  });
});
