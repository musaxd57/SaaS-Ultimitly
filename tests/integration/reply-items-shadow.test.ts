import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty, PROPERTY_EXISTED_BEFORE } from "../helpers/db";

// ---------------------------------------------------------------------------
// "BU CEVAP HANGİ İSTEĞE?" — GÖLGE OKUMA TURU (aşama Y1; kurucu 11-18 akşam, H-1). Tur kuralları (açlık, süre, günlük sınır, geçici arıza)
// ortak koşucudadır ve `host-commitment-shadow.test.ts` ile sabitlenmiştir; bu dosya KATMANA özgü olanı sınar: hangi mesaj adaydır, modele
// hangi istekler gider, ne kaydedilir — ve hiçbir öğenin durumu değişmez.
// ---------------------------------------------------------------------------

vi.mock("@/lib/report-error", async (orig) => ({
  ...(await orig<typeof import("@/lib/report-error")>()),
  reportError: vi.fn().mockResolvedValue(undefined),
}));

import { reportError } from "@/lib/report-error";
import { REPLY_ITEMS_SHADOW_DAILY_CAP_PER_ORG, replyItemsDetail, replyItemsPromptId, sweepReplyItemsShadow } from "@/lib/ai/semantic/reply-items-shadow";
import { REPLY_ITEMS_MAX, type ReplyItemsReaderResult } from "@/lib/ai/semantic/reply-items-reader";
import { verifyReplyItemsReading, type ReplyItemRef, type ReplyItemStatement } from "@/lib/ai/semantic/reply-items-verdict";
import { hostCommitmentSeenText } from "@/lib/ai/semantic/host-commitment-reader";
import { sweepHostCommitmentShadow } from "@/lib/ai/semantic/host-commitment-shadow";
import { DEMO_ORG_ID } from "@/lib/demo-tenant/constants";

const MIN = 60_000;
const TOWELS = "Havluları getiriyoruz.";

async function world() {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const conversation = await prisma.conversation.create({ data: { propertyId, channel: "airbnb", guestIdentifier: "Ada", status: "answered" } });
  let n = 0;
  /** Misafirin açık isteği (öğe), `minutesAgo` dakika önce. */
  const item = (kind: string, minutesAgo: number, over: Record<string, unknown> = {}) =>
    prisma.conversationItem.create({
      data: {
        organizationId: orgId,
        conversationId: conversation.id,
        messageId: `g-${++n}`,
        kind,
        sources: "understanding",
        createdAt: new Date(Date.now() - minutesAgo * MIN),
        ...over,
      },
    });
  const hostMessage = (body: string, minutesAgo = 1, over: Record<string, unknown> = {}) =>
    prisma.message.create({
      data: { conversationId: conversation.id, direction: "outbound", authorType: "host", senderName: "Ev sahibi", body, createdAt: new Date(Date.now() - minutesAgo * MIN), ...over },
    });
  return { orgId, conversationId: conversation.id, item, hostMessage };
}
/** Gerçek doğrulamadan geçen "model okudu" sonucu. */
const okFor = (message: string, items: readonly ReplyItemRef[], statements: ReplyItemStatement[]): ReplyItemsReaderResult => ({
  ok: true,
  verdict: verifyReplyItemsReading(hostCommitmentSeenText({ message }), items, statements),
  model: "test-model",
  ms: 31,
});
const rows = () => prisma.semanticReading.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] });

