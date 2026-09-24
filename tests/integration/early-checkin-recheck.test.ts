import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// TEMİZLİK "BİTTİ" → BEKLEYEN ERKEN GİRİŞ İSTEĞİ YENİDEN DEĞERLENDİRİLİR (09-24; DB gerçek, cevap modeli MOCK, anlama
// katmanı + bekçi sahte fetch). Gerçek hayattaki sıra: misafir SABAH sorar (temizlik bitmedi → host'a), temizlikçi
// ÖĞLEN "bitti" der. Pinlenen:
//  · tarama yalnız HAZIRLIK yüzünden tutulmuş, otomatik kurallı, hâlâ cevapsız isteği BİR KEZ yeniden aday yapar;
//    sonraki oto-yanıt geçişi tüm hattı baştan koşar ve doğrulanmış onay gider;
//  · başka sebeple tutulan / kuralı taslak olan / işareti taze (<5 dk) ya da karardan ÖNCE olan / host'un cevapladığı /
//    başka kiracının konuşması → dokunulmaz;
//  · döngü yok: yeniden kontrol görev notuyla işaretlenir, aynı işaretten sonra ikinci kez yapılmaz.
// ---------------------------------------------------------------------------

vi.mock("@/lib/ai", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai")>()),
  suggestReply: vi.fn(),
  classifyMessage: vi.fn(),
}));
vi.mock("@/lib/messaging", async (orig) => ({
  ...(await orig<typeof import("@/lib/messaging")>()),
  sendOnChannel: vi.fn(),
}));
vi.mock("@/lib/hospitable-credentials", () => ({
  getOrgHospitableToken: vi.fn().mockResolvedValue("test-token"),
}));
vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) },
}));
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn().mockResolvedValue(undefined) };
});

import { suggestReply } from "@/lib/ai";
import { sendOnChannel } from "@/lib/messaging";
import { runDueChannelAutoReplies } from "@/lib/automation";
import { __resetUnderstandingCache } from "@/lib/ai/semantic/understand";
import { saveEarlyCheckinRule } from "@/lib/early-checkin/rules";
import { EARLY_CHECKIN_RECHECK_NOTE, heldOnlyForReadiness, recheckEarlyCheckinsAfterCleaning } from "@/lib/early-checkin/recheck";
import type { EarlyCheckinRule } from "@/lib/early-checkin/core";

const mockSuggest = vi.mocked(suggestReply);
const mockSend = vi.mocked(sendOnChannel);

// İstanbul (UTC+3): misafir 09:00'da (06:00Z) sorar; önceki misafir 11:00'de (08:00Z) çıkar; temizlik 11:30'da biter.
const ASKED = new Date("2026-10-14T06:00:00.000Z");
const MORNING_PASS = new Date("2026-10-14T06:02:00.000Z");
const CLEANED_AT = new Date("2026-10-14T08:30:00.000Z");
const AFTER_SETTLE = new Date("2026-10-14T08:36:00.000Z");
const midnight = (d: string) => new Date(`${d}T00:00:00.000Z`);
const RULE: EarlyCheckinRule = { mode: "auto", earliest: "12:00", fee: null, note: null };

const MODEL = {
  intent: "early_checkin",
  confidence: 0.9,
  reply: "Thanks! I'll check with the host whether an early check-in is possible and get back to you.",
  risk: null,
  priority: "standard" as const,
  source: "openai" as const,
  actionSuggestion: null,
  riskLevel: "none" as const,
  detectedLanguage: "en",
  riskType: null,
  usedSources: [],
  sourceAudit: { declared: 0, verified: 0 },
  missingInfo: [],
  statedCheckoutTime: null,
  stayChange: { asked: "early_checkin" as const, stance: "defers" as const },
};
const NLU = {
  language: "en",
  requests: [{ intent: "early_checkin", query_tr: "erken giriş", query_original: "early check-in" }],
  stay_change: { requested: true, kind: "early_checkin", checkin_time: "13:00", checkout_time: null },
};
const GUARD = {
  guest_requests_change: true,
  kind: "early_checkin",
  requested_checkin_time: "13:00",
  requested_checkout_time: null,
  reply_states_calendar: false,
  reply_grants_change: false,
  reply_defers_to_host: false,
  reply_refuses: false,
  reply_amounts: [],
  reply_price_terms: false,
};
function semanticFetch(guard: Record<string, unknown> = GUARD) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const name = JSON.parse(String(init?.body)).response_format?.json_schema?.name as string;
    const verdict = name === "guest_message_understanding" ? NLU : name === "stay_change_guard" ? guard : null;
    if (!verdict) throw new Error(`beklenmeyen şema: ${name}`);
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(verdict) } }] }), { status: 200 });
  });
}

