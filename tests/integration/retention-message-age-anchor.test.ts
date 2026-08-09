import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { anonymizeOldGuestData, ANON_NAME, ANON_BODY } from "@/lib/data-retention";

// ---------------------------------------------------------------------------
// SÜPÜRGE TEK ATIMLIKTI — `RETENTION_MESSAGE_AGE_ANCHOR` (DEFAULT KAPALI)
//
// 🚨 ÖLÇÜLMÜŞ SIZINTI: seçici `guestName != ANON_NAME` diyordu ve o sentinel'i
// süpürgenin KENDİSİ yazıyor → bir kez temizlenen konaklama SONSUZA DEK
// dışarıda kalıyordu. Çapa `departureDate` ve o hiç ilerlemez. Sonuç: misafir
// yıllar sonra "şarj aletimi unuttum" diye yazınca o mesaj HİÇBİR ZAMAN
// anonimleşmiyordu.
//
// 🚨 ÖLÇÜLMÜŞ AŞIRI-SİLME (ters yön): temizlik `updateMany`inde YAŞ FİLTRESİ
// yoktu → eski bir konaklamaya BUGÜN yazılmış mesaj ilk geçişte siliniyordu.
// Yani "seçiciyi genişlet" tek başına DÜZELTME DEĞİL, felakettir: host'un
// cevaplamak için okuması gereken canlı metni her geçişte yok ederdi.
//
// İkisi TEK bayrakta çünkü tek kararın iki yarısı: "hüküm MESAJIN kendi yaşına
// göre verilir, konaklamanın yaşına göre değil".
// ---------------------------------------------------------------------------

const OLD = new Date(Date.now() - 40 * 30 * 24 * 60 * 60 * 1000); // ~40 ay

async function seedSweptStay() {
  const org = await prisma.organization.create({ data: { name: "Org" } });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "P" } });
  const reservation = await prisma.reservation.create({
    data: {
      propertyId: property.id,
      guestName: "Ahmet Yılmaz",
      guestPhone: "05321112233",
      arrivalDate: OLD,
      departureDate: OLD,
      status: "completed",
    },
  });
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      reservationId: reservation.id,
      channel: "airbnb",
      guestIdentifier: "Ahmet Yılmaz",
      lastMessageAt: OLD,
      messages: {
        create: [
          { direction: "inbound", senderName: "Ahmet Yılmaz", body: "Eski mesaj", createdAt: OLD },
        ],
      },
    },
  });
  return { reservationId: reservation.id, conversationId: conversation.id };
}

/** Süpürgeden SONRA gelen, cutoff'tan ESKİ bir misafir mesajı ekle. */
const addOldMessage = (conversationId: string, body: string) =>
  prisma.message.create({
    data: { conversationId, direction: "inbound", senderName: "Ahmet Yılmaz", body, createdAt: OLD },
  });

/** Süpürgeden SONRA gelen, BUGÜNKÜ bir misafir mesajı ekle. */
const addFreshMessage = (conversationId: string, body: string) =>
  prisma.message.create({
    data: { conversationId, direction: "inbound", senderName: "Ahmet Yılmaz", body },
  });

const bodyOf = (conversationId: string, contains: string) =>
  prisma.message
    .findFirst({ where: { conversationId, body: { contains } } })
    .then((m) => m?.body ?? null);

