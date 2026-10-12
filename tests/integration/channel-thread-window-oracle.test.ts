// ---------------------------------------------------------------------------
// MADDE 10 KÂHİNİ (kurucu talimatı bağlam sözleşmesi madde 10; kurucu kararı 10-12 "Şimdi yap"): kanal oto-yanıtı konuşmayı
// sondan sayfa sayfa okur (`channel-thread-window.ts`). Sözleşme: misafire giden cevap, kapı, kayıtlar konuşmanın TAMAMI okunmuş
// gibi BİREBİR aynı. Kanıt: tohumlu rastgele konuşmalar (misafir / ev sahibi / yapay zekâ / otomatik şablon / eski ad kuralı /
// sistem olayı / boş gövde / eşit damga) aynı kimliklerle yeniden kurulur ve önce tam okumayla, sonra 1–7 satırlık sayfalarla koşar;
// cevap modeline giden girdi, anlama / bekçi istekleri, gönderim, sonuç, karar kaydı ve konuşma satırı karşılaştırılır.
// Küçük sayfa her tüketiciyi kesit sınırına zorlar — bir koşul eksikse burada ayrışır.
// ---------------------------------------------------------------------------
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// Cevap modeli GERÇEK (`suggestReply` istemi kendisi kurar): karşılaştırılan, modele giden İSTEM METNİDİR — ham geçmiş dizisi
// değil (kesit kısa, ama istem / doğrulama / dil sinyali yalnız pencerelerden okur). Yalnız OpenAI isteği sahte (↓ fetch).
vi.mock("@/lib/ai", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai")>()),
  classifyMessage: vi.fn(),
  summarizeHostStyle: vi.fn(),
}));
vi.mock("@/lib/messaging", async (orig) => ({
  ...(await orig<typeof import("@/lib/messaging")>()),
  sendOnChannel: vi.fn(),
}));
vi.mock("@/lib/hospitable-credentials", () => ({ getOrgHospitableToken: vi.fn().mockResolvedValue("test-token") }));
vi.mock("@/lib/email", () => ({ emailService: { send: vi.fn(async () => ({ ok: true })), sendReporting: vi.fn(async () => ({ ok: true })) } }));
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn().mockResolvedValue(undefined) };
});

import { sendOnChannel } from "@/lib/messaging";
import { applyChannelAutoReply } from "@/lib/automation";
import { __setChannelThreadPageForTests, threadWindowSufficient } from "@/lib/channel-thread-window";
import { __resetUnderstandingCache } from "@/lib/ai/semantic/understand";
import { __resetRateLimit } from "@/lib/rate-limit";
import { __resetKbIndexCache } from "@/lib/ai/retrieval/index-cache";
import { __resetModelProviderHealthForTests } from "@/lib/ai/provider-health";

const mockSend = vi.mocked(sendOnChannel);
const DAY = 86_400_000;

// ── Tohumlu üreteç ────────────────────────────────────────────────────────────
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T,>(r: () => number, xs: readonly T[]) => xs[Math.floor(r() * xs.length)];

const GUEST = [
  "Wifi şifresi nedir?", "Teşekkürler", "Klima çalışmıyor, çok sıcak.", "Otopark var mı?", "Tamam 👍", "Giriş saati kaçta?",
  "Havlular nerede?", "Harika, teşekkür ederim!", "Çöp nereye atılıyor?", "İade istiyorum.", "", "Anladım", "Yarın 13:00'te gelebilir miyiz?",
];
const HOST = ["Wifi şifresi kartta yazıyor.", "Kontrol edip döneceğim.", "Havlu ister misiniz?", "", "Giriş 15:00'ten itibaren.", "İyi tatiller!"];
const AI = ["Havlular banyodaki dolapta.", "Talebinizi ev sahibine iletiyorum.", "Rica ederiz 😊", "Otopark bina altında, ücretsiz."];
const AI_INTENTS = [null, null, "complaint", "human_request", "closing_courtesy", "wifi"];
const AUTOMATION = ["Hoş geldiniz! Giriş bilgileri ektedir.", "Çıkış saatiniz 11:00. İyi yolculuklar!"];

interface Row {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  authorType: string | null;
  senderName: string;
  aiIntent: string | null;
  systemEventType: string | null;
  externalId: string | null;
  createdAt: Date;
}

