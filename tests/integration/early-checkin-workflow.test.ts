import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// DOĞRULANMIŞ ERKEN GİRİŞ — UÇTAN UCA (09-24; DB gerçek, cevap modeli MOCK, anlama katmanı + bekçi sahte fetch).
// Kurucu: "hassas istek = ENGEL değil, doğrulama iş akışı. Her şey doğrulanmışsa insana düşmesin; eksik / çelişki /
// doğrulanamayan / gerçek host kararı → insan." Pinlenen:
//  · olgu yükleyici: aynı gün devir, önceki çıkışın GEÇ olanı, temizlik "bitti" işaretinin zamanı, çakışma, iptal satırı,
//    dün gece yalnız taze kaynakla boş, kiracı yalıtımı;
//  · kural deposu: yaz/oku/güncelle, bozuk satır = kapalı, başka kiracı okuyamaz;
//  · kanal oto-yanıtı: her şey doğrulanmışsa KODDAN kurulan onay gider (gerekçe `early_checkin_verified`, `ec` kanıtı,
//    host'a görev notu); tek eksik → insan (hangi kontrolün düştüğü kanıtta); kod metni de kapının geri kalanından geçer;
//  · "AI öner": host'a kontrol listesi + taslak; kural rotası yönetici kapılı ve kiracı kapsamlı.
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
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
/** Onay metnini BOZMAK için kanca (kapının kod metnini de sınadığını göstermek): `null` = gerçek metin. */
let approvalTextOverride: string | null = null;
vi.mock("@/lib/early-checkin/reply", async (orig) => {
  const actual = await orig<typeof import("@/lib/early-checkin/reply")>();
  return {
    ...actual,
    earlyCheckinApprovalText: (...args: Parameters<typeof actual.earlyCheckinApprovalText>) => {
      const real = actual.earlyCheckinApprovalText(...args);
      return real !== null && approvalTextOverride !== null ? approvalTextOverride : real;
    },
  };
});

import { suggestReply } from "@/lib/ai";
import { sendOnChannel } from "@/lib/messaging";
import { applyChannelAutoReply } from "@/lib/automation";
import { __resetUnderstandingCache } from "@/lib/ai/semantic/understand";
import { loadEarlyCheckinFacts } from "@/lib/early-checkin/load";
import { loadEarlyCheckinRule, saveEarlyCheckinRule, EARLY_CHECKIN_TRIGGER } from "@/lib/early-checkin/rules";
import type { EarlyCheckinRule } from "@/lib/early-checkin/core";
import { POST as aiSuggest } from "@/app/api/conversations/[id]/ai-suggest/route";
import { PUT as putRule, DELETE as deleteRule } from "@/app/api/properties/[id]/early-checkin-rule/route";

const mockSuggest = vi.mocked(suggestReply);
const mockSend = vi.mocked(sendOnChannel);

// İstanbul (UTC+3, yaz saati yok): 14 Ekim 11:40. Önceki misafir 11:00'de (08:00Z) çıktı, temizlik 11:30'da bitti.
const NOW = new Date("2026-10-14T08:40:00.000Z");
const midnight = (d: string) => new Date(`${d}T00:00:00.000Z`);
const CLEANED_AT = new Date("2026-10-14T08:30:00.000Z");
const RULE: EarlyCheckinRule = { mode: "auto", earliest: "12:00", fee: { amount: 30, currency: "EUR" }, note: null };
const ASK = "Hi! Could we check in at 13:00 today?";

async function org() {
  const o = await prisma.organization.create({
    data: { name: "Test Org", timezone: "Europe/Istanbul", autoReplyHospitable: true, autoReplyStartHour: 0, autoReplyEndHour: 0 },
  });
  const p = await prisma.property.create({ data: { organizationId: o.id, name: "Lale", checkInTime: "15:00", checkOutTime: "11:00" } });
  return { orgId: o.id, propertyId: p.id };
}

