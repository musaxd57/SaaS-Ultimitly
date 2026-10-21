// ---------------------------------------------------------------------------
// OTOMATİK MESAJ METNİ — SAF KURALLAR (kurucu T4, 10-21). Karşılama / giriş / çıkış mesajının gövdesi, doldurulmamış alan kapısı ve ev sahibine
// gösterilen önizleme TEK yerden: gönderici (`automation.ts`), kalıcı kuyruk işçisi (gönderimden önce yeniden kurar) ve mülk sayfasındaki
// "Otomatik mesajlar" önizlemesi aynı fonksiyonları çağırır → önizleme == gerçek gönderim. Veritabanı YOK (yükleyiciler `./store.ts`).
// ---------------------------------------------------------------------------
import { ANY_DOUBLE_BRACE } from "@/lib/template-apply";
import {
  apartmentResolvable,
  fillGuestPlaceholders,
  hasNamePlaceholder,
  kbPlaceholderTokens,
  leftoverGuestTokens,
  unfilledTemplateTokens,
  usesApartmentToken,
} from "@/lib/kb-placeholders";

export const AUTO_MESSAGE_KINDS = ["welcome", "checkin", "checkout"] as const;
export type AutoMessageKind = (typeof AUTO_MESSAGE_KINDS)[number];
export function isAutoMessageKind(v: unknown): v is AutoMessageKind {
  return typeof v === "string" && (AUTO_MESSAGE_KINDS as readonly string[]).includes(v);
}
/** Ev sahibinin ekranındaki adlar (mülk sayfası kartı + gönderilenler). */
export const AUTO_MESSAGE_LABEL: Record<AutoMessageKind, string> = {
  welcome: "Karşılama mesajı",
  checkin: "Giriş mesajı",
  checkout: "Çıkış mesajı",
};
/** Bilgi tabanı kalemi doğrulayıcısıyla aynı tavan (`validators.ts`). */
export const AUTO_MESSAGE_MAX_CHARS = 20_000;

/** Şablon belirteçlerini canlı değerlere çözer (tek kaynak sarmalayıcısı). */
function fillPlaceholders(text: string, firstName: string | null, propertyName?: string): string {
  return fillGuestPlaceholders(text, { guestFirstName: firstName, propertyName });
}

/**
 * Build the welcome message body. If the host's template contains a {isim}
 * placeholder, substitute the tokens and send it verbatim (their own greeting +
 * sign-off). Otherwise prepend a greeting and append the org signature.
 */
/**
 * 🚨 DOLDURULMAMIŞ YER TUTUCU TAŞIYAN YAŞAM-DÖNGÜSÜ METNİ MİSAFİRE GİTMEZ
 * (kurucu iş emri, 2026-09-11 — ölçülmüş misafir-görünür kusur).
 *
 * `KB_PRESETS`in "Giriş talimatı" ve "Çıkış" hazır şablonlarının İKİSİ de
 * doldurulmamış köşeli parantez taşıyor (`[AÇIK ADRES]` · `[ZİL / KAPI KODU
 * TARİFİ]` · `[ANAHTAR TESLİM ŞEKLİ]` · `[ANAHTAR BIRAKMA YERİ]`). Host rozete
 * basıp kaydedebiliyor ve kalem `approved` doğuyor.
 *
 * 🚨 ÜRÜNÜN `[…]` KORUMASI BU YOLDA DEVREDE DEĞİL: `packKnowledgeBase`in
 * `[NOT] DOLDURULMAMIŞ YER TUTUCU` uyarısı bir MODEL İSTEMİ notudur, oysa
 * yaşam-döngüsü mesajları modelden HİÇ GEÇMEZ (`kb-review.ts`: "içerikleri
 * misafire AYNEN gönderilir"). Yani misafir `Adres: [AÇIK ADRES]` okuyordu.
 *
 * `{{…}}` sınıfı da elenir: bu yolda hiçbir yerde çözülmüyor (`fillPlaceholders`
 * yalnız tek-parantez `{isim}`/`{daire}` sınıfını bilir), yani host elle
 * `{{wifiInfo}}` yazarsa misafire HAM gider.
 *
 * ⚠️ YÖN FAIL-CLOSED ve BEDELİ VAR: kalem düzeltilene kadar o daireye otomatik
 * mesaj GİTMEZ. Bu, ham belirteç göndermekten iyidir ama SESSİZ OLMAMALI —
 * host'a Bilgi Tabanı ekranında kalemin yanında söylenir (`kb-manager`), yani
 * uyarı tam düzeltmenin yapılacağı yerde çıkar.
 *
 * Yer tutucu ikamesinden SONRAKİ metin denetlenir: `{isim}` çözülmüş olur ve
 * yanlışlıkla "doldurulmamış" sayılmaz.
 */
