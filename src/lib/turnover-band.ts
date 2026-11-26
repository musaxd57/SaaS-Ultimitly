import { onOrAfterToday } from "@/modules/availability/core";

// ---------------------------------------------------------------------------
// Konuşma sayfasındaki "Devir günü" bandının satırları — saf, YAPRAK (sayfa yalnız çizer).
// 🚨 Kullanıcı kararı: bant YALNIZ HÂLÂ YAPILACAK İŞ İÇİN gösterilir (geçmiş konaklamada söyleyecek bir şey yok).
// Tur 5 (11-05, ölçüldü): giriş tarafındaki devir, konaklama BAŞLADIKTAN sonra da gösteriliyordu ve iki uç da devirse yalnız giriş
// satırı basılıyordu → 1–7 Kasım konaklamasında 5 Kasım'da bant geçmişte kalmış "giriş günü önceki misafir çıkıyor" diyor, asıl
// yapılacak iş olan "çıkış günü yeni misafir giriyor" hiç görünmüyordu. Giriş satırı yalnız giriş günü henüz GEÇMEMİŞKEN; ikisi de
// geçerliyse İKİ satır. Metinler aynen (yeni sözcük yok).
// ---------------------------------------------------------------------------

export interface TurnoverBandInput {
  stayIsOver: boolean;
  arrivalDate: Date;
  previousSameDay: boolean;
  nextSameDay: boolean;
  now: Date;
  timeZone: string;
  checkInTime: string;
  checkOutTime: string;
  previousLateCheckout: string | null;
  nextEarlyCheckin: string | null;
}

/** Giriş tarafı devri hâlâ yapılacak iş mi (giriş günü bugün ya da ileride). */
export function turnoverInPending(i: Pick<TurnoverBandInput, "stayIsOver" | "arrivalDate" | "previousSameDay" | "now" | "timeZone">): boolean {
  return !i.stayIsOver && i.previousSameDay && onOrAfterToday(i.arrivalDate, i.now, i.timeZone);
}

/** Çıkış tarafı devri hâlâ yapılacak iş mi (konaklama bitmedi). */
export function turnoverOutPending(i: Pick<TurnoverBandInput, "stayIsOver" | "nextSameDay">): boolean {
  return !i.stayIsOver && i.nextSameDay;
}

/** Banda yazılacak satırlar (boş dizi = bant yok). Saate ek yazılmaz ("11:00'te" yanlıştı: "on bir'de"). */
export function turnoverBandLines(i: TurnoverBandInput): string[] {
  const lines: string[] = [];
  if (turnoverInPending(i)) {
    lines.push(
      i.previousLateCheckout
        ? `Devir günü: giriş günü önceki misafir çıkıyor (onaylı geç çıkış: ${i.previousLateCheckout}).`
        : `Devir günü: giriş günü önceki misafir çıkıyor (standart çıkış ${i.checkOutTime}).`,
    );
  }
  if (turnoverOutPending(i)) {
    lines.push(
      i.nextEarlyCheckin
        ? `Devir günü: çıkış günü yeni misafir giriyor (onaylı erken giriş: ${i.nextEarlyCheckin}).`
        : `Devir günü: çıkış günü yeni misafir giriyor (standart giriş ${i.checkInTime}).`,
    );
  }
  return lines;
}