async function reservation(propertyId: string, arrival: string, departure: string, extra: Record<string, unknown> = {}) {
  return prisma.reservation.create({
    data: { propertyId, guestName: "Misafir", arrivalDate: midnight(arrival), departureDate: midnight(departure), status: "confirmed", channel: "airbnb", ...extra },
  });
}

/** Aynı gün devir: önceki misafir bugün çıkıyor, bizim misafir bugün geliyor; isteğe bağlı temizlik görevi. */
async function turnover(opts: { cleaned?: Date | null; cleaningStatus?: string; guestCheckout?: string | null } = {}) {
  const { orgId, propertyId } = await org();
  const previous = await reservation(propertyId, "2026-10-12", "2026-10-14", { guestCheckoutTime: opts.guestCheckout ?? null });
  const own = await reservation(propertyId, "2026-10-14", "2026-10-16");
  if (opts.cleaned !== undefined) {
    const task = await prisma.task.create({
      data: { propertyId, reservationId: previous.id, type: "cleaning", title: "Temizlik", status: opts.cleaningStatus ?? "done", origin: "system", dueAt: midnight("2026-10-14") },
    });
    if (opts.cleaned) await prisma.taskUpdate.create({ data: { taskId: task.id, status: "done", createdAt: opts.cleaned } });
  }
  const prep = await prisma.task.create({ data: { propertyId, reservationId: own.id, type: "checkin_prep", title: "Giriş hazırlığı", origin: "system" } });
  return { orgId, propertyId, previous, own, prepTaskId: prep.id };
}

const REQUESTED = { time: "13:00", sources: 2, conflict: false };

