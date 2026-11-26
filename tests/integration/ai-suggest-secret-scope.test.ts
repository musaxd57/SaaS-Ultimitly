import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// YÖNETİCİ "AI ÖNER" SIR KAPSAMI (Codex 09-27). Oto-yanıt ve QR, onaylı / tamamlanmış konaklama DIŞINDA bilgi tabanının sır
// bacaklarını (kategori `wifi` / `checkin` + içerik sezgiseli: kod, şifre…) modelden ÖNCE eliyor; öneri rotası hiç elemiyordu →
// rezervasyonsuz (ya da onaysız) konuşmada Wi-Fi / kapı kodu taslağa girebiliyor, ev sahibi taslağı gönderirse sır aday
// misafire çıkabiliyordu. Kural artık tek kaynak (`kbForStayScope`): oto-yanıtla birebir. Onaylı konaklamada sır ürünün
// kendisidir (verilir). Cevap modeli MOCK; DB gerçek; ölçülen = modele giden bilgi tabanı.
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

const mockSuggest = vi.mocked(suggestReply);

const REPLY = {
  intent: "general",
  confidence: 0.9,
  reply: "Size yardımcı olabilirim.",
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

const KB = [
  { category: "wifi", title: "Wi-Fi", content: "Ağ LaleApt, şifre kapı arkasındaki karttadır." },
  { category: "checkin", title: "Giriş talimatı", content: "Anahtar kutusu bina girişinde, sol duvarda." },
  { category: "faq", title: "Giriş notu", content: "Kapı kodu 4590, anahtar kutusu 2288." },
  { category: "parking", title: "Otopark", content: "Bina altı otopark misafirler için ücretsizdir." },
];

async function seed(reservationStatus: string | null) {
  const org = await prisma.organization.create({ data: { name: "Test Org" } });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale" } });
  for (const k of KB) {
    await prisma.knowledgeBaseItem.create({
      data: { propertyId: property.id, ...k, isActive: true, source: "host_manual", reviewState: "approved" },
    });
  }
  const reservation = reservationStatus
    ? await prisma.reservation.create({
        data: {
          propertyId: property.id,
          guestName: "Alex",
          arrivalDate: new Date(Date.now() + 2 * 86_400_000),
          departureDate: new Date(Date.now() + 5 * 86_400_000),
          status: reservationStatus,
        },
        select: { id: true },
      })
    : null;
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      reservationId: reservation?.id ?? null,
      channel: "airbnb",
      guestIdentifier: "Alex",
      status: "new",
      messages: {
        create: [{ direction: "inbound", senderName: "Alex", authorType: "guest", body: "Wi-Fi şifresi ve kapı kodu nedir?", createdAt: new Date() }],
      },
    },
    select: { id: true },
  });
  session = { userId: "u1", organizationId: org.id, role: "owner", email: "h@x.com", name: "h", sessionEpoch: 0 };
  return conversation.id;
}

async function modelInput(reservationStatus: string | null) {
  const id = await seed(reservationStatus);
  const res = await aiSuggest(
    new NextRequest(`http://localhost/api/conversations/${id}/ai-suggest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tone: "warm" }),
    }),
    { params: Promise.resolve({ id }) },
  );
  expect(res.status).toBe(200);
  const input = mockSuggest.mock.calls.at(-1)?.[0];
  return {
    kb: (input?.knowledgeBase ?? []).map((k) => `${k.category}|${k.title}|${k.content}`).join("\n"),
    dropped: input?.knowledgeBaseDropped ?? 0,
  };
}

beforeEach(async () => {
  await resetDb();
  __resetRateLimit();
  mockSuggest.mockReset();
  mockSuggest.mockResolvedValue(REPLY as never);
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("🚨 onaylı konaklama DIŞINDA sır modele gitmez", () => {
  for (const status of [null, "pending", "inquiry", "cancelled"] as const) {
    it(`rezervasyon: ${status ?? "yok"} → Wi-Fi / giriş talimatı / kod yok, sıradan bilgi var`, async () => {
      const { kb, dropped } = await modelInput(status);
      expect(kb).not.toMatch(/wifi\|/);
      expect(kb).not.toMatch(/checkin\|/);
      expect(kb).not.toContain("4590");
      expect(kb).toContain("Otopark");
      // Elenen üç sır kalemi "alınmadı" sayılır → istem "bilgi yok DEME, devret" notunu yazar (oto-yanıtla aynı).
      expect(dropped).toBe(3);
    });
  }
});

describe("onaylı / tamamlanmış konaklamada sır ürünün kendisi (verilir)", () => {
  for (const status of ["confirmed", "completed"] as const) {
    it(`rezervasyon: ${status} → Wi-Fi ve kod var`, async () => {
      const { kb, dropped } = await modelInput(status);
      expect(kb).toMatch(/wifi\|/);
      expect(kb).toContain("4590");
      expect(dropped).toBe(0);
    });
  }
});
