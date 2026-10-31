import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// Acil bildirim (WhatsApp, Tür C) "⚠️ Acil misafir mesajı" e-postasının gittiği HER yolda e-postanın YANINDA (tasarım §3.1 dilim 4):
//  · kelime ağı acil / şikâyet (`sendDueAlerts`) — yangın, gaz, CO: ürünün en kritik bildirimi
//  · model yükseltmesi (`applyChannelAutoReply`, `escalated_to_human`)
//  · olası tehlike + anlama katmanı koşmadı (kurucu T2, `escalateUnverifiedHazard`)
// (Tutulan öğe yolu `conversation-items-auto-reply.test.ts` / `conversation-items-mail-race.test.ts`.) Her yolun KONTROLÜ: anahtar kapalı →
// yalnız e-posta, veritabanına bildirim satırı yazılmaz. Mesaj başına TEK WhatsApp — e-posta düşüp yol yeniden denense de.
// ---------------------------------------------------------------------------

vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) },
}));
vi.mock("@/lib/ai", () => ({ suggestReply: vi.fn(), classifyMessage: vi.fn(), summarizeHostStyle: vi.fn() }));
vi.mock("@/lib/messaging", async (orig) => ({
  ...(await orig<typeof import("@/lib/messaging")>()),
  sendOnChannel: vi.fn(),
}));
vi.mock("@/lib/hospitable-credentials", () => ({ getOrgHospitableToken: vi.fn(async () => "tok") }));
// Anlama katmanı yalnız açıkça istenen testte sahte (varsayılan: gerçek modül — öteki testlerin davranışı değişmez).
const understandStub = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/lib/ai/semantic/understand", async (orig) => {
  const actual = await orig<typeof import("@/lib/ai/semantic/understand")>();
  return {
    ...actual,
    understandingEnabled: (...a: Parameters<typeof actual.understandingEnabled>) => (understandStub.value ? true : actual.understandingEnabled(...a)),
    understandGuestMessages: (...a: Parameters<typeof actual.understandGuestMessages>) =>
      understandStub.value ? Promise.resolve({ status: "ok", value: understandStub.value, ms: 1, cached: false }) : actual.understandGuestMessages(...a),
  };
});
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn(async () => {}) };
});

import { emailService } from "@/lib/email";
import { suggestReply } from "@/lib/ai";
import { sendOnChannel } from "@/lib/messaging";
import { applyChannelAutoReply, sendDueAlerts } from "@/lib/automation";
import { escalateUnverifiedHazard, HAZARD_UNVERIFIED_EMAILS_PER_HOUR, HAZARD_UNVERIFIED_REASON, hazardUnverifiedMailKey } from "@/lib/hazard-unverified-alert";
import { rateLimit } from "@/lib/rate-limit";
import { __resetUnderstandingCache } from "@/lib/ai/semantic/understand";
import { __setHostChannelTransportForTest } from "@/lib/host-channel-runtime";
import { startHostBinding, confirmHostBindingFromInbound } from "@/lib/host-channel/binding";
import { WHATSAPP_CLOUD_PROVIDER } from "@/lib/host-channel/providers";
import type { HostChannelTransport, HostQuestionMessage } from "@/lib/host-channel/types";
import { deliverDueAlertEmails } from "@/lib/host-channel/alert-email";
import { recordHostDeliveryStatuses } from "@/lib/host-channel/delivery-status";
import { parseUnderstanding } from "@/lib/ai/semantic/understanding-schema";

const mockMail = vi.mocked(emailService.sendReporting);
const mockSuggest = vi.mocked(suggestReply);
const mockSend = vi.mocked(sendOnChannel);

const alerts: { to: string; message: HostQuestionMessage }[] = [];
const transport: HostChannelTransport = {
  provider: WHATSAPP_CLOUD_PROVIDER,
  sendQuestion: async () => ({ ok: true, providerMessageId: "wamid.q" }),
  sendAlert: async (to, message) => {
    alerts.push({ to, message });
    return { ok: true, providerMessageId: `wamid.alert${alerts.length}` };
  },
  sendText: async () => ({ ok: true, providerMessageId: "wamid.t" }),
  sendChoices: async () => ({ ok: true, providerMessageId: "wamid.c" }),
};

function flags(alertsOn: boolean) {
  vi.stubEnv("HOST_CHANNEL_ENABLED", "1");
  vi.stubEnv("HOST_CHANNEL_ORG_IDS", "*");
  vi.stubEnv("HOST_CHANNEL_HMAC_SECRET", "test-host-channel-secret-0123456789abcdef");
  vi.stubEnv("HOST_QUESTION_ALERTS_ENABLED", alertsOn ? "1" : "");
}

