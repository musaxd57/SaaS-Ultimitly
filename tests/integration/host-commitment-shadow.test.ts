import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty, PROPERTY_EXISTED_BEFORE } from "../helpers/db";

// ---------------------------------------------------------------------------
// EV SAHİBİNİN SÖZÜ — GÖLGE OKUMA TURU (aşama 0; kurucu 11-18 akşam: "kelime bazlı değil … anlamı model güçlerine bırak ama arkada çok hızlı
// kontroller sağlansın, doğru anlandığına dair anlama şekli ve nedeni tutulsun"). Tur ev sahibinin giden mesajını modele okutur, kodla
// doğrular, bugünkü sözcük ağının kararıyla kıyaslayıp KAYDEDER. Bu dosyanın sabitlediği: (1) hiçbir davranış değişmez, (2) anahtar kapalıyken
// sorgusuz çıkar, (3) açlık yok (okunmamış süzgeci sorguda; kalıcı hata satır yazar, geçici arıza satır yazmadan durur), (4) maliyet ve süre
// tavanı, (5) kayıtta alıntı METNİ yok.
// ---------------------------------------------------------------------------

vi.mock("@/lib/report-error", async (orig) => ({
  ...(await orig<typeof import("@/lib/report-error")>()),
  reportError: vi.fn().mockResolvedValue(undefined),
}));

import { reportError } from "@/lib/report-error";
import {
  SHADOW_DAILY_CAP_PER_ORG,
  SHADOW_MAX_PER_PASS,
  SHADOW_PASS_BUDGET_MS,
  hostCommitmentDetail,
  hostCommitmentPromptId,
  sweepHostCommitmentShadow,
} from "@/lib/ai/semantic/host-commitment-shadow";
import { hostCommitmentSeenText, type HostCommitmentReaderResult } from "@/lib/ai/semantic/host-commitment-reader";
import { verifyHostCommitmentReading, type HostCommitmentStatement } from "@/lib/ai/semantic/host-commitment-verdict";
import { SEMANTIC_DETAIL_MAX, recordSemanticReading, semanticOutcomeOf } from "@/lib/semantic-reading/store";
import { DEMO_ORG_ID } from "@/lib/demo-tenant/constants";

const HOUR = 3_600_000;
/** Kurucunun örneği: ev sahibi misafirin cümlesini aktarıyor — sözcük ağı bunu kesin söz sayıyor (ölçüldü). */
const RELAYED = 'Misafir şöyle yazdı: "Teknisyen yarın 10\'da gelecek"';
const OWN = "Randevuyu teyit ettik, teknisyenimiz yarın 10'da gelecek.";

const st = (over: Partial<HostCommitmentStatement> = {}): HostCommitmentStatement => ({
  quote: "Teknisyen yarın 10'da gelecek",
  reading: "guest_words",
  topic: "maintenance",
  day: "tomorrow",
  time: "10:00",
  why: "Ev sahibi kendi sözünü vermiyor, misafirin yazdığını aktarıyor.",
  ...over,
});
/** Gerçek doğrulamadan geçen "model okudu" sonucu. */
const okFor = (message: string, statements: HostCommitmentStatement[]): HostCommitmentReaderResult => ({
  ok: true,
  verdict: verifyHostCommitmentReading(hostCommitmentSeenText({ message }), statements),
  model: "test-model",
  ms: 42,
});

async function world() {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const conversation = await prisma.conversation.create({ data: { propertyId, channel: "airbnb", guestIdentifier: "Ada", status: "answered" } });
  const hostMessage = (body: string, over: Record<string, unknown> = {}) =>
    prisma.message.create({ data: { conversationId: conversation.id, direction: "outbound", authorType: "host", senderName: "Ev sahibi", body, ...over } });
  return { orgId, propertyId, conversationId: conversation.id, hostMessage };
}
const rows = () => prisma.semanticReading.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] });

