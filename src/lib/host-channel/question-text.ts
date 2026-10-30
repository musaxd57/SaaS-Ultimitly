import { redactContactsFromText } from "@/lib/contact-redact";
import { redactSensitive } from "@/lib/redact";
import type { HostQuestionMessage } from "./types";

// ---------------------------------------------------------------------------
// Ev sahibine giden sorunun değerleri (tasarım §3.3). SAF.
// Misafirin adı, telefonu, e-postası, rezervasyon kodu ASLA gitmez: daire adı + tarih aralığı + misafirin sözünden KISA, MASKELİ alıntı.
// Şablon değişkeni kuralı (Meta): satır sonu / sekme yok, ardışık boşluk tek. Alıntı en çok 160 karakter, sözcük ortasında kesilmez.
// ---------------------------------------------------------------------------

export const QUOTE_MAX = 160;
const MONTHS_TR = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

/** Görünmez karakterler (sıfır genişlik, yön işaretleri, Braille boşluğu) silinir; satır sonu / sekme / boşluk dizisi tek boşluk olur. */
export function templateSafe(text: string): string {
  return text
    .replace(/[\p{Default_Ignorable_Code_Point}\p{Cf}⠀]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

/** Misafirin sözünden kısa, maskeli alıntı: iletişim değerleri + gizli değerler maskelenir, ad yazılmaz (alıntı yalnız mesaj gövdesi). */
export function maskedGuestQuote(guestText: string, guestNames: readonly string[] = []): string {
  let t = redactSensitive(redactContactsFromText(guestText));
  for (const name of guestNames) {
    const n = name.trim();
    if (n.length < 2) continue;
    t = t.split(n).join("…");
  }
  t = templateSafe(t);
  if (t.length <= QUOTE_MAX) return t;
  const cut = t.slice(0, QUOTE_MAX - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > QUOTE_MAX / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** "12–15 Kas" / "30 Eki–2 Kas" — konaklama aralığı (ay adı Türkçe, saat dilimi çağıranın verdiği güne göre). */
export function shortStayRange(arrival: { day: number; month: number }, departure: { day: number; month: number }): string {
  const a = `${arrival.day}`;
  const d = `${departure.day} ${MONTHS_TR[departure.month - 1] ?? ""}`.trim();
  return arrival.month === departure.month ? `${a}–${d}` : `${a} ${MONTHS_TR[arrival.month - 1] ?? ""}–${d}`;
}

export function buildHostQuestion(input: {
  propertyName: string;
  arrival: { day: number; month: number };
  departure: { day: number; month: number };
  guestText: string;
  guestNames?: readonly string[];
}): HostQuestionMessage {
  return {
    property: templateSafe(input.propertyName).slice(0, 60),
    dates: shortStayRange(input.arrival, input.departure),
    quote: maskedGuestQuote(input.guestText, input.guestNames ?? []),
  };
}
