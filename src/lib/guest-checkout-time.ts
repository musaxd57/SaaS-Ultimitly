// ---------------------------------------------------------------------------
// MİSAFİRİN YAZDIĞI ÇIKIŞ SAATİ (saf; istemci de içe aktarabilir). Cevap modelinin çıkardığı saat rezervasyona
// yazılır (`Reservation.guestCheckoutTime`) ve bir BEYANDIR: "13:00'te çıkabilir miyiz?" gibi bir istek de bu alana
// düşebilir. Resmi çıkıştan SONRAKİ saat onaylanmamış bir geç çıkıştır — hiçbir yüzey onu esas saat gibi sunmaz
// (C-9, `docs/ERKEN-GIRIS-KANIT-MODELI-2026-09-24.md`). Erken giriş bu alanı yalnız sıkılaştırmak için okur (geç olan).
// ---------------------------------------------------------------------------

import { hhmmToMinutes, normalizeHhmm } from "@/lib/ai/semantic/stay-change";

/** Misafirin saati resmi çıkışa göre nerede? Resmi saat okunamıyorsa "unknown" (temkinli okunur: sonra olabilir). */
export type GuestCheckoutRelation = "earlier" | "same" | "later" | "unknown";

/** Misafir saati yoksa / okunamıyorsa `null`. */
export function guestCheckoutRelation(
  guest: string | null | undefined,
  official: string | null | undefined,
): GuestCheckoutRelation | null {
  const g = hhmmToMinutes(guest);
  if (g === null) return null;
  const o = hhmmToMinutes(official);
  if (o === null) return "unknown";
  return g < o ? "earlier" : g === o ? "same" : "later";
}

/** Resmi saatten sonra olabilecek (ya da karşılaştırılamayan) saat — onaylanmamış geç çıkış gibi okunur. */
export function guestCheckoutMayBeLate(relation: GuestCheckoutRelation | null): boolean {
  return relation === "later" || relation === "unknown";
}

export interface GuestCheckoutNote {
  text: string;
  /** Resmi saatten sonra (ya da karşılaştırılamıyor): uyarı tonunda gösterilir. */
  warn: boolean;
  hint: string | null;
}

/** Pano için ikincil etiket: resmi saat esas kalır; misafirin saati yalnız farklıysa not olarak yazılır. */
export function guestCheckoutNote(
  guest: string | null | undefined,
  official: string | null | undefined,
): GuestCheckoutNote | null {
  const relation = guestCheckoutRelation(guest, official);
  if (relation === null || relation === "same") return null;
  const text = `Misafir ${normalizeHhmm(guest)} dedi`;
  if (relation === "later") {
    return { text, warn: true, hint: "Resmi çıkış saatinden sonra. Geç çıkışı siz onaylamadıysanız resmi saat geçerlidir." };
  }
  if (relation === "unknown") return { text, warn: true, hint: "Geç çıkışı siz onaylamadıysanız resmi saat geçerlidir." };
  return { text, warn: false, hint: null };
}
