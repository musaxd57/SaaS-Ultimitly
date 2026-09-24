import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// ERKEN GİRİŞ — KURUCUNUN 20 SENARYOLUK MATRİSİ (09-24, kanıt modeli dilim 1). GERÇEK cevap ayrıştırıcısı + GERÇEK
// kapı + GERÇEK DB; yalnız dış sınırlar sahte: OpenAI HTTP'si (cevap modeli `json_object`, anlama katmanı + bekçi
// şema adına göre), kanal göndericisi, Hospitable token'ı, e-posta. `@/lib/ai` MOCK'LANMAZ (ayrılan misafirin saat
// beyanının deterministik doğrulaması da koşsun — senaryo 3/4).
//
// Değişmezler: bilinmeyen asla "hayır" değildir (otomatik RED yok) · otomatik onay yalnız güçlü kanıtla · birleşim
// (bir katmanın "istek yok"u başkasının isteğini silemez) · READY takvim çakışmasını aşamaz · eski READY yeni devirde
// sayılmaz · temizlikçi para ve başka mülk göremez/değiştiremez. Henüz uygulanmamış bacaklar `it.todo` olarak AÇIKÇA
// durur (sahte yeşil yok) — dilimleri `docs/ERKEN-GIRIS-KANIT-MODELI-2026-09-24.md`.
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
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

import { sendOnChannel } from "@/lib/messaging";
import { applyChannelAutoReply, runDueChannelAutoReplies } from "@/lib/automation";
import { __resetUnderstandingCache } from "@/lib/ai/semantic/understand";
import { loadEarlyCheckinFacts } from "@/lib/early-checkin/load";
import { decideEarlyCheckin, type EarlyCheckinRule } from "@/lib/early-checkin/core";
import { saveEarlyCheckinRule } from "@/lib/early-checkin/rules";
import { recheckEarlyCheckinsAfterCleaning } from "@/lib/early-checkin/recheck";
import { POST as aiSuggest } from "@/app/api/conversations/[id]/ai-suggest/route";
import { PUT as putRule } from "@/app/api/properties/[id]/early-checkin-rule/route";
import { PUT as putNightlyRate } from "@/app/api/properties/[id]/nightly-rate/route";
import { GET as reportDaily } from "@/app/api/reports/daily/route";
import { GET as reportMonthly } from "@/app/api/reports/monthly/route";
import { GET as reportOps } from "@/app/api/reports/ops/route";
import { POST as planPreview } from "@/app/api/billing/plan-preview/route";
import { POST as planChange } from "@/app/api/billing/plan-change/route";
import { POST as billingPortal } from "@/app/api/billing/portal/route";
import { PATCH as patchTask } from "@/app/api/tasks/[id]/route";

const mockSend = vi.mocked(sendOnChannel);

// İstanbul (UTC+3, yaz saati yok). Devir günü 14 Ekim 2026 (Çarşamba). Mülk: giriş 15:00, çıkış 11:00.
const Z = (iso: string) => new Date(`${iso}Z`);
const midnight = (d: string) => Z(`${d}T00:00:00.000`);
const RULE: EarlyCheckinRule = { mode: "auto", earliest: "09:00", fee: { amount: 30, currency: "EUR" }, note: null };

let seq = 0;
async function org() {
  const o = await prisma.organization.create({
    data: {
      name: "Test Org",
      timezone: "Europe/Istanbul",
      autoReplyHospitable: true,
      autoReplyStartHour: 0,
      autoReplyEndHour: 0,
      autoReplyEnabledAt: Z("2026-10-01T00:00:00.000"),
    },
  });
  const p = await prisma.property.create({ data: { organizationId: o.id, name: "Lale", checkInTime: "15:00", checkOutTime: "11:00" } });
  const cleaner = await prisma.user.create({
    data: { organizationId: o.id, name: "Temizlik", email: `temizlik-${++seq}@example.com`, passwordHash: "x", role: "staff" },
  });
  return { orgId: o.id, propertyId: p.id, cleanerId: cleaner.id };
}

async function reservation(propertyId: string, arrival: string, departure: string, extra: Record<string, unknown> = {}) {
  return prisma.reservation.create({
    data: { propertyId, guestName: "Misafir", arrivalDate: midnight(arrival), departureDate: midnight(departure), status: "confirmed", channel: "airbnb", ...extra },
  });
}

/** Temizlik görevi + kimlikli durum kayıtları (sunucu zamanı `createdAt`). */
async function cleaning(
  t: { propertyId: string; cleanerId: string },
  reservationId: string | null,
  dueDay: string,
  updates: [status: string, at: string][],
  status = updates.length ? updates[updates.length - 1][0] : "todo",
) {
  const task = await prisma.task.create({
    data: { propertyId: t.propertyId, reservationId, type: "cleaning", title: "Temizlik", status, origin: "system", dueAt: midnight(dueDay), assignedToId: t.cleanerId },
  });
  for (const [s, at] of updates) await prisma.taskUpdate.create({ data: { taskId: task.id, userId: t.cleanerId, status: s, createdAt: Z(at) } });
  return task;
}

