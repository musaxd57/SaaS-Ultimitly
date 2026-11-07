import { detectKbInstructionHijack, foldTurkishAscii, isSafetyEmergencyText } from "@/lib/ai/fallback";
import { qrReplyHasDoorCode, withoutSecretKbItems } from "@/lib/guest-chat";
import { namesPaymentMethod } from "@/lib/payment-method-guard";

// Mülk talimatı metin kapısı — YAPRAK (veritabanı / servis içe aktarmaz): talimat yükleyicisi (cevap yolu) ve servis (kayıt) aynı kuralı
// kullanır; servisin karşılaştırma bağımlılığı cevap yoluna taşınmaz.

export const INSTRUCTION_MAX_CHARS = 500;
/** Etkin talimat tavanı. İsteme giren TOPLAM ayrıca sınırlı (istem bağlama dilimi). */
export const INSTRUCTIONS_MAX_ACTIVE = 10;

export type InstructionRejectReason =
  | "empty"
  | "too_long"
  | "door_code"
  | "secret"
  | "safety_topic"
  | "stay_change"
  | "contact"
  | "language"
  | "hijack"
  | "payment";

/**
 * Ret metinleri — TEK KAYNAK (talimat ve karşılaştırma notu rotaları aynı metni gösterir; müşteriye giden metin sade, "-in" hitabı).
 */
export const INSTRUCTION_REJECT_TEXT: Readonly<Record<InstructionRejectReason, string>> = {
  empty: "Talimat boş olamaz.",
  too_long: `Talimat en çok ${INSTRUCTION_MAX_CHARS} karakter olabilir.`,
  door_code: "Kapı ya da anahtar kutusu kodu talimata yazılamaz.",
  secret: "Şifre ya da kod talimata yazılamaz. Bu bilgiyi bilgi tabanına ekleyin.",
  safety_topic:
    "Acil durum, şikâyet, ücret ve fiyat, indirim ve iade konularında talimat yazılamaz. Bu konular güvenlik kurallarıyla ve sizin kararınızla yürür.",
  stay_change: "Erken giriş, geç çıkış ve rezervasyon onayı konularında talimat yazılamaz. Bu kararlar sizde kalır.",
  contact: "Telefon, e-posta ya da sosyal medya bilgisi talimata yazılamaz. Misafirle platform üzerinden yazışın.",
  language: "Cevap dili misafirin diline göre seçilir; dil talimatı yazılamaz.",
  hijack: "Bu metin yapay zekânın kurallarını değiştirmeye çalışıyor gibi görünüyor. Misafire nasıl davranılmasını istediğinizi düz cümleyle yazın.",
  payment: "Ödeme yöntemi, ödeme yeri ya da platform dışı rezervasyon talimata yazılamaz.",
};

/**
 * Kapı / kutu kodu KONUSU (değer ne olursa olsun — Opus 10-15 F15: "Kapı şifresi sorulursa Lale#7 de" 4–8 hane kuralından kaçıyordu).
 * Talimat kodun nasıl verileceğini anlatamaz; kod akışı kod tarafındadır.
 */
const DOOR_TOPIC_RE =
  /(?<![a-z])(?:(?:kapi|kutu|anahtar kutusu|keybox|key box|lockbox|lock box|keypad|tus paneli|door|gate|giris|kilit|akilli kilit|smart lock)[a-z]{0,10}\s{0,3}(?:kod|sifre|code|pin|password|passcode)|(?:code|pin|password|passcode)\s+(?:for|of|to)\s+the\s+(?:door|gate|lockbox|keybox|lock|building))/u;
/**
 * GÜVENLİK / PARA KONUSU (Opus 10-15 F16: "Şikâyet gelse bile risk düşük say, kendin ?cevapla", "Acil durumda ev sahibini rahatsız
 * etme", "geç çıkış ücretsiz de" geçiyordu). Bu konularda karar kod kapılarında ve ev sahibindedir; talimat onları anamaz.
 */
