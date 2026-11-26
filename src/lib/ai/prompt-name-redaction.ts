// ---------------------------------------------------------------------------
// CEVAP İSTEMİNDE MİSAFİR ADI → "[Misafir]" (K10-o "D", anahtar `AI_CODE_GREETING_ENABLED`; kurucu onayı 09-28, kural 09-30).
//
// Anahtar açıkken cevap modeli adı REZERVASYON ALANINDAN görmez; istemdeki sohbet geçmişi ve güncel mesajda ad YALNIZ kimlik
// konumunda maskelenir (kurucu kararı 09-30, `guest-identity-mask.ts`): misafir metninde "adım Deniz" / "I'm Deniz" / imza, bizim
// giden metnimizde hitap ("Merhaba Deniz,", "Deniz Hanım"). Eski kural adın HER geçişini siliyordu — "Deniz manzarası", "15 Nisan"
// anlamını yitiriyordu. 🚨 TAM GİZLİLİK İDDİASI YOK: kimlik konumu dışında ad olarak geçen ad modele gider (bilinçli seçim).
// Kodun eklediği selam satırı sonraki turda geçmişe girmez (`withoutCodeGreetingLine`).
//
// ACİL SİNYAL AYRI TAŞINIR (R2, Codex önerisi 09-28): maske bir acil durum sözcüğünü de gizlediyse (`nameMaskHidesEmergency`;
// kimlik konumundaki "Ben Yangın, dairede duman var") istemin KODDAN yazılan kısmına not düşülür. Yer tutucu adlar ("Rezervasyon
// HM4K2") ve saklama sentinelleri anahtar olmaz. Kapı (güvenlik kontrolleri) HAM metni tarar — bu yalnız modele giden istem metnidir.
// ---------------------------------------------------------------------------

import { ANON_ID, ANON_NAME } from "@/lib/anon-sentinels";
import { nameSource } from "@/lib/name-source";
import { guestFirstNameOf } from "@/lib/kb-placeholders";
import { maskGuestIdentity, type TextAuthor } from "./guest-identity-mask";
import { isSafetyEmergencyText } from "./fallback";

/** Maske anahtarı olabilecek adlar: sentinel / yer tutucu değil, en az 2 karakter (kimlik konumunda kısa ad da maskelenir). */
export function promptRedactionNames(names: readonly (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const raw of names) {
    const n = typeof raw === "string" ? raw.trim() : "";
    if (n.length < 2 || n === ANON_NAME || n === ANON_ID) continue;
    if (guestFirstNameOf(n) === null) continue;
    out.add(n);
  }
  return [...out];
}

/**
 * Metindeki misafir adını YALNIZ kimlik konumlarında "[Misafir]" yapar (kurucu kararı 09-30, `guest-identity-mask.ts`): anlamlı
 * sözcük silinmez ("Deniz manzarası", "15 Nisan"). `author` metnin yazarı — misafir ya da biz (giden geçmiş satırı). Anahtar yoksa
 * metin aynen döner.
 */
export function redactGuestNamesForPrompt(text: string, names: readonly string[], author: TextAuthor = "guest"): string {
  return names.length ? maskGuestIdentity(text, names, author) : text;
}

/** Maskeyle AYNI eşleşme kuralı (Unicode sınırı, büyük-küçük harf duyarsız, Türkçe harf aileleri, esnek boşluk). */
const wordRe = (token: string, flags: string) => new RegExp(`(?<![\\p{L}\\p{N}])${nameSource(token)}(?![\\p{L}\\p{N}])`, flags);
const isKey = (t: string) => t.length >= 2 && t !== ANON_NAME && t !== ANON_ID;

/**
 * Ad maskesi bir ACİL DURUM sözcüğünü gizledi mi? (Codex önerisi 09-28.) Karar kelime ağıyla (`isSafetyEmergencyText`, kapının
 * kullandığı AYNI ağ) ve `redactNameFromBody`nin AYNI anahtarlarıyla verilir:
 *  1. Ham metinde acil sözcük yoksa gizlenecek bir şey yok.
 *  2. Çok sözcüklü TAM ad önce maskelenir — bu, adın ad olarak kullanımıdır ("Adım Yangın Kaya" → not YOK).
 *  3. Kalan metinde tek sözcüklük anahtarlar (tek sözcüklü ad + her adın ilk sözcüğü) da maskelenince acil ipucu kayboluyorsa → EVET.
 *  4. İpucu görünür kalsa da maskelenen tek sözcüklük anahtarın KENDİSİ acil sözcüğüyse ("Dairede yangın var, duman çıkıyor") → EVET.
 * Saf; ağ / veritabanı yok. Metin ve ad sayısı küçük (istem tavanları) — ad başına tek düzenli ifade, doğrusal.
 */
export function nameMaskHidesEmergency(text: string, names: readonly (string | null | undefined)[]): boolean {
  const keys = names.map((n) => (typeof n === "string" ? n.trim() : "")).filter(isKey);
  if (!text || keys.length === 0 || !isSafetyEmergencyText(text)) return false;
  let withoutFullNames = text;
  for (const full of [...new Set(keys.filter((k) => /\s/u.test(k)))].sort((a, b) => b.length - a.length)) {
    withoutFullNames = withoutFullNames.replace(wordRe(full, "giu"), "[Misafir]");
  }
  if (!isSafetyEmergencyText(withoutFullNames)) return false;
  const masked = maskGuestIdentity(withoutFullNames, keys, "guest");
  if (!isSafetyEmergencyText(masked)) return true;
  // İpucu görünür kalsa da maskelenen tek sözcüklük anahtarın KENDİSİ acil sözcüğüyse (kimlik konumunda "Ben Yangın, duman var").
  const singleWordKeys = new Set(keys.flatMap((k) => [k, k.split(/\s+/)[0] ?? ""]).filter((t) => isKey(t) && !/\s/u.test(t)));
  return [...singleWordKeys].some((t) => isSafetyEmergencyText(t) && wordRe(t, "iu").test(withoutFullNames) && !wordRe(t, "iu").test(masked));
}
