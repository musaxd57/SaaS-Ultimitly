import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma, resetDb, makeOrgWithProperty, makeUser } from "../helpers/db";
import { stayDay } from "../helpers/stay-dates";

// ---------------------------------------------------------------------------
// K22 (Codex 11-25, "en güçlü yeni bulgu"): misafir silmesi konaklamanın iç notlarını ve anlam okumalarını SİLER, ama konaklama / konuşma
// satırlarını maskeleyip TUTAR. Silmeyle yarışan (ya da silmeden sonra gelen) iç not isteği ve model okuması süren gölge kaydı, silinmiş
// konaklamaya misafir türevi veriyi GERİ yazıyordu. Kural (`erasure.ts` "GEÇ GELEN YAZIM SINIRI"): yazıcı, yazımı yaptığı işlemde konaklama
// satırını paylaşımlı kilitler ve maskeyi işlem içinde okur; silme aynı satırı işleminin başında özel kilitler.
// Yarış testleri GERÇEK eşzamanlılıkla kurulur: "silme sürüyor" = satırı özel kilitleyip maskeleyen açık işlem; yazıcının o kilidi
// BEKLEDİĞİ `pg_stat_activity`den görülür (sabit bekleme yok), sonra işlem commit edilir.
// ---------------------------------------------------------------------------

vi.mock("@/lib/report-error", () => ({ reportError: vi.fn().mockResolvedValue(undefined) }));

import { eraseReservationData } from "@/lib/erasure";
import { createInternalNote } from "@/lib/internal-notes/service";
import { recordSemanticReading } from "@/lib/semantic-reading/store";
import { sweepHostCommitmentShadow } from "@/lib/ai/semantic/host-commitment-shadow";
import { ANON_NAME } from "@/lib/data-retention";

const NOTE = "Misafir Ada telefonla aradı: 0532 000 00 00.";

async function world() {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const owner = await makeUser({ data: { organizationId: orgId, name: "Sahip", email: `s${Math.random()}@example.com`, passwordHash: "x", role: "owner" } });
  const stay = await prisma.reservation.create({
    data: { propertyId, guestName: "Ada Lale", guestEmail: "ada@example.com", sourceReference: "res-k22", arrivalDate: stayDay(-2), departureDate: stayDay(1), status: "confirmed", channel: "airbnb" },
  });
  const conv = await prisma.conversation.create({ data: { propertyId, reservationId: stay.id, channel: "airbnb", guestIdentifier: "Ada", status: "answered" } });
  const hostMsg = await prisma.message.create({
    data: { conversationId: conv.id, direction: "outbound", authorType: "host", senderName: "Ev sahibi", body: "Teknisyenimiz yarın 10'da gelecek." },
  });
  const note = (target: { reservationId?: string; conversationId?: string; propertyId?: string }) =>
    createInternalNote({ organizationId: orgId, viewer: { userId: owner.id, role: "owner" }, sessionName: "Sahip", target, body: NOTE });
  const reading = (conversationId = conv.id, messageId = hostMsg.id) =>
    recordSemanticReading(prisma, { organizationId: orgId, conversationId, messageId, layer: "host_commitment", outcome: "ok", modelDecision: "none" });
  return { orgId, propertyId, stay, conv, hostMsg, note, reading };
}

/** "Silme sürüyor": konaklama satırını özel kilitleyip maskeleyen AÇIK işlem. `commit()` bırakır. */
async function openErasureLikeTx(reservationId: string) {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let locked!: () => void;
  const ready = new Promise<void>((r) => (locked = r));
  const done = prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Reservation" WHERE "id" = ${reservationId} FOR UPDATE`);
      await tx.reservation.update({ where: { id: reservationId }, data: { guestName: ANON_NAME, guestEmail: null } });
      await tx.internalNote.deleteMany({ where: { reservationId } });
      locked();
      await gate;
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
  await ready;
  return { commit: async () => { release(); await done; } };
}

/** Bu veritabanında bir satır kilidini bekleyen sorgu var mı. */
async function someoneWaitsOnLock(): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ n: bigint }[]>(
    Prisma.sql`SELECT count(*)::bigint AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`,
  );
  return Number(rows[0].n) > 0;
}

/** Yazıcı ya bitti ya da kilidi bekliyor — hangisi önce olursa (eski kodda yazıcı beklemeden biter → test kırmızıya döner). */
async function settledOrWaiting<T>(p: Promise<T>): Promise<void> {
  let settled = false;
  void p.then(() => (settled = true), () => (settled = true));
  await vi.waitFor(async () => {
    if (!settled && !(await someoneWaitsOnLock())) throw new Error("henüz yok");
  }, { timeout: 10_000, interval: 20 });
}

