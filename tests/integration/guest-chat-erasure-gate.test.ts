import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";
import { generateChatToken, resolveGuestChat } from "@/lib/guest-chat";
import { POST as chatPost } from "@/app/api/chat/[token]/route";
import { tombstoneKeyHash, currentKeyFingerprint } from "@/lib/erasure";
import { ANON_NAME } from "@/lib/data-retention";

// ---------------------------------------------------------------------------
// KVKK AÇIK SİLME — DÖRDÜNCÜ INGRESS YOLU: QR CONCIERGE (P1 #2, 08-09 (2))
//
// 🚨 `erasure.ts`'in kendi başlık yorumu "every tombstone-scoped ingress writer"
// deyip ÜÇ yol sayıyordu (hospitable-sync · iCal feed sync · elle .ics/.csv
// yüklemesi). QR concierge DÖRDÜNCÜSÜYDÜ ve kapısızdı — `loadErasureGuard`
// `guest-chat.ts`te HİÇ geçmiyordu (grep: 0).
//
// SENARYO: misafir m.11 silme talebi yapar → `eraseReservationData` rezervasyonu
// maskeler + tombstone yazar → konaklama penceresi HÂLÂ AÇIKKEN dairedeki sabit
// QR okutulur → `ensureGuestChatConversation` YENİ bir Conversation açar ve
// `recordGuestChatExchange` YENİ Message satırları yazar. Silinmiş konaklama
// kendi kanalından geri doğar (Yönetmelik m.8 "tekrar kullanılamaz" ihlali).
//
// ⚠️ KAPI `resolveGuestChat`TE, yazma noktalarında DEĞİL — bilinçli. Rota
// aktif rezervasyon olmadan ilerleyemiyor, yani tek noktada durdurmak HEM
// Conversation HEM Message üretimini birlikte kapatıyor. Yazma noktalarına
// ayrı ayrı kapı koymak "biri unutulur" sınıfına girerdi.
// ---------------------------------------------------------------------------

const SECRET = "test-erasure-hmac-secret-at-least-32-chars-long";
const REF = "HM-ERASED-REF-1";

async function seedActiveStay(over: { guestName?: string; sourceReference?: string | null } = {}) {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const token = generateChatToken();
  await prisma.property.update({
    where: { id: propertyId },
    data: { chatToken: token, chatEnabled: true, checkInTime: "00:00", checkOutTime: "23:59" },
  });
  const reservation = await prisma.reservation.create({
    data: {
      propertyId,
      guestName: over.guestName ?? "Ayşe Yılmaz",
      arrivalDate: daysFromNow(-1),
      departureDate: daysFromNow(2),
      status: "confirmed",
      sourceReference: over.sourceReference === undefined ? REF : over.sourceReference,
    },
  });
  return { orgId, propertyId, token, reservationId: reservation.id };
}

/** Gerçek silme akışının yazdığı satırın aynısı: tombstone + maskelenmiş satır. */
async function writeTombstone(orgId: string, value: string) {
  const keyHash = tombstoneKeyHash(orgId, "source_reference", value);
  expect(keyHash, "hash üretilemedi — test kurulumu bozuk").toBeTruthy();
  await prisma.erasureTombstone.create({
    data: {
      organizationId: orgId,
      keyType: "source_reference",
      keyHash: keyHash!,
      erasedAt: new Date(),
      keyFingerprint: currentKeyFingerprint(),
    },
  });
}

