import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const { composeMock } = vi.hoisted(() => ({ composeMock: vi.fn() }));
vi.mock("@/lib/host-channel/compose", () => ({ composeGuestReplyFromHostAnswer: composeMock }));

import { prisma, resetDb } from "../helpers/db";
import { startHostBinding, confirmHostBindingFromInbound } from "@/lib/host-channel/binding";
import { WHATSAPP_CLOUD_PROVIDER } from "@/lib/host-channel/providers";
import { ALERT_HOURLY_CAP, alertHostOnChannel } from "@/lib/host-channel/alert";
import { HOST_TEXTS } from "@/lib/host-channel/answer";
import { handleHostInbound } from "@/lib/host-channel/inbound";
import { hostChannelFlagsFromEnv } from "@/lib/host-channel/routing";
import type { HostChannelTransport, HostQuestionMessage, HostSendResult } from "@/lib/host-channel/types";

// ---------------------------------------------------------------------------
// Acil bildirim — Tür C (tasarım §3.1 dilim 4; kurucu 10-29 gece "en önemli ev sahibi bildirimleri WhatsApp'tan da"). Gerçek veritabanı, sahte
// aktarım. Pinlenen: anahtar kapalıyken veritabanına dokunulmaz; mesaj başına TEK bildirim; işletme saatlik tavanı; misafirin adı / telefonu
// Meta'ya gitmez; gönderilemezse kayıt "failed" (asla fırlatmaz); bildirime yazılan cevap misafire GİTMEZ (panel yönlendirmesi, model çağrılmaz).
// ---------------------------------------------------------------------------

const DIGITS = "905321112233";
type Sent = { kind: "alert" | "text"; to: string; message?: HostQuestionMessage; text?: string };
let sent: Sent[] = [];
let alertResult: HostSendResult = { ok: true, providerMessageId: "wamid.A1" };
const transport: HostChannelTransport = {
  provider: WHATSAPP_CLOUD_PROVIDER,
  sendQuestion: async () => ({ ok: true, providerMessageId: "wamid.q" }),
  sendAlert: async (to, message) => {
    sent.push({ kind: "alert", to, message });
    return alertResult;
  },
  sendText: async (to, text) => {
    sent.push({ kind: "text", to, text });
    return { ok: true, providerMessageId: "wamid.t" };
  },
  sendChoices: async () => ({ ok: true, providerMessageId: "wamid.c" }),
};

async function seed() {
  const org = await prisma.organization.create({ data: { name: "Test Org" } });
  const user = await prisma.user.create({
    data: { organizationId: org.id, name: "Ayla", email: `u${Math.random().toString(36).slice(2)}@example.test`, passwordHash: "x", role: "owner" },
  });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale" } });
  const reservation = await prisma.reservation.create({
    data: { propertyId: property.id, guestName: "Ayşe Yılmaz", arrivalDate: new Date("2026-11-12T00:00:00Z"), departureDate: new Date("2026-11-15T00:00:00Z"), status: "confirmed", channel: "airbnb" },
  });
  const conversation = await prisma.conversation.create({
    data: { propertyId: property.id, channel: "airbnb", guestIdentifier: "Ayşe", status: "new", reservationId: reservation.id },
  });
  const message = await prisma.message.create({
    data: { conversationId: conversation.id, direction: "inbound", senderName: "Ayşe", body: "Ayşe here, we lost the key and are locked out! Call +90 555 123 45 67" },
  });
  const b = await startHostBinding({ organizationId: org.id, userId: user.id, provider: WHATSAPP_CLOUD_PROVIDER, rawNumber: "+90 532 111 22 33", optInTextVersion: "v1" });
  if (!b.ok) throw new Error(b.reason);
  const c = await confirmHostBindingFromInbound({ provider: WHATSAPP_CLOUD_PROVIDER, fromDigits: DIGITS, code: b.code });
  if (!c.ok) throw new Error(c.reason);
  return { orgId: org.id, conversationId: conversation.id, message };
}
const alert = (s: Awaited<ReturnType<typeof seed>>, messageId = s.message.id, body = s.message.body) =>
  alertHostOnChannel({ organizationId: s.orgId, conversationId: s.conversationId, messageId, messageBody: body, transport });

