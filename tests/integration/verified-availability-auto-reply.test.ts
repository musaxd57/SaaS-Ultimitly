// ---------------------------------------------------------------------------
// DOĞRULANMIŞ MÜSAİTLİK OTOMATİK CEVABI (kurucu onayı 10-09: "doğrulanınca otomatik gitsin") — uçtan uca, gerçek PostgreSQL.
//
// Zincir: misafir mesajı → kelime ağı "saf müsaitlik" → tarih çözücü → müsaitlik aracı (gerçek takvim kaynağı + rezervasyonlar)
// → KODDAN kurulan tek cümle → kapı (birebir metin muafiyeti; acil / şikâyet / injection / güven AYNEN). Cevap modeli MOCK (taslağı
// misafire GİTMEZ), anlama katmanı sahte fetch, gönderim katmanı sahte. Her "gitmez" iddiasının aynı tohumla "gider" kontrolü var.
// ---------------------------------------------------------------------------
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

vi.mock("@/lib/ai", () => ({ suggestReply: vi.fn(), classifyMessage: vi.fn(), summarizeHostStyle: vi.fn() }));
vi.mock("@/lib/messaging", async (orig) => ({
  ...(await orig<typeof import("@/lib/messaging")>()),
  sendOnChannel: vi.fn(),
}));
vi.mock("@/lib/hospitable-credentials", () => ({ getOrgHospitableToken: vi.fn().mockResolvedValue("test-token") }));
vi.mock("@/lib/email", () => ({ emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) } }));
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn().mockResolvedValue(undefined) };
});

import { suggestReply } from "@/lib/ai";
import { sendOnChannel } from "@/lib/messaging";
import { applyChannelAutoReply } from "@/lib/automation";
import { __resetUnderstandingCache } from "@/lib/ai/semantic/understand";
import { todayKey, addNights } from "@/modules/availability/core";

const mockSuggest = vi.mocked(suggestReply);
const mockSend = vi.mocked(sendOnChannel);
const TZ = "Europe/Istanbul";
const TR_MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

// Gerçek saate göre 20 ve 22 gün sonrası (Türkçe ay adıyla; tarih çözücü yılı en yakın gelecek olarak tamamlar).
const TODAY = todayKey(new Date(), TZ);
const D1 = addNights(TODAY, 20);
const D2 = addNights(D1, 2);
const human = (k: string) => `${Number(k.slice(8, 10))} ${TR_MONTHS[Number(k.slice(5, 7)) - 1]}${k.slice(0, 4) === TODAY.slice(0, 4) ? "" : ` ${k.slice(0, 4)}`}`;
const ASK = `Merhaba, ${human(D1)} ile ${human(D2)} arası daire müsait mi?`;
const CODE_AVAILABLE = `${human(D1)} giriş, ${human(D2)} çıkış için daire müsait.`;
const CODE_UNAVAILABLE = `Maalesef ${human(D1)} giriş, ${human(D2)} çıkış için daire müsait değil.`;
const MODEL_DRAFT = "Tarihleri ev sahibimize iletiyorum, size dönüş yapacağız.";

const verdict = {
  intent: "general",
  confidence: 0.95,
  reply: MODEL_DRAFT,
  risk: null,
  priority: "standard" as const,
  source: "openai" as const,
  actionSuggestion: null,
  riskLevel: "low",
  detectedLanguage: "tr",
  riskType: null as string | null,
  usedSources: [] as string[],
  missingInfo: [] as string[],
  statedCheckoutTime: null,
  stayChange: { asked: "availability", stance: "states_calendar" },
};

let guardKind = "availability";

function understandingFetch(kind: "availability" | "extend" | "none", intents: string[] = [kind === "extend" ? "extend_stay" : "availability"], language = "tr") {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const name = JSON.parse(String(init?.body)).response_format?.json_schema?.name as string;
    if (name === "stay_change_guard") {
      // Bağımsız bekçi (Haiku 10-09): "belirli tarihler boş mu" → istek + tür availability (testin kendi `guardKind`ı ile).
      const content = JSON.stringify({
        guest_requests_change: guardKind !== "none",
        kind: guardKind,
        requested_checkin_time: null,
        requested_checkout_time: null,
        reply_states_calendar: true,
        reply_grants_change: false,
        reply_defers_to_host: false,
        reply_refuses: false,
        reply_price_terms: false,
        reply_amounts: [],
      });
      return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content } }] }), { status: 200 });
    }
    if (name !== "guest_message_understanding") throw new Error(`beklenmeyen şema: ${name}`);
    const v = {
      language,
      requests: intents.map((intent) => ({ intent, query_tr: "soru", query_original: "soru" })),
      stay_change: { requested: kind !== "none", kind, checkin_time: null, checkout_time: null },
    };
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(v) } }] }), { status: 200 });
  });
}

