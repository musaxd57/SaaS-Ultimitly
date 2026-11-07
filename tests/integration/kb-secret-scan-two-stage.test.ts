import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// B3 — SIR TARAMASI İKİ AŞAMADA: HAM metin VE ad / daire yerleştirilmiş metin (kurucu onayı 09-27: "Oto-yanıt sır taramasında
// hem ham metni hem isim yerleştirilmiş metni tara. İki aşama için ayrı test ekle.").
//
// Ölçülen iki açık (kodla çalıştırıldı, rezervasyonsuz konuşma):
//  · Oto-yanıt YALNIZ yerleştirilmiş metni tarıyordu. Misafirin uzun ADI anahtar sözcükle değeri kalıbın penceresinden çıkarıyor:
//    "Wi-Fi ağı {isim} için hazır, key: X9Q2AB" ham hâliyle sır; 33 harfli adla yerleştirilince değil → Wi-Fi anahtarı modele
//    gidiyordu (ad misafirin kendi kontrolündedir).
//  · Yönetici "AI öner" YALNIZ ham metni tarıyordu. Yerleştirme sır biçimi üretebilir: "Kapı: {daire}" + mülk adı "Daire 4590" →
//    "Kapı: 4590" (giriş adı + bitişik rakam kalıbı).
// Kural tek (`kbForStayScopeRawAndFilled`), iki yüzey; onaylı / tamamlanmış konaklamada sır ürünün kendisidir (verilir).
// Küçük bilgi tabanı → seçim yok, küme olduğu gibi modele gider: kalemin modele ulaşıp ulaşmadığı yalnız sır kapısına bağlıdır.
// ---------------------------------------------------------------------------

vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn().mockResolvedValue(undefined) };
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
import { sendOnChannel } from "@/lib/messaging";
import { applyChannelAutoReply } from "@/lib/automation";
import { POST as aiSuggest } from "@/app/api/conversations/[id]/ai-suggest/route";

const mockSuggest = vi.mocked(suggestReply);
const DAY = 86_400_000;
const LONG_NAME = "Maximiliantheodorwilhelmfriedrich"; // 33 harf — misafirin sağlayıcıdaki adı (kendi kontrolünde)

/** Aşama 1 (HAM): ham hâli sır, uzun adla yerleştirilince kalıp penceresi aşılıyor. */
const RAW_STAGE = { category: "general", title: "İnternet notu", content: "Wi-Fi ağı {isim} için hazır, key: X9Q2AB" };
/** Aşama 2 (YERLEŞTİRİLMİŞ): ham hâli sır değil; "Daire 4590" mülkünde "Kapı: 4590" olur. */
const FILLED_STAGE = { category: "general", title: "Kapı notu", content: "Kapı: {daire}" };
/** Aşırı eleme kontrolü: yer tutuculu ama sır olmayan kalem kalır ve adla doldurulur. */
const CLEAN = { category: "general", title: "Karşılama", content: "Merhaba {isim}, otopark bina altındadır ve ücretsizdir." };

const REPLY = {
  intent: "general",
  confidence: 0.9,
  reply: "Otopark bina altındadır.",
  risk: null,
  priority: "standard" as const,
  source: "openai" as const,
  actionSuggestion: null,
  riskLevel: "none" as const,
  detectedLanguage: "tr",
  riskType: null,
  usedSources: [],
  sourceAudit: { declared: 0, verified: 0 },
  missingInfo: [],
  statedCheckoutTime: null,
  stayChange: { asked: "none" as const, stance: "none" as const },
};