describe("K22 — silinmiş konaklamaya misafir türevi veri GERİ yazılmaz", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });
  afterEach(() => vi.unstubAllEnvs());

  describe("iç not", () => {
    it("🚨 silme TAMAMLANDIKTAN sonra konaklamaya / konuşmaya yazılan not reddedilir (bulunamadı), satır yazılmaz", async () => {
      const w = await world();
      await eraseReservationData(w.orgId, w.stay.id);
      expect((await w.note({ reservationId: w.stay.id })).kind).toBe("not_found");
      expect((await w.note({ conversationId: w.conv.id })).kind).toBe("not_found");
      expect(await prisma.internalNote.count()).toBe(0);
      expect(await prisma.auditLog.count({ where: { action: "internal_note.create" } })).toBe(0);
    });

    it("🚨 YARIŞ: silme işlemi satırı tutarken gelen not kilidi BEKLER, silme commit olunca maskeyi görür ve yazmaz", async () => {
      const w = await world();
      const erasure = await openErasureLikeTx(w.stay.id);
      const pending = w.note({ reservationId: w.stay.id });
      await settledOrWaiting(pending);
      await erasure.commit();
      expect((await pending).kind).toBe("not_found");
      expect(await prisma.internalNote.count()).toBe(0);
    });

    it("KONTROL (aşırı uygulama yok): canlı konaklamaya, aynı dairenin başka konaklamasına ve daireye yazılan not yazılır", async () => {
      const w = await world();
      expect((await w.note({ reservationId: w.stay.id })).kind).toBe("created");
      const other = await prisma.reservation.create({
        data: { propertyId: w.propertyId, guestName: "Başka Misafir", arrivalDate: stayDay(3), departureDate: stayDay(5), status: "confirmed", channel: "airbnb" },
      });
      await eraseReservationData(w.orgId, w.stay.id);
      expect((await w.note({ reservationId: other.id })).kind).toBe("created");
      expect((await w.note({ propertyId: w.propertyId })).kind).toBe("created");
      // Silinen konaklamanın notu silmeyle gitti; ikisi kaldı.
      expect(await prisma.internalNote.count()).toBe(2);
    });

    it("KONTROL: yazıcı satırı ÖNCE kilitlerse silme onun commit'ini bekler ve yazılan notu kendi işleminde siler", async () => {
      const w = await world();
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let locked!: () => void;
      const ready = new Promise<void>((r) => (locked = r));
      const writer = prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Reservation" WHERE "id" = ${w.stay.id} FOR SHARE`);
        await tx.internalNote.create({ data: { organizationId: w.orgId, propertyId: w.propertyId, reservationId: w.stay.id, authorName: "Sahip", body: NOTE } });
        locked();
        await gate;
      }, { timeout: 30_000, maxWait: 10_000 });
      await ready;
      const erasing = eraseReservationData(w.orgId, w.stay.id);
      await settledOrWaiting(erasing);
      release();
      await writer;
      await erasing;
      expect(await prisma.internalNote.count()).toBe(0);
    });
  });

  describe("anlam okuması (gölge kaydı)", () => {
    it("🚨 silmeden SONRA gelen okuma sonucu yazılmaz (false)", async () => {
      const w = await world();
      await eraseReservationData(w.orgId, w.stay.id);
      expect(await w.reading()).toBe(false);
      expect(await prisma.semanticReading.count()).toBe(0);
    });

    it("🚨 YARIŞ: model okurken silme satırı tuttu → geç sonuç kilidi bekler, maskeyi görür, yazılmaz", async () => {
      const w = await world();
      const erasure = await openErasureLikeTx(w.stay.id);
      const pending = w.reading();
      await settledOrWaiting(pending);
      await erasure.commit();
      expect(await pending).toBe(false);
      expect(await prisma.semanticReading.count()).toBe(0);
    });

    it("KONTROL: canlı konaklamanın ve konaklamasız konuşmanın okuması yazılır", async () => {
      const w = await world();
      expect(await w.reading()).toBe(true);
      const loose = await prisma.conversation.create({ data: { propertyId: w.propertyId, channel: "airbnb", guestIdentifier: "Misafir", status: "new" } });
      const m = await prisma.message.create({ data: { conversationId: loose.id, direction: "outbound", authorType: "host", senderName: "Ev sahibi", body: "Merhaba." } });
      expect(await w.reading(loose.id, m.id)).toBe(true);
      expect(await prisma.semanticReading.count()).toBe(2);
    });

    it("🚨 aday sorgusu silinmiş konaklamanın mesajını SEÇMEZ (silme okumayı silince mesaj 'okunmamış' görünür — model yeniden çağrılmaz)", async () => {
      vi.stubEnv("AI_HOST_COMMITMENT_READER_ENABLED", "1");
      vi.stubEnv("OPENAI_API_KEY", "test-key");
      const w = await world();
      await eraseReservationData(w.orgId, w.stay.id);
      const reader = vi.fn(async () => ({ ok: false as const, error: "parse", model: "m", ms: 1 }));
      const res = await sweepHostCommitmentShadow(new Date(), { reader });
      expect(reader).not.toHaveBeenCalled();
      expect(res.read).toBe(0);
      // KONTROL: canlı konaklamanın mesajı aday olmaya devam eder.
      const live = await world();
      await sweepHostCommitmentShadow(new Date(), { reader });
      expect(reader).toHaveBeenCalledTimes(1);
      expect(await prisma.semanticReading.count({ where: { conversationId: live.conv.id } })).toBe(1);
    });
  });
});