/** Tohumdan konuşma: bazen uzun cevapsız misafir dizisi, bazen hiç ev sahibi yok, bazen sonda otomatik şablon. */
function genThread(seed: number, t0: number, opts: { undelivered?: boolean } = {}): { rows: Row[]; closingOn: boolean } {
  const r = rng(seed);
  const len = 20 + Math.floor(r() * 50);
  const shape = pick(r, ["mixed", "mixed", "longPending", "noHost", "automationHeavy"] as const);
  const rows: Row[] = [];
  let t = t0;
  for (let i = 0; i < len; i++) {
    // Eşit damga (aynı milisaniye) ara sıra: kimlik kopma noktası keyset'te de aynı olmalı.
    if (r() > 0.15) t += 60_000;
    const tail = len - i;
    let kind: string;
    if (shape === "longPending" && i > 3) kind = tail === 1 ? "guest" : pick(r, ["guest", "guest", "guest", "automation"]);
    else if (shape === "noHost") kind = pick(r, ["guest", "guest", "ai", "automation", "legacyAi"]);
    else if (shape === "automationHeavy") kind = pick(r, ["guest", "automation", "automation", "host", "ai"]);
    else kind = pick(r, ["guest", "guest", "guest", "host", "ai", "automation", "legacyAi", "legacyHost", "system"]);
    if (tail === 1) kind = "guest";
    const id = `m${String(i).padStart(4, "0")}${pick(r, ["a", "b", "c"])}`;
    const base = { id, createdAt: new Date(t), aiIntent: null, systemEventType: null, externalId: `ext-${id}` };
    if (kind === "guest") rows.push({ ...base, direction: "inbound", body: pick(r, GUEST), authorType: "guest", senderName: "Ayşe" });
    else if (kind === "host") rows.push({ ...base, direction: "outbound", body: pick(r, HOST), authorType: "host", senderName: "Ev sahibi" });
    else if (kind === "ai")
      rows.push({ ...base, direction: "outbound", body: pick(r, AI), authorType: "ai", senderName: "GuestOps AI", aiIntent: pick(r, AI_INTENTS) });
    else if (kind === "automation")
      rows.push({ ...base, direction: "outbound", body: pick(r, AUTOMATION), authorType: "automation", senderName: "Ev sahibi" });
    else if (kind === "legacyAi") rows.push({ ...base, direction: "outbound", body: pick(r, AI), authorType: null, senderName: "GuestOps AI" });
    else if (kind === "legacyHost") rows.push({ ...base, direction: "outbound", body: pick(r, HOST), authorType: null, senderName: "Ev sahibi" });
    else rows.push({ ...base, direction: "outbound", body: "", authorType: "system", senderName: "__lixus_ai_resumed__", systemEventType: "guest_chat_ai_resumed" });
  }
  // Kalıcı outbox senaryosu: bazı giden satırlar sağlayıcı kimliği taşımaz (teslim edilmemiş biçim) — outbox satırı ↓ seed'de.
  if (opts.undelivered) {
    for (const m of rows) if (m.direction === "outbound" && m.authorType !== "automation" && r() < 0.3) m.externalId = null;
  }
  // Sonda otomatik şablon (K7 kesmesi) ara sıra.
  if (r() < 0.25) {
    t += 60_000;
    rows.push({
      id: `m9999z`, direction: "outbound", body: pick(r, AUTOMATION), authorType: "automation", senderName: "Ev sahibi",
      aiIntent: null, systemEventType: null, externalId: "ext-tail", createdAt: new Date(t),
    });
  }
  return { rows, closingOn: r() < 0.5 };
}

