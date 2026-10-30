import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";

const { composeMock, sendMock, budgetMock } = vi.hoisted(() => ({
  composeMock: vi.fn(),
  sendMock: vi.fn(),
  budgetMock: vi.fn(async () => ({ ok: true, retryAfter: 0, cap: 100 })),
}));
vi.mock("@/lib/host-channel/compose", () => ({ composeGuestReplyFromHostAnswer: composeMock }));
vi.mock("@/lib/host-send", () => ({ sendHostMessage: sendMock }));
vi.mock("@/lib/ai/daily-budget", () => ({ consumeDailyAiBudget: budgetMock }));

import { prisma, resetDb } from "../helpers/db";

// Casus dosya başında BİR KEZ kurulur, geri alınmaz (Prisma temsilcisi deseni); bayrak açıkken bağlantı okumasının N'inci çağrısı "yok" döner —
// gönderimden hemen önceki ikinci bağlantı denetimini sınamak için.
let failBindingReadAt = 0;
let throwBindingReadAt = 0;
let bindingReads = 0;
const realBindingFindFirst = prisma.hostChannelBinding.findFirst.bind(prisma.hostChannelBinding);
vi.spyOn(prisma.hostChannelBinding, "findFirst").mockImplementation(((args: Parameters<typeof realBindingFindFirst>[0]) => {
  bindingReads++;
  if (failBindingReadAt > 0 && bindingReads === failBindingReadAt) return Promise.resolve(null);
  if (throwBindingReadAt > 0 && bindingReads === throwBindingReadAt) return Promise.reject(new Error("baglanti koptu"));
  return realBindingFindFirst(args);
}) as never);
// Soru okumaları kaydedilir (geçiş, geri alınmaz): başka işletmenin sorusunun İÇERİĞİ hiç okunmuyor mu (sorgu düzeyinde pin).
const questionReads: { where?: Record<string, unknown>; select?: Record<string, unknown> }[] = [];
const realQuestionFindFirst = prisma.hostQuestion.findFirst.bind(prisma.hostQuestion);
vi.spyOn(prisma.hostQuestion, "findFirst").mockImplementation(((args: Parameters<typeof realQuestionFindFirst>[0]) => {
  questionReads.push({ where: args?.where as Record<string, unknown>, select: args?.select as Record<string, unknown> });
  return realQuestionFindFirst(args);
}) as never);
import { startHostBinding, confirmHostBindingFromInbound } from "@/lib/host-channel/binding";
import { WHATSAPP_CLOUD_PROVIDER } from "@/lib/host-channel/providers";
import { handleHostInbound } from "@/lib/host-channel/inbound";
import {
  HOST_TEXTS,
  HOST_ANSWER_MAX,
  HOST_QUESTION_LIVE_STATUSES,
  MAX_COMPOSE_PER_QUESTION,
  STUCK_MS,
  HOST_QUESTION_TEXT_RETENTION_MS,
  hostQuestionButtonId,
  sweepHostQuestions,
} from "@/lib/host-channel/answer";
import { listConversationItems } from "@/lib/conversation-items/store";
import { eraseReservationData } from "@/lib/erasure";
import { readFileSync } from "node:fs";
import { hostChannelFlagsFromEnv } from "@/lib/host-channel/routing";
import type { HostChannelTransport, HostChoice, HostInboundEvent } from "@/lib/host-channel/types";

// ---------------------------------------------------------------------------
// WhatsApp cevap dilimi (tasarım §3.4–3.8) — gerçek veritabanı; taslak modeli, gönderim çekirdeği ve günlük bütçe taklit. Pinlenen: cevap doğru
// soruya bağlanır (bağlam ya da tek bekleyen), şifreli saklanır; önizleme + [Gönder] [Gönderme]; onayda gönderimden hemen önce yeniden
// doğrulama; çift dokunuş / eski düğme ikinci mesaj üretmez; kısmi cevapta misafire hiçbir şey gitmez; başka işletmenin sorusuna (bağlam /
// düğme kimliğiyle) işlem yapılamaz (reddin SEBEBİ: soru gönderenin bağlantısında aranır); süpürge süresi dolanı kapatır, takılanı kurtarır,
// kapanmış metni siler.
// ---------------------------------------------------------------------------

const SECRET = "test-host-channel-secret-0123456789abcdef";
const DIG_A = "905321112233";
const DIG_B = "4915112345678";

type Sent = { kind: "text" | "choices"; to: string; text: string; choices?: readonly HostChoice[]; replyTo?: string | null };
function fakeTransport() {
  const out: Sent[] = [];
  let n = 0;
  const t: HostChannelTransport = {
    provider: WHATSAPP_CLOUD_PROVIDER,
    async sendQuestion() {
      return { ok: true, providerMessageId: `wamid.q${++n}` };
    },
    async sendText(to, text, replyTo) {
      out.push({ kind: "text", to, text, replyTo });
      return { ok: true, providerMessageId: `wamid.t${++n}` };
    },
    async sendChoices(to, text, choices, replyTo) {
      out.push({ kind: "choices", to, text, choices, replyTo });
      return { ok: true, providerMessageId: `wamid.p${++n}` };
    },
  };
  return { t, out };
}

async function seedHost(digits: string, raw: string) {
  const org = await prisma.organization.create({ data: { name: "Test Org" } });
  const user = await prisma.user.create({
    data: { organizationId: org.id, name: "Ayla Ev Sahibi", email: `u${Math.random().toString(36).slice(2)}@example.test`, passwordHash: "x", role: "owner" },
  });
  const r = await startHostBinding({ organizationId: org.id, userId: user.id, provider: WHATSAPP_CLOUD_PROVIDER, rawNumber: raw, optInTextVersion: "v1" });
  if (!r.ok) throw new Error(r.reason);
  const c = await confirmHostBindingFromInbound({ provider: WHATSAPP_CLOUD_PROVIDER, fromDigits: digits, code: r.code });
  if (!c.ok) throw new Error(c.reason);
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale" } });
  return { orgId: org.id, userId: user.id, bindingId: r.bindingId, propertyId: property.id, digits };
}

async function seedQuestion(
  h: Awaited<ReturnType<typeof seedHost>>,
  wamid: string,
  opts: { createdAt?: Date; status?: string; conversationId?: string; reservationId?: string } = {},
) {
  if (opts.conversationId && opts.reservationId) return seedQuestionIn(h, wamid, opts.conversationId, opts.reservationId, opts);
  const reservation = await prisma.reservation.create({
    data: {
      propertyId: h.propertyId,
      guestName: "Misafir",
      arrivalDate: new Date("2026-11-12T00:00:00Z"),
      departureDate: new Date("2026-11-15T00:00:00Z"),
      status: "confirmed",
      channel: "airbnb",
    },
  });
  const conv = await prisma.conversation.create({
    data: { propertyId: h.propertyId, channel: "airbnb", guestIdentifier: "Misafir", status: "new", reservationId: reservation.id },
  });
  return seedQuestionIn(h, wamid, conv.id, reservation.id, opts);
}

