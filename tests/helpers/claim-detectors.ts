// ---------------------------------------------------------------------------
// ÖLÇÜM DEDEKTÖRLERİ — YALNIZ TEST/EVAL İÇİN. ÜRÜN KODU DEĞİL.
//
// 🚨 BİLEREK `tests/` ALTINDA: bunları `src/` içine koymak, gönderim kararına
// yeni bir veto eklemenin ilk adımı olurdu — ve o bir GÜVENLİK POLİTİKASI
// değişikliğidir (plan belgesinde P5, ayrı onayda). Burada amaç davranışı
// DEĞİŞTİRMEK değil, bugünkü davranışı GÖRÜNÜR kılmak.
//
// P5 onaylanırsa bu fonksiyonlar ürün koduna taşınır ve gerçek bir kapı olur.
// ---------------------------------------------------------------------------

/**
 * MAKBUZSUZ EYLEM/TAAHHÜT İDDİASI.
 *
 * CLAUDE.md kuralı: "`actionReceipt` olmadan 'ilettim/oluşturdum/kontrol ettim'
 * yok." Bugün `actionReceipt` HİÇ uygulanmamış, yani bu kalıpların TAMAMI
 * makbuzsuzdur — dedektör bu yüzden makbuz parametresi almıyor: alsaydı,
 * olmayan bir mekanizmayı varmış gibi gösterirdi.
 *
 * İki sınıf:
 *  · GEÇMİŞ EYLEM  — "ilettim", "oluşturdum", "kontrol ettim" (olmuş gibi anlatır)
 *  · GELECEK TAAHHÜT — "döneceğim", "iletecek", "paylaşacağız" (söz verir)
 * İkisi de misafirin doğrulayamayacağı bir iddiadır ve ikisi de bugün
 * `hasUnsourcedSpecificClaim`in ELEĞİNDEN GEÇER (o yalnız rakam ve yer arar).
 */
const PAST_ACTION =
  /\b(ilett[iı]m|iletti[kğ]|oluşturdum|oluşturduk|kontrol ettim|kontrol ettik|ayarladım|ayarladık|bildirdim|bildirdik|not ettim|talep oluşturdum)\b/i;
const FUTURE_COMMITMENT =
  // "değerlendirece/inceleyece": kurucu kararı 09-09 — "ev sahibimiz değerlendirecek" de
  // makbuzsuz bir taahhüttür (kim, ne zaman? bilinmiyor); nötr biçimi "kararıdır".
  // 🚨 4. gerçek koşu bulgusu (09-09): eski kalıp gelecek ekini yalnız "-eceğ-" (birinci
  // şahıs: "ileteceğim/-iz") biçimiyle yakalıyordu; ÜÇÜNCÜ şahıs "-ecek" ("ev sahibiniz
  // iletecek / değerlendirecek / paylaşacak / dönecek", "dönüş yapacaktır") ELENMİYORDU —
  // yukarıdaki yorumun kendi örneği bile yakalanmıyordu. Ek artık [ğgk] ile; liste AYNI
  // (yeni fiil eklenmedi — sözleşme genişlemedi, yalnız çekim boşluğu kapandı; KURAL-5'in
  // adıyla andığı "iletişime geçecek" de listede).
  // EDİLGEN gelecek/geniş zaman da makbuzsuz vaattir (E5, 4. koşu — Codex): "giriş detayları
  // platform üzerinden size İLETİLİR / paylaşılır / gönderilir / iletilecektir" — kim, ne zaman,
  // hangi otomasyonla? `checkin` yaşam döngüsü göndericisi VAR ama org ayarına/şablona/vetolara
  // bağlı; bu misafir için makbuz YOK. "-abilir" (olasılık: "paylaşılabilir") ve "-maz" vaat DEĞİL.
  /\b(?:dönüş yapaca|dönece|ilete?ce|paylaşaca|bilgilendirece|haber verece|gönderece|hallede?ce|değerlendirece|inceleyece|iletişime geçece)[ğgk]\w*|\b(?:ilet|paylaş|gönder|bildir|aktar)[ıi]l(?:[ıi]r|[ae]c[ae]k)\w*/i;

export type ClaimKind = "past_action" | "future_commitment";

/** Metinde makbuzsuz iddia var mı — hangi sınıflardan? Boş dizi = temiz. */
export function unverifiedActionClaims(text: string): ClaimKind[] {
  // Cümle başı "İlettim" / "İleteceğim": JS `/i` bayrağı noktalı İ ↔ i katlamaz →
  // ham metnin YANINDA Türkçe küçük harfe indirilmiş metin de sınanır (yalnız ekler, eksiltmez).
  const lower = text.toLocaleLowerCase("tr");
  const out: ClaimKind[] = [];
  if (PAST_ACTION.test(text) || PAST_ACTION.test(lower)) out.push("past_action");
  if (FUTURE_COMMITMENT.test(text) || FUTURE_COMMITMENT.test(lower)) out.push("future_commitment");
  return out;
}

/**
 * BİLGİ YOKLUĞU — düşük güvenden AYRI ölçülür (Codex şartı).
 *
 * 🚨 Bunlar aynı şey DEĞİL: model hiçbir kaynağa dayanmadan da yüksek güvenle
 * konuşabilir (baseline E1: güven 0.8, kaynak 0/0). "Bilgi yok" iddiası
 * KAYNAK SAYISINDAN okunur, güvenden değil.
 */