describe("olgu yükleyici — yalnız okur, org kapsamlı", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("aynı gün devir + çıkıştan sonra atılmış 'bitti' işareti → hazır; önceki çıkış mülk varsayılanı", async () => {
    const t = await turnover({ cleaned: CLEANED_AT });
    const out = await loadEarlyCheckinFacts({ organizationId: t.orgId, propertyId: t.propertyId, reservationId: t.own.id, now: NOW, requested: REQUESTED, singleIntent: true });
    expect(out?.facts).toMatchObject({
      standardCheckIn: "15:00",
      reservation: { status: "confirmed", arrivalKey: "2026-10-14" },
      todayKey: "2026-10-14",
      previousSameDay: { checkoutTime: "11:00" },
      otherOverlaps: 0,
      readiness: "ready",
      previousNightVerifiedVacant: false,
    });
    expect(out?.rule).toBeNull();
  });

  it("önceki misafirin bildirdiği saat varsayılandan GEÇSE o sayılır (erken bildirilen sayılmaz)", async () => {
    const late = await turnover({ cleaned: CLEANED_AT, guestCheckout: "13:30" });
    const a = await loadEarlyCheckinFacts({ organizationId: late.orgId, propertyId: late.propertyId, reservationId: late.own.id, now: NOW, requested: REQUESTED, singleIntent: true });
    expect(a?.facts.previousSameDay).toEqual({ checkoutTime: "13:30" });
    // 11:30'daki işaret 13:30 çıkıştan ÖNCE → dünkü/erken dokunma, hazır SAYILMAZ.
    expect(a?.facts.readiness).toBe("not_ready");
    await resetDb();
    const early = await turnover({ cleaned: CLEANED_AT, guestCheckout: "09:00" });
    const b = await loadEarlyCheckinFacts({ organizationId: early.orgId, propertyId: early.propertyId, reservationId: early.own.id, now: NOW, requested: REQUESTED, singleIntent: true });
    expect(b?.facts.previousSameDay).toEqual({ checkoutTime: "11:00" });
  });

  it("🚨 hazırlık: işaret çıkıştan önce, 5 dakikadan taze ya da görev açıksa hazır DEĞİL; görev yoksa bilinmiyor", async () => {
    const cases: [Parameters<typeof turnover>[0], string][] = [
      [{ cleaned: new Date("2026-10-14T07:59:00.000Z") }, "not_ready"],
      [{ cleaned: new Date("2026-10-14T08:37:00.000Z") }, "not_ready"],
      [{ cleaned: null, cleaningStatus: "in_progress" }, "not_ready"],
      [{}, "unknown"],
    ];
    for (const [opts, expected] of cases) {
      await resetDb();
      const t = await turnover(opts);
      const out = await loadEarlyCheckinFacts({ organizationId: t.orgId, propertyId: t.propertyId, reservationId: t.own.id, now: NOW, requested: REQUESTED, singleIntent: true });
      expect(out?.facts.readiness, JSON.stringify(opts)).toBe(expected);
    }
  });

  it("varış gecesini işgal eden başka rezervasyon çakışmadır; iptal satırı sayılmaz", async () => {
    const t = await turnover({ cleaned: CLEANED_AT });
    await reservation(t.propertyId, "2026-10-13", "2026-10-15", { status: "cancelled" });
    const clean = await loadEarlyCheckinFacts({ organizationId: t.orgId, propertyId: t.propertyId, reservationId: t.own.id, now: NOW, requested: REQUESTED, singleIntent: true });
    expect(clean?.facts.otherOverlaps).toBe(0);
    await reservation(t.propertyId, "2026-10-14", "2026-10-15");
    const clash = await loadEarlyCheckinFacts({ organizationId: t.orgId, propertyId: t.propertyId, reservationId: t.own.id, now: NOW, requested: REQUESTED, singleIntent: true });
    expect(clash?.facts.otherOverlaps).toBe(1);
  });

  it("aynı gün devir YOKSA dün gece yalnız TAZE kaynakla boş sayılır; kaynaksız mülkte doğrulanamaz", async () => {
    const { orgId, propertyId } = await org();
    const own = await reservation(propertyId, "2026-10-14", "2026-10-16");
    const args = { organizationId: orgId, propertyId, reservationId: own.id, now: NOW, requested: REQUESTED, singleIntent: true };
    expect((await loadEarlyCheckinFacts(args))?.facts).toMatchObject({ previousSameDay: null, previousNightVerifiedVacant: false });
    await prisma.calendarSource.create({
      data: { propertyId, label: "Airbnb", url: "https://x.example/f.ics", lastStatus: "ok", lastSyncedAt: new Date(NOW.getTime() - 30 * 60_000) },
    });
    expect((await loadEarlyCheckinFacts(args))?.facts.previousNightVerifiedVacant).toBe(true);
    // Dün gece dolu (tek gece kalan başka misafir dün geldi, BUGÜN çıkıyor) → artık aynı gün devir.
    await reservation(propertyId, "2026-10-13", "2026-10-14");
    expect((await loadEarlyCheckinFacts(args))?.facts).toMatchObject({ previousSameDay: { checkoutTime: "11:00" }, previousNightVerifiedVacant: false });
  });

  it("🚨 kiracı yalıtımı: başka org'un mülkü → null; başka mülkün rezervasyonu → rezervasyon YOK", async () => {
    const a = await turnover({ cleaned: CLEANED_AT });
    const b = await org();
    expect(await loadEarlyCheckinFacts({ organizationId: b.orgId, propertyId: a.propertyId, reservationId: a.own.id, now: NOW, requested: REQUESTED, singleIntent: true })).toBeNull();
    const cross = await loadEarlyCheckinFacts({ organizationId: b.orgId, propertyId: b.propertyId, reservationId: a.own.id, now: NOW, requested: REQUESTED, singleIntent: true });
    expect(cross?.facts.reservation).toBeNull();
    // Anti-vakum: kendi kapsamında aynı çağrı rezervasyonu görür.
    expect((await loadEarlyCheckinFacts({ organizationId: a.orgId, propertyId: a.propertyId, reservationId: a.own.id, now: NOW, requested: REQUESTED, singleIntent: true }))?.facts.reservation).not.toBeNull();
  });
});

