import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// KARAR KARTI WHATSAPP'TA (tasarım §3.10, dilim 3; anahtarlar `HOST_DECISIONS_ENABLED` + `HOST_QUESTION_DECISIONS_ENABLED`). Gerçek veritabanı,
// gerçek karar çekirdeği (`decisions/decide.ts` — panel rotasıyla aynı), kanal ve WhatsApp aktarımı SAHTE.
//  · Bildirim: yalnız WhatsApp'ta karar verilebilen kart (metinli tür + istenen saat + ücretsiz) şablonla gider; kart sürümü başına tek.
//  · [Onayla] / [Reddet] → ÖNİZLEME (panelin varsayılanıyla aynı kod metni, Türkçesiyle) → [Gönder] → misafire; arada misafir yazdıysa,
//    kontrol listesi değiştiyse, kart değiştiyse misafire HİÇBİR ŞEY gitmez. Başka işletmenin kartı bulunmaz. Anahtar kapalıyken düğme yok sayılır.
// ---------------------------------------------------------------------------

vi.mock("@/lib/messaging", async (orig) => ({
  ...(await orig<typeof import("@/lib/messaging")>()),
  sendOnChannel: vi.fn(async () => ({ ok: true, providerMessageId: "prov-1" })),
}));
vi.mock("@/lib/hospitable-credentials", () => ({ getOrgHospitableToken: vi.fn(async () => "tok") }));
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn().mockResolvedValue(undefined) };
});
vi.mock("@/lib/email", () => ({ emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) } }));

import { sendOnChannel } from "@/lib/messaging";
import { emailService } from "@/lib/email";
import { startHostBinding, confirmHostBindingFromInbound } from "@/lib/host-channel/binding";
import { WHATSAPP_CLOUD_PROVIDER } from "@/lib/host-channel/providers";
import { askDecisionOnChannel, decisionTemplateChecks, NO_CHECKS_TEXT } from "@/lib/host-channel/decision-ask";
import { createHash } from "node:crypto";
import { DECISION_TEXTS, decisionPreviewText } from "@/lib/host-channel/decision-answer";
import { freshDecisionCard } from "@/lib/decisions/decide";
import { shortStayRange, templateSafe } from "@/lib/host-channel/question-text";
import { ORG_HOURLY_QUESTION_CAP } from "@/lib/host-channel/routing";
import type { DecisionCardData } from "@/lib/decisions/view-types";
import { decisionButtonId, parseDecisionButton } from "@/lib/host-channel/decision-buttons";
import { handleHostInbound } from "@/lib/host-channel/inbound";
import { hostChannelFlagsFromEnv } from "@/lib/host-channel/routing";
import { HOST_TEXTS } from "@/lib/host-channel/answer";
import { notifyTurnDecisions } from "@/lib/decisions/notify";
import { listConversationDecisions } from "@/lib/decisions/store";
import { saveEarlyCheckinRule } from "@/lib/early-checkin/rules";
import type { HostChannelTransport, HostDecisionMessage } from "@/lib/host-channel/types";

const mockSend = vi.mocked(sendOnChannel);
const mockMail = vi.mocked(emailService.sendReporting);
const DIGITS = "905321112233";
const DAY = 86_400_000;
const utcDay = (offset: number) => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset));
};
const keyOf = (d: Date) => d.toISOString().slice(0, 10);

type Out =
  | { kind: "decision"; to: string; message: HostDecisionMessage }
  | { kind: "text"; to: string; text: string }
  | { kind: "choices"; to: string; text: string; ids: string[] };
let out: Out[] = [];
const transport: HostChannelTransport = {
  provider: WHATSAPP_CLOUD_PROVIDER,
  sendQuestion: async () => ({ ok: true, providerMessageId: "wamid.q" }),
  sendAlert: async () => ({ ok: true, providerMessageId: "wamid.a" }),
  sendDecision: async (to, message) => {
    out.push({ kind: "decision", to, message });
    return { ok: true, providerMessageId: `wamid.D${out.length}` };
  },
  sendText: async (to, text) => {
    out.push({ kind: "text", to, text });
    return { ok: true, providerMessageId: `wamid.t${out.length}` };
  },
  sendChoices: async (to, text, choices) => {
    out.push({ kind: "choices", to, text, ids: choices.map((c) => c.id) });
    return { ok: true, providerMessageId: `wamid.c${out.length}` };
  },
};

