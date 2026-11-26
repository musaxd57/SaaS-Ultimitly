// ---------------------------------------------------------------------------
// AD EŞLEŞME KALIBI — YAPRAK modül (hiçbir şey içe aktarmaz). Saklama süpürgesi (`data-retention.ts`) ve istem / anlam katmanı
// ad maskesi (`ai/guest-identity-mask.ts`) AYNI kuralı kullanır.
//
// Türkçe harf aileleri (09-28 inceleme ajanları, ölçüldü): JS'in /i bayrağı "ı"yı "I"ya, "İ"yi "i"ye katlamaz — "İsmail"in
// "ISMAIL"i, "Işıl"ın "IŞIL"ı silinmiyor, büyük harfle yazılan "AYŞE YILMAZ"da soyadı kalıyordu. Klavyesiz yazım ("Ayse Yilmaz")
// da aynı ad. Her harf ailesinin bütün biçimleri tek sınıf; sözcükler arasındaki boşluk esnek ("Mehmet  Ali" kaydı "Mehmet Ali"
// metnini tutar).
// ---------------------------------------------------------------------------

const TR_LETTER_FAMILY: Record<string, string> = {};
for (const family of ["iIıİ", "sSşŞ", "cCçÇ", "gGğĞ", "oOöÖ", "uUüÜ"]) {
  for (const ch of family) TR_LETTER_FAMILY[ch] = family;
}

export function nameSource(token: string): string {
  return token
    .split(/\s+/)
    .map((part) =>
      Array.from(part)
        .map((ch) => (TR_LETTER_FAMILY[ch] ? `[${TR_LETTER_FAMILY[ch]}]` : ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
        .join(""),
    )
    .join("\\s+");
}
