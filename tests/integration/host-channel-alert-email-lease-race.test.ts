import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

vi.mock("@/lib/email", () => ({ emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) } }));

import { emailService } from "@/lib/email";
import { alertMailLockName, deliverDueAlertEmails } from "@/lib/host-channel/alert-email";

// ---------------------------------------------------------------------------
// HİBRİT ACİL E-POSTASI — kayıt deposu arızası ve kiralama yarışı (tasarım §3.12). Prisma temsilcisine `spyOn` sonraki testlere sızabildiği
// için AYRI dosyada (çalışma dersi). Pinlenen: kayıt yazılamazsa güvenli yön = bugünkü eşzamanlı yol (e-posta HEMEN); okuma ile kiralama
// arasında başka geçiş kaydı aldıysa bu geçiş o kayda dokunmaz.
// ---------------------------------------------------------------------------

const mockMail = vi.mocked(emailService.sendReporting);
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
const lock = (messageId: string) => prisma.systemLock.findUnique({ where: { name: alertMailLockName(messageId) } });

describe("hibrit acil e-postası — kiralama yarışı", () => {
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

  it("okuma ile kiralama arasında başka geçiş kaydı aldıysa (CAS kaybedildi) o kayda dokunulmaz — e-posta yok", async () => {
    const s = await seed();
    await prisma.systemLock.create({ data: { name: alertMailLockName(s.messageId), lockedUntil: later(-1), holder: null } });
    const realUpdate = prisma.systemLock.updateMany.bind(prisma.systemLock);
    let first = true;
    vi.spyOn(prisma.systemLock, "updateMany").mockImplementation((async (args: Parameters<typeof realUpdate>[0]) => {
      if (first) {
        first = false;
        await realUpdate({ where: { name: alertMailLockName(s.messageId) }, data: { holder: "baska-gecis", lockedUntil: later(3) } });
      }
      return realUpdate(args);
    }) as never);
    expect(await deliverDueAlertEmails(NOW)).toMatchObject({ sent: 0, retry: 0, dropped: 0, cancelled_read: 0 });
    expect(mockMail).not.toHaveBeenCalled();
    expect(await lock(s.messageId)).toMatchObject({ holder: "baska-gecis" });
  });
});