describe("kural deposu (migration'sız, `AutomationRule`)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("yaz → oku → güncelle (tek satır) → kaldır; bozuk satır KAPALI; başka kiracı okuyamaz", async () => {
    const a = await org();
    const b = await org();
    await saveEarlyCheckinRule(a.orgId, a.propertyId, RULE);
    await saveEarlyCheckinRule(a.orgId, a.propertyId, { ...RULE, earliest: "13:00" });
    expect(await loadEarlyCheckinRule(a.orgId, a.propertyId)).toEqual({ ...RULE, earliest: "13:00" });
    expect(await prisma.automationRule.count({ where: { organizationId: a.orgId, triggerType: EARLY_CHECKIN_TRIGGER } })).toBe(1);
    expect(await loadEarlyCheckinRule(b.orgId, a.propertyId)).toBeNull();
    await prisma.automationRule.updateMany({ where: { organizationId: a.orgId }, data: { actionJson: "{bozuk" } });
    expect(await loadEarlyCheckinRule(a.orgId, a.propertyId)).toBeNull();
    await saveEarlyCheckinRule(a.orgId, a.propertyId, null);
    expect(await prisma.automationRule.count()).toBe(0);
  });
});

// ─── kanal oto-yanıtı ───────────────────────────────────────────────────────

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

const nlu = (time: string | null, extraIntents: string[] = [], kind = "early_checkin") => ({
  language: "en",
  requests: [
    { intent: kind === "late_checkout" ? "late_checkout" : "early_checkin", query_tr: "erken giriş", query_original: "early check-in" },
    ...extraIntents.map((intent) => ({ intent, query_tr: "soru", query_original: "question" })),
  ],
  stay_change: { requested: true, kind, checkin_time: kind === "early_checkin" ? time : null, checkout_time: kind === "late_checkout" ? time : null },
});
const guard = (time: string | null, defers: boolean, kind = "early_checkin") => ({
  guest_requests_change: true,
  kind,
  requested_checkin_time: kind === "early_checkin" ? time : null,
  requested_checkout_time: kind === "late_checkout" ? time : null,
  reply_states_calendar: false,
  reply_grants_change: false,
  reply_defers_to_host: defers,
  reply_refuses: false,
});

/** Şema adına göre cevap veren sahte OpenAI (anlama katmanı + bekçi aynı uca gider). */
function semanticFetch(answers: Record<string, Record<string, unknown>>) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const name = JSON.parse(String(init?.body)).response_format?.json_schema?.name as string;
    const verdict = answers[name];
    if (!verdict) throw new Error(`beklenmeyen şema: ${name}`);
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(verdict) } }] }), { status: 200 });
  });
}

async function conversationFor(t: { propertyId: string; own: { id: string } }, body = ASK) {
  const c = await prisma.conversation.create({
    data: {
      propertyId: t.propertyId,
      reservationId: t.own.id,
      channel: "airbnb",
      guestIdentifier: "Alex",
      status: "new",
      externalReservationId: "res-1",
      messages: { create: [{ direction: "inbound", senderName: "Alex", body, createdAt: new Date(NOW.getTime() - 2 * 60_000) }] },
    },
    select: { id: true },
  });
  return c.id;
}

async function decision(conversationId: string) {
  const ev = await prisma.riskEvent.findFirstOrThrow({ where: { conversationId, surface: "auto_reply" } });
  const evidence = JSON.parse(String(ev.kbEvidenceJson)) as { ec?: { s: string; f: string[]; a: string } };
  return { finalDecision: ev.finalDecision, reason: ev.reason, ec: evidence.ec };
}