describe("QR concierge — açık silme tombstone kapısı", () => {
  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("ERASURE_HMAC_SECRET", SECRET);
    vi.stubEnv("GUEST_CHAT_ENABLED", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 TOMBSTONE'LU rezervasyon QR'dan AÇILMAZ — Conversation/Message üretilemez", async () => {
    const { orgId, token } = await seedActiveStay();
    await writeTombstone(orgId, REF);

    const ctx = await resolveGuestChat(token);

    // Sohbet KAPALI: rota bu noktadan sonra hiçbir satır yazamaz.
    expect(ctx?.open ?? false).toBe(false);
    expect(ctx?.activeReservation ?? null).toBeNull();
    // Yan etki kanıtı: hiçbir konuşma/mesaj doğmadı.
    expect(await prisma.conversation.count()).toBe(0);
    expect(await prisma.message.count()).toBe(0);
  });

  it("🚨 MASKELENMİŞ satır (sourceReference YOK) da açılmaz — ikinci bacak", async () => {
    // Elle girilmiş bir rezervasyonun `sourceReference`ı olmayabilir; o hâlde
    // tombstone eşleşmesi ÖLÜ KODdUR. Maskeleme sentinel'i her hâlde duruyor ve
    // `erasure.ts` ile `data-retention.ts` AYNI sabiti yazıyor.
    const { token } = await seedActiveStay({ guestName: ANON_NAME, sourceReference: null });

    const ctx = await resolveGuestChat(token);

    expect(ctx?.open ?? false).toBe(false);
    expect(ctx?.activeReservation ?? null).toBeNull();
  });

  // ── UÇTAN UCA: ROTA SEVİYESİNDE YAZMA DENEMESİ ──────────────────────────
  //
  // `resolveGuestChat` kapalı diyor — ama asıl iddia "Conversation/Message
  // ÜRETİLEMEZ". Onu ancak GERÇEK rotayı çağırıp ölçerek kanıtlarım; resolver'ın
  // dönüşüne bakmak "rota o dönüşü onurlandırıyor" varsayımıdır.
  it("🚨 UÇTAN UCA: silinmiş konaklamaya QR'dan mesaj YAZILAMAZ", async () => {
    const { orgId, token } = await seedActiveStay();
    await writeTombstone(orgId, REF);

    const res = await chatPost(
      new Request(`http://localhost/api/chat/${token}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.44" },
        body: JSON.stringify({ message: "Merhaba, wifi şifresi nedir?" }),
      }) as never,
      { params: Promise.resolve({ token }) },
    );

    // ⚠️ DURUM KODU 200 ve bu DOĞRU: rota kapalı sohbette de 200 + `closed:true`
    // döner (misafire nazik bir metin gösterilir, 4xx değil). İlk yazımımda
    // `not.toBe(200)` diye assert etmiştim — YANLIŞTI ve testi kapı YERİNDEYKEN
    // kırmızı yapıyordu. Gerçek değişmez SATIR YAZILMAMASI.
    expect(await res.json()).toMatchObject({ closed: true });
    expect(await prisma.conversation.count()).toBe(0);
    expect(await prisma.message.count()).toBe(0);
  });

  it("KONTROL: silinmemiş aktif konaklama NORMAL açılır", async () => {
    // Bu olmadan "her zaman kapat" mutasyonu da yeşil geçerdi — ve o mutasyon
    // QR concierge'ü komple öldürürdü.
    const { token } = await seedActiveStay();

    const ctx = await resolveGuestChat(token);

    expect(ctx?.open).toBe(true);
    expect(ctx?.activeReservation?.guestName).toBe("Ayşe Yılmaz");
  });

  it("KONTROL: BAŞKA bir referansın tombstone'u bu konaklamayı etkilemez", async () => {
    // Kapı, tombstone VARLIĞINA değil EŞLEŞMEYE bakmalı; aksi hâlde tek bir
    // silme talebi org'un tüm QR sohbetlerini kapatırdı.
    const { orgId, token } = await seedActiveStay();
    await writeTombstone(orgId, "BASKA-REF-999");

    const ctx = await resolveGuestChat(token);

    expect(ctx?.open).toBe(true);
  });

  it("🚨 SİLİNEN konaklama kapanırken, AYNI dairedeki DİĞER konaklama açık kalır", async () => {
    // Kapı rezervasyon-başına; daire-başına değil. Aksi hâlde bir misafirin
    // silme talebi, aynı dairede kalan BAŞKA bir misafirin sohbetini de öldürürdü.
    const { orgId, propertyId, token } = await seedActiveStay();
    await writeTombstone(orgId, REF);
    // Silinen satır bugün çıkıyor; yerine bugün giren yeni bir misafir var.
    await prisma.reservation.update({
      where: { id: (await prisma.reservation.findFirstOrThrow({ where: { propertyId } })).id },
      data: { departureDate: daysFromNow(0) },
    });
    await prisma.reservation.create({
      data: {
        propertyId,
        guestName: "Mehmet Demir",
        arrivalDate: daysFromNow(0),
        departureDate: daysFromNow(3),
        status: "confirmed",
        sourceReference: "HM-TEMIZ-REF-2",
      },
    });

    const ctx = await resolveGuestChat(token);

    expect(ctx?.open).toBe(true);
    expect(ctx?.activeReservation?.guestName).toBe("Mehmet Demir");
  });
});
