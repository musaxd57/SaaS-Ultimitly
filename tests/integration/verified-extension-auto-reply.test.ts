// ---------------------------------------------------------------------------
// DOĞRULANMIŞ UZATMA OTOMATİK CEVABI (kurucu kararı 10-09: "Müsait + talep yolu") — uçtan uca, gerçek PostgreSQL.
//
// Zincir: misafirin uzatma isteği → kelime ağı "yalnız uzatma" → uzatma aralığı [çıkış, çıkış + N) → müsaitlik aracı (gerçek takvim
// kaynağı + rezervasyonlar) → KODDAN kurulan tek metin → kapı (birebir metin muafiyeti; acil / şikâyet / injection / güven AYNEN).
// Cevap modeli MOCK (taslağı misafire GİTMEZ), anlama katmanı sahte fetch, gönderim katmanı sahte. Her "gitmez" iddiasının aynı tohumla
// "gider" kontrolü var.
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

// Konaklama: dün giriş, 3 gün sonra çıkış (gerçek saate göre). Uzatma gecesi = çıkış günü.
const TODAY = todayKey(new Date(), TZ);
const ARR = addNights(TODAY, -1);
const DEP = addNights(TODAY, 3);
const human = (k: string) => `${Number(k.slice(8, 10))} ${TR_MONTHS[Number(k.slice(5, 7)) - 1]}${k.slice(0, 4) === TODAY.slice(0, 4) ? "" : ` ${k.slice(0, 4)}`}`;
const ASK = "Merhaba, bir gece daha kalabilir miyiz?";
const TAIL = "Konaklamanızı uzatmak için Airbnb uygulamasından rezervasyon değişikliği talebi gönderebilirsiniz; yeni tutarı Airbnb gösterir.";
const CODE_AVAILABLE = `${human(DEP)} gecesi daire müsait. ${TAIL}`;
const CODE_UNAVAILABLE = `Maalesef ${human(DEP)} gecesi daire müsait değil.`;
const MODEL_DRAFT = "Uzatma talebinizi ev sahibimize iletiyorum.";

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
  stayChange: { asked: "extend", stance: "defers" },
};

function understandingFetch(kind: "extend" | "availability" | "early_checkin" | "none", intents: string[] = ["extend_stay"], language = "tr") {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const name = JSON.parse(String(init?.body)).response_format?.json_schema?.name as string;
    if (name !== "guest_message_understanding") throw new Error(`beklenmeyen şema: ${name}`);
    const v = {
      language,
      requests: intents.map((intent) => ({ intent, query_tr: "soru", query_original: "soru" })),
      stay_change: { requested: kind !== "none", kind, checkin_time: null, checkout_time: null },
    };
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(v) } }] }), { status: 200 });
  });
}

async function seed(
  opts: { message?: string; feedAgeHours?: number; nextGuest?: "manual" | "airbnb"; channel?: string; departure?: string } = {},
) {
  const org = await prisma.organization.create({
    data: { name: "Uzatma Org", autoReplyHospitable: true, autoReplyStartHour: 0, autoReplyEndHour: 0, timezone: TZ },
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
  const dep = opts.departure ?? DEP;
  const stay = await prisma.reservation.create({
    data: {
      propertyId: property.id,
      guestName: "Ayşe Yılmaz",
      arrivalDate: new Date(`${ARR}T00:00:00Z`),
      departureDate: new Date(`${dep}T00:00:00Z`),
      channel: opts.channel ?? "airbnb",
      status: "confirmed",
      sourceReference: "res-ext-1",
    },
  });
  if (opts.nextGuest) {
    await prisma.reservation.create({
      data: {
        propertyId: property.id,
        guestName: "Sonraki Misafir",
        arrivalDate: new Date(`${dep}T00:00:00Z`),
        departureDate: new Date(`${addNights(dep, 2)}T00:00:00Z`),
        channel: opts.nextGuest,
        status: "confirmed",
      },
    });
  }
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      reservationId: stay.id,
      guestIdentifier: "Ayşe Yılmaz",
      channel: "airbnb",
      status: "new",
      externalReservationId: "res-ext-1",
      lastMessageAt: new Date(),
      messages: { create: { direction: "inbound", senderName: "Ayşe Yılmaz", authorType: "guest", body: opts.message ?? ASK } },
    },
  });
  return { conversationId: conversation.id };
}

const sentBody = () => (mockSend.mock.calls[0]?.[1] as string | undefined) ?? null;
const expectCodeSent = (code: string) => {
  const body = sentBody() ?? "";
  expect(body.split("\n")[0]).toBe(code);
  expect(body).not.toContain(MODEL_DRAFT);
};

