import type { Prisma, PrismaClient } from "@prisma/client";
import { activePropertyIdsOf, isActiveBookingRow } from "@/lib/booking-property-conflict";
import { bookingRowSourceClass, isRemovableBookingRowClass, type BookingRowSourceClass } from "@/lib/booking-row-source";

// ---------------------------------------------------------------------------
// "KAYITLARI KARŞILAŞTIR" SAYFASININ VERİSİ (UA-1, kurucu 11-19; tasarım `docs/TASARIM-2026-11-19-ua1-kayitlari-karsilastir.md` §2).
//
// Adres anahtarı bir rezervasyon SATIRININ kimliğidir (Dikkat satırının `rowKey`i — etkin satırların en küçük kimliği); kaynak kimliği
// adrese taşınmaz. Anahtar → o satırın kaynak kimliği → BU işletmedeki aynı kimlikli bütün satırlar (başka işletmenin aynı kimlikli
// satırı hiç okunmaz). Anahtar bu işletmede yoksa (başka işletmenin satırı, silinmiş satır) ya da kaynak kimliği taşımıyorsa `null`
// (sayfa 404 — varlık sızdırılmaz). Etkinlik kuralı tutma kuralıyla AYNI yüklem (`booking-property-conflict.ts`).
// ---------------------------------------------------------------------------

type Db = PrismaClient | Prisma.TransactionClient;

export interface ComparedBookingRow {
  id: string;
  propertyId: string;
  propertyName: string;
  sourceClass: BookingRowSourceClass;
  /** Yalnız `calendar`: beslemenin adı (kaynak silinmiş / başka işletmenin ise `null`). */
  calendarSourceLabel: string | null;
  arrivalDate: Date;
  departureDate: Date;
  guestName: string;
  status: string;
  updatedAt: Date;
  /** Etkin mi (iptal değil + konaklaması bitmemiş) — etkin olmayan satır çakışmayı oluşturmaz, eylemsiz gösterilir. */
  active: boolean;
  /** Karşılaştırma sayfasından kaldırılabilir mi: etkin VE elle / dosya sınıfı. */
  removable: boolean;
}

export interface BookingComparison {
  rows: ComparedBookingRow[];
  /** Etkin kaydı olan dairelerin adları, ada göre sıralı (Dikkat satırıyla aynı sıra). */
  activePropertyNames: string[];
  /** Etkin kayıtlar artık tek (ya da hiç) dairede: tutma kalktı. */
  resolved: boolean;
}

export async function loadBookingComparison(
  db: Db,
  input: { organizationId: string; key: string; now: Date },
): Promise<BookingComparison | null> {
  const anchor = await db.reservation.findFirst({
    where: { id: input.key, property: { organizationId: input.organizationId } },
    select: { sourceReference: true },
  });
  if (!anchor?.sourceReference) return null;
  const found = await db.reservation.findMany({
    where: { sourceReference: anchor.sourceReference, property: { organizationId: input.organizationId } },
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
      property: { select: { name: true } },
    },
  });
  const sourceIds = [...new Set(found.map((r) => r.calendarSourceId).filter((id): id is string => id !== null))];
  const sources =
    sourceIds.length === 0
      ? []
      : await db.calendarSource.findMany({
          where: { id: { in: sourceIds }, property: { organizationId: input.organizationId } },
          select: { id: true, label: true },
        });
  const labelOf = new Map(sources.map((s) => [s.id, s.label]));

  const rows: ComparedBookingRow[] = found.map((r) => {
    const sourceClass = bookingRowSourceClass(r);
    const active = isActiveBookingRow(r, input.now);
    return {
      id: r.id,
      propertyId: r.propertyId,
      propertyName: r.property.name,
      sourceClass,
      calendarSourceLabel: r.calendarSourceId ? (labelOf.get(r.calendarSourceId) ?? null) : null,
      arrivalDate: r.arrivalDate,
      departureDate: r.departureDate,
      guestName: r.guestName,
      status: r.status,
      updatedAt: r.updatedAt,
      active,
      removable: active && isRemovableBookingRowClass(sourceClass),
    };
  });
  // Etkin satırlar önce, sonra daire adı, sonra kimlik (kararlı).
  rows.sort(
    (a, b) =>
      Number(b.active) - Number(a.active) ||
      a.propertyName.localeCompare(b.propertyName, "tr") ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const activeIds = activePropertyIdsOf(found, input.now);
  const nameOf = new Map(found.map((r) => [r.propertyId, r.property.name]));
  const activePropertyNames = activeIds.map((id) => nameOf.get(id) ?? "").sort((a, b) => a.localeCompare(b, "tr"));
  return { rows, activePropertyNames, resolved: activeIds.length < 2 };
}