async function scenario(opts: { rule?: EarlyCheckinRule | null; overlap?: boolean } = {}) {
  const org = await prisma.organization.create({
    data: {
      name: "Test Org",
      timezone: "Europe/Istanbul",
      autoReplyHospitable: true,
      autoReplyStartHour: 0,
      autoReplyEndHour: 0,
      autoReplyEnabledAt: new Date("2026-10-01T00:00:00.000Z"),
    },
  });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale", checkInTime: "15:00", checkOutTime: "11:00" } });
  const previous = await prisma.reservation.create({
    data: { propertyId: property.id, guestName: "Misafir", arrivalDate: midnight("2026-10-12"), departureDate: midnight("2026-10-14"), status: "confirmed", channel: "airbnb" },
  });
  const own = await prisma.reservation.create({
    data: { propertyId: property.id, guestName: "Misafir", arrivalDate: midnight("2026-10-14"), departureDate: midnight("2026-10-16"), status: "confirmed", channel: "airbnb" },
  });
  if (opts.overlap) {
    await prisma.reservation.create({
      data: { propertyId: property.id, guestName: "Misafir", arrivalDate: midnight("2026-10-13"), departureDate: midnight("2026-10-15"), status: "confirmed", channel: "airbnb" },
    });
  }
  const cleaning = await prisma.task.create({
    data: { propertyId: property.id, reservationId: previous.id, type: "cleaning", title: "Temizlik", status: "todo", origin: "system", dueAt: midnight("2026-10-14") },
  });
  const prep = await prisma.task.create({ data: { propertyId: property.id, reservationId: own.id, type: "checkin_prep", title: "Giriş hazırlığı", origin: "system" } });
  // "Bitti" işareti yalnız KİMLİKLİ kullanıcı kaydından sayılır (kanıt modeli) — temizlik ekibi üyesi.
  const cleaner = await prisma.user.create({
    data: { organizationId: org.id, name: "Temizlik", email: `temizlik-${org.id}@example.com`, passwordHash: "x", role: "staff" },
  });
  if (opts.rule !== null) await saveEarlyCheckinRule(org.id, property.id, opts.rule ?? RULE);
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      reservationId: own.id,
      channel: "airbnb",
      guestIdentifier: "Alex",
      status: "new",
      externalReservationId: "res-1",
      lastMessageAt: ASKED,
      messages: { create: [{ direction: "inbound", senderName: "Alex", body: "Hi! Could we check in at 13:00 today?", createdAt: ASKED }] },
    },
    select: { id: true },
  });
  return { orgId: org.id, propertyId: property.id, conversationId: conversation.id, cleaningTaskId: cleaning.id, prepTaskId: prep.id, cleanerId: cleaner.id };
}

async function markCleaned(s: { cleaningTaskId: string; cleanerId: string }, at: Date) {
  await prisma.task.update({ where: { id: s.cleaningTaskId }, data: { status: "done" } });
  await prisma.taskUpdate.create({ data: { taskId: s.cleaningTaskId, userId: s.cleanerId, status: "done", createdAt: at } });
}