/** Uyarı adresli işletme + rezervasyona bağlı konuşma + doğrulanmış WhatsApp numarası. */
async function seed(body: string, org: Record<string, unknown> = {}, phone = "+90 532 111 22 33") {
  const o = await prisma.organization.create({
    data: { name: "Org", alertEmail: "host@example.com", autoReplyHospitable: true, autoReplyStartHour: 0, autoReplyEndHour: 0, timezone: "Europe/Istanbul", ...org },
  });
  const user = await prisma.user.create({
    data: { organizationId: o.id, name: "Ayla", email: `u${Math.random().toString(36).slice(2)}@example.test`, passwordHash: "x", role: "owner" },
  });
  const p = await prisma.property.create({ data: { organizationId: o.id, name: "Lale 7", checkInTime: "15:00", checkOutTime: "11:00" } });
  const r = await prisma.reservation.create({
    data: { propertyId: p.id, guestName: "Alex Doe", arrivalDate: new Date("2026-11-12T00:00:00Z"), departureDate: new Date("2026-11-15T00:00:00Z"), status: "confirmed", channel: "airbnb" },
  });
  const when = new Date(Date.now() - 2 * 60_000);
  const c = await prisma.conversation.create({
    data: {
      propertyId: p.id,
      channel: "airbnb",
      guestIdentifier: "Alex",
      status: "new",
      externalReservationId: `res-${p.id}`,
      reservationId: r.id,
      lastMessageAt: when,
      messages: { create: [{ direction: "inbound", senderName: "Alex", body, createdAt: when }] },
    },
    include: { messages: true },
  });
  const b = await startHostBinding({ organizationId: o.id, userId: user.id, provider: WHATSAPP_CLOUD_PROVIDER, rawNumber: phone, optInTextVersion: "v1" });
  if (!b.ok) throw new Error(b.reason);
  const v = await confirmHostBindingFromInbound({ provider: WHATSAPP_CLOUD_PROVIDER, fromDigits: phone.replace(/\D/g, ""), code: b.code });
  if (!v.ok) throw new Error(v.reason);
  return { orgId: o.id, conversationId: c.id, messageId: c.messages[0]!.id };
}

const alertRows = (conversationId: string) => prisma.hostQuestion.findMany({ where: { conversationId, kind: "alert" } });

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  __resetUnderstandingCache();
  alerts.length = 0;
  mockMail.mockResolvedValue({ ok: true } as never);
  mockSend.mockResolvedValue({ ok: true, externalId: "ext-1" } as never);
  __setHostChannelTransportForTest(transport);
  understandStub.value = null;
});
afterEach(() => {
  __setHostChannelTransportForTest(undefined);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("kelime ağı acil (sendDueAlerts) — yangın / gaz", () => {
  it("🚨 'Dairede yangın çıktı!' → acil e-posta + TEK WhatsApp bildirimi (daire, tarih, alıntı, panel bağlantısı)", async () => {
    flags(true);
    const s = await seed("Dairede yangın çıktı! Alex burada, +90 555 123 45 67");
    expect((await sendDueAlerts(s.orgId)).alerted).toBe(1);
    expect(mockMail).toHaveBeenCalledTimes(1);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ to: "905321112233", message: { property: "Lale 7", dates: "12–15 Kas", link: s.conversationId } });
    expect(alerts[0]!.message.quote).toContain("yangın");
    expect(alerts[0]!.message.quote).not.toMatch(/alex|555 123/iu);
    expect(await alertRows(s.conversationId)).toMatchObject([{ status: "alerted", turnMessageId: s.messageId }]);
  });

  it("e-posta düşer → claim geri alınır → sonraki geçiş e-postayı yeniden dener; WhatsApp İKİNCİ kez gitmez", async () => {
    flags(true);
    const s = await seed("There is a fire in the apartment!");
    mockMail.mockResolvedValueOnce({ ok: false } as never);
    expect((await sendDueAlerts(s.orgId)).alerted).toBe(0);
    // E-posta düşse de WhatsApp İLK geçişte gitti (e-postanın yanında; sonucuna bağlı değil — sert inceleme T-1).
    expect(alerts).toHaveLength(1);
    expect((await sendDueAlerts(s.orgId)).alerted).toBe(1);
    expect(mockMail).toHaveBeenCalledTimes(2);
    expect(alerts).toHaveLength(1);
  });

  it("🚨 karışık tur: önce yangın, sonra zararsız takip → bildirim YANGIN mesajıyla (alıntı + tetik kimliği; T-7)", async () => {
    flags(true);
    const s = await seed("Dairede yangın çıktı!");
    const later = await prisma.message.create({
      data: { conversationId: s.conversationId, direction: "inbound", senderName: "Alex", body: "Teşekkürler", createdAt: new Date(Date.now() - 60_000) },
    });
    await prisma.conversation.update({ where: { id: s.conversationId }, data: { lastMessageAt: later.createdAt } });
    expect((await sendDueAlerts(s.orgId)).alerted).toBe(1);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.message.quote).toContain("yangın");
    expect(await alertRows(s.conversationId)).toMatchObject([{ turnMessageId: s.messageId }]);
  });

  it("KONTROL: anahtar kapalı → yalnız e-posta, bildirim satırı yok", async () => {
    flags(false);
    const s = await seed("Dairede yangın çıktı!");
    expect((await sendDueAlerts(s.orgId)).alerted).toBe(1);
    expect(mockMail).toHaveBeenCalledTimes(1);
    expect(alerts).toHaveLength(0);
    expect(await alertRows(s.conversationId)).toEqual([]);
  });
});

