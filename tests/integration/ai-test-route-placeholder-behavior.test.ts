import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// "AI'YI DENEYİN" — YER TUTUCU DAVRANIŞI (09-12 incelemesi bunu ZORLADI).
//
// 🚨 NEDEN AYRI DOSYA: kusur önce yalnız KAYNAK TARAMASIYLA pinlenmişti
// (`tests/unit/ai-test-route-placeholder-parity.test.ts`) ve o pin YAŞAYAN BİR
// MUTANT bırakıyordu:
//     fillGuestPlaceholdersInItems(kbRaw, { ... });   // dönüş DEĞERİ atılır
//     const kb = kbRaw;                               // ham belirteç modele gider
// İthal duruyor, fonksiyon adı duruyor, eski regex yok — DÖRT İDDİANIN DÖRDÜ DE
// GEÇER ve 09-12'de kapatılan kusur sessizce geri gelir.
//
// Ders aynı turda iki kez çıktı (QR bağlantı pini de mutasyonla böyle bulundu):
// KAYNAK TARAMASI TEK YÖNLÜDÜR — metin durur, davranış ölür.
//
// Bu dosya modeli MOCK'layıp `suggestReply`a GERÇEKTEN giden bilgi tabanını
// okur: yer tutucu çözüldü mü, ve ORTAK MODÜLÜN kuralıyla mı çözüldü.
// ---------------------------------------------------------------------------

let session: SessionPayload | null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

const mockSuggest = vi.fn();
vi.mock("@/lib/ai", () => ({ suggestReply: (...a: unknown[]) => mockSuggest(...a) }));

import { POST } from "@/app/api/ai/test/route";

const DRAFT = {
  reply: "Tamamdır.",
  intent: "general",
  riskLevel: "none",
  riskType: null,
  confidence: 0.9,
  source: "openai",
  priority: "standard",
  risk: null,
  actionSuggestion: null,
  detectedLanguage: "tr",
  usedSources: [],
  sourceAudit: { declared: 0, verified: 0 },
  missingInfo: [],
  statedCheckoutTime: null,
};

const req = (body: unknown) =>
  new NextRequest("http://localhost/api/ai/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const ctx = { params: Promise.resolve({}) };

/** `suggestReply`a giden KB kalemlerini okur (rota bunu döndürmez). */
function kbSentToModel(): { title?: string; content: string }[] {
  expect(mockSuggest, "model hiç çağrılmadı").toHaveBeenCalled();
  const arg = mockSuggest.mock.calls.at(-1)?.[0] as { knowledgeBase: { content: string }[] };
  return arg.knowledgeBase;
}

async function seed(propertyName: string, kbContent: string, kbTitle = "Kapı") {
  const { orgId, propertyId } = await makeOrgWithProperty();
  await prisma.property.update({ where: { id: propertyId }, data: { name: propertyName } });
  await prisma.knowledgeBaseItem.create({
    data: {
      // `KnowledgeBaseItem` org'a DOĞRUDAN bağlı değil — kapsam mülk üzerinden.
      propertyId,
      category: "checkin",
      title: kbTitle,
      content: kbContent,
      isActive: true,
      source: "host_manual",
      reviewState: "approved",
      approvedAt: new Date(),
    },
  });
  const user = await prisma.user.create({
    data: { organizationId: orgId, name: "O", email: `o${Date.now()}${Math.random()}@x.com`, passwordHash: "x", role: "owner" },
  });
  session = { userId: user.id, organizationId: orgId, role: "owner", email: user.email, name: "O", sessionEpoch: 0 };
  return { orgId, propertyId };
}

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  session = null;
  mockSuggest.mockResolvedValue(DRAFT);
  vi.stubEnv("OPENAI_API_KEY", "test-key");
});

describe("AI test kartı — modele giden KB'de yer tutucular", () => {
  it("🚨 ORTAK MODÜLÜN daire kuralı uygulanır (eski 'son sayı' kuralı DEĞİL)", async () => {
    // Ölçülen kusur: eski kural KAT numarasını ("3") daire sanıyordu.
    await seed("No:12 D:5 Kat:3", "Kapı kodu: {daire}");
    const res = await POST(req({ message: "Kapı kodu nedir?" }), ctx);
    expect(res.status).toBe(200);

    const kb = kbSentToModel();
    expect(kb[0].content).toBe("Kapı kodu: 5");
    expect(kb[0].content).not.toContain("3");
  });

  it("🚨 SAYAÇ daire numarası SAYILMAZ → belirteç dokunulmadan kalır", async () => {
    // Eski kural "4"ü (kapasite) basıyordu; ortak modül `null` döner ve uydurma
    // değer YAZMAZ.
    await seed("Trabzon 4 Kişilik Daire", "Kapı kodu: {daire}");
    await POST(req({ message: "Kapı kodu nedir?" }), ctx);

    expect(kbSentToModel()[0].content).toBe("Kapı kodu: {daire}");
  });

  it("🚨 SAYISIZ adda MÜLK ADININ TAMAMI basılmaz", async () => {
    // Eski dalın `?? property.name` düşüşü: "Kapı kodu: Cozy Seaside Flat".
    await seed("Cozy Seaside Flat", "Kapı kodu: {daire}");
    await POST(req({ message: "Kapı kodu nedir?" }), ctx);

    const c = kbSentToModel()[0].content;
    expect(c).not.toContain("Cozy");
    expect(c).toBe("Kapı kodu: {daire}");
  });

  it("🚨 BAŞLIK da çözülür (packKnowledgeBase başlığı isteme yazıyor)", async () => {
    await seed("Lale Daire 7", "Merhaba {isim}", "Hoş geldiniz {isim}");
    await POST(req({ message: "Merhaba" }), ctx);

    const item = kbSentToModel()[0];
    expect(item.title).toBe("Hoş geldiniz Test");
    expect(item.content).toBe("Merhaba Test");
  });

  it("🚨 noktalı İ taşıyan belirteç çözülür (eski `/gi` katlamıyordu)", async () => {
    await seed("Lale Daire 7", "Merhaba {İSİM}, daire {DAİRE}");
    await POST(req({ message: "Merhaba" }), ctx);

    expect(kbSentToModel()[0].content).toBe("Merhaba Test, daire 7");
  });

  it("anti-vakum: belirteçsiz içerik AYNEN geçer (ikame her şeyi bozmuyor)", async () => {
    await seed("Lale Daire 7", "Giriş 15:00, çıkış 11:00.");
    await POST(req({ message: "Saatler?" }), ctx);

    expect(kbSentToModel()[0].content).toBe("Giriş 15:00, çıkış 11:00.");
  });
});
