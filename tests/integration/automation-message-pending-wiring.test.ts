// ---------------------------------------------------------------------------
// K7 BAĞLANTISI (kurucu onayı 09-30, `message-author.ts`): otomatik şablon mesajı (karşılama / giriş / çıkış) misafire gitti ama
// CEVAP DEĞİLDİR — cevapsız misafir penceresini sıfırlamaz. Kapı bu kuralı uyguluyordu; kanal oto-yanıtının GETİRME (bilgi tabanı
// alt sorguları, `pendingGuestMessages`) ve ANLAMA katmanı (`understandingWindow`) girdisi ise yazar alanı taşımadığı için şablonu
// cevap sayıyordu ("yüklem var, argüman yok"): "Otopark var mı?" → [otomatik giriş mesajı] → "Wifi şifresi nedir?" dizisinde model
// iki soruyu da görüyor ama otopark için bilgi tabanı ARANMIYOR, anlama katmanı otoparkı görmüyordu.
//
// KONTROL her testte: aynı dizide şablon yerine EV SAHİBİ cevabı → önceki soru cevaplanmıştır, eski davranış aynen.
// ---------------------------------------------------------------------------
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

vi.mock("@/lib/ai", () => ({ suggestReply: vi.fn(), classifyMessage: vi.fn() }));
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

const mockSuggest = vi.mocked(suggestReply);
const mockSend = vi.mocked(sendOnChannel);
const DAY = 86_400_000;

const PARKING_Q = "Otopark var mı?";
const TEMPLATE = "Hoş geldiniz! Giriş bilgileriniz ve ev kuralları ektedir.";
const WIFI_Q = "Wifi şifresi nedir?";

const verdict = {
  intent: "wifi",
  confidence: 0.95,
  reply: "Wifi şifresi giriş kapısının yanındaki kartta yazıyor.",
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
};

async function seed(middle: "automation" | "host") {
  const org = await prisma.organization.create({
    data: { name: "K7 Org", autoReplyHospitable: true, autoReplyStartHour: 0, autoReplyEndHour: 0, timezone: "Europe/Istanbul" },
  });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale", checkInTime: "15:00", checkOutTime: "11:00" } });
  // Getirme yalnız "küçük KB" eşiğinin üstünde koşar (>30 kalem) — eşiğin altında bütün KB gider, alt sorgu sayılmaz.
  await prisma.knowledgeBaseItem.createMany({
    data: Array.from({ length: 36 }, (_, i) => ({
      propertyId: property.id,
      category: "general",
      title: `Bilgi ${i}`,
      content: `Daire hakkında ayrıntı numarası ${i}: mutfak dolabı, çamaşır makinesi ve balkon kullanımı.`,
      isActive: true,
      source: "host_manual",
      reviewState: "approved",
    })),
  });
  const r = await prisma.reservation.create({
    data: {
      propertyId: property.id,
      guestName: "Ayşe Yılmaz",
      arrivalDate: new Date(Date.now() - DAY),
      departureDate: new Date(Date.now() + 2 * DAY),
      channel: "airbnb",
      status: "confirmed",
      sourceReference: "res-k7-1",
    },
  });
  const start = Date.now() - 4 * 60_000;
  const turns = [
    { direction: "inbound", authorType: "guest", senderName: "Ayşe Yılmaz", body: PARKING_Q },
    { direction: "outbound", authorType: middle, senderName: "Ev sahibi", body: TEMPLATE },
    { direction: "inbound", authorType: "guest", senderName: "Ayşe Yılmaz", body: WIFI_Q },
  ];
  return prisma.conversation.create({
    data: {
      propertyId: property.id,
      reservationId: r.id,
      guestIdentifier: "Ayşe Yılmaz",
      channel: "airbnb",
      status: "new",
      externalReservationId: "res-k7-1",
      lastMessageAt: new Date(),
      messages: { create: turns.map((t, i) => ({ ...t, createdAt: new Date(start + i * 60_000) })) },
    },
  });
}

/** Anlama katmanının istemini yakalayan sahte OpenAI (yalnız `guest_message_understanding`). */
function captureUnderstanding(prompts: string[]) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const name = body.response_format?.json_schema?.name as string;
    if (name !== "guest_message_understanding") throw new Error(`beklenmeyen şema: ${name}`);
    prompts.push(String(body.messages?.at(-1)?.content ?? ""));
    const verdictJson = {
      language: "tr",
      requests: [{ intent: "wifi", query_tr: "wifi şifresi", query_original: "wifi" }],
      stay_change: { requested: false, kind: "none", checkin_time: null, checkout_time: null },
    };
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(verdictJson) } }] }), { status: 200 });
  });
}

const unansweredSection = (prompt: string) => prompt.slice(prompt.indexOf("UNANSWERED GUEST MESSAGES:"));

async function pendingQueries(conversationId: string): Promise<number | undefined> {
  const ev = await prisma.riskEvent.findFirstOrThrow({ where: { conversationId } });
  const parsed = JSON.parse(ev.kbEvidenceJson ?? "{}") as { retrieval?: { mode?: string; pq?: number } };
  // Anti-vakumluk: getirme GERÇEKTEN koştu (küçük KB kısayolu değil) — yoksa "alt sorgu yok" iddiası boş olurdu.
  expect(parsed.retrieval?.mode).toBe("hybrid");
  return parsed.retrieval?.pq;
}

describe("K7 bağlantısı — otomatik şablon mesajı getirme / anlama penceresini sıfırlamaz", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    __resetUnderstandingCache();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    mockSend.mockResolvedValue({ ok: true } as never);
    mockSuggest.mockResolvedValue(verdict as never);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("🚨 getirme: şablonun ÖNCESİNDEKİ cevapsız soru da alt sorgu olur (pq 1); KONTROL ev sahibi cevabı → alt sorgu yok", async () => {
    const auto = await seed("automation");
    await applyChannelAutoReply(auto.id);
    expect(await pendingQueries(auto.id)).toBe(1);

    await resetDb();
    const host = await seed("host");
    await applyChannelAutoReply(host.id);
    expect(await pendingQueries(host.id)).toBeUndefined();
  });

  it("🚨 anlama katmanı: şablonun öncesindeki soru CEVAPSIZ listesinde ([1] otopark, [2] wifi); KONTROL ev sahibi cevabı → yalnız wifi", async () => {
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    const prompts: string[] = [];
    vi.stubGlobal("fetch", captureUnderstanding(prompts));
    const auto = await seed("automation");
    await applyChannelAutoReply(auto.id);
    expect(prompts.length).toBeGreaterThan(0);
    const autoSection = unansweredSection(prompts[0]);
    expect(autoSection).toContain(PARKING_Q);
    expect(autoSection).toContain(WIFI_Q);
    // Şablon cevapsız misafir mesajı değildir; listeye girmez.
    expect(autoSection).not.toContain("Hoş geldiniz");

    await resetDb();
    __resetUnderstandingCache();
    prompts.length = 0;
    const host = await seed("host");
    await applyChannelAutoReply(host.id);
    const hostSection = unansweredSection(prompts[0]);
    expect(hostSection).toContain(WIFI_Q);
    expect(hostSection).not.toContain(PARKING_Q);
  });
});