async function seed(opts: { lang?: string; requestedTime?: string | null; kind?: "early_checkin" | "late_checkout"; phone?: string } = {}) {
  const org = await prisma.organization.create({ data: { name: "Org", timezone: "Europe/Istanbul", alertEmail: "host@example.com" } });
  const owner = await prisma.user.create({
    data: { organizationId: org.id, name: "Ev Sahibi", email: `o${Math.random()}@x.com`, passwordHash: "x", role: "owner" },
  });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale", checkInTime: "15:00", checkOutTime: "11:00" } });
  const arrival = utcDay(2);
  const departure = new Date(arrival.getTime() + 3 * DAY);
  const reservation = await prisma.reservation.create({
    data: { propertyId: property.id, guestName: "Ada Yılmaz", arrivalDate: arrival, departureDate: departure, status: "confirmed", channel: "airbnb" },
  });
  const conversation = await prisma.conversation.create({
    data: { propertyId: property.id, reservationId: reservation.id, guestIdentifier: "Ada", channel: "airbnb", externalReservationId: `res-${property.id}`, status: "new" },
  });
  const message = await prisma.message.create({
    data: { conversationId: conversation.id, direction: "inbound", senderName: "Ada", body: "Can we check in at 13:00?", createdAt: new Date(Date.now() - 10 * 60_000) },
  });
  const kind = opts.kind ?? "early_checkin";
  const decision = await prisma.decisionRequest.create({
    data: {
      organizationId: org.id,
      conversationId: conversation.id,
      messageId: message.id,
      reservationId: reservation.id,
      kind,
      requestedTime: opts.requestedTime === undefined ? (kind === "early_checkin" ? "13:00" : "13:00") : opts.requestedTime,
      dayKey: keyOf(kind === "early_checkin" ? arrival : departure),
      lang: opts.lang ?? "en",
    },
  });
  const phone = opts.phone ?? "+90 532 111 22 33";
  const b = await startHostBinding({ organizationId: org.id, userId: owner.id, provider: WHATSAPP_CLOUD_PROVIDER, rawNumber: phone, optInTextVersion: "v1" });
  if (!b.ok) throw new Error(b.reason);
  const c = await confirmHostBindingFromInbound({ provider: WHATSAPP_CLOUD_PROVIDER, fromDigits: phone.replace(/\D/g, ""), code: b.code });
  if (!c.ok) throw new Error(c.reason);
  return { orgId: org.id, ownerId: owner.id, propertyId: property.id, conversationId: conversation.id, decisionId: decision.id, messageId: message.id };
}
type Seeded = Awaited<ReturnType<typeof seed>>;

const ask = (s: Seeded, version = 0) =>
  askDecisionOnChannel({ organizationId: s.orgId, conversationId: s.conversationId, decision: { id: s.decisionId, version, messageId: s.messageId }, transport });
const tap = (buttonId: string, id = `wamid.h${Math.random()}`, from = DIGITS) =>
  handleHostInbound({
    provider: WHATSAPP_CLOUD_PROVIDER,
    events: [{ kind: "button", from, providerMessageId: id, contextId: null, buttonId, title: "x", at: new Date() }],
    flags: hostChannelFlagsFromEnv(),
    transport,
  });
const lastChoices = () => [...out].reverse().find((o): o is Extract<Out, { kind: "choices" }> => o.kind === "choices")!;
const lastText = () => [...out].reverse().find((o): o is Extract<Out, { kind: "text" }> => o.kind === "text")?.text ?? "";