describe("söz okuyucusu — gölge okuma turu", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv("AI_HOST_COMMITMENT_READER_ENABLED", "1");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
  });
  afterEach(() => {
    // Tur hatayı yutar ve raporlar; bu dosyada hata ÜRETEN senaryo yok → raporlanan her hata testin kendi kusurudur (sessiz yeşil olmasın).
    expect(vi.mocked(reportError).mock.calls.map((c) => String(c[1]))).toEqual([]);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("🚨 anahtar KAPALI (varsayılan) ya da model anahtarı yok → model çağrılmaz, satır yazılmaz", async () => {
    const w = await world();
    await w.hostMessage(OWN);
    const reader = vi.fn();
    vi.stubEnv("AI_HOST_COMMITMENT_READER_ENABLED", "");
    expect(await sweepHostCommitmentShadow(new Date(), { reader })).toEqual({ read: 0, budget: 0, stoppedOnTransient: false });
    vi.stubEnv("AI_HOST_COMMITMENT_READER_ENABLED", "true"); // yalnız "1" açar
    await sweepHostCommitmentShadow(new Date(), { reader });
    vi.stubEnv("AI_HOST_COMMITMENT_READER_ENABLED", "1");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("AI_SEMANTIC_API_KEY", "");
    await sweepHostCommitmentShadow(new Date(), { reader });
    expect(reader).not.toHaveBeenCalled();
    expect(await prisma.semanticReading.count()).toBe(0);
  });

  it("🚨 okuma + kıyas kaydı: sözcük ağı 'görev' derken model 'misafirin sözü' diyor → model_holds; kayıtta alıntı METNİ yok, konum + neden var", async () => {
    const w = await world();
    const m = await w.hostMessage(RELAYED);
    const reader = vi.fn(async () => okFor(RELAYED, [st()]));
    expect(await sweepHostCommitmentShadow(new Date(), { reader })).toEqual({ read: 1, budget: 0, stoppedOnTransient: false });
    // Ad maskesi üç kaynaktan (görünen ad + rezervasyonun iki adı; bu konuşmada rezervasyon yok → boş kaynak null). Ayrıntı:
    // `shadow-readers-guest-name-mask.test.ts`.
    expect(reader).toHaveBeenCalledWith({ message: RELAYED, names: ["Ada", null, null] });
    const [row] = await rows();
    expect(row).toMatchObject({
      organizationId: w.orgId,
      conversationId: w.conversationId,
      messageId: m.id,
      layer: "host_commitment",
      outcome: "ok",
      lexicalDecision: "auto", // bugünkü sözcük ağı bu mesajdan kendiliğinden görev açar
      modelDecision: "none",
      agreement: "model_holds",
      model: "test-model",
      promptId: hostCommitmentPromptId(),
      latencyMs: 42,
    });
    const detail = JSON.parse(String(row!.detailJson)) as { ungrounded: number; statements: Array<Record<string, unknown>> };
    expect(detail.ungrounded).toBe(0);
    expect(detail.statements).toHaveLength(1);
    expect(detail.statements[0]).toMatchObject({ reading: "guest_words", decision: "none", grounded: true, inQuotedSpan: true, why: st().why });
    // Alıntının kendisi kayıtta YOK; konumu modelin gördüğü metinde alıntıyı gösterir.
    expect(String(row!.detailJson)).not.toContain("Teknisyen yarın");
    const [from, to] = detail.statements[0]!.span as [number, number];
    expect(hostCommitmentSeenText({ message: RELAYED }).slice(from, to)).toBe("Teknisyen yarın 10'da gelecek");
  });

  it("üstlenme → ikisi de 'görev' (agree); uydurma alıntı karara girmez ve sayılır", async () => {
    const w = await world();
    await w.hostMessage(OWN);
    const reader = vi.fn(async () =>
      okFor(OWN, [st({ quote: "teknisyenimiz yarın 10'da gelecek", reading: "host_commits" }), st({ quote: "metinde olmayan cümle", reading: "host_commits" })]),
    );
    await sweepHostCommitmentShadow(new Date(), { reader });
    const [row] = await rows();
    expect(row).toMatchObject({ lexicalDecision: "auto", modelDecision: "auto", agreement: "agree" });
    expect((JSON.parse(String(row!.detailJson)) as { ungrounded: number }).ungrounded).toBe(1);
  });

  it("🚨 aynı mesaj bir daha okunmaz (ikinci tur model çağırmaz)", async () => {
    const w = await world();
    await w.hostMessage(OWN);
    const reader = vi.fn(async () => okFor(OWN, []));
    await sweepHostCommitmentShadow(new Date(), { reader });
    await sweepHostCommitmentShadow(new Date(), { reader });
    expect(reader).toHaveBeenCalledTimes(1);
    expect(await prisma.semanticReading.count()).toBe(1);
  });

  it("'okunmuş' süzgeci KATMANA özeldir: mesajın başka katmanda kaydı olması bu katmanda okunmasını engellemez", async () => {
    const w = await world();
    const m = await w.hostMessage(OWN);
    await recordSemanticReading(prisma, { organizationId: w.orgId, conversationId: w.conversationId, messageId: m.id, layer: "reply_items", outcome: "ok" });
    const reader = vi.fn(async () => okFor(OWN, []));
    expect((await sweepHostCommitmentShadow(new Date(), { reader })).read).toBe(1);
    expect((await rows()).map((r) => r.layer).sort()).toEqual(["host_commitment", "reply_items"]);
  });

  it("yalnız ev sahibinin KENDİ yazdığı, son 48 saatteki giden mesaj okunur (misafir mesajı, otomasyon / yapay zekâ satırı, eski mesaj, demo işletmesi okunmaz)", async () => {
    const w = await world();
    const read = await w.hostMessage(OWN);
    await prisma.message.create({ data: { conversationId: w.conversationId, direction: "inbound", authorType: "guest", senderName: "Ada", body: "Teknisyen yarın gelecek mi?" } });
    // Yön süzgeci (mutasyon g-any-direction yaşadı → eksik pin): yazar alanı "host" görünse de GELEN satır ev sahibinin sözü değildir.
    await w.hostMessage("Yarın 10'da geleceğiz.", { direction: "inbound" });
    await w.hostMessage("Giriş bilgileriniz…", { authorType: "automation" });
    await w.hostMessage("Havluları getireceğiz.", { authorType: "ai" });
    await w.hostMessage("Eski söz: yarın geleceğiz.", { createdAt: new Date(Date.now() - 49 * HOUR) });
    await w.hostMessage("Gelecekten mesaj", { createdAt: new Date(Date.now() + HOUR) });
    await prisma.organization.create({ data: { id: DEMO_ORG_ID, name: "Demo" } });
    const demoProp = await prisma.property.create({ data: { organizationId: DEMO_ORG_ID, createdAt: PROPERTY_EXISTED_BEFORE, name: "Demo Daire" } });
    const demoConv = await prisma.conversation.create({ data: { propertyId: demoProp.id, channel: "airbnb", guestIdentifier: "Demo", status: "answered" } });
    await prisma.message.create({ data: { conversationId: demoConv.id, direction: "outbound", authorType: "host", senderName: "Demo", body: OWN } });

    const reader = vi.fn(async () => okFor(OWN, []));
    expect((await sweepHostCommitmentShadow(new Date(), { reader })).read).toBe(1);
    expect((await rows()).map((r) => r.messageId)).toEqual([read.id]);
  });

  it("🚨 geçici sağlayıcı arızası: satır YAZILMAZ, tur durur (kalan aday denenmez); sonraki turda aynı mesaj yeniden okunur", async () => {
    const w = await world();
    const first = await w.hostMessage(OWN, { createdAt: new Date(Date.now() - 2 * HOUR) });
    const second = await w.hostMessage(RELAYED, { createdAt: new Date(Date.now() - HOUR) });
    const reader = vi.fn<() => Promise<HostCommitmentReaderResult>>(async () => ({ ok: false, error: "network", model: "test-model", ms: 5, transient: true }));
    expect(await sweepHostCommitmentShadow(new Date(), { reader })).toEqual({ read: 0, budget: 0, stoppedOnTransient: true });
    expect(reader).toHaveBeenCalledTimes(1); // ikinci aday denenmedi
    expect(await prisma.semanticReading.count()).toBe(0);

    reader.mockImplementation(async () => okFor(OWN, []));
    expect((await sweepHostCommitmentShadow(new Date(), { reader })).read).toBe(2);
    expect((await rows()).map((r) => r.messageId)).toEqual([first.id, second.id]);
  });

  it("🚨 kalıcı hata (bozuk cevap) satır yazar ve mesaj bir daha seçilmez — kuyruğun başı tıkanmaz; tanınmayan hata kodu kayda serbest metin girmez", async () => {
    const w = await world();
    const bad = await w.hostMessage(OWN, { createdAt: new Date(Date.now() - 2 * HOUR) });
    const next = await w.hostMessage(RELAYED, { createdAt: new Date(Date.now() - HOUR) });
    const reader = vi
      .fn<() => Promise<HostCommitmentReaderResult>>()
      .mockResolvedValueOnce({ ok: false, error: "bad_shape", model: "test-model", ms: 7 })
      .mockResolvedValueOnce({ ok: false, error: "Ada'nın telefonu 0532…", model: null, ms: 3 });
    expect((await sweepHostCommitmentShadow(new Date(), { reader })).read).toBe(2);
    const all = await rows();
    expect(all.map((r) => [r.messageId, r.outcome, r.modelDecision, r.agreement])).toEqual([
      [bad.id, "bad_shape", null, null],
      [next.id, "exception", null, null],
    ]);
    expect(all[0]!.lexicalDecision).toBe("auto"); // sözcük ağının kararı hata olsa da yazılır
    await sweepHostCommitmentShadow(new Date(), { reader });
    expect(reader).toHaveBeenCalledTimes(2);
  });

  it("🚨 günlük sınır dolan işletmede model ÇAĞRILMAZ, mesaj 'budget' satırı alır (sözcük ağının kararıyla); başka işletme okunmaya devam eder", async () => {
    const w = await world();
    const capped = await w.hostMessage(OWN, { createdAt: new Date(Date.now() - 2 * HOUR) });
    const other = await world();
    const free = await other.hostMessage(OWN, { createdAt: new Date(Date.now() - HOUR) });
    const now = new Date();
    await prisma.semanticReading.createMany({
      data: Array.from({ length: SHADOW_DAILY_CAP_PER_ORG }, (_, i) => ({
        organizationId: w.orgId,
        conversationId: w.conversationId,
        messageId: `eski-${i}`,
        layer: "host_commitment",
        outcome: "ok",
        createdAt: now,
      })),
    });
    const reader = vi.fn(async () => okFor(OWN, []));
    expect(await sweepHostCommitmentShadow(now, { reader })).toEqual({ read: 1, budget: 1, stoppedOnTransient: false });
    expect(reader).toHaveBeenCalledTimes(1);
    expect(await prisma.semanticReading.findFirstOrThrow({ where: { messageId: capped.id } })).toMatchObject({ outcome: "budget", lexicalDecision: "auto", modelDecision: null });
    expect((await prisma.semanticReading.findFirstOrThrow({ where: { messageId: free.id } })).outcome).toBe("ok");
  });

  it("günlük sınır MODEL ÇAĞRILAN okumaları sayar: 'budget' satırları ve dünkü okumalar sayılmaz", async () => {
    const w = await world();
    await w.hostMessage(OWN);
    const now = new Date();
    const yesterday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 1_000);
    await prisma.semanticReading.createMany({
      data: [
        ...Array.from({ length: SHADOW_DAILY_CAP_PER_ORG }, (_, i) => ({ organizationId: w.orgId, conversationId: w.conversationId, messageId: `dun-${i}`, layer: "host_commitment", outcome: "ok", createdAt: yesterday })),
        ...Array.from({ length: SHADOW_DAILY_CAP_PER_ORG }, (_, i) => ({ organizationId: w.orgId, conversationId: w.conversationId, messageId: `butce-${i}`, layer: "host_commitment", outcome: "budget", createdAt: now })),
        // Başka katmanın bugünkü okumaları bu katmanın sınırından yemez.
        ...Array.from({ length: SHADOW_DAILY_CAP_PER_ORG }, (_, i) => ({ organizationId: w.orgId, conversationId: w.conversationId, messageId: `baska-${i}`, layer: "reply_items", outcome: "ok", createdAt: now })),
      ],
    });
    const reader = vi.fn(async () => okFor(OWN, []));
    expect((await sweepHostCommitmentShadow(now, { reader })).read).toBe(1);
    expect(reader).toHaveBeenCalledTimes(1);
  });

  it(`🚨 açlık yok: tur başına en çok ${SHADOW_MAX_PER_PASS} okuma, ESKİDEN yeniye; kalanlar sonraki turda`, async () => {
    const w = await world();
    const ids: string[] = [];
    for (let i = 0; i < SHADOW_MAX_PER_PASS + 2; i++) {
      ids.push((await w.hostMessage(`${OWN} (${i})`, { createdAt: new Date(Date.now() - (20 - i) * 60_000) })).id);
    }
    const reader = vi.fn(async () => okFor(OWN, []));
    expect((await sweepHostCommitmentShadow(new Date(), { reader })).read).toBe(SHADOW_MAX_PER_PASS);
    expect((await rows()).map((r) => r.messageId).sort()).toEqual(ids.slice(0, SHADOW_MAX_PER_PASS).sort());
    expect((await sweepHostCommitmentShadow(new Date(), { reader })).read).toBe(2);
    expect(await prisma.semanticReading.count()).toBe(SHADOW_MAX_PER_PASS + 2);
  });

  it("süre tavanı: tavan dolunca yeni model çağrısı başlatılmaz (kalan aday sonraki tura)", async () => {
    const w = await world();
    await w.hostMessage(OWN, { createdAt: new Date(Date.now() - 2 * HOUR) });
    await w.hostMessage(RELAYED, { createdAt: new Date(Date.now() - HOUR) });
    const reader = vi.fn(async () => okFor(OWN, []));
    let calls = 0;
    const elapsedMs = () => (calls++ === 0 ? SHADOW_PASS_BUDGET_MS : SHADOW_PASS_BUDGET_MS + 1); // ilk çağrıda tavanda (dahil), sonra aşıldı
    expect((await sweepHostCommitmentShadow(new Date(), { reader, elapsedMs })).read).toBe(1);
    expect(reader).toHaveBeenCalledTimes(1);
  });

  it("🚨 HİÇBİR davranış değişmez: tur söz / görev / mesaj / konuşma durumuna dokunmaz", async () => {
    const w = await world();
    await w.hostMessage(OWN);
    const before = {
      commitments: await prisma.guestCommitment.count(),
      tasks: await prisma.task.count(),
      messages: await prisma.message.count(),
      conversation: await prisma.conversation.findUniqueOrThrow({ where: { id: w.conversationId } }),
    };
    await sweepHostCommitmentShadow(new Date(), { reader: vi.fn(async () => okFor(OWN, [st({ quote: "teknisyenimiz yarın 10'da gelecek", reading: "host_commits" })])) });
    expect(await prisma.semanticReading.count()).toBe(1);
    expect({
      commitments: await prisma.guestCommitment.count(),
      tasks: await prisma.task.count(),
      messages: await prisma.message.count(),
      conversation: await prisma.conversation.findUniqueOrThrow({ where: { id: w.conversationId } }),
    }).toEqual(before);
  });

  it("konuşma okuma sırasında silindiyse satır yazılamaz — tur fırlatmaz, sıradaki mesaja geçer", async () => {
    const w = await world();
    await w.hostMessage(OWN, { createdAt: new Date(Date.now() - 2 * HOUR) });
    const other = await world();
    const kept = await other.hostMessage(OWN, { createdAt: new Date(Date.now() - HOUR) });
    let first = true;
    const reader = vi.fn(async () => {
      if (first) {
        first = false;
        await prisma.conversation.delete({ where: { id: w.conversationId } });
      }
      return okFor(OWN, []);
    });
    expect((await sweepHostCommitmentShadow(new Date(), { reader })).read).toBe(1);
    expect((await rows()).map((r) => r.messageId)).toEqual([kept.id]);
    expect(vi.mocked(reportError)).not.toHaveBeenCalled();
  });

  it("varsayılan okuyucuyla uçtan uca: model cevabı (sahte ağ) doğrulanıp kaydedilir", async () => {
    const w = await world();
    await w.hostMessage(RELAYED);
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ statements: [st()] }) } }] }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect((await sweepHostCommitmentShadow(new Date())).read).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await rows())[0]).toMatchObject({ outcome: "ok", modelDecision: "none", agreement: "model_holds" });
  });
});