describe("temizlik bitti → bekleyen erken giriş yeniden değerlendirilir", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    __resetUnderstandingCache();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("KB_RETRIEVAL_MODE", "legacy");
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubEnv("AI_STAY_GUARD_ENABLED", "1");
    vi.stubGlobal("fetch", semanticFetch());
    mockSend.mockResolvedValue({ ok: true, externalId: "ext-1" } as never);
    mockSuggest.mockResolvedValue(MODEL);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function morningHold(opts?: Parameters<typeof scenario>[0]) {
    vi.setSystemTime(MORNING_PASS);
    const s = await scenario(opts);
    await runDueChannelAutoReplies(s.orgId);
    expect(mockSend).not.toHaveBeenCalled();
    const c = await prisma.conversation.findUniqueOrThrow({ where: { id: s.conversationId } });
    expect(c.autoReplyAttemptedAt).toEqual(ASKED);
    // Karar kaydının zamanı veritabanı saatinden gelir; sahte saatle aynı eksene çekilir.
    const held = await prisma.riskEvent.updateMany({ where: { conversationId: s.conversationId, finalDecision: "human_review" }, data: { occurredAt: MORNING_PASS } });
    expect(held.count).toBe(1);
    return s;
  }

  it("🚨 sabah tutulan istek, temizlik bitip oturunca BİR KEZ yeniden aday olur ve doğrulanmış onay gider", async () => {
    const s = await morningHold();
    await markCleaned(s, CLEANED_AT);
    vi.setSystemTime(AFTER_SETTLE);
    expect(await recheckEarlyCheckinsAfterCleaning(s.orgId, AFTER_SETTLE)).toBe(1);
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: s.conversationId } })).autoReplyAttemptedAt).toBeNull();
    const note = await prisma.taskUpdate.findFirstOrThrow({ where: { taskId: s.prepTaskId } });
    expect(note.note).toBe(EARLY_CHECKIN_RECHECK_NOTE);
    // İkinci tarama aynı işaretten sonra HİÇBİR ŞEY yapmaz (döngü koruması).
    expect(await recheckEarlyCheckinsAfterCleaning(s.orgId, AFTER_SETTLE)).toBe(0);
    await runDueChannelAutoReplies(s.orgId);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(String(mockSend.mock.calls[0][1])).toContain("you can check in today (14 October) from 13:00");
  });

  it("🚨 yeniden koşu yine tutulursa (ör. bekçi düştü) tarama TEKRAR açmaz — sonsuz model çağrısı yok", async () => {
    const s = await morningHold();
    await markCleaned(s, CLEANED_AT);
    vi.setSystemTime(AFTER_SETTLE);
    expect(await recheckEarlyCheckinsAfterCleaning(s.orgId, AFTER_SETTLE)).toBe(1);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("upstream down", { status: 503 })));
    await runDueChannelAutoReplies(s.orgId);
    expect(mockSend).not.toHaveBeenCalled();
    const calls = mockSuggest.mock.calls.length;
    expect(await recheckEarlyCheckinsAfterCleaning(s.orgId, new Date(AFTER_SETTLE.getTime() + 10 * 60_000))).toBe(0);
    await runDueChannelAutoReplies(s.orgId);
    expect(mockSuggest.mock.calls.length).toBe(calls);
  });

  it("🚨 yeniden koşuda YALNIZ doğrulanmış onay gidebilir: onay çıkmazsa modelin GECİKMİŞ ertelemesi gitmez (inceleme 09-24, P3)", async () => {
    const s = await morningHold();
    await markCleaned(s, CLEANED_AT);
    vi.setSystemTime(AFTER_SETTLE);
    expect(await recheckEarlyCheckinsAfterCleaning(s.orgId, AFTER_SETTLE)).toBe(1);
    // Yeniden koşuda karar otomatik DEĞİL (host kuralı bu arada taslağa çekildi) ve iki model ertelemeyi doğruluyor —
    // yeni bir mesajda bu erteleme giderdi; sabah tutulmuş mesaja saatler sonra "ev sahibine soracağım" gitmemeli.
    await saveEarlyCheckinRule(s.orgId, s.propertyId, { ...RULE, mode: "draft" });
    vi.stubGlobal("fetch", semanticFetch({ ...GUARD, reply_defers_to_host: true }));
    await runDueChannelAutoReplies(s.orgId);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("KONTROL (aşırı-uygulama): yeniden koşu OLMAYAN mesajda iki modelin doğruladığı erteleme bugünkü gibi gider", async () => {
    vi.setSystemTime(MORNING_PASS);
    const s = await scenario({ rule: { ...RULE, mode: "draft" } });
    vi.stubGlobal("fetch", semanticFetch({ ...GUARD, reply_defers_to_host: true }));
    await runDueChannelAutoReplies(s.orgId);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(String(mockSend.mock.calls[0][1])).toContain("I'll check with the host");
  });

  it("KONTROL: aynı mesaj daha önce BAŞKA sebeple tutulduysa (ör. model yanıt vermedi) yeniden koşu sayılmaz — normal akış", async () => {
    vi.setSystemTime(MORNING_PASS);
    const s = await scenario({ rule: { ...RULE, mode: "draft" } });
    const trigger = await prisma.message.findFirstOrThrow({ where: { conversationId: s.conversationId, direction: "inbound" } });
    // Model yolu çökmüştü: karar kaydı var ama erken giriş akışı hiç koşmamış (kanıtta `ec` yok).
    await prisma.riskEvent.create({
      data: {
        organizationId: s.orgId,
        conversationId: s.conversationId,
        surface: "auto_reply",
        triggerId: trigger.id,
        finalDecision: "human_review",
        reason: "low_confidence_or_risky",
        kbEvidenceJson: JSON.stringify({ retrieved: [], used: [] }),
      },
    });
    vi.stubGlobal("fetch", semanticFetch({ ...GUARD, reply_defers_to_host: true }));
    await runDueChannelAutoReplies(s.orgId);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("dokunulmayanlar: işaret taze (<5 dk) · kural taslak · başka sebeple tutulmuş · host cevapladı · işaret yok", async () => {
    // işaret taze
    let s = await morningHold();
    await markCleaned(s, CLEANED_AT);
    expect(await recheckEarlyCheckinsAfterCleaning(s.orgId, new Date(CLEANED_AT.getTime() + 2 * 60_000))).toBe(0);
    // kural taslak (tutuş kural kapalı değil ama otomatik değil → tarama yalnız otomatik kurallı mülkte)
    await resetDb();
    s = await morningHold({ rule: { ...RULE, mode: "draft" } });
    await markCleaned(s, CLEANED_AT);
    expect(await recheckEarlyCheckinsAfterCleaning(s.orgId, AFTER_SETTLE)).toBe(0);
    // başka sebep: aynı gün çakışan rezervasyon (hazırlık dışı bir kontrol de düştü)
    await resetDb();
    s = await morningHold({ overlap: true });
    await markCleaned(s, CLEANED_AT);
    expect(await recheckEarlyCheckinsAfterCleaning(s.orgId, AFTER_SETTLE)).toBe(0);
    // host cevapladı
    await resetDb();
    s = await morningHold();
    await markCleaned(s, CLEANED_AT);
    await prisma.conversation.update({ where: { id: s.conversationId }, data: { status: "answered" } });
    expect(await recheckEarlyCheckinsAfterCleaning(s.orgId, AFTER_SETTLE)).toBe(0);
    // işaret yok
    await resetDb();
    s = await morningHold();
    expect(await recheckEarlyCheckinsAfterCleaning(s.orgId, AFTER_SETTLE)).toBe(0);
    // karar işaret OTURDUKTAN sonra verilmiş (o karar hazırlığı zaten görmüştü)
    await resetDb();
    s = await morningHold();
    await markCleaned(s, CLEANED_AT);
    await prisma.riskEvent.updateMany({ where: { conversationId: s.conversationId }, data: { occurredAt: new Date(CLEANED_AT.getTime() + 6 * 60_000) } });
    expect(await recheckEarlyCheckinsAfterCleaning(s.orgId, new Date(CLEANED_AT.getTime() + 7 * 60_000))).toBe(0);
    expect(await prisma.taskUpdate.count({ where: { note: EARLY_CHECKIN_RECHECK_NOTE } })).toBe(0);
  });

  it("karar işaretin 5 dakikalık oturma penceresinde verildiyse (o an 'hazır değil') yeniden değerlendirilir", async () => {
    const s = await morningHold();
    await markCleaned(s, CLEANED_AT);
    await prisma.riskEvent.updateMany({ where: { conversationId: s.conversationId }, data: { occurredAt: new Date(CLEANED_AT.getTime() + 60_000) } });
    expect(await recheckEarlyCheckinsAfterCleaning(s.orgId, AFTER_SETTLE)).toBe(1);
  });

  it("🚨 kiracı yalıtımı: başka org'un taraması bu konuşmaya dokunmaz", async () => {
    const s = await morningHold();
    await markCleaned(s, CLEANED_AT);
    const other = await prisma.organization.create({ data: { name: "Başka" } });
    expect(await recheckEarlyCheckinsAfterCleaning(other.id, AFTER_SETTLE)).toBe(0);
    // Derinlemesine savunma: başka org'un kural satırı BU org'un mülkünü gösterse bile (rota bunu engeller) dokunulmaz.
    const victim = await prisma.conversation.findUniqueOrThrow({ where: { id: s.conversationId }, select: { propertyId: true } });
    await prisma.automationRule.create({
      data: {
        organizationId: other.id,
        name: "Erken giriş kuralı",
        triggerType: "early_checkin_request",
        conditionJson: JSON.stringify({ propertyId: victim.propertyId }),
        actionJson: JSON.stringify(RULE),
        isEnabled: true,
      },
    });
    expect(await recheckEarlyCheckinsAfterCleaning(other.id, AFTER_SETTLE)).toBe(0);
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: s.conversationId } })).autoReplyAttemptedAt).toEqual(ASKED);
    // Anti-vakum: kendi org'u aynı anda açar.
    expect(await recheckEarlyCheckinsAfterCleaning(s.orgId, AFTER_SETTLE)).toBe(1);
  });
});

