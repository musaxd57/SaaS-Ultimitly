import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn().mockResolvedValue(undefined) };
});

import { collectAuditSample, buildAuditPrompt } from "@/lib/quality-audit";

// ---------------------------------------------------------------------------
// §C — DENETÇİ "BU CEVAP NEYE DAYANDI"YI GÖREBİLMELİ (denetim turu 09-12).
//
// 🚨 ÖLÇÜLEN BOŞLUK: `Message.aiSourcesJson` kolonu 05 numaralı migration'dan
// beri VAR ve oto-yanıt yolunda DOLU (doğrulanmış kaynak etiketleri:
// "kb:wifi", "property:checkInTime" …). Ama kalite denetçisinin Prisma
// `select`inde YOKTU → denetçi "DOĞRULUK" kriterini (uydurulmuş somut detay
// halüsinasyondur) YALNIZ misafir mesajı + yanıt metnine bakarak veriyordu.
// Yani cevabın gerçekten bir kaynağa dayanıp dayanmadığını göremiyordu.
//
// ⚠️ Kolon AYNI SATIRIN üzerinde — ek sorgu/join GEREKMEZ, yalnız `select`
// listesine girmesi gerekiyordu.
//
// 🚨 NULL ≠ "KAYNAK YOK" (A2 deyimi, bu turun ASIL riski): kolon YALNIZ kanal
// oto-yanıtında yazılıyor; QR ve host-onaylı satırlarda DAİMA null. Denetçiye
// bunu söylemeden vermek, o satırlar için "kaynaksız cevap" diye YANLIŞ bulgu
// ürettirirdi — tam da 09-08'de `guest: null`ın yaptığı hatanın aynısı.
// ---------------------------------------------------------------------------

// Güvenli geçmiş: örneklem penceresi `Date.now()` tabanlı (opts.now YOK).
const T = new Date(Date.now() - 2 * 86_400_000);

async function conv(propertyId: string) {
  return prisma.conversation.create({
    data: { propertyId, guestIdentifier: "Test Misafir", status: "answered", lastMessageAt: T },
  });
}

describe("collectAuditSample — kaynak etiketleri denetçiye ULAŞIR", () => {
  let orgId: string;
  let propertyId: string;

  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    const made = await makeOrgWithProperty();
    orgId = made.orgId;
    propertyId = made.propertyId;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("🚨 DOLU kolon örneğe taşınır (eskiden select'te YOKTU)", async () => {
    const c = await conv(propertyId);
    await prisma.message.create({
      data: {
        conversationId: c.id,
        direction: "outbound",
        authorType: "ai",
        senderName: "Lixus AI",
        body: "Giriş saati 15:00.",
        language: "tr",
        createdAt: T,
        aiSourcesJson: JSON.stringify(["kb:checkin", "property:checkInTime"]),
      },
    });
    const pairs = await collectAuditSample(orgId, { days: 30, limit: 10 });
    expect(pairs).toHaveLength(1);
    expect(pairs[0].aiSources).toEqual(["kb:checkin", "property:checkInTime"]);
  });

  it("🚨 YAZILMAYAN yüzeyde null KALIR — boş dizi DEĞİL (A2: ölçülmedi ≠ yok)", async () => {
    const c = await conv(propertyId);
    await prisma.message.create({
      data: {
        conversationId: c.id,
        direction: "outbound",
        authorType: "ai",
        senderName: "Lixus AI",
        body: "Havlular banyo dolabında.",
        language: "tr",
        createdAt: T,
        // QR ve host-onaylı yollar bu kolonu HİÇ yazmıyor.
      },
    });
    const pairs = await collectAuditSample(orgId, { days: 30, limit: 10 });
    expect(pairs[0].aiSources).toBeNull();
  });

  it("BOZUK JSON denetimi ÇÖKERTMEZ (fail-safe null)", async () => {
    const c = await conv(propertyId);
    await prisma.message.create({
      data: {
        conversationId: c.id,
        direction: "outbound",
        authorType: "ai",
        senderName: "Lixus AI",
        body: "Merhaba.",
        language: "tr",
        createdAt: T,
        aiSourcesJson: "{bozuk",
      },
    });
    const pairs = await collectAuditSample(orgId, { days: 30, limit: 10 });
    expect(pairs[0].aiSources).toBeNull();
  });

  it("🚨 PII SIZMAZ — yalnız kapalı-küme ETİKET taşınır, misafir adı/metni değil", async () => {
    const c = await conv(propertyId);
    await prisma.message.create({
      data: {
        conversationId: c.id,
        direction: "outbound",
        authorType: "ai",
        senderName: "Lixus AI",
        body: "Bilgi.",
        language: "tr",
        createdAt: T,
        // Kolon kapalı kümeden geçmiş etiket tutar; yine de denetçiye giden
        // değer TİP olarak string[]'e indirgenir (nesne/serbest metin geçmez).
        aiSourcesJson: JSON.stringify(["kb:wifi", { evil: "Ahmet Yılmaz" }, 42]),
      },
    });
    const pairs = await collectAuditSample(orgId, { days: 30, limit: 10 });
    expect(pairs[0].aiSources).toEqual(["kb:wifi"]);
  });
});

describe("buildAuditPrompt — NULL'ın anlamı denetçiye AÇIKÇA söylenir", () => {
  const pair = {
    messageId: "m1",
    property: "Mülk A",
    at: T.toISOString(),
    guest: "Giriş saati kaçta?",
    guestContext: "matched" as const,
    ai: "15:00.",
    aiIntent: "checkin",
    language: "tr",
    threadRisk: null,
    aiSources: null,
  };

  it("🚨 'kaynak yok' diye okunmasın — 09-08'deki `guest: null` dersinin aynısı", () => {
    const p = buildAuditPrompt([pair]);
    expect(p).toMatch(/aiSources/);
    // Anti-vakumluk: yalnız alan adı geçmesi YETMEZ, null'ın anlamı yazılı olmalı.
    // 🚨 `/i` bayrağı noktalı İ'yi KATLAMAZ (reponun kendi dersi) → TAM metin.
    expect(p).toContain("KAYDEDİLMEDİ");
    expect(p).toContain('"kaynak YOK" DEMEK DEĞİLDİR');
  });

  it("alan gerçekten örnekle birlikte gidiyor (şema tarifi değil VERİ)", () => {
    const p = buildAuditPrompt([{ ...pair, aiSources: ["kb:wifi"] }]);
    expect(p).toContain("kb:wifi");
  });
});