describe("kanal oto-yanıtı — doğrulanmış erken giriş", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    __resetUnderstandingCache();
    approvalTextOverride = null;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("KB_RETRIEVAL_MODE", "legacy");
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubEnv("AI_STAY_GUARD_ENABLED", "1");
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

  it("🚨 her şey doğrulanmış + kural otomatik → KODDAN kurulan onay gider (insana düşmez); gerekçe, kanıt ve host notu", async () => {
    const t = await turnover({ cleaned: CLEANED_AT });
    await saveEarlyCheckinRule(t.orgId, t.propertyId, RULE);
    vi.stubGlobal("fetch", semanticFetch({ guest_message_understanding: nlu("13:00"), stay_change_guard: guard("13:00", false) }));
    const id = await conversationFor(t);
    const out = await applyChannelAutoReply(id);
    expect(out.sent).toBe(true);
    const body = String(mockSend.mock.calls[0][1]);
    expect(body.startsWith("Hello, the apartment is ready — you can check in from 13:00. The early check-in fee is €30.")).toBe(true);
    expect(body).not.toContain("check with the host");
    expect(await decision(id)).toEqual({ finalDecision: "auto_sent", reason: "early_checkin_verified", ec: { s: "approvable", f: [], a: "1" } });
    const note = await prisma.taskUpdate.findFirstOrThrow({ where: { taskId: t.prepTaskId } });
    expect(note.note).toMatch(/^Erken giriş 13:00 otomatik onaylandı · ücret .*30/);
  });

  it("🚨 iki model ertelemeyi doğrulayıp kapı GEÇSE de doğrulanmış onay ertelemenin yerine geçer (misafir 'soracağım' değil cevap alır)", async () => {
    const t = await turnover({ cleaned: CLEANED_AT });
    await saveEarlyCheckinRule(t.orgId, t.propertyId, RULE);
    vi.stubGlobal("fetch", semanticFetch({ guest_message_understanding: nlu("13:00"), stay_change_guard: guard("13:00", true) }));
    const id = await conversationFor(t);
    expect((await applyChannelAutoReply(id)).sent).toBe(true);
    expect(String(mockSend.mock.calls[0][1])).toContain("you can check in from 13:00");
    expect((await decision(id)).reason).toBe("early_checkin_verified");
  });

  it("kural 'taslak' → doğrulanmış cevap GİTMEZ; kapıyı geçen erteleme bugünkü gibi gider (kanıtta onaylanabilir, a=0)", async () => {
    const t = await turnover({ cleaned: CLEANED_AT });
    await saveEarlyCheckinRule(t.orgId, t.propertyId, { ...RULE, mode: "draft" });
    vi.stubGlobal("fetch", semanticFetch({ guest_message_understanding: nlu("13:00"), stay_change_guard: guard("13:00", true) }));
    const id = await conversationFor(t);
    expect((await applyChannelAutoReply(id)).sent).toBe(true);
    expect(String(mockSend.mock.calls[0][1])).toContain("check with the host");
    expect(await decision(id)).toEqual({ finalDecision: "auto_sent", reason: "gate_passed", ec: { s: "approvable", f: [], a: "0" } });
    expect(await prisma.taskUpdate.count({ where: { taskId: t.prepTaskId } })).toBe(0);
  });

  it("🚨 tek eksik → İNSAN, hangi kontrolün düştüğü kanıtta (temizlik bitmedi / saatler çelişiyor / başka konu / kural yok)", async () => {
    const cases: { name: string; opts: Parameters<typeof turnover>[0]; rule: EarlyCheckinRule | null; understand: ReturnType<typeof nlu>; g: ReturnType<typeof guard>; failed: string[]; status: string }[] = [
      { name: "temizlik görevi yok", opts: {}, rule: RULE, understand: nlu("13:00"), g: guard("13:00", false), failed: ["ready_unknown"], status: "needs_host" },
      { name: "iki model farklı saat", opts: { cleaned: CLEANED_AT }, rule: RULE, understand: nlu("13:00"), g: guard("12:00", false), failed: ["time_conflict"], status: "needs_host" },
      { name: "mesajda başka soru", opts: { cleaned: CLEANED_AT }, rule: RULE, understand: nlu("13:00", ["wifi"]), g: guard("13:00", false), failed: ["multi_intent"], status: "approvable" },
      { name: "kural yok", opts: { cleaned: CLEANED_AT }, rule: null, understand: nlu("13:00"), g: guard("13:00", false), failed: ["rule_off"], status: "needs_host" },
    ];
    for (const c of cases) {
      await resetDb();
      vi.clearAllMocks();
      __resetUnderstandingCache();
      mockSuggest.mockResolvedValue(MODEL);
      const t = await turnover(c.opts);
      if (c.rule) await saveEarlyCheckinRule(t.orgId, t.propertyId, c.rule);
      vi.stubGlobal("fetch", semanticFetch({ guest_message_understanding: c.understand, stay_change_guard: c.g }));
      const id = await conversationFor(t);
      expect((await applyChannelAutoReply(id)).sent, c.name).toBe(false);
      expect(mockSend, c.name).not.toHaveBeenCalled();
      expect(await decision(id), c.name).toEqual({ finalDecision: "human_review", reason: "availability_unconfirmed", ec: { s: c.status, f: c.failed, a: "0" } });
    }
  });

  it("🚨 kod metni de kapının GERİ KALANINDAN geçer: onay metni çıktı vetosuna takılırsa gitmez (insan)", async () => {
    const t = await turnover({ cleaned: CLEANED_AT });
    await saveEarlyCheckinRule(t.orgId, t.propertyId, RULE);
    approvalTextOverride = "I have arranged everything — you can check in from 13:00.";
    vi.stubGlobal("fetch", semanticFetch({ guest_message_understanding: nlu("13:00"), stay_change_guard: guard("13:00", false) }));
    const id = await conversationFor(t);
    expect((await applyChannelAutoReply(id)).sent).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
    expect(await decision(id)).toMatchObject({ finalDecision: "human_review", reason: "availability_unconfirmed", ec: { s: "approvable", a: "0" } });
  });

  it("geç çıkış isteğinde akış HİÇ koşmaz (kanıtta `ec` yok, bugünkü davranış)", async () => {
    const t = await turnover({ cleaned: CLEANED_AT });
    await saveEarlyCheckinRule(t.orgId, t.propertyId, RULE);
    mockSuggest.mockResolvedValue({ ...MODEL, intent: "late_checkout", stayChange: { asked: "late_checkout", stance: "defers" } });
    vi.stubGlobal("fetch", semanticFetch({ guest_message_understanding: nlu("13:00", [], "late_checkout"), stay_change_guard: guard("13:00", false, "late_checkout") }));
    const id = await conversationFor(t, "Could we check out at 13:00 on our last day?");
    expect((await applyChannelAutoReply(id)).sent).toBe(false);
    expect((await decision(id)).ec).toBeUndefined();
  });

  it("KONTROL: bayraklar kapalıyken (bugünkü üretim) saat iki modelden okunamaz → otomatik onay YOK", async () => {
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "");
    vi.stubEnv("AI_STAY_GUARD_ENABLED", "");
    const t = await turnover({ cleaned: CLEANED_AT });
    await saveEarlyCheckinRule(t.orgId, t.propertyId, RULE);
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const id = await conversationFor(t);
    expect((await applyChannelAutoReply(id)).sent).toBe(false);
    expect(f).not.toHaveBeenCalled();
    expect(await decision(id)).toMatchObject({ finalDecision: "human_review", ec: { s: "needs_host", f: ["time_unknown"], a: "0" } });
  });
});

