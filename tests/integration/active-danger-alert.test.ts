import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// DEVAM EDEN TEHLİKE UÇTAN UCA (kurucu 10-31, `docs/TASARIM-2026-10-31-devam-eden-tehlike-uyarisi.md`). Kurucu: "Test yalnız 'acil sınıfına
// girdi' dememeli: doğru host için bildirim oluşturuldu mu, kuyruğa kaydedildi mi, gönderim başarısızsa görünür oldu mu? Aynı olayın
// tekrarları bildirim yağmuruna dönüşmesin; aynı konuşmadaki yeni bir tehlike de eski bildirim yüzünden bastırılmasın."
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
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn(async () => {}) };
});

import { emailService } from "@/lib/email";
import { suggestReply } from "@/lib/ai";
import { sendOnChannel } from "@/lib/messaging";
import { reportError } from "@/lib/report-error";
import { applyChannelAutoReply, sendDueAlerts } from "@/lib/automation";
import { __setHostChannelTransportForTest } from "@/lib/host-channel-runtime";
import { startHostBinding, confirmHostBindingFromInbound } from "@/lib/host-channel/binding";
import { WHATSAPP_CLOUD_PROVIDER } from "@/lib/host-channel/providers";
import type { HostChannelTransport, HostQuestionMessage } from "@/lib/host-channel/types";

const mockMail = vi.mocked(emailService.sendReporting);
const mockSuggest = vi.mocked(suggestReply);
const mockSend = vi.mocked(sendOnChannel);
const mockReport = vi.mocked(reportError);

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

const BASE = {
  intent: "general",
  confidence: 0.92,
  reply: "Hemen bakıyoruz.",
  risk: null,
  priority: "standard" as const,
  source: "openai" as const,
  actionSuggestion: null,
  riskLevel: "none" as const,
  detectedLanguage: "tr",
  riskType: null,
  usedSources: [],
  sourceAudit: { declared: 0, verified: 0 },
  missingInfo: [],
  statedCheckoutTime: null,
};

function flags() {
  vi.stubEnv("HOST_CHANNEL_ENABLED", "1");
  vi.stubEnv("HOST_CHANNEL_ORG_IDS", "*");
  vi.stubEnv("HOST_CHANNEL_HMAC_SECRET", "test-host-channel-secret-0123456789abcdef");
  vi.stubEnv("HOST_QUESTION_ALERTS_ENABLED", "1");
}

let seq = 0;
/** Uyarı adresli işletme + rezervasyona bağlı konuşma + doğrulanmış WhatsApp numarası. */
async function seed(body: string, opts: { email?: string; phone?: string; conversation?: Record<string, unknown>; minutesAgo?: number } = {}) {
  seq++;
  const email = opts.email ?? `host${seq}@example.com`;
  const phone = opts.phone ?? `+90 532 111 22 ${String(10 + seq).slice(-2)}`;
  const o = await prisma.organization.create({
    data: { name: `Org ${seq}`, alertEmail: email, autoReplyHospitable: true, autoReplyStartHour: 0, autoReplyEndHour: 0, timezone: "Europe/Istanbul" },
  });
  const user = await prisma.user.create({
    data: { organizationId: o.id, name: "Ayla", email: `u${seq}${Math.random().toString(36).slice(2)}@example.test`, passwordHash: "x", role: "owner" },
  });
  const p = await prisma.property.create({ data: { organizationId: o.id, name: `Lale ${seq}`, checkInTime: "15:00", checkOutTime: "11:00" } });
  const r = await prisma.reservation.create({
    data: { propertyId: p.id, guestName: "Alex Doe", arrivalDate: new Date("2026-11-12T00:00:00Z"), departureDate: new Date("2026-11-15T00:00:00Z"), status: "confirmed", channel: "airbnb" },
  });
  const when = new Date(Date.now() - (opts.minutesAgo ?? 2) * 60_000);
  const c = await prisma.conversation.create({
    data: {
      propertyId: p.id,
      channel: "airbnb",
      guestIdentifier: "Alex",
      status: "new",
      externalReservationId: `res-${p.id}`,
      reservationId: r.id,
      lastMessageAt: when,
      ...opts.conversation,
      messages: { create: [{ direction: "inbound", senderName: "Alex", body, createdAt: when }] },
    },
    include: { messages: true },
  });
  const b = await startHostBinding({ organizationId: o.id, userId: user.id, provider: WHATSAPP_CLOUD_PROVIDER, rawNumber: phone, optInTextVersion: "v1" });
  if (!b.ok) throw new Error(b.reason);
  const v = await confirmHostBindingFromInbound({ provider: WHATSAPP_CLOUD_PROVIDER, fromDigits: phone.replace(/\D/g, ""), code: b.code });
  if (!v.ok) throw new Error(v.reason);
  return { orgId: o.id, email, phoneDigits: phone.replace(/\D/g, ""), conversationId: c.id, messageId: c.messages[0]!.id, propertyName: p.name };
}