/** Aynı gün devir: A 12→14 (bugün ayrılıyor), B 14→16 (bizim misafir bugün geliyor). */
async function turnover() {
  const o = await org();
  const departing = await reservation(o.propertyId, "2026-10-12", "2026-10-14");
  const own = await reservation(o.propertyId, "2026-10-14", "2026-10-16");
  await prisma.task.create({ data: { propertyId: o.propertyId, reservationId: own.id, type: "checkin_prep", title: "Giriş hazırlığı", origin: "system" } });
  return { ...o, departing, own };
}

/** Aynı gün devir YOK: son çıkış 12 Ekim (temizlik 12'sinde bitti), dün gece taze takvim kaynağıyla boş. */
async function vacantNight(now: Date) {
  const o = await org();
  const last = await reservation(o.propertyId, "2026-10-09", "2026-10-12");
  const own = await reservation(o.propertyId, "2026-10-14", "2026-10-16");
  await cleaning(o, last.id, "2026-10-12", [
    ["in_progress", "2026-10-12T09:00:00.000"],
    ["done", "2026-10-12T10:30:00.000"],
  ]);
  await prisma.calendarSource.create({
    data: { propertyId: o.propertyId, label: "Airbnb", url: "https://x.example/f.ics", lastStatus: "ok", lastSyncedAt: new Date(now.getTime() - 30 * 60_000) },
  });
  await prisma.task.create({ data: { propertyId: o.propertyId, reservationId: own.id, type: "checkin_prep", title: "Giriş hazırlığı", origin: "system" } });
  return { ...o, own };
}

// ─── sahte OpenAI ───────────────────────────────────────────────────────────

const DEFER = "Thanks! I'll check with the host whether an early check-in is possible and get back to you.";
const reply = (over: Record<string, unknown> = {}) => ({
  intent: "early_checkin",
  confidence: 0.9,
  reply: DEFER,
  risk: null,
  priority: "standard",
  actionSuggestion: null,
  riskLevel: "none",
  detectedLanguage: "en",
  riskType: null,
  usedSources: [],
  missingInfo: [],
  statedCheckoutTime: null,
  stayChangeAsked: "early_checkin",
  replyStance: "defers",
  ...over,
});
const nlu = (time: string | null, extra: string[] = [], over: Record<string, unknown> = {}) => ({
  language: "en",
  requests: [
    { intent: "early_checkin", query_tr: "erken giriş", query_original: "early check-in" },
    ...extra.map((intent) => ({ intent, query_tr: "soru", query_original: "question" })),
  ],
  stay_change: { requested: true, kind: "early_checkin", checkin_time: time, checkout_time: null },
  ...over,
});
const NO_STAY_NLU = (intent: string) => ({
  language: "tr",
  requests: [{ intent, query_tr: "soru", query_original: "question" }],
  stay_change: { requested: false, kind: "none", checkin_time: null, checkout_time: null },
});
const guard = (time: string | null, over: Record<string, unknown> = {}) => ({
  guest_requests_change: true,
  kind: "early_checkin",
  requested_checkin_time: time,
  requested_checkout_time: null,
  reply_states_calendar: false,
  reply_grants_change: false,
  reply_defers_to_host: false,
  reply_refuses: false,
  ...over,
});
const NO_REQUEST_GUARD = guard(null, { guest_requests_change: false, kind: "none" });

function openAi(answers: { reply?: Record<string, unknown>; understanding?: Record<string, unknown>; guard?: Record<string, unknown> }) {
  const f = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { response_format?: { type?: string; json_schema?: { name?: string } } };
    let content: unknown;
    if (body.response_format?.type === "json_schema") {
      const name = body.response_format.json_schema?.name;
      content = name === "guest_message_understanding" ? answers.understanding : name === "stay_change_guard" ? answers.guard : undefined;
      if (content === undefined) throw new Error(`beklenmeyen şema: ${name}`);
    } else {
      content = answers.reply ?? reply();
    }
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }] }), { status: 200 });
  });
  vi.stubGlobal("fetch", f);
  return f;
}

async function conversationFor(propertyId: string, reservationId: string, body: string, at: Date) {
  const c = await prisma.conversation.create({
    data: {
      propertyId,
      reservationId,
      channel: "airbnb",
      guestIdentifier: "Alex",
      status: "new",
      externalReservationId: `res-${reservationId}`,
      lastMessageAt: at,
      messages: { create: [{ direction: "inbound", senderName: "Alex", body, createdAt: at }] },
    },
    select: { id: true },
  });
  return c.id;
}

async function decision(conversationId: string) {
  const ev = await prisma.riskEvent.findFirstOrThrow({ where: { conversationId, surface: "auto_reply" }, orderBy: { occurredAt: "desc" } });
  const evidence = JSON.parse(String(ev.kbEvidenceJson)) as { ec?: { s: string; f: string[]; a: string } };
  return { finalDecision: ev.finalDecision, reason: ev.reason, ec: evidence.ec };
}

const sentBody = () => String(mockSend.mock.calls[0]?.[1] ?? "");
const APPROVAL = /The apartment is ready — you can check in today \(14 October\) from/;

function at(now: Date) {
  vi.setSystemTime(now);
}

/** Aynı test içinde yeni bir kurulum: DB + sahteler + anlama önbelleği sıfırlanır. */
async function fresh() {
  await resetDb();
  vi.clearAllMocks();
  __resetUnderstandingCache();
  mockSend.mockResolvedValue({ ok: true, externalId: "ext-1" } as never);
}

