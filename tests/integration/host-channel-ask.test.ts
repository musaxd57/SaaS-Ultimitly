import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

const sendReporting = vi.fn(async (_to: string, _subject: string, _html: string) => ({ ok: true }));
vi.mock("@/lib/email", () => ({ emailService: { sendReporting: (to: string, subject: string, html: string) => sendReporting(to, subject, html) } }));
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(async () => {}) }));

import { notifyHostReplyWaiting } from "@/lib/host-reply-waiting";
import { confirmHostBindingFromInbound, startHostBinding } from "@/lib/host-channel/binding";
import { __setHostChannelTransportForTest } from "@/lib/host-channel-runtime";
import type { HostChannelTransport, HostQuestionMessage } from "@/lib/host-channel/types";

// ---------------------------------------------------------------------------
// WhatsApp Tür A — "Misafir cevabınızı bekliyor" bildirimine bağlantı (kurucu 10-30 "WP'yi hemen bağlamak istiyorum"; tasarım §3.1–3.3, S3
// önerisi A). Gerçek veritabanı, sahte aktarım. Pinlenen: anahtarlar kapalıyken BUGÜNKÜ e-posta (soru kaydı yok, aktarım çağrılmaz); açık +
// doğrulanmış numara + bilgi sorusu → WhatsApp gider, e-posta GİTMEZ; aynı mesaja ikinci bildirim yok; öğe türü bilinmiyorsa / para-iade
// türünde / liste dışı işletmede / gönderim düşerse / oturum kuşağı değiştiyse e-posta. Misafirin adı / telefonu WhatsApp'a gitmez.
// ---------------------------------------------------------------------------

const SECRET = "test-host-channel-secret-0123456789abcdef";
const DAY = 86_400_000;

function fakeTransport(result: { ok: boolean } = { ok: true }) {
  const sent: { to: string; message: HostQuestionMessage }[] = [];
  const t: HostChannelTransport = {
    provider: "fake",
    async sendQuestion(to, message) {
      sent.push({ to, message });
      return result.ok ? { ok: true, providerMessageId: `wamid.${sent.length}` } : { ok: false, providerMessageId: null, definitive: true, error: "x" };
    },
    async sendAlert() {
      return { ok: false, providerMessageId: null, definitive: true, error: "not_used" };
    },
    async sendText() {
      return { ok: true, providerMessageId: "wamid.t" };
    },
    async sendChoices() {
      return { ok: true, providerMessageId: "wamid.c" };
    },
  };
  return { t, sent };
}

async function seed() {
  const org = await prisma.organization.create({ data: { name: "Test Org", alertEmail: "uyari@ornek.test" } });
  const owner = await prisma.user.create({
    data: { organizationId: org.id, name: "Ev Sahibi", email: `o${Math.random().toString(36).slice(2)}@example.test`, passwordHash: "x", role: "owner" },
  });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale", checkInTime: "15:00", checkOutTime: "11:00" } });
  const reservation = await prisma.reservation.create({
    data: {
      propertyId: property.id,
      guestName: "Ayşe Yılmaz",
      arrivalDate: new Date("2026-11-12T00:00:00.000Z"),
      departureDate: new Date("2026-11-15T00:00:00.000Z"),
      status: "confirmed",
      channel: "airbnb",
      currency: "EUR",
    },
  });
  const c = await prisma.conversation.create({
    data: { propertyId: property.id, channel: "airbnb", guestIdentifier: "Ayşe Yılmaz", status: "new", reservationId: reservation.id },
  });
  const body = "Merhaba, ben Ayşe Yılmaz. Bebek yatağı var mı? Numaram +90 532 111 22 33.";
  const m = await prisma.message.create({ data: { conversationId: c.id, direction: "inbound", senderName: "Ayşe Yılmaz", body, createdAt: new Date(Date.now() - DAY) } });
  return { orgId: org.id, userId: owner.id, conversationId: c.id, messageId: m.id, body };
}

async function bind(s: { orgId: string; userId: string }) {
  const r = await startHostBinding({ organizationId: s.orgId, userId: s.userId, provider: "fake", rawNumber: "+90 555 000 11 22", optInTextVersion: "v1" });
  if (!r.ok) throw new Error(r.reason);
  const c = await confirmHostBindingFromInbound({ provider: "fake", fromDigits: "905550001122", code: r.code });
  if (!c.ok) throw new Error(c.reason);
}

/** `itemKinds`: verilmezse bilgi sorusu türü; `null` → alan HİÇ geçilmez (öğesiz yol). */
const notify = (s: Awaited<ReturnType<typeof seed>>, kinds: readonly string[] | null = ["amenities"]) =>
  notifyHostReplyWaiting({
    organizationId: s.orgId,
    conversation: { id: s.conversationId, guestIdentifier: "Ayşe Yılmaz", channel: "airbnb" },
    property: { name: "Lale", address: null, city: null },
    messageId: s.messageId,
    messageBody: s.body,
    trigger: "handoff_held",
    ...(kinds === null ? {} : { itemKinds: kinds }),
  });

function flagsOn(orgId: string) {
  vi.stubEnv("HOST_CHANNEL_ENABLED", "1");
  vi.stubEnv("HOST_QUESTIONS_ENABLED", "1");
  vi.stubEnv("HOST_CHANNEL_ORG_IDS", orgId);
}

