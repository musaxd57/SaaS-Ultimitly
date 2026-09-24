import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// INBOX "AI ÖNER" — MÜSAİTLİK UYARISI ROTA DÜZEYİNDE (09-24, inceleme bulgusu: yüklem birim testli
// ama rotanın ona VERDİĞİ girdi pinsizdi — "yüklem var, argüman yok" sınıfı).
//
// Pinlenen: rota uyarıyı oto-gönderim kapısıyla AYNI politikadan hesaplar ve girdisi
//  · son GİDEN mesajdan sonraki TÜM cevapsız misafir mesajları (öndeki uzatma isteği sondaki wifi
//    sorusunun arkasına saklanamaz), cevaplanmış eski istek DEĞİL;
//  · modelin şema beyanı (`stayChange`);
//  · anlama katmanının sinyali (bayrak açıkken; `enforce` kipinde karar verir).
// Cevap modeli MOCK; DB gerçek.
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/ai", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai")>()),
  suggestReply: vi.fn(),
}));

import { suggestReply } from "@/lib/ai";
import { POST as aiSuggest } from "@/app/api/conversations/[id]/ai-suggest/route";
import { __resetUnderstandingCache } from "@/lib/ai/semantic/understand";

const mockSuggest = vi.mocked(suggestReply);

const BASE = {
  intent: "wifi",
  confidence: 0.9,
  reply: "The Wi-Fi details are on the card next to the router.",
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
};

type Msg = { direction: "inbound" | "outbound"; body: string };

async function seed(messages: Msg[]) {
  const org = await prisma.organization.create({ data: { name: "Test Org" } });
  await prisma.user.create({
    data: { organizationId: org.id, name: "h", email: "h@x.com", passwordHash: "x", role: "owner" },
  });
  const property = await prisma.property.create({
    data: { organizationId: org.id, name: "Lale", checkInTime: "15:00", checkOutTime: "11:00" },
  });
  const t0 = Date.now() - 10 * 60_000;
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      channel: "airbnb",
      guestIdentifier: "Alex",
      status: "new",
      messages: {
        create: messages.map((m, i) => ({
          direction: m.direction,
          senderName: m.direction === "inbound" ? "Alex" : "Host",
          body: m.body,
          createdAt: new Date(t0 + i * 60_000),
        })),
      },
    },
    select: { id: true },
  });
  session = { userId: "u1", organizationId: org.id, role: "owner", email: "h@x.com", name: "h", sessionEpoch: 0 };
  return conversation.id;
}

