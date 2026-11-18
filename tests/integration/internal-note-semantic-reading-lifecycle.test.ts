import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { subMonths } from "date-fns";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { anonymizeOldGuestData } from "@/lib/data-retention";
import { eraseReservationData } from "@/lib/erasure";
import { buildOrganizationDataExport } from "@/lib/data-export";
import { buildDemoDataset } from "@/lib/demo-tenant/dataset";
import { applyDemoTenant } from "@/lib/demo-tenant/apply-core";
import { DEMO_ORG_ID } from "@/lib/demo-tenant/constants";
import { stayDay } from "../helpers/stay-dates";

// ---------------------------------------------------------------------------
// MIGRATION 99 — İÇ NOT + ANLAM OKUMASI GÖLGE KAYDI: YAŞAM DÖNGÜSÜ (kurucu 11-18 akşam).
// İki yeni tablo misafir verisi gibi ele alınır (not: ekibin serbest metni misafir adı / numarası taşıyabilir; okuma: modelin kısa nedeni
// mesajı yeniden anlatabilir). Bu dosya dört yolu DAVRANIŞLA sabitler: saklama süresi · misafir silme talebi · dışa aktarma · zincirleme
// silme / demo sıfırlama. Envanter pinleri (kaynak taraması) ayrı: `scrub-scope-parity`, `data-export-coverage`, `demo-reset-coverage`.
// ---------------------------------------------------------------------------

vi.mock("@/lib/report-error", () => ({ reportError: vi.fn().mockResolvedValue(undefined) }));

const OLD = () => ({ arrivalDate: subMonths(new Date(), 26), departureDate: subMonths(new Date(), 25) });
const AGED = () => subMonths(new Date(), 25);

async function world() {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const stay = (over: Record<string, unknown> = {}) =>
    prisma.reservation.create({
      data: { propertyId, guestName: "Ada Lale", arrivalDate: stayDay(1), departureDate: stayDay(3), status: "confirmed", channel: "airbnb", ...over },
    });
  const conv = (reservationId: string | null) =>
    prisma.conversation.create({ data: { propertyId, reservationId, channel: "airbnb", guestIdentifier: "Ada", status: "new" } });
  const note = (over: Record<string, unknown> = {}) =>
    prisma.internalNote.create({ data: { organizationId: orgId, propertyId, authorName: "Sahip", body: "Misafir Ada telefonla aradı: 0532 000 00 00.", ...over } });
  const reading = (conversationId: string, messageId: string, over: Record<string, unknown> = {}) =>
    prisma.semanticReading.create({
      data: {
        organizationId: orgId,
        conversationId,
        messageId,
        layer: "host_commitment",
        outcome: "ok",
        lexicalDecision: "auto",
        modelDecision: "none",
        agreement: "model_holds",
        detailJson: JSON.stringify([{ reading: "guest_words", why: "Ev sahibi misafirin cümlesini aktarıyor." }]),
        ...over,
      },
    });
  return { orgId, propertyId, stay, conv, note, reading };
}

