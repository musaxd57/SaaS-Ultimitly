import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// 3d (kurucu 11-11) — "AI ÖNER" ROTASI, YAPAY ZEKÂ YOKKEN. Yedek yol taslak üretemediyse (boş döndü) rota son misafir mesajında kayıtlı
// duran ÖNCEKİ taslağın üstüne boş yazmaz: model arızası ev sahibinin elindeki taslağı silmesin. Cevap modeli MOCK; DB gerçek.
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

const RESULT = {
  intent: "refund",
  confidence: 0.6,
  reply: "",
  risk: "İade/ücret talebi. Finansal karar gerektirir, yönetici onayı şart.",
  priority: "standard" as const,
  source: "fallback" as const,
  actionSuggestion: "Mali durumu inceleyin ve 24 saat içinde misafire dönüş yapın.",
  riskLevel: "medium" as const,
  detectedLanguage: "tr",
  riskType: null,
  usedSources: [],
  sourceAudit: { declared: 0, verified: 0 },
  missingInfo: [],
  statedCheckoutTime: null,
};

async function seed(storedDraft: string | null) {
  const org = await prisma.organization.create({ data: { name: "Test Org" } });
  await prisma.user.create({ data: { organizationId: org.id, name: "h", email: "h@x.com", passwordHash: "x", role: "owner" } });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale", checkInTime: "15:00", checkOutTime: "11:00" } });
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      channel: "airbnb",
      guestIdentifier: "Ada",
      status: "new",
      messages: {
        create: [
          { direction: "inbound", senderName: "Ada", body: "Paramı geri istiyorum.", createdAt: new Date(Date.now() - 60_000), aiSuggestedReply: storedDraft, aiConfidence: storedDraft ? 0.8 : null, aiIntent: storedDraft ? "refund" : null },
        ],
      },
    },
    select: { id: true, messages: { select: { id: true } } },
  });
  session = { userId: "u1", organizationId: org.id, role: "owner", email: "h@x.com", name: "h", sessionEpoch: 0 };
  return { id: conversation.id, messageId: conversation.messages[0].id };
}

async function suggest(id: string) {
  const res = await aiSuggest(
    new NextRequest(`http://localhost/api/conversations/${id}/ai-suggest`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) }),
    { params: Promise.resolve({ id }) },
  );
  return { status: res.status, body: (await res.json()) as { reply?: string; source?: string; risk?: string | null; anchorMessageId?: string } };
}
const stored = (messageId: string) => prisma.message.findUniqueOrThrow({ where: { id: messageId }, select: { aiSuggestedReply: true, aiConfidence: true, aiIntent: true } });

