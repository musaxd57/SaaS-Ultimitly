import { describe, it, expect, beforeEach } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { stayDay } from "../helpers/stay-dates";
import { followReservationDates } from "@/lib/tasks/follow-reservation";
import { removeManualBookingCopy } from "@/lib/reservations/remove-manual-copy";

// ---------------------------------------------------------------------------
// G1 TUR 2 — E1 DÜZELTMESİNİN KİLİT SIRASI (koordinatörün sorusu: "çalıştırarak gerçek bir kilitlenme üretilebiliyor mu?").
//
// Kaldırma (`removeManualBookingCopy` → `deleteReservationsWithAutoTasks`): görev danışma kilidi (ad alanı 44, hedef satır) → koruma
// (`guard`) kardeş satırları kimlik sırasıyla `FOR UPDATE`.
// Senkron yazıcıları (`ingest/write-service.ts` `upsertCanonicalReservation`, `import/sync.ts`): ÖNCE satırı günceller (satır kilidi), tarih
// değiştiyse SONRA `followReservationDates` → aynı danışma kilidi. Sıra TERS.
// Senaryo: elle girilmiş kopya (CSV) Lale 1'de; aynı kaynak kimliği Lale 2'de etkin (çakışma). Lale 1'e eklenen takvim beslemesi aynı UID'i
// TAŞIYOR ve tarihi değişmiş → senkron Lale 1'deki satırı benimseyip tarihlerini yazar; tam o sırada ev sahibi karşılaştırma sayfasından o
// kopyayı kaldırır. Senkron işlemi aynı iki çağrıyla (satır güncellemesi + `followReservationDates`) kurulur; aradaki bekleme yalnız sırayı
// sabitler.
// ---------------------------------------------------------------------------

describe("(G1 11-19 T2-B6) kopya kaldırma ile senkron tarih yazımı aynı anda — kilitlenmede kaldırma yeniden denenir", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("🚨 senkron satırı günceller → kaldırma danışma kilidini alır ve satırı bekler → senkron danışma kilidini ister: PostgreSQL birini geri alır, KALDIRMA ASLA HATA DÖNMEZ (gerekirse yeniden dener)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const p2 = await prisma.property.create({ data: { organizationId: orgId, name: "Lale 2" } });
    const before = { arrivalDate: stayDay(3), departureDate: stayDay(5) };
    const after = { arrivalDate: stayDay(4), departureDate: stayDay(6) };
    const base = { guestName: "Ayşe", channel: "manual", status: "confirmed", sourceReference: "uid-1@ical" };
    const target = await prisma.reservation.create({ data: { ...base, ...before, propertyId } });
    await prisma.reservation.create({ data: { ...base, ...before, propertyId: p2.id, channel: "airbnb" } });

    let releaseSync!: () => void;
    const syncGate = new Promise<void>((r) => (releaseSync = r));
    let rowLocked!: () => void;
    const rowLockedP = new Promise<void>((r) => (rowLocked = r));

    // Senkron işlemi: satır güncellemesi (satır kilidi) → [bekle] → tarih izleme (danışma kilidi).
    const sync = prisma
      .$transaction(
        async (tx) => {
          await tx.reservation.update({ where: { id: target.id }, data: { ...after } });
          rowLocked();
          await syncGate;
          await followReservationDates(tx, target.id, before, after);
        },
        { timeout: 20_000 },
      )
      .then(
        () => "ok" as const,
        (e: unknown) => `error:${(e as { code?: string })?.code ?? ""}:${String((e as Error)?.message ?? e).slice(0, 160)}`,
      );
    await rowLockedP;

    // Kaldırma: danışma kilidini alır, korumada satırı bekler.
    const removal = removeManualBookingCopy({ organizationId: orgId, reservationId: target.id }).then(
      (r) => `ok:${r.kind}`,
      (e: unknown) => `error:${(e as { code?: string })?.code ?? ""}:${String((e as Error)?.message ?? e).slice(0, 160)}`,
    );
    // Kaldırmanın danışma kilidini alıp satır kilidinde beklemesini gör.
    for (let i = 0; i < 100; i++) {
      const waits = await prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*)::bigint AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query ILIKE '%FOR UPDATE OF r%'`;
      if (Number(waits[0]?.n ?? 0) > 0) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    releaseSync();
    const [syncResult, removalResult] = await Promise.all([sync, removal]);
    console.log("G1-T2-DEADLOCK", JSON.stringify({ syncResult, removalResult }));
    // Kayıt: biri kilitlenme hatasıyla düşer (PostgreSQL 40P01 / Prisma P2034).
    // Kurbanı PostgreSQL seçer: kaldırma kurban olursa yeniden dener ve sonuçlanır; senkron kurban olursa bir sonraki geçişte yeniden dener
    // (zamanlanmış iş). Sözleşme: kaldırma isteği kilitlenme yüzünden 500 DÖNMEZ.
    expect(removalResult.startsWith("ok:"), removalResult).toBe(true);
    expect(["ok", "error:P2010", "error:P2034"].some((p) => syncResult.startsWith(p)), syncResult).toBe(true);
  }, 30_000);
});