describe("anlam okuması kaydı — tek yazıcı", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("mesaj + katman başına tek satır: ikinci yazım `false` döner, ilk kayıt değişmez", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const c = await prisma.conversation.create({ data: { propertyId, channel: "airbnb", guestIdentifier: "Ada", status: "new" } });
    const base = { organizationId: orgId, conversationId: c.id, messageId: "m-1", layer: "host_commitment" as const };
    expect(await recordSemanticReading(prisma, { ...base, outcome: "ok", modelDecision: "auto" })).toBe(true);
    expect(await recordSemanticReading(prisma, { ...base, outcome: "ok", modelDecision: "none" })).toBe(false);
    expect((await prisma.semanticReading.findFirstOrThrow()).modelDecision).toBe("auto");
    expect(await recordSemanticReading(prisma, { ...base, layer: "reply_items", outcome: "ok" })).toBe(true);
  });

  it("tavanı aşan ayrıntı YAZILMAZ (kırpılmış JSON okunamaz), satırın geri kalanı yazılır; süre tam sayıya yuvarlanır, negatif / sonsuz süre boş", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const c = await prisma.conversation.create({ data: { propertyId, channel: "airbnb", guestIdentifier: "Ada", status: "new" } });
    const base = { organizationId: orgId, conversationId: c.id, layer: "host_commitment" as const, outcome: "ok" as const };
    await recordSemanticReading(prisma, { ...base, messageId: "buyuk", detail: { x: "a".repeat(SEMANTIC_DETAIL_MAX) }, latencyMs: 12.6 });
    await recordSemanticReading(prisma, { ...base, messageId: "kucuk", detail: { x: 1 }, latencyMs: -5 });
    await recordSemanticReading(prisma, { ...base, messageId: "sonsuz", latencyMs: Number.POSITIVE_INFINITY });
    const by = new Map((await prisma.semanticReading.findMany()).map((r) => [r.messageId, r]));
    expect(by.get("buyuk")).toMatchObject({ detailJson: null, latencyMs: 13 });
    expect(by.get("kucuk")).toMatchObject({ detailJson: '{"x":1}', latencyMs: 0 });
    expect(by.get("sonsuz")).toMatchObject({ detailJson: null, latencyMs: null });
  });

  it("sonuç kodu kapalı kümedir: bilinen kod aynen, bilinmeyen `exception`", () => {
    expect(semanticOutcomeOf("timeout")).toBe("timeout");
    expect(semanticOutcomeOf("bad_shape")).toBe("bad_shape");
    expect(semanticOutcomeOf("Ada'nın mesajı")).toBe("exception");
  });

  it("`hostCommitmentDetail` alıntı metnini taşımaz", () => {
    const verdict = verifyHostCommitmentReading(OWN, [st({ quote: "teknisyenimiz yarın 10'da gelecek", reading: "host_commits" })]);
    const detail = hostCommitmentDetail(verdict);
    expect(JSON.stringify(detail)).not.toContain("teknisyenimiz");
    expect(detail.statements).toHaveLength(1);
  });
});
