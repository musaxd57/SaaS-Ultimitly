import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// ANLAM KATMANI — KANAL OTO-YANITI UÇTAN UCA (09-24; cevap modeli MOCK, DB gerçek, bekçi çağrısı
// sahte fetch). Pinlenen: şema beyanı kapıya ULAŞIR, bekçi yalnız ADAY için koşar, karar kaydı
// kapıyla AYNI politikadan gerekçe + `sc` kanıtı taşır, gölge kip karar vermez ama ölçer.
// ---------------------------------------------------------------------------

vi.mock("@/lib/ai", () => ({ suggestReply: vi.fn(), classifyMessage: vi.fn() }));
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
import { applyChannelAutoReply } from "@/lib/automation";
import { __resetUnderstandingCache } from "@/lib/ai/semantic/understand";

const mockSuggest = vi.mocked(suggestReply);
const mockSend = vi.mocked(sendOnChannel);

/** Kelime ağının İSTEK saymadığı bir erken giriş isteği (kör bataryadan). */
const ASK = "Could we get into the flat at 11?";

const BASE = {
  intent: "early_checkin",
  confidence: 0.9,
  reply: "Check-in is from 15:00.",
  risk: null,
  priority: "standard" as const,
  source: "openai" as const,
  actionSuggestion: null,
  riskLevel: "none" as const,
  detectedLanguage: "en",
  riskType: null,
  usedSources: ["property:checkInTime"],
  sourceAudit: { declared: 1, verified: 1 },
  missingInfo: [],
  statedCheckoutTime: null,
};

async function seed(opts: { offer?: string; messages?: { direction: "inbound" | "outbound"; body: string }[] } = {}) {
  const org = await prisma.organization.create({
    data: {
      name: "Test Org",
      autoReplyHospitable: true,
      autoReplyStartHour: 0,
      autoReplyEndHour: 0,
      timezone: "Europe/Istanbul",
      ...(opts.offer ? { lateCheckoutOfferText: opts.offer } : {}),
    },
  });
  const property = await prisma.property.create({
    data: { organizationId: org.id, name: "Lale", checkInTime: "15:00", checkOutTime: "11:00" },
  });
  const msgs = opts.messages ?? [{ direction: "inbound" as const, body: ASK }];
  const t0 = Date.now() - (msgs.length + 1) * 60_000;
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      channel: "airbnb",
      guestIdentifier: "Alex",
      status: "new",
      externalReservationId: "res-1",
      messages: {
        create: msgs.map((m, i) => ({
          direction: m.direction,
          senderName: m.direction === "inbound" ? "Alex" : "Host",
          body: m.body,
          createdAt: new Date(t0 + i * 60_000),
        })),
      },
    },
    select: { id: true },
  });
  return conversation.id;
}

async function riskEvent(conversationId: string) {
  const ev = await prisma.riskEvent.findFirstOrThrow({ where: { conversationId, surface: "auto_reply" } });
  return { ev, sc: (JSON.parse(String(ev.kbEvidenceJson)) as { sc?: Record<string, string> }).sc };
}

function guardFetch(verdict: Record<string, unknown> | null, status = 200) {
  return vi.fn(async (url: string) => {
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    return new Response(
      status === 200
        ? JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(verdict) } }] })
        : "upstream down",
      { status },
    );
  });
}

const GUARD_GRANTS = {
  guest_requests_change: true,
  kind: "early_checkin",
  requested_checkin_time: "11:00",
  requested_checkout_time: null,
  reply_states_calendar: false,
  reply_grants_change: true,
  reply_defers_to_host: false,
  reply_refuses: false,
};

/** Anlama katmanının bu mesaj için dönebileceği hüküm (şema: `UNDERSTANDING_JSON_SCHEMA`). */
const NLU_EARLY = {
  language: "en",
  requests: [{ intent: "early_checkin", query_tr: "erken giriş", query_original: "early check-in at 11" }],
  stay_change: { requested: true, kind: "early_checkin", checkin_time: "11:00", checkout_time: null },
};

/**
 * Şema adına göre cevap veren sahte OpenAI: anlama katmanı ve bekçi AYNI uca gider, ayrım
 * `response_format.json_schema.name` ile. Beklenmeyen şema testi düşürür.
 */
function semanticFetch(answers: Record<string, Record<string, unknown>>) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const name = JSON.parse(String(init?.body)).response_format?.json_schema?.name as string;
    const verdict = answers[name];
    if (!verdict) throw new Error(`beklenmeyen şema: ${name}`);
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(verdict) } }] }), {
      status: 200,
    });
  });
}
const schemasCalled = (f: ReturnType<typeof semanticFetch>) =>
  f.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body)).response_format.json_schema.name as string);