async function seed(rows: readonly Row[], closingOn: boolean, now: number) {
  await prisma.organization.create({
    data: {
      id: "org-oracle", name: "Kâhin Org", autoReplyHospitable: true, autoReplyStartHour: 0, autoReplyEndHour: 0,
      timezone: "Europe/Istanbul", autoClosingReplyEnabled: closingOn,
    },
  });
  await prisma.property.create({ data: { id: "prop-oracle", organizationId: "org-oracle", name: "Lale", checkInTime: "15:00", checkOutTime: "11:00" } });
  await prisma.reservation.create({
    data: {
      id: "res-oracle", propertyId: "prop-oracle", guestName: "Ayşe Yılmaz", arrivalDate: new Date(now - DAY),
      departureDate: new Date(now + 3 * DAY), channel: "airbnb", status: "confirmed", sourceReference: "res-oracle-ext",
    },
  });
  await prisma.conversation.create({
    data: {
      id: "conv-oracle", propertyId: "prop-oracle", reservationId: "res-oracle", guestIdentifier: "Ayşe Yılmaz", channel: "airbnb",
      status: "new", externalReservationId: "res-oracle-ext", lastMessageAt: rows[rows.length - 1]?.createdAt ?? new Date(now),
    },
  });
  await prisma.message.createMany({ data: rows.map((m) => ({ ...m, conversationId: "conv-oracle" })) });
  // Teslim edilmemiş biçimli satırların outbox kaydı: durum satır kimliğinden belirlenir (koşudan koşuya aynı).
  const STATUSES = ["failed", "canceled", "review", "sent", "pending"] as const;
  const shaped = rows.filter((m) => m.direction === "outbound" && m.externalId === null);
  if (shaped.length > 0) {
    await prisma.messageOutbox.createMany({
      data: shaped.map((m, i) => ({
        organizationId: "org-oracle", conversationId: "conv-oracle", messageId: m.id, channel: "airbnb", body: m.body,
        idempotencyKey: `k-${m.id}`, status: STATUSES[i % STATUSES.length],
      })),
    });
  }
}

/** Cevap modelinin JSON'u — "history" dayanağı beyanı geçmişte giden mesaj aranmasını (kaynak doğrulaması) da çalıştırır. */
const MODEL_REPLY = {
  reply: "Wifi şifresi giriş kapısının yanındaki kartta yazıyor.", intent: "wifi", confidence: 0.95, riskLevel: "low",
  priority: "standard", detectedLanguage: "tr", usedSources: ["history"], missingInfo: [],
};
const NLU = {
  language: "tr",
  requests: [{ intent: "wifi", query_tr: "wifi şifresi", query_original: "wifi" }],
  stay_change: { requested: false, kind: "none", checkin_time: null, checkout_time: null },
};
const GUARD = {
  guest_requests_change: false, kind: "none", requested_checkin_time: null, requested_checkout_time: null, reply_states_calendar: false,
  reply_grants_change: false, reply_defers_to_host: false, reply_refuses: false, reply_amounts: [], reply_price_terms: false,
};
/** Bütün OpenAI istekleri: şemalı olanlar anlama / bekçi, şemasız olan cevap modeli. Her istek gövdesi AYNEN kaydedilir. */
function modelFetch(bodies: string[]) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const body = String(init?.body);
    bodies.push(body);
    const name = JSON.parse(body).response_format?.json_schema?.name as string | undefined;
    const verdict = name === undefined ? MODEL_REPLY : name === "guest_message_understanding" ? NLU : name === "stay_change_guard" ? GUARD : null;
    if (!verdict) throw new Error(`beklenmeyen şema: ${name}`);
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(verdict) } }] }), { status: 200 });
  });
}

/** Kanıttaki SÜRE alanları (`ms`, `semMs`, …) her koşuda değişir — karşılaştırmadan çıkarılır; geri kalan her alan aynen kalır. */
function withoutTimings(json: string | null): unknown {
  if (json === null) return null;
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.entries(v).filter(([k]) => k !== "ms" && !/Ms$/.test(k)).map(([k, x]) => [k, strip(x)]));
    }
    return v;
  };
  return strip(JSON.parse(json));
}

