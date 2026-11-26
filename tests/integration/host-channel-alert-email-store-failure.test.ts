import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

vi.mock("@/lib/email", () => ({ emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) } }));

import { emailService } from "@/lib/email";
import { deliverUrgentAlert } from "@/lib/host-channel/alert-email";
import { WHATSAPP_CLOUD_PROVIDER } from "@/lib/host-channel/providers";
import type { HostChannelTransport } from "@/lib/host-channel/types";

// ---------------------------------------------------------------------------
// HİBRİT ACİL E-POSTASI — kayıt deposu arızası (tasarım §3.12). Prisma temsilcisine `spyOn` sonraki testlere sızabildiği
// için AYRI dosyada (çalışma dersi). Pinlenen: kayıt yazılamazsa güvenli yön = bugünkü eşzamanlı yol (e-posta HEMEN); okuma ile kiralama
// arasında başka geçiş kaydı aldıysa bu geçiş o kayda dokunmaz.
// ---------------------------------------------------------------------------

const mockMail = vi.mocked(emailService.sendReporting);
const transport = { provider: WHATSAPP_CLOUD_PROVIDER } as unknown as HostChannelTransport;
const NOW = new Date("2026-10-31T09:00:00.000Z");
const later = (min: number) => new Date(NOW.getTime() + min * 60_000);

async function seed() {
  const org = await prisma.organization.create({ data: { name: "Org", alertEmail: "host@example.com" } });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale" } });
  const conversation = await prisma.conversation.create({
    data: { propertyId: property.id, guestIdentifier: "Ada", channel: "airbnb", externalReservationId: `r-${property.id}`, status: "problem" },
  });
  const message = await prisma.message.create({ data: { conversationId: conversation.id, direction: "inbound", senderName: "Ada", body: "Anahtarı kaybettik", createdAt: later(-1) } });
  return { orgId: org.id, messageId: message.id };
}

describe("hibrit acil e-postası — depo arızası", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    mockMail.mockResolvedValue({ ok: true } as never);
    vi.stubEnv("HOST_CHANNEL_ENABLED", "1");
    vi.stubEnv("HOST_CHANNEL_ORG_IDS", "*");
    vi.stubEnv("HOST_CHANNEL_HMAC_SECRET", "test-host-channel-secret-0123456789abcdef");
    vi.stubEnv("HOST_QUESTION_ALERTS_ENABLED", "1");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("🚨 ertelenmiş e-posta kaydı YAZILAMAZSA (P2002 dışı hata) → e-posta HEMEN + bildirim (bugünkü eşzamanlı yol)", async () => {
    const s = await seed();
    vi.spyOn(prisma.systemLock, "create").mockRejectedValueOnce(new Error("connection reset"));
    const sendEmail = vi.fn(async () => ({ ok: true }));
    const wa = vi.fn(async () => "sent" as const);
    const r = await deliverUrgentAlert({ organizationId: s.orgId, messageId: s.messageId, lifeSafety: false, transport, sendEmail, whatsapp: wa, now: NOW });
    expect(r).toEqual({ ok: true, deferred: false });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(wa).toHaveBeenCalledTimes(1);
  });

});