describe("retention — mesaj yaşı çapası", () => {
  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("DATA_RETENTION_MONTHS", "24");
  });
  afterEach(() => vi.unstubAllEnvs());

  describe("BAYRAK KAPALI (varsayılan) — davranış BİREBİR eski", () => {
    it("🚨 temizlenmiş konaklamaya sonradan yazılan ESKİ mesaj KAÇAR (bugünkü sızıntı)", async () => {
      const { conversationId, reservationId } = await seedSweptStay();
      await anonymizeOldGuestData();
      expect((await prisma.reservation.findUniqueOrThrow({ where: { id: reservationId } })).guestName).toBe(ANON_NAME);

      await addOldMessage(conversationId, "SIZAN: IBAN TR12 3456");
      await anonymizeOldGuestData();

      // Bugünkü (kusurlu) davranış AÇIKÇA pinleniyor — bayrak açılınca bu test
      // hâlâ geçmeli, çünkü kapalı yol değişmedi.
      expect(await bodyOf(conversationId, "SIZAN")).toContain("IBAN TR12 3456");
    });

    it("TAZE mesaj eski konaklamada ilk geçişte SİLİNİR (bugünkü aşırı-silme)", async () => {
      const { conversationId } = await seedSweptStay();
      await addFreshMessage(conversationId, "TAZE: bugün yazdım");
      await anonymizeOldGuestData();
      expect(await bodyOf(conversationId, "TAZE")).toBeNull(); // ANON_BODY oldu
    });
  });

  describe("BAYRAK AÇIK — hüküm mesajın KENDİ yaşına göre", () => {
    beforeEach(() => vi.stubEnv("RETENTION_MESSAGE_AGE_ANCHOR", "1"));

    it("🚨 temizlenmiş konaklamaya sonradan yazılan ESKİ mesaj ARTIK temizlenir", async () => {
      const { conversationId } = await seedSweptStay();
      await anonymizeOldGuestData(); // birinci geçiş: sentinel yazıldı
      await addOldMessage(conversationId, "SIZAN: IBAN TR12 3456");

      await anonymizeOldGuestData(); // ikinci geçiş: satır YENİDEN seçilebilmeli

      expect(await bodyOf(conversationId, "SIZAN")).toBeNull();
      expect(await prisma.message.count({ where: { conversationId, body: ANON_BODY } })).toBe(2);
    });

    it("🚨 TAZE mesaj KORUNUR — host onu cevaplamak için okuyabilmeli", async () => {
      const { conversationId } = await seedSweptStay();
      await addFreshMessage(conversationId, "TAZE: bugün yazdım");

      await anonymizeOldGuestData();

      expect(await bodyOf(conversationId, "TAZE")).toBe("TAZE: bugün yazdım");
      // KONTROL: aynı geçişte ESKİ mesaj temizlendi — süpürge çalışmadı değil,
      // DOĞRU satırı seçti.
      expect(await prisma.message.count({ where: { conversationId, body: ANON_BODY } })).toBe(1);
    });

    it("🚨 TERMİNE EDER — temizlenecek bir şey kalmayınca satır seçilmez (sonsuz döngü yok)", async () => {
      const { conversationId, reservationId } = await seedSweptStay();
      await anonymizeOldGuestData();
      const after1 = await prisma.reservation.findUniqueOrThrow({ where: { id: reservationId } });

      // Üç geçiş daha: hiçbir şey değişmemeli ve hiçbir satır yeniden yazılmamalı.
      for (let i = 0; i < 3; i++) await anonymizeOldGuestData();

      const after4 = await prisma.reservation.findUniqueOrThrow({ where: { id: reservationId } });
      expect(after4.updatedAt.getTime()).toBe(after1.updatedAt.getTime());
      expect(await prisma.message.count({ where: { conversationId, body: { not: ANON_BODY } } })).toBe(0);
    });

    it("ÖKSÜZ dal da aynı sınırı taşır (parite)", async () => {
      const org = await prisma.organization.create({ data: { name: "Org2" } });
      const property = await prisma.property.create({ data: { organizationId: org.id, name: "P2" } });
      const conv = await prisma.conversation.create({
        data: {
          propertyId: property.id,
          reservationId: null,
          channel: "airbnb",
          guestIdentifier: "Ayşe Kaya",
          lastMessageAt: OLD,
          messages: {
            create: [{ direction: "inbound", senderName: "Ayşe Kaya", body: "Eski yetim", createdAt: OLD }],
          },
        },
      });
      await prisma.message.create({
        data: { conversationId: conv.id, direction: "inbound", senderName: "Ayşe Kaya", body: "TAZE yetim" },
      });

      await anonymizeOldGuestData();

      expect(await bodyOf(conv.id, "TAZE yetim")).toBe("TAZE yetim");
      expect(await bodyOf(conv.id, "Eski yetim")).toBeNull();
    });
  });
});
