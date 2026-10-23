// ─────────────────────────────────────────────────────────────────────────────
// METİNDEKİ TELEFON VE E-POSTA MASKESİ (G7-a, kurucu kararı 10-13 "İkisi de"; DENETIM 08-09 #20)
//
// KVKK süpürgeleri (saklama süresi `anonymizeOldGuestData`, misafir silme `erasure.ts maskReservationRows`) gövdelerde ve görev
// notlarında yalnız misafirin ADINI maskeliyordu; gövdeye yazılmış telefon ("+90 555 123 45 67") ve e-posta KALIYORDU. Bu modül aynı
// süpürgelerde, ad maskesinden SONRA uygulanır: "[misafir] Hanım, numaram +90 555 123 45 67" → "[Misafir] Hanım, numaram [telefon]".
//
// Kapsam BİLİNÇLİ: yalnız silme / süpürme noktaları (yapay zekâ girdilerindeki ad maskesi — üslup profili, gölge model, kalite denetçisi
// — bu modülü KULLANMAZ; onların davranışı değişmez). Telefon kalıbı muhafazakârdır: ülke kodlu uluslararası numara ya da Türkiye
// biçimi (0 / 90 / 5xx ile 10 hane). Tarih ("12.10.2026 15:00"), saat, fiyat ("1.500 TL"), kapı kodu (4–6 hane) MASKELENMEZ.
//
// YAPRAK modül, sınırlı niceleyiciler (karesel iş yok; süre pini testte), idempotent (maskeler yeniden eşleşmez).
// ─────────────────────────────────────────────────────────────────────────────

export const PHONE_MASK = "[telefon]";
export const EMAIL_MASK = "[e-posta]";

const EMAIL = /(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]{1,64}@[\p{L}\p{N}-]{1,63}(?:\.[\p{L}\p{N}-]{1,63}){0,6}\.\p{L}{2,24}(?![\p{L}\p{N}-])/gu;

const SEP = "[\\s.\\-]?";
const PHONE = new RegExp(
  [
    // Türkiye: (+90 / 0090 / 90 / 0) + alan / GSM kodu (2xx–5xx) + 3 + 2 + 2 — ayraçlı ya da bitişik.
    `(?:(?:\\+|00)\\s?90${SEP}|(?<!\\d)90${SEP}|(?<!\\d)0${SEP})\\(?[2-5]\\d{2}\\)?${SEP}\\d{3}${SEP}\\d{2}${SEP}\\d{2}`,
    // Türkiye GSM önek SIZ ("555 123 45 67", "5551234567").
    `(?<!\\d)5\\d{2}${SEP}\\d{3}${SEP}\\d{2}${SEP}\\d{2}`,
    // Uluslararası: + ya da 00 + ülke kodu + 2–6 grup (toplam 8–15 rakam, aşağıda doğrulanır).
    `(?:\\+|(?<!\\d)00)\\s?[1-9]\\d{0,2}(?:[\\s.\\-]?\\(?\\d{1,4}\\)?){2,6}`,
  ].join("|"),
  "gu",
);

function digitCount(s: string): number {
  let n = 0;
  for (const ch of s) if (ch >= "0" && ch <= "9") n++;
  return n;
}

/** Metindeki e-posta adreslerini ve telefon numaralarını maskeler. Boş / maskesiz metin AYNEN döner. */
export function redactContactsFromText(text: string): string {
  if (!text) return text;
  let out = text.includes("@") ? text.replace(EMAIL, EMAIL_MASK) : text;
  out = out.replace(PHONE, (m, offset: number, whole: string) => {
    // Rakamın ortasından başlayan / biten eşleşme telefon değildir (daha uzun bir sayının parçası).
    const before = whole[offset - 1] ?? "";
    const after = whole[offset + m.length] ?? "";
    if (/\d/.test(before) || /\d/.test(after)) return m;
    const digits = digitCount(m);
    return digits >= 10 && digits <= 15 ? PHONE_MASK : m;
  });
  return out;
}
