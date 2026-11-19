import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isActiveBookingRow } from "@/lib/booking-property-conflict";
import { deleteReservationsWithAutoTasks } from "@/lib/automation";
import {
  bookingRowSourceClass,
  isRemovableBookingRowClass,
  REMOVABLE_BOOKING_ROW_WHERE,
  type BookingRowSourceClass,
} from "@/lib/booking-row-source";

// ---------------------------------------------------------------------------
// ELLE GİRİLEN KOPYAYI KALDIR (UA-1, kurucu 11-19; tasarım `docs/TASARIM-2026-11-19-ua1-kayitlari-karsilastir.md` §2 "Sunucu kuralı").
//
// "Kayıtları karşılaştır" sayfasının kaldırma isteği buradan geçer ve YALNIZ elle / dosya sınıfındaki satırı siler. Takvim / kanal satırı
// silinirse sonraki senkron onu geri getirir (iz yalnız KVKK silmesinde var) → 409. Silmenin kendisi var olan yol
// (`deleteReservationsWithAutoTasks`: rezervasyon kilidi + başlanmamış sistem görevleri); sınıf kuralı o işlemin İÇİNDE, satır kilitli
// yeniden uygulanır. Var olan genel silme ucunun (`DELETE /api/reservations/[id]`) davranışı DEĞİŞMEDİ.
// ---------------------------------------------------------------------------

/** 409 metni — tasarımdaki cümle AYNEN (kurucu onayı bekliyor, UA-a). */
export const MANUAL_COPY_SOURCE_BOUND_ERROR = "Bu kayıt kaynağından geliyor; silinirse geri gelir.";

/**
 * Son kopya (G1 11-19 E1): bu sayfa iki dairede görünen rezervasyonun YANLIŞ kopyasını kaldırmak içindir. Başka dairede etkin bir kayıt
 * kalmadıysa çakışma zaten çözülmüştür; kalan satırı silmek rezervasyonun kendisini (ve ona bağlı görevleri) silerdi. Metin kurucunun
 * (11-19 akşam, madde 4) AYNEN: "kaldırılamaz" yerine neden + ne yapılmadığı. Ekranda düğme bu durumda çizilmez; cümle eski bir ekrandan
 * gelen istekte görünür (ör. öteki yönetici öteki kopyayı az önce kaldırdı) — ekran ardından listeyi yeniler ve "Rezervasyonu aç" gösterir.
 */
export const MANUAL_COPY_LAST_ERROR = "Bu rezervasyon artık yalnızca bir dairede görünüyor. Son kaydı bu ekrandan kaldırmadık.";

export type RemoveManualCopyResult =
  | { kind: "removed"; propertyId: string; sourceClass: BookingRowSourceClass }
  | { kind: "not_found" }
  | { kind: "source_bound" }
  | { kind: "last_copy" };

type SiblingRow = { id: string; propertyId: string; status: string; departureDate: Date };

/** Saf: kaldırılacak satırdan BAŞKA bir dairede etkin kayıt var mı (çakışma sürüyor mu). */
function hasActiveCopyElsewhere(rows: readonly SiblingRow[], self: { id: string; propertyId: string }, now: Date): boolean {
  return rows.some((r) => r.id !== self.id && r.propertyId !== self.propertyId && isActiveBookingRow(r, now));
}

/** Test kancası: sınıf okunduktan SONRA, silme işleminden ÖNCE (yarış testi — arada satır kaynağa bağlanır). */
export const __manualCopyHooks: { afterClassRead: null | (() => Promise<void>) } = { afterClassRead: null };

type RemoveInput = {
  organizationId: string;
  reservationId: string;
  /** Etkinlik kuralının saati (testler sabitler). */
  now?: Date;
};

/** Veritabanı kilitlenmesi (PostgreSQL 40P01; Prisma işlem çakışması P2034): işlem bütünüyle geri alınmıştır, yeniden denemek güvenlidir. */
function isDeadlock(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown } | null;
  return e?.code === "P2034" || (typeof e?.message === "string" && /\b40P01\b|deadlock detected/i.test(e.message));
}

/** Kilitlenme olursa en çok bu kadar deneme (ilki dahil). */
const DEADLOCK_ATTEMPTS = 3;