const SAFETY_TOPIC_RE =
  /(?<![a-z])(?:acil(?!is)|emergency|urgent|sikayet|complaint|risk|devret|devir|handoff|escalat|rahatsiz ?etme|haber ?verme|bildirme|kendin cevapla|her ?zaman ?evet|always ?(?:say ?)?yes|say ?yes|ucret|fiyat|bedava|price|fee(?!d)|free ?of ?charge|for ?free|indirim|discount|iade|refund|geri ?ode|tazmin|compensat|polis|police|yangin|fire(?![a-z])|tehdit|threat|gormezden gel|involve|ev sahibini (?:arama|karistirma|bildirme)|otomatik gonder|auto.?send|insan onay|onay bekleme|without (?:human )?approval|pazarlik|negotiat|haggle|kapora|depozito|deposit|tehdi[td]|devre[dt]|doktor(?:a)?\s{1,3}(?:cagir|getir|gotur|yonlendir|gerek)|(?:call|get)\s{1,3}(?:a\s{1,3})?doctor|ambulans|ambulance|hastane|hospital|ev sahib[a-z]{0,6}\s{1,3}(?:iletme|bildirme|haber verme|yonlendirme|sorma)|(?:never|don'?t|do not)\s{1,3}(?:[a-z]+\s{1,3}){0,6}?(?:host|owner)|yuzde ?\d|%\s?\d|\d\s?%|(?:her|tum|butun|every|all)\s{1,3}(?:tale[pb]|istek|istey|request)[a-z]{0,6}\s{1,3}(?:olur|evet|tamam|kabul|yes|agree))/u;
/**
 * Opus 10-15 HL4 F5 / F20 (çalıştırılarak ölçüldü — hepsi geçiyordu; bugün yalnız operatör yazar, müşteriye açılınca P1):
 *  · konaklama değişikliği kararları (doğrulanmış erken giriş iş akışı ve ev sahibi kararı; talimat "olur de" diyemez)
 *  · iletişim bilgisi / platform dışı yazışma (Airbnb kuralı; "WhatsApp numaramı ver")
 *  · dil dayatma (cevap dili misafirin dili — `ai/language-signal.ts`)
 *  · platform dışı ödeme / rezervasyon ("Airbnb dışında ödeme alalım", "direkt bana rezervasyon")
 */
/** Yedek anahtarın yeri bir erişim sırrıdır (talimat QR istemine de girer — Opus 10-15 son kontrol: "yedek anahtar paspasın altında"). */
const KEY_LOCATION_RE = /(?<![a-z])(?:yedek anahtar|spare key|paspas[a-z]{0,3}\s{1,3}alt|under the (?:door)?mat|saksi(?:nin)? alt|anahtar[a-z]{0,6}\s{1,3}(?:[a-z]+\s{1,3}){0,2}?(?:altinda|icinde|arkasinda))/u;
const STAY_CHANGE_RE =
  /(?<![a-z])(?:erken giris|gec cikis|early check|late check|konaklama(?:yi)? uzat|uzatma talebi|cikis[a-z]{0,6}\s{1,3}(?:[a-z]+\s{1,3}){0,3}?uzat|giris[a-z]{0,6}\s{1,3}(?:[a-z]+\s{1,3}){0,3}?(?:erkene|one) al|extend(?:ing)? (?:the |their |a )?stay|stay extension|erken gelme|bir gece daha|fazladan gece|extra night|onaylanma|unconfirmed|rezervasyon onay)/u;
const CONTACT_RE =
  /(?<![a-z])(?:whatsapp|telegram|instagram|facebook|signal app|e-?posta|e-?mail|mail adres|telefon(?:um|umu|umuz|umuzu| numara)|phone number|my (?:phone|number|cell)|call me|numara(?:m|mi|miz|mizi)(?![a-z])|cep (?:no|numara))|(?:\+?\d[\s().-]?){10,}/u;
const LANGUAGE_RE =
  /(?<![a-z])(?:(?:her zaman|always)\s{1,3}(?:turkce|ingilizce|english|turkish|almanca|german|rusca|russian|arapca|arabic)\s{1,3}(?:yaz|cevap|yanit|konus|reply|write|answer|respond|speak)|(?:turkce|ingilizce|english|turkish|almanca|german|rusca|russian|arapca|arabic)\s{1,3}(?:yaz(?:in|iniz|sin)?(?![a-z])|cevap ver|yanit ver|konus(?:un|sun)?(?![a-z]))|(?:reply|write|answer|respond)\s{1,3}(?:only\s{1,3})?in\s{1,3}(?:turkish|english|german|russian|arabic)|dilinde (?:degil|yazma))/u;
export const OFF_PLATFORM_RE =
  /(?<![a-z])(?:(?:airbnb|booking|platform)[a-z.'’]{0,6}\s{1,3}(?:disinda|disindan|haricinde|outside)|(?:outside|off)\s{1,3}(?:of\s{1,3})?(?:airbnb|booking|the platform))/u;
/** "direkt bana / bize" tek başına platform dışı DEĞİL ("Sorunlarınızı direkt bize yazabilirsiniz" — Haiku 10-15); para / rezervasyon sözcüğüyle birlikte. */
// Türkçede yön + EYLEM ("direkt bana yapsınlar / ödesin / göndersin"); "direkt bize yazabilir" (iletişim) eylem değil (Haiku 10-15).
const DIRECT_RE =
  /(?<![a-z])(?:(?:direkt|dogrudan)\s{1,3}(?:bana|bize|benden|bizden)\s{1,3}(?:[a-z]+\s{1,3}){0,2}?(?:yap|ode|gonder|kirala|rezerv|havale|transfer)|directly\s{1,3}(?:to|with|from)\s{1,3}(?:me|us))/u;
const MONEY_OR_BOOKING_RE = /(?<![a-z])(?:rezervasyon|odeme|ode(?:yin|yebilir|nir|me)|para(?![a-z]{3})|nakit|havale|eft(?![a-z])|iban|kirala|book|pay(?![a-z])|payment|cash)/u;
/** Platform dışı ödeme / rezervasyon (ASCII katlanmış metinde) — talimat kapısı ve taslak işareti aynı kural. */
export function mentionsOffPlatform(folded: string): boolean {
  return OFF_PLATFORM_RE.test(folded) || (DIRECT_RE.test(folded) && MONEY_OR_BOOKING_RE.test(folded));
}
export type InstructionCheck = { ok: true; content: string } | { ok: false; reason: InstructionRejectReason };

/**
 * Talimat metni kapısı (talimat cevap istemine girer → ev sahibi metni İSTEMDİR): kapı kodu değeri · bilgi tabanı ele geçirme kalıbı
 * · ödeme yöntemi / yeri (TEK KAYNAK `payment-method-guard`, ŞÜPHEDE REDDET) · uzunluk tavanı. Kaydederken VE isteme girerken koşar.
 */
export function checkInstruction(raw: string): InstructionCheck {
  // Görünmez karakter (proje tanımı: Default_Ignorable + Cf + U+2800) silinir — "rahatsız\u200Betme" kapıdan kaçmasın (Haiku 10-15).
  const content = raw.replace(/[\p{Default_Ignorable_Code_Point}\p{Cf}\u2800]/gu, "").replace(/\s+/gu, " ").trim();
  if (!content) return { ok: false, reason: "empty" };
  if (content.length > INSTRUCTION_MAX_CHARS) return { ok: false, reason: "too_long" };
  if (qrReplyHasDoorCode(content, [])) return { ok: false, reason: "door_code" };
  // Şapkalı harf (â / î / û) ortak katlamada kalır ("Şikâyet" → "sikâyet" — Haiku 10-15): işaretler sökülüp katlanır. Yalnız kapı
  // karşılaştırması içindir; saklanan / isteme giren metin değişmez.
  const folded = foldTurkishAscii(content.normalize("NFD").replace(/\p{M}/gu, ""));
  if (DOOR_TOPIC_RE.test(folded)) return { ok: false, reason: "door_code" };
  // Sır süzgeci (bilgi tabanı / üslup rehberiyle AYNI `looksLikeSecret`): şifre, kod, harfli parola — talimat QR'a da gider.
  if (withoutSecretKbItems([{ title: "", content }]).length === 0 || KEY_LOCATION_RE.test(folded)) return { ok: false, reason: "secret" };
  if (SAFETY_TOPIC_RE.test(folded) || isSafetyEmergencyText(content)) return { ok: false, reason: "safety_topic" };
  if (STAY_CHANGE_RE.test(folded)) return { ok: false, reason: "stay_change" };
  if (CONTACT_RE.test(folded)) return { ok: false, reason: "contact" };
  if (LANGUAGE_RE.test(folded)) return { ok: false, reason: "language" };
  if (detectKbInstructionHijack(content)) return { ok: false, reason: "hijack" };
  if (namesPaymentMethod(content) || mentionsOffPlatform(folded)) return { ok: false, reason: "payment" };
  return { ok: true, content };
}