describe("acil bildirim (Tür C)", () => {
  beforeEach(async () => {
    await resetDb();
    sent = [];
    alertResult = { ok: true, providerMessageId: "wamid.A1" };
    composeMock.mockReset();
    vi.stubEnv("HOST_CHANNEL_ENABLED", "1");
    vi.stubEnv("HOST_QUESTION_ALERTS_ENABLED", "1");
    vi.stubEnv("HOST_CHANNEL_ORG_IDS", "*");
    vi.stubEnv("HOST_CHANNEL_HMAC_SECRET", "test-host-channel-secret-0123456789abcdef");
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("anahtarlar açık: tek bildirim — daire + tarih + maskeli alıntı (ad / telefon yok) + panel bağlantısı; kayıt 'alerted'", async () => {
    const s = await seed();
    expect(await alert(s)).toBe("sent");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: "alert", to: DIGITS, message: { property: "Lale", dates: "12–15 Kas", link: s.conversationId } });
    expect(sent[0]!.message!.quote).toContain("locked out");
    expect(sent[0]!.message!.quote).not.toMatch(/ayşe|555 123/iu);
    expect(await prisma.hostQuestion.findFirstOrThrow({ where: { conversationId: s.conversationId } })).toMatchObject({
      kind: "alert",
      status: "alerted",
      providerMessageId: "wamid.A1",
      turnMessageId: s.message.id,
      answerEnc: null,
      draftEnc: null,
      sentAt: expect.any(Date),
    });
    expect(await prisma.operationalEvent.count({ where: { event: "host_channel.alert.sent", organizationId: s.orgId } })).toBe(1);
  });

  it("aynı mesaj ikinci kez (eşzamanlı / yeniden işleme) → ikinci bildirim YOK", async () => {
    const s = await seed();
    const [a, b] = await Promise.all([alert(s), alert(s)]);
    expect([a, b].sort()).toEqual(["duplicate", "sent"]);
    expect(await alert(s)).toBe("duplicate");
    expect(sent).toHaveLength(1);
  });

  it.each([
    ["HOST_CHANNEL_ENABLED", ""],
    ["HOST_QUESTION_ALERTS_ENABLED", ""],
    ["HOST_CHANNEL_ORG_IDS", "baska-org"],
  ])("%s=%j → bildirim yok, veritabanına satır yazılmaz", async (key, value) => {
    const s = await seed();
    vi.stubEnv(key, value);
    expect(await alert(s)).toBe("skipped");
    expect(sent).toHaveLength(0);
    expect(await prisma.hostQuestion.count()).toBe(0);
  });

  it("işletme saatlik tavanı dolduysa bildirim yok (e-posta bugünkü yoldan gider)", async () => {
    const s = await seed();
    const now = new Date();
    for (let i = 0; i < ALERT_HOURLY_CAP; i++) {
      await prisma.hostQuestion.create({
        data: {
          organizationId: s.orgId,
          conversationId: s.conversationId,
          kind: "alert",
          turnMessageId: `m${i}`,
          status: "alerted",
          idempotencyKey: `alert:m${i}`,
          sentAt: new Date(now.getTime() - 10 * 60_000),
          expiresAt: new Date(now.getTime() + 3600_000),
        },
      });
    }
    expect(await alert(s)).toBe("capped");
    expect(sent).toHaveLength(0);
    // Tavan yalnız BİLDİRİMLERİ sayar: aynı saatte giden sorular acili kesmez.
    await prisma.hostQuestion.updateMany({ data: { kind: "info" } });
    expect(await alert(s)).toBe("sent");
    await prisma.hostQuestion.deleteMany({ where: { idempotencyKey: `alert:${s.message.id}` } });
    await prisma.hostQuestion.updateMany({ data: { kind: "alert" } });
    sent = [];
    expect(await alert(s)).toBe("capped");
    // Bir saatten eski bildirimler sayılmaz.
    await prisma.hostQuestion.updateMany({ data: { sentAt: new Date(now.getTime() - 2 * 3600_000) } });
    expect(await alert(s)).toBe("sent");
  });

  it("gönderilemezse kayıt 'failed', fırlatmaz; bağlantı yoksa / rezervasyon yoksa sessizce atlar", async () => {
    const s = await seed();
    alertResult = { ok: false, providerMessageId: null, definitive: true, error: "http_400_132001" };
    expect(await alert(s)).toBe("failed");
    expect((await prisma.hostQuestion.findFirstOrThrow({ where: { conversationId: s.conversationId } })).status).toBe("failed");

    await prisma.conversation.update({ where: { id: s.conversationId }, data: { reservationId: null } });
    const m2 = await prisma.message.create({ data: { conversationId: s.conversationId, direction: "inbound", senderName: "x", body: "help" } });
    expect(await alert(s, m2.id, m2.body)).toBe("skipped");

    await prisma.hostChannelBinding.updateMany({ data: { status: "revoked" } });
    expect(await alert(s, "m3", "help")).toBe("skipped");
  });

  it("🚨 ev sahibi bildirime 'yanıtla' ile yazarsa misafire HİÇBİR ŞEY gitmez, model çağrılmaz — panel bağlantısı", async () => {
    const s = await seed();
    await alert(s);
    sent = [];
    await handleHostInbound({
      provider: WHATSAPP_CLOUD_PROVIDER,
      events: [{ kind: "text", from: DIGITS, providerMessageId: "wamid.h1", contextId: "wamid.A1", text: "tamam geliyorum", at: new Date() }],
      flags: { ...hostChannelFlagsFromEnv(), questions: true },
      transport,
    });
    expect(composeMock).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text!.startsWith(HOST_TEXTS.alertReply)).toBe(true);
    expect(sent[0]!.text!.endsWith(`/inbox/${s.conversationId}`)).toBe(true);
    expect(await prisma.message.count({ where: { conversationId: s.conversationId, direction: "outbound" } })).toBe(0);
  });
});