/**
 * (G1 11-19 T2-B6) Senkron tarih yazımı rezervasyon SATIRINI kilitleyip sonra rezervasyon (görev) kilidini ister; silme yolu tersini yapar
 * (rezervasyon kilidi → satır) — sıra silmede çevrilemez, çünkü görev açma da önce rezervasyon kilidini alıp sonra görev ekleyerek satıra
 * anahtar kilidi koyar (çevirmek onunla yeni bir kilitlenme doğururdu). İkisi aynı anda koşarsa PostgreSQL birini geri alır: geri alınan
 * kaldırma isteği bütünüyle geri alınmıştır ve baştan (sınıf + son kopya kontrolü yeniden okunarak) denenir; senkron kurban seçilirse bir
 * sonraki geçişte yeniden dener. Başka hata aynen fırlatılır.
 */
export async function removeManualBookingCopy(input: RemoveInput): Promise<RemoveManualCopyResult> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await removeOnce(input);
    } catch (err) {
      if (!isDeadlock(err) || attempt >= DEADLOCK_ATTEMPTS) throw err;
    }
  }
}

async function removeOnce(input: RemoveInput): Promise<RemoveManualCopyResult> {
  const scope = { id: input.reservationId, property: { organizationId: input.organizationId } };
  const row = await prisma.reservation.findFirst({
    where: scope,
    select: { propertyId: true, sourceReference: true, calendarSourceId: true, connectionId: true, channel: true, guestNameSource: true },
  });
  if (!row) return { kind: "not_found" };
  const sourceClass = bookingRowSourceClass(row);
  if (!isRemovableBookingRowClass(sourceClass)) return { kind: "source_bound" };
  const ref = row.sourceReference;
  const self = { id: input.reservationId, propertyId: row.propertyId };
  // Hızlı yol (kilitsiz): çakışma yoksa işleme hiç girilmez. Asıl karar aşağıda, işlemin içinde kilitli okumayla.
  const siblings = ref
    ? await prisma.reservation.findMany({
        where: { sourceReference: ref, property: { organizationId: input.organizationId } },
        select: { id: true, propertyId: true, status: true, departureDate: true },
      })
    : [];
  if (!hasActiveCopyElsewhere(siblings, self, input.now ?? new Date())) return { kind: "last_copy" };
  if (__manualCopyHooks.afterClassRead) await __manualCopyHooks.afterClassRead();
  const deleted = await deleteReservationsWithAutoTasks([input.reservationId], input.organizationId, {
    onlyWhere: REMOVABLE_BOOKING_ROW_WHERE,
    // İki sekme iki elle kopyayı AYNI ANDA kaldırırsa ikisi de "öteki var" görüp rezervasyonu tümden silmesin: aynı rezervasyonun bütün
    // satırları kimlik sırasıyla kilitlenir (sıralı kilit → kilitlenme yok), karar kilitli okumayla verilir; ikinci işlem birincinin
    // silmesini görür.
    guard: async (tx) => {
      const locked = await tx.$queryRaw<SiblingRow[]>(Prisma.sql`
        SELECT r."id", r."propertyId", r."status", r."departureDate"
        FROM "Reservation" r JOIN "Property" p ON p."id" = r."propertyId"
        WHERE r."sourceReference" = ${ref} AND p."organizationId" = ${input.organizationId}
        ORDER BY r."id"
        FOR UPDATE OF r`);
      return hasActiveCopyElsewhere(locked, self, input.now ?? new Date());
    },
  });
  if (deleted === 1) return { kind: "removed", propertyId: row.propertyId, sourceClass };
  // Silinmediyse sebebi yeniden okunur: başka yoldan silindi (404) · arada kaynağa bağlandı (409) · kardeş kopya bu arada gitti (son kopya).
  const still = await prisma.reservation.findFirst({
    where: scope,
    select: { calendarSourceId: true, connectionId: true, channel: true, guestNameSource: true },
  });
  if (!still) return { kind: "not_found" };
  return isRemovableBookingRowClass(bookingRowSourceClass(still)) ? { kind: "last_copy" } : { kind: "source_bound" };
}