describe("model yükseltmesi (applyChannelAutoReply → escalated_to_human)", () => {
  const highRisk = {
    intent: "complaint",
    confidence: 0.9,
    reply: "—",
    risk: "Kötü yorum tehdidi",
    priority: "urgent" as const,
    source: "openai" as const,
    actionSuggestion: null,
    riskLevel: "high" as const,
    detectedLanguage: "tr",
    riskType: "review_threat",
    usedSources: [],
    missingInfo: [],
    statedCheckoutTime: null,
  };
  beforeEach(() => {
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    mockSuggest.mockResolvedValue(highRisk as never);
  });

  it("🚨 model yüksek risk dedi (can güvenliği DEĞİL) → TEK WhatsApp şimdi, e-posta 10 dk ertelenir; okunmazsa vadede BİR kez gider; misafire bir şey gitmez", async () => {
    flags(true);
    const s = await seed("Bu konuda değerlendirmemi paylaşmadan önce sizinle görüşmek istiyorum.", {
      autoReplyEnabledAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    });
    const out = await applyChannelAutoReply(s.conversationId);
    expect(out.skippedReason).toBe("escalated_to_human");
    expect(mockSend).not.toHaveBeenCalled();
    expect(alerts).toHaveLength(1);
    expect(mockMail).not.toHaveBeenCalled();
    expect(await alertRows(s.conversationId)).toMatchObject([{ status: "alerted", turnMessageId: s.messageId }]);
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: s.conversationId } })).status).toBe("problem");
    // Vade dolmadan gitmez; dolunca bir kez (sağlayıcı tekrar anahtarıyla); ikinci geçiş tekrarlamaz.
    expect((await deliverDueAlertEmails(new Date(Date.now() + 5 * 60_000))).sent).toBe(0);
    expect(mockMail).not.toHaveBeenCalled();
    expect((await deliverDueAlertEmails(new Date(Date.now() + 11 * 60_000))).sent).toBe(1);
    expect(mockMail).toHaveBeenCalledTimes(1);
    expect(mockMail.mock.calls[0]![0]).toBe("host@example.com");
    expect(mockMail.mock.calls[0]![3]).toEqual({ idempotencyKey: `host-alert-mail:${s.messageId}` });
    expect((await deliverDueAlertEmails(new Date(Date.now() + 30 * 60_000))).sent).toBe(0);
    expect(mockMail).toHaveBeenCalledTimes(1);
  });

  it("🚨 can güvenliği turun ÖNCEKİ cevapsız mesajında ('asansörde mahsur kaldık'), son mesaj sıradan → ikisi birden hemen", async () => {
    flags(true);
    const s = await seed("Bu konuda değerlendirmemi paylaşmadan önce sizinle görüşmek istiyorum.", {
      autoReplyEnabledAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    });
    await prisma.message.create({
      data: { conversationId: s.conversationId, direction: "inbound", senderName: "Alex", body: "Asansörde mahsur kaldık!", createdAt: new Date(Date.now() - 5 * 60_000) },
    });
    await applyChannelAutoReply(s.conversationId);
    expect(alerts).toHaveLength(1);
    expect(mockMail).toHaveBeenCalledTimes(1);
    expect(await prisma.systemLock.count({ where: { name: { startsWith: "host-alert-mail:" } } })).toBe(0);
  });

  it("🚨 anlama katmanı 'acil' dedi (metin can güvenliği sözcüğü taşımıyor) → ikisi birden hemen", async () => {
    flags(true);
    const s = await seed("Bu konuda değerlendirmemi paylaşmadan önce sizinle görüşmek istiyorum.", {
      autoReplyEnabledAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    });
    understandStub.value = parseUnderstanding(
      {
        language: "tr",
        requests: [{ intent: "emergency", message: 1, query_tr: "acil durum", query_original: "q" }],
        stay_change: { requested: false, kind: "none", checkin_time: null, checkout_time: null },
        withdrawn: [],
      },
      { items: false },
    );
    expect(understandStub.value).not.toBeNull();
    await applyChannelAutoReply(s.conversationId);
    expect(alerts).toHaveLength(1);
    expect(mockMail).toHaveBeenCalledTimes(1);
    expect(await prisma.systemLock.count({ where: { name: { startsWith: "host-alert-mail:" } } })).toBe(0);
  });

  it("🚨 WhatsApp bildirimi OKUNDU → ertelenen acil e-posta HİÇ gitmez (kurucu 10-31: yığılmasın); claim tutulur (T-1)", async () => {
    flags(true);
    const s = await seed("Bu konuda değerlendirmemi paylaşmadan önce sizinle görüşmek istiyorum.", {
      autoReplyEnabledAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    });
    await applyChannelAutoReply(s.conversationId);
    expect(alerts).toHaveLength(1);
    await recordHostDeliveryStatuses([{ providerMessageId: "wamid.alert1", status: "read", recipient: "905321112233", at: new Date(), errorCode: null }]);
    expect(await deliverDueAlertEmails(new Date(Date.now() + 11 * 60_000))).toMatchObject({ sent: 0, cancelled_read: 1 });
    expect(mockMail).not.toHaveBeenCalled();
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: s.conversationId } })).status).toBe("problem");
  });

  it("🚨 WhatsApp numarası BAĞLI DEĞİL → e-posta HEMEN (bugünkü gibi), ertelenmiş kayıt kalmaz", async () => {
    flags(true);
    const s = await seed("Bu konuda değerlendirmemi paylaşmadan önce sizinle görüşmek istiyorum.", {
      autoReplyEnabledAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    });
    await prisma.hostChannelBinding.updateMany({ where: { organizationId: s.orgId }, data: { status: "revoked" } });
    await applyChannelAutoReply(s.conversationId);
    expect(alerts).toHaveLength(0);
    expect(mockMail).toHaveBeenCalledTimes(1);
    expect(await prisma.systemLock.count({ where: { name: { startsWith: "host-alert-mail:" } } })).toBe(0);
  });

  it("KONTROL: anahtar kapalı → yalnız e-posta", async () => {
    flags(false);
    const s = await seed("Bu konuda değerlendirmemi paylaşmadan önce sizinle görüşmek istiyorum.", {
      autoReplyEnabledAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    });
    await applyChannelAutoReply(s.conversationId);
    expect(mockMail).toHaveBeenCalledTimes(1);
    expect(alerts).toHaveLength(0);
  });
});