describe("doğrulanmış uzatma otomatik cevabı — koddan kurulan metin", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    __resetUnderstandingCache();
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("KB_RETRIEVAL_MODE", "legacy");
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubEnv("AI_VERIFIED_EXTENSION_ENABLED", "1");
    vi.stubGlobal("fetch", understandingFetch("extend"));
    mockSend.mockResolvedValue({ ok: true } as never);
    mockSuggest.mockResolvedValue(verdict as never);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("🚨 taze takvim + uzatma gecesi boş → KOD METNİ (müsait + talep yolu) gider, modelin taslağı değil", async () => {
    const { conversationId } = await seed();
    const r = await applyChannelAutoReply(conversationId);
    expect(r.sent).toBe(true);
    expectCodeSent(CODE_AVAILABLE);
  });

  it("KONTROL: anahtar KAPALI → hiçbir şey gitmez (bugünkü davranış: uzatma ev sahibine)", async () => {
    vi.stubEnv("AI_VERIFIED_EXTENSION_ENABLED", "");
    const { conversationId } = await seed();
    expect((await applyChannelAutoReply(conversationId)).sent).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("sonraki misafir (ev sahibinin girdiği blok) çıkış günü giriyor → 'müsait değil' kod metni gider", async () => {
    const { conversationId } = await seed({ nextGuest: "manual" });
    expect((await applyChannelAutoReply(conversationId)).sent).toBe(true);
    expectCodeSent(CODE_UNAVAILABLE);
  });

  it("🚨 sonraki misafir KÖPRÜDEN gelmiş (tazelik kaydı yok) → 'dolu' KESİN sayılmaz, gitmez (ev sahibine)", async () => {
    const { conversationId } = await seed({ nextGuest: "airbnb" });
    expect((await applyChannelAutoReply(conversationId)).sent).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("iki gece daha → aralık metni", async () => {
    const { conversationId } = await seed({ message: "Merhaba, iki gece daha kalabilir miyiz?" });
    expect((await applyChannelAutoReply(conversationId)).sent).toBe(true);
    expectCodeSent(`${human(DEP)} – ${human(addNights(DEP, 2))} arası 2 gece daire müsait. ${TAIL}`);
  });

  it("🚨 bayat takvim (10 saat) → gitmez", async () => {
    const { conversationId } = await seed({ feedAgeHours: 10 });
    expect((await applyChannelAutoReply(conversationId)).sent).toBe(false);
  });

  it("🚨 rezervasyon Airbnb DEĞİL (doğrudan) → gitmez (metin Airbnb talebini anlatır)", async () => {
    const { conversationId } = await seed({ channel: "direct" });
    expect((await applyChannelAutoReply(conversationId)).sent).toBe(false);
  });

  it("🚨 konaklama BİTMİŞ (çıkış dün) → gitmez", async () => {
    const { conversationId } = await seed({ departure: addNights(TODAY, -1) });
    expect((await applyChannelAutoReply(conversationId)).sent).toBe(false);
  });

  it("🚨 gece sayısı belirsiz ('biraz daha') → gitmez", async () => {
    const { conversationId } = await seed({ message: "Merhaba, biraz daha kalabilir miyiz?" });
    expect((await applyChannelAutoReply(conversationId)).sent).toBe(false);
  });

  it("🚨 anlama katmanı erken giriş görüyorsa (uzatma değil) → gitmez", async () => {
    vi.stubGlobal("fetch", understandingFetch("early_checkin", ["early_checkin"]));
    const { conversationId } = await seed();
    expect((await applyChannelAutoReply(conversationId)).sent).toBe(false);
  });

  it("🚨 anlama katmanı KAPALI → gitmez", async () => {
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "");
    const { conversationId } = await seed();
    expect((await applyChannelAutoReply(conversationId)).sent).toBe(false);
  });

  it("🚨 aynı mesajda geç çıkış da isteniyor → gitmez (ev sahibinin kararı)", async () => {
    vi.stubGlobal("fetch", understandingFetch("extend", ["extend_stay", "late_checkout"]));
    const { conversationId } = await seed({ message: "Bir gece daha kalabilir miyiz, olmazsa geç çıkış alabilir miyiz?" });
    expect((await applyChannelAutoReply(conversationId)).sent).toBe(false);
  });

  it("🚨 İKİNCİ SORU: anlama katmanı uzatma + wifi görür → gitmez", async () => {
    vi.stubGlobal("fetch", understandingFetch("extend", ["extend_stay", "wifi"]));
    const { conversationId } = await seed({ message: "Bir gece daha kalabilir miyiz, wifi şifresi nedir" });
    expect((await applyChannelAutoReply(conversationId)).sent).toBe(false);
  });

  it("🚨 modelin niyet etiketi riskli (şikâyet) → kod metni kullanılmaz", async () => {
    mockSuggest.mockResolvedValue({ ...verdict, intent: "complaint" } as never);
    const { conversationId } = await seed();
    expect((await applyChannelAutoReply(conversationId)).sent).toBe(false);
  });

  it("🚨 acil durum cümlesi varsa → gitmez (kapı aynen koşar)", async () => {
    const { conversationId } = await seed({ message: "Mutfakta gaz kokusu var! Bir gece daha kalabilir miyiz?" });
    expect((await applyChannelAutoReply(conversationId)).sent).toBe(false);
  });

  it("İngilizce misafir → İngilizce kod metni", async () => {
    vi.stubGlobal("fetch", understandingFetch("extend", ["extend_stay"], "en"));
    mockSuggest.mockResolvedValue({ ...verdict, detectedLanguage: "en" } as never);
    const EN_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const en = (k: string) => `${Number(k.slice(8, 10))} ${EN_MONTHS[Number(k.slice(5, 7)) - 1]}${k.slice(0, 4) === TODAY.slice(0, 4) ? "" : ` ${k.slice(0, 4)}`}`;
    const { conversationId } = await seed({ message: "Hello, can we stay one more night?" });
    expect((await applyChannelAutoReply(conversationId)).sent).toBe(true);
    expectCodeSent(
      `The apartment is available on the night of ${en(DEP)}. To extend your stay, you can send a reservation change request in the Airbnb app; Airbnb will show the new total.`,
    );
  });
});