async function seed(opts: { reservationStatus: string | null; guestIdentifier: string; propertyName: string }) {
  const org = await prisma.organization.create({
    data: { name: "Test Org", autoReplyHospitable: true, autoReplyStartHour: 0, autoReplyEndHour: 0, timezone: "Europe/Istanbul" },
  });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: opts.propertyName } });
  for (const k of [RAW_STAGE, FILLED_STAGE, CLEAN]) {
    await prisma.knowledgeBaseItem.create({
      data: { propertyId: property.id, ...k, isActive: true, source: "host_manual", reviewState: "approved" },
    });
  }
  const reservation = opts.reservationStatus
    ? await prisma.reservation.create({
        data: {
          propertyId: property.id,
          guestName: opts.guestIdentifier,
          arrivalDate: new Date(Date.now() - DAY),
          departureDate: new Date(Date.now() + 2 * DAY),
          status: opts.reservationStatus,
          channel: "airbnb",
          currency: "EUR",
          sourceReference: "res-1",
        },
        select: { id: true },
      })
    : null;
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      reservationId: reservation?.id ?? null,
      channel: "airbnb",
      guestIdentifier: opts.guestIdentifier,
      status: "new",
      externalReservationId: "res-1",
      messages: {
        create: [
          { direction: "inbound", senderName: opts.guestIdentifier, authorType: "guest", body: "Wi-Fi ve kapı bilgisi nedir, otopark var mı?", createdAt: new Date(Date.now() - 60_000) },
        ],
      },
    },
    select: { id: true },
  });
  session = { userId: "u1", organizationId: org.id, role: "owner", email: "h@x.com", name: "h", sessionEpoch: 0 };
  return conversation.id;
}

/** Modele giden bilgi tabanı (başlık|içerik satırları). */
function sentKb(): string {
  const input = mockSuggest.mock.calls.at(-1)?.[0];
  expect(input, "model çağrılmadı (ölçüm önkoşulu)").toBeDefined();
  return (input!.knowledgeBase ?? []).map((k) => `${k.title}|${k.content}`).join("\n");
}

async function viaAutoReply(opts: Parameters<typeof seed>[0]): Promise<string> {
  const id = await seed(opts);
  await applyChannelAutoReply(id);
  return sentKb();
}

async function viaSuggest(opts: Parameters<typeof seed>[0]): Promise<string> {
  const id = await seed(opts);
  const res = await aiSuggest(
    new NextRequest(`http://localhost/api/conversations/${id}/ai-suggest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tone: "warm" }),
    }),
    { params: Promise.resolve({ id }) },
  );
  expect(res.status).toBe(200);
  return sentKb();
}

beforeEach(async () => {
  await resetDb();
  __resetRateLimit();
  vi.clearAllMocks();
  mockSuggest.mockReset();
  mockSuggest.mockResolvedValue(REPLY as never);
  vi.mocked(sendOnChannel).mockResolvedValue({ ok: true, externalId: "ext-1" } as never);
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubEnv("AUTO_REPLY_ENABLED", "1");
  vi.stubEnv("KB_RETRIEVAL_MODE", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await prisma.$disconnect();
});

for (const [surface, via] of [
  ["kanal oto-yanıtı", viaAutoReply],
  ["yönetici AI öner", viaSuggest],
] as const) {
  describe(`${surface} — rezervasyonsuz konuşma`, () => {
    it("🚨 AŞAMA 1 (HAM metin): uzun ad kalıbı bölse de ham hâli sır olan kalem modele GİTMEZ", async () => {
      const kb = await via({ reservationStatus: null, guestIdentifier: `${LONG_NAME} Schmidt`, propertyName: "Lale 7" });
      expect(kb).not.toContain("X9Q2AB");
      expect(kb).not.toContain("İnternet notu");
      // Aşırı eleme yok: sır olmayan yer tutuculu kalem kalır ve misafirin adıyla doldurulur.
      expect(kb).toContain(`Merhaba ${LONG_NAME}, otopark bina altındadır`);
    });

    it("🚨 AŞAMA 2 (yerleştirilmiş metin): '{daire}' ile kapı koduna dönüşen kalem modele GİTMEZ", async () => {
      const kb = await via({ reservationStatus: null, guestIdentifier: "Alex", propertyName: "Daire 4590" });
      expect(kb).not.toContain("4590");
      expect(kb).not.toContain("Kapı notu");
      expect(kb).toContain("Merhaba Alex, otopark bina altındadır");
    });
  });

  describe(`${surface} — onaylı konaklama (sır ürünün kendisi, aynen)`, () => {
    it("iki aşamanın kalemleri de modele gider (yerleştirilmiş hâliyle)", async () => {
      const kb = await via({ reservationStatus: "confirmed", guestIdentifier: `${LONG_NAME} Schmidt`, propertyName: "Daire 4590" });
      expect(kb).toContain("X9Q2AB");
      expect(kb).toContain("Kapı: 4590");
    });
  });
}