describe("kanal oto-yanıtı — anlam katmanı bağlantısı", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    __resetUnderstandingCache();
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("KB_RETRIEVAL_MODE", "legacy");
    mockSend.mockResolvedValue({ ok: true, externalId: "ext-1" } as never);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("KONTROL: beyan yok, kelime ağı sessiz → gider; kanıtta beyan 'absent'", async () => {
    mockSuggest.mockResolvedValue(BASE);
    const id = await seed();
    await applyChannelAutoReply(id);
    expect(mockSend).toHaveBeenCalledTimes(1);
    const { ev, sc } = await riskEvent(id);
    expect(ev.finalDecision).toBe("auto_sent");
    expect(sc).toEqual({ v: "-", ev: "-", lx: "-", d: "absent", g: "off", u: "off" });
  });

  it("🚨 beyan edilen İZİN gönderimi durdurur; gerekçe kapıyla aynı politikadan", async () => {
    mockSuggest.mockResolvedValue({ ...BASE, reply: "Sure, see you at 11.", stayChange: { asked: "early_checkin", stance: "grants" } });
    const id = await seed();
    await applyChannelAutoReply(id);
    expect(mockSend).not.toHaveBeenCalled();
    const { ev, sc } = await riskEvent(id);
    expect(ev.finalDecision).toBe("human_review");
    expect(ev.reason).toBe("availability_claim");
    expect(sc).toMatchObject({ v: "availability_claim", d: "early_checkin/grants", g: "off" });
  });

  it("beyan edilen İSTEK gölge kipte karar vermez ama `enforce` kipinin kararı kanıta yazılır", async () => {
    mockSuggest.mockResolvedValue({ ...BASE, stayChange: { asked: "early_checkin", stance: "none" } });
    const id = await seed();
    await applyChannelAutoReply(id);
    expect(mockSend).toHaveBeenCalledTimes(1);
    const { sc } = await riskEvent(id);
    expect(sc).toMatchObject({ v: "-", ev: "availability_unconfirmed", d: "early_checkin/none" });
  });

  it("`AI_STAY_POLICY=enforce`: aynı durum taslağa düşer (gerekçe `availability_unconfirmed`)", async () => {
    vi.stubEnv("AI_STAY_POLICY", "enforce");
    mockSuggest.mockResolvedValue({ ...BASE, stayChange: { asked: "early_checkin", stance: "none" } });
    const id = await seed();
    await applyChannelAutoReply(id);
    expect(mockSend).not.toHaveBeenCalled();
    expect((await riskEvent(id)).ev.reason).toBe("availability_unconfirmed");
  });

  it("🚨 bekçi açıkken: beyansız izni ikinci model yakalar; tek çağrı, kanıtta hüküm kodları", async () => {
    vi.stubEnv("AI_STAY_GUARD_ENABLED", "1");
    const f = guardFetch(GUARD_GRANTS);
    vi.stubGlobal("fetch", f);
    mockSuggest.mockResolvedValue({ ...BASE, reply: "Sure, see you at 11." });
    const id = await seed();
    await applyChannelAutoReply(id);
    expect(f).toHaveBeenCalledTimes(1);
    expect(mockSend).not.toHaveBeenCalled();
    const { ev, sc } = await riskEvent(id);
    expect(ev.reason).toBe("availability_claim");
    expect(sc).toMatchObject({ v: "availability_claim", g: "ok", gv: "qat" });
  });

  it("bekçi düştü + modelin konaklama sinyali YOK → eski davranış (gider), kanıtta 'failed'", async () => {
    vi.stubEnv("AI_STAY_GUARD_ENABLED", "1");
    vi.stubGlobal("fetch", guardFetch(null, 500));
    mockSuggest.mockResolvedValue({ ...BASE, stayChange: { asked: "none", stance: "none" } });
    const id = await seed();
    await applyChannelAutoReply(id);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect((await riskEvent(id)).sc).toMatchObject({ g: "failed", v: "-" });
  });

  it("bekçi düştü + model konaklama isteği beyan etti → gölge kipte BİLE tutulur (hakem yok, temkin)", async () => {
    vi.stubEnv("AI_STAY_GUARD_ENABLED", "1");
    vi.stubGlobal("fetch", guardFetch(null, 500));
    mockSuggest.mockResolvedValue({ ...BASE, stayChange: { asked: "early_checkin", stance: "none" } });
    const id = await seed();
    await applyChannelAutoReply(id);
    expect(mockSend).not.toHaveBeenCalled();
    expect((await riskEvent(id)).ev.reason).toBe("availability_unconfirmed");
  });

  it("🚨 gerekçe kapının İLK düşen kontrolüdür: çıktı vetosu kapattıysa müsaitlik kodu YAZILMAZ (kanıt yine politikayı ölçer)", async () => {
    // Doldurulmamış yer tutucu → çıktı vetosu müsaitlik kontrolünden ÖNCE kapatır.
    mockSuggest.mockResolvedValue({
      ...BASE,
      reply: "Sure, see you at 11. The door code is [DOOR CODE].",
      stayChange: { asked: "early_checkin", stance: "grants" },
    });
    const id = await seed();
    await applyChannelAutoReply(id);
    expect(mockSend).not.toHaveBeenCalled();
    const { ev, sc } = await riskEvent(id);
    expect(ev.finalDecision).toBe("human_review");
    expect(ev.reason).toBe("low_confidence_or_risky");
    expect(sc).toMatchObject({ v: "availability_claim", d: "early_checkin/grants" });
  });

  it("aynı ilk-kontrol kuralı model arızasında da: kaynak `fallback` → müsaitlik satırına SAYILMAZ", async () => {
    mockSuggest.mockResolvedValue({
      ...BASE,
      source: "fallback" as never,
      reply: "Sure, see you at 11.",
      stayChange: { asked: "early_checkin", stance: "grants" },
    });
    const id = await seed();
    await applyChannelAutoReply(id);
    expect(mockSend).not.toHaveBeenCalled();
    expect((await riskEvent(id)).ev.reason).toBe("low_confidence_or_risky");
  });

  it("🚨 anlama katmanı açıkken (legacy retrieval = sorgu gerekmez): katman PARALEL koşar, kapıdan önce beklenir, sinyali kanıta girer; gölge kipte karar vermez", async () => {
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    const f = semanticFetch({ guest_message_understanding: NLU_EARLY });
    vi.stubGlobal("fetch", f);
    mockSuggest.mockResolvedValue(BASE);
    const id = await seed();
    await applyChannelAutoReply(id);
    expect(schemasCalled(f)).toEqual(["guest_message_understanding"]);
    expect(mockSend).toHaveBeenCalledTimes(1);
    const { ev, sc } = await riskEvent(id);
    expect(ev.finalDecision).toBe("auto_sent");
    expect(sc).toMatchObject({ v: "-", ev: "availability_unconfirmed", u: "req", g: "off" });
  });

  it("anlama katmanı + `AI_STAY_POLICY=enforce`: modelin anladığı standart-dışı saat isteği taslağa düşer", async () => {
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubEnv("AI_STAY_POLICY", "enforce");
    vi.stubGlobal("fetch", semanticFetch({ guest_message_understanding: NLU_EARLY }));
    mockSuggest.mockResolvedValue(BASE);
    const id = await seed();
    await applyChannelAutoReply(id);
    expect(mockSend).not.toHaveBeenCalled();
    expect((await riskEvent(id)).ev.reason).toBe("availability_unconfirmed");
  });

  it("aşırı-uygulama kontrolü: anlama katmanı istek GÖRMEDİYSE (standart saat sorusu) enforce kipinde de gider", async () => {
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubEnv("AI_STAY_POLICY", "enforce");
    vi.stubGlobal(
      "fetch",
      semanticFetch({
        guest_message_understanding: {
          language: "en",
          requests: [{ intent: "checkin_time", query_tr: "giriş saati", query_original: "check-in time" }],
          stay_change: { requested: false, kind: "none", checkin_time: null, checkout_time: null },
        },
      }),
    );
    mockSuggest.mockResolvedValue({ ...BASE, stayChange: { asked: "none", stance: "none" } });
    const id = await seed();
    await applyChannelAutoReply(id);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect((await riskEvent(id)).sc).toMatchObject({ v: "-", ev: "-", u: "none" });
  });

  it("anlama katmanı DÜŞTÜ → politika onsuz karar verir (u 'off'), gönderim eski davranışta", async () => {
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("upstream down", { status: 503 })));
    mockSuggest.mockResolvedValue(BASE);
    const id = await seed();
    await applyChannelAutoReply(id);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect((await riskEvent(id)).sc).toMatchObject({ v: "-", u: "off" });
  });

  it("bekçi + anlama birlikte: iki ayrı şema çağrısı; bekçinin izni gölge kipte BİLE durdurur", async () => {
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubEnv("AI_STAY_GUARD_ENABLED", "1");
    const f = semanticFetch({ guest_message_understanding: NLU_EARLY, stay_change_guard: GUARD_GRANTS });
    vi.stubGlobal("fetch", f);
    mockSuggest.mockResolvedValue({ ...BASE, reply: "Sure, see you at 11." });
    const id = await seed();
    await applyChannelAutoReply(id);
    expect([...schemasCalled(f)].sort()).toEqual(["guest_message_understanding", "stay_change_guard"]);
    expect(mockSend).not.toHaveBeenCalled();
    expect((await riskEvent(id)).sc).toMatchObject({ v: "availability_claim", g: "ok", u: "req" });
  });

  it("🚨 ev sahibinin teklif metni kanal kapısına ULAŞIR: aynen aktarıp erteleyen cevap gider; teklif tanımlı değilse aynı cevap iddiadır", async () => {
    const offer = "Müsaitlik varsa çıkışınızı 13:00'e kadar uzatabiliriz.";
    const relay = `${offer} Uygunluğu ev sahibinizin kararıdır; mesajınız kaydedildi.`;
    const late = { ...BASE, intent: "late_checkout", reply: relay, stayChange: { asked: "late_checkout" as const, stance: "defers" as const } };
    const ask = [{ direction: "inbound" as const, body: "Geç çıkış mümkün mü?" }];

    mockSuggest.mockResolvedValue(late);
    const withOffer = await seed({ offer, messages: ask });
    await applyChannelAutoReply(withOffer);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect((await riskEvent(withOffer)).sc).toMatchObject({ v: "-", lx: "rd" });

    // KONTROL (anti-vakum): teklif tanımlı olmayan org'da aynı metin ev sahibinin sözü DEĞİL → iddia.
    await resetDb();
    mockSend.mockClear();
    const noOffer = await seed({ messages: ask });
    await applyChannelAutoReply(noOffer);
    expect(mockSend).not.toHaveBeenCalled();
    expect((await riskEvent(noOffer)).ev.reason).toBe("availability_claim");
  });

  it("🚨 bekçi isteği: cevapsızlardan ÖNCEKİ konuşma + ev sahibi teklifi + adların redaksiyonu (girdi bağlantısı davranışsal)", async () => {
    vi.stubEnv("AI_STAY_GUARD_ENABLED", "1");
    const f = semanticFetch({ stay_change_guard: { ...GUARD_GRANTS, reply_grants_change: false, reply_defers_to_host: true } });
    vi.stubGlobal("fetch", f);
    mockSuggest.mockResolvedValue({
      ...BASE,
      reply: "Early check-in is up to your host; your message has been recorded and your host can see it.",
      stayChange: { asked: "early_checkin", stance: "defers" },
    });
    const id = await seed({
      offer: "Erken giriş 12:00'den itibaren ücretli olabilir.",
      messages: [
        { direction: "inbound", body: "Hi, Alex here. We land at 8am." },
        { direction: "outbound", body: "Welcome! Check-in is from 15:00." },
        { direction: "inbound", body: ASK },
      ],
    });
    await applyChannelAutoReply(id);
    expect(schemasCalled(f)).toEqual(["stay_change_guard"]);
    const user = JSON.parse(String((f.mock.calls[0][1] as RequestInit).body)).messages[1].content as string;
    expect(user).toContain("HOST'S STANDING OFFER (written by the host): <<<Erken giriş 12:00'den itibaren ücretli olabilir.>>>");
    expect(user).toContain("EARLIER CONVERSATION (context only, oldest first):");
    expect(user).toContain("Host: <<<Welcome! Check-in is from 15:00.>>>");
    expect(user).toContain("[1] <<<Could we get into the flat at 11?>>>");
    // Cevaplanmış eski mesaj CEVAPSIZ listesine girmez; misafirin görünen adı modele gitmez.
    expect(user.slice(user.indexOf("GUEST MESSAGES"))).not.toContain("We land at 8am");
    expect(user).not.toContain("Alex");
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("bekçi YALNIZ aday için koşar: kapı başka sebeple kapandıysa model çağrılmaz", async () => {
    vi.stubEnv("AI_STAY_GUARD_ENABLED", "1");
    const f = guardFetch(GUARD_GRANTS);
    vi.stubGlobal("fetch", f);
    mockSuggest.mockResolvedValue({ ...BASE, confidence: 0.5 });
    const id = await seed();
    await applyChannelAutoReply(id);
    expect(f).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
    expect((await riskEvent(id)).sc).toMatchObject({ g: "off" });
  });
});
