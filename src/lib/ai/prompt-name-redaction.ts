// ---------------------------------------------------------------------------
// CEVAP İSTEMİNDE MİSAFİR ADI → "[Misafir]" (K10-o "D", anahtar `AI_CODE_GREETING_ENABLED`; kurucu onayı 09-28).
//
// Anahtar açıkken cevap modeli adı hiç görmez: istemdeki sohbet geçmişi ve güncel mesaj adsız gider. Kapatılan yol (R1): kodun
// eklediği "Merhaba X," bizim giden mesajımızdır ve sonraki turda geçmişte OPERATÖR satırı olarak modele dönüyordu — "X" misafirin
// seçtiği metin olduğu için ("Otopark-Ücretsiz") sahte bir ev sahibi olgusu gibi okunabilirdi.
//
// 🚨 SİLME ANAHTARI KÖTÜYE KULLANILAMAZ (R2): ad misafirin metnidir ve burada bir SİLME ANAHTARI olur. Ad (ya da adın herhangi bir
// sözcüğü) bir güvenlik sözcüğü taşıyorsa ("Yangın Kaya", "Gas") o ad HİÇ silinmez — aksi hâlde misafirin "yangın var" mesajı modele
// "[Misafir] var" diye giderdi. Yer tutucu adlar ("Rezervasyon HM4K2", "Misafir") ve saklama sentinelleri de anahtar olmaz
// ("rezervasyon" / "eski" sözcükleri silinmesin). Bilinen sınır: yalnız soyad geçen metin silinmez (tüm yüzeylerle aynı kural).
// Kapı (güvenlik kontrolleri) HAM metni tarar — bu yalnız modele giden istem metnidir.
// ---------------------------------------------------------------------------

import { ANON_ID, ANON_NAME, redactNameFromBody } from "@/lib/data-retention";
import { guestFirstNameOf } from "@/lib/kb-placeholders";
import { isSafetyEmergencyText } from "./fallback";

/** Silme anahtarı olabilecek adlar: ≥3 karakter, sentinel / yer tutucu değil, güvenlik sözcüğü taşımıyor. */
export function promptRedactionNames(names: readonly (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const raw of names) {
    const n = typeof raw === "string" ? raw.trim() : "";
    if (n.length < 3 || n === ANON_NAME || n === ANON_ID) continue;
    if (guestFirstNameOf(n) === null) continue;
    if (isSafetyEmergencyText(n)) continue;
    out.add(n);
  }
  return [...out];
}

/** Metindeki misafir adını (tam ad + ilk sözcüğü, her ad için) "[Misafir]" yapar; anahtar yoksa metin aynen döner. */
export function redactGuestNamesForPrompt(text: string, names: readonly string[]): string {
  return names.length ? redactNameFromBody(text, [...names]) : text;
}
