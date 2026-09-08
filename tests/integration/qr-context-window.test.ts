import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

// ---------------------------------------------------------------------------
// QR BAĞLAM PENCERESİ — birim, determinizm ve TAŞAN AÇIK KONULAR (kurucu, 09-08).
//
// Kurucu sorusu: "12 tur" ne demek? Cevap: sınır TUR değil MESAJ sayısıydı ve
// 12 mesaj ≈ 6 tur ediyordu — açıkça dar. Model bağlam penceresi buna kıyasla
// çok büyük, ama sınırsız geçmiş de doğru değil: uzun bağlamda ortadaki bilgi
// silikleşir ve her istek pahalılaşır. Bu yüzden İKİ sınır birlikte uygulanır:
// mesaj sayısı (QR_HISTORY_MESSAGE_CAP) ve karakter bütçesi (QR_HISTORY_CHAR_CAP).
//
// SÖZLEŞME:
//  · Pencere MESAJ cinsindendir ve adı bunu söyler; ~12 TUR (24 mesaj) taşır.
//  · Eşit `createdAt` damgalarında sıra DETERMİNİSTİK (id kopma noktası) — QR
//    yolu misafir+bot satırını tek transaction'da yazar, damgalar eşit olabilir.
//  · Pencere DIŞINDA kalan CEVAPSIZ misafir şikâyetleri kaybolmaz: kısa, PII'siz
//    "açık konu" notu olarak taşınır (mesaj sayısını şişirmeden).
//  · Bu not bir DEVİR sebebi DEĞİLDİR: kapı yalnız GÜNCEL mesaja bakar, yani
//    geçmişteki şikâyet sonraki bağımsız soruları engellemez.
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
import { QR_HISTORY_MESSAGE_CAP, QR_HISTORY_CHAR_CAP } from "@/lib/guest-chat";

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
  const conversationId = await ensureGuestChatConversation(propertyId, {
    id: reservation.id,
    guestName: reservation.guestName,
  });
  return { orgId, propertyId, token, conversationId };
}

