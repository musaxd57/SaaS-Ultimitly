import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

vi.mock("@/lib/email", () => ({ emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) } }));
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn(async () => "reported") };
});

import { emailService } from "@/lib/email";
import { ANON_BODY } from "@/lib/data-retention";
import {
  ALERT_MAIL_DEFER_MS,
  alertMailLockName,
  deliverDueAlertEmails,
  deliverUrgentAlert,
  expediteForFailedProviderIds,
} from "@/lib/host-channel/alert-email";
import { WHATSAPP_CLOUD_PROVIDER } from "@/lib/host-channel/providers";
import type { HostChannelTransport } from "@/lib/host-channel/types";

// ---------------------------------------------------------------------------
// HİBRİT ACİL E-POSTASI (tasarım §3.12, kurucu kararı 10-31 sabah). Gerçek veritabanı; e-posta ve WhatsApp çağrıları sahte.
// Pinlenen: kapalıyken / can güvenliğinde BUGÜNKÜ eşzamanlı yol (kayıt yok); standartta WhatsApp gitti → e-posta ertelenir (kayıt WhatsApp'tan
// ÖNCE), gitmedi → e-posta hemen; vade görevi okunmuşu iptal eder, okunmamışı bir kez gönderir, hatada yeniden dener, silinmiş / eski /
// alıcısız olanı bırakır; iki geçiş aynı anda koşsa da tek e-posta; "failed" durumu e-postayı öne çeker.
// ---------------------------------------------------------------------------

const mockMail = vi.mocked(emailService.sendReporting);
const transport = { provider: WHATSAPP_CLOUD_PROVIDER } as unknown as HostChannelTransport;
const NOW = new Date("2026-10-31T09:00:00.000Z");
const later = (min: number) => new Date(NOW.getTime() + min * 60_000);

function routeOpen(on = true) {
  vi.stubEnv("HOST_CHANNEL_ENABLED", "1");
  vi.stubEnv("HOST_CHANNEL_ORG_IDS", "*");
  vi.stubEnv("HOST_CHANNEL_HMAC_SECRET", "test-host-channel-secret-0123456789abcdef");
  vi.stubEnv("HOST_QUESTION_ALERTS_ENABLED", on ? "1" : "");
}

async function seed(opts: { body?: string; alertEmail?: string | null; owner?: boolean; createdAt?: Date } = {}) {
  const org = await prisma.organization.create({ data: { name: "Org", alertEmail: opts.alertEmail === undefined ? "host@example.com" : opts.alertEmail } });
  if (opts.owner) {
    await prisma.user.create({ data: { organizationId: org.id, name: "Sahip", email: "owner@example.com", passwordHash: "x", role: "owner" } });
  }
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale" } });
  const conversation = await prisma.conversation.create({
    data: { propertyId: property.id, guestIdentifier: "Ada", channel: "airbnb", externalReservationId: `r-${property.id}`, status: "problem" },
  });
  const message = await prisma.message.create({
    data: { conversationId: conversation.id, direction: "inbound", senderName: "Ada", body: opts.body ?? "Anahtarı kaybettik", createdAt: opts.createdAt ?? later(-1) },
  });
  return { orgId: org.id, conversationId: conversation.id, messageId: message.id };
}
async function alertRow(s: { orgId: string; conversationId: string; messageId: string }, data: { status: string; providerMessageId?: string; readAt?: Date }) {
  return prisma.hostQuestion.create({
    data: {
      organizationId: s.orgId,
      conversationId: s.conversationId,
      kind: "alert",
      turnMessageId: s.messageId,
      idempotencyKey: `alert:${s.messageId}`,
      sentAt: NOW,
      expiresAt: later(24 * 60),
      ...data,
    },
  });
}
const lock = (messageId: string) => prisma.systemLock.findUnique({ where: { name: alertMailLockName(messageId) } });
const deliver = (s: { orgId: string; messageId: string }, wa: () => Promise<unknown>, lifeSafety = false, sendEmail = vi.fn(async () => ({ ok: true }))) =>
  deliverUrgentAlert({ organizationId: s.orgId, messageId: s.messageId, lifeSafety, transport, sendEmail, whatsapp: wa, now: NOW }).then((r) => ({ r, sendEmail }));