describe("heldOnlyForReadiness (saf)", () => {
  const ev = (ec: unknown) => JSON.stringify({ retrieved: [], used: [], ec });
  it("yalnız hazırlık kodlarıyla tutulmuş, otomatik gitmemiş karar", () => {
    // Kanıt modeli: bekleyen (`pending`) karar; önceki misafirin beklenen çıkışı da temizlik kanıtıyla değişebilir.
    expect(heldOnlyForReadiness(ev({ s: "pending", f: ["not_ready"], a: "0" }))).toBe(true);
    expect(heldOnlyForReadiness(ev({ s: "pending", f: ["previous_still_in", "not_ready"], a: "0" }))).toBe(true);
    // Çıkış saati bilinmiyorsa hazırlık hiç ölçülemez → yeniden değerlendirme boşa model çağırır (inceleme 09-24).
    expect(heldOnlyForReadiness(ev({ s: "pending", f: ["previous_checkout_unknown"], a: "0" }))).toBe(false);
    // Eski kayıtlar (`needs_host`) yalnız hazırlık kodlarıyla; beklenen çıkış (rızasız) temizlikle aşılamaz.
    expect(heldOnlyForReadiness(ev({ s: "needs_host", f: ["previous_still_in", "not_ready"], a: "0" }))).toBe(false);
    // Gelecek varış günü ayrı akış (bu tarama varış günü çalışır); başka durum adı açmaz.
    expect(heldOnlyForReadiness(ev({ s: "pending", f: ["not_arrival_day"], a: "0" }))).toBe(false);
    expect(heldOnlyForReadiness(ev({ s: "not_early", f: ["not_ready"], a: "0" }))).toBe(false);
    expect(heldOnlyForReadiness(ev({ s: "approvable", f: ["not_ready"], a: "0" }))).toBe(false);
    // Eski kayıtlar (kanıt modelinden önce) `needs_host` yazıyordu.
    expect(heldOnlyForReadiness(ev({ s: "needs_host", f: ["ready_unknown"], a: "0" }))).toBe(true);
    expect(heldOnlyForReadiness(ev({ s: "needs_host", f: ["not_ready"], a: "0" }))).toBe(true);
    expect(heldOnlyForReadiness(ev({ s: "needs_host", f: ["not_ready", "overlap"], a: "0" }))).toBe(false);
    expect(heldOnlyForReadiness(ev({ s: "approvable", f: ["single_source_time"], a: "0" }))).toBe(false);
    expect(heldOnlyForReadiness(ev({ s: "needs_host", f: [], a: "0" }))).toBe(false);
    expect(heldOnlyForReadiness(ev({ s: "needs_host", f: ["not_ready"], a: "1" }))).toBe(false);
    expect(heldOnlyForReadiness(ev(undefined))).toBe(false);
    expect(heldOnlyForReadiness("{bozuk")).toBe(false);
    expect(heldOnlyForReadiness(null)).toBe(false);
  });
});
