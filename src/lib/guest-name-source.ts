// ---------------------------------------------------------------------------
// MİSAFİR ADININ KÖKENİ (K10-o, migration 57, kurucu kararı 09-28).
//
// `Reservation.guestNameSource`: `guestName`in NEREDEN yazıldığı — kapalı küme. Köken etiketidir, "doğrulanmış / güvenilir
// talimat" DEĞİL: kanaldan gelen ad da misafirin yazdığı metindir (Codex notu 09-28). NULL = bu sürümden önce yazılmış, kaynağı
// gözlenmemiş satır; geriye dönük tahminle doldurulmaz.
//
// `Reservation.guestGivenName`: YALNIZ kanalın AYRI ad alanından (bugün Hospitable `guest.first_name`); eski `guestName` bölünerek
// doldurulmaz. Hiçbir yüzey bugün okumaz — hitap kuralı (adsız yapay zekâ + kodla selam) ayrı dilimde, anahtar arkasında gelir.
// YAPRAK modül: hiçbir şey içe aktarmaz.
// ---------------------------------------------------------------------------

export const GUEST_NAME_SOURCES = [
  "channel", // bağlı kanal (bugün Hospitable) — gerçek ad olarak gönderildi
  "calendar", // takvim bağlantısı (iCal) — çoğu zaman ad DEĞİL ("Reserved")
  "file", // ev sahibinin yüklediği .ics / .csv dosyası
  "host", // ev sahibi elle girdi
  "placeholder", // kanal ad vermedi; biz yer tutucu yazdık ("Rezervasyon <kod>" / "Misafir")
] as const;

export type GuestNameSource = (typeof GUEST_NAME_SOURCES)[number];

/** Kanaldan gelen hitap adının en fazla KOD NOKTASI sayısı (tam ad 200; hitap adı daha kısa). */
export const GUEST_GIVEN_NAME_MAX = 100;

/** Kanalın ayrı ad alanını saklanacak biçime getirir: kırpılır, boşsa `null`, tavan kod noktasıyla (vekil çifti bölünmez). */
export function givenNameForStorage(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const cps = Array.from(trimmed);
  return cps.length > GUEST_GIVEN_NAME_MAX ? cps.slice(0, GUEST_GIVEN_NAME_MAX).join("").trimEnd() : trimmed;
}
