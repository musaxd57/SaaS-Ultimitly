import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { prisma, resetDb } from "./helpers/db";

// ---------------------------------------------------------------------------
// G2 TUR 7 — erken giriş yeniden kontrol taraması: "EN YENİ 25'İ OKU, SONRA SÜZ" (11-18 kalıcı kuralının sınıfı).
// `recheckEarlyCheckinsAfterCleaning` aday kümesini sorguda `take: 25` ile EN YENİ konuşmalardan okur, "damga güncel mesaj için mi"
// süzgecini (autoReplyAttemptedAt >= lastMessageAt) BELLEKTE uygular. Aynı otomatik kurallı mülklerde son 24 saatte misafirin yeni yazdığı
// (henüz denenmemiş) 25 konuşma varken, sabah hazırlık yüzünden tutulmuş istek pencereye hiç girmez: temizlik bitip oturduğu hâlde yeniden
// aday yapılmaz, misafirin erken giriş isteği otomatik onaya dönmez (ev sahibinde kalır — güvenli yön, ama özelliğin işi kaybolur).
// Kurulum `tests/integration/early-checkin-recheck.test.ts` ile aynı (DB gerçek, model sahte).
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
import { recheckEarlyCheckinsAfterCleaning } from "@/lib/early-checkin/recheck";
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
  // Ev sahibinin kendi sesi (kurucu 10-30): üçüncü kişi "the host's call" kapının sonunda reply_host_voice ile tutulur.
  reply: "Thanks! Early check-in requires our approval.",
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

describe("yeniden kontrol taraması — yeni yazılmış konuşmalar tutulmuş isteği pencereden itmez", () => {
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

  async function morningHold() {
    vi.setSystemTime(MORNING_PASS);
    const s = await scenario();
    await runDueChannelAutoReplies(s.orgId);
    expect(mockSend).not.toHaveBeenCalled();
    const held = await prisma.riskEvent.updateMany({ where: { conversationId: s.conversationId, finalDecision: "human_review" }, data: { occurredAt: MORNING_PASS } });
    expect(held.count).toBe(1);
    return s;
  }

  /** Aynı mülkte bugün varan `n` konuşma: misafir az önce yazdı, otomatik cevap bu mesajı HENÜZ denemedi (damga eski mesajın). */
  async function freshConversations(propertyId: string, n: number) {
    for (let i = 0; i < n; i++) {
      const r = await prisma.reservation.create({
        data: { propertyId, guestName: `Misafir ${i}`, arrivalDate: midnight("2026-10-14"), departureDate: midnight("2026-10-15"), status: "confirmed", channel: "airbnb" },
      });
      await prisma.conversation.create({
        data: {
          propertyId,
          reservationId: r.id,
          channel: "airbnb",
          guestIdentifier: `Misafir ${i}`,
          status: "new",
          externalReservationId: `res-x-${i}`,
          autoReplyAttemptedAt: new Date(AFTER_SETTLE.getTime() - 30 * 60_000),
          lastMessageAt: new Date(AFTER_SETTLE.getTime() - 60_000),
        },
      });
    }
  }

  it("KONTROL: yeni yazılmış 3 konuşma varken tutulmuş istek yeniden aday olur", async () => {
    const s = await morningHold();
    await markCleaned(s, CLEANED_AT);
    await freshConversations(s.propertyId, 3);
    vi.setSystemTime(AFTER_SETTLE);
    expect(await recheckEarlyCheckinsAfterCleaning(s.orgId, AFTER_SETTLE)).toBe(1);
  });

  it("🚨 yeni yazılmış 25 konuşma varken de tutulmuş istek yeniden aday olur (bugün: pencereye girmez, 0)", async () => {
    const s = await morningHold();
    await markCleaned(s, CLEANED_AT);
    await freshConversations(s.propertyId, 25);
    vi.setSystemTime(AFTER_SETTLE);
    expect(await recheckEarlyCheckinsAfterCleaning(s.orgId, AFTER_SETTLE)).toBe(1);
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: s.conversationId } })).autoReplyAttemptedAt).toBeNull();
  });
});