async function seedQuestionIn(
  h: Awaited<ReturnType<typeof seedHost>>,
  wamid: string,
  conversationId: string,
  reservationId: string,
  opts: { createdAt?: Date; status?: string },
) {
  const conv = { id: conversationId };
  const reservation = { id: reservationId };
  const created = opts.createdAt ?? new Date(Date.now() - 60_000);
  const turn = await prisma.message.create({
    data: { conversationId: conv.id, direction: "inbound", senderName: "Misafir", body: "Is there a baby cot?", createdAt: new Date(created.getTime() - 1_000) },
  });
  const id = randomUUID();
  await prisma.hostQuestion.create({
    data: {
      id,
      organizationId: h.orgId,
      conversationId: conv.id,
      bindingId: h.bindingId,
      kind: "info",
      turnMessageId: turn.id,
      status: opts.status ?? "sent",
      idempotencyKey: `turn:${turn.id}`,
      providerMessageId: wamid,
      sentAt: created,
      createdAt: created,
      expiresAt: new Date(created.getTime() + 24 * 3600_000),
    },
  });
  return { questionId: id, conversationId: conv.id, reservationId: reservation.id };
}

const text = (from: string, id: string, body: string, contextId: string | null = null): HostInboundEvent => ({
  kind: "text",
  from,
  providerMessageId: id,
  contextId,
  text: body,
  at: new Date(),
});
const button = (from: string, id: string, buttonId: string, contextId: string | null = null): HostInboundEvent => ({
  kind: "button",
  from,
  providerMessageId: id,
  contextId,
  buttonId,
  title: "Gönder",
  at: new Date(),
});

let tr: ReturnType<typeof fakeTransport>;
const deliver = (events: HostInboundEvent[]) =>
  handleHostInbound({ provider: WHATSAPP_CLOUD_PROVIDER, events, flags: hostChannelFlagsFromEnv(), transport: tr.t });
const question = (id: string) => prisma.hostQuestion.findUniqueOrThrow({ where: { id } });
const lastText = () => tr.out[tr.out.length - 1]?.text ?? "";
const OK_DRAFT = { ok: true, kind: "answer", reply: "Yes, there is a baby cot in the closet.", replyTr: "Evet, dolapta bebek yatağı var.", uncovered: [] };

async function previewed(h: Awaited<ReturnType<typeof seedHost>>, wamid = "wamid.Q1") {
  const q = await seedQuestion(h, wamid);
  composeMock.mockResolvedValueOnce(OK_DRAFT);
  await deliver([text(h.digits, `wamid.a-${q.questionId}`, "var, dolapta", wamid)]);
  const row = await question(q.questionId);
  return { ...q, version: row.version };
}