async function seed(opts: { message?: string; feedAgeHours?: number; booked?: "full" | "partial" } = {}) {
  const org = await prisma.organization.create({
    data: { name: "Müsaitlik Org", autoReplyHospitable: true, autoReplyStartHour: 0, autoReplyEndHour: 0, timezone: TZ },
  });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Deniz Daire" } });
  await prisma.calendarSource.create({
    data: {
      propertyId: property.id,
      label: "Airbnb",
      url: "https://example.com/cal.ics",
      lastStatus: "ok",
      lastSyncedAt: new Date(Date.now() - (opts.feedAgeHours ?? 1) * 3_600_000),
    },
  });
  if (opts.booked) {
    await prisma.reservation.create({
      data: {
        propertyId: property.id,
        guestName: "Başka Misafir",
        arrivalDate: new Date(`${D1}T00:00:00Z`),
        departureDate: new Date(`${opts.booked === "full" ? D2 : addNights(D1, 1)}T00:00:00Z`),
        channel: "manual",
        status: "confirmed",
      },
    });
  }
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      guestIdentifier: "Aday Misafir",
      channel: "airbnb",
      status: "new",
      externalReservationId: "inq-avail-1",
      lastMessageAt: new Date(),
      messages: { create: { direction: "inbound", senderName: "Aday Misafir", body: opts.message ?? ASK } },
    },
  });
  return { conversationId: conversation.id };
}

// Gönderilen gövde: kod metni + (org ayarı açıkken) otomatik yanıt açıklama notu — modelin taslağı ASLA.
const sentBody = () => (mockSend.mock.calls[0]?.[1] as string | undefined) ?? null;
const expectCodeSent = (code: string) => {
  const body = sentBody() ?? "";
  expect(body.split("\n")[0]).toBe(code);
  expect(body).not.toContain(MODEL_DRAFT);
};

