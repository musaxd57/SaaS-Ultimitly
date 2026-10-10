import { afterAll, beforeAll, describe, it, expect, beforeEach } from "vitest";
import {
  prisma,
  resetDb,
  makeOrgWithProperty,
  dropConversationIdentityUnique,
  restoreConversationIdentityUnique,
} from "../helpers/db";
import { CLEANUP_REPOINTED_MODELS, cleanupDuplicateConversations } from "@/lib/conversations-cleanup";
import { inventoryConversationReferences } from "../../scripts/apply-conversation-dedupe";

// MIGRATION 45 ESCAPE HATCH. This file's whole purpose is to seed the duplicate
// rows that `@@unique([propertyId, externalReservationId])` forbids, so the
// index comes off for this file and goes back on afterwards. Sequential test
// files (fileParallelism: false) make that safe, and the unconditional restore
// doubles as a leak check.
beforeAll(dropConversationIdentityUnique);
afterAll(restoreConversationIdentityUnique);


async function makeConv(
  propertyId: string,
  opts: {
    guest: string;
    ext: string | null;
    bodies: string[];
    lastMessageAt?: Date;
    channel?: string;
    reservationId?: string;
    /** Sağlayıcı mesaj kimlikleri (gerçek yarış artığında iki kopya AYNI sağlayıcı mesajlarını taşır). */
    messageIds?: (string | null)[];
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
          externalId: opts.messageIds?.[i] ?? null,
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
    // Yarış artığı: iki satır AYNI sağlayıcı mesajlarını içe aktarmış (aynı sağlayıcı mesaj kimliği).
    const stale = await makeConv(propertyId, { guest: "Emre", ext: "res-SAME", bodies: ["Merhaba"], messageIds: ["m-1"] });
    await makeConv(propertyId, { guest: "Emre", ext: "res-SAME", bodies: ["Merhaba", "Anahtar?"], messageIds: ["m-1", "m-2"] });

    const res = await cleanupDuplicateConversations(orgId);
    expect(res.removed).toBe(1);
    expect(await prisma.conversation.count({ where: { id: stale.id } })).toBe(0);
  });

  it("🚨 silinen kopyaya bağlı açık istek / karar kartı / misafir sözü kazanana TAŞINIR (eskiden konuşmayla sessizce siliniyordu)", async () => {
    const { propertyId, orgId } = await makeOrgWithProperty();
    const stale = await makeConv(propertyId, { guest: "Emre", ext: "res-SAME", bodies: ["Merhaba"], messageIds: ["m-1"] });
    const keeper = await makeConv(propertyId, { guest: "Emre", ext: "res-SAME", bodies: ["Merhaba", "Anahtar?"], messageIds: ["m-1", "m-2"] });
    await prisma.conversationItem.create({
      data: { organizationId: orgId, conversationId: stale.id, messageId: "msg-x", kind: "payment_invoice", sensitivity: "sensitive", riskType: "platform_policy", sources: "lexical", status: "pending_host" },
    });
    await prisma.decisionRequest.create({ data: { organizationId: orgId, conversationId: stale.id, messageId: "msg-x", kind: "early_checkin", requestedTime: "13:00", lang: "tr" } });
    await prisma.guestCommitment.create({ data: { organizationId: orgId, conversationId: stale.id, kind: "towels", dueAt: new Date(Date.now() + 3_600_000) } });

    expect((await cleanupDuplicateConversations(orgId)).removed).toBe(1);
    expect(await prisma.conversationItem.count({ where: { conversationId: keeper.id, status: "pending_host" } })).toBe(1);
    expect(await prisma.decisionRequest.count({ where: { conversationId: keeper.id } })).toBe(1);
    expect(await prisma.guestCommitment.count({ where: { conversationId: keeper.id, status: "open" } })).toBe(1);
  });

  it("🚨 taşınan model listesi şemadaki konuşma referans envanteriyle BİREBİR aynı (mesajlar hariç — onlar kapsanmış kopya, silinir)", () => {
    expect([...CLEANUP_REPOINTED_MODELS].sort()).toEqual(inventoryConversationReferences().filter((m) => m !== "Message"));
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

// ---------------------------------------------------------------------------
// CODEX 09-30 (A1): MESAJ METNİ KİMLİK DEĞİLDİR. Eski alt küme testi yalnız normalize GÖVDEYE bakıyordu: tutulan sohbette
// ev sahibinin "Merhaba"sı varken kopyadaki misafirin (sonraki, başka) "Merhaba"sı "zaten var" sayılıyor ve kopya — misafirin
// mesajıyla birlikte — geri alınamaz biçimde siliniyordu. Aynı mesaj artık: aynı sağlayıcı mesaj kimliği + yön + gövde
// (kimlik yoksa aynı yön + an + gövde), BİRE BİR sayılarak.
// ---------------------------------------------------------------------------
describe("cleanupDuplicateConversations — mesaj kimliği (Codex 09-30 A1)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function sameStayPair(propertyId: string) {
    const r = await prisma.reservation.create({
      data: {
        propertyId,
        guestName: "Ada Demir",
        arrivalDate: new Date("2026-11-02"),
        departureDate: new Date("2026-11-05"),
        status: "confirmed",
        channel: "airbnb",
      },
      select: { id: true },
    });
    return r.id;
  }

  async function conv(
    propertyId: string,
    reservationId: string,
    ext: string,
    messages: { body: string; direction: "inbound" | "outbound"; externalId: string | null; at: string }[],
  ) {
    return prisma.conversation.create({
      data: {
        propertyId,
        channel: "airbnb",
        guestIdentifier: "Ada Demir",
        status: "new",
        externalReservationId: ext,
        reservationId,
        messages: {
          create: messages.map((m) => ({
            direction: m.direction,
            senderName: m.direction === "inbound" ? "Ada Demir" : "Ev sahibi",
            authorType: m.direction === "inbound" ? "guest" : "host",
            body: m.body,
            externalId: m.externalId,
            createdAt: new Date(m.at),
          })),
        },
      },
      select: { id: true },
    });
  }

  it("🚨 ev sahibinin 'Merhaba'sı misafirin sonraki 'Merhaba'sını kapsamaz → kopya SİLİNMEZ, misafirin mesajı yerinde", async () => {
    const { propertyId, orgId } = await makeOrgWithProperty();
    const rid = await sameStayPair(propertyId);
    await conv(propertyId, rid, "res-A", [
      { body: "Merhaba", direction: "outbound", externalId: "h-1", at: "2026-11-01T09:00:00Z" },
      { body: "Giriş 15:00'te.", direction: "outbound", externalId: "h-2", at: "2026-11-01T09:01:00Z" },
    ]);
    const dup = await conv(propertyId, rid, "res-B", [
      { body: "Merhaba", direction: "inbound", externalId: "g-9", at: "2026-11-03T20:00:00Z" },
    ]);

    const res = await cleanupDuplicateConversations(orgId);

    expect(res).toMatchObject({ removed: 0, groups: 1, needsReview: 1 });
    expect(await prisma.message.count({ where: { conversationId: dup.id, direction: "inbound", body: "Merhaba" } })).toBe(1);
  });

  it("🚨 aynı metinli İKİ misafir mesajı tutulandaki TEK mesajla kapanmaz (çoklu küme)", async () => {
    const { propertyId, orgId } = await makeOrgWithProperty();
    const rid = await sameStayPair(propertyId);
    await conv(propertyId, rid, "res-A", [
      { body: "Tamam", direction: "inbound", externalId: "g-1", at: "2026-11-02T10:00:00Z" },
      { body: "Anahtar nerede?", direction: "inbound", externalId: "g-2", at: "2026-11-02T11:00:00Z" },
      { body: "Kutuda.", direction: "outbound", externalId: "h-1", at: "2026-11-02T11:05:00Z" },
    ]);
    const dup = await conv(propertyId, rid, "res-B", [
      { body: "Tamam", direction: "inbound", externalId: "g-1", at: "2026-11-02T10:00:00Z" },
      { body: "tamam ", direction: "inbound", externalId: "g-7", at: "2026-11-04T18:00:00Z" },
    ]);

    const res = await cleanupDuplicateConversations(orgId);

    expect(res).toMatchObject({ removed: 0, needsReview: 1 });
    expect(await prisma.message.count({ where: { conversationId: dup.id } })).toBe(2);
  });

  it("aynı sağlayıcı kimliği ama FARKLI yön → eşleşmez (inceleme)", async () => {
    const { propertyId, orgId } = await makeOrgWithProperty();
    const rid = await sameStayPair(propertyId);
    await conv(propertyId, rid, "res-A", [
      { body: "Merhaba", direction: "outbound", externalId: "x-1", at: "2026-11-02T10:00:00Z" },
      { body: "Hoş geldiniz", direction: "outbound", externalId: "x-2", at: "2026-11-02T10:01:00Z" },
    ]);
    await conv(propertyId, rid, "res-B", [{ body: "Merhaba", direction: "inbound", externalId: "x-1", at: "2026-11-02T10:00:00Z" }]);

    expect(await cleanupDuplicateConversations(orgId)).toMatchObject({ removed: 0, needsReview: 1 });
  });

  it("sağlayıcı kimliği bir tarafta var, öbüründe yok → eşleşmez (şüphede inceleme)", async () => {
    const { propertyId, orgId } = await makeOrgWithProperty();
    const rid = await sameStayPair(propertyId);
    await conv(propertyId, rid, "res-A", [
      { body: "Otopark var mı?", direction: "inbound", externalId: "g-1", at: "2026-11-02T10:00:00Z" },
      { body: "Evet.", direction: "outbound", externalId: "h-1", at: "2026-11-02T10:05:00Z" },
    ]);
    await conv(propertyId, rid, "res-B", [{ body: "Otopark var mı?", direction: "inbound", externalId: null, at: "2026-11-02T10:00:00Z" }]);

    expect(await cleanupDuplicateConversations(orgId)).toMatchObject({ removed: 0, needsReview: 1 });
  });

  it("kimliksiz yerel mesaj: aynı yön + aynı an + aynı gövde eşleşir, farklı an eşleşmez", async () => {
    const { propertyId, orgId } = await makeOrgWithProperty();
    const rid = await sameStayPair(propertyId);
    await conv(propertyId, rid, "res-A", [
      { body: "Merhaba", direction: "inbound", externalId: null, at: "2026-11-02T10:00:00Z" },
      { body: "Teşekkürler", direction: "inbound", externalId: null, at: "2026-11-02T12:00:00Z" },
    ]);
    const same = await conv(propertyId, rid, "res-B", [{ body: "  merhaba ", direction: "inbound", externalId: null, at: "2026-11-02T10:00:00Z" }]);
    const later = await conv(propertyId, rid, "res-C", [{ body: "Merhaba", direction: "inbound", externalId: null, at: "2026-11-04T10:00:00Z" }]);

    const res = await cleanupDuplicateConversations(orgId);

    expect(res).toMatchObject({ removed: 1, needsReview: 1 });
    expect(await prisma.conversation.count({ where: { id: same.id } })).toBe(0);
    expect(await prisma.conversation.count({ where: { id: later.id } })).toBe(1);
  });

  it("kimliksiz yerel mesaj: aynı an + aynı gövde ama FARKLI yön → eşleşmez (mutasyon 09-30)", async () => {
    const { propertyId, orgId } = await makeOrgWithProperty();
    const rid = await sameStayPair(propertyId);
    await conv(propertyId, rid, "res-A", [
      { body: "Merhaba", direction: "outbound", externalId: null, at: "2026-11-02T10:00:00Z" },
      { body: "Hoş geldiniz", direction: "outbound", externalId: null, at: "2026-11-02T10:01:00Z" },
    ]);
    await conv(propertyId, rid, "res-B", [{ body: "Merhaba", direction: "inbound", externalId: null, at: "2026-11-02T10:00:00Z" }]);

    expect(await cleanupDuplicateConversations(orgId)).toMatchObject({ removed: 0, needsReview: 1 });
  });

  it("çoklu küme: kopyada AYNI anahtarlı iki yerel mesaj, tutulanda TEK → kopya silinmez (mutasyon 09-30)", async () => {
    const { propertyId, orgId } = await makeOrgWithProperty();
    const rid = await sameStayPair(propertyId);
    await conv(propertyId, rid, "res-A", [
      { body: "Tamam", direction: "inbound", externalId: null, at: "2026-11-02T10:00:00Z" },
      { body: "Kapı kodu?", direction: "inbound", externalId: null, at: "2026-11-02T10:05:00Z" },
      { body: "Mesajınızda.", direction: "outbound", externalId: null, at: "2026-11-02T10:06:00Z" },
    ]);
    const dup = await conv(propertyId, rid, "res-B", [
      { body: "Tamam", direction: "inbound", externalId: null, at: "2026-11-02T10:00:00Z" },
      { body: "Tamam", direction: "inbound", externalId: null, at: "2026-11-02T10:00:00Z" },
    ]);

    expect(await cleanupDuplicateConversations(orgId)).toMatchObject({ removed: 0, needsReview: 1 });
    expect(await prisma.message.count({ where: { conversationId: dup.id } })).toBe(2);
  });

  it("KONTROL — kopyanın her mesajı tutulanda AYNI sağlayıcı mesajı olarak varsa (aynı konaklama) kopya silinir", async () => {
    const { propertyId, orgId } = await makeOrgWithProperty();
    const rid = await sameStayPair(propertyId);
    await conv(propertyId, rid, "res-A", [
      { body: "Merhaba", direction: "inbound", externalId: "g-1", at: "2026-11-02T10:00:00Z" },
      { body: "Merhaba", direction: "outbound", externalId: "h-1", at: "2026-11-02T10:02:00Z" },
      { body: "Wi-Fi şifresi?", direction: "inbound", externalId: "g-2", at: "2026-11-02T10:05:00Z" },
    ]);
    const dup = await conv(propertyId, rid, "res-B", [
      { body: "Merhaba", direction: "inbound", externalId: "g-1", at: "2026-11-02T10:00:00Z" },
      { body: "Merhaba", direction: "outbound", externalId: "h-1", at: "2026-11-02T10:02:00Z" },
    ]);

    const res = await cleanupDuplicateConversations(orgId);

    expect(res).toMatchObject({ removed: 1, needsReview: 0 });
    expect(await prisma.conversation.count({ where: { id: dup.id } })).toBe(0);
    expect(await prisma.message.count()).toBe(3);
  });
});