const staff = (organizationId: string, userId: string): SessionPayload => ({
  userId,
  organizationId,
  role: "staff",
  email: "c@example.com",
  name: "C",
  sessionEpoch: 0,
});
const json = (url: string, method: string, body: unknown) =>
  new NextRequest(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("erken giriş — kurucunun senaryo matrisi (gerçek ayrıştırıcı + kapı + DB)", () => {
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
    mockSend.mockResolvedValue({ ok: true, externalId: "ext-1" } as never);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("1 · planlanan çıkış 11:00, yeni misafir 09:00 istiyor, READY yok → RED DEĞİL: 'henüz doğrulanmadı' (pending), güvenli akış", async () => {
    const now = Z("2026-10-14T05:00:00.000"); // 08:00
    at(now);
    const t = await turnover();
    await cleaning(t, t.departing.id, "2026-10-14", []);
    await saveEarlyCheckinRule(t.orgId, t.propertyId, RULE);
    openAi({ understanding: nlu("09:00"), guard: guard("09:00") });
    const id = await conversationFor(t.propertyId, t.own.id, "Hi! Could we check in at 09:00 today?", new Date(now.getTime() - 60_000));
    expect((await applyChannelAutoReply(id)).sent).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
    expect(await decision(id)).toEqual({
      finalDecision: "human_review",
      reason: "availability_unconfirmed",
      ec: { s: "pending", f: ["previous_still_in", "not_ready"], a: "0" },
    });
    // İki model ertelemeyi doğruladıysa misafire yalnız ERTELEME gider — ne onay ne ret.
    await fresh();
    const u = await turnover();
    await cleaning(u, u.departing.id, "2026-10-14", []);
    await saveEarlyCheckinRule(u.orgId, u.propertyId, RULE);
    openAi({ understanding: nlu("09:00"), guard: guard("09:00", { reply_defers_to_host: true }) });
    const id2 = await conversationFor(u.propertyId, u.own.id, "Hi! Could we check in at 09:00 today?", new Date(now.getTime() - 60_000));
    expect((await applyChannelAutoReply(id2)).sent).toBe(true);
    expect(sentBody()).toContain("check with the host");
    expect(sentBody()).not.toMatch(APPROVAL);
    expect((await decision(id2)).ec).toEqual({ s: "pending", f: ["previous_still_in", "not_ready"], a: "0" });
  });

  it("2 · planlanan çıkış 11:00, temizlikçi 08:15 başladı + 08:45 READY, takvim temiz, en erken 09:00, misafir 09:00 → host rızasıyla OTOMATİK onay; rıza yoksa bekler", async () => {
    const now = Z("2026-10-14T05:52:00.000"); // 08:52
    at(now);
    const t = await turnover();
    await cleaning(t, t.departing.id, "2026-10-14", [
      ["in_progress", "2026-10-14T05:15:00.000"],
      ["done", "2026-10-14T05:45:00.000"],
    ]);
    await saveEarlyCheckinRule(t.orgId, t.propertyId, { ...RULE, readyBeforeCheckout: true });
    openAi({ understanding: nlu("09:00"), guard: guard("09:00") });
    const id = await conversationFor(t.propertyId, t.own.id, "Hi! Could we check in at 09:00 today?", new Date(now.getTime() - 60_000));
    expect((await applyChannelAutoReply(id)).sent).toBe(true);
    expect(sentBody().startsWith("The apartment is ready — you can check in today (14 October) from 09:00. The early check-in fee is €30.")).toBe(true);
    expect(await decision(id)).toEqual({ finalDecision: "auto_sent", reason: "early_checkin_verified", ec: { s: "approvable", f: [], a: "1" } });

    // KONTROL: aynı olgular, host rızası YOK → onay yok, bekliyor (önceki misafirin beklenen çıkışı + temizlik sayılmadı).
    await fresh();
    const u = await turnover();
    await cleaning(u, u.departing.id, "2026-10-14", [
      ["in_progress", "2026-10-14T05:15:00.000"],
      ["done", "2026-10-14T05:45:00.000"],
    ]);
    await saveEarlyCheckinRule(u.orgId, u.propertyId, RULE);
    openAi({ understanding: nlu("09:00"), guard: guard("09:00") });
    const id2 = await conversationFor(u.propertyId, u.own.id, "Hi! Could we check in at 09:00 today?", new Date(now.getTime() - 60_000));
    expect((await applyChannelAutoReply(id2)).sent).toBe(false);
    expect((await decision(id2)).ec).toEqual({ s: "pending", f: ["previous_still_in", "not_ready"], a: "0" });
  });

  it("2b · sabah sorulan istek (07:00) bekler; temizlikçi 08:45'te READY deyince BİR KEZ yeniden değerlendirilir ve onay gider", async () => {
    const asked = Z("2026-10-14T04:00:00.000"); // 07:00
    at(new Date(asked.getTime() + 2 * 60_000));
    const t = await turnover();
    const task = await cleaning(t, t.departing.id, "2026-10-14", []);
    await saveEarlyCheckinRule(t.orgId, t.propertyId, { ...RULE, readyBeforeCheckout: true });
    openAi({ understanding: nlu("09:00"), guard: guard("09:00") });
    const id = await conversationFor(t.propertyId, t.own.id, "Hi! Could we check in at 09:00 today?", asked);
    await runDueChannelAutoReplies(t.orgId);
    expect(mockSend).not.toHaveBeenCalled();
    expect((await decision(id)).ec).toEqual({ s: "pending", f: ["previous_still_in", "not_ready"], a: "0" });
    // Karar kaydının zamanı DB saatinden gelir; sahte saatle aynı eksene çekilir.
    await prisma.riskEvent.updateMany({ where: { conversationId: id }, data: { occurredAt: new Date(asked.getTime() + 2 * 60_000) } });
    // Temizlikçi 08:15 başlar, 08:45 "Daire hazır".
    await prisma.taskUpdate.create({ data: { taskId: task.id, userId: t.cleanerId, status: "in_progress", createdAt: Z("2026-10-14T05:15:00.000") } });
    await prisma.task.update({ where: { id: task.id }, data: { status: "done" } });
    await prisma.taskUpdate.create({ data: { taskId: task.id, userId: t.cleanerId, status: "done", createdAt: Z("2026-10-14T05:45:00.000") } });
    const pass = Z("2026-10-14T05:51:00.000"); // 08:51
    at(pass);
    expect(await recheckEarlyCheckinsAfterCleaning(t.orgId, pass)).toBe(1);
    await runDueChannelAutoReplies(t.orgId);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(sentBody()).toMatch(/from 09:00/);
    expect(sentBody()).toMatch(APPROVAL);
  });

  it("3 · ayrılan misafir '10'da valizlerimizi bırakacağız' → çıkış kanıtı OLUŞMAZ (model yanlış okusa da)", async () => {
    const now = Z("2026-10-14T04:00:00.000");
    at(now);
    const t = await turnover();
    openAi({
      reply: reply({ intent: "checkout", reply: "Thanks for letting us know.", stayChangeAsked: "none", replyStance: "none", statedCheckoutTime: "10:00" }),
      understanding: NO_STAY_NLU("luggage"),
      guard: NO_REQUEST_GUARD,
    });
    const id = await conversationFor(t.propertyId, t.departing.id, "10'da valizlerimizi bırakacağız.", new Date(now.getTime() - 60_000));
    await applyChannelAutoReply(id);
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: t.departing.id } })).guestCheckoutTime).toBeNull();
  });

  it("4 · ayrılan misafir '10'da çıkacağız' → beyan KAYDEDİLİR ama gerçek çıkış SAYILMAZ (beklenen 11:00 esas; beyan host'a bilgi)", async () => {
    const now = Z("2026-10-14T04:00:00.000"); // 07:00
    at(now);
    const t = await turnover();
    await cleaning(t, t.departing.id, "2026-10-14", []);
    await saveEarlyCheckinRule(t.orgId, t.propertyId, RULE);
    openAi({
      reply: reply({ intent: "checkout", reply: "Thanks for letting us know.", stayChangeAsked: "none", replyStance: "none", statedCheckoutTime: "10:00" }),
      understanding: NO_STAY_NLU("checkout_time"),
      guard: NO_REQUEST_GUARD,
    });
    const dep = await conversationFor(t.propertyId, t.departing.id, "10'da çıkacağız.", new Date(now.getTime() - 60_000));
    await applyChannelAutoReply(dep);
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: t.departing.id } })).guestCheckoutTime).toBe("10:00");
    const loaded = await loadEarlyCheckinFacts({
      organizationId: t.orgId,
      propertyId: t.propertyId,
      reservationId: t.own.id,
      now,
      requested: { time: "10:30", sources: 2, conflict: false },
      singleIntent: true,
    });
    expect(loaded?.facts).toMatchObject({ previousSameDay: { checkoutTime: "11:00" }, previousDeclaredCheckout: "10:00" });
    const d = decideEarlyCheckin(loaded!.facts, loaded!.rule);
    expect(d).toMatchObject({ status: "pending", failed: ["previous_still_in", "not_ready"], autoSend: false });
  });

  it("5 · ayrılan misafir 'çıktık' → onay da ret de üretmez; temizlikçi kaydı gelene kadar bekler", async () => {
    const now = Z("2026-10-14T06:00:00.000"); // 09:00
    at(now);
    const t = await turnover();
    await cleaning(t, t.departing.id, "2026-10-14", []);
    await saveEarlyCheckinRule(t.orgId, t.propertyId, RULE);
    openAi({
      reply: reply({ intent: "checkout", reply: "Thank you, have a safe trip!", stayChangeAsked: "none", replyStance: "none" }),
      understanding: NO_STAY_NLU("checkout_time"),
      guard: NO_REQUEST_GUARD,
    });
    const dep = await conversationFor(t.propertyId, t.departing.id, "Çıktık, anahtarı içeride bıraktık.", new Date(now.getTime() - 5 * 60_000));
    await applyChannelAutoReply(dep);
    vi.clearAllMocks();
    __resetUnderstandingCache();
    mockSend.mockResolvedValue({ ok: true, externalId: "ext-1" } as never);
    openAi({ understanding: nlu("10:00"), guard: guard("10:00") });
    const id = await conversationFor(t.propertyId, t.own.id, "Hi! Could we check in at 10:00 today?", new Date(now.getTime() - 60_000));
    expect((await applyChannelAutoReply(id)).sent).toBe(false);
    expect((await decision(id)).ec).toEqual({ s: "pending", f: ["previous_still_in", "not_ready"], a: "0" });
  });
  it.todo("5b · 'çıktık' beyanı G3 kanıtı olarak KAYDEDİLİR ve host paneline yazılır (onay kanıtı DEĞİL) — dilim 7 (anlama olayları)");

  it("6 · temizlikçi başladı → host panelinde 'başladı' (G4); karar hâlâ bekliyor (READY yok)", async () => {
    const now = Z("2026-10-14T05:30:00.000"); // 08:30
    at(now);
    const t = await turnover();
    await cleaning(t, t.departing.id, "2026-10-14", [["in_progress", "2026-10-14T05:15:00.000"]]);
    await saveEarlyCheckinRule(t.orgId, t.propertyId, { ...RULE, readyBeforeCheckout: true });
    openAi({ reply: reply(), understanding: nlu("09:30") });
    const id = await conversationFor(t.propertyId, t.own.id, "Hi! Could we check in at 09:30 today?", new Date(now.getTime() - 60_000));
    const user = await prisma.user.create({ data: { organizationId: t.orgId, name: "O", email: `o-${++seq}@example.com`, passwordHash: "x", role: "owner" } });
    session = { userId: user.id, organizationId: t.orgId, role: "owner", email: "o@example.com", name: "O", sessionEpoch: 0 };
    const res = await aiSuggest(json(`http://localhost/api/conversations/${id}/ai-suggest`, "POST", {}), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { earlyCheckin: { status: string; failed: string[]; facts: Record<string, unknown> } };
    expect(body.earlyCheckin).toMatchObject({ status: "pending", facts: { cleaningStarted: true, readiness: "not_ready" } });
    expect(body.earlyCheckin.failed).toEqual(["previous_still_in", "not_ready"]);
    const { earlyCheckinPanelLines } = await import("@/lib/early-checkin/panel");
    const lines = earlyCheckinPanelLines(body.earlyCheckin as never).map((l) => l.text);
    expect(lines).toContain('Temizlikçi temizliğe başladı; henüz "Daire hazır" demedi.');
  });

  it("7 · önceki devrin / dünün READY'si bugünkü istekte GEÇERSİZ", async () => {
    const now = Z("2026-10-14T06:00:00.000"); // 09:00
    at(now);
    const o = await org();
    const older = await reservation(o.propertyId, "2026-10-08", "2026-10-10");
    const departing = await reservation(o.propertyId, "2026-10-10", "2026-10-14");
    const own = await reservation(o.propertyId, "2026-10-14", "2026-10-16");
    // Önceki devrin READY'si (10 Ekim) + bu devrin görevine DÜN atılmış READY (rıza açık olsa da gün başından önce).
    await cleaning(o, older.id, "2026-10-10", [["in_progress", "2026-10-10T08:30:00.000"], ["done", "2026-10-10T10:00:00.000"]]);
    await cleaning(o, departing.id, "2026-10-14", [["in_progress", "2026-10-13T16:00:00.000"], ["done", "2026-10-13T17:00:00.000"]]);
    await saveEarlyCheckinRule(o.orgId, o.propertyId, { ...RULE, readyBeforeCheckout: true });
    const loaded = await loadEarlyCheckinFacts({
      organizationId: o.orgId,
      propertyId: o.propertyId,
      reservationId: own.id,
      now,
      requested: { time: "10:00", sources: 2, conflict: false },
      singleIntent: true,
    });
    expect(loaded?.facts).toMatchObject({ readiness: "not_ready", readinessNote: "before_checkout", departureConfirmed: false });
    expect(loaded?.readyAt).toBeNull();
    expect(decideEarlyCheckin(loaded!.facts, loaded!.rule)).toMatchObject({ status: "pending", autoSend: false });
  });

  it("8 · bu devrin READY'si verildikten SONRA yeni doluluk (ayrılan misafir bir gece uzattı) → READY geçersiz, çakışma", async () => {
    const now = Z("2026-10-14T09:00:00.000"); // 12:00
    at(now);
    const t = await turnover();
    await cleaning(t, t.departing.id, "2026-10-14", [["in_progress", "2026-10-14T08:10:00.000"], ["done", "2026-10-14T08:40:00.000"]]);
    await saveEarlyCheckinRule(t.orgId, t.propertyId, RULE);
    const args = {
      organizationId: t.orgId,
      propertyId: t.propertyId,
      reservationId: t.own.id,
      now,
      requested: { time: "13:00", sources: 2, conflict: false },
      singleIntent: true,
    };
    // KONTROL: uzatma yokken onaylanabilir.
    const before = await loadEarlyCheckinFacts(args);
    expect(decideEarlyCheckin(before!.facts, before!.rule).status).toBe("approvable");
    await prisma.reservation.update({ where: { id: t.departing.id }, data: { departureDate: midnight("2026-10-15") } });
    const after = await loadEarlyCheckinFacts(args);
    expect(after?.facts.otherOverlaps).toBe(1);
    expect(decideEarlyCheckin(after!.facts, after!.rule)).toMatchObject({ status: "needs_host", autoSend: false });
    expect(decideEarlyCheckin(after!.facts, after!.rule).failed).toContain("overlap");
  });

  it("9 · takvim çakışması + READY → READY çakışmayı AŞAMAZ (host)", async () => {
    const now = Z("2026-10-14T09:00:00.000"); // 12:00
    at(now);
    const t = await turnover();
    await cleaning(t, t.departing.id, "2026-10-14", [["in_progress", "2026-10-14T08:10:00.000"], ["done", "2026-10-14T08:40:00.000"]]);
    await reservation(t.propertyId, "2026-10-13", "2026-10-15");
    await saveEarlyCheckinRule(t.orgId, t.propertyId, RULE);
    openAi({ understanding: nlu("13:00"), guard: guard("13:00") });
    const id = await conversationFor(t.propertyId, t.own.id, "Hi! Could we check in at 13:00 today?", new Date(now.getTime() - 60_000));
    expect((await applyChannelAutoReply(id)).sent).toBe(false);
    const d = await decision(id);
    expect(d.ec?.s).toBe("needs_host");
    expect(d.ec?.f).toContain("overlap");
  });

  it("10 · BUGÜN (bilinen bedel): 'Early check-in ücretli mi?' bilgi sorusu da host'a düşer — otomatik İZİN asla gitmez", async () => {
    const now = Z("2026-10-14T05:00:00.000");
    at(now);
    const t = await turnover();
    await cleaning(t, t.departing.id, "2026-10-14", [["in_progress", "2026-10-14T04:00:00.000"], ["done", "2026-10-14T04:30:00.000"]]);
    await saveEarlyCheckinRule(t.orgId, t.propertyId, RULE);
    openAi({
      reply: reply({ reply: "Early check-in may be possible depending on availability.", replyStance: "none" }),
      understanding: nlu(null, [], { requests: [{ intent: "early_checkin", query_tr: "erken giriş ücretli mi", query_original: "is early check-in paid" }] }),
      guard: guard(null),
    });
    const id = await conversationFor(t.propertyId, t.own.id, "Early check-in ücretli mi?", new Date(now.getTime() - 60_000));
    expect((await applyChannelAutoReply(id)).sent).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
    const d = await decision(id);
    expect(d.ec?.s).toBe("needs_host");
    expect(d.ec?.f).toContain("time_unknown");
  });
  it.todo("10b · bilgi/politika sorusu ('ücretli mi?') host kuralından KODDA kurulan politika cevabını alır; gereksiz inceleme yok — dilim 6");

  it("11 · 'Yarın 10'da gelebilir miyiz?' → izin iş akışı: varış günü değilse bekler; varış günü gelen 'yarın' da otomatik gitmez", async () => {
    // (a) Bir gün önce soruyor: varış günü bekleniyor.
    const eve = Z("2026-10-13T06:00:00.000"); // 13 Ekim 09:00
    at(eve);
    const t = await turnover();
    await saveEarlyCheckinRule(t.orgId, t.propertyId, RULE);
    openAi({ understanding: nlu("10:00"), guard: guard("10:00") });
    const a = await conversationFor(t.propertyId, t.own.id, "Yarın 10'da gelebilir miyiz?", new Date(eve.getTime() - 60_000));
    expect((await applyChannelAutoReply(a)).sent).toBe(false);
    const da = await decision(a);
    expect(da.ec?.s).toBe("pending");
    expect(da.ec?.f).toContain("not_arrival_day");
    // (b) Varış GÜNÜ gelen "yarın": diğer her şey doğrulanmış olsa da gün doğrulanmadı → otomatik yok.
    await fresh();
    const now = Z("2026-10-14T05:00:00.000"); // 14 Ekim 08:00
    at(now);
    const v = await vacantNight(now);
    await saveEarlyCheckinRule(v.orgId, v.propertyId, RULE);
    openAi({ understanding: nlu("12:00"), guard: guard("12:00") });
    const b = await conversationFor(v.propertyId, v.own.id, "Yarın 12'de gelebilir miyiz?", new Date(now.getTime() - 60_000));
    expect((await applyChannelAutoReply(b)).sent).toBe(false);
    expect((await decision(b)).ec).toEqual({ s: "approvable", f: ["day_unverified"], a: "0" });
  });

  it("12 · host'un otomatik onay saati 10:00, misafir 09:00 → OTOMATİK RED DEĞİL: host'a (manuel)", async () => {
    const now = Z("2026-10-14T05:00:00.000"); // 08:00
    at(now);
    const v = await vacantNight(now);
    await saveEarlyCheckinRule(v.orgId, v.propertyId, { ...RULE, earliest: "10:00" });
    openAi({ understanding: nlu("09:00"), guard: guard("09:00") });
    const id = await conversationFor(v.propertyId, v.own.id, "Hi! Could we check in at 09:00 today?", new Date(now.getTime() - 60_000));
    expect((await applyChannelAutoReply(id)).sent).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
    expect(await decision(id)).toEqual({ finalDecision: "human_review", reason: "availability_unconfirmed", ec: { s: "needs_host", f: ["before_window"], a: "0" } });
  });

  it("13 · otomatik onay saati 10:00, misafir 10:00, READY + takvim temiz + kural geçerli → OTOMATİK onay", async () => {
    const now = Z("2026-10-14T05:00:00.000"); // 08:00
    at(now);
    const v = await vacantNight(now);
    await saveEarlyCheckinRule(v.orgId, v.propertyId, { ...RULE, earliest: "10:00" });
    openAi({ understanding: nlu("10:00"), guard: guard("10:00") });
    const id = await conversationFor(v.propertyId, v.own.id, "Hi! Could we check in at 10:00 today?", new Date(now.getTime() - 60_000));
    expect((await applyChannelAutoReply(id)).sent).toBe(true);
    expect(sentBody().startsWith("The apartment is ready — you can check in today (14 October) from 10:00. The early check-in fee is €30.")).toBe(true);
    expect(await decision(id)).toEqual({ finalDecision: "auto_sent", reason: "early_checkin_verified", ec: { s: "approvable", f: [], a: "1" } });
  });

  it("14 · bir model 'istek yok', diğeri 'erken giriş isteği' → istek YAŞAR (cevap modelinin düz cevabı otomatik gitmez)", async () => {
    const now = Z("2026-10-14T05:00:00.000");
    at(now);
    const v = await vacantNight(now);
    await saveEarlyCheckinRule(v.orgId, v.propertyId, RULE);
    openAi({
      reply: reply({ intent: "checkin", reply: "Our check-in time is 15:00.", stayChangeAsked: "none", replyStance: "none" }),
      understanding: nlu("12:00"),
      guard: NO_REQUEST_GUARD,
    });
    const id = await conversationFor(v.propertyId, v.own.id, "Hi! Could we be there by 12:00 today?", new Date(now.getTime() - 60_000));
    expect((await applyChannelAutoReply(id)).sent).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
    // İstek birleşimde yaşadı: akış koştu (saat tek modelden → otomatik yok), cevap modelinin "istek yok"u onu silmedi.
    expect((await decision(id)).ec).toEqual({ s: "approvable", f: ["single_source_time"], a: "0" });
  });

  it("15 · karar BİLİNMİYOR (READY yok) + cevap modeli açık onay yazdı → ENGEL (beyan ister 'grants' ister 'defers' desin)", async () => {
    const now = Z("2026-10-14T05:00:00.000");
    at(now);
    for (const [stance, g] of [
      ["grants", guard("13:00", { reply_grants_change: true })],
      ["defers", guard("13:00", { reply_grants_change: true })], // model duruşunu yanlış beyan etti; bekçi izni gördü
    ] as const) {
      await fresh();
      const t = await turnover();
      await cleaning(t, t.departing.id, "2026-10-14", []);
      await saveEarlyCheckinRule(t.orgId, t.propertyId, RULE);
      openAi({ reply: reply({ reply: "Sure! You can check in at 13:00 today.", replyStance: stance }), understanding: nlu("13:00"), guard: g });
      const id = await conversationFor(t.propertyId, t.own.id, "Hi! Could we check in at 13:00 today?", new Date(now.getTime() - 60_000));
      expect((await applyChannelAutoReply(id)).sent, stance).toBe(false);
      expect(mockSend, stance).not.toHaveBeenCalled();
      expect((await decision(id)).finalDecision, stance).toBe("human_review");
    }
  });

  it("16/17 · karar ONAYLANABİLİR: modelin uydurduğu ücret / indirim misafire GİTMEZ (iki yol)", async () => {
    const now = Z("2026-10-14T05:00:00.000");
    at(now);
    for (const invented of ["the fee is €99", "I can offer you a 20% discount"]) {
      // (a) Model ERTELİYOR ama uydurma ücret/indirim ekledi; iki model ertelemeyi doğruladı → doğrulanmış onay onun
      //     YERİNE geçer: giden metin KODDAN (host'un ücreti €30), modelin metni hiç gitmez.
      await fresh();
      const v = await vacantNight(now);
      await saveEarlyCheckinRule(v.orgId, v.propertyId, RULE);
      openAi({
        reply: reply({ reply: `Thanks! I'll check with the host and get back to you — ${invented}.` }),
        understanding: nlu("12:00"),
        guard: guard("12:00", { reply_defers_to_host: true }),
      });
      const a = await conversationFor(v.propertyId, v.own.id, "Hi! Could we check in at 12:00 today?", new Date(now.getTime() - 60_000));
      expect((await applyChannelAutoReply(a)).sent, invented).toBe(true);
      expect(sentBody().startsWith("The apartment is ready — you can check in today (14 October) from 12:00. The early check-in fee is €30."), invented).toBe(true);
      expect(sentBody()).not.toMatch(/€99|discount|20%/);
      expect(await decision(a)).toMatchObject({ reason: "early_checkin_verified", ec: { s: "approvable", f: [], a: "1" } });

      // (b) Model açık İZİN + uydurma ücret/indirim yazdı → iddia: bekçiye gerek kalmadan tutulur, hiçbir şey gitmez.
      await fresh();
      const w = await vacantNight(now);
      await saveEarlyCheckinRule(w.orgId, w.propertyId, RULE);
      openAi({ reply: reply({ reply: `Sure! Early check-in at 12:00 is possible, ${invented}.`, replyStance: "grants" }), understanding: nlu("12:00"), guard: guard("12:00") });
      const b = await conversationFor(w.propertyId, w.own.id, "Hi! Could we check in at 12:00 today?", new Date(now.getTime() - 60_000));
      expect((await applyChannelAutoReply(b)).sent, invented).toBe(false);
      expect(mockSend).not.toHaveBeenCalled();
      expect(await decision(b)).toMatchObject({ finalDecision: "human_review", reason: "availability_claim" });
    }
  });
  it.todo("16b/17b · onaylanabilir ama TASLAK kuralında (ya da bekleyen kararda) modelin ERTELEME cevabı uydurma ücret / indirim içeriyorsa otomatik gitmez — dilim 8 (para paritesi; bekçi açılmadan önce ZORUNLU)");

  it("18 · temizlikçi para/fiyat/rapor/faturalandırma uçlarına ERİŞEMEZ (403) ve hiçbir şey yazılmaz", async () => {
    const t = await turnover();
    session = staff(t.orgId, t.cleanerId);
    const params = { params: Promise.resolve({ id: t.propertyId }) };
    const calls: [string, Response][] = [
      ["early-checkin-rule PUT", await putRule(json(`http://localhost/api/properties/${t.propertyId}/early-checkin-rule`, "PUT", RULE), params)],
      ["nightly-rate PUT", await putNightlyRate(json(`http://localhost/api/properties/${t.propertyId}/nightly-rate`, "PUT", { min: 1000, max: 2000, currency: "TRY" }), params)],
      ["reports daily", await reportDaily(new NextRequest("http://localhost/api/reports/daily"), { params: Promise.resolve({}) })],
      ["reports monthly", await reportMonthly(new NextRequest("http://localhost/api/reports/monthly"), { params: Promise.resolve({}) })],
      ["reports ops", await reportOps(new NextRequest("http://localhost/api/reports/ops"), { params: Promise.resolve({}) })],
      ["billing plan-preview", await planPreview(json("http://localhost/api/billing/plan-preview", "POST", { plan: "pro" }), { params: Promise.resolve({}) })],
      ["billing plan-change", await planChange(json("http://localhost/api/billing/plan-change", "POST", { plan: "pro" }), { params: Promise.resolve({}) })],
      ["billing portal", await billingPortal(json("http://localhost/api/billing/portal", "POST", {}), { params: Promise.resolve({}) })],
    ];
    for (const [name, res] of calls) expect(res.status, name).toBe(403);
    expect(await prisma.automationRule.count()).toBe(0);
  });

  it("19 · temizlikçi ilgisiz mülkün / kendisine atanmamış görevin READY'sini İŞARETLEYEMEZ; başka kiracınınkini göremez", async () => {
    const now = Z("2026-10-14T09:00:00.000");
    at(now);
    const t = await turnover();
    // Aynı org'da başka mülk; görev başka birine atanmış (ya da kimseye).
    const other = await prisma.property.create({ data: { organizationId: t.orgId, name: "Menekşe", checkInTime: "15:00", checkOutTime: "11:00" } });
    const foreignTask = await prisma.task.create({ data: { propertyId: other.id, type: "cleaning", title: "Temizlik", status: "todo", origin: "system", dueAt: midnight("2026-10-14") } });
    const b = await org();
    const tenantTask = await prisma.task.create({ data: { propertyId: b.propertyId, type: "cleaning", title: "Temizlik", status: "todo", origin: "system", dueAt: midnight("2026-10-14") } });
    session = staff(t.orgId, t.cleanerId);
    const patch = (id: string) => patchTask(json(`http://localhost/api/tasks/${id}`, "PATCH", { status: "done" }), { params: Promise.resolve({ id }) });
    expect((await patch(foreignTask.id)).status).toBe(403);
    expect((await patch(tenantTask.id)).status).toBe(404);
    expect(await prisma.taskUpdate.count()).toBe(0);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: foreignTask.id } })).status).toBe("todo");
    // Anti-vakum: kendi atanmış görevini işaretleyebilir ve bu hazırlık olarak SAYILIR.
    const own = await cleaning(t, t.departing.id, "2026-10-14", [], "todo");
    expect((await patch(own.id)).status).toBe(200);
    const upd = await prisma.taskUpdate.findFirstOrThrow({ where: { taskId: own.id } });
    expect(upd).toMatchObject({ status: "done", userId: t.cleanerId });
  });

  it("20 · eski READY yeni devirde tekrar kullanılamaz: arada başka konaklama varsa önceki temizlik sayılmaz", async () => {
    const now = Z("2026-10-14T09:00:00.000"); // 12:00
    at(now);
    const o = await org();
    const first = await reservation(o.propertyId, "2026-10-05", "2026-10-10");
    await reservation(o.propertyId, "2026-10-10", "2026-10-13"); // arada yeni doluluk (13'ünde çıktı, temizlik kaydı YOK)
    const own = await reservation(o.propertyId, "2026-10-14", "2026-10-16");
    await cleaning(o, first.id, "2026-10-10", [["in_progress", "2026-10-10T08:30:00.000"], ["done", "2026-10-10T09:30:00.000"]]);
    await saveEarlyCheckinRule(o.orgId, o.propertyId, { ...RULE, readyBeforeCheckout: true });
    const loaded = await loadEarlyCheckinFacts({
      organizationId: o.orgId,
      propertyId: o.propertyId,
      reservationId: own.id,
      now,
      requested: { time: "13:00", sources: 2, conflict: false },
      singleIntent: true,
    });
    expect(loaded?.facts.readiness).toBe("unknown");
    expect(loaded?.readyAt).toBeNull();
    expect(decideEarlyCheckin(loaded!.facts, loaded!.rule).autoSend).toBe(false);
  });
});