export function hasUnfilledPlaceholders(filledBody: string): boolean {
  // `{daire}` çözülemediyse (mülk adında numara yok / belirsiz) belirteç kalır → mesaj GİTMEZ, tahmin YOK (kurucu kararı 09-30).
  // Tanınmayan "{kod}" / "%KOD%" de (10-01, A08) — `unfilledTemplateTokens`.
  return (
    kbPlaceholderTokens(filledBody).length > 0 ||
    ANY_DOUBLE_BRACE.test(filledBody) ||
    leftoverGuestTokens(filledBody).length > 0 ||
    unfilledTemplateTokens(filledBody).length > 0
  );
}

export function buildGuestMessageBody(
  content: string,
  firstName: string | null,
  signature?: string,
  propertyName?: string,
): string {
  const trimmed = content.trim();
  // Doldurmadan SONRA da kırpılır (09-28): ad bilinmiyorken şablonun ilk satırı yalnız "{isim}," ise satır gider ve arkasındaki
  // boş satır mesajın başında kalıyordu.
  const filled = fillPlaceholders(trimmed, firstName, propertyName).trim();
  if (hasNamePlaceholder(trimmed)) {
    return filled; // host's own greeting + sign-off, tokens resolved
  }
  // Ad bilinmiyorsa (yer tutucu ad: "Rezervasyon HM4K2" / "Misafir") selam adsız — kurucu kararı 09-28.
  const greeting = firstName ? `Merhaba ${firstName},` : "Merhaba,";
  return [greeting, "", filled, ...(signature ? ["", signature] : [])].join("\n");
}

/**
 * Bu metin gönderilebilir mi — gönderilemiyorsa SEBEBİ (kart uyarısı + gönderici atlaması aynı kural):
 *  · `empty` — metin boş (bu mesaj gönderilmez; ev sahibinin bilinçli seçimi olabilir).
 *  · `apartment_unresolved` — `{daire}` kullanıyor ama mülk adından daire numarası okunamıyor (kurucu kararı 09-30: tahmin YOK).
 *  · `unfilled` — doldurulmamış alan (`[AÇIK ADRES]`, `{{…}}`, tanınmayan `{kod}` …) misafire HAM gider → gönderilmez.
 * Kontrol, gönderimdeki gibi gövde KURULDUKTAN sonra yapılır (`{isim}` çözülmüş olur). Örnek ad kullanılır; ad bilinmese de sonuç aynı.
 */
export type AutoMessageIssue = "empty" | "apartment_unresolved" | "unfilled";
export function autoMessageIssue(body: string, propertyName: string, signature?: string): AutoMessageIssue | null {
  if (body.trim() === "") return "empty";
  if (usesApartmentToken(body) && !apartmentResolvable(propertyName)) return "apartment_unresolved";
  return hasUnfilledPlaceholders(buildGuestMessageBody(body, PREVIEW_GUEST_NAME, signature, propertyName)) ? "unfilled" : null;
}

/** Ev sahibine gösterilen sebep cümleleri (müşteriye giden metin sade — kurucu 09-23). */
export const AUTO_MESSAGE_ISSUE_TEXT: Record<AutoMessageIssue, string> = {
  empty: "Bu mesaj boş — gönderilmez.",
  apartment_unresolved: "Mesajda {daire} var ama daire numarası mülk adından okunamıyor — mülk adını düzeltin ya da {daire}'yi kaldırın. Düzeltilene kadar gönderilmez.",
  unfilled: "Mesajda doldurulmamış alan var — düzeltilene kadar gönderilmez.",
};

/** Önizlemede kullanılan örnek misafir adı (gerçek misafir verisi önizlemeye girmez). */
export const PREVIEW_GUEST_NAME = "Ayşe";

/** Ev sahibinin göreceği önizleme: misafire gidecek metnin aynısı (örnek adla) + gönderilemiyorsa sebep. */
export function previewAutoMessage(
  body: string,
  propertyName: string,
  signature?: string,
): { text: string; issue: AutoMessageIssue | null; unfilledTokens: string[] } {
  const issue = autoMessageIssue(body, propertyName, signature);
  const text = issue === "empty" ? "" : buildGuestMessageBody(body, PREVIEW_GUEST_NAME, signature, propertyName);
  const unfilledTokens = issue === "unfilled" ? [...new Set([...kbPlaceholderTokens(text), ...unfilledTemplateTokens(text), ...leftoverGuestTokens(text)])].slice(0, 6) : [];
  return { text, issue, unfilledTokens };
}
