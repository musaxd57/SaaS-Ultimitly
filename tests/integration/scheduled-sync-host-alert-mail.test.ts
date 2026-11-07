import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// HİBRİT ACİL E-POSTASI senkron geçişinde (tasarım §3.12): vadesi gelen ertelenmiş acil e-posta, işletme döngüsünden bağımsız olarak HER
// geçişte (dar geçişte de) gönderilir. Bağlantı testi — vade görevinin kuralları `host-channel-alert-email.test.ts`te.
// ---------------------------------------------------------------------------

vi.mock("@/lib/hospitable-credentials", () => ({
  getOrgHospitableToken: vi.fn(async () => null),
  isPrimaryOrg: vi.fn(async () => false),
}));
vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) },
}));

import { emailService } from "@/lib/email";
import { runScheduledSync } from "@/lib/scheduled-sync";
import { alertMailLockName } from "@/lib/host-channel/alert-email";

describe("scheduled-sync — ertelenmiş acil e-postası", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(console.log).mockRestore();
  });

  it("🚨 dar geçiş vadesi gelmiş kaydı gönderir (bir kez), vadesi gelmemişe dokunmaz", async () => {
    const org = await prisma.organization.create({ data: { name: "Org", alertEmail: "host@example.com" } });
    const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale 1" } });
    const conversation = await prisma.conversation.create({
      data: { propertyId: property.id, guestIdentifier: "Ada", channel: "airbnb", externalReservationId: `r-${property.id}`, status: "problem" },
    });
    const due = await prisma.message.create({ data: { conversationId: conversation.id, direction: "inbound", senderName: "Ada", body: "Anahtarı kaybettik" } });
    const notYet = await prisma.message.create({ data: { conversationId: conversation.id, direction: "inbound", senderName: "Ada", body: "Daire çok kirli" } });
    await prisma.systemLock.create({ data: { name: alertMailLockName(due.id), lockedUntil: new Date(Date.now() - 60_000), holder: null } });
    await prisma.systemLock.create({ data: { name: alertMailLockName(notYet.id), lockedUntil: new Date(Date.now() + 5 * 60_000), holder: null } });
    await prisma.systemLock.create({ data: { name: "deep-sync-cadence", lockedUntil: new Date(Date.now() + 60 * 60_000) } });

    const res = await runScheduledSync();
    expect(res.ok).toBe(true);
    const mail = vi.mocked(emailService.sendReporting);
    expect(mail).toHaveBeenCalledTimes(1);
    expect(mail.mock.calls[0]![0]).toBe("host@example.com");
    expect(mail.mock.calls[0]![2]).toContain("Anahtarı kaybettik");
    expect(await prisma.systemLock.findUnique({ where: { name: alertMailLockName(due.id) } })).toBeNull();
    expect(await prisma.systemLock.findUnique({ where: { name: alertMailLockName(notYet.id) } })).not.toBeNull();
  });

  it("🚨 senkron kilidi BAŞKASINDAYKEN de vadesi gelen acil e-posta gider (uzun geçiş '10 dk'yı uzatmasın — inceleme 10-31)", async () => {
    const org = await prisma.organization.create({ data: { name: "Org", alertEmail: "host@example.com" } });
    const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale 1" } });
    const conversation = await prisma.conversation.create({
      data: { propertyId: property.id, guestIdentifier: "Ada", channel: "airbnb", externalReservationId: `r-${property.id}`, status: "problem" },
    });
    const m = await prisma.message.create({ data: { conversationId: conversation.id, direction: "inbound", senderName: "Ada", body: "Anahtarı kaybettik" } });
    await prisma.systemLock.create({ data: { name: alertMailLockName(m.id), lockedUntil: new Date(Date.now() - 60_000), holder: null } });
    await prisma.systemLock.create({ data: { name: "scheduled-sync", lockedUntil: new Date(Date.now() + 10 * 60_000), holder: "baska-surec" } });
    const res = await runScheduledSync();
    expect(res).toMatchObject({ ok: false, error: "locked" });
    expect(vi.mocked(emailService.sendReporting)).toHaveBeenCalledTimes(1);
    expect(await prisma.systemLock.findUnique({ where: { name: alertMailLockName(m.id) } })).toBeNull();
  });
});
