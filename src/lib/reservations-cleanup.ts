import "server-only";

import { prisma } from "@/lib/db";
import { getIngestAdapter } from "@/lib/channels";
import { getOrgHospitableToken } from "@/lib/hospitable-credentials";

// ---------------------------------------------------------------------------
// Ghost-reservation cleanup
//
// A channel reconnect can re-issue reservation IDs, leaving an old reservation
// row attached to the WRONG apartment in our DB (e.g. a checkout showing under
// "Serdar'ı Ekrem 2" when the guest is really in "serdarı ekrem 1"). The sync
// only upserts — it never deletes — so these ghosts linger on the dashboard.
//
// SAFE BY DESIGN:
//   * listReservations returns the COMPLETE set for a property or THROWS — it
//     never returns partial data (see fetchAllPages) — so a successful fetch is
//     authoritative truth.
//   * A property is pruned only when its fetch SUCCEEDED and returned at least
//     one reservation. An empty/failed fetch is treated as "couldn't verify" and
//     SKIPPED — a property is never wiped wholesale.
//   * Only Hospitable-sourced rows whose ARRIVAL is inside the same window the
//     sync queries are eligible (Hospitable would definitely have returned them
//     if they still existed). Genuine bookings — including a group's second flat
//     on the same dates — survive, because Hospitable still lists them.
// ---------------------------------------------------------------------------

export interface ReservationCleanupResult {
  removed: number; // ghost reservations deleted
  checkedProperties: number; // properties verified against Hospitable
  skippedProperties: number; // properties not verified (fetch failed/empty) — never pruned
  /**
   * KÖKENİ KANITLANAMAYAN, bu yüzden SİLİNMEYEN satır sayısı (Codex kararı,
   * 08-01). Bugün bir rezervasyonun hangi içe-aktarma yolundan geldiğini
   * kesin söyleyen bir kolon YOK: `calendarSourceId` iCal'i ayırır ama CSV ile
   * içe aktarılan satır da Hospitable satırı gibi NULL taşır ve `channel`
   * ("airbnb"/"booking") iki tarafta da AYNI değerleri alır. Kanıtsız silme,
   * host'un elle yüklediği rezervasyonu yok etmek demektir → FAIL-CLOSED:
   * silmiyoruz, SAYIYORUZ. Kalıcı çözüm `Reservation.ingestionOrigin` (nullable
   * migration) — `docs/MIGRATION-BEKLEYEN-ISLER.md`.
   */
  unprovableSkipped: number;
}

const DAY = 24 * 60 * 60 * 1000;

