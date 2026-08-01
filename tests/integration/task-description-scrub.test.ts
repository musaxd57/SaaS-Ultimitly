import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { ANON_BODY, ANON_NAME, anonymizeOldGuestData } from "@/lib/data-retention";

// ---------------------------------------------------------------------------
// GÖREV AÇIKLAMASI MİSAFİRİN HAM MESAJIDIR — İKİ SÜPÜRGEYE DE BAĞLI OLMALI.
// (Derin denetim, 2026-08-01 — KRİTİK.)
//
// CLAUDE.md'nin kendi SCRUB KAPSAMI KURALI: "misafir metni/adı taşıyan HER yeni
// kolon İKİ süpürgeye birden bağlanır — `anonymizeOldGuestData` (süre bazlı) VE
// `maskReservationRows` (açık silme); biri eksikse vaat yalan olur."
//
// Bulunan İKİ KATMANLI arıza:
//
//  1. `Task.description` hiçbir süpürgede YOKTU. Yaşam-döngüsü görevlerinde
//     açıklama sabit şablon metni (yorumda öyle yazıyordu ve doğruydu), ama
//     ŞİKAYET görevi ve AKILLI GÖREV oraya misafirin KENDİ MESAJINI 500
//     karaktere kadar kelimesi kelimesine yazıyor. O metin misafirin adını,
//     telefonunu, ne yazdıysa onu taşıyabilir.
//
//  2. DAHA KÖTÜSÜ: şikayet görevinin `reservationId`'si HİÇ YOKTU (yalnız
//     `propertyId` veriliyordu). Her iki süpürge de kapsamı `reservationId`
//     üzerinden kurduğu için o satır ikisi için de GÖRÜNMEZDİ — yani yalnız
//     açıklaması değil, BAŞLIĞINDAKİ MİSAFİR ADI da hem süre bazlı
//     anonimleştirmeden hem AÇIK SİLME talebinden sağ çıkıyordu.
// ---------------------------------------------------------------------------

vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) },
}));
vi.mock("@/lib/ai", () => ({
  classifyMessage: vi.fn(),
  suggestReply: vi.fn(),
  summarizeHostStyle: vi.fn(),
}));

import { classifyMessage } from "@/lib/ai";
import { applyInboundMessageRules } from "@/lib/automation";

const mockClassify = vi.mocked(classifyMessage);

const GUEST_TEXT =
  "Ben Ahmet Yılmaz, 0532 111 22 33. Daire çok kirli ve alerjim var, param iade edilsin.";

async function seedComplaintTask() {
  const org = await prisma.organization.create({ data: { name: "Org" } });
  await prisma.user.create({
    data: {
      organizationId: org.id,
      name: "Owner",
      email: "owner@example.com",
      passwordHash: "x",
      role: "owner",
    },
  });
  const property = await prisma.property.create({
    data: { organizationId: org.id, name: "Nuve 7" },
  });
  // Süre bazlı süpürge ESKİ konaklamaları hedefler.
  const old = new Date(Date.now() - 40 * 30 * 24 * 60 * 60 * 1000); // ~40 ay
  const reservation = await prisma.reservation.create({
    data: {
      propertyId: property.id,
      guestName: "Ahmet Yılmaz",
      arrivalDate: old,
      departureDate: new Date(old.getTime() + 3 * 86_400_000),
      status: "completed",
      channel: "airbnb",
    },
  });
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      reservationId: reservation.id,
      channel: "airbnb",
      guestIdentifier: "Ahmet Yılmaz",
      status: "new",
      lastMessageAt: old,
      messages: {
        create: [
          { direction: "inbound", senderName: "Ahmet Yılmaz", body: GUEST_TEXT, createdAt: old },
        ],
      },
    },
  });
  return { orgId: org.id, conversationId: conversation.id, reservationId: reservation.id };
}

describe("şikayet görevi — misafir metni iki süpürgeye de bağlı", () => {
  beforeEach(async () => {
    await resetDb();
    // Süpürge env OLMADAN kapalıdır (`data-retention.ts`: disabled by default).
    vi.stubEnv("DATA_RETENTION_MONTHS", "24");
    mockClassify.mockReset();
    mockClassify.mockResolvedValue({
      intent: "complaint",
      priority: "urgent",
      isComplaint: true,
      confidence: 0.9,
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("görev REZERVASYONA bağlı doğar — yoksa hiçbir süpürge onu bulamaz", async () => {
    const { conversationId, reservationId } = await seedComplaintTask();
    await applyInboundMessageRules(conversationId, GUEST_TEXT);

    const task = await prisma.task.findFirstOrThrow({ where: { origin: "ai" } });
    expect(task.reservationId).toBe(reservationId);
    // Kanıt: metin gerçekten ham hâliyle yazılıyor (bu yüzden temizlik şart).
    expect(task.description).toContain("Ahmet Yılmaz");
    expect(task.description).toContain("0532");
  });

  it("SÜRE BAZLI anonimleştirme açıklamayı da temizler (yalnız başlığı değil)", async () => {
    const { conversationId } = await seedComplaintTask();
    await applyInboundMessageRules(conversationId, GUEST_TEXT);

    await anonymizeOldGuestData();

    const task = await prisma.task.findFirstOrThrow({ where: { origin: "ai" } });
    expect(task.description).toBe(ANON_BODY);
    expect(task.description).not.toContain("Ahmet");
    expect(task.description).not.toContain("0532");
    // Başlıktaki ad da gitmeli (mevcut davranış — regresyon pini).
    expect(task.title).not.toContain("Ahmet Yılmaz");
    // Host'un iş kaydı okunur kalır.
    expect(task.title).toContain("Şikayet");
  });

  it("temizlik İDEMPOTENT: ikinci koşu bir şeyi bozmaz", async () => {
    const { conversationId } = await seedComplaintTask();
    await applyInboundMessageRules(conversationId, GUEST_TEXT);
    await anonymizeOldGuestData();
    const first = await prisma.task.findFirstOrThrow({ where: { origin: "ai" } });
    await anonymizeOldGuestData();
    const second = await prisma.task.findFirstOrThrow({ where: { origin: "ai" } });
    expect(second.description).toBe(first.description);
    expect(second.title).toBe(first.title);
  });

  it("rezervasyon da anonimleşti (kapsam gerçekten çalıştı — kontrol)", async () => {
    const { conversationId, reservationId } = await seedComplaintTask();
    await applyInboundMessageRules(conversationId, GUEST_TEXT);
    await anonymizeOldGuestData();
    const r = await prisma.reservation.findUniqueOrThrow({ where: { id: reservationId } });
    expect(r.guestName).toBe(ANON_NAME);
  });
});