describe("migration 99 — iç not + anlam okuması gölge kaydı: yaşam döngüsü", () => {
  beforeEach(async () => {
    await resetDb();
    vi.unstubAllEnvs();
  });
  afterEach(() => vi.unstubAllEnvs());

  describe("saklama süresi (DATA_RETENTION_MONTHS)", () => {
    it("KONTROL: süre kapalıyken (varsayılan) hiçbir not / okuma silinmez", async () => {
      const w = await world();
      const old = await w.stay(OLD());
      const c = await w.conv(old.id);
      await w.note({ reservationId: old.id });
      await w.note({ createdAt: AGED() });
      await w.reading(c.id, "m-1", { createdAt: AGED() });
      await anonymizeOldGuestData();
      expect(await prisma.internalNote.count()).toBe(2);
      expect(await prisma.semanticReading.count()).toBe(1);
    });

    it("🚨 süresi dolmuş konaklamanın notu ve konuşmalarının okuması SİLİNİR; güncel konaklamanınki kalır", async () => {
      vi.stubEnv("DATA_RETENTION_MONTHS", "24");
      const w = await world();
      const old = await w.stay(OLD());
      const oldConv = await w.conv(old.id);
      const live = await w.stay();
      const liveConv = await w.conv(live.id);
      await w.note({ reservationId: old.id, conversationId: oldConv.id });
      // Not konaklama bittikten ÇOK sonra (geçen hafta) yazılmış olsa da konaklamanın süresi doldu → gider.
      await w.note({ reservationId: old.id, body: "Geç yazılan not" });
      const keptNote = await w.note({ reservationId: live.id, conversationId: liveConv.id });
      // Okuma YENİ yazılmış (yaşı sınırın altında) ama konaklamanın süresi dolmuş → gider.
      await w.reading(oldConv.id, "m-old");
      const keptReading = await w.reading(liveConv.id, "m-live");

      await anonymizeOldGuestData();
      expect((await prisma.internalNote.findMany()).map((n) => n.id)).toEqual([keptNote.id]);
      expect((await prisma.semanticReading.findMany()).map((r) => r.id)).toEqual([keptReading.id]);
    });

    it("🚨 konaklamasız (daireye yazılmış) not KENDİ yaşıyla silinir; sınırdan yeni olan kalır", async () => {
      vi.stubEnv("DATA_RETENTION_MONTHS", "24");
      const w = await world();
      await w.note({ createdAt: AGED() });
      const fresh = await w.note({ createdAt: subMonths(new Date(), 23) });
      await anonymizeOldGuestData();
      expect((await prisma.internalNote.findMany()).map((n) => n.id)).toEqual([fresh.id]);
    });

    it("🚨 konaklamaya bağlı olmayan konuşmanın ESKİ okuması yaşıyla silinir; yenisi kalır", async () => {
      vi.stubEnv("DATA_RETENTION_MONTHS", "24");
      const w = await world();
      const c = await w.conv(null);
      await w.reading(c.id, "m-eski", { createdAt: AGED() });
      const fresh = await w.reading(c.id, "m-yeni");
      await anonymizeOldGuestData();
      expect((await prisma.semanticReading.findMany()).map((r) => r.id)).toEqual([fresh.id]);
    });

    it("🚨 konaklama ZATEN süpürülmüşken sonradan yazılan not / okuma bir sonraki geçişte gider (kendiliğinden sonlanır: üçüncü geçiş iş bulmaz)", async () => {
      vi.stubEnv("DATA_RETENTION_MONTHS", "24");
      const w = await world();
      const old = await w.stay(OLD());
      const c = await w.conv(old.id);
      expect((await anonymizeOldGuestData()).anonymized).toBe(1);
      await w.note({ reservationId: old.id });
      await w.reading(c.id, "m-sonradan");
      // Konaklama bir daha "anonimleştirildi" sayılmaz (zaten temiz) ama iki tablo yine temizlenir.
      expect((await anonymizeOldGuestData()).anonymized).toBe(0);
      expect(await prisma.internalNote.count()).toBe(0);
      expect(await prisma.semanticReading.count()).toBe(0);
      expect((await anonymizeOldGuestData()).anonymized).toBe(0);
    });
  });

  describe("misafir silme talebi", () => {
    it("🚨 konaklamanın notları, konuşmasından yazılan notlar ve konuşmanın okumaları SİLİNİR; başka konaklamanınki ve daireye yazılan not kalır", async () => {
      const w = await world();
      const target = await w.stay();
      const targetConv = await w.conv(target.id);
      const other = await w.stay({ guestName: "Başka Misafir" });
      const otherConv = await w.conv(other.id);
      await w.note({ reservationId: target.id });
      // Konuşma sayfasından yazılmış ama konaklamaya bağlanmamış not (yalnız bağlam kimliği).
      await w.note({ conversationId: targetConv.id, body: "Bağlamdan yazılan not" });
      const otherNote = await w.note({ reservationId: other.id, conversationId: otherConv.id });
      const propertyNote = await w.note({ body: "Kombi servisi yılda bir gelir." });
      await w.reading(targetConv.id, "m-1");
      const otherReading = await w.reading(otherConv.id, "m-2");

      await eraseReservationData(w.orgId, target.id);
      expect((await prisma.internalNote.findMany({ orderBy: { createdAt: "asc" } })).map((n) => n.id).sort()).toEqual([otherNote.id, propertyNote.id].sort());
      expect((await prisma.semanticReading.findMany()).map((r) => r.id)).toEqual([otherReading.id]);
    });

    it("🚨 kiracı sınırı: başka işletmenin notu / okuması silme talebinden etkilenmez", async () => {
      const w = await world();
      const target = await w.stay();
      await w.conv(target.id);
      const n = await world();
      const nStay = await n.stay();
      const nConv = await n.conv(nStay.id);
      await n.note({ reservationId: nStay.id, conversationId: nConv.id });
      await n.reading(nConv.id, "m-komsu");
      await eraseReservationData(w.orgId, target.id);
      expect(await prisma.internalNote.count({ where: { organizationId: n.orgId } })).toBe(1);
      expect(await prisma.semanticReading.count({ where: { organizationId: n.orgId } })).toBe(1);
    });
  });

  describe("dışa aktarma", () => {
    it("iç notlar dökümde (metin + yazan adı + bağlar); anlam okuması dökümde YOK; başka işletmenin notu sızmaz", async () => {
      const w = await world();
      const s = await w.stay();
      const c = await w.conv(s.id);
      const note = await w.note({ reservationId: s.id, conversationId: c.id });
      await w.reading(c.id, "m-1");
      const n = await world();
      await n.note({ body: "Komşu işletmenin notu" });

      const dump = await buildOrganizationDataExport(w.orgId);
      expect(dump?.internalNotes).toEqual([
        { id: note.id, propertyId: w.propertyId, reservationId: s.id, conversationId: c.id, authorName: "Sahip", body: note.body, createdAt: note.createdAt },
      ]);
      const text = JSON.stringify(dump);
      expect(text).not.toContain("Komşu işletmenin notu");
      expect(text).not.toContain("Ev sahibi misafirin cümlesini aktarıyor."); // gölge kaydın nedeni dökümde değil
    });
  });

  describe("zincirleme silme ve tekillik", () => {
    it("konaklama silinince notu gider; konuşma silinince notun bağlamı BOŞALIR (not kalır), okuması gider; daire silinince hepsi gider", async () => {
      const w = await world();
      const s = await w.stay();
      const c = await w.conv(s.id);
      const propertyNote = await w.note({ conversationId: c.id, body: "Konuşmadan yazılan daire notu" });
      await w.note({ reservationId: s.id });
      await w.reading(c.id, "m-1");

      await prisma.conversation.delete({ where: { id: c.id } });
      expect(await prisma.semanticReading.count()).toBe(0);
      expect((await prisma.internalNote.findUniqueOrThrow({ where: { id: propertyNote.id } })).conversationId).toBeNull();
      expect(await prisma.internalNote.count()).toBe(2);

      await prisma.reservation.delete({ where: { id: s.id } });
      expect((await prisma.internalNote.findMany()).map((n) => n.id)).toEqual([propertyNote.id]);

      await prisma.property.delete({ where: { id: w.propertyId } });
      expect(await prisma.internalNote.count()).toBe(0);
    });

    it("yazan kişi silinince not kalır, adı kopyadan okunur", async () => {
      const w = await world();
      const user = await prisma.user.create({ data: { organizationId: w.orgId, name: "Zeynep", email: "zeynep@example.test", passwordHash: "x", role: "manager" } });
      const n = await w.note({ authorUserId: user.id, authorName: "Zeynep" });
      await prisma.user.delete({ where: { id: user.id } });
      expect(await prisma.internalNote.findUniqueOrThrow({ where: { id: n.id } })).toMatchObject({ authorUserId: null, authorName: "Zeynep" });
    });

    it("🚨 istek kimliği işletme kapsamında tekil (çift tıklama ikinci not yazamaz); kimliksiz notlar ve başka işletme çakışmaz", async () => {
      const w = await world();
      await w.note({ clientRequestId: "req-1" });
      await expect(w.note({ clientRequestId: "req-1" })).rejects.toMatchObject({ code: "P2002" });
      await w.note();
      await w.note();
      const n = await world();
      await n.note({ clientRequestId: "req-1" });
      expect(await prisma.internalNote.count()).toBe(4);
    });

    it("🚨 mesaj + katman başına TEK okuma (yeniden deneme ikinci satır yazamaz); başka katman ayrı satırdır", async () => {
      const w = await world();
      const c = await w.conv(null);
      await w.reading(c.id, "m-1");
      await expect(w.reading(c.id, "m-1")).rejects.toMatchObject({ code: "P2002" });
      await w.reading(c.id, "m-1", { layer: "reply_items" });
      expect(await prisma.semanticReading.count()).toBe(2);
    });
  });

  describe("demo sıfırlama", () => {
    it("🚨 inceleme sırasında DAİREYE yazılan (konaklamasız) not sıfırlamada silinir — daire silinmediği için zincirleme gitmezdi", async () => {
      const ds = buildDemoDataset({ now: new Date() });
      await applyDemoTenant(prisma, ds, { reviewerPasswordHash: "x", staffPasswordHash: "y" });
      const prop = await prisma.property.findFirstOrThrow({ where: { organizationId: DEMO_ORG_ID } });
      await prisma.internalNote.create({ data: { organizationId: DEMO_ORG_ID, propertyId: prop.id, authorName: "İnceleyici", body: "Deneme notu" } });
      await applyDemoTenant(prisma, ds, { reviewerPasswordHash: null, staffPasswordHash: "y" });
      expect(await prisma.property.count({ where: { id: prop.id } })).toBe(1);
      expect(await prisma.internalNote.count({ where: { organizationId: DEMO_ORG_ID } })).toBe(0);
    });
  });
});
