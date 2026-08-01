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

// ---------------------------------------------------------------------------
// YETİM KONUŞMADAN DOĞAN GÖREV DE TEMİZLENİR (denetim, 08-01 — ikinci tur).
//
// İlk turda şikayet görevi `reservationId` ile bağlandı ve süre bazlı süpürgenin
// REZERVASYON dalı onu bulur oldu. Ama bir konuşma PMS'e BAĞLANAMAZSA
// (`reservationId: null` — tarihi çözülemeyen rezervasyon, manuel konuşma)
// o dal da onu bulamaz; süpürgenin YETİM dalı ise yalnız Message + Conversation'a
// dokunuyordu. Yani misafirin ham mesajı ve adı SÜRESİZ kalıyordu — bulgunun
// kalan yarısı.
//
// Bağ `sourceMessageId`: `Task`ta `conversationId` kolonu YOK (eklemek migration
// ister), ama görev kendisini doğuran MESAJA bağlı.
// ---------------------------------------------------------------------------
describe("YETİM konuşmanın görevi — süre bazlı süpürge onu da bulur", () => {
  beforeEach(async () => {
    await resetDb();
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

  async function seedOrphan() {
    const org = await prisma.organization.create({ data: { name: "Org" } });
    const property = await prisma.property.create({
      data: { organizationId: org.id, name: "Nuve 7" },
    });
    const old = new Date(Date.now() - 40 * 30 * 24 * 60 * 60 * 1000); // ~40 ay
    const conversation = await prisma.conversation.create({
      data: {
        propertyId: property.id,
        reservationId: null, // ⬅️ YETİM: PMS'e bağlanamadı
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
    return { conversationId: conversation.id };
  }

  it("görev MESAJA bağlı doğar (yetimde tek bağ budur)", async () => {
    const { conversationId } = await seedOrphan();
    await applyInboundMessageRules(conversationId, GUEST_TEXT);

    const task = await prisma.task.findFirstOrThrow({ where: { origin: "ai" } });
    expect(task.reservationId).toBeNull(); // yetim — rezervasyon yok
    expect(task.sourceMessageId).not.toBeNull(); // ⬅️ ARIZADA null olurdu
  });

  it("yetim görevinin AÇIKLAMASI ve BAŞLIĞI temizlenir", async () => {
    const { conversationId } = await seedOrphan();
    await applyInboundMessageRules(conversationId, GUEST_TEXT);

    await anonymizeOldGuestData();

    const task = await prisma.task.findFirstOrThrow({ where: { origin: "ai" } });
    expect(task.description).toBe(ANON_BODY);
    expect(task.description).not.toContain("0532");
    expect(task.title).not.toContain("Ahmet Yılmaz");
    expect(task.title).toContain("Şikayet"); // host'un iş kaydı okunur kalır
  });

  it("temizlik İDEMPOTENT (ikinci koşu bozmaz)", async () => {
    const { conversationId } = await seedOrphan();
    await applyInboundMessageRules(conversationId, GUEST_TEXT);
    await anonymizeOldGuestData();
    const first = await prisma.task.findFirstOrThrow({ where: { origin: "ai" } });
    await anonymizeOldGuestData();
    const second = await prisma.task.findFirstOrThrow({ where: { origin: "ai" } });
    expect(second.title).toBe(first.title);
    expect(second.description).toBe(first.description);
  });
});

// ---------------------------------------------------------------------------
// 🚨 SONRADAN BAĞLANAN KONUŞMANIN GÖREVİ İKİ SÜPÜRGENİN DE DIŞINDA KALIYORDU.
// (Denetim, 2026-08-01 — beşinci tur, ajan bulgusu.)
//
// Şikayet/akıllı görev, konuşma HENÜZ rezervasyona bağlı DEĞİLKEN doğduysa
// `Task.reservationId` NULL kalır (`automation.ts` `conversation.reservation?.id
// ?? null` geçirir). Konuşma SONRADAN bağlanır — `hospitable-sync` mevcut
// konuşmaya `reservationId` yazar (bugün o kodu ayrıca düzelttik). O andan
// itibaren görev:
//   · rezervasyon-kapsamlı dala GİRMEZ (kendi `reservationId`'si NULL),
//   · yetim dalına da GİRMEZ (konuşma artık bağlı),
// yani misafirin HAM MESAJI (`description`) ve ADI (`title`) hem SÜRE-BAZLI
// anonimleştirmeden hem AÇIK SİLME talebinden SÜRESİZ sağ çıkıyordu.
//
// Bu, CLAUDE.md'nin kendi SCRUB KAPSAMI KURALI'nın ihlali: "misafir metni/adı
// taşıyan HER kolon İKİ süpürgeye birden bağlanır". Bağ `sourceMessageId`
// (Task'ta `conversationId` kolonu yok — eklemek migration ister).
// ---------------------------------------------------------------------------
describe("SONRADAN bağlanan konuşmanın görevi — iki süpürge de bulur", () => {
  beforeEach(async () => {
    await resetDb();
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

  /** Görev BAĞSIZ doğar, SONRA konuşma rezervasyona bağlanır (gerçek sıra). */
  async function seedLateLinked() {
    const org = await prisma.organization.create({ data: { name: "Org" } });
    const property = await prisma.property.create({
      data: { organizationId: org.id, name: "Nuve 7" },
    });
    const old = new Date(Date.now() - 40 * 30 * 24 * 60 * 60 * 1000); // ~40 ay
    // 1) Konuşma HENÜZ BAĞSIZ → görev `reservationId: null` ile doğacak.
    const conversation = await prisma.conversation.create({
      data: {
        propertyId: property.id,
        reservationId: null,
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
    await applyInboundMessageRules(conversation.id, GUEST_TEXT);

    // 2) Rezervasyon SONRADAN çözülür ve konuşmaya bağlanır (hospitable-sync).
    const reservation = await prisma.reservation.create({
      data: {
        propertyId: property.id,
        guestName: "Ahmet Yılmaz",
        sourceReference: "res-late-1",
        channel: "airbnb",
        status: "completed",
        arrivalDate: old,
        departureDate: new Date(old.getTime() + 86_400_000),
      },
    });
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { reservationId: reservation.id },
    });
    return { reservationId: reservation.id, conversationId: conversation.id, orgId: org.id };
  }

  it("kurulum gerçekten o şekli üretiyor: görev BAĞSIZ, konuşma BAĞLI", async () => {
    const { conversationId } = await seedLateLinked();
    const task = await prisma.task.findFirstOrThrow({ where: { origin: "ai" } });
    expect(task.reservationId).toBeNull(); // görev bağsız doğdu
    expect(task.sourceMessageId).not.toBeNull(); // tek bağ bu
    const conv = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(conv.reservationId).not.toBeNull(); // konuşma SONRADAN bağlandı
  });

  it("SÜRE-BAZLI süpürge bulur (⬅️ arızada iki dalın da dışındaydı)", async () => {
    await seedLateLinked();
    await anonymizeOldGuestData();

    const task = await prisma.task.findFirstOrThrow({ where: { origin: "ai" } });
    expect(task.description).toBe(ANON_BODY);
    expect(task.description).not.toContain("0532");
    expect(task.title).not.toContain("Ahmet Yılmaz");
    expect(task.title).toContain("Şikayet"); // host'un iş kaydı okunur kalır
  });

  it("AÇIK SİLME süpürgesi de bulur (public giriş noktası üzerinden)", async () => {
    const { reservationId, orgId } = await seedLateLinked();
    const { eraseReservationData } = await import("@/lib/erasure");
    await eraseReservationData(orgId, reservationId);

    const task = await prisma.task.findFirstOrThrow({ where: { origin: "ai" } });
    expect(task.description).toBe(ANON_BODY);
    expect(task.title).not.toContain("Ahmet Yılmaz");
  });
});
