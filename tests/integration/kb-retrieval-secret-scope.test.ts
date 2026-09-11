import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { FILLERS } from "../helpers/kb-retrieval-scenarios";

// ---------------------------------------------------------------------------
// RAG dilim 3 (Codex turu 3) — GÜVENLİK SÜZGEÇLERİ HİBRİT YOLDA AYNEN KORUNUYOR MU?
//
// "Önceki KB güvenlik filtrelerinin yeni retrieval yolunda aynen korunduğunu
// doğrula; eksikse pilotu hazır sayma." Ölçülen şey modele GİDEN küme ve karar
// kaydındaki kanıt kimlikleri (model MOCK):
//   · QR: sır kategorisi (`QR_SECRET_CATEGORIES`) WHERE'de, içerik sezgiseli
//     (`withoutSecretKbItems`) sonra → hibrit seçici bu kümeyi asla göremez.
//   · Oto-yanıt: onaysız konaklamada aynı iki bacak; onaylı konaklamada sır
//     kalemi ÜRÜNDÜR (verilir) — parite legacy ile aynı.
//   · Onay kapısı: taslak hiçbir modda gelmez.
// Bayrak AÇIK ve KB küçük-KB eşiğinin üstünde (≥13 kalem) → seçim gerçekten yapılır.
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

const mockSuggest = vi.fn();
vi.mock("@/lib/ai", () => ({ suggestReply: (...a: unknown[]) => mockSuggest(...a), classifyMessage: vi.fn() }));

import { NextRequest } from "next/server";
import { POST } from "@/app/api/chat/[token]/route";
import { applyChannelAutoReply } from "@/lib/automation";
import { sendOnChannel } from "@/lib/messaging";

const DAY = 86_400_000;
const SECRET_FAQ = { category: "faq", title: "Giriş notu", content: "Kapı kodu 4590, anahtar kutusu 2288." };
const WIFI = { category: "wifi", title: "Wi-Fi", content: "Ağ LaleApt, şifre kapı arkasındaki karttadır." };
const CHECKIN = { category: "checkin", title: "Giriş talimatı", content: "Anahtar kutusu bina girişinde, sol duvarda." };
const PARKING = { category: "parking", title: "Otopark", content: "Bina altı otopark misafirler için ücretsizdir." };

async function seedKb(propertyId: string, extra: { category: string; title: string; content: string }[]) {
  const fill = FILLERS.filter((f) => !["wifi", "checkin"].includes(f.category)).slice(0, 14);
  const ids: Record<string, string> = {};
  for (const f of fill) {
    await prisma.knowledgeBaseItem.create({
      data: { propertyId, category: f.category, title: f.title, content: f.content, isActive: true, source: "host_manual", reviewState: "approved" },
    });
  }
  for (const e of extra) {
    const row = await prisma.knowledgeBaseItem.create({
      data: { propertyId, category: e.category, title: e.title, content: e.content, isActive: true, source: "host_manual", reviewState: "approved" },
    });
    ids[e.title] = row.id;
  }
  const draft = await prisma.knowledgeBaseItem.create({
    data: { propertyId, category: "parking", title: "Otopark taslak", content: "Otopark ücretlidir (taslak).", isActive: true, source: "extracted_draft", reviewState: "draft" },
  });
  ids["Otopark taslak"] = draft.id;
  return ids;
}

type Input = { knowledgeBase: { id: string; title: string; content: string }[]; knowledgeBaseSelection?: string };
const model = (reply = "Bina altı otopark ücretsizdir.") => ({
  reply,
  intent: "parking",
  riskLevel: "none",
  riskType: null,
  confidence: 0.9,
  source: "openai",
  priority: "standard",
  risk: null,
  actionSuggestion: null,
  detectedLanguage: "tr",
  usedSources: ["kb:parking"],
  sourceAudit: { declared: 1, verified: 1 },
  missingInfo: [],
  statedCheckoutTime: null,
});