describe("doğrulanmış müsaitlik otomatik cevabı — koddan kurulan metin", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    __resetUnderstandingCache();
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("KB_RETRIEVAL_MODE", "legacy");
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubEnv("AI_VERIFIED_AVAILABILITY_ENABLED", "1");
    vi.stubEnv("AI_STAY_GUARD_ENABLED", "1");
    guardKind = "availability";
    vi.stubGlobal("fetch", understandingFetch("availability"));
    mockSend.mockResolvedValue({ ok: true } as never);
    mockSuggest.mockResolvedValue(verdict as never);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("🚨 taze takvim + boş geceler → KOD METNİ gider (modelin taslağı değil)", async () => {
    const { conversationId } = await seed();
    const r = await applyChannelAutoReply(conversationId);
    expect(r.sent).toBe(true);
    expectCodeSent(CODE_AVAILABLE);
  });

  it("KONTROL: anahtar KAPALI → hiçbir şey gitmez (bugünkü davranış)", async () => {
    vi.stubEnv("AI_VERIFIED_AVAILABILITY_ENABLED", "");
    const { conversationId } = await seed();
    const r = await applyChannelAutoReply(conversationId);
    expect(r.sent).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("bütün geceler dolu → 'müsait değil' kod metni gider", async () => {
    const { conversationId } = await seed({ booked: "full" });
    expect((await applyChannelAutoReply(conversationId)).sent).toBe(true);
    expectCodeSent(CODE_UNAVAILABLE);
  });

  it("🚨 KISMEN dolu aralık → gitmez (hangi gecenin dolu olduğu ev sahibinde)", async () => {
    const { conversationId } = await seed({ booked: "partial" });
    expect((await applyChannelAutoReply(conversationId)).sent).toBe(false);
  });

  it("🚨 BEKÇİ kapalı ya da tarih sorusu görmüyor → gitmez (Haiku 10-09)", async () => {
    vi.stubEnv("AI_STAY_GUARD_ENABLED", "");
    const a = await seed();
    expect((await applyChannelAutoReply(a.conversationId)).sent).toBe(false);
    await resetDb();
    vi.stubEnv("AI_STAY_GUARD_ENABLED", "1");
    guardKind = "none";
    const b = await seed();
    expect((await applyChannelAutoReply(b.conversationId)).sent).toBe(false);
  });

  it("🚨 bayat takvim (10 saat) → gitmez", async () => {
    const { conversationId } = await seed({ feedAgeHours: 10 });
    expect((await applyChannelAutoReply(conversationId)).sent).toBe(false);
  });

  it("🚨 anlama katmanı uzatma görüyorsa → gitmez (ev sahibinin kararı)", async () => {
    vi.stubGlobal("fetch", understandingFetch("extend"));
    const { conversationId } = await seed();
    expect((await applyChannelAutoReply(conversationId)).sent).toBe(false);
  });

  it("🚨 anlama katmanı KAPALI → gitmez (çok dilli uzatma isteği kelime ağından kaçabilir)", async () => {
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "");
    const { conversationId } = await seed();
    expect((await applyChannelAutoReply(conversationId)).sent).toBe(false);
  });

  it("🚨 mesajda iki soru varsa → gitmez (ikinci soru yanıtsız kalmasın)", async () => {
    const { conversationId } = await seed({ message: `${ASK} Otopark var mı?` });
    expect((await applyChannelAutoReply(conversationId)).sent).toBe(false);
  });

  it("🚨 YANLIŞ KONU: kelime ağı müsaitlik sayar ama anlama katmanı otopark sorusu görür → gitmez", async () => {
    vi.stubGlobal("fetch", understandingFetch("none", ["parking"]));
    const { conversationId } = await seed({ message: `Otopark ${human(D1)} ile ${human(D2)} arası müsait mi?` });
    expect((await applyChannelAutoReply(conversationId)).sent).toBe(false);
  });

  it("🚨 İKİNCİ SORU (soru işaretsiz): anlama katmanı müsaitlik + wifi görür → gitmez", async () => {
    vi.stubGlobal("fetch", understandingFetch("availability", ["availability", "wifi"]));
    const { conversationId } = await seed({ message: `${human(D1)} ile ${human(D2)} arası müsait mi, wifi şifresi nedir` });
    expect((await applyChannelAutoReply(conversationId)).sent).toBe(false);
  });

  it("🚨 modelin niyet etiketi riskli (şikâyet) → kod metni kullanılmaz", async () => {
    mockSuggest.mockResolvedValue({ ...verdict, intent: "complaint" } as never);
    const { conversationId } = await seed();
    expect((await applyChannelAutoReply(conversationId)).sent).toBe(false);
  });

  it("İngilizce misafir → İngilizce kod metni", async () => {
    vi.stubGlobal("fetch", understandingFetch("availability", ["availability"], "en"));
    mockSuggest.mockResolvedValue({ ...verdict, detectedLanguage: "en" } as never);
    const EN_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const en = (k: string) => `${Number(k.slice(8, 10))} ${EN_MONTHS[Number(k.slice(5, 7)) - 1]}${k.slice(0, 4) === TODAY.slice(0, 4) ? "" : ` ${k.slice(0, 4)}`}`;
    const { conversationId } = await seed({ message: `Hello, is the apartment available from ${en(D1)} to ${en(D2)}?` });
    expect((await applyChannelAutoReply(conversationId)).sent).toBe(true);
    expectCodeSent(`The apartment is available for check-in on ${en(D1)} and check-out on ${en(D2)}.`);
  });

  it("🚨 misafirin dili KODLA belirlenemiyor ('29-31 Ekim boş mu?') → modelin dil tahminine düşülmez, gitmez", async () => {
    // Aynı ay içinde iki gün (kısa, dili belirsiz yazım).
    let a = addNights(TODAY, 20);
    if (a.slice(5, 7) !== addNights(a, 2).slice(5, 7)) a = addNights(a, 3);
    const b = addNights(a, 2);
    const month = TR_MONTHS[Number(a.slice(5, 7)) - 1];
    const { conversationId } = await seed({ message: `${Number(a.slice(8, 10))}-${Number(b.slice(8, 10))} ${month} boş mu?` });
    expect((await applyChannelAutoReply(conversationId)).sent).toBe(false);
  });
});