describe("hibrit acil e-postası", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    mockMail.mockResolvedValue({ ok: true } as never);
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("🚨 yol KAPALI → bugünkü eşzamanlı kod: bildirim e-postanın bitmesini beklemeden başlar, ikisi de beklenir, kayıt YOK", async () => {
    routeOpen(false);
    const s = await seed();
    const order: string[] = [];
    let mailed!: () => void;
    const mailSeen = new Promise<void>((r) => (mailed = r));
    const sendEmail = vi.fn(async () => {
      order.push("mail-start");
      await new Promise((r) => setTimeout(r, 30));
      order.push("mail-done");
      mailed();
      return { ok: true };
    });
    const wa = vi.fn(async () => {
      order.push("wa-start");
      await Promise.race([mailSeen, new Promise((r) => setTimeout(r, 1_000))]);
      await new Promise((r) => setTimeout(r, 20));
      order.push("wa-done");
      return "skipped" as const;
    });
    const { r } = await deliver(s, wa, false, sendEmail);
    expect(r).toEqual({ ok: true, deferred: false });
    expect(order).toEqual(["mail-start", "wa-start", "mail-done", "wa-done"]);
    expect(await lock(s.messageId)).toBeNull();
  });

  it("🚨 CAN GÜVENLİĞİ, yol AÇIK → yine eşzamanlı (ikisi birden), kayıt YOK", async () => {
    routeOpen();
    const s = await seed({ body: "Mutfakta yangın var!" });
    const wa = vi.fn(async () => "sent" as const);
    const { r, sendEmail } = await deliver(s, wa, true);
    expect(r).toEqual({ ok: true, deferred: false });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(wa).toHaveBeenCalledTimes(1);
    expect(await lock(s.messageId)).toBeNull();
  });

  it("🚨 standart + WhatsApp GİTTİ → e-posta şimdi YOK, kayıt vade = şimdi + 10 dk (WhatsApp'tan ÖNCE yazılır)", async () => {
    routeOpen();
    const s = await seed();
    let lockSeenBeforeWa = false;
    const wa = vi.fn(async () => {
      lockSeenBeforeWa = (await lock(s.messageId)) !== null;
      return "sent" as const;
    });
    const { r, sendEmail } = await deliver(s, wa);
    expect(r).toEqual({ ok: true, deferred: true });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(lockSeenBeforeWa).toBe(true);
    expect(await lock(s.messageId)).toMatchObject({ holder: null, lockedUntil: new Date(NOW.getTime() + ALERT_MAIL_DEFER_MS) });
  });

  it.each(["skipped", "capped", "failed", null])("standart + WhatsApp '%s' → e-posta HEMEN, kayıt silinir", async (outcome) => {
    routeOpen();
    const s = await seed();
    const { r, sendEmail } = await deliver(s, async () => outcome);
    expect(r).toEqual({ ok: true, deferred: false });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(await lock(s.messageId)).toBeNull();
  });

  it("WhatsApp çağrısı FIRLATIRSA e-posta hemen; e-posta da düşerse ok:false (çağıran talebi geri verir), kayıt kalmaz", async () => {
    routeOpen();
    const s = await seed();
    const { r } = await deliver(
      s,
      async () => {
        throw new Error("meta down");
      },
      false,
      vi.fn(async () => ({ ok: false })),
    );
    expect(r).toEqual({ ok: false, deferred: false });
    expect(await lock(s.messageId)).toBeNull();
  });

  it("'duplicate' + bildirim satırı gitmiş (alerted) → ertelenir; satır 'failed' → e-posta hemen", async () => {
    routeOpen();
    const a = await seed();
    await alertRow(a, { status: "alerted", providerMessageId: "wamid.a1" });
    expect((await deliver(a, async () => "duplicate")).r).toEqual({ ok: true, deferred: true });
    const b = await seed();
    await alertRow(b, { status: "failed" });
    const out = await deliver(b, async () => "duplicate");
    expect(out.r).toEqual({ ok: true, deferred: false });
    expect(out.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("bu mesaj için kayıt ZATEN varsa (eşzamanlı / yeniden işlenen geçiş) → ikinci bildirim / e-posta yok, ertelenmiş sayılır", async () => {
    routeOpen();
    const s = await seed();
    await prisma.systemLock.create({ data: { name: alertMailLockName(s.messageId), lockedUntil: later(5), holder: null } });
    const wa = vi.fn(async () => "sent" as const);
    const { r, sendEmail } = await deliver(s, wa);
    expect(r).toEqual({ ok: true, deferred: true });
    expect(wa).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  describe("vade görevi", () => {
    const due = async (messageId: string, at = later(-1)) =>
      prisma.systemLock.create({ data: { name: alertMailLockName(messageId), lockedUntil: at, holder: null } });

    it("vadesi gelmemiş kayda dokunmaz", async () => {
      const s = await seed();
      await due(s.messageId, later(5));
      expect(await deliverDueAlertEmails(NOW)).toMatchObject({ sent: 0, cancelled_read: 0, dropped: 0, retry: 0 });
      expect(mockMail).not.toHaveBeenCalled();
      expect(await lock(s.messageId)).not.toBeNull();
    });

    it("🚨 okunmamış → e-posta BİR kez (alıcı: uyarı adresi; tekrar anahtarı), kayıt silinir", async () => {
      const s = await seed();
      await alertRow(s, { status: "alerted", providerMessageId: "wamid.a1" });
      await due(s.messageId);
      expect((await deliverDueAlertEmails(NOW)).sent).toBe(1);
      expect(mockMail).toHaveBeenCalledTimes(1);
      expect(mockMail.mock.calls[0]![0]).toBe("host@example.com");
      expect(mockMail.mock.calls[0]![1]).toBe("⚠️ Acil misafir mesajı — Ada (Lale)");
      expect(mockMail.mock.calls[0]![2]).toContain("Anahtarı kaybettik");
      expect(mockMail.mock.calls[0]![3]).toEqual({ idempotencyKey: alertMailLockName(s.messageId) });
      expect(await lock(s.messageId)).toBeNull();
    });

    it("🚨 okunmuş → e-posta YOK, kayıt silinir", async () => {
      const s = await seed();
      await alertRow(s, { status: "alerted", providerMessageId: "wamid.a1", readAt: later(-5) });
      await due(s.messageId);
      expect(await deliverDueAlertEmails(NOW)).toMatchObject({ sent: 0, cancelled_read: 1 });
      expect(mockMail).not.toHaveBeenCalled();
      expect(await lock(s.messageId)).toBeNull();
    });

    it("uyarı adresi yoksa İLK SAHİBİN e-postası; ikisi de yoksa bırakılır", async () => {
      const a = await seed({ alertEmail: null, owner: true });
      await due(a.messageId);
      await deliverDueAlertEmails(NOW);
      expect(mockMail.mock.calls[0]![0]).toBe("owner@example.com");
      const b = await seed({ alertEmail: null });
      await due(b.messageId);
      expect((await deliverDueAlertEmails(NOW)).dropped).toBe(1);
      expect(await lock(b.messageId)).toBeNull();
    });

    it("🚨 silinmiş / anonimleşmiş mesaj ve 72 saati aşan mesaj gönderilmez (metin geri yazılmaz)", async () => {
      const erased = await seed({ body: ANON_BODY });
      await due(erased.messageId);
      const old = await seed({ createdAt: later(-73 * 60) });
      await due(old.messageId);
      await due("silinmis-mesaj-kimligi");
      expect(await deliverDueAlertEmails(NOW)).toMatchObject({ sent: 0, dropped: 3 });
      expect(mockMail).not.toHaveBeenCalled();
      expect(await prisma.systemLock.count({ where: { name: { startsWith: "host-alert-mail:" } } })).toBe(0);
    });

    it("e-posta düşerse kayıt KALIR (2 dk sonra yeniden), sonraki geçiş gönderir", async () => {
      const s = await seed();
      await due(s.messageId);
      mockMail.mockResolvedValueOnce({ ok: false } as never);
      expect((await deliverDueAlertEmails(NOW)).retry).toBe(1);
      expect(await lock(s.messageId)).toMatchObject({ holder: null, lockedUntil: later(2) });
      expect((await deliverDueAlertEmails(later(1))).sent).toBe(0);
      expect((await deliverDueAlertEmails(later(3))).sent).toBe(1);
      expect(mockMail).toHaveBeenCalledTimes(2);
    });

    it("🚨 iki geçiş AYNI ANDA koşsa da tek e-posta (kiralama)", async () => {
      const s = await seed();
      await due(s.messageId);
      const [a, b] = await Promise.all([deliverDueAlertEmails(NOW), deliverDueAlertEmails(NOW)]);
      expect(a.sent + b.sent).toBe(1);
      expect(mockMail).toHaveBeenCalledTimes(1);
    });

    it("sağlayıcı 'failed' bildirdi → ertelenmiş e-posta öne çekilir (vadeyi beklemez)", async () => {
      const s = await seed();
      await alertRow(s, { status: "alerted", providerMessageId: "wamid.f1" });
      await due(s.messageId, later(9));
      await expediteForFailedProviderIds(["wamid.f1"], NOW);
      expect((await deliverDueAlertEmails(NOW)).sent).toBe(1);
    });
  });
});