describe("QR yolu — hibrit AÇIK: sır kategorisi + içerik sezgiseli + onay kapısı seçicinin ÖNÜNDE", () => {
  let seq = 0;
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("GUEST_CHAT_ENABLED", "1");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("KB_RETRIEVAL_MODE", "hybrid");
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await prisma.$disconnect();
  });

  it("wifi/checkin kategorisi, kod içeren faq kalemi ve taslak — modele GİTMEZ, kanıtta GÖRÜNMEZ; seçim yine yapılır", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const token = `qrtok_${Math.random().toString(36).slice(2)}${"x".repeat(12)}`;
    await prisma.property.update({ where: { id: propertyId }, data: { chatEnabled: true, chatToken: token } });
    await prisma.reservation.create({
      data: { propertyId, guestName: "Test Misafir", arrivalDate: new Date(Date.now() - DAY), departureDate: new Date(Date.now() + 2 * DAY), status: "confirmed", channel: "manual", currency: "EUR" },
    });
    const ids = await seedKb(propertyId, [SECRET_FAQ, WIFI, CHECKIN, PARKING]);
    mockSuggest.mockResolvedValue(model());

    // Soru bilerek sır kalemlerine SÖZCÜKSEL olarak yakın: süzgeç yoksa seçici onları getirirdi.
    const res = await POST(
      new NextRequest(`http://localhost/api/chat/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Kapı kodu ve anahtar kutusu nerede, otopark var mı?", requestId: `sc-${++seq}-${Math.random().toString(36).slice(2)}` }),
      }),
      { params: Promise.resolve({ token }) },
    );
    expect(res.status).toBe(200);
    const input = mockSuggest.mock.calls[0][0] as Input;
    expect(input.knowledgeBaseSelection).toBe("retrieved");
    const sentIds = input.knowledgeBase.map((k) => k.id);
    const sentText = input.knowledgeBase.map((k) => `${k.title} ${k.content}`).join("\n");
    for (const forbidden of ["Giriş notu", "Wi-Fi", "Giriş talimatı", "Otopark taslak"]) {
      expect(sentIds, forbidden).not.toContain(ids[forbidden]);
    }
    expect(sentText).not.toMatch(/4590|2288|LaleApt|Anahtar kutusu bina/);
    expect(sentIds).toContain(ids["Otopark"]);

    const ev = await prisma.riskEvent.findFirstOrThrow({ where: { organizationId: orgId, surface: "guest_chat" } });
    const evidence = JSON.parse(String(ev.kbEvidenceJson)) as { retrieved: { id: string }[]; retrieval: { mode: string } };
    expect(evidence.retrieval.mode).toBe("hybrid");
    const evIds = evidence.retrieved.map((r) => r.id);
    for (const forbidden of ["Giriş notu", "Wi-Fi", "Giriş talimatı", "Otopark taslak"]) expect(evIds, forbidden).not.toContain(ids[forbidden]);
    // Misafire dönen gövde sır taşımaz (model mock cevabı otopark).
    const body = JSON.stringify(await res.json());
    expect(body).not.toMatch(/4590|2288|LaleApt/);
  });
});

describe("Oto-yanıt yolu — hibrit AÇIK: onaysız konaklamada sır bacakları, onaylıda ürün davranışı (legacy paritesi)", () => {
  async function seed(status: string | null) {
    const org = await prisma.organization.create({
      data: { name: "Test Org", autoReplyHospitable: true, autoReplyStartHour: 0, autoReplyEndHour: 0, timezone: "Europe/Istanbul" },
    });
    const property = await prisma.property.create({ data: { organizationId: org.id, name: "Deniz Daire" } });
    const reservation = status
      ? await prisma.reservation.create({
          data: { propertyId: property.id, guestName: "Alex", arrivalDate: new Date(Date.now() - DAY), departureDate: new Date(Date.now() + 2 * DAY), status, channel: "airbnb", currency: "EUR", sourceReference: "res-1" },
        })
      : null;
    const conversation = await prisma.conversation.create({
      data: {
        propertyId: property.id,
        channel: "airbnb",
        guestIdentifier: "Alex",
        status: "new",
        externalReservationId: "res-1",
        reservationId: reservation?.id ?? null,
        messages: { create: [{ direction: "inbound", senderName: "Alex", body: "Kapı kodu ve anahtar kutusu nerede, otopark var mı?", createdAt: new Date(Date.now() - 60_000) }] },
      },
      select: { id: true },
    });
    const ids = await seedKb(property.id, [SECRET_FAQ, WIFI, CHECKIN, PARKING]);
    return { orgId: org.id, conversationId: conversation.id, ids };
  }

  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("KB_RETRIEVAL_MODE", "hybrid");
    mockSuggest.mockResolvedValue(model());
    vi.mocked(sendOnChannel).mockResolvedValue({ ok: true, externalId: "ext-1" } as never);
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await prisma.$disconnect();
  });

  it("REZERVASYONSUZ (aday) misafir: wifi/checkin ve kod içeren kalem seçiciye ULAŞMAZ; taslak hiç gelmez", async () => {
    const { conversationId, ids } = await seed(null);
    await applyChannelAutoReply(conversationId);
    expect(mockSuggest).toHaveBeenCalledTimes(1);
    const input = mockSuggest.mock.calls[0][0] as Input;
    expect(input.knowledgeBaseSelection).toBe("retrieved");
    const sentIds = input.knowledgeBase.map((k) => k.id);
    for (const forbidden of ["Giriş notu", "Wi-Fi", "Giriş talimatı", "Otopark taslak"]) expect(sentIds, forbidden).not.toContain(ids[forbidden]);
    expect(sentIds).toContain(ids["Otopark"]);
  });

  it("ONAYLI konaklama: kapı kodu/wifi kalemi ÜRÜNDÜR — seçici onları getirebilir (legacy ile aynı sözleşme); taslak yine gelmez", async () => {
    const { conversationId, ids } = await seed("confirmed");
    await applyChannelAutoReply(conversationId);
    expect(mockSuggest).toHaveBeenCalledTimes(1);
    const input = mockSuggest.mock.calls[0][0] as Input;
    expect(input.knowledgeBaseSelection).toBe("retrieved");
    const sentIds = input.knowledgeBase.map((k) => k.id);
    expect(sentIds).toContain(ids["Giriş notu"]);
    expect(sentIds).not.toContain(ids["Otopark taslak"]);
  });
});