async function suggest(id: string): Promise<{ status: number; availabilityCheck?: string | null }> {
  const res = await aiSuggest(
    new NextRequest(`http://localhost/api/conversations/${id}/ai-suggest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }),
    { params: Promise.resolve({ id }) },
  );
  const body = (await res.json()) as { availabilityCheck?: string | null };
  return { status: res.status, availabilityCheck: body.availabilityCheck };
}

describe("POST /api/conversations/[id]/ai-suggest — müsaitlik uyarısı", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    __resetUnderstandingCache();
    vi.clearAllMocks();
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("KB_RETRIEVAL_MODE", "legacy");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("KONTROL: sıradan soru + sıradan cevap → uyarı yok (null)", async () => {
    mockSuggest.mockResolvedValue(BASE);
    const id = await seed([{ direction: "inbound", body: "What's the wifi password?" }]);
    expect(await suggest(id)).toEqual({ status: 200, availabilityCheck: null });
  });

  it("🚨 öndeki CEVAPSIZ uzatma isteği sondaki wifi sorusunun arkasına saklanamaz → 'availability_unconfirmed'", async () => {
    mockSuggest.mockResolvedValue(BASE);
    const id = await seed([
      { direction: "inbound", body: "Hi!" },
      { direction: "outbound", body: "Welcome!" },
      { direction: "inbound", body: "Can we stay one more night?" },
      { direction: "inbound", body: "Also, what's the wifi password?" },
    ]);
    expect((await suggest(id)).availabilityCheck).toBe("availability_unconfirmed");
  });

  it("aşırı-uygulama kontrolü: aynı istek host CEVAPLADIKTAN sonra eski sayılır → uyarı yok", async () => {
    mockSuggest.mockResolvedValue(BASE);
    const id = await seed([
      { direction: "inbound", body: "Can we stay one more night?" },
      { direction: "outbound", body: "Let me check with the calendar and come back to you." },
      { direction: "inbound", body: "Thanks! Also, what's the wifi password?" },
    ]);
    expect((await suggest(id)).availabilityCheck).toBeNull();
  });

  it("🚨 modelin şema beyanı rotaya ULAŞIR: beyan edilen izin → 'availability_claim'", async () => {
    mockSuggest.mockResolvedValue({
      ...BASE,
      intent: "early_checkin",
      reply: "Sure, see you at 11.",
      stayChange: { asked: "early_checkin", stance: "grants" },
    });
    const id = await seed([{ direction: "inbound", body: "Could we get into the flat at 11?" }]);
    expect((await suggest(id)).availabilityCheck).toBe("availability_claim");
  });

  it("ertelemeyi hem beyan eden hem metinde taşıyan cevap → uyarı yok", async () => {
    mockSuggest.mockResolvedValue({
      ...BASE,
      intent: "early_checkin",
      reply: "Early check-in is up to your host; your message has been recorded and your host can see it.",
      stayChange: { asked: "early_checkin", stance: "defers" },
    });
    const id = await seed([{ direction: "inbound", body: "Can we check in early?" }]);
    expect((await suggest(id)).availabilityCheck).toBeNull();
  });

  it("ev sahibinin teklif metni rotaya ULAŞIR: aynen aktarıp erteleyen taslak uyarı almaz; teklif tanımlı değilse aynı taslak iddiadır", async () => {
    const offer = "Müsaitlik varsa çıkışınızı 13:00'e kadar uzatabiliriz.";
    mockSuggest.mockResolvedValue({
      ...BASE,
      intent: "late_checkout",
      reply: `${offer} Uygunluğu ev sahibinizin kararıdır; mesajınız kaydedildi.`,
      stayChange: { asked: "late_checkout", stance: "defers" },
    });
    const id = await seed([{ direction: "inbound", body: "Geç çıkış mümkün mü?" }]);
    expect((await suggest(id)).availabilityCheck).toBe("availability_claim"); // KONTROL: teklif yok
    await prisma.organization.update({ where: { id: session.organizationId }, data: { lateCheckoutOfferText: offer } });
    __resetRateLimit();
    expect((await suggest(id)).availabilityCheck).toBeNull();
  });

  it("🚨 anlama katmanı açık + enforce: modelin anladığı standart-dışı saat isteği uyarıya girer (kelime ağı sessizken)", async () => {
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubEnv("AI_STAY_POLICY", "enforce");
    const f = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body)).response_format.json_schema.name).toBe("guest_message_understanding");
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  language: "en",
                  requests: [{ intent: "early_checkin", query_tr: "erken giriş", query_original: "arrive at 11" }],
                  stay_change: { requested: true, kind: "early_checkin", checkin_time: "11:00", checkout_time: null },
                }),
              },
            },
          ],
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", f);
    mockSuggest.mockResolvedValue({ ...BASE, reply: "Check-in is from 15:00." });
    const id = await seed([{ direction: "inbound", body: "Could we get into the flat at 11?" }]);
    expect((await suggest(id)).availabilityCheck).toBe("availability_unconfirmed");
    expect(f).toHaveBeenCalledTimes(1);

    // Aynı girdi gölge kipte: anlama sinyali tek başına karar vermez.
    vi.stubEnv("AI_STAY_POLICY", "shadow");
    __resetRateLimit();
    expect((await suggest(id)).availabilityCheck).toBeNull();
  });
});
