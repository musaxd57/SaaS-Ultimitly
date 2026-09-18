import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn().mockResolvedValue(undefined) };
});

import { collectAuditSample, buildAuditPrompt } from "@/lib/quality-audit";

// ---------------------------------------------------------------------------
// KALİTE DENETÇİSİ — MİSAFİR MESAJI EŞLEŞTİRMESİ (Codex, 2026-09-08).
//
// 🚨 BULUNAN AÇIK: eşleştirme `createdAt: { lt: yanıt }` ile yapılıyordu ve eşit
// damgada bir kopma noktası (id) YOKTU. QR yolu misafirin satırıyla botun satırını
// TEK transaction'da (`createManyAndReturn`) yazar ve `createdAt` DB varsayılanıdır
// (`CURRENT_TIMESTAMP` = transaction başlangıcı) → iki satır AYNI milisaniyeyi alır
// → `lt` misafir mesajını ELER → `guest: null` → denetçiye giden istem "guest null
// ise yanıt proaktif bir mesajdı" dediği için denetçi "var olmayan bir misafir
// sorusuna atıf yapılıyor" bulgusu üretti. Yani ürün doğru davranırken DENETÇİ
// yanlış rapor veriyordu.
//
// SÖZLEŞME: eşit damga eşleşmeyi bozmaz; "hiç misafir mesajı yok" (gerçekten
// proaktif) ile "eşleştirilemedi" AYRI raporlanır — `guest: null` tek başına
// proaktif kanıtı DEĞİLDİR.
// ---------------------------------------------------------------------------

/**
 * 🚨 ÇAPAYA GÖRE DEĞİL, ŞİMDİYE GÖRE (zaman bombası düzeltildi 09-18).
 *
 * Buradaki değer `2026-09-08T09:00:00.000Z` olarak SABİTLENMİŞTİ ve
 * `collectAuditSample`ın varsayılan penceresi **7 GÜNDÜR**
 * (`quality-audit.ts` `clampDays` → 7, `since = Date.now() - days`).
 * Yani fikstür 2026-09-15'te kendiliğinden pencerenin DIŞINA düştü ve bu
 * dosyanın 4 testi, kodda hiçbir şey değişmeden KIRMIZIYA döndü —
 * teşhis edilirken de "son değişikliğin gerilemesi" gibi görünüyordu.
 *
 * Testin İDDİASI zamana bağlı DEĞİL (aynı `createdAt` damgasında eşleştirme,
 * proaktif/eşleşmemiş ayrımı), o yüzden çapa da olmamalı. Göreli offsetler
 * (±60 sn / ±120 sn) aynen korunur; yalnız taban şimdiye bağlandı.
 */
const T = new Date(Date.now() - 2 * 86_400_000);

async function conv(propertyId: string) {
  return prisma.conversation.create({
    data: { propertyId, guestIdentifier: "Test Misafir", status: "answered", lastMessageAt: T },
  });
}
const guestRow = (conversationId: string, body: string, createdAt: Date) => ({
  conversationId,
  direction: "inbound",
  authorType: "guest",
  senderName: "Test Misafir",
  body,
  language: "tr",
  createdAt,
});
const aiRow = (conversationId: string, body: string, createdAt: Date) => ({
  conversationId,
  direction: "outbound",
  authorType: "ai",
  senderName: "Lixus AI",
  body,
  language: "tr",
  createdAt,
});

describe("collectAuditSample — misafir mesajı eşleştirmesi", () => {
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

  it("🚨 AYNI createdAt (QR tek TX): misafir mesajı EŞLEŞİR, guest null OLMAZ", async () => {
    const c = await conv(propertyId);
    // QR yolunun ürettiği hâl: iki satır aynı milisaniye.
    await prisma.message.createMany({
      data: [guestRow(c.id, "Çöpü nereye atabiliriz?", T), aiRow(c.id, "Sorunuzu ev sahibine ilettim.", T)],
    });

    const pairs = await collectAuditSample(orgId);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].guest).toBe("Çöpü nereye atabiliriz?");
    expect(pairs[0].guestContext).toBe("matched");
  });

  it("gerçekten proaktif (hiç misafir mesajı yok) → guest null VE bağlam 'proactive'", async () => {
    const c = await conv(propertyId);
    await prisma.message.create({ data: aiRow(c.id, "Yarın check-in gününüz.", T) });

    const pairs = await collectAuditSample(orgId);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].guest).toBeNull();
    expect(pairs[0].guestContext).toBe("proactive");
  });

  it("konuşmada misafir mesajı VAR ama yanıttan sonra: bağlam 'unmatched' (proaktif DEĞİL)", async () => {
    const c = await conv(propertyId);
    await prisma.message.create({ data: aiRow(c.id, "Hoş geldiniz.", T) });
    await prisma.message.create({ data: guestRow(c.id, "Teşekkürler", new Date(T.getTime() + 60_000)) });

    const pairs = await collectAuditSample(orgId);
    const ai = pairs.find((p) => p.ai === "Hoş geldiniz.")!;
    expect(ai.guest).toBeNull();
    expect(ai.guestContext).toBe("unmatched");
  });

  it("PEŞ PEŞE iki misafir mesajı: yanıt ikisini de görür (bağlam eksilmez)", async () => {
    const c = await conv(propertyId);
    await prisma.message.createMany({
      data: [
        guestRow(c.id, "Merhaba", new Date(T.getTime() - 120_000)),
        guestRow(c.id, "Klima bozuk, çalışmıyor.", new Date(T.getTime() - 60_000)),
        aiRow(c.id, "Sorunuzu ev sahibine ilettim.", T),
      ],
    });

    const pairs = await collectAuditSample(orgId);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].guest).toContain("Klima bozuk");
    expect(pairs[0].guest).toContain("Merhaba"); // önceki cevapsız mesaj da bağlamda
    expect(pairs[0].guestContext).toBe("matched");
  });

  it("istem, guest null'u tek başına PROAKTİF saymaz (eksik bağlam ayrı anlatılır)", () => {
    const prompt = buildAuditPrompt([
      { messageId: "m1", property: "Daire-1", at: T.toISOString(), guest: null, guestContext: "unmatched", ai: "x", aiIntent: null, language: "tr", threadRisk: null, aiSources: null },
    ]);
    expect(prompt).toContain("guestContext");
    expect(prompt).toMatch(/unmatched/);
    // Eski cümle ("guest null ise yanıt proaktif bir mesajdı") KOŞULSUZDU → geri gelmesin.
    expect(prompt).not.toMatch(/"guest" null ise yanıt proaktif bir mesajdı/);
  });
});