async function addGuestMessage(conversationId: string, body: string, at = new Date()) {
  const m = await prisma.message.create({ data: { conversationId, direction: "inbound", senderName: "Alex", body, createdAt: at } });
  await prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: at } });
  return m.id;
}

const alertRows = (conversationId: string) => prisma.hostQuestion.findMany({ where: { conversationId, kind: "alert" }, orderBy: { createdAt: "asc" } });
const conv = (id: string) => prisma.conversation.findUniqueOrThrow({ where: { id } });

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  alerts.length = 0;
  mockMail.mockResolvedValue({ ok: true } as never);
  mockSend.mockResolvedValue({ ok: true, externalId: "ext-1" } as never);
  __setHostChannelTransportForTest(transport);
  flags();
});
afterEach(() => {
  __setHostChannelTransportForTest(undefined);
  vi.unstubAllEnvs();
});

describe("kurucunun tablosu — uyarı geçişi (model yok)", () => {
  it("🚨 'Biri kapıyı zorluyor!' → DOĞRU ev sahibine acil e-posta + WhatsApp bildirimi kuyrukta; konuşma Sorunlu + Acil; başka işletmeye hiçbir şey", async () => {
    const a = await seed("Biri kapıyı zorluyor!");
    const b = await seed("Merhaba, Wi-Fi şifresi nedir?");
    expect((await sendDueAlerts(a.orgId)).alerted).toBe(1);
    expect((await sendDueAlerts(b.orgId)).alerted).toBe(0);
    // E-posta: yalnız A'nın uyarı adresine, konu A'nın dairesi.
    expect(mockMail).toHaveBeenCalledTimes(1);
    expect(mockMail.mock.calls[0]![0]).toBe(a.email);
    expect(mockMail.mock.calls[0]![1]).toContain(a.propertyName);
    // WhatsApp: yalnız A'nın doğrulanmış numarasına; bildirim satırı kayıtlı (kuyruk / iz).
    expect(alerts.map((x) => x.to)).toEqual([a.phoneDigits]);
    expect(await alertRows(a.conversationId)).toMatchObject([{ status: "alerted", turnMessageId: a.messageId, organizationId: a.orgId }]);
    expect(await alertRows(b.conversationId)).toEqual([]);
    expect(await conv(a.conversationId)).toMatchObject({ status: "problem", priority: "urgent", lastRiskType: "safety_emergency" });
    expect(await conv(b.conversationId)).toMatchObject({ status: "new" });
  });

  it("🚨 'Asansörde kaldık, çıkamıyoruz.' → acil uyarı", async () => {
    const s = await seed("Asansörde kaldık, çıkamıyoruz.");
    expect((await sendDueAlerts(s.orgId)).alerted).toBe(1);
    expect(alerts).toHaveLength(1);
    expect(mockMail).toHaveBeenCalledTimes(1);
  });

  it.each(["Hırsızlığa karşı kasa var mı?", "Asansörde mahsur kalırsak kimi arayacağız?"])("'%s' → uyarı YOK, konuşma yeni kalır", async (msg) => {
    const s = await seed(msg);
    expect((await sendDueAlerts(s.orgId)).alerted).toBe(0);
    expect(mockMail).not.toHaveBeenCalled();
    expect(alerts).toHaveLength(0);
    expect(await conv(s.conversationId)).toMatchObject({ status: "new" });
  });

  it.each(["Kapıyı mı zorluyorlar?", "Evde hırsız var mı?", "Has anyone ever been trapped in the elevator?"])(
    "soru biçimi '%s' model OLMAYAN uyarı geçişinde tam acil uyarı üretmez (karar anlama modelinin; model yoksa kanal kapısı tutar)",
    async (msg) => {
      const s = await seed(msg);
      expect((await sendDueAlerts(s.orgId)).alerted).toBe(0);
      expect(alerts).toHaveLength(0);
    },
  );

  it("aynı mesaj ikinci geçişte ikinci uyarı ÜRETMEZ", async () => {
    const s = await seed("Someone is trying to break in!");
    await sendDueAlerts(s.orgId);
    await sendDueAlerts(s.orgId);
    expect(mockMail).toHaveBeenCalledTimes(1);
    expect(alerts).toHaveLength(1);
  });
});

