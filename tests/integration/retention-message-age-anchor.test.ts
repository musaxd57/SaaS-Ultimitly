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
  return { reservationId: reservation.id, conversationId: conversation.id, propertyId: property.id };
}

const reservationOf = (id: string) => prisma.reservation.findUniqueOrThrow({ where: { id } });

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

    it("temizlenmiş konaklamaya SONRADAN eklenen telefon KAÇAR (bugünkü davranış — F07 bayrak kapalı)", async () => {
      const { reservationId } = await seedSweptStay();
      await anonymizeOldGuestData();
      await prisma.reservation.update({ where: { id: reservationId }, data: { guestPhone: "05329998877" } });
      await anonymizeOldGuestData();
      expect((await reservationOf(reservationId)).guestPhone).toBe("05329998877"); // bayrak kapalı: seçilmez
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

    // -----------------------------------------------------------------------
    // TAM YENİDEN-TEMİZLENEBİLİRLİK (Codex F07 — P1, veri yaşam döngüsü)
    //
    // 🚨 KAPATILAN AÇIK: bayrak açıkken seçici YALNIZ iki bacaktı (anonim
    // olmayan ad / eski temizlenmemiş inbound gövde). Adı zaten anonim, eski
    // inbound'u kalmamış bir kayda SONRADAN telefon / e-posta / not / görev
    // açıklaması / triyaj metni bağlanırsa hiçbiri seçilme sebebi değildi →
    // süresiz yaşıyordu. Codex gerçek fonksiyonun Prisma predicate'ini
    // yakalayarak gösterdi (yalnız iki OR bacağı).
    //
    // Bacak kuralı: yalnız SÜPÜRGENİN KENDİSİNİN null/sentinel yaptığı alanlar
    // bacak olur (→ sonlanma). Ad-redaksiyonuyla "temizlenen" metinler
    // (TaskUpdate.note, outbound gövde) bacak OLAMAZ: redaksiyon metni
    // bırakır, bacak sonsuza dek yeniden seçerdi. Bu sınır aşağıda pinli.
    // -----------------------------------------------------------------------
    it("🚨 Codex kanıtı: anonim ad + SONRADAN eklenen rezervasyon PII'si ikinci geçişte temizlenir", async () => {
      const cases = [
        { field: "guestPhone", data: { guestPhone: "05329998877" } },
        { field: "guestEmail", data: { guestEmail: "ahmet@example.com" } },
        { field: "notes", data: { notes: "Ahmet arayıp geç check-in istedi" } },
        { field: "guestExternalId", data: { guestExternalId: "guest-ext-77" } },
        { field: "guestCheckoutTime", data: { guestCheckoutTime: "10:30" } },
      ] as const;
      for (const c of cases) {
        const { reservationId } = await seedSweptStay();
        await anonymizeOldGuestData(); // ad anonim, inbound temiz
        await prisma.reservation.update({ where: { id: reservationId }, data: c.data });

        await anonymizeOldGuestData(); // ⬅️ ARIZADA: satır seçilmiyor, değer kalıyor

        const row = (await reservationOf(reservationId)) as unknown as Record<string, unknown>;
        expect(row[c.field], c.field).toBeNull();
        expect(row.guestName).toBe(ANON_NAME);
      }
    });

    // ⚠️ İKİ AYRI TEST — ilk yazımda tek testte ad + triyaj birlikte yazılıyordu ve
    // "ad bacağını sil" mutasyonu YEŞİL kalıyordu (triyaj bacağı satırı seçiyor,
    // scrub adı da sıfırlıyordu). Her bacak TEK BAŞINA tetiklemeli.
    it("konuşmaya SONRADAN yazılan gerçek ad (yalnız o) yeniden seçilir ve anonimleşir", async () => {
      const { conversationId } = await seedSweptStay();
      await anonymizeOldGuestData();
      await prisma.conversation.update({ where: { id: conversationId }, data: { guestIdentifier: "Ahmet Yılmaz" } });

      await anonymizeOldGuestData();

      expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).guestIdentifier).toBe("Misafir");
    });

    it("konuşmaya SONRADAN yazılan triyaj metinleri (yalnız onlar) yeniden seçilir ve null olur", async () => {
      const { conversationId } = await seedSweptStay();
      await anonymizeOldGuestData();
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { aiActionSuggestion: "Ahmet'i ara", aiMissingInfoJson: '["fotoğraf"]' },
      });

      await anonymizeOldGuestData();

      const c = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
      expect(c.aiActionSuggestion).toBeNull();
      expect(c.aiMissingInfoJson).toBeNull();
    });

    it("eski rezervasyona SONRADAN bağlanan görev açıklaması (misafirin ham metni) temizlenir", async () => {
      const { reservationId, propertyId } = await seedSweptStay();
      await anonymizeOldGuestData();
      const task = await prisma.task.create({
        data: { propertyId, reservationId, type: "cleaning", title: "Şikayet", description: "Ahmet: klima bozuk, 0532 111 2233" },
      });

      await anonymizeOldGuestData();

      expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).description).toBe(ANON_BODY);
    });

    it("🚨 TERMİNE EDER — yeniden seçim SONRASI da: temizleyen geçişten sonra üç geçiş hiçbir satırı yazmaz", async () => {
      const { reservationId } = await seedSweptStay();
      await anonymizeOldGuestData();
      await prisma.reservation.update({ where: { id: reservationId }, data: { guestPhone: "05329998877", notes: "not" } });
      await anonymizeOldGuestData(); // yeniden seçildi ve temizlendi
      const after2 = await reservationOf(reservationId);
      expect(after2.guestPhone).toBeNull();

      for (let i = 0; i < 3; i++) await anonymizeOldGuestData();

      expect((await reservationOf(reservationId)).updatedAt.getTime()).toBe(after2.updatedAt.getTime());
    });

    it("KONTROL: TAZE misafir mesajı, PII yeniden-seçimi sırasında da KORUNUR", async () => {
      // Yeniden seçilen satırın temizliği yaş filtresinden geçmeye devam eder.
      const { reservationId, conversationId } = await seedSweptStay();
      await anonymizeOldGuestData();
      await prisma.reservation.update({ where: { id: reservationId }, data: { guestPhone: "05329998877" } });
      await addFreshMessage(conversationId, "TAZE: şarj aletimi unuttum");

      await anonymizeOldGuestData();

      expect((await reservationOf(reservationId)).guestPhone).toBeNull(); // seçildi
      expect(await bodyOf(conversationId, "TAZE")).toBe("TAZE: şarj aletimi unuttum"); // ama taze metin duruyor
    });

    it("BİLİNEN SINIR (pinli): ad-redaksiyonlu metinler yeniden seçim TETİKLEMEZ — işaret kolonu ister", async () => {
      // TaskUpdate.note ve outbound gövde yalnız AD-redaksiyonuyla temizlenir;
      // redaksiyon metni bıraktığı için bunlar bacak olamaz (sonsuz yeniden seçim).
      // Ad zaten anonimleştiğinde redaksiyonun bileceği bir ad da kalmaz.
      // Kapatılması `Reservation.lastScrubbedAt` gibi bir işaret kolonu = migration ister.
      const { reservationId, propertyId } = await seedSweptStay();
      await anonymizeOldGuestData();
      const task = await prisma.task.create({ data: { propertyId, reservationId, type: "cleaning", title: "Temizlik" } });
      const upd = await prisma.taskUpdate.create({ data: { taskId: task.id, note: "Ahmet Yılmaz'ın odası hazır" } });

      await anonymizeOldGuestData();

      expect((await prisma.taskUpdate.findUniqueOrThrow({ where: { id: upd.id } })).note).toBe("Ahmet Yılmaz'ın odası hazır");
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

    it("ÖKSÜZ dal: SONRADAN yazılan triyaj metinleri yeniden seçilir ve temizlenir (F07 paritesi)", async () => {
      const org = await prisma.organization.create({ data: { name: "Org3" } });
      const property = await prisma.property.create({ data: { organizationId: org.id, name: "P3" } });
      const conv = await prisma.conversation.create({
        data: {
          propertyId: property.id,
          reservationId: null,
          channel: "airbnb",
          guestIdentifier: "Ayşe Kaya",
          lastMessageAt: OLD,
          messages: { create: [{ direction: "inbound", senderName: "Ayşe Kaya", body: "Eski yetim", createdAt: OLD }] },
        },
      });
      await anonymizeOldGuestData(); // ad anonim, gövde temiz
      await prisma.conversation.update({
        where: { id: conv.id },
        data: { aiActionSuggestion: "Ayşe'yi ara", aiMissingInfoJson: '["adres"]' },
      });

      await anonymizeOldGuestData();

      const c = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } });
      expect(c.aiActionSuggestion).toBeNull();
      expect(c.aiMissingInfoJson).toBeNull();
    });
  });
});