let seq = 0;
const ask = (token: string, message: string) =>
  POST(
    new NextRequest(`http://localhost/api/chat/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, requestId: `win-${++seq}-${Math.random().toString(36).slice(2)}` }),
    }),
    { params: Promise.resolve({ token }) },
  );

const okReply = (over: Record<string, unknown> = {}) => ({
  reply: "Tabii.",
  intent: "general",
  riskLevel: "none",
  riskType: null,
  confidence: 0.9,
  source: "openai",
  priority: "standard",
  ...over,
});

type Hist = { direction: string; body: string };
const lastInput = () => mockSuggest.mock.calls.at(-1)?.[0] as { history?: Hist[]; openTopics?: string[] };

const msg = (conversationId: string, direction: "inbound" | "outbound", body: string, createdAt?: Date) => ({
  conversationId,
  direction,
  authorType: direction === "inbound" ? "guest" : "ai",
  senderName: direction === "inbound" ? "Test Misafir" : "Lixus AI",
  body,
  language: "tr",
  ...(createdAt ? { createdAt } : {}),
});

describe("QR bağlam penceresi — birim, determinizm, taşan açık konular", () => {
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

  it("sınır MESAJ cinsindendir ve ~12 turu taşır (24 mesaj)", () => {
    expect(QR_HISTORY_MESSAGE_CAP).toBe(24);
    expect(QR_HISTORY_CHAR_CAP).toBeGreaterThanOrEqual(4000);
  });

  it("24 mesajlık pencere: 40 mesajlık sohbette son 24'ü kronolojik gider", async () => {
    const { token, conversationId } = await seed();
    for (let i = 1; i <= 40; i++) {
      await prisma.message.create({ data: msg(conversationId, i % 2 === 1 ? "inbound" : "outbound", `mesaj ${i}`) });
    }

    await ask(token, "son soru");
    const hist = lastInput().history ?? [];
    expect(hist).toHaveLength(24);
    expect(hist[0].body).toBe("mesaj 17");
    expect(hist.at(-1)?.body).toBe("mesaj 40");
  });

  it("KARAKTER BÜTÇESİ: çok uzun mesajlarda pencere sayıdan ÖNCE bütçeyle kısalır (en yeniler korunur)", async () => {
    const { token, conversationId } = await seed();
    const long = "x".repeat(2000);
    for (let i = 1; i <= 20; i++) {
      await prisma.message.create({ data: msg(conversationId, "inbound", `${i}:${long}`) });
    }

    await ask(token, "son soru");
    const hist = lastInput().history ?? [];
    expect(hist.length).toBeLessThan(20); // bütçe devrede
    expect(hist.at(-1)?.body.startsWith("20:")).toBe(true); // en yeni korunur
    const total = hist.reduce((n, h) => n + h.body.length, 0);
    expect(total).toBeLessThanOrEqual(QR_HISTORY_CHAR_CAP);
  });

  it("🚨 YENİ SATIRLARDA DAMGA AYRIK: bot cevabı misafir mesajından SONRA damgalanır (nedensellik veride)", async () => {
    const { token, conversationId } = await seed();
    await ask(token, "Otopark var mı?");

    const rows = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
      select: { direction: true, createdAt: true },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].direction).toBe("inbound");
    expect(rows[1].direction).toBe("outbound");
    // Damgalar EŞİT DEĞİL: sıra artık `id` vekiline muhtaç değil.
    expect(rows[1].createdAt.getTime()).toBeGreaterThan(rows[0].createdAt.getTime());
  });

  it("🚨 EŞİT ZAMAN DAMGASI: sıra `id` kopma noktasıyla DETERMİNİSTİK (ekleme sırasından bağımsız)", async () => {
    const { token, conversationId } = await seed();
    const t = new Date("2026-09-08T10:00:00.000Z");
    // QR yolu misafir+bot satırını TEK transaction'da yazar → `createdAt` eşit
    // olabilir. Determinizmi GERÇEKTEN sınamak için satırlar TERS sırada
    // eklenir ama id'ler doğru sırayı taşır: yalnız `createdAt`e bakan bir
    // sıralama burada ekleme sırasını (yanlış) döndürür.
    await prisma.message.create({
      data: { ...msg(conversationId, "outbound", "Kapı şifresi 1234.", t), id: "zzz-2-bot" },
    });
    await prisma.message.create({
      data: { ...msg(conversationId, "inbound", "kapı şifresi neydi?", t), id: "aaa-1-guest" },
    });

    await ask(token, "buldum teşekkürler");
    const hist = lastInput().history ?? [];
    expect(hist.map((h) => h.body)).toEqual(["kapı şifresi neydi?", "Kapı şifresi 1234."]);
    // Tekrar çağrıda da AYNI sıra (kararlı).
    await ask(token, "peki çöp?");
    expect((lastInput().history ?? []).slice(0, 2).map((h) => h.body)).toEqual([
      "kapı şifresi neydi?",
      "Kapı şifresi 1234.",
    ]);
  });

  it("🚨 PENCERE DIŞINA TAŞAN CEVAPSIZ ŞİKÂYET kaybolmaz: 'açık konu' olarak taşınır", async () => {
    const { token, conversationId } = await seed();
    // En eski: cevapsız şikâyet (pencere dışına itilecek).
    await prisma.message.create({ data: msg(conversationId, "inbound", "Klima bozuk, çalışmıyor.") });
    for (let i = 1; i <= 30; i++) {
      await prisma.message.create({ data: msg(conversationId, i % 2 === 1 ? "inbound" : "outbound", `dolgu ${i}`) });
    }

    await ask(token, "çöp nereye?");
    const input = lastInput();
    expect((input.history ?? []).some((h) => h.body.includes("Klima"))).toBe(false); // pencere dışında
    expect(input.openTopics ?? []).toContain("complaint"); // ama kaybolmadı
  });

  it("açık konu notu DEVİR SEBEBİ DEĞİL: geçmiş şikâyet sonraki bağımsız soruyu engellemez", async () => {
    const { token, conversationId } = await seed();
    await prisma.message.create({ data: msg(conversationId, "inbound", "Klima bozuk, çalışmıyor.") });
    for (let i = 1; i <= 30; i++) {
      await prisma.message.create({ data: msg(conversationId, i % 2 === 1 ? "inbound" : "outbound", `dolgu ${i}`) });
    }

    const res = await ask(token, "çöp nereye?");
    const body = await res.json();
    expect(body.escalated).toBeFalsy(); // bağımsız soru cevaplandı
    expect(body.reply).toBe("Tabii.");
  });

  it("ÇÖZÜLMÜŞ konu açık sayılmaz: şikâyetten sonra misafir kapanış yazdıysa not taşınmaz", async () => {
    const { token, conversationId } = await seed();
    await prisma.message.create({ data: msg(conversationId, "inbound", "Klima bozuk, çalışmıyor.") });
    await prisma.message.create({ data: msg(conversationId, "outbound", "Ustaya ilettim.") });
    await prisma.message.create({ data: msg(conversationId, "inbound", "Tamam, düzeldi, teşekkürler.") });
    for (let i = 1; i <= 30; i++) {
      await prisma.message.create({ data: msg(conversationId, i % 2 === 1 ? "inbound" : "outbound", `dolgu ${i}`) });
    }

    await ask(token, "çöp nereye?");
    expect(lastInput().openTopics ?? []).not.toContain("complaint");
  });

  it("🚨 KAPANIŞ YALNIZ İLGİLİ KONUYU kapatır: klima şikâyeti → havlu sorusu → 'teşekkürler' → KLİMA AÇIK KALIR", async () => {
    const { token, conversationId } = await seed();
    // Kapanış cümlesi ARADAKİ konuya aittir; ondan önceki şikâyeti kapatmaz.
    await prisma.message.create({ data: msg(conversationId, "inbound", "Klima bozuk, çalışmıyor.") });
    await prisma.message.create({ data: msg(conversationId, "outbound", "İlettim.") });
    await prisma.message.create({ data: msg(conversationId, "inbound", "Havlu nerede?") });
    await prisma.message.create({ data: msg(conversationId, "outbound", "Banyo dolabında.") });
    await prisma.message.create({ data: msg(conversationId, "inbound", "teşekkürler") });
    for (let i = 1; i <= 30; i++) {
      await prisma.message.create({ data: msg(conversationId, i % 2 === 1 ? "inbound" : "outbound", `dolgu ${i}`) });
    }

    await ask(token, "çöp nereye?");
    expect(lastInput().openTopics ?? []).toContain("complaint");
  });

  it("🚨 GENEL TEŞEKKÜR operasyonel şikâyeti ÇÖZÜLMÜŞ yapmaz (sohbet kapanışı ≠ sorun çözümü)", async () => {
    const { token, conversationId } = await seed();
    // Araya BAŞKA konu girmiyor: yakınlık kuralı burada şikâyeti kapatırdı.
    // Ama "teşekkürler" nezaket kapanışıdır; klimanın onarıldığını SÖYLEMEZ.
    await prisma.message.create({ data: msg(conversationId, "inbound", "Klima bozuk, çalışmıyor.") });
    await prisma.message.create({ data: msg(conversationId, "outbound", "İlettim.") });
    await prisma.message.create({ data: msg(conversationId, "inbound", "teşekkürler") });
    for (let i = 1; i <= 30; i++) {
      await prisma.message.create({ data: msg(conversationId, i % 2 === 1 ? "inbound" : "outbound", `dolgu ${i}`) });
    }

    await ask(token, "çöp nereye?");
    expect(lastInput().openTopics ?? []).toContain("complaint");
  });

  it("ÇÖZÜM BİLDİRİMİ operasyonel şikâyeti kapatır ('klima düzeldi')", async () => {
    const { token, conversationId } = await seed();
    await prisma.message.create({ data: msg(conversationId, "inbound", "Klima bozuk, çalışmıyor.") });
    await prisma.message.create({ data: msg(conversationId, "inbound", "klima düzeldi") });
    for (let i = 1; i <= 30; i++) {
      await prisma.message.create({ data: msg(conversationId, i % 2 === 1 ? "inbound" : "outbound", `dolgu ${i}`) });
    }

    await ask(token, "çöp nereye?");
    expect(lastInput().openTopics ?? []).not.toContain("complaint");
  });

  it("AŞIRI KISIT YOK: genel teşekkür konuyu kilitlemez — sonraki ÇÖZÜM bildirimi hâlâ kapatır", async () => {
    const { token, conversationId } = await seed();
    // Nezaket kapanışı şikâyeti kapatmaz (üstteki test), ama konuyu da
    // dondurmaz: misafir gerçekten "düzeldi" dediğinde konu kapanmalı.
    // ⚠️ Fixture notu: "insan ile görüşmek istiyorum" kelime ağında `general`
    // çıkıyor (bilinen Türkçe boşluk, ayrı belgede kayıtlı) — bu yüzden
    // operasyonel örnek olarak şikâyet kullanılıyor.
    await prisma.message.create({ data: msg(conversationId, "inbound", "Klima bozuk, çalışmıyor.") });
    await prisma.message.create({ data: msg(conversationId, "inbound", "teşekkürler") });
    await prisma.message.create({ data: msg(conversationId, "inbound", "klima düzeldi") });
    for (let i = 1; i <= 30; i++) {
      await prisma.message.create({ data: msg(conversationId, i % 2 === 1 ? "inbound" : "outbound", `dolgu ${i}`) });
    }

    await ask(token, "çöp nereye?");
    expect(lastInput().openTopics ?? []).not.toContain("complaint");
  });

  it("İLGİLİ kapanış konuyu kapatır: şikâyetin hemen ardından gelen kapanış şikâyeti kapatır", async () => {
    const { token, conversationId } = await seed();
    await prisma.message.create({ data: msg(conversationId, "inbound", "Klima bozuk, çalışmıyor.") });
    await prisma.message.create({ data: msg(conversationId, "outbound", "Ustaya ilettim.") });
    await prisma.message.create({ data: msg(conversationId, "inbound", "klima düzeldi, teşekkürler") });
    for (let i = 1; i <= 30; i++) {
      await prisma.message.create({ data: msg(conversationId, i % 2 === 1 ? "inbound" : "outbound", `dolgu ${i}`) });
    }

    await ask(token, "çöp nereye?");
    expect(lastInput().openTopics ?? []).not.toContain("complaint");
  });

  it("İKİ açık şikâyet, tek kapanış: yalnız SONUNCUSU kapanır, diğeri açık kalır", async () => {
    const { token, conversationId } = await seed();
    await prisma.message.create({ data: msg(conversationId, "inbound", "Klima bozuk, çalışmıyor.") });
    await prisma.message.create({ data: msg(conversationId, "inbound", "Ayrıca insan ile görüşmek istiyorum.") });
    await prisma.message.create({ data: msg(conversationId, "inbound", "teşekkürler") });
    for (let i = 1; i <= 30; i++) {
      await prisma.message.create({ data: msg(conversationId, i % 2 === 1 ? "inbound" : "outbound", `dolgu ${i}`) });
    }

    await ask(token, "çöp nereye?");
    const topics = lastInput().openTopics ?? [];
    expect(topics).toContain("complaint"); // ilk şikâyet hâlâ açık
    expect(topics).not.toContain("human_request"); // en son konu kapandı
  });

  it("açık konu notu PII taşımaz: yalnız kapalı-küme kategori kodları", async () => {
    const { token, conversationId } = await seed();
    await prisma.message.create({
      data: msg(conversationId, "inbound", "Ben Ada Lovelace, 0555 111 22 33 — klima bozuk, çalışmıyor."),
    });
    for (let i = 1; i <= 30; i++) {
      await prisma.message.create({ data: msg(conversationId, i % 2 === 1 ? "inbound" : "outbound", `dolgu ${i}`) });
    }

    await ask(token, "çöp nereye?");
    const topics = lastInput().openTopics ?? [];
    expect(topics.join("|")).not.toMatch(/Ada|Lovelace|0555|klima/i);
    expect(topics.every((t) => /^[a-z_]+$/.test(t))).toBe(true);
  });
});