describe("WhatsApp karar kartı (dilim 3)", () => {
  beforeEach(async () => {
    await resetDb();
    out = [];
    mockSend.mockClear();
    mockMail.mockClear();
    vi.stubEnv("HOST_DECISIONS_ENABLED", "1");
    vi.stubEnv("HOST_CHANNEL_ENABLED", "1");
    vi.stubEnv("HOST_QUESTION_DECISIONS_ENABLED", "1");
    vi.stubEnv("HOST_CHANNEL_ORG_IDS", "*");
    vi.stubEnv("HOST_CHANNEL_HMAC_SECRET", "test-host-channel-secret-0123456789abcdef");
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("bildirim: şablon + [Onayla]/[Reddet] yükleri; misafir metni / adı YOK; kart sürümü başına TEK", async () => {
    const s = await seed();
    expect(await ask(s)).toBe(true);
    expect(out).toHaveLength(1);
    const m = (out[0] as Extract<Out, { kind: "decision" }>).message;
    expect(m).toMatchObject({ property: "Lale", link: s.conversationId });
    expect(m.title).toContain("13:00");
    // Tarihler işletmenin saat diliminde, varış → ayrılış sırasıyla (sert inceleme 10-31 T-8).
    const res = await prisma.reservation.findFirstOrThrow({ where: { property: { organizationId: s.orgId } } });
    const dm = (d: Date) => {
      const [, mo, day] = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(d).split("-").map(Number);
      return { day: day!, month: mo! };
    };
    expect(m.dates).toBe(shortStayRange(dm(res.arrivalDate), dm(res.departureDate)));
    expect(JSON.stringify(m)).not.toMatch(/Ada|check in at/iu);
    expect(parseDecisionButton(m.approveId)).toEqual({ step: "choose", decisionId: s.decisionId, version: 0, action: "approve" });
    expect(parseDecisionButton(m.declineId)).toMatchObject({ step: "choose", action: "decline" });
    expect(await prisma.hostQuestion.findFirstOrThrow({ where: { conversationId: s.conversationId } })).toMatchObject({
      kind: "decision",
      status: "notified",
      providerMessageId: "wamid.D1",
    });
    expect(await ask(s)).toBe(true);
    expect(out).toHaveLength(1);
  });

  it("KONTROL: saat belli değil → WhatsApp'a gitmez (bugünkü e-posta); anahtar kapalı → veritabanına dokunmaz", async () => {
    const s = await seed({ requestedTime: null });
    expect(await ask(s)).toBe(false);
    expect(out).toHaveLength(0);
    const t = await seed({ phone: "+90 532 111 22 44" });
    vi.stubEnv("HOST_QUESTION_DECISIONS_ENABLED", "");
    expect(await ask(t)).toBe(false);
    expect(await prisma.hostQuestion.count()).toBe(0);
  });

  it("ÜCRETLİ erken giriş kartı WhatsApp'a gitmez (e-posta); WhatsApp'ta onay da verilemez — panele yönlendirilir, ret verilebilir", async () => {
    const s = await seed();
    await saveEarlyCheckinRule(s.orgId, s.propertyId, { mode: "draft", earliest: "12:00", fee: { amount: 20, currency: "EUR" }, note: null });
    expect(await ask(s)).toBe(false);
    await tap(decisionButtonId({ step: "choose", decisionId: s.decisionId, version: 0, action: "approve" }));
    expect(lastText().startsWith(DECISION_TEXTS.panelOnly)).toBe(true);
    out = [];
    await tap(decisionButtonId({ step: "choose", decisionId: s.decisionId, version: 0, action: "decline" }));
    expect(lastChoices().text).toMatch(/erken giriş mümkün olmayacak|early check-in won't be possible/u);
  });

  it("bildirimdeki kart sürümü güncel değilse WhatsApp'a gitmez (e-posta)", async () => {
    const s = await seed();
    expect(await ask(s, 4)).toBe(false);
    expect(out).toHaveLength(0);
  });

  it("notifyTurnDecisions: iki karttan biri WhatsApp'a gidemezse bugünkü e-posta (bütün kartlarla)", async () => {
    const s = await seed();
    await prisma.decisionRequest.create({
      data: { organizationId: s.orgId, conversationId: s.conversationId, messageId: s.messageId, kind: "late_checkout", requestedTime: "13:00", dayKey: keyOf(utcDay(5)), lang: "en" },
    });
    const views = await listConversationDecisions(prisma, { organizationId: s.orgId, conversationId: s.conversationId, timeZone: "Europe/Istanbul", now: new Date() });
    expect(views).toHaveLength(2);
    let n = 0;
    const res = await notifyTurnDecisions({
      organizationId: s.orgId,
      conversation: { id: s.conversationId, guestIdentifier: "Ada" },
      property: { name: "Lale" },
      decisions: views,
      messageIds: [s.messageId],
      lockMessageId: s.messageId,
      channelAsk: async () => n++ === 0,
    });
    expect(res).toBe("mailed");
    expect(mockMail).toHaveBeenCalledTimes(1);
  });

  it("notifyTurnDecisions: kanal gittiyse 'Karar bekliyor' e-postası GİTMEZ; gitmezse bugünkü e-posta", async () => {
    const s = await seed();
    const views = await listConversationDecisions(prisma, { organizationId: s.orgId, conversationId: s.conversationId, timeZone: "Europe/Istanbul", now: new Date() });
    const base = {
      organizationId: s.orgId,
      conversation: { id: s.conversationId, guestIdentifier: "Ada" },
      property: { name: "Lale" },
      decisions: views,
      messageIds: [s.messageId],
      lockMessageId: s.messageId,
    };
    expect(await notifyTurnDecisions({ ...base, channelAsk: async () => true })).toBe("whatsapp");
    expect(mockMail).not.toHaveBeenCalled();
    // Bildirim talebi "gönderildi" onaylanır — sonraki geçiş onu uçuşta sanıp kart damgalarını geri vermez (T-7).
    expect((await prisma.systemLock.findUniqueOrThrow({ where: { name: `reply-waiting-mail:${s.messageId}` } })).holder).toBe("sent");

    const t = await seed({ phone: "+90 532 111 22 44" });
    const v2 = await listConversationDecisions(prisma, { organizationId: t.orgId, conversationId: t.conversationId, timeZone: "Europe/Istanbul", now: new Date() });
    expect(
      await notifyTurnDecisions({ ...base, organizationId: t.orgId, conversation: { id: t.conversationId, guestIdentifier: "Ada" }, decisions: v2, messageIds: [t.messageId], lockMessageId: t.messageId, channelAsk: async () => false }),
    ).toBe("mailed");
    expect(mockMail).toHaveBeenCalledTimes(1);
  });

  it("🚨 [Onayla] → önizleme (misafirin dilinde + Türkçesi, panelin kod metni); [Gönder] → misafire gider, kart onaylandı, kararı bağlantının kullanıcısı verdi", async () => {
    const s = await seed({ lang: "en" });
    await tap(decisionButtonId({ step: "choose", decisionId: s.decisionId, version: 0, action: "approve" }));
    const preview = lastChoices();
    expect(preview.text).toContain(DECISION_TEXTS.previewHeader);
    expect(preview.text).toMatch(/Your early check-in is approved — you can check in on .+ from 13:00\./u);
    expect(preview.text).toContain(DECISION_TEXTS.previewTr);
    expect(preview.text).toMatch(/Erken giriş talebiniz onaylandı/u);
    expect(mockSend).not.toHaveBeenCalled();
    const sendId = preview.ids.find((i) => i.endsWith(".send"))!;

    await tap(sendId);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(lastText()).toBe(DECISION_TEXTS.sent);
    const d = await prisma.decisionRequest.findUniqueOrThrow({ where: { id: s.decisionId } });
    expect(d).toMatchObject({ status: "approved", decidedTime: "13:00", decidedById: s.ownerId });
    const msg = await prisma.message.findFirstOrThrow({ where: { conversationId: s.conversationId, direction: "outbound" } });
    expect(msg.body).toMatch(/^Your early check-in is approved/u);
    expect(msg.senderName).toBe("Ev Sahibi");
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: s.orgId, action: "decision.approved" } });
    expect(audit.metadataJson ?? "").toContain("host_channel");

    // Aynı [Gönder] ikinci kez → ikinci mesaj YOK.
    await tap(sendId);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(lastText()).toBe(DECISION_TEXTS.already);
  });

  it("[Reddet] → ret metni standart saatle gider", async () => {
    const s = await seed({ lang: "tr" });
    await tap(decisionButtonId({ step: "choose", decisionId: s.decisionId, version: 0, action: "decline" }));
    const preview = lastChoices();
    expect(preview.text).toMatch(/Maalesef .+ erken giriş mümkün olmayacak; giriş saati 15:00\./u);
    expect(preview.text).not.toContain(DECISION_TEXTS.previewTr);
    await tap(preview.ids.find((i) => i.endsWith(".send"))!);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect((await prisma.decisionRequest.findUniqueOrThrow({ where: { id: s.decisionId } })).status).toBe("declined");
  });

  it("🚨 önizlemeden sonra misafir yeniden yazdı → misafire bir şey gitmez, kart açık kalır", async () => {
    const s = await seed();
    await tap(decisionButtonId({ step: "choose", decisionId: s.decisionId, version: 0, action: "approve" }));
    const sendId = lastChoices().ids.find((i) => i.endsWith(".send"))!;
    await prisma.message.create({ data: { conversationId: s.conversationId, direction: "inbound", senderName: "Ada", body: "Actually never mind" } });
    await tap(sendId);
    expect(mockSend).not.toHaveBeenCalled();
    expect(lastText().startsWith(DECISION_TEXTS.guestWrote)).toBe(true);
    expect((await prisma.decisionRequest.findUniqueOrThrow({ where: { id: s.decisionId } })).status).toBe("pending");
  });

  it("🚨 olgu izi tutmuyor (kontrol listesi değişti / eski önizleme) → gitmez; [Gönderme] → hiçbir şey değişmez", async () => {
    const s = await seed();
    const forged = decisionButtonId({ step: "send", decisionId: s.decisionId, version: 0, action: "approve", factsHash: "0".repeat(24) });
    await tap(forged);
    expect(mockSend).not.toHaveBeenCalled();
    expect(lastText().startsWith(DECISION_TEXTS.factsChanged)).toBe(true);
    await tap(decisionButtonId({ step: "cancel", decisionId: s.decisionId, version: 0, action: "approve", factsHash: "0".repeat(24) }));
    expect(lastText()).toBe(DECISION_TEXTS.cancelled);
    expect((await prisma.decisionRequest.findUniqueOrThrow({ where: { id: s.decisionId } })).status).toBe("pending");
  });

  it("🚨 kiracı: başka işletmenin kartının kimliği düğmeye yazılsa da bulunmaz (cevap yok, gönderim yok)", async () => {
    const mine = await seed();
    const other = await seed({ phone: "+90 532 111 22 44" });
    await tap(decisionButtonId({ step: "choose", decisionId: other.decisionId, version: 0, action: "approve" }), "wamid.x1", DIGITS);
    expect(out).toHaveLength(0);
    expect(mockSend).not.toHaveBeenCalled();
    expect(mine.decisionId).not.toBe(other.decisionId);
  });

  it("KONTROL: karar anahtarı kapalı → düğme yok sayılır", async () => {
    const s = await seed();
    vi.stubEnv("HOST_QUESTION_DECISIONS_ENABLED", "");
    vi.stubEnv("HOST_QUESTIONS_ENABLED", "1");
    await tap(decisionButtonId({ step: "choose", decisionId: s.decisionId, version: 0, action: "approve" }));
    expect(out).toHaveLength(0);
  });

  it("🚨 karar mesajına yazıyla cevap ('13:30 olur', yanıtla ile ya da düz) → misafire gitmez, karar değişmez; panel yönlendirmesi (düzde bir kez)", async () => {
    vi.stubEnv("HOST_QUESTIONS_ENABLED", "1");
    const s = await seed();
    expect(await ask(s)).toBe(true);
    const text = (id: string, body: string, contextId: string | null) =>
      handleHostInbound({
        provider: WHATSAPP_CLOUD_PROVIDER,
        events: [{ kind: "text", from: DIGITS, providerMessageId: id, contextId, text: body, at: new Date() }],
        flags: hostChannelFlagsFromEnv(),
        transport,
      });
    await text("wamid.r1", "13:30 olur", "wamid.D1");
    expect(lastText().startsWith(HOST_TEXTS.decisionReply)).toBe(true);
    expect(lastText().endsWith(`/inbox/${s.conversationId}`)).toBe(true);
    out = [];
    await text("wamid.r2", "tamam", null);
    await text("wamid.r3", "olur", null);
    expect(out.filter((o) => o.kind === "text")).toHaveLength(1);
    expect(lastText().startsWith(HOST_TEXTS.decisionReply)).toBe(true);
    expect(mockSend).not.toHaveBeenCalled();
    expect((await prisma.decisionRequest.findUniqueOrThrow({ where: { id: s.decisionId } })).status).toBe("pending");
  });

  it("🚨 karar motoru kapatıldı (HOST_DECISIONS_ENABLED) → WhatsApp düğmesi de karar veremez; bildirim de gitmez (P-1)", async () => {
    const s = await seed();
    await tap(decisionButtonId({ step: "choose", decisionId: s.decisionId, version: 0, action: "approve" }));
    const sendId = lastChoices().ids.find((i) => i.endsWith(".send"))!;
    vi.stubEnv("HOST_DECISIONS_ENABLED", "");
    out = [];
    await tap(sendId);
    expect(mockSend).not.toHaveBeenCalled();
    expect(out).toHaveLength(0);
    expect((await prisma.decisionRequest.findUniqueOrThrow({ where: { id: s.decisionId } })).status).toBe("pending");
    expect(await ask(s)).toBe(false);
  });

  it("karar verildikten sonra [Gönderme] / gönderim sürerken dokunuş → 'gönderilmedi' DENMEZ (S-2)", async () => {
    const s = await seed();
    await tap(decisionButtonId({ step: "choose", decisionId: s.decisionId, version: 0, action: "approve" }));
    const ids = lastChoices().ids;
    await prisma.decisionRequest.update({ where: { id: s.decisionId }, data: { status: "sending", version: 1 } });
    await tap(ids.find((i) => i.endsWith(".cancel"))!);
    expect(lastText().startsWith(DECISION_TEXTS.inFlight)).toBe(true);
    await prisma.decisionRequest.update({ where: { id: s.decisionId }, data: { status: "approved", version: 2 } });
    await tap(ids.find((i) => i.endsWith(".cancel"))!);
    expect(lastText()).toBe(DECISION_TEXTS.already);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("🚨 misafir talepten sonra yeniden yazdıysa: bildirim WhatsApp'a gitmez (e-posta), düğme önizleme yerine panele yönlendirir (S-4)", async () => {
    const s = await seed();
    await prisma.message.create({ data: { conversationId: s.conversationId, direction: "inbound", senderName: "Ada", body: "Also, is there parking?" } });
    expect(await ask(s)).toBe(false);
    expect(out).toHaveLength(0);
    await tap(decisionButtonId({ step: "choose", decisionId: s.decisionId, version: 0, action: "approve" }));
    expect(lastText().startsWith(DECISION_TEXTS.guestWrote)).toBe(true);
    expect(out.some((o) => o.kind === "choices")).toBe(false);
  });

  it("karar bildiriminden sonra AÇIK soru varken düz mesaj soru akışına gider; karar verilmiş kartın bildirimi düz mesajı yakalamaz (S-3)", async () => {
    vi.stubEnv("HOST_QUESTIONS_ENABLED", "1");
    const s = await seed();
    expect(await ask(s)).toBe(true);
    const text = (id: string, body: string) =>
      handleHostInbound({
        provider: WHATSAPP_CLOUD_PROVIDER,
        events: [{ kind: "text", from: DIGITS, providerMessageId: id, contextId: null, text: body, at: new Date() }],
        flags: hostChannelFlagsFromEnv(),
        transport,
      });
    // Kart karar verilmiş → bildirim artık düz mesajı yakalamaz (soru yoksa "bekleyen soru yok").
    await prisma.decisionRequest.update({ where: { id: s.decisionId }, data: { status: "approved" } });
    out = [];
    await text("wamid.k1", "tamam");
    expect(out.some((o) => o.kind === "text" && o.text.startsWith(HOST_TEXTS.decisionReply))).toBe(false);
    // Kart bekliyor + açık bilgi sorusu → soru akışı (karar yönlendirmesi yok).
    await prisma.decisionRequest.update({ where: { id: s.decisionId }, data: { status: "pending" } });
    const binding = await prisma.hostChannelBinding.findFirstOrThrow({ where: { organizationId: s.orgId } });
    const older = new Date(Date.now() - 60 * 60_000);
    const q = await prisma.hostQuestion.create({
      data: {
        organizationId: s.orgId,
        conversationId: s.conversationId,
        bindingId: binding.id,
        kind: "info",
        turnMessageId: s.messageId,
        status: "sent",
        idempotencyKey: `turn:${s.messageId}`,
        providerMessageId: "wamid.Qx",
        sentAt: older,
        createdAt: older,
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    await prisma.$executeRaw`UPDATE "HostQuestion" SET "updatedAt" = ${older} WHERE id = ${q.id}`;
    out = [];
    await text("wamid.k2", "evet otopark var");
    expect(out.some((o) => o.kind === "text" && o.text.startsWith(HOST_TEXTS.decisionReply))).toBe(false);
  });

  it("🚨 kartın uyarıları (panelde kırmızı) WhatsApp'ta görünür: şablonda ÖNCE, önizlemede HEPSİ [Gönder]'den önce (F-1)", async () => {
    const s = await seed();
    // Varış gecesini kapsayan başka konaklama → "Aynı gün çakışan başka bir rezervasyon var." (kırmızı satır).
    const own = await prisma.reservation.findFirstOrThrow({ where: { property: { organizationId: s.orgId } } });
    await prisma.reservation.create({
      data: {
        propertyId: s.propertyId,
        guestName: "Başka",
        arrivalDate: new Date(own.arrivalDate.getTime() - DAY),
        departureDate: new Date(own.arrivalDate.getTime() + DAY),
        status: "confirmed",
        channel: "booking",
      },
    });
    const fresh = await freshDecisionCard({ organizationId: s.orgId, conversationId: s.conversationId, decisionId: s.decisionId, now: new Date() });
    const warnings = fresh!.card!.lines.filter((l) => !l.ok).map((l) => l.text);
    expect(warnings).toContain("Aynı gün çakışan başka bir rezervasyon var.");
    // Bilgi / yeşil satır şablonun başında DEĞİL (eski davranış ilk iki satırı konumla alıyordu: "İstenen saat…").
    expect(fresh!.card!.lines[0]!.ok).toBe(true);

    expect(await ask(s)).toBe(true);
    const m = (out[0] as Extract<Out, { kind: "decision" }>).message;
    expect(m.checks.startsWith(templateSafe(warnings[0]!))).toBe(true);
    if (warnings.length > 2) expect(m.checks).toContain(`+${warnings.length - 2} uyarı daha`);

    await tap(decisionButtonId({ step: "choose", decisionId: s.decisionId, version: 0, action: "approve" }));
    const preview = lastChoices().text;
    const header = preview.indexOf(DECISION_TEXTS.previewHeader);
    expect(preview.indexOf(DECISION_TEXTS.warnings)).toBeGreaterThan(-1);
    for (const w of warnings) {
      expect(preview).toContain(`• ${w}`);
      expect(preview.indexOf(w)).toBeLessThan(header);
    }
  });

  it("önizleme sığmazsa KESİLMEZ: önce Türkçesi düşer, uyarılar asla; yine sığmazsa panel (F-1)", () => {
    const card = (warnings: string[]): DecisionCardData => ({
      id: "d1",
      kind: "early_checkin",
      title: "13:00 erken giriş",
      statusLabel: "Karar bekliyor",
      open: true,
      unverified: false,
      sending: false,
      version: 0,
      requestedTime: "13:00",
      dayKey: "2026-11-02",
      dayLabel: "2 Kasım (varış günü)",
      askedAt: "",
      requestQuote: null,
      standardTime: "15:00",
      lang: "en",
      fee: null,
      note: null,
      lines: [{ ok: true, text: "İstenen saat: 13:00" }, ...warnings.map((text) => ({ ok: false, text }))],
      laterGuestMessageId: null,
      factsHash: "0".repeat(24),
    });
    const body = "B".repeat(200);
    const tr = "T".repeat(200);
    const short = decisionPreviewText(card(["kısa uyarı"]), body, tr)!;
    expect(short).toContain(DECISION_TEXTS.previewTr);
    const twoLong = decisionPreviewText(card(["U".repeat(300), "V".repeat(300)]), body, tr)!;
    expect(twoLong.length).toBeLessThanOrEqual(1_024);
    expect(twoLong).not.toContain(DECISION_TEXTS.previewTr);
    expect(twoLong).toContain("U".repeat(300));
    expect(twoLong).toContain("V".repeat(300));
    expect(twoLong).not.toContain("İstenen saat");
    expect(decisionPreviewText(card(["U".repeat(300), "V".repeat(300), "W".repeat(300)]), body, tr)).toBeNull();
  });

  it("🚨 önizlemeye 'Yanıtla' ile yazılan metin bu karara bağlanır (panel yönlendirmesi) — sonradan sorulan başka misafirin sorusuna girmez (F-5)", async () => {
    vi.stubEnv("HOST_QUESTIONS_ENABLED", "1");
    const s = await seed();
    expect(await ask(s)).toBe(true);
    await tap(decisionButtonId({ step: "choose", decisionId: s.decisionId, version: 0, action: "approve" }));
    const previewId = `wamid.c${out.length}`;
    expect(out.at(-1)?.kind).toBe("choices");
    expect((await prisma.hostQuestion.findFirstOrThrow({ where: { organizationId: s.orgId, kind: "decision" } })).previewMessageId).toBe(previewId);
    // Karardan SONRA sorulan bilgi sorusu (bekliyor) — düz mesaj kuralına göre "en yeni" o.
    const binding = await prisma.hostChannelBinding.findFirstOrThrow({ where: { organizationId: s.orgId } });
    const q = await prisma.hostQuestion.create({
      data: {
        organizationId: s.orgId,
        conversationId: s.conversationId,
        bindingId: binding.id,
        kind: "info",
        turnMessageId: s.messageId,
        status: "sent",
        idempotencyKey: `turn:${s.messageId}`,
        providerMessageId: "wamid.Qy",
        sentAt: new Date(),
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    out = [];
    await handleHostInbound({
      provider: WHATSAPP_CLOUD_PROVIDER,
      events: [{ kind: "text", from: DIGITS, providerMessageId: "wamid.k5", contextId: previewId, text: "13:30 olsun", at: new Date() }],
      flags: hostChannelFlagsFromEnv(),
      transport,
    });
    expect(lastText().startsWith(HOST_TEXTS.decisionReply)).toBe(true);
    expect(await prisma.hostQuestion.findUniqueOrThrow({ where: { id: q.id } })).toMatchObject({ status: "sent", answerEnc: null, answerMessageId: null });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("fiilen kapanmış kart kendi nedeniyle cevaplanır — 'ücret, saat ya da tür' denmez (F-6)", async () => {
    const approve = (s: Seeded) => tap(decisionButtonId({ step: "choose", decisionId: s.decisionId, version: 0, action: "approve" }));
    const a = await seed();
    await prisma.reservation.updateMany({ where: { property: { organizationId: a.orgId } }, data: { status: "cancelled" } });
    await approve(a);
    expect(lastText()).toBe(DECISION_TEXTS.cancelledStay);

    const b = await seed({ phone: "+90 532 111 22 44" });
    await prisma.reservation.updateMany({ where: { property: { organizationId: b.orgId } }, data: { arrivalDate: utcDay(-2), departureDate: utcDay(1) } });
    await tap(decisionButtonId({ step: "choose", decisionId: b.decisionId, version: 0, action: "approve" }), "wamid.e2", "905321112244");
    expect(lastText()).toBe(DECISION_TEXTS.expired);

    const c = await seed({ phone: "+90 532 111 22 55" });
    await prisma.message.create({
      data: { conversationId: c.conversationId, direction: "outbound", authorType: "host", senderName: "Ev Sahibi", body: "Bakıyorum, döneceğim." },
    });
    await tap(decisionButtonId({ step: "choose", decisionId: c.decisionId, version: 0, action: "approve" }), "wamid.e3", "905321112255");
    expect(lastText().startsWith(DECISION_TEXTS.hostReplied)).toBe(true);
    expect(out.some((o) => o.kind === "choices")).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("🚨 önizlemenin İKİNCİ düğmesi gerçekten [Gönderme]: basınca misafire bir şey gitmez, kart bekler (T-1)", async () => {
    const s = await seed();
    await tap(decisionButtonId({ step: "choose", decisionId: s.decisionId, version: 0, action: "approve" }));
    const ids = lastChoices().ids;
    expect(ids.map((i) => parseDecisionButton(i)?.step)).toEqual(["send", "cancel"]);
    await tap(ids[1]!);
    expect(lastText()).toBe(DECISION_TEXTS.cancelled);
    expect(mockSend).not.toHaveBeenCalled();
    expect((await prisma.decisionRequest.findUniqueOrThrow({ where: { id: s.decisionId } })).status).toBe("pending");
  });

  it("🚨 şablon gönderilemezse bugünkü e-posta: false döner, kayıt 'failed'; aynı kart yeniden denenirse yine e-posta (T-3)", async () => {
    const s = await seed();
    const failing: HostChannelTransport = { ...transport, sendDecision: async () => ({ ok: false, providerMessageId: null, definitive: true, error: "x" }) };
    const call = () =>
      askDecisionOnChannel({ organizationId: s.orgId, conversationId: s.conversationId, decision: { id: s.decisionId, version: 0, messageId: s.messageId }, transport: failing });
    expect(await call()).toBe(false);
    expect((await prisma.hostQuestion.findFirstOrThrow({ where: { organizationId: s.orgId, kind: "decision" } })).status).toBe("failed");
    expect(await call()).toBe(false);
    expect(await ask(s)).toBe(false);
  });

  it("[Gönder] sonucu ev sahibine doğru söylenir: kesin hata → 'gönderilemedi' (kart yeniden açık), belirsiz → 'doğrulanamadı' (T-5)", async () => {
    const s = await seed();
    await tap(decisionButtonId({ step: "choose", decisionId: s.decisionId, version: 0, action: "approve" }));
    const sendId = lastChoices().ids.find((i) => i.endsWith(".send"))!;
    mockSend.mockResolvedValueOnce({ ok: false, error: "Hospitable API hatası (HTTP 400): bad" } as never);
    await tap(sendId);
    expect(lastText().startsWith(DECISION_TEXTS.failed)).toBe(true);
    const reopened = await prisma.decisionRequest.findUniqueOrThrow({ where: { id: s.decisionId } });
    expect(reopened.status).toBe("pending");

    await tap(decisionButtonId({ step: "choose", decisionId: s.decisionId, version: reopened.version, action: "approve" }));
    const again = lastChoices().ids.find((i) => i.endsWith(".send"))!;
    mockSend.mockResolvedValueOnce({ ok: false, error: "timeout" } as never);
    await tap(again);
    expect(lastText().startsWith(DECISION_TEXTS.unverified)).toBe(true);
    expect((await prisma.decisionRequest.findUniqueOrThrow({ where: { id: s.decisionId } })).status).toBe("send_unverified");
  });

  it("işletmenin saatlik WhatsApp tavanı dolduysa karar bildirimi gitmez (e-posta) (T-6)", async () => {
    const s = await seed();
    const binding = await prisma.hostChannelBinding.findFirstOrThrow({ where: { organizationId: s.orgId } });
    await prisma.hostQuestion.createMany({
      data: Array.from({ length: ORG_HOURLY_QUESTION_CAP }, (_, i) => ({
        organizationId: s.orgId,
        conversationId: s.conversationId,
        bindingId: binding.id,
        kind: "alert",
        turnMessageId: s.messageId,
        status: "alerted",
        idempotencyKey: `alert:cap-${i}`,
        sentAt: new Date(),
        expiresAt: new Date(Date.now() + 3600_000),
      })),
    });
    expect(await ask(s)).toBe(false);
    expect(out).toHaveLength(0);
  });

  it("şablonun kontrol değişkeni: uyarılar önce, en çok 2 + kalan sayısı; uyarı yoksa ilk iki satır; hiç satır yoksa boş değil (T-8, F-1)", () => {
    const line = (ok: boolean, text: string) => ({ ok, text });
    expect(decisionTemplateChecks({ lines: [] })).toBe(NO_CHECKS_TEXT);
    expect(decisionTemplateChecks({ lines: [line(true, "a"), line(true, "b"), line(true, "c")] })).toBe("a; b");
    expect(decisionTemplateChecks({ lines: [line(true, "a"), line(false, "U1"), line(true, "b"), line(false, "U2"), line(false, "U3")] })).toBe(
      "U1; U2; +1 uyarı daha",
    );
    expect(decisionTemplateChecks({ lines: [line(true, "a"), line(false, "U1")] })).toBe("U1");
  });

  it("bir soruya bağlanmış WhatsApp mesajının yeniden teslimi karar bildirimine yakalanmaz (soru akışı sürer) (T-10)", async () => {
    vi.stubEnv("HOST_QUESTIONS_ENABLED", "1");
    const s = await seed();
    expect(await ask(s)).toBe(true);
    const wamid = "wamid.bound1";
    await prisma.systemLock.create({
      data: { name: `host-ans:${createHash("sha256").update(wamid, "utf8").digest("hex")}`, holder: "q-x", lockedUntil: new Date(Date.now() + 3600_000) },
    });
    out = [];
    await handleHostInbound({
      provider: WHATSAPP_CLOUD_PROVIDER,
      events: [{ kind: "text", from: DIGITS, providerMessageId: wamid, contextId: null, text: "evet", at: new Date() }],
      flags: hostChannelFlagsFromEnv(),
      transport,
    });
    expect(out.some((o) => o.kind === "text" && o.text.startsWith(HOST_TEXTS.decisionReply))).toBe(false);
  });

  it("eski sürümün düğmesi (kart değişti) → 'kart değişti', gönderim yok", async () => {
    const s = await seed();
    await prisma.decisionRequest.update({ where: { id: s.decisionId }, data: { version: 3 } });
    await tap(decisionButtonId({ step: "choose", decisionId: s.decisionId, version: 0, action: "approve" }));
    expect(lastText().startsWith(DECISION_TEXTS.stale)).toBe(true);
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe("karar düğmesi kimliği (saf)", () => {
  it("gidiş-dönüş + biçim dışı reddedilir", () => {
    const b = { step: "send" as const, decisionId: "cmabc123def456ghi789jkl0m", version: 7, action: "decline" as const, factsHash: "a".repeat(24) };
    expect(parseDecisionButton(decisionButtonId(b))).toEqual(b);
    expect(decisionButtonId(b).length).toBeLessThanOrEqual(256);
    for (const bad of ["hd.x.1.a", "hd.cmabc123def456.1.z", "hq.cmabc123def456.1.a", "hd.cmabc123def456.1.a.short.send", "hd.CMABC123DEF.1.a"]) {
      expect(parseDecisionButton(bad)).toBeNull();
    }
  });
});