describe("POST /api/conversations/[id]/ai-suggest — model yokken taslak yok (3d)", () => {
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

  it("🚨 yedek yol boş taslak döndü → yanıt boş taslak + risk notu; kayıtlı ÖNCEKİ taslak ve güveni AYNEN kalır", async () => {
    const { id, messageId } = await seed("Önceki taslak metni.");
    mockSuggest.mockResolvedValueOnce(RESULT as never);
    const out = await suggest(id);
    expect(out.status).toBe(200);
    expect(out.body.reply).toBe("");
    expect(out.body.source).toBe("fallback");
    expect(out.body.risk).toContain("İade");
    expect(await stored(messageId)).toEqual({ aiSuggestedReply: "Önceki taslak metni.", aiConfidence: 0.8, aiIntent: "refund" }); // ⬅️ ESKİDE hazır cümle üstüne yazılırdı
  });

  it("kayıtlı taslak yokken de boş taslak YAZILMAZ; KONU etiketi kaydedilir (rapor verisi kaybolmaz)", async () => {
    const { id, messageId } = await seed(null);
    mockSuggest.mockResolvedValueOnce(RESULT as never);
    expect((await suggest(id)).status).toBe(200);
    expect(await stored(messageId)).toEqual({ aiSuggestedReply: null, aiConfidence: null, aiIntent: "refund" });
  });

  it("🚨 yedek yolun SOMUT bilgiden kurduğu taslak yanıtta döner ama mesaja KAYDEDİLMEZ — kayıtlı taslak yalnız yapay zekânındır", async () => {
    // Kayıtta taslağın kaynağı tutulmuyor: yedek taslak kaydedilseydi sayfa yeniden açılınca "AI bu taslağı sizin için hazırladı" diye,
    // "soruya uygunluğunu kontrol edin" uyarısı olmadan görünürdü.
    const { id, messageId } = await seed("Önceki taslak metni.");
    mockSuggest.mockResolvedValueOnce({ ...RESULT, intent: "wifi", confidence: 0.9, reply: "Merhaba Ada,\n\nWi-Fi bilgileri: Ağ LaleApt, şifre 12345678", risk: null, usedSources: ["kb:wifi"] } as never);
    expect((await suggest(id)).body.reply).toContain("12345678");
    expect(await stored(messageId)).toEqual({ aiSuggestedReply: "Önceki taslak metni.", aiConfidence: 0.8, aiIntent: "refund" }); // ⬅️ (ilk yazımda) şifre taslağı üstüne yazılıyordu
  });

  it("yedek yol + kayıtlı taslak yok: somut taslak da kaydedilmez, yalnız konu", async () => {
    const { id, messageId } = await seed(null);
    mockSuggest.mockResolvedValueOnce({ ...RESULT, intent: "wifi", confidence: 0.9, reply: "Merhaba Ada,\n\nWi-Fi bilgileri: Ağ LaleApt, şifre 12345678", risk: null, usedSources: ["kb:wifi"] } as never);
    await suggest(id);
    expect(await stored(messageId)).toEqual({ aiSuggestedReply: null, aiConfidence: null, aiIntent: "wifi" });
  });

  // S1 (kurucu kararı 11-11): yanıt, önerinin üretildiği andaki konuşma sonunu taşır — "Onayla ve gönder" onu geri yollar ve gönderim
  // işleminin kimliği olur (iki yönetici aynı öneriyi onaylarsa tek mesaj).
  it("🚨 S1: yanıt konuşma sonunu taşır — son gerçek mesaj; otomatik şablon mesajı sayılmaz, ekibin cevabı sayılır", async () => {
    const { id, messageId } = await seed(null);
    const model = { ...RESULT, source: "openai", reply: "İade koşullarımız rezervasyon sayfasında yazıyor." };
    mockSuggest.mockResolvedValue(model as never);
    expect((await suggest(id)).body.anchorMessageId).toBe(messageId); // son mesaj misafirin mesajı

    // Araya otomatik şablon mesajı (karşılama) girdi: konuşma sonu yine misafirin mesajı.
    await prisma.message.create({ data: { conversationId: id, direction: "outbound", authorType: "automation", senderName: "GuestOps AI", body: "Hoş geldiniz." } });
    expect((await suggest(id)).body.anchorMessageId).toBe(messageId); // ⬅️ otomatik mesaj sayılsaydı iki yöneticinin kimliği ayrışabilirdi

    // Kuyrukta İPTAL edilmiş (misafire hiç ulaşmamış) giden satır da konuşma sonu değildir — kayıtlı taslak da onu atlar; atlanmasaydı
    // aynı misafir mesajı için kayıtlı taslak ile yeni öneri iki ayrı işlem kimliğine düşerdi (Opus incelemesi 11-11).
    const conv = await prisma.conversation.findUniqueOrThrow({ where: { id }, select: { property: { select: { organizationId: true } } } });
    for (const status of ["canceled", "failed", "blocked"]) {
      const dead = await prisma.message.create({ data: { conversationId: id, direction: "outbound", authorType: "ai", senderName: "GuestOps AI", body: `Gitmeyen cevap (${status}).` } });
      await prisma.messageOutbox.create({
        data: { organizationId: conv.property.organizationId, conversationId: id, messageId: dead.id, messageType: "ai", channel: "airbnb", body: dead.body, status, idempotencyKey: `k-${status}` },
      });
      expect((await suggest(id)).body.anchorMessageId, status).toBe(messageId); // ⬅️ (ilk yazımda) o gitmeyen satırın kimliği
    }

    // Ekip cevap yazdı: bundan sonra üretilen öneri YENİ bir işlemdir (konuşma sonu o cevap).
    const reply = await prisma.message.create({ data: { conversationId: id, direction: "outbound", authorType: "host", senderName: "Ekip", body: "Bakıyorum." } });
    expect((await suggest(id)).body.anchorMessageId).toBe(reply.id);
  });

  it("KONTROL: MODELİN cevabı (boş olsa da) eski kuralla kaydedilir — istisna yalnız 'model yok + taslak yok'", async () => {
    const { id, messageId } = await seed("Önceki taslak metni.");
    mockSuggest.mockResolvedValueOnce({ ...RESULT, source: "openai", reply: "İade koşullarımız rezervasyon sayfasında yazıyor." } as never);
    await suggest(id);
    expect((await stored(messageId)).aiSuggestedReply).toBe("İade koşullarımız rezervasyon sayfasında yazıyor.");
    mockSuggest.mockResolvedValueOnce({ ...RESULT, source: "openai", reply: "" } as never);
    await suggest(id);
    expect((await stored(messageId)).aiSuggestedReply).toBe("");
  });
});
