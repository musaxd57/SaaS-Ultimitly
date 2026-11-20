import type { Prisma, PrismaClient } from "@prisma/client";
import { bookingRowSourceClass, type BookingRowSourceClass } from "@/lib/booking-row-source";
import { loadBookingComparison } from "@/lib/reservations/compare";

type Db = PrismaClient | Prisma.TransactionClient;

// ---------------------------------------------------------------------------
// REZERVASYON DETAY SAYFASININ VERİSİ (kurucu 11-20 öğlen B-2; tasarım `docs/TASARIM-2026-11-20-rezervasyon-detay-ekrani.md`). Tek satır +
// dairesi, salt okunur. Başka işletmenin kaydı ve olmayan kimlik → null (sayfa 404; varlık sızdırılmaz). Beklemede / İptal / Tamamlandı
// satırlar da açılır (kurucu). Kaynak sınıfı karşılaştırma sayfasıyla AYNI kural (`bookingRowSourceClass`). Kayıt iki dairede etkinse uyarının
// verisi karşılaştırmanın KENDİ yükleyicisinden gelir (`loadBookingComparison`) — ikinci bir "etkin kayıt" kuralı yazılmaz.
// Kanalın kaynak kimliği (`sourceReference`) yalnız sunucuda kalır (uyarı yüklemine girdi); sayfada gösterilmez (R-3).
// ---------------------------------------------------------------------------

export interface ReservationDetail {
  id: string;
  propertyId: string;
  propertyName: string;
  arrivalDate: Date;
  departureDate: Date;
  status: string;
  sourceClass: BookingRowSourceClass;
  calendarSourceLabel: string | null;
  channel: string;
  guestName: string;
  party: { adults: number | null; children: number | null; infants: number | null; pets: number | null };
  updatedAt: Date;
  /** Kayıt iki ya da daha çok dairede ETKİN görünüyorsa (tutma kuralıyla aynı yüklem); yoksa null. */
  conflict: { activePropertyNames: string[]; earliestActiveArrival: Date | null; sourceReference: string } | null;
}

export async function loadReservationDetail(
  db: Db,
  input: { organizationId: string; id: string; now: Date },
): Promise<ReservationDetail | null> {
  const r = await db.reservation.findFirst({
    where: { id: input.id, property: { organizationId: input.organizationId } },
    select: {
      id: true,
      propertyId: true,
      calendarSourceId: true,
      connectionId: true,
      channel: true,
      guestNameSource: true,
      arrivalDate: true,
      departureDate: true,
      guestName: true,
      status: true,
      updatedAt: true,
      sourceReference: true,
      guestAdults: true,
      guestChildren: true,
      guestInfants: true,
      guestPets: true,
      property: { select: { name: true } },
    },
  });
  if (!r) return null;
  const calendarSource = r.calendarSourceId
    ? await db.calendarSource.findFirst({
        where: { id: r.calendarSourceId, property: { organizationId: input.organizationId } },
        select: { label: true },
      })
    : null;
  const comparison = r.sourceReference ? await loadBookingComparison(db, { organizationId: input.organizationId, key: r.id, now: input.now }) : null;
  return {
    id: r.id,
    propertyId: r.propertyId,
    propertyName: r.property.name,
    arrivalDate: r.arrivalDate,
    departureDate: r.departureDate,
    status: r.status,
    sourceClass: bookingRowSourceClass(r),
    calendarSourceLabel: calendarSource?.label ?? null,
    channel: r.channel,
    guestName: r.guestName,
    party: { adults: r.guestAdults, children: r.guestChildren, infants: r.guestInfants, pets: r.guestPets },
    updatedAt: r.updatedAt,
    conflict:
      comparison && !comparison.resolved
        ? {
            activePropertyNames: comparison.activePropertyNames,
            earliestActiveArrival: comparison.earliestActiveArrival,
            sourceReference: comparison.sourceReference,
          }
        : null,
  };
}
