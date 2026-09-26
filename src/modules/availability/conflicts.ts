import "server-only";

import { calendarDateOf, describeNights, nightsBetween, type NightKey } from "./core";
import { loadAvailabilityInputs } from "./load";

// ---------------------------------------------------------------------------
// YAKLAŞAN ÇAKIŞMALAR — müsaitlik motorunun ilk ürün tüketicisi (panel "Dikkat Gerektirenler").
//
// Bugün hiçbir yazma yolu (elle giriş, iCal senkronu, dosya içe aktarma, köprü) çakışan
// rezervasyonu reddetmiyor ya da fark etmiyor (09-24 araştırması, kodla doğrulandı). Takvim
// sayfası gece başına FARKLI MÜLK saydığı için iki rezervasyonun aynı geceye düşmesi görünmüyor.
// Burada yalnız TESPİT edilir: hiçbir satır iptal edilmez, birleştirilmez, gizlenmez (değişmez 6).
// `possibleDuplicate` = iki satırın giriş/çıkışı birebir aynı → aynı konaklama iki kaynaktan
// gelmiş OLABİLİR; bu bir İPUCUDUR, karar host'undur.
// ---------------------------------------------------------------------------

/** Kaç gece ileriye bakılır. */
export const CONFLICT_HORIZON_NIGHTS = 60;

export interface UpcomingConflict {
  propertyId: string;
  /** Yarı açık [from, to), mülk takvim günleri. */
  from: NightKey;
  to: NightKey;
  reservationIds: readonly string[];
  possibleDuplicate: boolean;
  /** En az bir iddia onay bekleyen talep (pending) — kesinleşmiş çift rezervasyon DEĞİL. */
  anyHeld: boolean;
  /** Hiçbir iddia taze kaynaktan ya da host girişinden gelmiyor — hayalet satır olabilir. */
  allUnconfirmed: boolean;
  /** Çakışan gece sayısı ([from, to)). */
  overlapNights: number;
  /**
   * Çakışmadaki EN UZUN konaklamanın gece sayısı (mülk takvim günleriyle, `calendarDateOf`). Para etkisinin
   * üst sınırı için (V2): çakışmayı çözmek o konaklamanın tamamını iptal ettirebilir.
   */
  longestStayNights: number;
}

export async function findUpcomingConflicts(
  organizationId: string,
  opts: { propertyIds?: readonly string[]; now: Date },
): Promise<UpcomingConflict[]> {
  const loaded = await loadAvailabilityInputs(organizationId, {
    propertyIds: opts.propertyIds,
    range: { nightsFromToday: CONFLICT_HORIZON_NIGHTS },
    now: opts.now,
  });
  if (!loaded) return [];
  const out: UpcomingConflict[] = [];
  for (const input of loaded.inputs.values()) {
    const report = describeNights(input, loaded.range);
    if (!report.ok) continue;
    const stayNights = new Map<string, number>();
    for (const r of input.reservations) {
      const n = nightsBetween(calendarDateOf(r.arrival, input.timeZone).key, calendarDateOf(r.departure, input.timeZone).key);
      if (n > 0) stayNights.set(r.id, n);
    }
    for (const c of report.value.conflicts) {
      const overlapNights = Math.max(1, nightsBetween(c.from, c.to));
      out.push({
        propertyId: input.propertyId,
        from: c.from,
        to: c.to,
        reservationIds: c.reservationIds,
        possibleDuplicate: c.facts.identicalSpan,
        anyHeld: c.facts.anyHeld,
        allUnconfirmed: c.facts.allUnconfirmed,
        overlapNights,
        longestStayNights: Math.max(overlapNights, ...c.reservationIds.map((id) => stayNights.get(id) ?? 0)),
      });
    }
  }
  return out;
}
