import type { NightEvidence, NightKey } from "./core";

// ---------------------------------------------------------------------------
// YETİM BOŞLUK — iki kesin rezervasyon arasında kalan kısa boş geceler (kurucu talimatı 09-07, V2 Exception Feed örneği:
// "2-night gap detected · 11 days from now · Estimated opportunity"). SAF: DB yok, ağ yok, LLM yok, `server-only` yok.
//
// Yalnız TESPİT: hiçbir fiyat / minimum konaklama kuralı değiştirilmez (kanala yazma yeteneği yok — değişmez 5 / 18).
// TAHMİN YOK (değişmez 6 / 15): boşluk yalnız motorun gece durumlarından okunur —
//  · boşluk geceleri `free` (hiçbir iddia yok VE kapsama kaynakları taze), uzunluğu 1..`ORPHAN_GAP_MAX_NIGHTS`;
//  · HEMEN önceki ve HEMEN sonraki gece `booked` (kesinleşmiş konaklama). `held` (onay bekleyen talep) komşu SAYILMAZ:
//    talep reddedilirse boşluk yetim değildir. `unknown` (bayat / hatalı / hiç senkronlanmamış kaynak) komşu ya da boşluk
//    içi gece varsa iddia ÜRETİLMEZ — bilmediğimiz geceyi "boş" saymak yanlış fırsat gösterir;
//  · aralığın ilk / son gecesindeki boşluk komşusu görülmediği için sayılmaz.
// `confirmed`: iki komşu gecenin bütün iddiaları taze kaynaktan ya da ev sahibinin kendi girişinden — değilse komşulardan
// biri hayalet satır olabilir (arayüz "doğrulayın" der).
// ---------------------------------------------------------------------------

/** En fazla bu kadar gecelik boşluk "yetim" sayılır (daha uzunu sıradan boşluktur, satılabilir). */
export const ORPHAN_GAP_MAX_NIGHTS = 2;

export interface OrphanGap {
  /** Yarı açık [from, to): `from` ilk boş gece, `to` sonraki konaklamanın ilk gecesi (mülk takvim günleri). */
  from: NightKey;
  to: NightKey;
  nights: number;
  /** Komşu iki gecenin iddiaları taze kaynaktan / ev sahibi girişinden mi. */
  confirmed: boolean;
}

function bookedConfirmed(n: NightEvidence): boolean {
  return n.claims.length > 0 && n.claims.every((c) => c.basis !== "unconfirmed");
}

/**
 * Motorun gece kanıtından yetim boşluklar. `nights` sıralı ve kesintisiz olmalı (motorun `describeNights` çıktısı).
 * `fromNight`: bundan önce başlayan boşluk sayılmaz (geçmiş / bu gece hesabı çağıranın).
 */
export function findOrphanGaps(
  nights: readonly NightEvidence[],
  opts: { fromNight: NightKey; maxNights?: number },
): OrphanGap[] {
  const max = opts.maxNights ?? ORPHAN_GAP_MAX_NIGHTS;
  const out: OrphanGap[] = [];
  let i = 1;
  while (i < nights.length) {
    if (nights[i].state !== "free" || nights[i - 1].state !== "booked") {
      i++;
      continue;
    }
    let j = i;
    while (j < nights.length && nights[j].state === "free") j++;
    const len = j - i;
    if (j < nights.length && nights[j].state === "booked" && len <= max && nights[i].night >= opts.fromNight) {
      out.push({
        from: nights[i].night,
        to: nights[j].night,
        nights: len,
        confirmed: bookedConfirmed(nights[i - 1]) && bookedConfirmed(nights[j]),
      });
    }
    i = j;
  }
  return out;
}
