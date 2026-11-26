import { addNights, type NightKey } from "@/modules/availability/core";
import type { AvailabilityQuery } from "@/lib/ai/verified-availability";

// ---------------------------------------------------------------------------
// QR MİSAFİR SOHBETİNDE DOĞRULANMIŞ MÜSAİTLİK / UZATMA (kurucu 10-09: "açalım ama bayrak olsun, bayrağı unutturma"; kurucu yokken
// verilen karar — `docs/KURUCU-YOKKEN-KARARLAR-2026-10-09.md` #3). Anahtar `AI_VERIFIED_QR_ENABLED` (tam "1", VARSAYILAN KAPALI) —
// kanal anahtarlarından (`AI_VERIFIED_AVAILABILITY_ENABLED` / `AI_VERIFIED_EXTENSION_ENABLED`) AYRI: QR'yi kullanan kişi o an dairede
// kalan misafirdir, müsaitlik sorusu çoğu zaman uzatma demektir.
//   · müsaitlik: yalnız mevcut konaklamaya DEĞMEYEN aralık (giriş gününden önce biten ya da çıkış gününden SONRA başlayan); çıkış gününe
//     bitişik aralık uzatmadır → uzatma kuralları, değmeyen değilse ev sahibine;
//   · uzatma: kanaldaki AYNI kurallar (Airbnb, onaylı, misafirin kendi isteği, bekçi + anlama katmanı).
// SAF.
// ---------------------------------------------------------------------------

export function verifiedQrEnabled(): boolean {
  return process.env.AI_VERIFIED_QR_ENABLED === "1";
}

/**
 * Aralık [from, to) mevcut konaklamaya [arrival, departure) DEĞİYOR ya da BİTİŞİK mi. Bitişik = çıkış gecesinden başlıyor (uzatma) ya da
 * giriş gününde bitiyor (erken geliş). İkisi de konaklama değişikliğidir → müsaitlik cevabı değil.
 */
export function rangeTouchesStay(q: AvailabilityQuery, stay: { arrival: NightKey; departure: NightKey }): boolean {
  return q.from <= stay.departure && q.to >= stay.arrival;
}

/** Bitişikliğin sınırı (test / belge için): çıkıştan sonraki ilk değmeyen gün. */
export function firstNonTouchingNight(stay: { departure: NightKey }): NightKey {
  return addNights(stay.departure, 1);
}