describe("WhatsApp cevap dilimi", () => {
  beforeEach(async () => {
    await resetDb();
    composeMock.mockReset();
    sendMock.mockReset();
    budgetMock.mockClear();
    failBindingReadAt = 0;
    throwBindingReadAt = 0;
    bindingReads = 0;
    vi.stubEnv("HOST_CHANNEL_ENABLED", "1");
    vi.stubEnv("HOST_QUESTIONS_ENABLED", "1");
    vi.stubEnv("HOST_CHANNEL_ORG_IDS", "*");
    vi.stubEnv("HOST_CHANNEL_HMAC_SECRET", SECRET);
    tr = fakeTransport();
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("soru anahtarı KAPALI: cevap yalnız alınır — taslak kurulmaz, soru açık kalır", async () => {
    vi.stubEnv("HOST_QUESTIONS_ENABLED", "");
    const h = await seedHost(DIG_A, "+90 532 111 22 33");
    const q = await seedQuestion(h, "wamid.Q1");
    await deliver([text(DIG_A, "wamid.a1", "var, dolapta", "wamid.Q1")]);
    expect(composeMock).not.toHaveBeenCalled();
    expect((await question(q.questionId)).status).toBe("sent");
    expect(tr.out).toHaveLength(0);
  });

  it("bağlamla cevap → şifreli saklanır, taslak + önizleme [Gönder] [Gönderme]; misafire henüz HİÇBİR ŞEY gitmez", async () => {
    const h = await seedHost(DIG_A, "+90 532 111 22 33");
    const q = await previewed(h);
    const row = await question(q.questionId);
    expect(row).toMatchObject({ status: "awaiting_confirm", answerMessageId: `wamid.a-${q.questionId}`, composeCount: 1 });
    expect(row.answerEnc).toBeTruthy();
    expect(row.answerEnc).not.toContain("dolapta");
    expect(row.draftEnc).not.toContain("baby cot");
    expect(row.previewMessageId).toMatch(/^wamid\.p/);
    expect(composeMock).toHaveBeenCalledWith({ hostAnswer: "var, dolapta", guestMessages: ["Is there a baby cot?"] });
    const p = tr.out.find((o) => o.kind === "choices")!;
    expect(p.to).toBe(DIG_A);
    // Hangi daire / konaklama / soru: iki benzer soru karışmasın; önizleme SORU mesajına yanıt (sert inceleme 10-30 A2).
    expect(p.text.startsWith("Lale · 12–15 Kas\n“Is there a baby cot?”\n\n")).toBe(true);
    expect(p.replyTo).toBe("wamid.Q1");
    expect(p.text).toContain("Yes, there is a baby cot in the closet.");
    expect(p.text).toContain("Evet, dolapta bebek yatağı var.");
    expect(p.choices).toEqual([
      { id: hostQuestionButtonId(q.questionId, row.version, "send"), title: HOST_TEXTS.send },
      { id: hostQuestionButtonId(q.questionId, row.version, "cancel"), title: HOST_TEXTS.cancel },
    ]);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("[Gönder] → bugünkü gönderim çekirdeği (ev sahibinin adıyla, yapay zekâ destekli, sürüme bağlı tekil anahtar); çift dokunuş ikinci mesaj üretmez", async () => {
    const h = await seedHost(DIG_A, "+90 532 111 22 33");
    const q = await previewed(h);
    sendMock.mockResolvedValue({ status: "sent", message: { id: "msg-1" } });
    const id = hostQuestionButtonId(q.questionId, q.version, "send");
    await deliver([button(DIG_A, "wamid.b1", id)]);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0]![0]).toMatchObject({
      organizationId: h.orgId,
      body: OK_DRAFT.reply,
      claimBody: OK_DRAFT.reply,
      senderName: "Ayla Ev Sahibi",
      aiAssisted: true,
      idempotencyKey: `host-q:${q.questionId}:v${q.version + 1}`,
      strictIdempotency: true,
    });
    expect(await question(q.questionId)).toMatchObject({ status: "done", resultMessageId: "msg-1" });
    expect(lastText()).toBe(HOST_TEXTS.sent);
    const before = tr.out.length;
    await deliver([button(DIG_A, "wamid.b2", id)]);
    expect(sendMock).toHaveBeenCalledTimes(1);
    // Gitmiş cevabın düğmesine ikinci dokunuş: "geçersiz önizleme" DENMEZ (panelden yeniden yazdırırdı) — sessiz (sert inceleme 10-30 A2).
    expect(tr.out).toHaveLength(before);
  });

  it("[Gönderme] → gönderilmez, soru 'declined'", async () => {
    const h = await seedHost(DIG_A, "+90 532 111 22 33");
    const q = await previewed(h);
    await deliver([button(DIG_A, "wamid.b1", hostQuestionButtonId(q.questionId, q.version, "cancel"))]);
    expect(sendMock).not.toHaveBeenCalled();
    expect((await question(q.questionId)).status).toBe("declined");
    expect(lastText()).toBe(HOST_TEXTS.declined);
  });

  it("eski önizlemenin düğmesi (yeni cevapla yeni taslak kuruldu) yeni taslağı onaylayamaz", async () => {
    const h = await seedHost(DIG_A, "+90 532 111 22 33");
    const q = await previewed(h);
    composeMock.mockResolvedValueOnce({ ...OK_DRAFT, reply: "Yes, a baby cot is in the bedroom closet.", replyTr: "Evet." });
    await deliver([text(DIG_A, "wamid.a2", "yatak odasındaki dolapta", "wamid.Q1")]);
    expect((await question(q.questionId)).version).toBeGreaterThan(q.version);
    await deliver([button(DIG_A, "wamid.b1", hostQuestionButtonId(q.questionId, q.version, "send"))]);
    expect(sendMock).not.toHaveBeenCalled();
    expect(lastText()).toBe(HOST_TEXTS.stalePreview);
  });

  it("🚨 cevap sorunun tamamını karşılamıyor → misafire HİÇBİR ŞEY gitmez, soru açık kalır (önizleme yok)", async () => {
    const h = await seedHost(DIG_A, "+90 532 111 22 33");
    const q = await seedQuestion(h, "wamid.Q1");
    composeMock.mockResolvedValueOnce({ ...OK_DRAFT, uncovered: ["high chair"] });
    await deliver([text(DIG_A, "wamid.a1", "yatak var", "wamid.Q1")]);
    expect(await question(q.questionId)).toMatchObject({ status: "sent", composeCount: 1 });
    expect(tr.out.some((o) => o.kind === "choices")).toBe(false);
    expect(lastText()).toContain(HOST_TEXTS.partial);
    expect(lastText()).toContain(`/inbox/${q.conversationId}`);
  });

  it("'ben yazacağım' → model çağrılmaz, soru ev sahibinde; 'bilmiyorum' → soru panelde açık; anlaşılmayan → yeniden açık", async () => {
    const h = await seedHost(DIG_A, "+90 532 111 22 33");
    const q1 = await seedQuestion(h, "wamid.Q1");
    await deliver([text(DIG_A, "wamid.a1", "Tamam, ben yazarım", "wamid.Q1")]);
    expect(composeMock).not.toHaveBeenCalled();
    expect((await question(q1.questionId)).status).toBe("host_takes_over");
    expect(lastText()).toBe(HOST_TEXTS.takesOver);

    const q2 = await seedQuestion(h, "wamid.Q2");
    composeMock.mockResolvedValueOnce({ ok: false, kind: "host_unknown", reason: "not_an_answer" });
    await deliver([text(DIG_A, "wamid.a2", "bilmiyorum", "wamid.Q2")]);
    expect((await question(q2.questionId)).status).toBe("host_unknown");
    expect(lastText()).toBe(HOST_TEXTS.unknown);

    const q3 = await seedQuestion(h, "wamid.Q3");
    composeMock.mockResolvedValueOnce({ ok: false, kind: "answer", reason: "number_not_in_source" });
    await deliver([text(DIG_A, "wamid.a3", "olur", "wamid.Q3")]);
    expect(await question(q3.questionId)).toMatchObject({ status: "sent", composeCount: 1 });
    expect(lastText()).toContain(HOST_TEXTS.unclear);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("bağlamsız düz cevap: tek bekleyen soruya bağlanır; birden çoksa 'hangi soru' der; hiç yoksa günde bir kez 'bekleyen soru yok'", async () => {
    const h = await seedHost(DIG_A, "+90 532 111 22 33");
    await deliver([text(DIG_A, "wamid.n1", "selam")]);
    expect(lastText()).toBe(HOST_TEXTS.none);
    const before = tr.out.length;
    await deliver([text(DIG_A, "wamid.n2", "selam")]);
    expect(tr.out).toHaveLength(before);

    const q1 = await seedQuestion(h, "wamid.Q1");
    composeMock.mockResolvedValueOnce(OK_DRAFT);
    await deliver([text(DIG_A, "wamid.a1", "var, dolapta")]);
    expect((await question(q1.questionId)).status).toBe("awaiting_confirm");

    await seedQuestion(h, "wamid.Q2");
    await seedQuestion(h, "wamid.Q3");
    composeMock.mockClear();
    await deliver([text(DIG_A, "wamid.a2", "evet")]);
    expect(composeMock).not.toHaveBeenCalled();
    expect(lastText()).toBe(HOST_TEXTS.ambiguous);
  });

  it("kapanmış soruya geç cevap: panelden cevaplandı / süresi geçti → misafire hiçbir şey gitmez", async () => {
    const h = await seedHost(DIG_A, "+90 532 111 22 33");
    const q = await seedQuestion(h, "wamid.Q1", { status: "answered_elsewhere" });
    await deliver([text(DIG_A, "wamid.a1", "var", "wamid.Q1")]);
    expect(lastText()).toBe(HOST_TEXTS.closedElsewhere);
    const old = await seedQuestion(h, "wamid.Q2", { createdAt: new Date(Date.now() - 30 * 3600_000) });
    await deliver([text(DIG_A, "wamid.a2", "var", "wamid.Q2")]);
    expect(lastText()).toBe(HOST_TEXTS.closedExpired);
    expect(composeMock).not.toHaveBeenCalled();
    expect((await question(q.questionId)).status).toBe("answered_elsewhere");
    expect((await question(old.questionId)).status).toBe("sent");
  });

  describe("🚨 çapraz kiracı — soru YALNIZ gönderenin bağlantısında aranır", () => {
    it("A'nın numarasından, B'nin sorusunun düğme kimliği / bağlam kimliği → B'ye hiçbir şey olmaz", async () => {
      const a = await seedHost(DIG_A, "+90 532 111 22 33");
      const b = await seedHost(DIG_B, "+49 151 12345678");
      const qb = await previewed(b, "wamid.QB");
      const beforeB = await question(qb.questionId);
      await deliver([button(DIG_A, "wamid.x1", hostQuestionButtonId(qb.questionId, qb.version, "send"))]);
      await deliver([text(DIG_A, "wamid.x2", "var, dolapta", "wamid.QB")]);
      await deliver([text(DIG_A, "wamid.x3", "var, dolapta", beforeB.previewMessageId)]);
      expect(sendMock).not.toHaveBeenCalled();
      expect(composeMock).toHaveBeenCalledTimes(1); // yalnız B'nin kendi önizlemesi
      expect(await question(qb.questionId)).toEqual(beforeB);
      expect(await prisma.operationalEvent.count({ where: { event: "host_channel.answer.foreign", organizationId: a.orgId } })).toBe(3);
    });

    it("🚨 'yanıtla' bağlamı başka işletmenin sorusuysa o sorunun İÇERİĞİ okunmaz — yalnız işletme kimliğine bakılır (Haiku 10-30 P3)", async () => {
      const a = await seedHost(DIG_A, "+90 532 111 22 33");
      const b = await seedHost(DIG_B, "+49 151 12345678");
      await previewed(b, "wamid.QB");
      questionReads.length = 0;
      await deliver([text(DIG_A, "wamid.x9", "var, dolapta", "wamid.QB")]);
      expect(questionReads.length).toBeGreaterThan(0);
      for (const r of questionReads) {
        const org = r.where?.organizationId;
        if (org === a.orgId) continue;
        // Başka işletme yalnız "var mı" sorusuyla, yalnız işletme kimliği seçilerek sorulabilir.
        expect(org).toEqual({ not: a.orgId });
        expect(r.select).toEqual({ organizationId: true });
      }
    });
  });

  describe("gönderimden hemen önce yeniden doğrulama", () => {
    it("önizlemeden sonra misafir yeniden yazdı → gönderilmez, soru açık", async () => {
      const h = await seedHost(DIG_A, "+90 532 111 22 33");
      const q = await previewed(h);
      await prisma.message.create({ data: { conversationId: q.conversationId, direction: "inbound", senderName: "Misafir", body: "also a high chair?" } });
      await deliver([button(DIG_A, "wamid.b1", hostQuestionButtonId(q.questionId, q.version, "send"))]);
      expect(sendMock).not.toHaveBeenCalled();
      expect((await question(q.questionId)).status).toBe("superseded");
      expect(lastText()).toContain(HOST_TEXTS.guestWrote);
    });

    it("ev sahibi arada panelden cevap verdi → gönderilmez ('panelden cevapladınız')", async () => {
      const h = await seedHost(DIG_A, "+90 532 111 22 33");
      const q = await previewed(h);
      await prisma.message.create({
        data: { conversationId: q.conversationId, direction: "outbound", senderName: "Ayla", authorType: "host", body: "Evet var." },
      });
      await deliver([button(DIG_A, "wamid.b1", hostQuestionButtonId(q.questionId, q.version, "send"))]);
      expect(sendMock).not.toHaveBeenCalled();
      expect((await question(q.questionId)).status).toBe("answered_elsewhere");
      expect(lastText().startsWith(`${HOST_TEXTS.closedElsewhere} `)).toBe(true);
      expect(lastText().endsWith(`/inbox/${q.conversationId}`)).toBe(true);
    });

    it("panelden cevaplanmış soruya gelen WhatsApp cevabı taslak bile kurdurmaz", async () => {
      const h = await seedHost(DIG_A, "+90 532 111 22 33");
      const q = await seedQuestion(h, "wamid.Q1");
      await prisma.message.create({
        data: { conversationId: q.conversationId, direction: "outbound", senderName: "Ayla", authorType: "host", body: "Evet var." },
      });
      await deliver([text(DIG_A, "wamid.a1", "var", "wamid.Q1")]);
      expect(composeMock).not.toHaveBeenCalled();
      expect((await question(q.questionId)).status).toBe("answered_elsewhere");
    });

    it("rezervasyon iptal → gönderilmez; şifre değişti (oturum kuşağı) → düğme işlenmez; taslak değişti → gönderilmez", async () => {
      const h = await seedHost(DIG_A, "+90 532 111 22 33");
      const q1 = await previewed(h, "wamid.Q1");
      await prisma.reservation.update({ where: { id: q1.reservationId }, data: { status: "cancelled" } });
      await deliver([button(DIG_A, "wamid.b1", hostQuestionButtonId(q1.questionId, q1.version, "send"))]);
      expect((await question(q1.questionId)).status).toBe("superseded");

      const q2 = await previewed(h, "wamid.Q2");
      await prisma.hostQuestion.update({ where: { id: q2.questionId }, data: { draftHash: "0".repeat(64) } });
      await deliver([button(DIG_A, "wamid.b2", hostQuestionButtonId(q2.questionId, q2.version, "send"))]);
      expect((await question(q2.questionId)).status).toBe("sent");

      const q3 = await previewed(h, "wamid.Q3");
      await prisma.user.update({ where: { id: h.userId }, data: { sessionEpoch: { increment: 1 } } });
      await deliver([button(DIG_A, "wamid.b3", hostQuestionButtonId(q3.questionId, q3.version, "send"))]);
      expect((await question(q3.questionId)).status).toBe("awaiting_confirm");
      expect(sendMock).not.toHaveBeenCalled();
    });

    it.each([
      [{ status: "failed_ambiguous" }, "send_unverified", HOST_TEXTS.unverified],
      [{ status: "duplicate" }, "send_unverified", HOST_TEXTS.unverified],
      [{ status: "failed_definitive", error: "x" }, "sent", HOST_TEXTS.sendFailed],
      [{ status: "claim_unavailable" }, "sent", HOST_TEXTS.sendFailed],
      [{ status: "idempotency_conflict" }, "send_unverified", HOST_TEXTS.unverified],
      [{ status: "not_connected" }, "sent", HOST_TEXTS.notConnected],
      [{ status: "queued", message: null, deduped: false }, "done", HOST_TEXTS.queued],
    ])("gönderim sonucu %j → soru %s", async (result, status, msg) => {
      const h = await seedHost(DIG_A, "+90 532 111 22 33");
      const q = await previewed(h);
      sendMock.mockResolvedValueOnce(result);
      await deliver([button(DIG_A, "wamid.b1", hostQuestionButtonId(q.questionId, q.version, "send"))]);
      expect((await question(q.questionId)).status).toBe(status);
      expect(lastText()).toContain(msg);
    });

    it("gönderim çekirdeği fırlatırsa 'doğrulanamadı' (kör tekrar YOK)", async () => {
      const h = await seedHost(DIG_A, "+90 532 111 22 33");
      const q = await previewed(h);
      sendMock.mockRejectedValueOnce(new Error("db"));
      await deliver([button(DIG_A, "wamid.b1", hostQuestionButtonId(q.questionId, q.version, "send"))]);
      expect((await question(q.questionId)).status).toBe("send_unverified");
    });
  });

  it("🚨 aynı konuşmanın İKİNCİ sorusu: birincisinin WhatsApp'tan onaylanıp giden cevabı 'panelden cevaplandı' SAYILMAZ (Haiku 10-30 P2)", async () => {
    const h = await seedHost(DIG_A, "+90 532 111 22 33");
    const q1 = await seedQuestion(h, "wamid.Q1");
    const q2 = await seedQuestion(h, "wamid.Q2", { conversationId: q1.conversationId, reservationId: q1.reservationId });
    sendMock.mockImplementation(async (input: { conversation: { id: string }; body: string; senderName: string }) => {
      const m = await prisma.message.create({
        data: { conversationId: input.conversation.id, direction: "outbound", authorType: "host", senderName: input.senderName, body: input.body },
      });
      return { status: "sent", message: m };
    });
    composeMock.mockResolvedValueOnce(OK_DRAFT);
    await deliver([text(DIG_A, "wamid.a1", "var, dolapta", "wamid.Q1")]);
    const v1 = (await question(q1.questionId)).version;
    await deliver([button(DIG_A, "wamid.b1", hostQuestionButtonId(q1.questionId, v1, "send"))]);
    expect((await question(q1.questionId)).status).toBe("done");

    composeMock.mockResolvedValueOnce({ ...OK_DRAFT, reply: "Yes, there is a high chair.", replyTr: "Evet, mama sandalyesi var." });
    await deliver([text(DIG_A, "wamid.a2", "mama sandalyesi de var", "wamid.Q2")]);
    const r2 = await question(q2.questionId);
    expect(r2.status).toBe("awaiting_confirm");
    await deliver([button(DIG_A, "wamid.b2", hostQuestionButtonId(q2.questionId, r2.version, "send"))]);
    expect((await question(q2.questionId)).status).toBe("done");
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it("süresi geçmiş sorunun önizlemesi onaylanamaz (süpürge henüz kapatmamış olsa da)", async () => {
    const h = await seedHost(DIG_A, "+90 532 111 22 33");
    const q = await previewed(h);
    await prisma.hostQuestion.update({ where: { id: q.questionId }, data: { expiresAt: new Date(Date.now() - 1_000) } });
    await deliver([button(DIG_A, "wamid.b1", hostQuestionButtonId(q.questionId, q.version, "send"))]);
    expect(sendMock).not.toHaveBeenCalled();
    expect(lastText()).toBe(HOST_TEXTS.closedExpired);
  });

  it("bağlantı gönderimden HEMEN önce yeniden denetlenir: arada kapandıysa misafire gitmez", async () => {
    const h = await seedHost(DIG_A, "+90 532 111 22 33");
    const q = await previewed(h);
    bindingReads = 0;
    failBindingReadAt = 2; // 1: girişteki denetim geçer · 2: gönderim öncesi denetim → bağlantı yok
    await deliver([button(DIG_A, "wamid.b1", hostQuestionButtonId(q.questionId, q.version, "send"))]);
    expect(sendMock).not.toHaveBeenCalled();
    expect((await question(q.questionId)).status).toBe("sent");
  });

  it("önizleme WhatsApp sınırını (1024) aşarsa gönderilmez — kesik metin onaylanamaz; Türkçe satırı düşürmek yetiyorsa o hâli gider", async () => {
    const h = await seedHost(DIG_A, "+90 532 111 22 33");
    const q = await seedQuestion(h, "wamid.Q1");
    composeMock.mockResolvedValueOnce({ ...OK_DRAFT, reply: "a ".repeat(520).trim(), replyTr: "b" });
    await deliver([text(DIG_A, "wamid.a1", "var", "wamid.Q1")]);
    expect((await question(q.questionId)).status).toBe("sent");
    expect(tr.out.some((o) => o.kind === "choices")).toBe(false);
    expect(lastText()).toContain(HOST_TEXTS.unclear);

    const q2 = await seedQuestion(h, "wamid.Q2");
    composeMock.mockResolvedValueOnce({ ...OK_DRAFT, reply: "c ".repeat(400).trim(), replyTr: "d ".repeat(300).trim() });
    await deliver([text(DIG_A, "wamid.a2", "var", "wamid.Q2")]);
    expect((await question(q2.questionId)).status).toBe("awaiting_confirm");
    const p = tr.out.filter((o) => o.kind === "choices").pop()!;
    expect(p.text.length).toBeLessThanOrEqual(1024);
    expect(p.text).not.toContain(HOST_TEXTS.previewTr);
  });

  it("önizleme ev sahibine ulaşmazsa taslak 'onay bekliyor'da kalmaz — soru yeniden açık", async () => {
    const h = await seedHost(DIG_A, "+90 532 111 22 33");
    const q = await seedQuestion(h, "wamid.Q1");
    tr.t.sendChoices = async () => ({ ok: false, providerMessageId: null, definitive: true, error: "x" });
    composeMock.mockResolvedValueOnce(OK_DRAFT);
    await deliver([text(DIG_A, "wamid.a1", "var", "wamid.Q1")]);
    expect(await question(q.questionId)).toMatchObject({ status: "sent", draftEnc: null, draftHash: null });
    // Ev sahibi cevap verdi ve sessizlikte kalmaz (sert inceleme 10-30 A2).
    expect(lastText()).toContain(HOST_TEXTS.composeFailed);
  });

  it("günlük yapay zekâ bütçesi bittiyse / soru başına taslak tavanı dolduysa model çağrılmaz", async () => {
    const h = await seedHost(DIG_A, "+90 532 111 22 33");
    const q = await seedQuestion(h, "wamid.Q1");
    budgetMock.mockResolvedValueOnce({ ok: false, retryAfter: 60, cap: 1 });
    await deliver([text(DIG_A, "wamid.a1", "var", "wamid.Q1")]);
    expect(composeMock).not.toHaveBeenCalled();
    expect((await question(q.questionId)).status).toBe("sent");
    expect(lastText()).toContain(HOST_TEXTS.composeFailed);

    await prisma.hostQuestion.update({ where: { id: q.questionId }, data: { composeCount: MAX_COMPOSE_PER_QUESTION } });
    await deliver([text(DIG_A, "wamid.a2", "var", "wamid.Q1")]);
    expect(composeMock).not.toHaveBeenCalled();
    expect(lastText()).toContain(HOST_TEXTS.composeLimit);
  });

  describe("sert inceleme 10-30 A2 — yarıda düşme, birikmeli cevap, bayat taslak, kapsam", () => {
    it("🚨 taslak kurulurken hata: soru yeniden açık, Meta'nın yeniden teslimi kaldığı yerden işler — cevap metni ikilenmez", async () => {
      const h = await seedHost(DIG_A, "+90 532 111 22 33");
      const q = await seedQuestion(h, "wamid.Q1");
      composeMock.mockRejectedValueOnce(new Error("model katmani dustu"));
      await expect(deliver([text(DIG_A, "wamid.a1", "var, dolapta", "wamid.Q1")])).rejects.toThrow();
      expect(await question(q.questionId)).toMatchObject({ status: "sent", answerMessageId: "wamid.a1" });
      composeMock.mockResolvedValueOnce(OK_DRAFT);
      await deliver([text(DIG_A, "wamid.a1", "var, dolapta", "wamid.Q1")]);
      expect(composeMock).toHaveBeenLastCalledWith({ hostAnswer: "var, dolapta", guestMessages: ["Is there a baby cot?"] });
      expect((await question(q.questionId)).status).toBe("awaiting_confirm");
      expect(tr.out.filter((o) => o.kind === "choices")).toHaveLength(1);
    });

    it("🚨 süreç taslak kurarken ÖLDÜ (soru 'işleniyor'da kaldı): aynı mesajın yeniden teslimi devralır; önizleme gittikten sonra bir daha işlenmez", async () => {
      const h = await seedHost(DIG_A, "+90 532 111 22 33");
      const q = await seedQuestion(h, "wamid.Q1");
      composeMock.mockRejectedValueOnce(new Error("surec oldu"));
      await expect(deliver([text(DIG_A, "wamid.a1", "var, dolapta", "wamid.Q1")])).rejects.toThrow();
      // Yeniden açma da yazılamadı (süreç gerçekten öldü): soru "işleniyor"da.
      await prisma.hostQuestion.update({ where: { id: q.questionId }, data: { status: "answered" } });
      composeMock.mockResolvedValueOnce(OK_DRAFT);
      await deliver([text(DIG_A, "wamid.a1", "var, dolapta", "wamid.Q1")]);
      expect((await question(q.questionId)).status).toBe("awaiting_confirm");
      expect(tr.out.filter((o) => o.kind === "choices")).toHaveLength(1);
      // Gelen mesaj kilidi silinse bile (çok geç yeniden teslim) aynı mesaj ikinci önizleme / model çağrısı üretmez.
      await prisma.systemLock.deleteMany({ where: { name: { startsWith: "host-in:" } } });
      const calls = composeMock.mock.calls.length;
      const out = tr.out.length;
      await deliver([text(DIG_A, "wamid.a1", "var, dolapta", "wamid.Q1")]);
      expect(composeMock.mock.calls.length).toBe(calls);
      expect(tr.out).toHaveLength(out);
    });

    it("işlenmekte olan soruya gelen ikinci mesaj sessizce kaybolmaz — 'önceki cevabınız işleniyor'", async () => {
      const h = await seedHost(DIG_A, "+90 532 111 22 33");
      await seedQuestion(h, "wamid.Q1", { status: "answered" });
      await deliver([text(DIG_A, "wamid.a2", "pardon, YOK", "wamid.Q1")]);
      expect(composeMock).not.toHaveBeenCalled();
      expect(lastText()).toBe(HOST_TEXTS.busy);
    });

    it("🚨 kısmi cevaptan sonra yazılan eksik kısım öncekine EKLENİR (ilk kısım kaybolmaz); birikim tavanı en yeni kısmı korur", async () => {
      const h = await seedHost(DIG_A, "+90 532 111 22 33");
      const q = await seedQuestion(h, "wamid.Q1");
      composeMock.mockResolvedValueOnce({ ...OK_DRAFT, uncovered: ["high chair"] });
      await deliver([text(DIG_A, "wamid.a1", "yatak var", "wamid.Q1")]);
      composeMock.mockResolvedValueOnce(OK_DRAFT);
      await deliver([text(DIG_A, "wamid.a2", "mama sandalyesi de var", "wamid.Q1")]);
      expect(composeMock).toHaveBeenLastCalledWith({ hostAnswer: "yatak var\nmama sandalyesi de var", guestMessages: ["Is there a baby cot?"] });
      expect((await question(q.questionId)).status).toBe("awaiting_confirm");

      const q2 = await seedQuestion(h, "wamid.Q2");
      composeMock.mockResolvedValueOnce({ ...OK_DRAFT, uncovered: ["x"] });
      await deliver([text(DIG_A, "wamid.b1", "a".repeat(HOST_ANSWER_MAX), "wamid.Q2")]);
      composeMock.mockResolvedValueOnce(OK_DRAFT);
      await deliver([text(DIG_A, "wamid.b2", "yeni bilgi", "wamid.Q2")]);
      const last = composeMock.mock.calls[composeMock.mock.calls.length - 1]![0] as { hostAnswer: string };
      expect([...last.hostAnswer]).toHaveLength(HOST_ANSWER_MAX);
      expect(last.hostAnswer.endsWith("\nyeni bilgi")).toBe(true);
      expect((await question(q2.questionId)).status).toBe("awaiting_confirm");
    });

    it("🚨 soru sorulduktan sonra misafir yeniden yazdıysa (vazgeçti / düzeltti) taslak KURULMAZ — soru yerini bıraktı, ev sahibine panel", async () => {
      const h = await seedHost(DIG_A, "+90 532 111 22 33");
      const q = await seedQuestion(h, "wamid.Q1");
      await prisma.message.create({ data: { conversationId: q.conversationId, direction: "inbound", senderName: "Misafir", body: "never mind, we brought our own" } });
      await deliver([text(DIG_A, "wamid.a1", "var, dolapta", "wamid.Q1")]);
      expect(composeMock).not.toHaveBeenCalled();
      expect((await question(q.questionId)).status).toBe("superseded");
      expect(lastText()).toContain(HOST_TEXTS.guestWrote);
      expect(lastText()).toContain(`/inbox/${q.conversationId}`);
    });

    it("turun KENDİ (sorudan önceki) ek mesajları 'misafir yeniden yazdı' sayılmaz", async () => {
      const h = await seedHost(DIG_A, "+90 532 111 22 33");
      const q = await seedQuestion(h, "wamid.Q1");
      const row = await question(q.questionId);
      await prisma.message.create({
        data: { conversationId: q.conversationId, direction: "inbound", senderName: "Misafir", body: "thanks!", createdAt: new Date(row.createdAt.getTime() - 500) },
      });
      composeMock.mockResolvedValueOnce(OK_DRAFT);
      await deliver([text(DIG_A, "wamid.a1", "var, dolapta", "wamid.Q1")]);
      expect((await question(q.questionId)).status).toBe("awaiting_confirm");
    });

    it("kanalın kendi otomatik mesajı ve karar kartı mesajı 'panelden cevaplandı' SAYILMAZ; ev sahibinin panel mesajı sayılır", async () => {
      const h = await seedHost(DIG_A, "+90 532 111 22 33");
      const q = await seedQuestion(h, "wamid.Q1");
      await prisma.message.create({
        data: { conversationId: q.conversationId, direction: "outbound", authorType: "host", channelSenderRole: "automation", senderName: "Airbnb", body: "Check-in info" },
      });
      const decisionMsg = await prisma.message.create({
        data: { conversationId: q.conversationId, direction: "outbound", authorType: "host", senderName: "Ayla", body: "Erken giriş olur." },
      });
      await prisma.decisionRequest.create({
        data: { organizationId: h.orgId, conversationId: q.conversationId, messageId: "m-karar", kind: "early_checkin", lang: "tr", status: "approved", resultMessageId: decisionMsg.id },
      });
      composeMock.mockResolvedValueOnce(OK_DRAFT);
      await deliver([text(DIG_A, "wamid.a1", "var, dolapta", "wamid.Q1")]);
      expect((await question(q.questionId)).status).toBe("awaiting_confirm");

      const q2 = await seedQuestion(h, "wamid.Q2", { conversationId: q.conversationId, reservationId: q.reservationId });
      await prisma.message.create({ data: { conversationId: q.conversationId, direction: "outbound", authorType: "host", senderName: "Ayla", body: "Evet var." } });
      await deliver([text(DIG_A, "wamid.a2", "var", "wamid.Q2")]);
      expect((await question(q2.questionId)).status).toBe("answered_elsewhere");
    });

    it("🚨 WhatsApp'tan giden cevap YALNIZ turun öğesini kapatır; konuşmanın başka açık öğesi açık kalır (anahtar kapalıyken eski davranış)", async () => {
      const h = await seedHost(DIG_A, "+90 532 111 22 33");
      const q = await seedQuestion(h, "wamid.Q1");
      const row = await question(q.questionId);
      const earlier = await prisma.message.create({
        data: { conversationId: q.conversationId, direction: "inbound", senderName: "Misafir", body: "Is there an iron?", createdAt: new Date(row.createdAt.getTime() - 120_000) },
      });
      await prisma.conversationItem.createMany({
        data: [
          { organizationId: h.orgId, conversationId: q.conversationId, messageId: row.turnMessageId, kind: "checkin_time", sources: "understanding", status: "pending_host" },
          { organizationId: h.orgId, conversationId: q.conversationId, messageId: earlier.id, kind: "other", sources: "understanding", status: "pending_host" },
        ],
      });
      sendMock.mockImplementation(async (input: { conversation: { id: string }; body: string; senderName: string }) => {
        const m = await prisma.message.create({
          data: { conversationId: input.conversation.id, direction: "outbound", authorType: "host", senderName: input.senderName, body: input.body },
        });
        return { status: "sent", message: m };
      });
      composeMock.mockResolvedValueOnce(OK_DRAFT);
      await deliver([text(DIG_A, "wamid.a1", "var, dolapta", "wamid.Q1")]);
      const v = (await question(q.questionId)).version;
      await deliver([button(DIG_A, "wamid.b1", hostQuestionButtonId(q.questionId, v, "send"))]);
      const done = await question(q.questionId);
      expect(done.status).toBe("done");

      const items = await listConversationItems(prisma, { organizationId: h.orgId, conversationId: q.conversationId });
      const turnItem = items.find((i) => i.messageId === row.turnMessageId)!;
      const otherItem = items.find((i) => i.messageId === earlier.id)!;
      expect(turnItem.status).toBe("answered");
      // Cevap mesajına bağlı (kalıcı kuyruk kesin hatada `reopenItemsAnsweredBy` ile geri açabilsin).
      expect((await prisma.conversationItem.findUniqueOrThrow({ where: { id: turnItem.id } })).answeredByMessageId).toBe(done.resultMessageId);
      expect(otherItem.effective).toBe("pending_host");
      // Karşı yön: anahtar kapalıyken (eski davranış) aynı mesaj öteki öğeyi "ev sahibi yazdı" ile kapatır — dışlamayı yapan anahtarlı sorgu.
      vi.stubEnv("HOST_QUESTIONS_ENABLED", "");
      const legacy = await listConversationItems(prisma, { organizationId: h.orgId, conversationId: q.conversationId });
      expect(legacy.find((i) => i.messageId === earlier.id)!.effective).toBe("host_replied");
    });

    it("🚨 [Gönder] gönderimden ÖNCE veritabanı hatasıyla düşerse kilit bırakılır — yeniden teslimde aynı düğme gönderir (misafire tek mesaj)", async () => {
      const h = await seedHost(DIG_A, "+90 532 111 22 33");
      const q = await previewed(h);
      sendMock.mockResolvedValue({ status: "sent", message: { id: "msg-1" } });
      const id = hostQuestionButtonId(q.questionId, q.version, "send");
      bindingReads = 0;
      throwBindingReadAt = 2; // 1: girişteki denetim · 2: gönderim öncesi denetim → veritabanı hatası
      await expect(deliver([button(DIG_A, "wamid.b1", id)])).rejects.toThrow();
      expect(sendMock).not.toHaveBeenCalled();
      expect(await question(q.questionId)).toMatchObject({ status: "awaiting_confirm", version: q.version });
      throwBindingReadAt = 0;
      await deliver([button(DIG_A, "wamid.b1", id)]);
      expect(sendMock).toHaveBeenCalledTimes(1);
      expect((await question(q.questionId)).status).toBe("done");
      expect(lastText()).toBe(HOST_TEXTS.sent);
    });

    it("gönderim sürerken aynı düğmeye ikinci dokunuş: sessiz (ne ikinci mesaj ne 'geçersiz önizleme')", async () => {
      const h = await seedHost(DIG_A, "+90 532 111 22 33");
      const q = await previewed(h);
      await prisma.hostQuestion.update({ where: { id: q.questionId }, data: { status: "sending", version: q.version + 1 } });
      const before = tr.out.length;
      await deliver([button(DIG_A, "wamid.b9", hostQuestionButtonId(q.questionId, q.version, "send"))]);
      expect(sendMock).not.toHaveBeenCalled();
      expect(tr.out).toHaveLength(before);
    });

    it("taslak kurulurken bağlantı kapandıysa (DUR / rol / şifre) o numaraya önizleme GİTMEZ, soru açık", async () => {
      const h = await seedHost(DIG_A, "+90 532 111 22 33");
      const q = await seedQuestion(h, "wamid.Q1");
      composeMock.mockResolvedValueOnce(OK_DRAFT);
      bindingReads = 0;
      failBindingReadAt = 2; // 1: giriş · 2: model çağrısından sonra
      await deliver([text(DIG_A, "wamid.a1", "var, dolapta", "wamid.Q1")]);
      expect(composeMock).toHaveBeenCalledTimes(1);
      expect(tr.out).toHaveLength(0);
      expect(await question(q.questionId)).toMatchObject({ status: "sent", composeCount: 1, draftEnc: null });
    });

    it("model 'ben hallederim' derse soru ev sahibinde; model arızasında 'taslak hazırlanamadı' (soru açık)", async () => {
      const h = await seedHost(DIG_A, "+90 532 111 22 33");
      const q1 = await seedQuestion(h, "wamid.Q1");
      composeMock.mockResolvedValueOnce({ ok: false, kind: "host_takes_over", reason: "not_an_answer" });
      await deliver([text(DIG_A, "wamid.a1", "sen karışma, ben hallederim", "wamid.Q1")]);
      expect(await question(q1.questionId)).toMatchObject({ status: "host_takes_over", composeCount: 1 });
      expect(lastText()).toBe(HOST_TEXTS.takesOver);

      const q2 = await seedQuestion(h, "wamid.Q2");
      composeMock.mockResolvedValueOnce({ ok: false, kind: null, reason: "model_failed" });
      await deliver([text(DIG_A, "wamid.a2", "var", "wamid.Q2")]);
      expect(await question(q2.questionId)).toMatchObject({ status: "sent", composeCount: 1 });
      expect(lastText()).toContain(HOST_TEXTS.composeFailed);
      expect(sendMock).not.toHaveBeenCalled();
    });

    it("misafirin adı modele ve Meta'ya giden önizlemeye gitmez", async () => {
      const h = await seedHost(DIG_A, "+90 532 111 22 33");
      const q = await seedQuestion(h, "wamid.Q1");
      const row = await question(q.questionId);
      await prisma.reservation.update({ where: { id: q.reservationId }, data: { guestName: "Ayşe Yılmaz" } });
      await prisma.message.update({ where: { id: row.turnMessageId }, data: { body: "Hi, this is Ayşe. Is there a baby cot?" } });
      composeMock.mockResolvedValueOnce(OK_DRAFT);
      await deliver([text(DIG_A, "wamid.a1", "var, dolapta", "wamid.Q1")]);
      const input = composeMock.mock.calls[0]![0] as { guestMessages: string[] };
      expect(input.guestMessages[0]).toContain("Is there a baby cot?");
      expect(input.guestMessages[0]).not.toMatch(/ayşe/iu);
      expect(tr.out.find((o) => o.kind === "choices")!.text).not.toMatch(/ayşe/iu);
    });

    it("aynı WhatsApp mesajı İKİNCİ bir soruya bağlanamaz (cevap mesajı kimliği tekil) — sessizce yok sayılır", async () => {
      const h = await seedHost(DIG_A, "+90 532 111 22 33");
      const q1 = await seedQuestion(h, "wamid.Q1");
      const q2 = await seedQuestion(h, "wamid.Q2");
      composeMock.mockResolvedValueOnce(OK_DRAFT);
      await deliver([text(DIG_A, "wamid.same", "var, dolapta", "wamid.Q1")]);
      expect((await question(q1.questionId)).status).toBe("awaiting_confirm");
      const before = await question(q2.questionId);
      await prisma.systemLock.deleteMany({ where: { name: { startsWith: "host-in:" } } });
      await deliver([text(DIG_A, "wamid.same", "var, dolapta", "wamid.Q2")]);
      expect(await question(q2.questionId)).toEqual(before);
      expect(composeMock).toHaveBeenCalledTimes(1);
    });

    it("kod denetimi gönderim anında YENİDEN: taslakta ev sahibinin söylemediği sayı varsa misafire gitmez, soru açık", async () => {
      const h = await seedHost(DIG_A, "+90 532 111 22 33");
      const q = await seedQuestion(h, "wamid.Q1");
      composeMock.mockResolvedValueOnce({ ...OK_DRAFT, reply: "Yes, the baby cot costs 50 TL per night.", replyTr: "Evet." });
      await deliver([text(DIG_A, "wamid.a1", "var, dolapta", "wamid.Q1")]);
      const v = (await question(q.questionId)).version;
      await deliver([button(DIG_A, "wamid.b1", hostQuestionButtonId(q.questionId, v, "send"))]);
      expect(sendMock).not.toHaveBeenCalled();
      expect((await question(q.questionId)).status).toBe("sent");
      expect(lastText()).toContain(HOST_TEXTS.sendFailed);
    });

    it("süpürge kurtardığı soruyu, kullanıcının rolü düştüyse (ya da bağlantı kapandıysa) o numaraya BİLDİRMEZ", async () => {
      const h = await seedHost(DIG_A, "+90 532 111 22 33");
      const stuck = await seedQuestion(h, "wamid.SS", { status: "sending" });
      await prisma.$executeRawUnsafe(`UPDATE "HostQuestion" SET "updatedAt" = $1 WHERE id = $2`, new Date(Date.now() - STUCK_MS - 1_000), stuck.questionId);
      await prisma.user.update({ where: { id: h.userId }, data: { role: "staff" } });
      const r = await sweepHostQuestions(new Date(), tr.t);
      expect(r.recovered).toBe(1);
      expect((await question(stuck.questionId)).status).toBe("send_unverified");
      expect(tr.out).toHaveLength(0);
    });

    it("🚨 misafir silmesi: onay bekleyen taslak kapanır, cevap / taslak / özet silinir — eski [Gönder] misafire bir şey göndermez", async () => {
      const h = await seedHost(DIG_A, "+90 532 111 22 33");
      const q = await previewed(h);
      await eraseReservationData(h.orgId, q.reservationId);
      expect(await question(q.questionId)).toMatchObject({ status: "superseded", answerEnc: null, draftEnc: null, draftHash: null });
      await deliver([button(DIG_A, "wamid.b1", hostQuestionButtonId(q.questionId, q.version, "send"))]);
      expect(sendMock).not.toHaveBeenCalled();
      expect(lastText()).toBe(HOST_TEXTS.stalePreview);
      // Silmenin kapattığı durum listesi = canlı soru durumları (biri değişirse öteki unutulmasın).
      const src = readFileSync("src/lib/erasure.ts", "utf8");
      const m = /status: \{ in: (\[[^\]]*\])/.exec(src.slice(src.indexOf("db.hostQuestion.updateMany(")));
      expect(m && JSON.parse(m[1]!)).toEqual([...HOST_QUESTION_LIVE_STATUSES]);
    });
  });

  it("sesli / görsel mesaj → 'lütfen yazın'", async () => {
    await seedHost(DIG_A, "+90 532 111 22 33");
    await deliver([{ kind: "unsupported", from: DIG_A, providerMessageId: "wamid.v1", contextId: null, media: "audio", at: new Date() }]);
    expect(lastText()).toBe(HOST_TEXTS.unsupported);
  });

  it("süpürge: süresi dolan açık soru kapanır; takılan taslak / gönderim kurtarılır; kapanmış sorunun metni 7 gün sonra silinir, açığınki kalır; süresi geçmiş 'bekleyen soru yok' kilidi silinir", async () => {
    const h = await seedHost(DIG_A, "+90 532 111 22 33");
    const now = new Date();
    const exp = await seedQuestion(h, "wamid.E", { createdAt: new Date(now.getTime() - 25 * 3600_000) });
    const stuckA = await seedQuestion(h, "wamid.SA", { status: "answered" });
    const stuckS = await seedQuestion(h, "wamid.SS", { status: "sending" });
    const old = await seedQuestion(h, "wamid.O", { status: "done" });
    const open = await seedQuestion(h, "wamid.OP", { status: "awaiting_confirm" });
    // Taze satırlar: işlenmekte olan (yeni) taslak / gönderim ve YENİ kapanmış metinli soru süpürgeden etkilenmez (sert inceleme 10-30 A2).
    const freshA = await seedQuestion(h, "wamid.FA", { status: "answered" });
    const freshS = await seedQuestion(h, "wamid.FS", { status: "sending" });
    const recentClosed = await seedQuestion(h, "wamid.RC", { status: "done" });
    await prisma.$executeRawUnsafe(`UPDATE "HostQuestion" SET "answerEnc" = 'x', "draftEnc" = 'y', "draftHash" = 'z' WHERE id = $1`, recentClosed.questionId);
    const past = new Date(now.getTime() - STUCK_MS - 1_000);
    const ancient = new Date(now.getTime() - HOST_QUESTION_TEXT_RETENTION_MS - 1_000);
    await prisma.$executeRawUnsafe(`UPDATE "HostQuestion" SET "updatedAt" = $1 WHERE id IN ($2, $3)`, past, stuckA.questionId, stuckS.questionId);
    await prisma.$executeRawUnsafe(
      `UPDATE "HostQuestion" SET "answerEnc" = 'x', "draftEnc" = 'y', "draftHash" = 'z', "updatedAt" = $1 WHERE id IN ($2, $3)`,
      ancient,
      old.questionId,
      open.questionId,
    );
    await prisma.systemLock.createMany({
      data: [
        { name: "host-none:b1:2026-10-01", lockedUntil: new Date(now.getTime() - 1_000) },
        { name: "host-none:b1:2026-10-30", lockedUntil: new Date(now.getTime() + 3600_000) },
        { name: "baska-kilit", lockedUntil: new Date(now.getTime() - 1_000) },
      ],
    });
    const r = await sweepHostQuestions(now, tr.t);
    expect((await prisma.systemLock.findMany({ where: { name: { in: ["host-none:b1:2026-10-01", "host-none:b1:2026-10-30", "baska-kilit"] } }, orderBy: { name: "asc" } })).map((l) => l.name)).toEqual([
      "baska-kilit",
      "host-none:b1:2026-10-30",
    ]);
    expect((await question(exp.questionId)).status).toBe("expired");
    expect((await question(stuckA.questionId)).status).toBe("sent");
    expect((await question(stuckS.questionId)).status).toBe("send_unverified");
    expect(await question(old.questionId)).toMatchObject({ answerEnc: null, draftEnc: null, draftHash: null });
    expect(await question(open.questionId)).toMatchObject({ answerEnc: "x", draftEnc: "y", status: "awaiting_confirm" });
    expect((await question(freshA.questionId)).status).toBe("answered");
    expect((await question(freshS.questionId)).status).toBe("sending");
    expect(await question(recentClosed.questionId)).toMatchObject({ answerEnc: "x", draftEnc: "y", draftHash: "z" });
    // Kurtarılan iki soru ev sahibine söylenir (taslak hazırlanamadı / gönderim doğrulanamadı), panel bağlantısıyla.
    const texts = tr.out.filter((o) => o.kind === "text" && o.to === DIG_A).map((o) => o.text);
    expect(texts).toHaveLength(2);
    expect(texts.some((t) => t.startsWith(HOST_TEXTS.composeFailed) && t.endsWith(`/inbox/${stuckA.conversationId}`))).toBe(true);
    expect(texts.some((t) => t.startsWith(HOST_TEXTS.unverified) && t.endsWith(`/inbox/${stuckS.conversationId}`))).toBe(true);
    expect(r).toEqual({ expired: 1, purged: 1, recovered: 2 });
  });
});
