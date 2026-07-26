import { describe, it, expect, beforeEach } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { cleanupDuplicateConversations } from "@/lib/conversations-cleanup";

async function makeConv(
  propertyId: string,
  opts: {
    guest: string;
    ext: string | null;
    bodies: string[];
    lastMessageAt?: Date;
    channel?: string;
    reservationId?: string;
  },
) {
  return prisma.conversation.create({
    data: {
      propertyId,
      channel: opts.channel ?? "airbnb",
      guestIdentifier: opts.guest,
      status: "new",
      externalReservationId: opts.ext,
      reservationId: opts.reservationId ?? null,
      lastMessageAt: opts.lastMessageAt ?? new Date(),
      messages: {
        create: opts.bodies.map((body, i) => ({
          direction: "inbound",
          senderName: opts.guest,
          body,
          createdAt: new Date(Date.now() + i * 1000),
        })),
      },
    },
    select: { id: true },
  });
}

describe("cleanupDuplicateConversations", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("reconnect (FARKLI ext id, aynı tarihler) artık SİLİNMEZ — kanıt gelene kadar review", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    // Reconnect split Mohammad across two reservation IDs: the new thread has the
    // full history, the old one is a subset.
    //
    // The two rows now also carry LINKED reservations describing the SAME window
    // — that is what proves "one real stay, two provider ids" (audit 07-25).
    // Without a linked reservation identity is unprovable and the tool refuses
    // to delete; that contract is pinned separately below.
    const sameWindow = {
      guestName: "Mohammad",
      arrivalDate: new Date("2026-05-02"),
      departureDate: new Date("2026-05-06"),
      status: "completed",
      channel: "airbnb",
    };
    const rNew = await prisma.reservation.create({ data: { propertyId, ...sameWindow }, select: { id: true } });
    const rOld = await prisma.reservation.create({ data: { propertyId, ...sameWindow }, select: { id: true } });
    const keeper = await makeConv(propertyId, {
      guest: "Mohammad",
      ext: "res-new",
      bodies: ["bags at 14:00?", "thanks, left the keys"],
      lastMessageAt: new Date(),
      reservationId: rNew.id,
    });
    const stale = await makeConv(propertyId, {
      guest: "Mohammad",
      ext: "res-old",
      bodies: ["bags at 14:00?"],
      lastMessageAt: new Date(Date.now() - 3_600_000),
      reservationId: rOld.id,
    });

    const res = await cleanupDuplicateConversations(orgId);

    // RETIRED BEHAVIOUR (Codex, audit 07-25): this used to delete the stale copy
    // on the theory that a reconnect re-issues the reservation id for one real
    // stay. That theory is unproven (live payload unavailable, official API docs
    // 403), so DIFFERENT externalReservationId values no longer license a
    // delete — identical dates included. The scenario is kept here as the record
    // of what changed; the case that still auto-dedupes (EQUAL identifier) is
    // pinned in the "tarih eşitliği kimlik DEĞİLDİR" block.
    expect(res).toMatchObject({ removed: 0, groups: 1, needsReview: 1 });
    expect(await prisma.conversation.findUnique({ where: { id: keeper.id } })).not.toBeNull();
    expect(await prisma.conversation.findUnique({ where: { id: stale.id } })).not.toBeNull();
    expect(await prisma.message.count()).toBe(3); // hiçbir mesaj kaybolmadı
  });

  it("does NOT delete a duplicate that holds a message the keeper lacks", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await makeConv(propertyId, { guest: "Ana", ext: "r1", bodies: ["A", "B"] });
    await makeConv(propertyId, { guest: "Ana", ext: "r2", bodies: ["A", "C"] }); // C is unique

    const res = await cleanupDuplicateConversations(orgId);

    expect(res).toMatchObject({ removed: 0, needsReview: 1 });
    expect(await prisma.conversation.count()).toBe(2); // both kept for manual review
  });

  it("leaves different guests alone", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await makeConv(propertyId, { guest: "Guest A", ext: "a", bodies: ["hi"] });
    await makeConv(propertyId, { guest: "Guest B", ext: "b", bodies: ["hi"] });

    const res = await cleanupDuplicateConversations(orgId);

    expect(res).toMatchObject({ removed: 0, groups: 0 });
    expect(await prisma.conversation.count()).toBe(2);
  });

  it("ignores non-channel conversations (no externalReservationId)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await makeConv(propertyId, { guest: "Walk In", ext: null, bodies: ["hi"], channel: "direct" });
    await makeConv(propertyId, { guest: "Walk In", ext: null, bodies: ["hi"], channel: "direct" });

    const res = await cleanupDuplicateConversations(orgId);

    expect(res).toMatchObject({ removed: 0, groups: 0 });
    expect(await prisma.conversation.count()).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// CANLI VERİ KAYBI YOLU (denetim 07-25). Bu araç `withManage` altında,
// BAYRAKSIZ ve GERİ ALINAMAZ biçimde konuşma + mesaj siliyor.
//
// Eski kural: grupla (property + misafir adı), sonra "keeper'ın gövde kümesi
// bu kopyanın gövdelerini kapsıyorsa SİL". Kimlik sinyali YOKTU — yalnız
// normalize edilmiş mesaj METNİ. Aynı misafirin aynı dairedeki İKİ AYRI
// konaklaması, kısa/jenerik mesajlarla ("Merhaba", "Teşekkürler") trivial
// biçimde alt küme olur → eski konaklama tamamen silinirdi.
//
// Yeni kural: silme ancak İKİ SATIRIN AYNI KONAKLAMAYA ait olduğu
// KANITLANABİLDİĞİNDE. Kanıt = aynı yerel reservationId, ya da bağlı iki
// rezervasyonun giriş+çıkış tarihlerinin birebir aynı olması (sağlayıcının
// yeniden id ürettiği reconnect senaryosu). Kanıt yoksa → needsReview.
// Ayrıca iki satırın externalConversationId'si ÇELİŞİYORSA → needsReview.
// ---------------------------------------------------------------------------
describe("cleanupDuplicateConversations — kimlik kanıtı olmadan SİLMEZ", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function stay(propertyId: string, arrival: string, departure: string) {
    return prisma.reservation.create({
      data: {
        propertyId,
        guestName: "Ahmet Yılmaz",
        arrivalDate: new Date(arrival),
        departureDate: new Date(departure),
        status: "completed",
        channel: "airbnb",
      },
      select: { id: true },
    });
  }

  it("AYNI misafir + AYNI daire fakat FARKLI konaklama → ASLA birleştirilmez", async () => {
    const { propertyId, orgId } = await makeOrgWithProperty();
    const june = await stay(propertyId, "2026-06-01", "2026-06-04");
    const october = await stay(propertyId, "2026-10-01", "2026-10-04");

    // Haziran konaklaması: kısa, jenerik mesajlar.
    const older = await prisma.conversation.create({
      data: {
        propertyId, channel: "airbnb", guestIdentifier: "Ahmet Yılmaz", status: "new",
        externalReservationId: "res-june", reservationId: june.id,
        messages: { create: [
          { direction: "inbound", senderName: "Ahmet Yılmaz", body: "Merhaba" },
          { direction: "inbound", senderName: "Ahmet Yılmaz", body: "Teşekkürler" },
        ] },
      },
      select: { id: true },
    });
    // Ekim konaklaması: aynı jenerik mesajlar + fazlası → eskisi ALT KÜME olur.
    await prisma.conversation.create({
      data: {
        propertyId, channel: "airbnb", guestIdentifier: "Ahmet Yılmaz", status: "new",
        externalReservationId: "res-october", reservationId: october.id,
        messages: { create: [
          { direction: "inbound", senderName: "Ahmet Yılmaz", body: "Merhaba" },
          { direction: "inbound", senderName: "Ahmet Yılmaz", body: "Teşekkürler" },
          { direction: "inbound", senderName: "Ahmet Yılmaz", body: "Geç çıkış olur mu?" },
        ] },
      },
    });

    const res = await cleanupDuplicateConversations(orgId);

    expect(res.removed).toBe(0); // HİÇBİR ŞEY SİLİNMEZ
    expect(res.needsReview).toBe(1);
    // Haziran konuşması ve mesajları yerinde durmalı.
    expect(await prisma.conversation.count({ where: { id: older.id } })).toBe(1);
    expect(await prisma.message.count({ where: { conversationId: older.id } })).toBe(2);
  });

  it("externalConversationId ÇELİŞİYORSA (iki gerçek thread) → needsReview", async () => {
    const { propertyId, orgId } = await makeOrgWithProperty();
    const s = await stay(propertyId, "2026-08-01", "2026-08-04");

    await prisma.conversation.create({
      data: {
        propertyId, channel: "airbnb", guestIdentifier: "Ahmet Yılmaz", status: "new",
        externalReservationId: "res-x", externalConversationId: "conv-A", reservationId: s.id,
        messages: { create: [{ direction: "inbound", senderName: "Ahmet Yılmaz", body: "Merhaba" }] },
      },
    });
    await prisma.conversation.create({
      data: {
        propertyId, channel: "airbnb", guestIdentifier: "Ahmet Yılmaz", status: "new",
        externalReservationId: "res-x", externalConversationId: "conv-B", reservationId: s.id,
        messages: { create: [
          { direction: "inbound", senderName: "Ahmet Yılmaz", body: "Merhaba" },
          { direction: "inbound", senderName: "Ahmet Yılmaz", body: "Ek soru" },
        ] },
      },
    });

    const res = await cleanupDuplicateConversations(orgId);
    expect(res.removed).toBe(0); // ayrı gerçek thread olabilir → dokunma
    expect(res.needsReview).toBe(1);
  });

  it("bağlı rezervasyon YOKSA kimlik kanıtlanamaz → needsReview", async () => {
    const { propertyId, orgId } = await makeOrgWithProperty();
    await makeConv(propertyId, { guest: "Zeynep", ext: "e1", bodies: ["Merhaba"] });
    await makeConv(propertyId, { guest: "Zeynep", ext: "e2", bodies: ["Merhaba", "Tamam"] });

    const res = await cleanupDuplicateConversations(orgId);
    expect(res.removed).toBe(0);
    expect(res.needsReview).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// CODEX DÜZELTMESİ (0aabf70 tam kapatmamıştı): GİRİŞ+ÇIKIŞ TARİHLERİNİN
// EŞİTLİĞİ REZERVASYON KİMLİĞİ DEĞİLDİR.
//
// İlk düzeltme "iki bağlı rezervasyonun tarihleri aynıysa aynı konaklamadır"
// diyordu. Bu, "sağlayıcı reconnect'te rezervasyon id'sini yeniden üretti"
// HİPOTEZİNİ silme gerekçesine çeviriyor — oysa o hipotez henüz kanıtlanmadı
// (canlı Hospitable payload'ı görülemedi, resmî API belgesi 403 döndü).
// Kanıtlanana kadar tarih benzerliği SİLME SEBEBİ OLAMAZ.
//
// Otomatik silme artık YALNIZ eşit bir KİMLİK varsa:
//   · aynı non-null yerel reservationId, VEYA
//   · aynı non-null externalReservationId
// ve externalConversationId çelişkisi yoksa. Kimliklerden biri eksikse ya da
// externalReservationId'ler FARKLIYSA (tarihler aynı olsa bile) → needsReview.
// ---------------------------------------------------------------------------
describe("cleanupDuplicateConversations — tarih eşitliği kimlik DEĞİLDİR", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("AYNI tarihler fakat FARKLI externalReservationId → SİLİNMEZ, mesajlar korunur", async () => {
    const { propertyId, orgId } = await makeOrgWithProperty();
    const window = {
      guestName: "Selin Kaya",
      arrivalDate: new Date("2026-09-01"),
      departureDate: new Date("2026-09-05"),
      status: "completed",
      channel: "airbnb",
    };
    const r1 = await prisma.reservation.create({ data: { propertyId, ...window }, select: { id: true } });
    const r2 = await prisma.reservation.create({ data: { propertyId, ...window }, select: { id: true } });

    const older = await prisma.conversation.create({
      data: {
        propertyId, channel: "airbnb", guestIdentifier: "Selin Kaya", status: "new",
        externalReservationId: "res-AAA", reservationId: r1.id,
        lastMessageAt: new Date(Date.now() - 3_600_000),
        messages: { create: [{ direction: "inbound", senderName: "Selin Kaya", body: "Merhaba" }] },
      },
      select: { id: true },
    });
    await prisma.conversation.create({
      data: {
        propertyId, channel: "airbnb", guestIdentifier: "Selin Kaya", status: "new",
        externalReservationId: "res-BBB", reservationId: r2.id,
        messages: { create: [
          { direction: "inbound", senderName: "Selin Kaya", body: "Merhaba" },
          { direction: "inbound", senderName: "Selin Kaya", body: "Otopark var mı?" },
        ] },
      },
    });

    const res = await cleanupDuplicateConversations(orgId);

    expect(res.removed).toBe(0);
    expect(res.needsReview).toBe(1);
    expect(await prisma.conversation.count({ where: { id: older.id } })).toBe(1);
    expect(await prisma.message.count({ where: { conversationId: older.id } })).toBe(1);
  });

  it("AYNI externalReservationId (yarış artığı) → dedupe edilir", async () => {
    // Kimlik EŞİT: tek sağlayıcı rezervasyonu için iki satır oluşmuş.
    //
    // Bu vaka, planlanan `@@unique([propertyId, externalReservationId])` ile
    // ÖRTÜŞÜR — ama ikisi AYNI TANIM DEĞİLDİR (Codex). Kesişirler, hiçbiri
    // diğerini kapsamaz: cleanup aynı yerel reservationId'yi de kabul eder
    // (unique etmez), unique ise farklı guestIdentifier'lı çifti bloklar
    // (cleanup onları guest'e göre grupladığı için hiç karşılaştırmaz).
    const { propertyId, orgId } = await makeOrgWithProperty();
    const stale = await makeConv(propertyId, { guest: "Emre", ext: "res-SAME", bodies: ["Merhaba"] });
    await makeConv(propertyId, { guest: "Emre", ext: "res-SAME", bodies: ["Merhaba", "Anahtar?"] });

    const res = await cleanupDuplicateConversations(orgId);
    expect(res.removed).toBe(1);
    expect(await prisma.conversation.count({ where: { id: stale.id } })).toBe(0);
  });

  it("KİMLİK EKSİKSE (aynı ext, ama conversation id'leri çelişiyor) → needsReview", async () => {
    const { propertyId, orgId } = await makeOrgWithProperty();
    await prisma.conversation.create({
      data: {
        propertyId, channel: "airbnb", guestIdentifier: "Deniz", status: "new",
        externalReservationId: "res-SAME", externalConversationId: "conv-1",
        messages: { create: [{ direction: "inbound", senderName: "Deniz", body: "Merhaba" }] },
      },
    });
    await prisma.conversation.create({
      data: {
        propertyId, channel: "airbnb", guestIdentifier: "Deniz", status: "new",
        externalReservationId: "res-SAME", externalConversationId: "conv-2",
        messages: { create: [
          { direction: "inbound", senderName: "Deniz", body: "Merhaba" },
          { direction: "inbound", senderName: "Deniz", body: "Ek" },
        ] },
      },
    });

    const res = await cleanupDuplicateConversations(orgId);
    expect(res.removed).toBe(0);
    expect(res.needsReview).toBe(1);
  });
});
