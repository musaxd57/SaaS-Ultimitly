import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

// ---------------------------------------------------------------------------
// QR YER TUTUCU PARİTESİ (09-10) — ölçülen boşluk, davranışsal pin.
//
// Oto-yanıt (`automation.ts`) ve inbox önerisi (`ai-suggest`) KB içeriğindeki
// `{isim}`/`{daire}` yer tutucularını modele GİRMEDEN ÖNCE çözüyordu; halka
// açık QR asistanı ÇÖZMÜYORDU. Host'un karşılama şablonu ("Merhaba {isim},
// {daire} numaralı daireye hoş geldiniz") bilgi tabanında duruyorsa misafire
// ham "{isim}" gidebiliyordu — ve E4 turunda eklenen `packKnowledgeBase`
// yer tutucu notu `{…}` sınıfını BİLEREK dışarıda bırakıyor (ikame çağıranın
// işi), yani QR'da ne ikame ne uyarı vardı.
//
// 🚨 QR'DA GERÇEK MİSAFİR ADI KULLANILMAZ (gerekçe `kb-placeholders.ts`):
// sohbeti açan kişi rezervasyon sahibi olmayabilir → "misafirimiz".
// ---------------------------------------------------------------------------

vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn().mockResolvedValue(undefined) };
});

const mockSuggest = vi.fn();
const mockClassify = vi.fn();
vi.mock("@/lib/ai", () => ({
  suggestReply: (...a: unknown[]) => mockSuggest(...a),
  classifyMessage: (...a: unknown[]) => mockClassify(...a),
}));
vi.mock("@/lib/messaging", async (orig) => ({
  ...(await orig<typeof import("@/lib/messaging")>()),
  sendOnChannel: vi.fn(async () => ({ ok: true, kind: "sent" })),
}));
vi.mock("@/lib/hospitable-credentials", () => ({
  getOrgHospitableToken: vi.fn().mockResolvedValue("test-token"),
}));
vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) },
}));

import { NextRequest } from "next/server";
import { POST } from "@/app/api/chat/[token]/route";
import { applyChannelAutoReply } from "@/lib/automation";
import { GUEST_NAME_FALLBACK } from "@/lib/kb-placeholders";

const DAY = 86_400_000;
const GUEST = "Ayşe Yılmaz";
// ⚠️ İçerik sır kapısını TETİKLEMEYECEK şekilde seçildi: "anahtar kutusu … kapı" dizisi
// `looksLikeSecret` kalıbına takılıyor ve kalem daha ikameye gelmeden eleniyor (ölçüldü).
const WELCOME = "Merhaba {isim}, {daire} numaralı daireye hoş geldiniz. Havlular dolapta.";

async function seed(propertyName = "lale 7") {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const token = `qrtok_${Math.random().toString(36).slice(2)}${"x".repeat(12)}`;
  await prisma.property.update({
    where: { id: propertyId },
    data: { chatEnabled: true, chatToken: token, name: propertyName, checkInTime: "15:00", checkOutTime: "11:00" },
  });
  await prisma.reservation.create({
    data: {
      propertyId,
      guestName: GUEST,
      arrivalDate: new Date(Date.now() - DAY),
      departureDate: new Date(Date.now() + 2 * DAY),
      status: "confirmed",
      channel: "manual",
      currency: "EUR",
    },
  });
  await prisma.knowledgeBaseItem.create({
    data: {
      propertyId,
      category: "welcome",
      title: "Karşılama",
      content: WELCOME,
      isActive: true,
      source: "host_manual",
      reviewState: "approved",
    },
  });
  return { orgId, token };
}

