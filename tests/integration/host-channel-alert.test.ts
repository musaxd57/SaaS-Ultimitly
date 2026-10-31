import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const { composeMock } = vi.hoisted(() => ({ composeMock: vi.fn() }));
vi.mock("@/lib/host-channel/compose", () => ({ composeGuestReplyFromHostAnswer: composeMock }));

import { prisma, resetDb } from "../helpers/db";
import { startHostBinding, confirmHostBindingFromInbound } from "@/lib/host-channel/binding";
import { WHATSAPP_CLOUD_PROVIDER } from "@/lib/host-channel/providers";
import { randomUUID } from "node:crypto";
import { ALERT_HOURLY_CAP, alertHostOnChannel } from "@/lib/host-channel/alert";
import { HOST_TEXTS, sweepHostQuestions } from "@/lib/host-channel/answer";
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

  it("gönderilemezse kayıt 'failed', fırlatmaz; rezervasyonsuz konuşmada tarih '—' ile GİDER; bağlantı yoksa atlar", async () => {
    const s = await seed();
    alertResult = { ok: false, providerMessageId: null, definitive: true, error: "http_400_132001" };
    expect(await alert(s)).toBe("failed");
    expect((await prisma.hostQuestion.findFirstOrThrow({ where: { conversationId: s.conversationId } })).status).toBe("failed");

    const reservationId = (await prisma.conversation.findUniqueOrThrow({ where: { id: s.conversationId } })).reservationId;
    await prisma.conversation.update({ where: { id: s.conversationId }, data: { reservationId: null } });
    // Rezervasyona bağlı olmayan konuşma (sert inceleme 10-31 M-6, bilinçli değişiklik): acil e-posta gidiyordu, WhatsApp sessizce düşüyordu.
    const m2 = await prisma.message.create({ data: { conversationId: s.conversationId, direction: "inbound", senderName: "x", body: "help, Ayşe locked out" } });
    alertResult = { ok: true, providerMessageId: "wamid.A2" };
    expect(await alert(s, m2.id, m2.body)).toBe("sent");
    expect(sent.at(-1)!.message).toMatchObject({ property: "Lale", dates: "—", link: s.conversationId });
    expect(sent.at(-1)!.message!.quote).not.toMatch(/ayşe/iu);

    // Rezervasyon yerinde, numara bağlantısı kaldırılmış → atlanır (kayıt da yazılmaz).
    await prisma.conversation.update({ where: { id: s.conversationId }, data: { reservationId } });
    await prisma.hostChannelBinding.updateMany({ data: { status: "revoked" } });
    expect(await alert(s, "m3", "help")).toBe("skipped");
    expect(await prisma.hostQuestion.count({ where: { idempotencyKey: "alert:m3" } })).toBe(0);
  });

  it("🚨 ev sahibi bildirime 'yanıtla' ile yazarsa misafire HİÇBİR ŞEY gitmez, model çağrılmaz — panel bağlantısı (soru anahtarı kapalıyken de)", async () => {
    const s = await seed();
    await alert(s);
    sent = [];
    await handleHostInbound({
      provider: WHATSAPP_CLOUD_PROVIDER,
      events: [{ kind: "text", from: DIGITS, providerMessageId: "wamid.h1", contextId: "wamid.A1", text: "tamam geliyorum", at: new Date() }],
      // Soru anahtarı KAPALI, yalnız acil açık (sert inceleme R-2: eskiden cevap sessizce yutuluyordu).
      flags: hostChannelFlagsFromEnv(),
      transport,
    });
    expect(hostChannelFlagsFromEnv()).toMatchObject({ questions: false, alerts: true });
    expect(composeMock).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text!.startsWith(HOST_TEXTS.alertReply)).toBe(true);
    expect(sent[0]!.text!.endsWith(`/inbox/${s.conversationId}`)).toBe(true);
    expect(await prisma.message.count({ where: { conversationId: s.conversationId, direction: "outbound" } })).toBe(0);
  });

  it("gönderilemeyen bildirim yol yeniden çağırınca TEK sahiple yeniden denenir; gittikten sonra ikinci yok (sert inceleme R-4)", async () => {
    const s = await seed();
    alertResult = { ok: false, providerMessageId: null, definitive: false, error: "http_503" };
    expect(await alert(s)).toBe("failed");
    alertResult = { ok: true, providerMessageId: "wamid.A2" };
    expect(await alert(s)).toBe("sent");
    expect(await alert(s)).toBe("duplicate");
    expect(sent).toHaveLength(2);
    expect(await prisma.hostQuestion.findMany({ where: { conversationId: s.conversationId } })).toMatchObject([{ status: "alerted", providerMessageId: "wamid.A2" }]);
  });

  it("gönderim ortasında düşmüş (bayat 'queued') kayıt yeniden denenir; TAZE 'queued' (şu an gönderiliyor) dokunulmaz", async () => {
    const s = await seed();
    const binding = await prisma.hostChannelBinding.findFirstOrThrow({ where: { organizationId: s.orgId } });
    const row = await prisma.hostQuestion.create({
      data: {
        organizationId: s.orgId,
        conversationId: s.conversationId,
        bindingId: binding.id,
        kind: "alert",
        turnMessageId: s.message.id,
        status: "queued",
        idempotencyKey: `alert:${s.message.id}`,
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    expect(await alert(s)).toBe("duplicate");
    expect(sent).toHaveLength(0);
    await prisma.$executeRaw`UPDATE "HostQuestion" SET "updatedAt" = ${new Date(Date.now() - 5 * 60_000)} WHERE id = ${row.id}`;
    // İki geçiş AYNI ANDA bayat kaydı devralmaya çalışır → yalnız biri gönderir (sürüm CAS'ı).
    const [a, b] = await Promise.all([alert(s), alert(s)]);
    expect([a, b].sort()).toEqual(["duplicate", "sent"]);
    expect(sent).toHaveLength(1);
    expect((await prisma.hostQuestion.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("alerted");
  });

  it("gönderilemeyen bildirim iz bırakır (yalnız hata kodu); KESİN hata tek alarm açar, sonraki başarı kapatır; geçici hata alarm açmaz (M-5)", async () => {
    const s = await seed();
    const alarm = () => prisma.systemLock.count({ where: { name: `alert-state:host-channel:alert:${s.orgId}` } });
    alertResult = { ok: false, providerMessageId: null, definitive: false, error: "http_503" };
    expect(await alert(s)).toBe("failed");
    expect(await alarm()).toBe(0);
    const m2 = await prisma.message.create({ data: { conversationId: s.conversationId, direction: "inbound", senderName: "x", body: "locked out" } });
    alertResult = { ok: false, providerMessageId: null, definitive: true, error: "http_400_132001" };
    expect(await alert(s, m2.id, m2.body)).toBe("failed");
    expect(await alarm()).toBe(1);
    const events = await prisma.operationalEvent.findMany({ where: { event: "host_channel.alert.failed", organizationId: s.orgId } });
    expect(events.map((e) => (JSON.parse(e.dataJson ?? "{}") as { reason?: string }).reason).sort()).toEqual(["http_400_132001", "http_503"]);
    alertResult = { ok: true, providerMessageId: "wamid.A9" };
    const m3 = await prisma.message.create({ data: { conversationId: s.conversationId, direction: "inbound", senderName: "x", body: "help" } });
    expect(await alert(s, m3.id, m3.body)).toBe("sent");
    expect(await alarm()).toBe(0);
  });

  it("erken atlamalar: aktarım yok / numara anahtarı yok → kayıt yazılmaz; 'gönderildi' deyip kimlik vermeyen sağlayıcı → 'failed' (T-7)", async () => {
    const s = await seed();
    expect(await alertHostOnChannel({ organizationId: s.orgId, conversationId: s.conversationId, messageId: s.message.id, messageBody: "x", transport: null })).toBe("skipped");
    vi.stubEnv("HOST_CHANNEL_HMAC_SECRET", "");
    expect(await alert(s)).toBe("skipped");
    expect(await prisma.hostQuestion.count()).toBe(0);
    vi.stubEnv("HOST_CHANNEL_HMAC_SECRET", "test-host-channel-secret-0123456789abcdef");
    alertResult = { ok: true, providerMessageId: null };
    expect(await alert(s)).toBe("failed");
    expect((await prisma.hostQuestion.findFirstOrThrow({ where: { conversationId: s.conversationId } })).status).toBe("failed");
  });

  it("kiracı: tavan işletme başına (başka işletmenin bildirimleri sayılmaz); başka işletmenin konuşması için bildirim YOK (T-2)", async () => {
    const s = await seed();
    const other = await prisma.organization.create({ data: { name: "Other" } });
    const op = await prisma.property.create({ data: { organizationId: other.id, name: "Gül" } });
    const or = await prisma.reservation.create({
      data: { propertyId: op.id, guestName: "Z", arrivalDate: new Date("2026-11-12T00:00:00Z"), departureDate: new Date("2026-11-15T00:00:00Z"), status: "confirmed", channel: "airbnb" },
    });
    // Rezervasyonlu: yalnız işletme süzgeci atlatabilir (sert inceleme T-3 — rezervasyonsuz konuşma pini boş geçiyordu).
    const oc = await prisma.conversation.create({ data: { propertyId: op.id, channel: "airbnb", guestIdentifier: "Z", status: "new", reservationId: or.id } });
    for (let i = 0; i < ALERT_HOURLY_CAP; i++) {
      await prisma.hostQuestion.create({
        data: {
          organizationId: other.id,
          conversationId: oc.id,
          kind: "alert",
          turnMessageId: `o${i}`,
          status: "alerted",
          idempotencyKey: `alert:o${i}`,
          sentAt: new Date(),
          expiresAt: new Date(Date.now() + 3600_000),
        },
      });
    }
    expect(await alert(s)).toBe("sent");
    // A işletmesinin numarasıyla B'nin konuşması: konuşma bulunmaz → atlanır, satır yazılmaz.
    expect(await alertHostOnChannel({ organizationId: s.orgId, conversationId: oc.id, messageId: "foreign-1", messageBody: "fire", transport })).toBe("skipped");
    expect(await prisma.hostQuestion.count({ where: { idempotencyKey: "alert:foreign-1" } })).toBe(0);
    expect(sent).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Düz cevap (WhatsApp'ta "yanıtla" kullanılmadan) — sert inceleme 10-31 R-1: bildirimden sonra yazılan "geliyorum" başka misafirin açık
// sorusuna bağlanıp onun taslağına giriyordu. Kural: en yeni mesajımız bildirimse (ondan sonra soru sorulmadıysa) düz mesaj bildirime yazılmış
// sayılır → misafire gitmez, model çağrılmaz; yönlendirme bildirim başına bir kez.
// ---------------------------------------------------------------------------
describe("acil bildirim — düz cevap", () => {
  beforeEach(async () => {
    await resetDb();
    sent = [];
    alertResult = { ok: true, providerMessageId: "wamid.A1" };
    composeMock.mockReset();
    vi.stubEnv("HOST_CHANNEL_ENABLED", "1");
    vi.stubEnv("HOST_QUESTION_ALERTS_ENABLED", "1");
    vi.stubEnv("HOST_QUESTIONS_ENABLED", "1");
    vi.stubEnv("HOST_CHANNEL_ORG_IDS", "*");
    vi.stubEnv("HOST_CHANNEL_HMAC_SECRET", "test-host-channel-secret-0123456789abcdef");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
  });
  afterEach(() => vi.unstubAllEnvs());

  const MIN = 60_000;
  const plain = (id: string, text: string) =>
    handleHostInbound({
      provider: WHATSAPP_CLOUD_PROVIDER,
      events: [{ kind: "text", from: DIGITS, providerMessageId: id, contextId: null, text, at: new Date() }],
      flags: hostChannelFlagsFromEnv(),
      transport,
    });
  async function infoQuestion(s: Awaited<ReturnType<typeof seed>>, createdAt: Date) {
    const binding = await prisma.hostChannelBinding.findFirstOrThrow({ where: { organizationId: s.orgId } });
    const turn = await prisma.message.create({
      data: { conversationId: s.conversationId, direction: "inbound", senderName: "x", body: "Is there a baby cot?", createdAt: new Date(createdAt.getTime() - 2 * MIN) },
    });
    return prisma.hostQuestion.create({
      data: {
        id: randomUUID(),
        organizationId: s.orgId,
        conversationId: s.conversationId,
        bindingId: binding.id,
        kind: "info",
        turnMessageId: turn.id,
        status: "sent",
        idempotencyKey: `turn:${turn.id}`,
        providerMessageId: `wamid.Q-${turn.id}`,
        sentAt: createdAt,
        createdAt,
        expiresAt: new Date(createdAt.getTime() + 24 * 3600_000),
      },
    }).then(async (q) => {
      await prisma.$executeRaw`UPDATE "HostQuestion" SET "updatedAt" = ${createdAt} WHERE id = ${q.id}`;
      return q;
    });
  }

  it("🚨 bekleyen soru yok: düz 'geliyorum' → panele yönlendirme; ikinci düz mesaj sessiz; model çağrılmaz, misafire bir şey gitmez", async () => {
    const s = await seed();
    await alertHostOnChannel({ organizationId: s.orgId, conversationId: s.conversationId, messageId: s.message.id, messageBody: s.message.body, transport });
    sent = [];
    await plain("wamid.p1", "geliyorum");
    await plain("wamid.p2", "10 dakikaya oradayım");
    expect(composeMock).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text!.startsWith(HOST_TEXTS.alertReply)).toBe(true);
    expect(sent[0]!.text!.endsWith(`/inbox/${s.conversationId}`)).toBe(true);
    expect(await prisma.message.count({ where: { conversationId: s.conversationId, direction: "outbound" } })).toBe(0);
  });

  it("🚨 bildirimden ÖNCE sorulmuş açık soru var: düz mesaj o soruya BAĞLANMAZ (taslak yok, cevap saklanmaz) — 'Yanıtla' ile yazın", async () => {
    const s = await seed();
    const q = await infoQuestion(s, new Date(Date.now() - 30 * MIN));
    await alertHostOnChannel({
      organizationId: s.orgId,
      conversationId: s.conversationId,
      messageId: s.message.id,
      messageBody: s.message.body,
      transport,
      now: new Date(Date.now() - 5 * MIN),
    });
    sent = [];
    await plain("wamid.p1", "geliyorum");
    expect(composeMock).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text!.startsWith(HOST_TEXTS.alertReplyWithOpen)).toBe(true);
    expect(await prisma.hostQuestion.findUniqueOrThrow({ where: { id: q.id } })).toMatchObject({ status: "sent", answerEnc: null, answerMessageId: null });
  });

  it("KONTROL: bildirimden SONRA sorulan soru varsa düz mesaj o soruya gider (bugünkü akış, taslak kurulur)", async () => {
    const s = await seed();
    await alertHostOnChannel({
      organizationId: s.orgId,
      conversationId: s.conversationId,
      messageId: s.message.id,
      messageBody: s.message.body,
      transport,
      now: new Date(Date.now() - 20 * MIN),
    });
    const q = await infoQuestion(s, new Date(Date.now() + 1_000));
    composeMock.mockResolvedValueOnce({ ok: true, kind: "answer", reply: "Yes, there is a baby cot.", replyTr: "Evet.", uncovered: [] });
    sent = [];
    await plain("wamid.p1", "var, dolapta");
    expect(composeMock).toHaveBeenCalledTimes(1);
    expect(sent.some((m) => m.text?.startsWith(HOST_TEXTS.alertReply) || m.text?.startsWith(HOST_TEXTS.alertReplyWithOpen))).toBe(false);
    expect((await prisma.hostQuestion.findUniqueOrThrow({ where: { id: q.id } })).answerMessageId).toBe("wamid.p1");
  });

  it("KONTROL: soru anahtarı KAPALI + bildirim yok → düz mesaj yalnız alınır (cevap yok, model yok)", async () => {
    vi.stubEnv("HOST_QUESTIONS_ENABLED", "");
    const s = await seed();
    await infoQuestion(s, new Date(Date.now() - 30 * MIN));
    sent = [];
    await plain("wamid.p1", "var, dolapta");
    expect(sent).toHaveLength(0);
    expect(composeMock).not.toHaveBeenCalled();
  });
});

describe("acil bildirim — düz cevap, kenar durumlar (sert inceleme 2)", () => {
  beforeEach(async () => {
    await resetDb();
    sent = [];
    alertResult = { ok: true, providerMessageId: "wamid.A1" };
    composeMock.mockReset();
    vi.stubEnv("HOST_CHANNEL_ENABLED", "1");
    vi.stubEnv("HOST_QUESTION_ALERTS_ENABLED", "1");
    vi.stubEnv("HOST_QUESTIONS_ENABLED", "1");
    vi.stubEnv("HOST_CHANNEL_ORG_IDS", "*");
    vi.stubEnv("HOST_CHANNEL_HMAC_SECRET", "test-host-channel-secret-0123456789abcdef");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
  });
  afterEach(() => vi.unstubAllEnvs());

  const MIN = 60_000;
  const deliver = (e: Record<string, unknown>) =>
    handleHostInbound({
      provider: WHATSAPP_CLOUD_PROVIDER,
      events: [{ from: DIGITS, contextId: null, at: new Date(), ...e } as never],
      flags: hostChannelFlagsFromEnv(),
      transport,
    });
  async function olderQuestion(s: Awaited<ReturnType<typeof seed>>, minutesAgo: number) {
    const binding = await prisma.hostChannelBinding.findFirstOrThrow({ where: { organizationId: s.orgId } });
    const createdAt = new Date(Date.now() - minutesAgo * MIN);
    const turn = await prisma.message.create({
      data: { conversationId: s.conversationId, direction: "inbound", senderName: "x", body: "Is there a baby cot?", createdAt: new Date(createdAt.getTime() - MIN) },
    });
    const q = await prisma.hostQuestion.create({
      data: {
        id: randomUUID(),
        organizationId: s.orgId,
        conversationId: s.conversationId,
        bindingId: binding.id,
        kind: "info",
        turnMessageId: turn.id,
        status: "sent",
        idempotencyKey: `turn:${turn.id}`,
        providerMessageId: `wamid.Q-${turn.id}`,
        sentAt: createdAt,
        createdAt,
        expiresAt: new Date(createdAt.getTime() + 24 * 3600_000),
      },
    });
    await prisma.$executeRaw`UPDATE "HostQuestion" SET "updatedAt" = ${createdAt} WHERE id = ${q.id}`;
    // Misafirin mesajları sorudan ÖNCE (yoksa akış doğru olarak "misafir yeniden yazdı" der ve taslak kurmaz).
    await prisma.message.updateMany({
      where: { conversationId: s.conversationId, direction: "inbound" },
      data: { createdAt: new Date(createdAt.getTime() - 2 * MIN), ingestedAt: new Date(createdAt.getTime() - 2 * MIN) },
    });
    return q;
  }
  const alertAt = (s: Awaited<ReturnType<typeof seed>>, minutesAgo: number) =>
    alertHostOnChannel({
      organizationId: s.orgId,
      conversationId: s.conversationId,
      messageId: s.message.id,
      messageBody: s.message.body,
      transport,
      now: new Date(Date.now() - minutesAgo * MIN),
    });

  it("🚨 bildirimden önceki soruya 'Yanıtla' ile cevap → SORU akışı (taslak kurulur); bildirim yönlendirmesi YOK (T-2)", async () => {
    const s = await seed();
    const q = await olderQuestion(s, 30);
    await alertAt(s, 5);
    composeMock.mockResolvedValueOnce({ ok: true, kind: "answer", reply: "Yes, there is a baby cot.", replyTr: "Evet.", uncovered: [] });
    sent = [];
    await deliver({ kind: "text", providerMessageId: "wamid.c1", contextId: q.providerMessageId, text: "var, dolapta" });
    expect(composeMock).toHaveBeenCalledTimes(1);
    expect(sent.some((m) => m.text?.startsWith(HOST_TEXTS.alertReplyWithOpen) || m.text?.startsWith(HOST_TEXTS.alertReply))).toBe(false);
  });

  it("🚨 soru akışı bildirimden SONRA ilerledi (Yanıtla → 'eksik kısmı yazın') → sonraki DÜZ mesaj o soruya eklenir (R-1)", async () => {
    const s = await seed();
    const q = await olderQuestion(s, 30);
    await alertAt(s, 5);
    composeMock.mockResolvedValueOnce({ ok: true, kind: "partial", reply: null, replyTr: null, uncovered: ["otopark"] });
    await deliver({ kind: "text", providerMessageId: "wamid.c1", contextId: q.providerMessageId, text: "havuz 9'da" });
    composeMock.mockResolvedValueOnce({ ok: true, kind: "answer", reply: "Pool opens at 9; parking is free.", replyTr: "Evet.", uncovered: [] });
    sent = [];
    await deliver({ kind: "text", providerMessageId: "wamid.c2", text: "otopark var, ücretsiz" });
    expect(composeMock).toHaveBeenCalledTimes(2);
    expect(sent.some((m) => m.text?.startsWith(HOST_TEXTS.alertReplyWithOpen))).toBe(false);
  });

  it("açık soru varken düz mesajlar her seferinde 'Yanıtla ile yazın' uyarısı alır (sessiz yutma yok — M-1); model çağrılmaz", async () => {
    const s = await seed();
    await olderQuestion(s, 30);
    await alertAt(s, 5);
    sent = [];
    await deliver({ kind: "text", providerMessageId: "wamid.p1", text: "geliyorum" });
    await deliver({ kind: "text", providerMessageId: "wamid.p2", text: "10 dakika" });
    expect(sent.filter((m) => m.text?.startsWith(HOST_TEXTS.alertReplyWithOpen))).toHaveLength(2);
    expect(composeMock).not.toHaveBeenCalled();
  });

  it("bildirimden ÖNCE yazılmış (geç teslim edilen) düz mesaj bildirime sayılmaz (R-2)", async () => {
    const s = await seed();
    await olderQuestion(s, 30);
    await alertAt(s, 5);
    composeMock.mockResolvedValueOnce({ ok: true, kind: "answer", reply: "Yes.", replyTr: "Evet.", uncovered: [] });
    sent = [];
    await deliver({ kind: "text", providerMessageId: "wamid.old", text: "var, dolapta", at: new Date(Date.now() - 10 * MIN) });
    expect(composeMock).toHaveBeenCalledTimes(1);
    expect(sent.some((m) => m.text?.startsWith(HOST_TEXTS.alertReplyWithOpen))).toBe(false);
  });

  it("bağlamı bilinmeyen [Gönder] düğmesi bildirim kuralına düşmez, soru düğmesi işleyicisine gider (R-3)", async () => {
    const s = await seed();
    const q = await olderQuestion(s, 30);
    await alertAt(s, 5);
    sent = [];
    await deliver({ kind: "button", providerMessageId: "wamid.b1", contextId: "wamid.unknown", buttonId: `hq.${q.id}.0.send`, title: "Gönder" });
    expect(sent.some((m) => m.text?.startsWith(HOST_TEXTS.alertReply) || m.text?.startsWith(HOST_TEXTS.alertReplyWithOpen))).toBe(false);
    expect(sent.some((m) => m.text === HOST_TEXTS.stalePreview)).toBe(true);
  });

  it("maske: telefon / ad içine konmuş görünmez karakter maskeyi atlatamaz (S-1)", async () => {
    const s = await seed();
    await alertHostOnChannel({
      organizationId: s.orgId,
      conversationId: s.conversationId,
      messageId: s.message.id,
      messageBody: "Ay\u00ADşe here, call +90 5\u200B55 123 45 67 we are locked out",
      transport,
    });
    const quote = sent.find((m) => m.kind === "alert")!.message!.quote;
    expect(quote).not.toMatch(/ayşe|555 ?123/iu);
    expect(quote).toContain("locked out");
  });

  it("yeniden deneme yeni bağlantıyı alır: ilk deneme düştü, numara yeniden bağlandı → kayıt yeni bağlantıya (T-5)", async () => {
    const s = await seed();
    alertResult = { ok: false, providerMessageId: null, definitive: false, error: "http_503" };
    expect(await alert(s)).toBe("failed");
    await prisma.hostChannelBinding.updateMany({ data: { status: "revoked", revokedAt: new Date() } });
    const user = await prisma.user.findFirstOrThrow({ where: { organizationId: s.orgId } });
    const b = await startHostBinding({ organizationId: s.orgId, userId: user.id, provider: WHATSAPP_CLOUD_PROVIDER, rawNumber: "+90 532 111 22 44", optInTextVersion: "v1" });
    if (!b.ok) throw new Error(b.reason);
    const c = await confirmHostBindingFromInbound({ provider: WHATSAPP_CLOUD_PROVIDER, fromDigits: "905321112244", code: b.code });
    if (!c.ok) throw new Error(c.reason);
    alertResult = { ok: true, providerMessageId: "wamid.A9" };
    expect(await alert(s)).toBe("sent");
    const active = await prisma.hostChannelBinding.findFirstOrThrow({ where: { organizationId: s.orgId, status: "active" } });
    expect((await prisma.hostQuestion.findFirstOrThrow({ where: { conversationId: s.conversationId } })).bindingId).toBe(active.id);
  });
});

// ---------------------------------------------------------------------------
// Saklama (tasarım §6; sert inceleme 10-31 S-3 — belgede vardı, kodda yoktu): kapanmış satır 90 gün, iptal edilmiş numara 30 gün.
// ---------------------------------------------------------------------------
describe("saklama — saatlik süpürge", () => {
  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("HOST_CHANNEL_HMAC_SECRET", "test-host-channel-secret-0123456789abcdef");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("90 günden eski kapanmış satır silinir (bildirim dahil); misafire giden cevabı işaretleyen satır, canlı ve yeni satır KALIR; 30 günden eski iptal bağlantı silinir", async () => {
    const s = await seed();
    const DAY = 24 * 3600_000;
    const old = new Date(Date.now() - 100 * DAY);
    const row = (key: string, status: string, createdAt: Date, extra: Record<string, unknown> = {}) =>
      prisma.hostQuestion.create({
        data: {
          organizationId: s.orgId,
          conversationId: s.conversationId,
          kind: key.startsWith("alert") ? "alert" : "info",
          turnMessageId: key,
          status,
          idempotencyKey: key,
          createdAt,
          expiresAt: new Date(Date.now() + DAY),
          ...extra,
        },
      });
    await row("alert:old", "alerted", old);
    await row("turn:old-expired", "expired", old);
    await row("turn:old-result", "done", old, { resultMessageId: "msg-result-1" });
    await row("turn:old-live", "awaiting_confirm", old);
    await row("turn:recent", "declined", new Date(Date.now() - 10 * DAY));
    const user = await prisma.user.findFirstOrThrow({ where: { organizationId: s.orgId } });
    const revoked = (id: string, at: Date) =>
      prisma.hostChannelBinding.create({
        data: { id, organizationId: s.orgId, userId: user.id, provider: WHATSAPP_CLOUD_PROVIDER, addressHash: `h-${id}`, addressEnc: "x", status: "revoked", revokedAt: at },
      });
    await revoked("rv-old", new Date(Date.now() - 40 * DAY));
    await revoked("rv-new", new Date(Date.now() - 5 * DAY));
    // Hiç doğrulanmamış numara (S-4): kodu 40 gün önce geçmiş bekleyen bağlantı silinir; yenisi kalır.
    const pending = (id: string, expiredAt: Date) =>
      prisma.hostChannelBinding.create({
        data: { id, organizationId: s.orgId, userId: user.id, provider: WHATSAPP_CLOUD_PROVIDER, addressHash: `h-${id}`, addressEnc: "x", status: "pending", verifyExpiresAt: expiredAt },
      });
    await pending("pd-old", new Date(Date.now() - 40 * DAY));
    await pending("pd-new", new Date(Date.now() - 1 * DAY));

    const r = await sweepHostQuestions(new Date(), null);
    expect(r.deleted).toBe(2);
    expect((await prisma.hostQuestion.findMany({ select: { idempotencyKey: true }, orderBy: { idempotencyKey: "asc" } })).map((x) => x.idempotencyKey)).toEqual([
      "turn:old-live",
      "turn:old-result",
      "turn:recent",
    ]);
    expect((await prisma.hostChannelBinding.findMany({ select: { id: true } })).map((b) => b.id).sort()).toEqual(
      [...(await prisma.hostChannelBinding.findMany({ where: { status: "active" }, select: { id: true } })).map((b) => b.id), "pd-new", "rv-new"].sort(),
    );
  });
});
