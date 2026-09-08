import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

// ---------------------------------------------------------------------------
// QR ASİSTANI KONUŞMA BAĞLAMI (kurucu AI kalite turu, 2026-09-08).
//
// 🚨 ÖLÇÜLEN AÇIK: QR modeli `history: []` ile çağrılıyordu — asistan aynı
// sohbette bir önceki cümleyi GÖRMÜYORDU. Sonuçları canlıda gözlendi: konu
// değişimi anlaşılmıyor, selamlaşma tekrar ediliyor, "buldum teşekkürler" gibi
// kapanışlar bir soru gibi işleniyor, peş peşe yazılan mesajlar birbirinden
// kopuk değerlendiriliyor. (Inbox yolu geçmişi ZATEN veriyordu — asimetriydi.)
//
// SÖZLEŞME: modele KRONOLOJİK konuşma geçmişi verilir; yön (misafir/operatif)
// mesajın KENDİ alanından türetilir (görünen ad değil), sistem olayları ve
// gövdesiz satırlar dışarıda kalır, tavan uygulanır ve GÜNCEL mesaj geçmişte
// TEKRARLANMAZ (ayrı alanda gider).
// ---------------------------------------------------------------------------

vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn().mockResolvedValue(undefined) };
});

const mockSuggest = vi.fn();
vi.mock("@/lib/ai", () => ({ suggestReply: (...a: unknown[]) => mockSuggest(...a) }));

import { NextRequest } from "next/server";
import { POST } from "@/app/api/chat/[token]/route";
import { ensureGuestChatConversation } from "@/lib/guest-chat";

const DAY = 86_400_000;

async function seed() {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const token = `qrtok_${Math.random().toString(36).slice(2)}${"x".repeat(12)}`;
  await prisma.property.update({
    where: { id: propertyId },
    data: { chatEnabled: true, chatToken: token, checkInTime: "15:00", checkOutTime: "11:00" },
  });
  const reservation = await prisma.reservation.create({
    data: {
      propertyId,
      guestName: "Test Misafir",
      arrivalDate: new Date(Date.now() - DAY),
      departureDate: new Date(Date.now() + 2 * DAY),
      status: "confirmed",
      channel: "manual",
      currency: "EUR",
    },
  });
  return { orgId, propertyId, token, reservation };
}

let seq = 0;
/** Cihaz bağlama gerçek üründe per-stay çerezle yapılır; testte aynı cihazdan
 *  devam etmek için ilk yanıtın çerezi taşınır (aksi hâlde "başka cihaz" kapanır). */
