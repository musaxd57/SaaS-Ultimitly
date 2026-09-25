import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// ANLAM KATMANI — KANAL OTO-YANITI UÇTAN UCA (09-24; cevap modeli MOCK, DB gerçek, bekçi çağrısı
// sahte fetch). Pinlenen: şema beyanı kapıya ULAŞIR, bekçi yalnız ADAY için koşar, karar kaydı
// kapıyla AYNI politikadan gerekçe + `sc` kanıtı taşır; hiçbir katmanın "istek yok"u başka bir katmanın
// isteğini silemez (birleşim değişmezi 09-24 — gölge kip YOK).
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
import { emailService } from "@/lib/email";
import { applyChannelAutoReply } from "@/lib/automation";
import { __resetUnderstandingCache } from "@/lib/ai/semantic/understand";

const mockSuggest = vi.mocked(suggestReply);
const mockSend = vi.mocked(sendOnChannel);
const mockMail = vi.mocked(emailService.sendReporting);

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

async function seed(opts: { offer?: string; messages?: { direction: "inbound" | "outbound"; body: string }[]; kb?: number } = {}) {
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
  if (opts.kb) {
    await prisma.knowledgeBaseItem.createMany({
      data: Array.from({ length: opts.kb }, (_, i) => ({
        propertyId: property.id,
        category: "general",
        title: `Bilgi ${i}`,
        content: `Konu ${i} hakkında ev bilgisi: ayrıntılar ev kılavuzunda.`,
        reviewState: "approved",
        source: "host_manual",
      })),
    });
  }
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

/** Hassas OLMAYAN bilgi sorusu + tutarlı beyan (niyet `checkin`, "istek yok"). */
const INFO = { ...BASE, intent: "checkin", stayChange: { asked: "none" as const, stance: "none" as const } };
const INFO_ASK = [{ direction: "inbound" as const, body: "What time is check-in?" }];

/** Bekçi: "istek yok, iddia yok" (her alan false/null). */
const GUARD_CLEAN = {
  guest_requests_change: false,
  kind: "none",
  requested_checkin_time: null,
  requested_checkout_time: null,
  reply_states_calendar: false,
  reply_grants_change: false,
  reply_defers_to_host: false,
  reply_refuses: false,
  reply_amounts: [],
  reply_price_terms: false,
};

const GUARD_GRANTS = {
  guest_requests_change: true,
  kind: "early_checkin",
  requested_checkin_time: "11:00",
  requested_checkout_time: null,
  reply_states_calendar: false,
  reply_grants_change: true,
  reply_defers_to_host: false,
  reply_refuses: false,
  reply_amounts: [],
  reply_price_terms: false,
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

  it("🚨 beyan YOK + kelime ağı sessiz + niyet erken giriş → GİTMEZ (09-24'e kadar bu satır 'gider' KONTROLÜYDÜ); kanıtta 'absent' + `ri`", async () => {
    mockSuggest.mockResolvedValue(BASE);
    const id = await seed();
    await applyChannelAutoReply(id);
    expect(mockSend).not.toHaveBeenCalled();
    const { ev, sc } = await riskEvent(id);
    expect(ev.finalDecision).toBe("human_review");
    expect(ev.reason).toBe("availability_claim");
    expect(sc).toEqual({ v: "availability_claim", ev: "availability_claim", lx: "-", d: "absent", g: "off", u: "off", ri: "early_checkin" });
  });

  it("KONTROL (aşırı-uygulama): hassas olmayan bilgi sorusu + tutarlı beyan, bekçi YOK → gider", async () => {
    mockSuggest.mockResolvedValue(INFO);
    const id = await seed({ messages: INFO_ASK });
    await applyChannelAutoReply(id);
    expect(mockSend).toHaveBeenCalledTimes(1);
    const { ev, sc } = await riskEvent(id);
    expect(ev.finalDecision).toBe("auto_sent");
    expect(sc).toEqual({ v: "-", ev: "-", lx: "-", d: "none/none", g: "off", u: "off" });
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

  it("🚨 bekçi YOKKEN beyan edilen İSTEK tutulur (hassas istek + doğrulayıcı yok)", async () => {
    mockSuggest.mockResolvedValue({ ...BASE, stayChange: { asked: "early_checkin", stance: "none" } });
    const id = await seed();
    await applyChannelAutoReply(id);
    expect(mockSend).not.toHaveBeenCalled();
    const { ev, sc } = await riskEvent(id);
    expect(ev.reason).toBe("availability_unconfirmed");
    expect(sc).toMatchObject({ v: "availability_unconfirmed", ev: "availability_unconfirmed", d: "early_checkin/none", g: "off" });
  });

  it("🚨 bekçi KOŞTU ve 'istek yok' dedi ama beyan istek görüyor → tutulur (P1-1); yalnız niyet etiketi görse de tutulur (birleşim değişmezi)", async () => {
    vi.stubEnv("AI_STAY_GUARD_ENABLED", "1");
    const f = semanticFetch({ stay_change_guard: GUARD_CLEAN });
    vi.stubGlobal("fetch", f);
    mockSuggest.mockResolvedValue({ ...BASE, stayChange: { asked: "early_checkin", stance: "none" } });
    const id = await seed();
    await applyChannelAutoReply(id);
    expect(schemasCalled(f)).toEqual(["stay_change_guard"]);
    expect(mockSend).not.toHaveBeenCalled();
    expect((await riskEvent(id)).sc).toMatchObject({ v: "availability_unconfirmed", d: "early_checkin/none", g: "ok" });

    // Yalnız niyet etiketi (beyan "istek yok", bekçi "istek yok"): 09-24 üçüncü tura kadar gölge kipte GİDİYORDU.
    // 🚨 Eski `AI_STAY_POLICY` anahtarı artık okunmaz: "shadow" yazılı olsa da etiketin isteği silinmez.
    vi.stubEnv("AI_STAY_POLICY", "shadow");
    await resetDb();
    mockSend.mockClear();
    mockSuggest.mockResolvedValue({ ...BASE, stayChange: { asked: "none", stance: "none" } });
    const id2 = await seed();
    await applyChannelAutoReply(id2);
    expect(mockSend).not.toHaveBeenCalled();
    const second = await riskEvent(id2);
    expect(second.ev.reason).toBe("availability_unconfirmed");
    expect(second.sc).toMatchObject({ v: "availability_unconfirmed", ev: "availability_unconfirmed", d: "none/none", g: "ok", ri: "early_checkin" });
  });

  it("🚨 bekçi açıkken: beyanın ('erteliyor') kaçırdığı izni ikinci model yakalar; tek çağrı, kanıtta hüküm kodları", async () => {
    vi.stubEnv("AI_STAY_GUARD_ENABLED", "1");
    const f = guardFetch(GUARD_GRANTS);
    vi.stubGlobal("fetch", f);
    mockSuggest.mockResolvedValue({ ...BASE, reply: "Sure, see you at 11.", stayChange: { asked: "early_checkin", stance: "defers" } });
    const id = await seed();
    await applyChannelAutoReply(id);
    expect(f).toHaveBeenCalledTimes(1);
    expect(mockSend).not.toHaveBeenCalled();
    const { ev, sc } = await riskEvent(id);
    expect(ev.reason).toBe("availability_claim");
    expect(sc).toMatchObject({ v: "availability_claim", g: "ok", gv: "qat" });
  });

  it("bekçi düştü + HİÇBİR katmanda hassas istek yok (bilgi sorusu) → gider, kanıtta 'failed' — her arızada her mesaj durmaz", async () => {
    vi.stubEnv("AI_STAY_GUARD_ENABLED", "1");
    vi.stubGlobal("fetch", guardFetch(null, 500));
    mockSuggest.mockResolvedValue(INFO);
    const id = await seed({ messages: INFO_ASK });
    await applyChannelAutoReply(id);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect((await riskEvent(id)).sc).toMatchObject({ g: "failed", v: "-" });
  });

  it("bekçi düştü + model konaklama isteği beyan etti → tutulur (hakem yok, temkin)", async () => {
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

  it("🚨 anlama katmanı açıkken (legacy retrieval = sorgu gerekmez): katman PARALEL koşar, kapıdan önce beklenir, sinyali kanıta girer; bekçi yokken isteği tutar", async () => {
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    const f = semanticFetch({ guest_message_understanding: NLU_EARLY });
    vi.stubGlobal("fetch", f);
    // Cevap modeli isteği KAÇIRDI (niyet genel, "istek yok"): hassas isteği yalnız anlama katmanı görüyor.
    mockSuggest.mockResolvedValue({ ...BASE, intent: "general", stayChange: { asked: "none", stance: "none" } });
    const id = await seed();
    await applyChannelAutoReply(id);
    expect(schemasCalled(f)).toEqual(["guest_message_understanding"]);
    expect(mockSend).not.toHaveBeenCalled();
    const { ev, sc } = await riskEvent(id);
    expect(ev.reason).toBe("availability_unconfirmed");
    expect(sc).toMatchObject({ v: "availability_unconfirmed", ev: "availability_unconfirmed", u: "req", g: "off" });
  });

  it("🚨 anlama + bekçi (bekçi istek görmedi): anlama katmanının isteği silinmez — tutulur (P1-1)", async () => {
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubEnv("AI_STAY_GUARD_ENABLED", "1");
    const f = semanticFetch({ guest_message_understanding: NLU_EARLY, stay_change_guard: GUARD_CLEAN });
    vi.stubGlobal("fetch", f);
    mockSuggest.mockResolvedValue({ ...BASE, intent: "general", stayChange: { asked: "none", stance: "none" } });
    const id = await seed();
    await applyChannelAutoReply(id);
    expect([...schemasCalled(f)].sort()).toEqual(["guest_message_understanding", "stay_change_guard"]);
    expect(mockSend).not.toHaveBeenCalled();
    expect((await riskEvent(id)).sc).toMatchObject({ v: "availability_unconfirmed", u: "req", g: "ok" });
  });

  it("aşırı-uygulama kontrolü: anlama katmanı istek GÖRMEDİYSE (standart saat sorusu) gider", async () => {
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
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
    mockSuggest.mockResolvedValue(INFO);
    const id = await seed({ messages: INFO_ASK });
    await applyChannelAutoReply(id);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect((await riskEvent(id)).sc).toMatchObject({ v: "-", ev: "-", u: "none" });
  });

  it("anlama katmanı DÜŞTÜ → politika onsuz karar verir, gönderim eski davranışta; kanıtta 'failed' ('off'tan AYRI)", async () => {
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("upstream down", { status: 503 })));
    mockSuggest.mockResolvedValue(INFO);
    const id = await seed({ messages: INFO_ASK });
    await applyChannelAutoReply(id);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect((await riskEvent(id)).sc).toMatchObject({ v: "-", u: "failed" });
  });

  it("🚨 bekçi müsaitlik onayı eksik diye TUTULAN taslakta da koşar: iki model ertelemeyi tanırsa (kelime ağı tanımasa da) gider", async () => {
    vi.stubEnv("AI_STAY_GUARD_ENABLED", "1");
    // Almanca yazan misafire Almanca erteleme (kelime ağı tanımıyor; dil kapısı 09-25 ayrı ölçülür).
    const ask = [{ direction: "inbound" as const, body: "Können wir noch eine Nacht bleiben?" }];
    const reply = { ...BASE, intent: "extend_stay", reply: "Das muss Ihr Gastgeber entscheiden.", stayChange: { asked: "extend" as const, stance: "defers" as const } };
    const verdict = (defers: boolean) => ({
      guest_requests_change: true,
      kind: "extend",
      requested_checkin_time: null,
      requested_checkout_time: null,
      reply_states_calendar: false,
      reply_grants_change: false,
      reply_defers_to_host: defers,
      reply_refuses: false,
      reply_amounts: [],
      reply_price_terms: false,
    });
    const f = semanticFetch({ stay_change_guard: verdict(true) });
    vi.stubGlobal("fetch", f);
    mockSuggest.mockResolvedValue(reply);
    const id = await seed({ messages: ask });
    await applyChannelAutoReply(id);
    expect(schemasCalled(f)).toEqual(["stay_change_guard"]);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect((await riskEvent(id)).sc).toMatchObject({ v: "-", g: "ok", gv: "qd" });

    // KONTROL: bekçi ertelemeyi TANIMAZSA tutuş kalır (tek model gevşetemez).
    await resetDb();
    mockSend.mockClear();
    vi.stubGlobal("fetch", semanticFetch({ stay_change_guard: verdict(false) }));
    const held = await seed({ messages: ask });
    await applyChannelAutoReply(held);
    expect(mockSend).not.toHaveBeenCalled();
    expect((await riskEvent(held)).ev.reason).toBe("availability_unconfirmed");
  });

  it("🚨 anlama katmanı PARALEL koştuğunda (küçük KB, hibrit) özeti yine karar kaydına girer; sorgu eklenmez", async () => {
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubEnv("KB_RETRIEVAL_MODE", "hybrid");
    vi.stubGlobal("fetch", semanticFetch({ guest_message_understanding: NLU_EARLY }));
    mockSuggest.mockResolvedValue(BASE);
    const id = await seed({ kb: 3 });
    await applyChannelAutoReply(id);
    const ev = await prisma.riskEvent.findFirstOrThrow({ where: { conversationId: id, surface: "auto_reply" } });
    const retrieval = (JSON.parse(String(ev.kbEvidenceJson)) as { retrieval?: Record<string, unknown> }).retrieval;
    expect(retrieval).toMatchObject({ fb: "small_kb", un: "ok", ui: ["early_checkin"] });
    expect(retrieval).not.toHaveProperty("uq");
  });

  it("anlama katmanı büyük KB'de retrieval'a sorgu ekler (beklenir) ve kanıtta `uq` görünür", async () => {
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubEnv("KB_RETRIEVAL_MODE", "hybrid");
    vi.stubGlobal("fetch", semanticFetch({ guest_message_understanding: NLU_EARLY }));
    mockSuggest.mockResolvedValue(BASE);
    const id = await seed({ kb: 35 });
    await applyChannelAutoReply(id);
    const ev = await prisma.riskEvent.findFirstOrThrow({ where: { conversationId: id, surface: "auto_reply" } });
    const retrieval = (JSON.parse(String(ev.kbEvidenceJson)) as { retrieval?: Record<string, number | string> }).retrieval;
    expect(retrieval).toMatchObject({ un: "ok" });
    expect(Number(retrieval?.uq)).toBeGreaterThanOrEqual(1);
  });

  it("bekçi + anlama birlikte: iki ayrı şema çağrısı; bekçinin izni durdurur", async () => {
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubEnv("AI_STAY_GUARD_ENABLED", "1");
    const f = semanticFetch({ guest_message_understanding: NLU_EARLY, stay_change_guard: GUARD_GRANTS });
    vi.stubGlobal("fetch", f);
    mockSuggest.mockResolvedValue({ ...BASE, reply: "Sure, see you at 11.", stayChange: { asked: "early_checkin", stance: "defers" } });
    const id = await seed();
    await applyChannelAutoReply(id);
    expect([...schemasCalled(f)].sort()).toEqual(["guest_message_understanding", "stay_change_guard"]);
    expect(mockSend).not.toHaveBeenCalled();
    expect((await riskEvent(id)).sc).toMatchObject({ v: "availability_claim", g: "ok", u: "req" });
  });

  it("🚨 ev sahibinin teklif metni kanal kapısına ULAŞIR: aynen aktarıp erteleyen cevap (iki model) gider; teklif tanımlı değilse aynı cevap iddiadır", async () => {
    const offer = "Müsaitlik varsa çıkışınızı 13:00'e kadar uzatabiliriz.";
    const relay = `${offer} Uygunluğu ev sahibinizin kararıdır; mesajınız kaydedildi.`;
    const late = { ...BASE, intent: "late_checkout", reply: relay, stayChange: { asked: "late_checkout" as const, stance: "defers" as const } };
    const ask = [{ direction: "inbound" as const, body: "Geç çıkış mümkün mü?" }];
    vi.stubEnv("AI_STAY_GUARD_ENABLED", "1");
    vi.stubGlobal(
      "fetch",
      semanticFetch({ stay_change_guard: { ...GUARD_CLEAN, guest_requests_change: true, kind: "late_checkout", reply_defers_to_host: true } }),
    );

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

  // ── Anlama katmanının RİSK NİYETİ (09-24, `semantic/intent-risk.ts`) ──────────────────────────────
  /** Kelime ağının KAÇIRDIĞI şikâyet (ölçüldü: `classifyFallback` + `detectRiskType` engellemiyor). */
  const ANTS = [{ direction: "inbound" as const, body: "There are ants all over the kitchen counter." }];
  const NLU_COMPLAINT = {
    language: "en",
    requests: [{ intent: "complaint_issue", query_tr: "mutfakta karınca", query_original: "ants in the kitchen" }],
    stay_change: { requested: false, kind: "none", checkin_time: null, checkout_time: null },
  };
  const THANKS = { ...BASE, intent: "general", reply: "Thank you for letting us know.", usedSources: [] as string[] };
  const irOf = async (conversationId: string) =>
    (JSON.parse(String((await prisma.riskEvent.findFirstOrThrow({ where: { conversationId, surface: "auto_reply" } })).kbEvidenceJson)) as {
      ir?: Record<string, string>;
    }).ir;

  it("KONTROL: katman KAPALI → şikâyeti kelime ağı görmüyor, cevap GİDER; kanıtta `ir` alanı HİÇ yok", async () => {
    mockSuggest.mockResolvedValue(THANKS);
    const id = await seed({ messages: ANTS });
    await applyChannelAutoReply(id);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(await irOf(id)).toBeUndefined();
  });

  it("🚨 risk niyeti kanal kapısına ULAŞIR: taslak + acil yükseltme; eski `AI_INTENT_POLICY=shadow` artık okunmaz (birleşim değişmezi)", async () => {
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubEnv("AI_INTENT_POLICY", "shadow"); // 09-24'e kadar bu değer gönderime izin veriyordu
    vi.stubGlobal("fetch", semanticFetch({ guest_message_understanding: NLU_COMPLAINT }));
    mockSuggest.mockResolvedValue(THANKS);
    const id2 = await seed({ messages: ANTS });
    await prisma.organization.updateMany({ data: { alertEmail: "host@example.com" } });
    await applyChannelAutoReply(id2);
    expect(mockSend).not.toHaveBeenCalled();
    const ev = await prisma.riskEvent.findFirstOrThrow({ where: { conversationId: id2, surface: "auto_reply" } });
    expect(ev.finalDecision).toBe("human_review");
    expect(ev.reason).toBe("understanding_risk");
    expect(ev.riskType).toBe("complaint"); // cevap modeli ve kelime ağı etiket vermedi → niyetin etiketi
    expect(await irOf(id2)).toEqual({ v: "understanding_risk", ev: "understanding_risk", k: "complaint_issue" });
    // 🚨 Kurucu "sen seç" (09-24) → EVET: yalnız anlama katmanının gördüğü şikâyet de acil yükseltmeye gider.
    const conv = await prisma.conversation.findUniqueOrThrow({ where: { id: id2 } });
    expect(conv).toMatchObject({ status: "problem", priority: "urgent", skippedReason: "escalated_to_human", lastRiskType: "complaint" });
    expect(mockMail).toHaveBeenCalledTimes(1);
    expect(mockMail.mock.calls[0][0]).toBe("host@example.com");
  });

  it("🚨 P2-4: anlama katmanının hassas niyeti, kapıyı ÖNCE başka bir kontrol (düşük güven) kapatsa da acil yükseltmeyi tetikler; devir cevabında rozet acil durum", async () => {
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    const emergency = {
      language: "en",
      requests: [{ intent: "emergency", query_tr: "en yakın hastane", query_original: "nearest hospital" }],
      stay_change: { requested: false, kind: "none", checkin_time: null, checkout_time: null },
    };
    vi.stubGlobal("fetch", semanticFetch({ guest_message_understanding: emergency }));
    const MSG = [{ direction: "inbound" as const, body: "My daughter cut her hand badly, where is the nearest hospital?" }];
    // Düşük güven: kapının İLK düşen kontrolü "blocked" — eskiden yükseltme hiç tetiklenmiyordu (sessiz taslak).
    mockSuggest.mockResolvedValue({ ...THANKS, confidence: 0.6, reply: "The nearest hospital is 2 km away." });
    const id = await seed({ messages: MSG });
    await prisma.organization.updateMany({ data: { alertEmail: "host@example.com" } });
    await applyChannelAutoReply(id);
    expect(mockSend).not.toHaveBeenCalled();
    expect(await prisma.conversation.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "problem", lastRiskType: "safety_emergency" });
    expect(mockMail).toHaveBeenCalledTimes(1);

    // Devir cevabı (model etiketi human_request) + anlama katmanı acil → rozet acil durum (daha ağır olan).
    await resetDb();
    __resetUnderstandingCache();
    mockMail.mockClear();
    mockSuggest.mockResolvedValue({
      ...THANKS,
      intent: "human_request",
      riskType: "human_request",
      riskLevel: "low" as const,
      reply: "Tabii. Mesajınız kaydedildi; ev sahibiniz görebilir.",
    });
    const id2 = await seed({ messages: MSG });
    await prisma.organization.updateMany({ data: { alertEmail: "host@example.com" } });
    await applyChannelAutoReply(id2);
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: id2 } })).lastRiskType).toBe("safety_emergency");
    expect(mockMail).toHaveBeenCalledTimes(1);
  });

  it("🚨 P2-10: insan talebi + model de 'human_request' dedi AMA kapı başka sebeple kapandı (devir GİTMEDİ) → host'a acil yükseltme", async () => {
    // Muafiyet yalnız devir cevabı GERÇEKTEN gönderildiğinde doğrudur; burada düşük güven kapıyı kapattı, misafir
    // insan istedi ve HİÇ cevap almadı. Cevap modeli `riskType` bırakmadı (sık görülen durum) → model yolu sessiz.
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubGlobal(
      "fetch",
      semanticFetch({
        guest_message_understanding: {
          language: "en",
          requests: [{ intent: "human_request", query_tr: "ev sahibiyle görüşme", query_original: "speak with the owner" }],
          stay_change: { requested: false, kind: "none", checkin_time: null, checkout_time: null },
        },
      }),
    );
    mockSuggest.mockResolvedValue({ ...THANKS, intent: "human_request", confidence: 0.5, reply: "Mesajınız kaydedildi; ev sahibiniz görebilir." });
    const id = await seed({ messages: [{ direction: "inbound", body: "Can I speak with the owner directly please?" }] });
    await prisma.organization.updateMany({ data: { alertEmail: "host@example.com" } });
    await applyChannelAutoReply(id);
    expect(mockSend).not.toHaveBeenCalled();
    expect(await prisma.conversation.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "problem", lastRiskType: "human_request" });
    expect(mockMail).toHaveBeenCalledTimes(1);
  });

  it("🚨 P2-9: cevap modeli DÜŞTÜ (şablon) ama bağımsız anlama katmanı acil durum gördü → acil yükseltme", async () => {
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubGlobal(
      "fetch",
      semanticFetch({
        guest_message_understanding: {
          language: "en",
          requests: [{ intent: "emergency", query_tr: "en yakın hastane", query_original: "nearest hospital" }],
          stay_change: { requested: false, kind: "none", checkin_time: null, checkout_time: null },
        },
      }),
    );
    mockSuggest.mockResolvedValue({ ...THANKS, source: "fallback" as never, reply: "Mesajınız alındı." });
    const id = await seed({ messages: [{ direction: "inbound", body: "My daughter cut her hand badly, where is the nearest hospital?" }] });
    await prisma.organization.updateMany({ data: { alertEmail: "host@example.com" } });
    await applyChannelAutoReply(id);
    expect(mockSend).not.toHaveBeenCalled();
    expect(await prisma.conversation.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "problem", lastRiskType: "safety_emergency" });
    expect(mockMail).toHaveBeenCalledTimes(1);
  });

  it("acil durum niyeti: rozet 'safety_emergency'; ikinci geçiş aynı konuşmaya İKİNCİ e-posta atmaz (atomik claim)", async () => {
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubGlobal(
      "fetch",
      semanticFetch({
        guest_message_understanding: {
          language: "en",
          requests: [{ intent: "emergency", query_tr: "en yakın hastane", query_original: "nearest hospital" }],
          stay_change: { requested: false, kind: "none", checkin_time: null, checkout_time: null },
        },
      }),
    );
    mockSuggest.mockResolvedValue({ ...THANKS, reply: "The nearest hospital is 2 km away." });
    const id = await seed({ messages: [{ direction: "inbound", body: "My daughter cut her hand badly, where is the nearest hospital?" }] });
    await prisma.organization.updateMany({ data: { alertEmail: "host@example.com" } });
    await applyChannelAutoReply(id);
    await applyChannelAutoReply(id);
    expect(mockSend).not.toHaveBeenCalled();
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id } })).lastRiskType).toBe("safety_emergency");
    expect(mockMail).toHaveBeenCalledTimes(1);
  });

  it("aşırı-uygulama kontrolü: katman risk niyeti GÖRMEDİYSE gider (kanıtta `-`)", async () => {
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubGlobal(
      "fetch",
      semanticFetch({
        guest_message_understanding: {
          language: "en",
          requests: [{ intent: "amenities", query_tr: "mutfak", query_original: "kitchen" }],
          stay_change: { requested: false, kind: "none", checkin_time: null, checkout_time: null },
        },
      }),
    );
    mockSuggest.mockResolvedValue(THANKS);
    const id = await seed({ messages: ANTS });
    await applyChannelAutoReply(id);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(await irOf(id)).toEqual({ v: "-", ev: "-", k: "-" });
  });
});