describe("gönderim başarısız → görünür + yeniden dener", () => {
  it("🚨 e-posta düşerse talep geri alınır (sonraki geçiş yeniden dener), alarm yazılır; WhatsApp bildirimi tekrarlanmaz", async () => {
    const s = await seed("Bizi tehdit ediyor, kapının önünde bekliyor");
    mockMail.mockResolvedValueOnce({ ok: false } as never);
    expect((await sendDueAlerts(s.orgId)).alerted).toBe(0);
    expect(mockReport).toHaveBeenCalledWith(expect.stringContaining("sendDueAlerts"), expect.any(Error));
    // Rozet görünür kalır, satır yeniden seçilebilir.
    expect(await conv(s.conversationId)).toMatchObject({ status: "new", skippedReason: "complaint", lastRiskType: "safety_emergency" });
    expect((await sendDueAlerts(s.orgId)).alerted).toBe(1);
    expect(mockMail).toHaveBeenCalledTimes(2);
    expect(alerts).toHaveLength(1);
    expect(await alertRows(s.conversationId)).toHaveLength(1);
  });
});

describe("Sorunlu konuşmada tekrar ↔ yeni tehlike", () => {
  it("🚨 şikâyetle Sorunlu konuşma: yeni tehlike uyarır; aynı olayın tekrarı yağmur yapmaz; YENİ tür tehlike yine uyarır; sebep korunur", async () => {
    const marked = new Date(Date.now() - 30 * 60_000);
    const s = await seed("Daire çok kirli, hiç temizlenmemiş!", {
      minutesAgo: 40,
      conversation: { status: "problem", skippedReason: "complaint", priority: "standard", aiTriagedAt: marked },
    });
    // 1) Yeni tehlike → uyarı (eskiden hiçbir yoldan uyarılmıyordu).
    await addGuestMessage(s.conversationId, "Biri kapıyı zorluyor!", new Date(Date.now() - 5 * 60_000));
    expect((await sendDueAlerts(s.orgId)).alerted).toBe(1);
    expect(mockMail).toHaveBeenCalledTimes(1);
    expect(alerts).toHaveLength(1);
    const after1 = await conv(s.conversationId);
    expect(after1).toMatchObject({ status: "problem", skippedReason: "complaint", priority: "urgent", lastRiskType: "safety_emergency" });
    expect(after1.aiTriagedAt!.getTime()).toBeGreaterThan(marked.getTime());
    // 2) Aynı olayın tekrarı → uyarı YOK.
    await addGuestMessage(s.conversationId, "Biri hâlâ kapıyı zorluyor!", new Date(Date.now() + 1_000));
    expect((await sendDueAlerts(s.orgId)).alerted).toBe(0);
    expect(mockMail).toHaveBeenCalledTimes(1);
    expect(alerts).toHaveLength(1);
    // 3) Yeni tür tehlike → yine uyarı.
    await addGuestMessage(s.conversationId, "Şimdi de mutfakta yangın çıktı!", new Date(Date.now() + 2_000));
    expect((await sendDueAlerts(s.orgId)).alerted).toBe(1);
    expect(mockMail).toHaveBeenCalledTimes(2);
    expect(alerts).toHaveLength(2);
    expect(await conv(s.conversationId)).toMatchObject({ skippedReason: "complaint" });
  });

  it("🚨 bildirim damgası = okunan EN YENİ mesajın anı ('şimdi' değil): okuma ile talep arasında gelen mesaj sonraki geçişte görülür", async () => {
    const s = await seed("Daire çok kirli!", {
      minutesAgo: 40,
      conversation: { status: "problem", skippedReason: "complaint", aiTriagedAt: new Date(Date.now() - 30 * 60_000) },
    });
    const at = new Date(Date.now() - 2 * 60_000);
    await addGuestMessage(s.conversationId, "Biri kapıyı zorluyor!", at);
    expect((await sendDueAlerts(s.orgId)).alerted).toBe(1);
    expect((await conv(s.conversationId)).aiTriagedAt!.getTime()).toBe(at.getTime());
  });

  it("bildirim anı bilinmeyen (elle / eski) Sorunlu konuşmada yalnız son 3 saat taranır — 5 saat önceki tehlike yeniden bildirilmez", async () => {
    const s = await seed("Biri kapıyı zorluyor!", { minutesAgo: 5 * 60, conversation: { status: "problem", skippedReason: null, aiTriagedAt: null } });
    expect((await sendDueAlerts(s.orgId)).alerted).toBe(0);
    await addGuestMessage(s.conversationId, "Asansörde mahsur kaldık!", new Date(Date.now() - 60_000));
    expect((await sendDueAlerts(s.orgId)).alerted).toBe(1);
  });

  it("Sorunlu konuşmada tehlike olmayan yeni mesaj uyarı üretmez (şikâyet zaten ev sahibinde)", async () => {
    const s = await seed("Klima çalışmıyor", {
      minutesAgo: 40,
      conversation: { status: "problem", skippedReason: "complaint", aiTriagedAt: new Date(Date.now() - 30 * 60_000) },
    });
    await addGuestMessage(s.conversationId, "Ayrıca havlu da yok, iade istiyorum", new Date(Date.now() - 60_000));
    expect((await sendDueAlerts(s.orgId)).alerted).toBe(0);
    expect(mockMail).not.toHaveBeenCalled();
  });

  it("🚨 Sorunlu konuşmada yeni tehlikenin e-postası düşerse talep geri alınır: önceki bildirim anı / öncelik / risk türü aynen döner", async () => {
    const marked = new Date(Date.now() - 30 * 60_000);
    const s = await seed("Daire çok kirli!", {
      minutesAgo: 40,
      conversation: { status: "problem", skippedReason: "escalated_to_human", priority: "standard", lastRiskType: "complaint", aiTriagedAt: marked },
    });
    await addGuestMessage(s.conversationId, "Asansörde mahsur kaldık!", new Date(Date.now() - 60_000));
    mockMail.mockResolvedValueOnce({ ok: false } as never);
    expect((await sendDueAlerts(s.orgId)).alerted).toBe(0);
    const rolled = await conv(s.conversationId);
    expect(rolled).toMatchObject({ status: "problem", skippedReason: "escalated_to_human", priority: "standard", lastRiskType: "complaint" });
    expect(rolled.aiTriagedAt!.getTime()).toBe(marked.getTime());
    expect((await sendDueAlerts(s.orgId)).alerted).toBe(1);
  });
});

describe("model yolu (oto-yanıt açık): misafire cevap gitmez, ev sahibine uyarı gider", () => {
  it("kişisel tehlike bakım görevi AÇMAZ — görev ayarı açık işletmede de (uyarı geçişi etiketi `safety_emergency` yazsa bile)", async () => {
    const s = await seed("Biri kapıyı zorluyor!");
    await prisma.organization.update({ where: { id: s.orgId }, data: { autoTaskFromMessageEnabled: true } });
    expect((await sendDueAlerts(s.orgId)).alerted).toBe(1);
    expect(await prisma.task.count()).toBe(0);
  });

  it("🚨 model 'risk yok' dese de açık kişisel tehlikede cevap gönderilmez; sonraki uyarı geçişi ev sahibini uyarır", async () => {
    mockSuggest.mockResolvedValue(BASE as never);
    const s = await seed("Biri kapıyı zorluyor!");
    await applyChannelAutoReply(s.conversationId);
    expect(mockSend).not.toHaveBeenCalled();
    expect((await sendDueAlerts(s.orgId)).alerted).toBe(1);
    expect(alerts).toHaveLength(1);
  });
});
