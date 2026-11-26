// ---------------------------------------------------------------------------
// TAKVİM AY PARAMETRESİ — `?month=YYYY-MM` (G2 tur 4 T4-B13, 11-20). YAPRAK modül: hiçbir şey içe aktarmaz.
//
// Biçim doğrulaması tek başına yetmiyordu: `9999-12` geçiyor, sorgu penceresi ayın sonuna +2 gün eklenince 10000. yıla taşıyor, Prisma tarihi
// çeviremiyor, sayfa çizimi fırlıyordu → bütün yakalanmayan istek hatalarının PAYLAŞTIĞI uyarı kovası (`uncaught-request`) herhangi bir
// yöneticinin sayfa yenilemesiyle dolu tutulabiliyordu (11-14 A-1 sınıfı). Yıl ayrıca makul aralıkta olmalı; `Date.UTC` 0–99 yıllarını da
// 1900'e kaydırır. Aralık dışı / biçim dışı değer hata değildir: takvim varsayılan aya (işletmenin bugünkü ayı) düşer.
// ---------------------------------------------------------------------------

export const CALENDAR_MIN_YEAR = 1970;
export const CALENDAR_MAX_YEAR = 2999;

/** Geçerli `YYYY-MM` (yıl aralıkta) ise o, değilse `fallback`. */
export function parseCalendarMonthParam(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(raw);
  if (!m) return fallback;
  const year = Number(m[1]);
  return year >= CALENDAR_MIN_YEAR && year <= CALENDAR_MAX_YEAR ? raw : fallback;
}