describe("olası tehlike + anlama katmanı koşmadı (kurucu T2)", () => {
  const SHORT = "Kısa devre oldu, wifi şifresi neydi?";
  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("KB_RETRIEVAL_MODE", "legacy");
    mockSuggest.mockResolvedValue({
      intent: "wifi",
      confidence: 0.92,
      reply: "Wi-Fi ağı Lale_5G.",
      risk: null,
      priority: "standard",
      source: "openai",
      actionSuggestion: null,
      riskLevel: "none",
      detectedLanguage: "tr",
      riskType: null,
      usedSources: [],
      sourceAudit: { declared: 0, verified: 0 },
      missingInfo: [],
      statedCheckoutTime: null,
    } as never);
  });

  it("🚨 kanal yolu: konuşma Sorunlu + seyrek acil e-posta + TEK WhatsApp; aynı olay yeniden işlenince ikisi de tekrar yok", async () => {
    flags(true);
    const s = await seed(SHORT);
    await applyChannelAutoReply(s.conversationId);
    expect(await prisma.conversation.findUniqueOrThrow({ where: { id: s.conversationId } })).toMatchObject({
      status: "problem",
      skippedReason: HAZARD_UNVERIFIED_REASON,
    });
    expect(mockMail).toHaveBeenCalledTimes(1);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.message.quote).toContain("Kısa devre");
    await applyChannelAutoReply(s.conversationId);
    expect(mockMail).toHaveBeenCalledTimes(1);
    expect(alerts).toHaveLength(1);
  });

  it("kanca: e-postayla birlikte tetik mesajıyla bir kez; fırlatsa da e-posta gider; alıcı yoksa ya da sınır doluysa çağrılmaz", async () => {
    flags(true);
    const s = await seed(SHORT);
    const conversation = { id: s.conversationId, guestIdentifier: "Alex", channel: "airbnb", property: { name: "Lale 7", address: null, city: null } };
    const hook = vi.fn(async () => {
      throw new Error("meta down");
    });
    const out = await escalateUnverifiedHazard({ organizationId: s.orgId, conversation, trigger: { id: s.messageId, body: SHORT }, onAlert: hook });
    expect(out).toEqual({ claimed: true, mailed: true, capped: false });
    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook).toHaveBeenCalledWith(s.messageId, SHORT);

    // Alıcısı olmayan işletme: işaret konur, e-posta da bildirim de yok.
    const t = await seed(SHORT, { alertEmail: null }, "+90 532 111 22 44");
    await prisma.user.updateMany({ where: { organizationId: t.orgId }, data: { role: "staff" } });
    const quiet = vi.fn(async () => null);
    const conv2 = { ...conversation, id: t.conversationId };
    expect(await escalateUnverifiedHazard({ organizationId: t.orgId, conversation: conv2, trigger: { id: t.messageId, body: SHORT }, onAlert: quiet })).toEqual({
      claimed: true,
      mailed: false,
      capped: false,
    });
    expect(quiet).not.toHaveBeenCalled();

    // Saatlik e-posta sınırı dolu: işaret konur, e-posta da bildirim de yok.
    const u = await seed(SHORT, {}, "+90 532 111 22 55");
    for (let i = 0; i < HAZARD_UNVERIFIED_EMAILS_PER_HOUR; i++) await rateLimit(hazardUnverifiedMailKey(u.orgId), HAZARD_UNVERIFIED_EMAILS_PER_HOUR, 3_600_000);
    const capped = vi.fn(async () => null);
    const conv3 = { ...conversation, id: u.conversationId };
    expect(await escalateUnverifiedHazard({ organizationId: u.orgId, conversation: conv3, trigger: { id: u.messageId, body: SHORT }, onAlert: capped })).toEqual({
      claimed: true,
      mailed: false,
      capped: true,
    });
    expect(capped).not.toHaveBeenCalled();
  });

  it("kanca e-postayla AYNI ANDA başlar (e-posta kancayı beklemez) ve e-posta düşse de çağrılır (T-1 / T-4)", async () => {
    flags(true);
    const s = await seed(SHORT);
    const conversation = { id: s.conversationId, guestIdentifier: "Alex", channel: "airbnb", property: { name: "Lale 7", address: null, city: null } };
    const order: string[] = [];
    let hookStarted!: () => void;
    const hookSeen = new Promise<void>((r) => (hookStarted = r));
    // E-posta, kanca başlayana kadar (en çok 1,5 sn) bekler: sıralı kodda (önce e-posta bitsin) zaman aşımıyla biter, sıra bozulur.
    mockMail.mockImplementationOnce((async () => {
      order.push("mail-start");
      await Promise.race([hookSeen, new Promise((r) => setTimeout(r, 1_500))]);
      order.push("mail-done");
      return { ok: false };
    }) as never);
    const hook = vi.fn(async () => {
      order.push("hook-start");
      hookStarted();
      // Gerçek bir bekleme: çağıran kancayı beklemezse "hook-done" dönüşte henüz yazılmamış olur.
      await new Promise((r) => setTimeout(r, 30));
      order.push("hook-done");
    });
    const out = await escalateUnverifiedHazard({ organizationId: s.orgId, conversation, trigger: { id: s.messageId, body: SHORT }, onAlert: hook });
    expect(out).toEqual({ claimed: true, mailed: false, capped: false });
    expect(order).toEqual(["mail-start", "hook-start", "mail-done", "hook-done"]);
  });

  it("KONTROL: anahtar kapalı → yalnız e-posta", async () => {
    flags(false);
    const s = await seed(SHORT);
    await applyChannelAutoReply(s.conversationId);
    expect(mockMail).toHaveBeenCalledTimes(1);
    expect(alerts).toHaveLength(0);
    expect(await alertRows(s.conversationId)).toEqual([]);
  });
});
