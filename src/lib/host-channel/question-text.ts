import { redactContactsFromText } from "@/lib/contact-redact";
import { redactSensitive } from "@/lib/redact";
import type { HostQuestionMessage } from "./types";
import { asciiDigits } from "./digits";

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

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Misafirin adı alıntıdan silinir — tam ad değil, AD PARÇALARI tek tek, büyük / küçük harf ve Türkçe harf farkı gözetmeden, iyelik / hâl ekiyle
 * ("Ayşe'nin", "AYŞE", "ayşe") (Haiku 10-30 P2-1: yalnız birebir tam ad siliniyordu; "Merhaba ben Ayşe" WhatsApp'a gidiyordu). Doğrusal: parça
 * başına tek çapalı kalıp.
 */
export function withoutGuestNames(text: string, guestNames: readonly string[]): string {
  const parts = new Set<string>();
  for (const name of guestNames) {
    for (const p of name.normalize("NFKC").split(/[\s,.;:()"“”'’-]+/u)) {
      if ([...p].length >= 2 && /\p{L}/u.test(p)) {
        parts.add(p);
        parts.add(p.toLocaleLowerCase("tr"));
        parts.add(p.toLocaleUpperCase("tr"));
      }
    }
  }
  let t = text.normalize("NFKC");
  for (const p of parts) t = t.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(p)}(?:['’]\\p{L}{0,8})?(?![\\p{L}\\p{N}])`, "giu"), "…");
  return t;
}

/**
 * Misafirin sözünden kısa, maskeli alıntı: iletişim değerleri (her rakam yazısında — Arapça / tam genişlik rakamlı telefon da) + gizli değerler
 * maskelenir, ad parçaları silinir. Kısaltma kod noktası sınırında (vekil çift ortadan bölünmez — Haiku P3-2).
 */
export function maskedGuestQuote(guestText: string, guestNames: readonly string[] = []): string {
  // Görünmez karakterler maskelerden ÖNCE silinir: telefon / e-posta / ad içine konmuş yumuşak tire ya da sıfır genişlikli boşluk maskeyi
  // atlatıp sonra `templateSafe`le temizlenerek Meta'ya açık giderdi (sert inceleme 10-31 S-1).
  let t = redactSensitive(redactContactsFromText(asciiDigits(templateSafe(guestText))));
  t = templateSafe(withoutGuestNames(t, guestNames));
  const chars = [...t];
  if (chars.length <= QUOTE_MAX) return t;
  const cut = chars.slice(0, QUOTE_MAX - 1).join("");
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
