import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

const sendReporting = vi.fn(async (_to: string, _subject: string, _html: string) => ({ ok: true }));
vi.mock("@/lib/email", () => ({ emailService: { sendReporting: (to: string, subject: string, html: string) => sendReporting(to, subject, html) } }));
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(async () => {}) }));

import { notifyHostReplyWaiting, REPLY_WAITING_MAIL_PREFIX, REPLY_WAITING_SENT } from "@/lib/host-reply-waiting";

// ---------------------------------------------------------------------------
// Codex 10-23 (bildirim yarışı): "Misafir cevabınızı bekliyor" talebi e-postadan ÖNCE alınır. Başka bir geçiş talebi görüp "zaten gönderildi"
// sayıyordu; uçuştaki e-posta düşünce talep siliniyor ve ihtiyaç bildirimsiz kalıyordu. Şimdi başarıda talebe onay yazılır; onaysız ve yeni
// talep "uçuşta" döner (çağıran kendi kaydını yazmaz), onaylı ya da eski talep "deduped".
// ---------------------------------------------------------------------------

async function setup() {
  const { orgId, propertyId } = await makeOrgWithProperty();
  await prisma.organization.update({ where: { id: orgId }, data: { alertEmail: "uyari@ornek.test" } });
  const c = await prisma.conversation.create({ data: { propertyId, channel: "airbnb", guestIdentifier: "Misafir", status: "new" } });
  const m = await prisma.message.create({ data: { conversationId: c.id, direction: "inbound", senderName: "Misafir", body: "Havuz kaçta?" } });
  const call = () =>
    notifyHostReplyWaiting({
      organizationId: orgId,
      conversation: { id: c.id, guestIdentifier: "Misafir", channel: "airbnb" },
      property: { name: "Lale", address: null, city: null },
      messageId: m.id,
      messageBody: m.body,
    });
  return { name: `${REPLY_WAITING_MAIL_PREFIX}${m.id}`, call };
}

describe("Misafir cevabınızı bekliyor — gönderildi onayı ve uçuştaki talep", () => {
  beforeEach(async () => {
    await resetDb();
    sendReporting.mockClear();
    sendReporting.mockImplementation(async () => ({ ok: true }));
  });

  it("🚨 başarılı gönderim talebe 'gönderildi' onayı yazar; ikinci çağrı e-posta atmadan 'deduped'", async () => {
    const { name, call } = await setup();
    expect(await call()).toBe("mailed");
    expect((await prisma.systemLock.findUniqueOrThrow({ where: { name } })).holder).toBe(REPLY_WAITING_SENT);
    expect(await call()).toBe("deduped");
    expect(sendReporting).toHaveBeenCalledTimes(1);
  });

  it("🚨 onaysız ve yeni talep (öteki geçişin e-postası uçuşta) 'in_flight' — çağıran 'bildirildi' saymaz", async () => {
    const { name, call } = await setup();
    await prisma.systemLock.create({ data: { name, lockedUntil: new Date(Date.now() + 86_400_000) } });
    expect(await call()).toBe("in_flight");
    expect(sendReporting).not.toHaveBeenCalled();
  });

  it("e-posta düşerse talep silinir (onay yazılmaz) → sonraki çağrı yeniden dener", async () => {
    const { name, call } = await setup();
    sendReporting.mockImplementationOnce(async () => ({ ok: false }));
    expect(await call()).toBe("failed");
    expect(await prisma.systemLock.findUnique({ where: { name } })).toBeNull();
    expect(await call()).toBe("mailed");
  });
});