const ask = (token: string, message: string, cookie?: string) => {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers.cookie = cookie;
  return POST(
    new NextRequest(`http://localhost/api/chat/${token}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ message, requestId: `ctx-${++seq}-${Math.random().toString(36).slice(2)}` }),
    }),
    { params: Promise.resolve({ token }) },
  );
};
const cookieOf = (res: Response) => res.headers.get("set-cookie")?.split(";")[0] ?? undefined;

const okReply = (over: Record<string, unknown> = {}) => ({
  reply: "Tabii, yardımcı olayım.",
  intent: "general",
  riskLevel: "none",
  riskType: null,
  confidence: 0.9,
  source: "openai",
  priority: "standard",
  ...over,
});

type Hist = { direction: string; body: string };
const lastHistory = (): Hist[] => (mockSuggest.mock.calls.at(-1)?.[0] as { history?: Hist[] }).history ?? [];

describe("QR asistanı — konuşma bağlamı modele verilir", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("GUEST_CHAT_ENABLED", "1");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    mockSuggest.mockResolvedValue(okReply());
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await prisma.$disconnect();
  });

  it("🚨 ikinci mesajda önceki tur modele KRONOLOJİK geçmiş olarak gider", async () => {
    const { token } = await seed();
    const first = await ask(token, "Merhaba, nasılsın?");
    await ask(token, "Çöpü nereye atabiliriz?", cookieOf(first));

    const hist = lastHistory();
    expect(hist.length).toBeGreaterThanOrEqual(2);
    expect(hist[0]).toEqual({ direction: "inbound", body: "Merhaba, nasılsın?" });
    expect(hist[1]).toEqual({ direction: "outbound", body: "Tabii, yardımcı olayım." });
    // GÜNCEL mesaj geçmişte TEKRARLANMAZ (ayrı `guestMessage` alanında gider).
    expect(hist.some((h) => h.body === "Çöpü nereye atabiliriz?")).toBe(false);
  });

  it("ilk mesajda geçmiş boştur (uydurma bağlam yok)", async () => {
    const { token } = await seed();
    await ask(token, "Merhaba");
    expect(lastHistory()).toEqual([]);
  });

  it("yön mesajın KENDİ alanından gelir: host yanıtı da 'outbound' olarak görünür", async () => {
    const { token, propertyId, reservation } = await seed();
    const conversationId = await ensureGuestChatConversation(propertyId, { id: reservation.id, guestName: reservation.guestName });
    await prisma.message.create({
      data: { conversationId, direction: "inbound", authorType: "guest", senderName: "Test Misafir", body: "Klima bozuk.", language: "tr" },
    });
    // ⚠️ HOST mesajı KULLANILMAZ: host yanıtı AI'yı bilinçli olarak duraklatır
    // (`guestChatAiPaused`) — o dalda model hiç çağrılmaz. Burada sınanan şey
    // yönün `direction` alanından türediği; `senderName` bilerek yanıltıcı.
    await prisma.message.create({
      data: { conversationId, direction: "outbound", authorType: "ai", senderName: "MİSAFİR gibi görünen ad", body: "Ustayı yolluyorum.", language: "tr" },
    });

    await ask(token, "Peki çöp nereye?");
    const hist = lastHistory();
    expect(hist).toEqual([
      { direction: "inbound", body: "Klima bozuk." },
      { direction: "outbound", body: "Ustayı yolluyorum." },
    ]);
  });

  it("SİSTEM OLAYLARI ve gövdesiz satırlar geçmişe girmez", async () => {
    const { token, propertyId, reservation } = await seed();
    const conversationId = await ensureGuestChatConversation(propertyId, { id: reservation.id, guestName: reservation.guestName });
    await prisma.message.create({
      data: { conversationId, direction: "inbound", authorType: "guest", senderName: "x", body: "Wifi şifresi?", language: "tr" },
    });
    await prisma.message.create({
      data: {
        conversationId, direction: "outbound", authorType: "system", senderName: "sistem",
        body: "", language: "tr", systemEventType: "handoff",
      },
    });

    await ask(token, "Teşekkürler, buldum.");
    const hist = lastHistory();
    expect(hist).toEqual([{ direction: "inbound", body: "Wifi şifresi?" }]);
  });

  it("TAVAN: uzun sohbette yalnız son turlar gider (istem bütçesi korunur) ve sıra kronolojik kalır", async () => {
    const { token, propertyId, reservation } = await seed();
    const conversationId = await ensureGuestChatConversation(propertyId, { id: reservation.id, guestName: reservation.guestName });
    for (let i = 1; i <= 20; i++) {
      await prisma.message.create({
        data: { conversationId, direction: "inbound", authorType: "guest", senderName: "x", body: `soru ${i}`, language: "tr" },
      });
    }

    await ask(token, "son soru");
    const hist = lastHistory();
    // Tavan MESAJ cinsinden (24 ≈ 12 tur) — ayrıntılı sınır testleri
    // `qr-context-window` dosyasında; burada yalnız "tavan var ve pencere
    // kronolojik" iddiası pinlenir.
    expect(hist.length).toBeLessThanOrEqual(24);
    expect(hist.at(-1)?.body).toBe("soru 20"); // en yeni sonda
    expect(hist[0]?.body).toBe(`soru ${20 - hist.length + 1}`); // kronolojik pencere
  });
});