// ─── "AI öner" + kural rotası ───────────────────────────────────────────────

const owner = (organizationId: string, role: SessionPayload["role"] = "owner"): SessionPayload => ({
  userId: "u-owner",
  organizationId,
  role,
  email: "o@example.com",
  name: "O",
  sessionEpoch: 0,
});

describe("AI öner — host'a kontrol listesi + doğrulanmış taslak (gönderim YOK)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    __resetUnderstandingCache();
    approvalTextOverride = null;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("KB_RETRIEVAL_MODE", "legacy");
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    mockSuggest.mockResolvedValue(MODEL);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("rota olguları + taslağı döner; bekçi burada koşmadığı için saat tek kaynaklı (otomatik değil, taslak var)", async () => {
    const t = await turnover({ cleaned: CLEANED_AT });
    await saveEarlyCheckinRule(t.orgId, t.propertyId, RULE);
    vi.stubGlobal("fetch", semanticFetch({ guest_message_understanding: nlu("13:00") }));
    const id = await conversationFor(t);
    session = owner(t.orgId);
    const res = await aiSuggest(new NextRequest(`http://localhost/api/conversations/${id}/ai-suggest`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { earlyCheckin: Record<string, unknown> | null };
    expect(json.earlyCheckin).toMatchObject({
      status: "approvable",
      failed: ["single_source_time"],
      approvedTime: "13:00",
      mode: "auto",
      fee: { amount: 30, currency: "EUR" },
      facts: { arrivalToday: true, requestedTime: "13:00", previousCheckout: "11:00", readiness: "ready", otherOverlaps: 0 },
    });
    expect(String(json.earlyCheckin?.draft)).toMatch(/^Hello, the apartment is ready — you can check in from 13:00/);
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe("PUT/DELETE /api/properties/[id]/early-checkin-rule", () => {
  const put = (id: string, body: unknown) =>
    putRule(new NextRequest(`http://localhost/api/properties/${id}/early-checkin-rule`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), {
      params: Promise.resolve({ id }),
    });
  const del = (id: string) => deleteRule(new NextRequest(`http://localhost/api/properties/${id}/early-checkin-rule`, { method: "DELETE" }), { params: Promise.resolve({ id }) });

  beforeEach(async () => {
    await resetDb();
  });

  it("yönetici yazar; denetim kaydı DEĞER taşımaz; kaldırma kuralı siler", async () => {
    const { orgId, propertyId } = await org();
    const user = await prisma.user.create({ data: { organizationId: orgId, name: "O", email: "o@example.com", passwordHash: "x", role: "owner" } });
    session = { ...owner(orgId), userId: user.id };
    // Formun kendi örnek notu kabul edilmeli (söz veren "göndereceğiz" biçimi çıktı vetosuna takılır → reddedilir).
    expect((await put(propertyId, { ...RULE, note: "Ödeme talebini Airbnb üzerinden göndereceğiz." })).status).toBe(400);
    expect((await put(propertyId, { ...RULE, note: "Ödeme talebi Airbnb üzerinden gelecek." })).status).toBe(200);
    expect(await loadEarlyCheckinRule(orgId, propertyId)).toMatchObject({ mode: "auto", fee: { amount: 30, currency: "EUR" } });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: orgId, action: "property.early_checkin_rule_set" } });
    expect(String(audit.metadataJson)).not.toMatch(/30|EUR|12:00|Airbnb/);
    expect((await del(propertyId)).status).toBe(200);
    expect(await loadEarlyCheckinRule(orgId, propertyId)).toBeNull();
  });

  it("🚨 temizlik/personel rolü ücreti değiştiremez (403); başka kiracının mülkü 404; geçersiz girdi 400 + sade mesaj", async () => {
    const a = await org();
    const b = await org();
    session = owner(a.orgId, "staff");
    expect((await put(a.propertyId, RULE)).status).toBe(403);
    expect((await del(a.propertyId)).status).toBe(403);
    session = owner(b.orgId);
    expect((await put(a.propertyId, RULE)).status).toBe(404);
    expect((await del(a.propertyId)).status).toBe(404);
    expect(await prisma.automationRule.count()).toBe(0);
    session = owner(a.orgId);
    const bad = await put(a.propertyId, { ...RULE, fee: { amount: -1, currency: "EUR" } });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { fields?: { _?: string } }).fields?._).toMatch(/^Kuralı kontrol edin/);
    // Anti-vakum: kendi mülküne geçerli istek çalışır.
    expect((await put(a.propertyId, RULE)).status).toBe(200);
  });
});