let seq = 0;
const ask = (token: string, message: string) =>
  POST(
    new NextRequest(`http://localhost/api/chat/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, requestId: `ph-${++seq}-${Math.random().toString(36).slice(2)}` }),
    }),
    { params: Promise.resolve({ token }) },
  );

const model = () => ({
  reply: "Havlular dolapta.",
  intent: "checkin",
  riskLevel: "none",
  riskType: null,
  confidence: 0.9,
  source: "openai",
  priority: "standard",
  usedSources: ["kb:welcome"],
  missingInfo: [],
  sourceAudit: { declared: 1, verified: 1 },
});

type Input = { knowledgeBase: { content: string }[] };

describe("QR — KB yer tutucuları modele GİRMEDEN çözülür", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("GUEST_CHAT_ENABLED", "1");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("KB_RETRIEVAL_MODE", "");
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await prisma.$disconnect();
  });

  it("{daire} daire numarasına, {isim} 'misafirimiz'e çözülür; ham belirteç modele GİTMEZ", async () => {
    const { token } = await seed("lale 7");
    mockSuggest.mockResolvedValue(model());
    const res = await ask(token, "Havlu nerede?");
    expect(res.status).toBe(200);
    const input = mockSuggest.mock.calls[0][0] as Input;
    const kbText = input.knowledgeBase.map((k) => k.content).join("\n");
    expect(kbText).toContain(`Merhaba ${GUEST_NAME_FALLBACK}, 7 numaralı daireye`);
    expect(kbText).not.toContain("{isim}");
    expect(kbText).not.toContain("{daire}");
  });

  it("🚨 GİZLİLİK: rezervasyon sahibinin gerçek adı QR bağlamına GİRMEZ (sohbeti açan kişi o olmayabilir)", async () => {
    const { token } = await seed();
    mockSuggest.mockResolvedValue(model());
    await ask(token, "Havlu nerede?");
    const input = mockSuggest.mock.calls[0][0] as Input;
    expect(input.knowledgeBase.map((k) => k.content).join("\n")).not.toContain("Ayşe");
  });

  it("🚨 mülk adında sayı yoksa {daire} DOKUNULMADAN kalır (mülk adı ikame EDİLMEZ)", async () => {
    // İnceleme turu 5 (ölçüldü): `apartmentNumberOf` eskiden MÜLK ADININ TAMAMINI dönüyordu
    // ve ikame doğrudan yapılıyordu → "Kapı kodu: {daire}" satırı misafire
    // "Kapı kodu: Deniz Manzara" olarak gidiyordu. Anlamsız ikame yerine belirteç görünür kalır.
    const { token } = await seed("Deniz Manzara");
    mockSuggest.mockResolvedValue(model());
    await ask(token, "Havlu nerede?");
    const input = mockSuggest.mock.calls[0][0] as Input;
    const kb = input.knowledgeBase.map((k) => k.content).join("\n");
    expect(kb).not.toContain("Deniz Manzara numaralı daireye");
    expect(kb).toContain("{daire} numaralı daireye");
  });

  it("İKAME SIR KAPISINI GEVŞETMEZ: İÇERİK sezgiseli (kategori bacağı DEĞİL) kod taşıyan kalemi eler", async () => {
    // 🚨 İlk yazımda kalem `category:"wifi"` idi ve `QR_SECRET_CATEGORIES` onu SQL düzeyinde
    // eliyordu — `looksLikeSecret` hiç çalışmıyordu, yani test SAHTE YEŞİLDİ (inceleme 09-10).
    // Kategori `general`: eleme YALNIZ içerik sezgiseliyle olabilir.
    const { token } = await seed();
    const property = await prisma.property.findFirstOrThrow({ where: { chatToken: { not: null } } });
    await prisma.knowledgeBaseItem.create({
      data: {
        propertyId: property.id,
        category: "general",
        title: "Notlar",
        content: "Merhaba {isim}, kapı kodu 84726193.",
        isActive: true,
        source: "host_manual",
        reviewState: "approved",
      },
    });
    mockSuggest.mockResolvedValue(model());
    await ask(token, "Kapı kodu nedir?");
    const input = mockSuggest.mock.calls[0][0] as Input;
    const kbText = input.knowledgeBase.map((k) => k.content).join("\n");
    expect(kbText).not.toContain("84726193");
    expect(kbText).not.toContain("{isim}");
    // 🚨 ANTI-VACUITY (inceleme turu 6): iki assert de NEGATİF — `knowledgeBase` herhangi bir
    // sebeple boş dönseydi test sessizce yeşil kalırdı. Zararsız kalemin GİRDİĞİNİ de ölç.
    expect(kbText).toContain("Havlular dolapta");
  });

  it("🚨 İKAME SONRASI DA TARANIR: mülk adı 'Daire 4590' iken 'Kapı: {daire}' kalemi modele GİTMEZ (oto-yanıt yoluyla parite)", async () => {
    const { token } = await seed("Daire 4590");
    const property = await prisma.property.findFirstOrThrow({ where: { chatToken: { not: null } } });
    await prisma.knowledgeBaseItem.create({
      data: {
        propertyId: property.id,
        category: "general",
        title: "Giriş",
        content: "Kapı: {daire}",
        isActive: true,
        source: "host_manual",
        reviewState: "approved",
      },
    });
    mockSuggest.mockResolvedValue(model());
    await ask(token, "Kapı nerede?");
    const input = mockSuggest.mock.calls[0][0] as Input;
    const kbText = input.knowledgeBase.map((k) => k.content).join("\n");
    // Ham hâli ("Kapı: {daire}") sır kalıbına UYMAZ; ikame sonrası ("Kapı: 4590") UYAR → kalem düşer.
    expect(kbText).not.toContain("Kapı: 4590");
    expect(kbText).not.toContain("{daire}");
    // 🚨 ELEME HEDEFLİ: karşılama kalemi (aynı daire numarasını taşır ama sır kalıbına uymaz) KALIR.
    // Yani düşen şey "4590 rakamı" değil, "giriş adı + kod" BİÇİMİ.
    expect(kbText).toContain(`Merhaba ${GUEST_NAME_FALLBACK}, 4590 numaralı daireye`);
  });
});

// ---------------------------------------------------------------------------
// OTO-YANIT YOLU — aynı ikame, FARKLI ad kaynağı (muhatap KANITLI rezervasyon sahibi).
// Bu yol ikameyi zaten yapıyordu ama HİÇBİR test onu pinlemiyordu: mutasyon turunda
// "otomasyon KB ikamesi kapalı" mutantı HAYATTA KALDI (09-10) → bu blok o boşluğu kapatır.
// ---------------------------------------------------------------------------
describe("Oto-yanıt — KB yer tutucuları GERÇEK ada çözülür (QR'dan farklı, bilinçli)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("KB_RETRIEVAL_MODE", "");
  });

  async function seedChannel(guestIdentifier: string, propertyName = "lale 7") {
    const org = await prisma.organization.create({
      data: { name: "Test Org", autoReplyHospitable: true, autoReplyStartHour: 0, autoReplyEndHour: 0, timezone: "Europe/Istanbul" },
    });
    const property = await prisma.property.create({ data: { organizationId: org.id, name: propertyName } });
    await prisma.knowledgeBaseItem.create({
      data: {
        propertyId: property.id,
        category: "welcome",
        title: "Karşılama",
        content: WELCOME,
        isActive: true,
        source: "host_manual",
        reviewState: "approved",
      },
    });
    const conversation = await prisma.conversation.create({
      data: {
        propertyId: property.id,
        channel: "airbnb",
        guestIdentifier,
        status: "new",
        externalReservationId: "res-ph-1",
        messages: {
          create: [{ direction: "inbound", senderName: guestIdentifier, body: "Havlu nerede?", createdAt: new Date(Date.now() - 60_000) }],
        },
      },
      select: { id: true },
    });
    return conversation.id;
  }

  it("{isim} misafirin GERÇEK ilk adına, {daire} daire numarasına çözülür (ham belirteç modele gitmez)", async () => {
    const conversationId = await seedChannel(GUEST);
    mockSuggest.mockResolvedValue({ ...model(), risk: null, actionSuggestion: null, detectedLanguage: "tr", statedCheckoutTime: null });
    await applyChannelAutoReply(conversationId);
    expect(mockSuggest).toHaveBeenCalledTimes(1);
    const input = mockSuggest.mock.calls[0][0] as Input;
    const kbText = input.knowledgeBase.map((k) => k.content).join("\n");
    expect(kbText).toContain("Merhaba Ayşe, 7 numaralı daireye");
    expect(kbText).not.toContain("{isim}");
    expect(kbText).not.toContain("{daire}");
  });

  it("yer tutucu AD ('Rezervasyon 12345') gerçek ad sayılmaz → nötr hitaba düşer", async () => {
    const conversationId = await seedChannel("Rezervasyon 12345");
    mockSuggest.mockResolvedValue({ ...model(), risk: null, actionSuggestion: null, detectedLanguage: "tr", statedCheckoutTime: null });
    await applyChannelAutoReply(conversationId);
    const input = mockSuggest.mock.calls[0][0] as Input;
    const kbText = input.knowledgeBase.map((k) => k.content).join("\n");
    expect(kbText).toContain(`Merhaba ${GUEST_NAME_FALLBACK},`);
    expect(kbText).not.toContain("Rezervasyon 12345");
  });
});
