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
import { askDecisionOnChannel } from "@/lib/host-channel/decision-ask";
import { DECISION_TEXTS } from "@/lib/host-channel/decision-answer";
import { decisionButtonId, parseDecisionButton } from "@/lib/host-channel/decision-buttons";
import { handleHostInbound } from "@/lib/host-channel/inbound";
import { hostChannelFlagsFromEnv } from "@/lib/host-channel/routing";
import { HOST_TEXTS } from "@/lib/host-channel/answer";
import { notifyTurnDecisions } from "@/lib/decisions/notify";
import { listConversationDecisions } from "@/lib/decisions/store";
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
  return { orgId: org.id, ownerId: owner.id, conversationId: conversation.id, decisionId: decision.id, messageId: message.id };
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
