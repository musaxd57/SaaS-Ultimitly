import "server-only";

import { describeNights, type NightKey } from "./core";
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
  anyHeld: boolean;
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
    for (const c of report.value.conflicts) {
      out.push({
        propertyId: input.propertyId,
        from: c.from,
        to: c.to,
        reservationIds: c.reservationIds,
        possibleDuplicate: c.facts.identicalSpan,
        anyHeld: c.facts.anyHeld,
      });
    }
  }
  return out;
}