export async function cleanupStaleReservations(
  organizationId: string,
): Promise<ReservationCleanupResult> {
  const result: ReservationCleanupResult = {
    removed: 0,
    checkedProperties: 0,
    skippedProperties: 0,
    unprovableSkipped: 0,
  };

  // Multi-tenant: verify against THIS org's own Hospitable account. No
  // connection → nothing to verify against, so prune nothing (stay safe).
  const token = await getOrgHospitableToken(organizationId);
  if (!token) return result;

  // Mirror the sync's reservation window exactly so "would Hospitable have
  // returned it?" lines up with what the sync imports.
  const startDate = new Date(Date.now() - 60 * DAY).toISOString().slice(0, 10);
  const endDate = new Date(Date.now() + 540 * DAY).toISOString().slice(0, 10);
  const windowStart = new Date(`${startDate}T00:00:00.000Z`);
  const windowEnd = new Date(`${endDate}T23:59:59.999Z`);

  const properties = await prisma.property.findMany({
    where: { organizationId, hospitableId: { not: null } },
    select: { id: true, hospitableId: true },
  });

  for (const p of properties) {
    if (!p.hospitableId) continue;

    // V0.6: sağlayıcı okuması ingest adaptöründen (canonical); adaptör yoksa doğrulanamaz → atla.
    const adapter = getIngestAdapter("hospitable");
    if (!adapter) {
      result.skippedProperties++;
      continue;
    }
    let current;
    try {
      current = await adapter.listReservations(
        { provider: "hospitable", token },
        { propertyExternalId: p.hospitableId, startDate, endDate },
      );
    } catch {
      result.skippedProperties++; // couldn't verify → never prune
      continue;
    }

    // An empty result is treated as "couldn't verify" — never wipe a property.
    if (current.length === 0) {
      result.skippedProperties++;
      continue;
    }
    result.checkedProperties++;

    const seen = new Set(current.map((r) => r.externalId));

    // Hospitable-sourced rows arriving inside the window: Hospitable definitely
    // would have returned them if they still existed. Any not in `seen` are gone.
    //
    // 🚨 KAPSAM ŞART (denetim, 08-01 — beşinci tur, ajan bulgusu). Yukarıdaki
    // yorum "Hospitable kökenli" diyordu ama SORGU bunu HİÇ zorlamıyordu: filtre
    // yalnız `sourceReference != null` idi. iCal satırlarının `sourceReference`'ı
    // VEVENT UID'i, CSV'ninki dosyadaki referans — ikisi de Hospitable'ın id
    // uzayında DEĞİL, dolayısıyla `seen`'de asla bulunmazlar ve HEPSİ "hayalet"
    // sayılıp KALICI SİLİNİYORDU. Prod'da 8 canlı iCal kaynağı var (CLAUDE.md
    // 07-29). Kayıp yalnız rezervasyon satırı değil: `Task.reservationId` ve
    // `Conversation.reservationId` SetNull olduğu için bağlar kopar ve
    // `welcomeSentAt/checkinSentAt/checkoutSentAt` damgaları GİDER → feed yeniden
    // senkronlanınca AYNI misafire karşılama/giriş/çıkış mesajları TEKRAR gider.
    //
    // ⚠️ `channel` AYIRT EDİCİ DEĞİL: `channelFromLabel` (iCal) ve `toChannel`
    // (Hospitable) AYNI değerleri üretiyor ("airbnb"/"booking"/…). Tek güvenilir
    // ayraç `calendarSourceId`'dir — iCal satırları kaynağa bağlıdır.
    //
    // ⚠️ BİLİNEN SINIR: CSV ile içe aktarılan satırların da `calendarSourceId`'si
    // NULL'dur, yani onlar hâlâ bu kümede. Tam ayrım için satırın KÖKENİNİ tutan
    // bir kolon gerekir = MIGRATION → `docs/MIGRATION-BEKLEYEN-ISLER.md`.
    const locals = await prisma.reservation.findMany({
      where: {
        propertyId: p.id,
        sourceReference: { not: null },
        calendarSourceId: null,
        arrivalDate: { gte: windowStart, lte: windowEnd },
      },
      select: { id: true, sourceReference: true },
    });

    const stale = locals.filter((l) => l.sourceReference && !seen.has(l.sourceReference));

    // 🚨 FAIL-CLOSED (Codex kararı, 08-01). Bir satırı "hayalet" saymak ancak
    // KÖKENİNİN Hospitable olduğu KANITLANABİLİYORSA meşrudur. Bugün o kanıt
    // yalnız `hospitableId` üzerinden DOLAYLI: aynı mülke CSV ile elle yüklenmiş
    // bir rezervasyon da `calendarSourceId: null` + Hospitable'ın id uzayında
    // OLMAYAN bir `sourceReference` taşır — yani bu filtrede tam olarak
    // "hayalet" gibi görünür ve SİLİNİRDİ.
    //
    // Kanıt olarak kabul edilen TEK sinyal: satır bir Hospitable senkronunda
    // yaratılmış bir KONUŞMAYA bağlı (`Conversation.externalReservationId` =
    // aynı `sourceReference`). Hospitable içe aktarımı thread'i HER ZAMAN yazar
    // (`importThread`), CSV yolu HİÇBİR konuşma yaratmaz → ayrım kesin.
    // Kanıtlanamayan satır SİLİNMEZ, SAYILIR ve rapora çıkar.
    //
    // ⚠️ BİLİNEN SINIR (bilinçli, fail-closed yönü): hiç mesajlaşma olmamış bir
    // Hospitable rezervasyonunun thread'i hiç içe aktarılmamış olabilir → konuşma
    // yoktur → "kanıtlanamaz" sayılır ve TEMİZLENMEZ. Yani temizlik zayıflar,
    // ama YANLIŞ SİLME olmaz. Doğru yön bu: silinen bir rezervasyon geri gelmez,
    // temizlenmeyen bir hayalet yalnız listede durur. Kalıcı çözüm
    // `Reservation.ingestionOrigin` kolonu (nullable migration).
    const staleRefs = stale.map((l) => l.sourceReference as string);
    const provenRefs = staleRefs.length
      ? new Set(
          (
            await prisma.conversation.findMany({
              where: { propertyId: p.id, externalReservationId: { in: staleRefs } },
              select: { externalReservationId: true },
            })
          )
            .map((c) => c.externalReservationId)
            .filter((r): r is string => Boolean(r)),
        )
      : new Set<string>();

    const staleIds = stale.filter((l) => provenRefs.has(l.sourceReference as string)).map((l) => l.id);
    result.unprovableSkipped += stale.length - staleIds.length;

    if (staleIds.length > 0) {
      await prisma.reservation.deleteMany({ where: { id: { in: staleIds } } });
      result.removed += staleIds.length;
    }
  }

  return result;
}