/** Bir koşu: kur → oto-yanıt → bütün gözlenebilir çıktılar. */
async function run(
  rows: readonly Row[],
  closingOn: boolean,
  now: number,
  page: number | null,
  hooks: { duringModel?: () => Promise<void>; afterSeed?: () => Promise<void> } = {},
) {
  await resetDb();
  vi.clearAllMocks();
  __resetUnderstandingCache();
  __resetRateLimit();
  __resetKbIndexCache();
  __resetModelProviderHealthForTests();
  mockSend.mockResolvedValue({ ok: true, providerMessageId: "prov-1" } as never);
  const fetchBodies: string[] = [];
  const fetcher = modelFetch(fetchBodies);
  vi.stubGlobal(
    "fetch",
    hooks.duringModel
      ? vi.fn(async (url: string, init?: RequestInit) => {
          if (JSON.parse(String(init?.body)).response_format?.json_schema === undefined) await hooks.duringModel!();
          return fetcher(url, init);
        })
      : fetcher,
  );
  // Saat SABİT: istemdeki "şu an" / tarih satırı koşudan koşuya kaymasın (yalnız Date; zamanlayıcılar gerçek).
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  await seed(rows, closingOn, now);
  await hooks.afterSeed?.();
  __setChannelThreadPageForTests(page);
  let outcome: unknown;
  try {
    outcome = await applyChannelAutoReply("conv-oracle");
  } finally {
    __setChannelThreadPageForTests(null);
    vi.useRealTimers();
  }
  const riskEvents = await prisma.riskEvent.findMany({
    orderBy: [{ occurredAt: "asc" }, { triggerId: "asc" }, { finalDecision: "asc" }],
    select: {
      surface: true, triggerId: true, finalDecision: true, reason: true, riskLevel: true, riskType: true, confidence: true,
      kbEvidenceJson: true, kbRetrieved: true, srcDeclared: true, srcVerified: true,
    },
  });
  const convo = await prisma.conversation.findUniqueOrThrow({
    where: { id: "conv-oracle" },
    select: {
      status: true, priority: true, skippedReason: true, autoReplyHoldUntil: true, lastRiskLevel: true, lastRiskType: true,
      aiActionSuggestion: true,
    },
  });
  const outbound = await prisma.message.findMany({
    where: { conversationId: "conv-oracle", id: { notIn: rows.map((m) => m.id) } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { direction: true, body: true, authorType: true, aiIntent: true, senderName: true },
  });
  const outbox = await prisma.messageOutbox.findMany({
    orderBy: { idempotencyKey: "asc" },
    select: { messageId: true, status: true, body: true, messageType: true, idempotencyKey: true },
  });
  const generations = await prisma.aiGeneration.findMany({
    orderBy: { triggerMessageId: "asc" },
    select: {
      surface: true, decision: true, gateReason: true, draftText: true, sentText: true, triggerMessageId: true,
      contextDiagnosticsJson: true, toolResultsJson: true, kbEvidenceJson: true,
    },
  });
  return {
    outcome,
    outbox: outbox.map((o) => ({ ...o, messageId: o.messageId && rows.some((m) => m.id === o.messageId) ? o.messageId : "(yeni)" })),
    generations: generations.map((g) => ({ ...g, kbEvidenceJson: withoutTimings(g.kbEvidenceJson) })),
    send: mockSend.mock.calls,
    fetchBodies,
    riskEvents: riskEvents.map((e) => ({ ...e, kbEvidenceJson: withoutTimings(e.kbEvidenceJson) })),
    convo,
    outbound,
  };
}

describe("madde 10 kâhini — sayfalı okuma = tam okuma", () => {
  beforeEach(() => {
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  afterAll(() => __setChannelThreadPageForTests(null));

  const SEEDS = Array.from({ length: 24 }, (_, i) => 1000 + i * 7919);
  const PAGES = [1, 2, 3, 7];

  it("ön koşul (anti-vakumluk): üretilen konuşmalar küçük sayfada GERÇEKTEN sayfalanır ve kâhin kendisiyle tutarlıdır", async () => {
    const now = Date.now();
    const { rows, closingOn } = genThread(SEEDS[0], now - 2 * DAY);
    const a = await run(rows, closingOn, now, null);
    const b = await run(rows, closingOn, now, null);
    expect(b).toEqual(a); // M0: aynı girdi → aynı çıktı (kâhin geçerli)
    // Kesit yeterlilik koşulu 25 satırın altında hiç sağlanmaz → 1–7'lik sayfa her konuşmada birden çok sayfa okur.
    expect(threadWindowSufficient(rows.slice(-7) as never)).toBe(false);
  });

  it.each(SEEDS)("🚨 tohum %i: varsayılan bayraklar — her sayfa boyunda bütün çıktılar tam okumayla aynı", async (seedN) => {
    const now = Date.now();
    const { rows, closingOn } = genThread(seedN, now - 2 * DAY);
    const full = await run(rows, closingOn, now, null);
    for (const page of PAGES) {
      const paged = await run(rows, closingOn, now, page);
      expect(paged, `sayfa ${page}`).toEqual(full);
    }
  });

  it.each(SEEDS.slice(0, 12))("🚨 tohum %i: anlama katmanı + konaklama bekçisi açık — model istekleri de aynı", async (seedN) => {
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubEnv("AI_STAY_GUARD_ENABLED", "1");
    const now = Date.now();
    const { rows, closingOn } = genThread(seedN, now - 2 * DAY);
    const full = await run(rows, closingOn, now, null);
    for (const page of PAGES) {
      const paged = await run(rows, closingOn, now, page);
      expect(paged, `sayfa ${page}`).toEqual(full);
    }
  });

  it.each(SEEDS.slice(0, 10))("🚨 tohum %i: kalıcı outbox açık + teslim edilmemiş taslaklar — süzgeç konuşma çapında aynı", async (seedN) => {
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    const now = Date.now();
    const { rows, closingOn } = genThread(seedN, now - 2 * DAY, { undelivered: true });
    const full = await run(rows, closingOn, now, null);
    for (const page of PAGES) {
      const paged = await run(rows, closingOn, now, page);
      expect(paged, `sayfa ${page}`).toEqual(full);
    }
  });

  it.each(SEEDS.slice(0, 8))("🚨 tohum %i: konuşma kayıtları + üretim izi açık — kesit öncesi toplamlar SAYILIR (satır okunmaz), sonuç tam okumayla aynı", async (seedN) => {
    vi.stubEnv("AI_CONVERSATION_STATE_ENABLED", "1");
    vi.stubEnv("AI_GENERATION_TRACE_ENABLED", "1");
    const now = Date.now();
    const { rows, closingOn } = genThread(seedN, now - 2 * DAY);
    const full = await run(rows, closingOn, now, null);
    for (const page of PAGES) {
      const paged = await run(rows, closingOn, now, page);
      expect(paged, `sayfa ${page}`).toEqual(full);
    }
  });
});

describe("madde 10 — model çalışırken gelen YENİ misafir mesajı (C2) sayfalı okumada da cevabı durdurur", () => {
  beforeEach(() => {
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const longThread = (now: number): Row[] =>
    Array.from({ length: 60 }, (_, i) => ({
      id: `m${String(i).padStart(4, "0")}`,
      direction: (i % 2 === 0 ? "inbound" : "outbound") as "inbound" | "outbound",
      body: i % 2 === 0 ? `Soru ${i}: havlular nerede?` : "Banyodaki dolapta.",
      authorType: i % 2 === 0 ? "guest" : "host",
      senderName: i % 2 === 0 ? "Ayşe" : "Ev sahibi",
      aiIntent: null,
      systemEventType: null,
      externalId: `ext-${i}`,
      createdAt: new Date(now - DAY + i * 60_000),
    })).concat([
      {
        id: "m9000", direction: "inbound", body: "Wifi şifresi nedir?", authorType: "guest", senderName: "Ayşe", aiIntent: null,
        systemEventType: null, externalId: "ext-9000", createdAt: new Date(now - 60_000),
      },
    ]);

  it.each([null, 3])("🚨 sayfa %s: yeni mesaj → gönderim YOK (superseded); kontrol: yeni mesaj yoksa gider", async (page) => {
    const now = Date.now();
    const rows = longThread(now);
    const sent = await run(rows, false, now, page);
    expect((sent.outcome as { sent: boolean }).sent).toBe(true);
    const superseded = await run(rows, false, now, page, {
      duringModel: async () => {
        await prisma.message.create({
          data: { id: "m9001", conversationId: "conv-oracle", direction: "inbound", body: "Bir de otopark?", authorType: "guest", senderName: "Ayşe", createdAt: new Date(now) },
        });
      },
    });
    expect(superseded.outcome).toMatchObject({ sent: false, skippedReason: "superseded_by_newer_message" });
    expect(superseded.send).toEqual([]);
  });
});

// ── Hedefli senaryolar: her yeterlilik koşulu YALNIZ başına bağlayıcı ─────────────────────────────────────────────────────
// Rastgele konuşmalarda 25 satırlık pencere hemen her zaman son cevabı, ev sahibini, misafir mesajını içerir → koşullar nadiren
// bağlayıcıdır (ilk mutasyon turunda 8 koşul silinince kâhin yeşil kaldı). Aşağıdaki her konuşma bir tüketicinin baktığı en eski
// satırı kesitin sınırının hemen dışına koyar; 1 satırlık sayfa sınırı tek tek kaydırdığı için koşul eksikse okuma erken durur.
function spec(lines: readonly string[], t0: number): Row[] {
  return lines.map((line, i) => {
    const k = line[0];
    const body = line.slice(2);
    const base = { id: `s${String(i).padStart(4, "0")}`, createdAt: new Date(t0 + i * 60_000), aiIntent: null, systemEventType: null, externalId: `ext-s${i}` };
    if (k === "g") return { ...base, direction: "inbound" as const, body, authorType: "guest", senderName: "Ayşe" };
    if (k === "h") return { ...base, direction: "outbound" as const, body, authorType: "host", senderName: "Ev sahibi" };
    if (k === "a") return { ...base, direction: "outbound" as const, body, authorType: "ai", senderName: "GuestOps AI" };
    if (k === "A") return { ...base, direction: "outbound" as const, body, authorType: "automation", senderName: "Ev sahibi" };
    // Sistem olayı işaretli ev sahibi satırı: kapanışın cevap kuralı sayar, konuşma kayıtlarınınki SAYMAZ (iki kural ayrışır).
    if (k === "x") return { ...base, direction: "outbound" as const, body, authorType: "host", senderName: "Ev sahibi", systemEventType: "guest_chat_ai_resumed" };
    return { ...base, direction: "outbound" as const, body, authorType: "system", senderName: "__lixus_ai_resumed__", systemEventType: "guest_chat_ai_resumed" };
  });
}
const many = (prefix: string, n: number, kind = "g") => Array.from({ length: n }, (_, i) => `${kind}:${prefix} ${i + 1}`);

describe("madde 10 kâhini — hedefli senaryolar (koşul başına)", () => {
  beforeEach(() => {
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  async function same(rows: Row[], pages: number[], hooks: { afterSeed?: () => Promise<void> } = {}) {
    const now = rows[rows.length - 1].createdAt.getTime() + 60_000;
    const full = await run(rows, false, now, null, hooks);
    for (const page of pages) {
      const paged = await run(rows, false, now, page, hooks);
      expect(paged, `sayfa ${page}`).toEqual(full);
    }
    return full;
  }

  it("🚨 anlama bağlamı SON DOLU cevaptan sayılır: araya boş gövdeli ev sahibi mesajı girse de eski 6 satır kesitte", async () => {
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubEnv("AI_STAY_GUARD_ENABLED", "1");
    const t0 = Date.now() - 2 * DAY;
    const rows = spec([...many("Eski soru", 6), "h:Cevap verildi.", ...many("Ara soru", 3), "h:", ...many("Bekleyen", 24), "g:Wifi şifresi nedir?"], t0);
    const full = await same(rows, [1, 2, 3]);
    // Anti-vakumluk: anlama katmanı GERÇEKTEN çağrıldı ve bağlamında en eski soru var.
    const nlu = full.fetchBodies.find((b) => b.includes("guest_message_understanding"));
    expect(nlu).toBeDefined();
    expect(nlu).toContain("Eski soru 2");
  });

  it("🚨 bekçi + anlama bağlamı (6 dolu satır) kesite girmeden okuma durmaz", async () => {
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubEnv("AI_STAY_GUARD_ENABLED", "1");
    const t0 = Date.now() - 2 * DAY;
    const rows = spec([...many("Eski", 8), "h:Cevap verildi.", ...many("Bekleyen", 26), "g:Wifi şifresi nedir?"], t0);
    const full = await same(rows, [1, 2, 3]);
    expect(full.fetchBodies.some((b) => b.includes("stay_change_guard") && b.includes("Eski 4"))).toBe(true);
  });

  it("🚨 kapanış: kesitte hiç cevap (yapay zekâ / ev sahibi) yoksa okuma sürer — 200+ cevapsız mesaj ve dolu sistem satırı", async () => {
    const t0 = Date.now() - 3 * DAY;
    const rows = spec(["g:Soru", "h:Cevap verildi.", ...many("Ara", 205), "s:Yapay zekâ yeniden açıldı", "g:Teşekkürler"], t0);
    const full = await same(rows, [1, 7, 50]);
    // Anti-vakumluk: tam okumada önceki cevap görülür → kapanış yolu (model çağrılmaz).
    expect(full.fetchBodies).toEqual([]);
  });

  it("🚨 kapanış: ilk cevaptan ÖNCE bir misafir mesajı kesitte olmalı (yoksa 'daha önce cevap verildi mi' yanlış hayır olur)", async () => {
    const t0 = Date.now() - 2 * DAY;
    const rows = spec(["g:Soru", ...many("Bilgi", 30, "h"), "g:Teşekkürler", "g:Tamam"], t0);
    const full = await same(rows, [1, 2, 3]);
    expect(full.fetchBodies).toEqual([]);
  });

  it("🚨 açık iş: ev sahibine bırakılmış eski talep (son ev sahibi mesajından sonra) kesitte değilse okuma sürer", async () => {
    const t0 = Date.now() - 2 * DAY;
    const rows = spec(["g:Selam", "h:Hoş geldiniz", "g:İade istiyorum", ...many("Ara", 24), "a:Anlaşıldı.", "g:Teşekkürler"], t0);
    const full = await same(rows, [1, 2, 3], {
      afterSeed: async () => {
        await prisma.riskEvent.create({
          data: {
            organizationId: "org-oracle", propertyId: "prop-oracle", conversationId: "conv-oracle", surface: "auto_reply",
            triggerId: rows[2].id, finalDecision: "human_review", reason: "refund_request",
          },
        });
      },
    });
    // Anti-vakumluk: açık iş görüldü → kapanış GÖRÜNÜR kalır.
    expect(full.convo.skippedReason).toBe("closing_ack_open");
  });

  it("🚨 konuşma kayıtları: kesitte KENDİ kuralıyla bir cevap yoksa okuma sürer ('son giden mesajdan sonra misafirin yazdığı' sayısı)", async () => {
    vi.stubEnv("AI_CONVERSATION_STATE_ENABLED", "1");
    const t0 = Date.now() - 2 * DAY;
    const rows = spec(["g:Soru", "h:Cevap verildi.", ...many("Ara", 12), "x:Sistem notu", ...many("Bekleyen", 14), "g:Wifi şifresi nedir?"], t0);
    const full = await same(rows, [1, 2, 3]);
    const reply = full.fetchBodies.find((b) => b.includes("KONUŞMA KAYITLARI"));
    expect(reply).toBeDefined(); // anti-vakumluk: blok istemde
    expect(reply).toContain("misafirin yazdığı mesaj: 27");
  });

  it("🚨 konuşma kayıtları: son 10 misafir mesajı kesitte olmadan okuma durmaz (ev sahibine bırakılmış eski iade konusu)", async () => {
    vi.stubEnv("AI_CONVERSATION_STATE_ENABLED", "1");
    const t0 = Date.now() - 2 * DAY;
    const pairs = Array.from({ length: 7 }, (_, i) => [`g:Soru ${i + 1}`, `h:Cevap ${i + 1}`]).flat();
    const rows = spec(["g:İade istiyorum", "h:Bakıyorum", "g:Ara 1", ...many("Bilgi", 26, "h"), ...pairs, "g:Wifi şifresi nedir?"], t0);
    const full = await same(rows, [1, 2, 3], {
      afterSeed: async () => {
        await prisma.riskEvent.create({
          data: {
            organizationId: "org-oracle", propertyId: "prop-oracle", conversationId: "conv-oracle", surface: "auto_reply",
            triggerId: rows[0].id, finalDecision: "human_review", reason: "refund_request", riskType: "money_refund",
          },
        });
      },
    });
    const reply = full.fetchBodies.find((b) => b.includes("KONUŞMA KAYITLARI"));
    expect(reply).toBeDefined();
    expect(reply).toContain("Önceki konular"); // anti-vakumluk: eski iade kaydı konu satırına girdi
  });
});
