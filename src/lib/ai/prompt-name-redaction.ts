// ---------------------------------------------------------------------------
// CEVAP İSTEMİNDE MİSAFİR ADI → "[Misafir]" (K10-o "D", anahtar `AI_CODE_GREETING_ENABLED`; kurucu onayı 09-28).
//
// Anahtar açıkken cevap modeli adı hiç görmez: istemdeki sohbet geçmişi ve güncel mesaj adsız gider. Kapatılan yol (R1): kodun
// eklediği "Merhaba X," bizim giden mesajımızdır ve sonraki turda geçmişte OPERATÖR satırı olarak modele dönüyordu — "X" misafirin
// seçtiği metin olduğu için ("Otopark-Ücretsiz") sahte bir ev sahibi olgusu gibi okunabilirdi.
//
// 🚨 AD HER ZAMAN MASKELENİR, ACİL SİNYAL AYRI TAŞINIR (R2, Codex önerisi 09-28, kurucu "mantıklıysa yap"): ad misafirin metnidir ve
// burada bir SİLME ANAHTARI olur — adı "Yangın Kaya" olan misafirin "Dairede yangın var" mesajı "[Misafir] var" olurdu. Eski çözüm
// (güvenlik sözcüğü taşıyan adı hiç silmemek) adı modele geri gönderiyordu ve "Merhaba Yangın Kaya"yı olay sandırabilirdi. Şimdi ad
// hep silinir; silme bir acil durum sözcüğünü de gizlediyse (`nameMaskHidesEmergency`) istemin KODDAN yazılan kısmına not düşülür.
// Tam adın kendisi ("Adım Yangın Kaya") ad kullanımıdır, not üretmez; tek sözcüklük eşleşme belirsizdir ("ben Yangın" de not üretir —
// güvenli taraf; kelime ağı ham metinde zaten acil sayar). Yer tutucu adlar ("Rezervasyon HM4K2") ve saklama sentinelleri anahtar
// olmaz ("rezervasyon" / "eski" sözcükleri silinmesin) — bu ayrı bir ad kalitesi kuralıdır, acil kuralına bağlı DEĞİL.
// Bilinen sınır: yalnız soyad geçen metin silinmez (tüm yüzeylerle aynı kural). Kapı (güvenlik kontrolleri) HAM metni tarar — bu
// yalnız modele giden istem metnidir.
// ---------------------------------------------------------------------------

import { ANON_ID, ANON_NAME, nameSource, redactNameFromBody } from "@/lib/data-retention";
import { guestFirstNameOf } from "@/lib/kb-placeholders";
import { isSafetyEmergencyText } from "./fallback";

/** Silme anahtarı olabilecek adlar: ≥3 karakter, sentinel / yer tutucu değil. */
export function promptRedactionNames(names: readonly (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const raw of names) {
    const n = typeof raw === "string" ? raw.trim() : "";
    if (n.length < 3 || n === ANON_NAME || n === ANON_ID) continue;
    if (guestFirstNameOf(n) === null) continue;
    out.add(n);
  }
  return [...out];
}

/** Metindeki misafir adını (tam ad + ilk sözcüğü, her ad için) "[Misafir]" yapar; anahtar yoksa metin aynen döner. */
export function redactGuestNamesForPrompt(text: string, names: readonly string[]): string {
  return names.length ? redactNameFromBody(text, [...names]) : text;
}

/** `redactNameFromBody` ile AYNI eşleşme kuralı (Unicode sınırı, büyük-küçük harf duyarsız, Türkçe harf aileleri, esnek boşluk). */
const wordRe = (token: string, flags: string) => new RegExp(`(?<![\\p{L}\\p{N}])${nameSource(token)}(?![\\p{L}\\p{N}])`, flags);
const isKey = (t: string) => t.length >= 3 && t !== ANON_NAME && t !== ANON_ID;

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
  if (!isSafetyEmergencyText(redactNameFromBody(withoutFullNames, keys))) return true;
  const singleWordKeys = new Set(keys.flatMap((k) => [k, k.split(/\s+/)[0] ?? ""]).filter((t) => isKey(t) && !/\s/u.test(t)));
  return [...singleWordKeys].some((t) => isSafetyEmergencyText(t) && wordRe(t, "iu").test(withoutFullNames));
}