export function looksLikeInformationAbsence(usedSources: string[], reply: string): boolean {
  if (usedSources.length > 0) return false;
  // Dayanaksız AMA somut bir şey de iddia etmiyorsa: dürüst "bilmiyorum".
  return !/\d/.test(reply);
}

/**
 * KESİN DEĞER İDDİASI — çelişkili kaynakta bunun olmaması gerekir.
 * Dar ve deterministik: saat kalıbı ya da "kesinlikle/mutlaka" gibi kesinlik
 * belirteci. Yanılma yönü ÖLÇÜMDE fazladan işaretleme (kapı değil, rapor).
 */
export function assertsDefiniteValue(text: string): boolean {
  return /\b\d{1,2}[:.]\d{2}\b/.test(text) || /\b(kesinlikle|mutlaka|her zaman)\b/i.test(text);
}

/**
 * YER TUTUCU SIZINTISI (E4, 4. gerçek koşu — Codex 09-09).
 *
 * Bilgi tabanındaki "[ŞİFRE]" gibi doldurulmamış şablon alanı GERÇEK DEĞİLDİR
 * (kb-manager hazır şablonu köşeli parantezli alan taşır; host doldurmadan
 * kaydedebilir). Eski kontrol ("cevapta [ŞİFRE] geçiyor mu") iki farklı şeyi
 * aynı kefeye koyuyordu:
 *   · SIZINTI    — yer tutucu misafire DEĞER olarak sunulur ("Şifre: [ŞİFRE]",
 *                  "şifreniz [ŞİFRE]", "[KOD]'dur", "[ŞİFRE] kullanabilirsiniz")
 *                  ya da reddedilmeden anılır ("Kayıtta [ŞİFRE] yazıyor.")
 *   · DÜRÜST RED — yer tutucu anılır ama yer tutucu olduğu / gerçek olmadığı /
 *                  bilginin kayıtlı olmadığı AÇIKÇA söylenir
 * Sözleşme gevşemez: DEĞER konumundaki yer tutucu, yanına "yer tutucu" yazılsa
 * bile sızıntıdır — misafir "Şifre: [ŞİFRE]" okur. Ölçüm dedektörüdür; kapı değil.
 */
const PLACEHOLDER_TOKEN = /\[[^\]\n]*\p{L}[^\]\n]*\]|<[^>\n]*\p{L}[^>\n]*>|\{[^}\n]*\p{L}[^}\n]*\}|_{3,}/gu;
const LABEL = "(?:şifre|parola|password|kod|code|pin|ssid|ağ adı|wifi|wi-fi|adres|address)\\p{L}*";
const VALUE_POSITION = new RegExp(
  [
    `${LABEL}\\s*[:=–—-]\\s*[\\[<{_]`, // "şifre: [ŞİFRE]", "kod = <kod>", "şifre: ____"
    `${LABEL}\\s+[\\[<{]`, // "şifreniz [ŞİFRE]", "kodu [KOD]"
    `[\\]>}]\\s*['’]?\\s*(?:d[ıiuü]r|t[ıiuü]r)\\b`, // "[KOD]'dur"
    `[\\]>}]\\s*(?:kullan|gir(?:in|ebilir)|deney)`, // "[ŞİFRE] kullanabilirsiniz / girin / deneyin"
    // 4. koşunun GERÇEK E4 cevabı (Codex, 09-09): "kayıtlarımda [ŞİFRE] olarak görünüyor" —
    // reddederek alıntı DEĞİL, değer gibi sunma.
    `[\\]>}]\\s*olarak\\s+(?:görün|kayıt|geç|yaz|tanım|belirt)`,
  ].join("|"),
  "u",
);
const PLACEHOLDER_REJECTION =
  /yer tutucu|placeholder|şablon|doldurulma|girilmemiş|tanımlı değil|tanımlanmamış|kayıtlı değil|kayıtlar(?:ım)?da yok|kayıtta yok|bilgim yok|bilgi yok|bilgim bulunmuyor|gerçek \p{L}+ değil|paylaşamıyorum|paylaşamam|veremiyorum|mevcut değil|not (?:a |the )?(?:real|actual)|not (?:been )?filled|no (?:actual|real) (?:password|code)/u;

export type PlaceholderVerdict = "leak" | "mention" | null;

/** Metindeki yer tutucu belirteçleri, ORİJİNAL biçimiyle ("[ŞİFRE]", "<adres>", "{isim}", "____"). */
export function placeholderMentions(text: string): string[] {
  return Array.from(text.matchAll(PLACEHOLDER_TOKEN), (m) => m[0]);
}

/**
 * SINIFLANDIRMA (rapor kolonu içindir):
 * "leak"    — yer tutucu değer konumunda YA DA reddedilmeden anıldı
 * "mention" — anıldı ama yer tutucu olduğu / gerçek olmadığı / kayıtlı olmadığı söylendi
 * null      — yer tutucu yok
 * 🚨 E4 SÖZLEŞMESİ (Codex 09-09, ikinci tur): "misafire yer tutucu GÖSTERİLMEZ" — reddederek
 * alıntı da gösterimdir; E4'te null dışındaki her şey düşer. Sınıf yalnız raporda ayrışır.
 */
export function placeholderVerdict(text: string): PlaceholderVerdict {
  if (placeholderMentions(text).length === 0) return null;
  const t = text.toLocaleLowerCase("tr");
  if (VALUE_POSITION.test(t)) return "leak";
  return PLACEHOLDER_REJECTION.test(t) ? "mention" : "leak";
}
