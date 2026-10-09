import { addNights, type NightKey } from "@/modules/availability/core";
import { resolveGuestDates, type DateResolutionContext } from "@/lib/ai/date-resolution";
import { mayStateAsFact, type VerifiedToolResult } from "@/lib/ai/tools/contract";
import type { AvailabilityToolValue } from "@/lib/ai/tools/availability-tool";

// ---------------------------------------------------------------------------
// DOĞRULANMIŞ MÜSAİTLİK CEVABI (kurucu onayı 10-09: "doğrulanınca otomatik gitsin"; talimat 09-07 "Availability replies must be
// derived from verified availability-tool output") — SAF, DB yok.
//
// 🚨 TASARIM (Haiku güvenlik incelemesi 10-09 sonrası): misafire giden metin MODELİN metni DEĞİL, KODDAN kurulan tek cümledir
// (doğrulanmış erken giriş onayı emsali). İlk sürüm model metnini ayrıştırıp doğruluyordu; inceleme beş P1 açık buldu: olumsuzlar
// yönü çeviriyordu ("dolu değil"), izin cümleleri ("bir gece daha konaklayabilirsiniz") geçiyordu, tarihsiz / aralık dışı iddialar
// ("hafta sonları da boş") ve çıkış gecesi doğrulanmış sayılıyordu. Kod metninde bunların hiçbiri olamaz: tarih, yön ve kapsam araç
// sonucundan; kapı muafiyeti YALNIZ bu metne birebir eşit cevaba.
//
// Akış (yalnız SAF müsaitlik sorusu — uzatma / erken giriş / geç çıkış / tarih değişikliği ev sahibinin kararı):
//   1. `availabilityQueryOf`: misafirin metninden tarih aralığı (tarih çözücü; yalnız `resolved`, 1 ya da 2 gün, geçmiş değil).
//   2. Çağıran aracı koşar; `verifiedAvailabilityUsable`: `ok`, kapsam, aralık birebir, en çok 2 dk, "dolu" ise BÜTÜN geceler dolu.
//   3. `verifiedAvailabilityText`: TR / EN tek cümle (başka dil → null → ev sahibine kalır).
// Anahtar `AI_VERIFIED_AVAILABILITY_ENABLED` (tam "1"; VARSAYILAN KAPALI) — açma = eval + kurucu.
// ---------------------------------------------------------------------------

export const VERIFIED_AVAILABILITY_FLAG = "AI_VERIFIED_AVAILABILITY_ENABLED";
export function verifiedAvailabilityEnabled(): boolean {
  return process.env[VERIFIED_AVAILABILITY_FLAG] === "1";
}

/** Araç sonucu bundan eskiyse kod metni kurulmaz (takvim bu arada değişmiş olabilir). */
export const VERIFIED_AVAILABILITY_MAX_AGE_MS = 2 * 60 * 1000;

export interface AvailabilityQuery {
  from: NightKey;
  /** Yarı açık: çıkış günü (son gece = to − 1). */
  to: NightKey;
}

export interface VerifiedAvailability {
  query: AvailabilityQuery;
  result: VerifiedToolResult<AvailabilityToolValue>;
}

/**
 * Misafirin sorduğu aralık: tek gün → o gece; iki gün → [ilk, son) (giriş – çıkış). Belirsiz / üç ve üstü gün / tarih yok / geçmiş
 * → null (tahmin yok; kapı eskisi gibi tutar).
 */
export function availabilityQueryOf(text: string | null | undefined, ctx: DateResolutionContext): AvailabilityQuery | null {
  const r = resolveGuestDates(text, ctx);
  if (r.status !== "resolved" || r.reasons.includes("past_date")) return null;
  if (r.dates.length === 1) return { from: r.dates[0], to: addNights(r.dates[0], 1) };
  if (r.dates.length === 2 && r.dates[0] < r.dates[1]) return { from: r.dates[0], to: r.dates[1] };
  return null;
}

/**
 * Sonuç misafire kod metniyle söylenebilir mi? `ok` + beklenen kapsam · sonucun aralığı sorulanla BİREBİR · en çok 2 dk · "dolu" ise
 * aralığın BÜTÜN geceleri dolu (kısmen doluysa hangi gecenin dolu olduğunu söylemek ayrı bir üründür → ev sahibine kalır).
 */
export function verifiedAvailabilityUsable(va: VerifiedAvailability, scope: { organizationId: string; propertyId: string }, now: Date): boolean {
  if (!mayStateAsFact(va.result, scope)) return false;
  const v = va.result.value;
  if (!v || v.from !== va.query.from || v.to !== va.query.to) return false;
  const age = now.getTime() - Date.parse(va.result.asOf);
  if (!(age >= 0 && age <= VERIFIED_AVAILABILITY_MAX_AGE_MS)) return false;
  if (v.verdict === "available") return v.freeNights === v.nights;
  if (v.verdict === "unavailable") return v.blockedNights === v.nights;
  return false;
}

const TR_MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const EN_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function dayLabel(k: NightKey, months: readonly string[], thisYear: string): string {
  const y = k.slice(0, 4);
  return `${Number(k.slice(8, 10))} ${months[Number(k.slice(5, 7)) - 1]}${y === thisYear ? "" : ` ${y}`}`;
}

export type VerifiedAvailabilityLang = "tr" | "en";
export function verifiedAvailabilityLang(lang: string | null | undefined): VerifiedAvailabilityLang | null {
  const l = (lang ?? "").toLowerCase().slice(0, 2);
  return l === "tr" || l === "en" ? l : null;
}

/**
 * Koddan kurulan cevap (misafirin dilinde; yalnız TR / EN). Tarih, yön ve gece sayısı araç sonucundan; izin / söz / fiyat YOK.
 * `today` yalnız yılın yazılıp yazılmayacağını seçer.
 */
export function verifiedAvailabilityText(va: VerifiedAvailability, lang: VerifiedAvailabilityLang, today: NightKey): string | null {
  const v = va.result.value;
  if (!v || (v.verdict !== "available" && v.verdict !== "unavailable")) return null;
  const year = today.slice(0, 4);
  const single = v.nights === 1;
  if (lang === "tr") {
    const span = single
      ? `${dayLabel(va.query.from, TR_MONTHS, year)} gecesi için`
      : `${dayLabel(va.query.from, TR_MONTHS, year)} giriş, ${dayLabel(va.query.to, TR_MONTHS, year)} çıkış için`;
    return v.verdict === "available" ? `${span} daire müsait.` : `Maalesef ${span} daire müsait değil.`;
  }
  const span = single
    ? `the night of ${dayLabel(va.query.from, EN_MONTHS, year)}`
    : `check-in on ${dayLabel(va.query.from, EN_MONTHS, year)} and check-out on ${dayLabel(va.query.to, EN_MONTHS, year)}`;
  return v.verdict === "available" ? `The apartment is available for ${span}.` : `Unfortunately, the apartment is not available for ${span}.`;
}
