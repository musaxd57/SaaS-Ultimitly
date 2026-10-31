import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { startHostBinding, confirmHostBindingFromInbound } from "@/lib/host-channel/binding";
import { WHATSAPP_CLOUD_PROVIDER } from "@/lib/host-channel/providers";
import { alertHostOnChannel } from "@/lib/host-channel/alert";
import type { HostChannelTransport } from "@/lib/host-channel/types";

// ---------------------------------------------------------------------------
// Acil bildirim GİTTİ ama "alerted" kaydı yazılamadı (veritabanı kesintisi): sonuç "gönderildi" kalır, satır "failed" YAPILMAZ — yoksa yolun
// yeniden çağrılması (e-posta da düşünce) "gitmemiş" sanıp İKİNCİ WhatsApp atardı (sert inceleme 10-31 R-1/R-4). Bilinen sınır: satır "queued"
// kalır; kesinti + e-posta düşmesi + 2 dakikadan sonra yeniden çağrı olursa bayat kayıt yeniden denenir (acilde fazladan bir mesaj, kaçırmaktan
// iyidir — bilinçli). Prisma temsilcisine casus sonraki testlere sızdığı için ayrı dosya (CLAUDE.md çalışma dersi).
// ---------------------------------------------------------------------------

let failAlertedWrite = false;
const realUpdateMany = prisma.hostQuestion.updateMany.bind(prisma.hostQuestion);
vi.spyOn(prisma.hostQuestion, "updateMany").mockImplementation(((args: Parameters<typeof prisma.hostQuestion.updateMany>[0]) => {
  if (failAlertedWrite && (args?.data as { status?: unknown } | undefined)?.status === "alerted") {
    return Promise.reject(new Error("db down"));
  }
  return realUpdateMany(args);
}) as never);

let sends = 0;
const transport: HostChannelTransport = {
  provider: WHATSAPP_CLOUD_PROVIDER,
  sendQuestion: async () => ({ ok: true, providerMessageId: "wamid.q" }),
  sendAlert: async () => {
    sends++;
    return { ok: true, providerMessageId: `wamid.A${sends}` };
  },
  sendText: async () => ({ ok: true, providerMessageId: "wamid.t" }),
  sendChoices: async () => ({ ok: true, providerMessageId: "wamid.c" }),
};

describe("acil bildirim — gönderim sonrası kayıt hatası", () => {
  beforeEach(async () => {
    await resetDb();
    sends = 0;
    failAlertedWrite = false;
    vi.stubEnv("HOST_CHANNEL_ENABLED", "1");
    vi.stubEnv("HOST_QUESTION_ALERTS_ENABLED", "1");
    vi.stubEnv("HOST_CHANNEL_ORG_IDS", "*");
    vi.stubEnv("HOST_CHANNEL_HMAC_SECRET", "test-host-channel-secret-0123456789abcdef");
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("🚨 bildirim gitti, kayıt yazılamadı → 'sent' (satır 'failed' olmaz); yol yeniden çağırınca İKİNCİ WhatsApp YOK", async () => {
    const org = await prisma.organization.create({ data: { name: "Test Org" } });
    const user = await prisma.user.create({
      data: { organizationId: org.id, name: "Ayla", email: `u${Math.random().toString(36).slice(2)}@example.test`, passwordHash: "x", role: "owner" },
    });
    const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale" } });
    const reservation = await prisma.reservation.create({
      data: { propertyId: property.id, guestName: "Ayşe", arrivalDate: new Date("2026-11-12T00:00:00Z"), departureDate: new Date("2026-11-15T00:00:00Z"), status: "confirmed", channel: "airbnb" },
    });
    const conversation = await prisma.conversation.create({
      data: { propertyId: property.id, channel: "airbnb", guestIdentifier: "Ayşe", status: "new", reservationId: reservation.id },
    });
    const message = await prisma.message.create({ data: { conversationId: conversation.id, direction: "inbound", senderName: "Ayşe", body: "We are locked out!" } });
    const b = await startHostBinding({ organizationId: org.id, userId: user.id, provider: WHATSAPP_CLOUD_PROVIDER, rawNumber: "+90 532 111 22 33", optInTextVersion: "v1" });
    if (!b.ok) throw new Error(b.reason);
    const c = await confirmHostBindingFromInbound({ provider: WHATSAPP_CLOUD_PROVIDER, fromDigits: "905321112233", code: b.code });
    if (!c.ok) throw new Error(c.reason);

    const call = () =>
      alertHostOnChannel({ organizationId: org.id, conversationId: conversation.id, messageId: message.id, messageBody: message.body, transport });
    failAlertedWrite = true;
    expect(await call()).toBe("sent");
    expect((await prisma.hostQuestion.findFirstOrThrow({ where: { conversationId: conversation.id } })).status).toBe("queued");
    failAlertedWrite = false;
    expect(await call()).toBe("duplicate");
    expect(sends).toBe(1);
  });
});