describe("WhatsApp ev sahibi sorusu — bildirim bağlantısı", () => {
  beforeEach(async () => {
    await resetDb();
    sendReporting.mockClear();
    vi.stubEnv("HOST_CHANNEL_HMAC_SECRET", SECRET);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    __setHostChannelTransportForTest(undefined);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("anahtarlar KAPALI: bugünkü e-posta birebir; aktarım çağrılmaz, soru kaydı yazılmaz", async () => {
    const s = await seed();
    await bind(s);
    const { t, sent } = fakeTransport();
    __setHostChannelTransportForTest(t);
    expect(await notify(s)).toBe("mailed");
    expect(sendReporting).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(0);
    expect(await prisma.hostQuestion.count()).toBe(0);
  });

  it("🚨 açık + doğrulanmış numara + bilgi sorusu → WhatsApp gider, e-posta GİTMEZ; misafirin adı / telefonu gitmez; aynı mesaja ikinci bildirim yok", async () => {
    const s = await seed();
    await bind(s);
    flagsOn(s.orgId);
    const { t, sent } = fakeTransport();
    __setHostChannelTransportForTest(t);
    expect(await notify(s)).toBe("mailed");
    expect(sendReporting).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("905550001122");
    expect(sent[0]!.message.property).toBe("Lale");
    expect(sent[0]!.message.dates).toBe("12–15 Kas");
    expect(sent[0]!.message.quote).toContain("Bebek yatağı var mı?");
    expect(sent[0]!.message.quote).not.toMatch(/Ayşe|Yılmaz|532|111 22 33/);
    // Şablonun değişkenli bağlantı düğmesi (yapılandırılmışsa) konuşmanın panel yolunu açar.
    expect(sent[0]!.message.link).toBe(s.conversationId);
    const q = await prisma.hostQuestion.findFirstOrThrow();
    expect(q).toMatchObject({ status: "sent", kind: "info", turnMessageId: s.messageId, providerMessageId: "wamid.1" });
    // İkinci değerlendirme: talep zaten alınmış → e-posta da WhatsApp da yok.
    expect(await notify(s)).toBe("deduped");
    expect(sent).toHaveLength(1);
    expect(sendReporting).not.toHaveBeenCalled();
  });

  it("öğe türü BİLİNMİYOR (öğesiz yol) / para-iade / konaklama değişikliği türü → e-posta (bilgi sorusuna dönüşmez)", async () => {
    for (const kinds of [null, ["amenities", "payment_invoice"], ["early_checkin"]] as const) {
      await resetDb();
      sendReporting.mockClear();
      const s = await seed();
      await bind(s);
      flagsOn(s.orgId);
      const { t, sent } = fakeTransport();
      __setHostChannelTransportForTest(t);
      expect(await notify(s, kinds), JSON.stringify(kinds)).toBe("mailed");
      expect(sent, JSON.stringify(kinds)).toHaveLength(0);
      expect(sendReporting, JSON.stringify(kinds)).toHaveBeenCalledTimes(1);
    }
  });

  it("gönderim düşerse HEMEN e-posta; soru kaydı 'failed' + yedek e-posta zamanı", async () => {
    const s = await seed();
    await bind(s);
    flagsOn(s.orgId);
    const { t, sent } = fakeTransport({ ok: false });
    __setHostChannelTransportForTest(t);
    expect(await notify(s)).toBe("mailed");
    expect(sent).toHaveLength(1);
    expect(sendReporting).toHaveBeenCalledTimes(1);
    const q = await prisma.hostQuestion.findFirstOrThrow();
    expect(q.status).toBe("failed");
    expect(q.fallbackEmailAt).not.toBeNull();
  });

  it("liste dışı işletme / bağlantı yok / oturum kuşağı değişti (şifre değişimi) → e-posta", async () => {
    const s = await seed();
    await bind(s);
    const { t, sent } = fakeTransport();
    __setHostChannelTransportForTest(t);
    vi.stubEnv("HOST_CHANNEL_ENABLED", "1");
    vi.stubEnv("HOST_QUESTIONS_ENABLED", "1");
    vi.stubEnv("HOST_CHANNEL_ORG_IDS", "baska-isletme");
    expect(await notify(s)).toBe("mailed");
    expect(sent).toHaveLength(0);

    await resetDb();
    sendReporting.mockClear();
    const s2 = await seed();
    flagsOn(s2.orgId);
    expect(await notify(s2)).toBe("mailed"); // bağlantı yok
    expect(sent).toHaveLength(0);

    await resetDb();
    sendReporting.mockClear();
    const s3 = await seed();
    await bind(s3);
    flagsOn(s3.orgId);
    await prisma.user.update({ where: { id: s3.userId }, data: { sessionEpoch: { increment: 1 } } });
    expect(await notify(s3)).toBe("mailed");
    expect(sent).toHaveLength(0);
    expect(sendReporting).toHaveBeenCalledTimes(1);
  });

  it("🚨 numara anahtarı değiştiyse (özet tutmuyor) soru GİTMEZ: bağlantı kapanır, e-posta gider (gelen DUR artık eşleşmezdi)", async () => {
    const s = await seed();
    await bind(s);
    flagsOn(s.orgId);
    vi.stubEnv("HOST_CHANNEL_HMAC_SECRET", "baska-host-channel-secret-0123456789abcdef");
    const { t, sent } = fakeTransport();
    __setHostChannelTransportForTest(t);
    expect(await notify(s)).toBe("mailed");
    expect(sent).toHaveLength(0);
    expect(sendReporting).toHaveBeenCalledTimes(1);
    expect(await prisma.hostChannelBinding.findFirstOrThrow()).toMatchObject({ status: "revoked", revokedReason: "key_rotated" });
    expect(await prisma.hostQuestion.count()).toBe(0);
  });

  it("aktarım yapılandırılmamış (WhatsApp kimlik bilgisi yok) → e-posta", async () => {
    const s = await seed();
    await bind(s);
    flagsOn(s.orgId);
    __setHostChannelTransportForTest(null);
    expect(await notify(s)).toBe("mailed");
    expect(sendReporting).toHaveBeenCalledTimes(1);
    expect(await prisma.hostQuestion.count()).toBe(0);
  });
});