describe("cevap ↔ istek — gölge okuma turu", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv("AI_REPLY_ITEMS_READER_ENABLED", "1");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
  });
  afterEach(() => {
    // Tur hatayı yutar ve raporlar; bu dosyada hata üreten senaryo yok → raporlanan her hata testin kendi kusurudur.
    expect(vi.mocked(reportError).mock.calls.map((c) => String(c[1]))).toEqual([]);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("🚨 anahtar KAPALI (varsayılan) ya da model anahtarı yok → model çağrılmaz, satır yazılmaz", async () => {
    const w = await world();
    await w.item("cleaning_linen", 10);
    await w.hostMessage(TOWELS);
    const reader = vi.fn();
    vi.stubEnv("AI_REPLY_ITEMS_READER_ENABLED", "");
    expect(await sweepReplyItemsShadow(new Date(), { reader })).toEqual({ read: 0, budget: 0, stoppedOnTransient: false });
    vi.stubEnv("AI_REPLY_ITEMS_READER_ENABLED", "1");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("AI_SEMANTIC_API_KEY", "");
    await sweepReplyItemsShadow(new Date(), { reader });
    expect(reader).not.toHaveBeenCalled();
    expect(await prisma.semanticReading.count()).toBe(0);
  });

  it("🚨 kurucunun örneği: klima + havlu açıkken 'Havluları getiriyoruz' → kayıt: bugünkü kural 'all', model 'some' (model_holds); alıntı METNİ yok", async () => {
    const w = await world();
    await w.item("complaint_issue", 20);
    await w.item("cleaning_linen", 19);
    const m = await w.hostMessage(TOWELS);
    const reader = vi.fn(async (input: { message: string; items: readonly ReplyItemRef[] }) =>
      okFor(input.message, input.items, [
        { ref: "i1", relation: "not_addressed", quote: "", why: "Mesaj klimadan söz etmiyor." },
        { ref: "i2", relation: "undertakes", quote: "Havluları getiriyoruz", why: "Ev sahibi havlu getirmeyi üstleniyor." },
      ]),
    );
    expect(await sweepReplyItemsShadow(new Date(), { reader })).toEqual({ read: 1, budget: 0, stoppedOnTransient: false });
    // Modele yalnız kısa kimlik + tür gider (en eski istek önce); misafir adı maskeleme için ayrıca.
    expect(reader).toHaveBeenCalledWith({ message: TOWELS, items: [{ ref: "i1", kind: "complaint_issue" }, { ref: "i2", kind: "cleaning_linen" }], names: ["Ada"] });
    const [row] = await rows();
    expect(row).toMatchObject({
      organizationId: w.orgId,
      conversationId: w.conversationId,
      messageId: m.id,
      layer: "reply_items",
      outcome: "ok",
      lexicalDecision: "all",
      modelDecision: "some",
      agreement: "model_holds",
      model: "test-model",
      promptId: replyItemsPromptId(),
      latencyMs: 31,
    });
    const detail = JSON.parse(String(row!.detailJson)) as { coverage: string; items: Array<Record<string, unknown>> };
    expect(detail.items.map((i) => [i.kind, i.relation])).toEqual([
      ["complaint_issue", "not_addressed"],
      ["cleaning_linen", "undertakes"],
    ]);
    expect(String(row!.detailJson)).not.toContain("Havluları");
    expect(TOWELS.slice(...(detail.items[1]!.span as [number, number]))).toBe("Havluları getiriyoruz");
  });

  it("🚨 açık isteği OLMAYAN mesaj aday değildir (satır yazılmaz); mesajdan SONRA açılan ve kapanmış istek sayılmaz", async () => {
    const w = await world();
    await w.item("wifi", 40, { status: "answered" }); // mesajdan ÖNCE açılmış ama yapay zekâ cevaplamış (kapalı) → aday yapmaz
    await w.hostMessage("İyi tatiller.", 30); // açık isteği yokken yazılmış
    await w.item("parking", 5); // mesajdan SONRA açıldı
    const other = await world();
    await other.item("cleaning_linen", 40, { status: "pending_host" }); // ev sahibine bırakılmış → açık iş
    const read = await other.hostMessage(TOWELS, 10);
    await other.item("parking", 5); // mesajdan SONRA açılan istek modele GİTMEZ (mesaj ona cevap olamaz)
    const reader = vi.fn(async (input: { message: string; items: readonly ReplyItemRef[] }) => okFor(input.message, input.items, []));
    expect((await sweepReplyItemsShadow(new Date(), { reader })).read).toBe(1);
    expect((await rows()).map((r) => r.messageId)).toEqual([read.id]);
    expect(reader).toHaveBeenCalledTimes(1);
    expect(reader.mock.calls[0]![0].items).toEqual([{ ref: "i1", kind: "cleaning_linen" }]);
  });

  it(`modele en çok ${REPLY_ITEMS_MAX} istek gider (en eskiler); otomasyon / yapay zekâ satırı ve gelen mesaj aday değildir`, async () => {
    const w = await world();
    await w.item("other", 60 * 50); // pencere dışındaki mesajdan da ESKİ bir açık istek: o mesajı yalnız 48 saat kuralı eler
    for (let i = 0; i < REPLY_ITEMS_MAX + 2; i++) await w.item("other", 100 - i);
    await w.hostMessage("Giriş bilgileriniz…", 3, { authorType: "automation" });
    await w.hostMessage("Havluları getireceğiz.", 2, { authorType: "ai" });
    await w.hostMessage("Havlu rica ediyoruz", 2, { direction: "inbound" });
    await w.hostMessage(TOWELS, 60 * 49); // 48 saatlik pencerenin dışında
    // Demo işletmesi (kurgusal veri) okunmaz.
    await prisma.organization.create({ data: { id: DEMO_ORG_ID, name: "Demo" } });
    const demoProp = await prisma.property.create({ data: { organizationId: DEMO_ORG_ID, createdAt: PROPERTY_EXISTED_BEFORE, name: "Demo Daire" } });
    const demoConv = await prisma.conversation.create({ data: { propertyId: demoProp.id, channel: "airbnb", guestIdentifier: "Demo", status: "answered" } });
    await prisma.conversationItem.create({ data: { organizationId: DEMO_ORG_ID, conversationId: demoConv.id, messageId: "g-demo", kind: "wifi", sources: "understanding", createdAt: new Date(Date.now() - 30 * MIN) } });
    await prisma.message.create({ data: { conversationId: demoConv.id, direction: "outbound", authorType: "host", senderName: "Demo", body: TOWELS } });
    const read = await w.hostMessage(TOWELS, 1);
    const reader = vi.fn(async (input: { message: string; items: readonly ReplyItemRef[] }) => okFor(input.message, input.items, []));
    await sweepReplyItemsShadow(new Date(), { reader });
    expect((await rows()).map((r) => r.messageId)).toEqual([read.id]);
    expect(reader.mock.calls[0]![0].items).toHaveLength(REPLY_ITEMS_MAX);
  });

  it("aday seçildikten sonra istekler kapandıysa model çağrılmaz, 'no_input' satırı yazılır (aday yeniden seçilmesin)", async () => {
    const a = await world();
    await a.item("wifi", 30);
    await a.hostMessage("Şifre kartta yazıyor.", 20);
    const b = await world();
    const bItem = await b.item("parking", 30);
    const second = await b.hostMessage("Önümüze park edebilirsiniz.", 10);
    const reader = vi.fn(async (input: { message: string; items: readonly ReplyItemRef[] }) => {
      // İlk okuma sürerken ikinci konuşmanın isteği kapanıyor.
      await prisma.conversationItem.update({ where: { id: bItem.id }, data: { status: "done" } });
      return okFor(input.message, input.items, []);
    });
    expect((await sweepReplyItemsShadow(new Date(), { reader })).read).toBe(2);
    expect(reader).toHaveBeenCalledTimes(1);
    expect(await prisma.semanticReading.findFirstOrThrow({ where: { messageId: second.id } })).toMatchObject({ outcome: "no_input", lexicalDecision: "all", modelDecision: null });
    await sweepReplyItemsShadow(new Date(), { reader });
    expect(reader).toHaveBeenCalledTimes(1);
  });

  it("günlük sınır AYNI tur içinde de sayılır: sınıra bir okuma kalmışken iki aday → biri okunur, öteki model çağrılmadan 'budget'", async () => {
    const w = await world();
    await w.item("cleaning_linen", 60);
    const first = await w.hostMessage(TOWELS, 20);
    const second = await w.hostMessage("Havluları kapıya bıraktık.", 10);
    const now = new Date();
    await prisma.semanticReading.createMany({
      data: Array.from({ length: REPLY_ITEMS_SHADOW_DAILY_CAP_PER_ORG - 1 }, (_, i) => ({
        organizationId: w.orgId,
        conversationId: w.conversationId,
        messageId: `eski-${i}`,
        layer: "reply_items",
        outcome: "ok",
        createdAt: now,
      })),
    });
    const reader = vi.fn(async (input: { message: string; items: readonly ReplyItemRef[] }) => okFor(input.message, input.items, []));
    expect(await sweepReplyItemsShadow(now, { reader })).toEqual({ read: 1, budget: 1, stoppedOnTransient: false });
    expect(reader).toHaveBeenCalledTimes(1);
    expect((await prisma.semanticReading.findFirstOrThrow({ where: { messageId: first.id } })).outcome).toBe("ok");
    expect((await prisma.semanticReading.findFirstOrThrow({ where: { messageId: second.id } })).outcome).toBe("budget");
  });

  it("🚨 HİÇBİR davranış değişmez: öğelerin durumu, konuşma ve mesajlar turdan sonra birebir aynı", async () => {
    const w = await world();
    await w.item("complaint_issue", 20);
    await w.item("cleaning_linen", 19, { status: "pending_host" });
    await w.hostMessage(TOWELS);
    const snapshot = async () => ({
      items: await prisma.conversationItem.findMany({ orderBy: { id: "asc" } }),
      conversation: await prisma.conversation.findUniqueOrThrow({ where: { id: w.conversationId } }),
      messages: await prisma.message.count(),
      tasks: await prisma.task.count(),
    });
    const before = await snapshot();
    await sweepReplyItemsShadow(new Date(), {
      reader: async (input) => okFor(input.message, input.items, [{ ref: "i2", relation: "undertakes", quote: "Havluları getiriyoruz", why: "x" }]),
    });
    expect(await prisma.semanticReading.count()).toBe(1);
    expect(await snapshot()).toEqual(before);
  });

  it("iki katman aynı mesajı AYRI AYRI okur (katman başına bir satır); birinin günlük sınırı ötekini etkilemez", async () => {
    vi.stubEnv("AI_HOST_COMMITMENT_READER_ENABLED", "1");
    const w = await world();
    await w.item("cleaning_linen", 10);
    const m = await w.hostMessage(TOWELS);
    const replyReader = async (input: { message: string; items: readonly ReplyItemRef[] }) => okFor(input.message, input.items, []);
    const commitmentReader = async () => ({ ok: false as const, error: "bad_shape", model: "test-model", ms: 1 });
    await sweepReplyItemsShadow(new Date(), { reader: replyReader });
    // İkinci mesajı ÖNCE öteki katman okur: onun satırı bu katmanın "henüz okunmamış" süzgecini kapatmamalı.
    const w2 = await world();
    await w2.item("wifi", 10);
    const m2 = await w2.hostMessage(TOWELS);
    await sweepHostCommitmentShadow(new Date(), { reader: commitmentReader });
    await sweepReplyItemsShadow(new Date(), { reader: replyReader });
    for (const id of [m.id, m2.id]) {
      expect((await rows()).filter((r) => r.messageId === id).map((r) => r.layer).sort(), id).toEqual(["host_commitment", "reply_items"]);
    }
  });

  it("`replyItemsDetail` alıntı metnini ve çağrıya özgü kimliği taşımaz", () => {
    const verdict = verifyReplyItemsReading(TOWELS, [{ ref: "i1", kind: "cleaning_linen" }], [{ ref: "i1", relation: "undertakes", quote: "Havluları getiriyoruz", why: "neden" }]);
    const detail = replyItemsDetail(verdict);
    expect(JSON.stringify(detail)).not.toContain("Havluları");
    expect(JSON.stringify(detail)).not.toContain('"ref"');
    expect(detail).toMatchObject({ coverage: "all", invented: 0, ungrounded: 0 });
  });
});
