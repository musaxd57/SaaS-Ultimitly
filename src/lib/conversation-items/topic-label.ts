// ---------------------------------------------------------------------------
// KISA KONU ETİKETİ (kurucu 10-23 C; migration 84 `ConversationItem.topic`; yalnız `AI_ITEM_ORDINAL_ENABLED` açıkken yazılır). Saf.
//
// Kurucu şartları (aynen özet): kısa ve sınırlı; misafir metni ham kopyalanmaz; ad, telefon, şifre ve saldırı talimatı için denetlenir;
// modele verilirse misafir kaynaklı VERİ sayılır (güvenilir işletme bilgisi değil); kaynak mesaj silinince / anonimleşince etiket de gider.
//
// Kurulum: anlama katmanının BU isteğe ait Türkçe arama sorgusundan (`query_tr` — katman adları zaten maskeler) sözcük sözcük; yalnız
// isteğin AYIRT EDİCİ sözcükleri (`needTerms` — durak / genel / yokluk sözcükleri ve rakamlar elenmiş) ilk görülme sırasıyla, en çok 3
// sözcük ve 40 karakter. Atılan: rakam, "@" / bağlantı, 20 harften uzun sözcük, misafirin adının parçası (ve onunla başlayan çekimli
// biçimi: "mehmetin"), unvanın komşusu ("Ahmet bey", "Mr Smith"), sır sözcüğü (şifre, kod, pin, kart, iban …) ve ARDINDAKİ sözcük
// (değerin kendisi olabilir: "şifre kelebek"), sözlükte konusu olmayan Büyük Harfle Başlayan sözcük (özel ad — sorgu küçük harfle
// yazılır; küçük harfle yazılmış, misafirin adı olmayan üçüncü kişi adı bu kuralla yakalanamaz — anlama katmanı ad yazmaz talimatlıdır,
// bilinen sınır). Sorguda talimat-ele-geçirme izi varsa etiket HİÇ yazılmaz. Modele GİTMEZ.
// ---------------------------------------------------------------------------

import { deconfuse } from "@/lib/ai/fallback";
import { normalizeForRetrieval } from "@/lib/ai/retrieval/text";
import { topicsWithSymptomsOf } from "./relation";
import { needTerms } from "./topic-absence";

export const TOPIC_MAX_WORDS = 3;
export const TOPIC_MAX_CHARS = 40;

/** Sır / kimlik sözcükleri (katlanmış kök başlangıcı) — etikete GİRMEZ; ardındaki sözcük de girmez. */
const SECRET_ROOTS = ["sifre", "parola", "password", "passwort", "kod", "code", "pin", "kart", "card", "iban", "hesap", "hesab", "account", "telefon", "phone", "numara", "number", "mail", "pasaport", "passport", "kimlik", "kombinasyon", "combination"];
/** Tam sözcük sır adları ("wifi key / pass kelebek", WPA anahtarı) — kök değil: "keyif" sır değildir (Opus güvenlik 10-23 F11). */
const SECRET_EXACT = new Set(["key", "keys", "pass", "passe", "passcode", "pw", "pwd", "sife", "wpa", "wpa2", "psk", "ssid", "visa", "mastercard", "amex", "clave"]);
/** Öteki dillerin sır sözcük kökleri ("кофе ПАРОЛЬ wifi", "contraseña", "mot de passe" — Opus taze göz 10-23 F7). */
const SECRET_ROOTS_OTHER = ["парол", "код", "пин", "номер", "телефон", "паспорт", "карт", "contrase", "kennw"];
/** Sır sözcüğünün önünde değer aranan en uzak sözcük. */
const VALUE_WINDOW = 6;
/** Harfle yazılmış rakamlar etikete girmez ("kapı kodu dört beş bir iki" — kodun kendisi; Opus dilim sonu 10-23 R15). */
const SPELLED_DIGITS = new Set(
  (
    "sifir bir iki uc dort bes alti yedi sekiz dokuz on yirmi otuz kirk elli yuz bin " +
    "zero one two three four five six seven eight nine ten eleven twelve hundred thousand " +
    "null eins zwei drei vier funf sechs sieben acht neun zehn"
  ).split(" "),
);
/** Ağdan sonra "anahtar" Wi-Fi şifresidir ("wifi anahtarı kelebek"); tek başına (kapı anahtarı) sır değildir. */
const NETWORK_WORDS = new Set(["wifi", "wi", "fi", "wlan", "ag", "agin", "network", "modem", "internet"]);
/** Kodu / şifresi olan şeyler ("kapı kodu", "kasa şifresi") — sır sözcüğünün önündeki bu sözcük değer değil, konudur. */
const CODED_THINGS = new Set(["kapi", "kapinin", "kasa", "kasanin", "modem", "router", "alarm", "garaj", "otopark", "bina", "binanin", "asansor", "kutu", "kutusu", "anahtar", "internet", "tv", "televizyon", "netflix", "ag", "agin", "wifi", "wi", "fi", "door", "safe", "gate", "lockbox"]);
/** E-posta / alan adı parçaları — kendisi ve önündeki sözcük (adresin yerel kısmı) etikete girmez. */
const EMAIL_PARTS = new Set(["gmail", "hotmail", "outlook", "yahoo", "icloud", "yandex", "protonmail", "live", "msn", "com", "net", "org", "edu", "tr"]);
/** Unvanlar (katlanmış): ardından ("Mr Smith", "Bay Yılmaz") ya da önünden ("Ahmet bey", "Ayşe hanım") gelen sözcük kişi adıdır. */
// "bay / bayan" bilerek YOK: Türkçede "bayan tuvalet" (kadın tuvaleti) da demektir (Haiku 10-23).
const HONORIFIC_BEFORE = new Set(["mr", "mrs", "ms", "miss", "dr", "sayin", "herr", "frau", "monsieur", "madame"]);
const HONORIFIC_AFTER = new Set(["bey", "beyefendi", "hanim", "hanimefendi", "hoca", "hocam", "abi", "abla"]);
/**
 * Talimat-ele-geçirme izleri — biri varsa etiket hiç yazılmaz. Kesin izler tek başına ("ignore", "yoksay", "rol yap", emir "unut");
 * "talimat / komut / instructions" yalnız BİTİŞİK saldırı bağlamıyla: önünde niteleyici ("önceki / tüm / sistem talimatları", "previous
 * instructions") ya da ardında yürütme emri ("komutu çalıştır", "talimatları uygula"). "Çamaşır makinesi kullanım talimatı", "yeni kullanım
 * talimatı var mı", "uygulama talimatı" misafirin olağan sorusudur (Opus + Haiku 10-23). "unut" yalnız emir biçimi ("unuttum" olağan söz).
 * JS `\b` ASCII'dir → harf sınırı açıkça yazıldı.
 */
const INJECTION_STRONG =
  /\b(?:ignore|disregard|system\s*prompt|jailbreak|developer\s*mode|act\s+as)\b|(?:^|[^\p{L}])(?:yoksay|rol\s*yap|görmezden\s*gel|gormezden\s*gel)|(?:^|[^\p{L}])unut(?:un)?(?:[^\p{L}]|$)/iu;
const INSTRUCTION_ATTACK =
  /\b(?:previous|prior|above|all|system|your|new)\s+instructions?\b|\b(?:follow|run|execute|obey)\s+(?:(?:these|those|the|my|this|following)\s+)?instructions?\b|(?:^|[^\p{L}])(?:önceki|onceki|tüm|tum|bütün|butun|yukarıdaki|yukaridaki|sistem|senin|yeni)\s+(?:talimat|komut)|(?:^|[^\p{L}])(?:talimat|komut)\p{L}{0,8}\s+(?:çalıştır|calistir|uygula|unut|yoksay)(?:ın|in|un|ınız|iniz)?(?:[^\p{L}]|$)/iu;
/** Ad ardından gelen hâl / iyelik eki (katlanmış): "ali" + "nin", "can" + "a", "ece" + "yle". */
const CASE_SUFFIX = /^(?:n?[iu]n|y?[iu]|y?[ae]|n?d[ae]n?|n?t[ae]n?|y?l[ae]|l[ae]r|n?[iu]m|n?[iu]z)$/;
/** Bağlantı / adres izi: "@", "http", "www." ve şemasız alan adı ("lixusai.com"). */
const LINK = /@|https?:|www\.|[\p{L}\p{N}]\.\p{L}{2,}/iu;

const fold = (s: string): string => normalizeForRetrieval(s).toLowerCase();

/** Kiril / Yunan harfli adın Latin okunuşu (misafir profili "Иван", sorgu "ivan" — Opus güvenlik 10-23 F11). */
const TRANSLIT: Readonly<Record<string, string>> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p",
  р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  α: "a", β: "v", γ: "g", δ: "d", ε: "e", ζ: "z", η: "i", θ: "th", ι: "i", κ: "k", λ: "l", μ: "m", ν: "n", ξ: "x", ο: "o", π: "p", ρ: "r",
  σ: "s", ς: "s", τ: "t", υ: "y", φ: "f", χ: "ch", ψ: "ps", ω: "o",
};
const translit = (s: string): string => [...s].map((c) => TRANSLIT[c] ?? c).join("");
/** Unvan — çekimli biçim de ("hanımın", "beyin"): tam eşleşme ya da unvan + hâl / iyelik eki ("beyaz" değil). */
const honorific = (set: ReadonlySet<string>, f: string): boolean => set.has(f) || [...set].some((h) => f.startsWith(h) && CASE_SUFFIX.test(f.slice(h.length)));

const hasInjection = (q: string): boolean => INJECTION_STRONG.test(q) || INSTRUCTION_ATTACK.test(q);

/** Baş harfi büyük, gerisi küçük ("Ahmet", "Netflix") — "TV" / "WiFi" gibi kısaltmalar değil. */
const titleCase = (raw: string): boolean => {
  const first = raw.charAt(0);
  const rest = raw.slice(1);
  return first !== first.toLocaleLowerCase("tr") && rest === rest.toLocaleLowerCase("tr") && rest.length > 0;
};

/**
 * Misafir adı eşleyicisi (katlanmış sözcük): ad parçaları + Kiril / Yunan okunuşları; ad + çekim eki ("mehmetin", "alinin"); 4+ harfli adda
 * her uzantı (kesmesiz yazım, "mehmetciğim"), kısa adda yalnız hâl eki — "Ali" "alışveriş"i, "Can" "canlı"yı düşürmez (Haiku 10-23).
 * Kısaltılmış ad ("alex" ← Alexander) da eşlenir. Konu etiketi ve doğrulanmış cevap tekrarı (`answer-reuse/core.ts`) AYNI kuralı kullanır.
 */
export function guestNameMatcher(names: readonly (string | null | undefined)[]): { nameParts: string[]; isName: (folded: string) => boolean } {
  const nameParts = [
    ...new Set(
      names.flatMap((n) => {
        if (!n) return [];
        const parts = fold(n).split(/[^\p{L}]+/u).filter((p: string) => p.length >= 2);
        return [...parts, ...parts.map(translit)];
      }),
    ),
  ];
  const isName = (f: string) =>
    nameParts.some(
      (p) =>
        p === f ||
        (p.length >= 4 && f.startsWith(p)) ||
        (f.startsWith(p) && CASE_SUFFIX.test(f.slice(p.length))) ||
        (f.length >= 4 && p.startsWith(f)),
    );
  return { nameParts, isName };
}

/**
 * İsteğin kısa konu etiketi ya da `null`. `query` anlama katmanının Türkçe sorgusu; `names` misafirin bilinen adları (parçaları ve
 * onlarla başlayan çekimli biçimler etikete giremez).
 */
export function itemTopicLabel(query: string | null | undefined, names: readonly (string | null | undefined)[] = []): string | null {
  if (!query) return null;
  // Birleşik işaretler sözcüğü bölmesin ("ş̇ifre" → "ş" + işaret + "ifre" iki sözcük olup sır sözcüğünü kaçırıyordu); görünmez karakter de
  // ("şif\u200Bresi") ve tam genişlikli rakam ("２") — NFKC (Haiku 10-23 gece-3).
  const q = query.normalize("NFKC").replace(/[\p{M}\p{Cf}\p{Default_Ignorable_Code_Point}]+/gu, "");
  if (hasInjection(q) || LINK.test(q)) return null;
  const distinct = new Set(needTerms([q]));
  if (distinct.size === 0) return null;
  const { nameParts, isName } = guestNameMatcher(names);
  const raws = q.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  // Kiril / Yunan ikiz harfli sır sözcüğü ("ѕifresi" — Opus taze göz 10-23 F7) Latin okunuşuyla da tanınır.
  const folded = raws.map((r) => fold(deconfuse(r)));
  const isSecretAt = (i: number) => {
    const f = folded[i] ?? "";
    if (!f) return false;
    // Yanlış yazım / bitişik yazım da sırdır ("passwd", "pasword", "pswd", "wifi sife", "wifisifresi" — Haiku 10-23 gece-2).
    if (SECRET_ROOTS.some((r) => f.startsWith(r)) || SECRET_ROOTS_OTHER.some((r) => f.startsWith(r)) || SECRET_EXACT.has(f) || /(?:sifre|sifer|sifra|parola|passw|pasw|pasv|passphr|pswd|kennwort)/.test(f) || /^koo?d/.test(f) || (f.length > 5 && /kod(?:u|unu|um)?$/.test(f))) return true;
    // "kilit / gizli kelimesi" de sırdır (Haiku 10-23 gece-3); tek başına "kelime" değil.
    if (f.startsWith("kelime") && /^(?:kilit|gizli|anahtar|guvenlik)/.test(folded[i - 1] ?? "")) return true;
    // Niteleyici de sır adının parçasıdır ("KİLİT kelimesi") — sözlük sözcüğü olduğu için pencerede kalmasın.
    if (/^(?:kilit|gizli|guvenlik)/.test(f) && (folded[i + 1] ?? "").startsWith("kelime")) return true;
    return f.startsWith("anahtar") && NETWORK_WORDS.has(folded[i - 1] ?? "");
  };
  // Sır sözcüğünün ÖNÜNDEKİ değer birden çok sözcük olabilir ve sözlük sözcüğü taşıyabilir ("kelebek mavi KAHVE şifresi" — Haiku 10-23 gece-3:
  // iki sözcüklük pencere sözlük sözcüğünde kırılıyordu). Sır sözcüğünden geriye en çok 4 sözcük, kodu olan şeye / ağ sözcüğüne ("kapı kodu",
  // "wifi şifresi") kadar düşer.
  const topicless = (raw: string) => topicsWithSymptomsOf(raw).length === 0;
  const coded = (k: number) => CODED_THINGS.has(folded[k]) || NETWORK_WORDS.has(folded[k]);
  const beforeSecret = new Set<number>();
  for (let j = 0; j < raws.length; j++) {
    if (!isSecretAt(j)) continue;
    // Değer sır sözcüğüne BİTİŞİK bir dizidir ve en uzaktaki konusuz sözcüğe kadar uzanır ("kelebek mavi KAHVE şifresi" → üçü de düşer); ondan
    // da uzaktaki sözlük sözcükleri değeri değil kodu olan şeyi adlandırır ("KLİMA kumandası kodu", "HAVUZ GİRİŞ kartı", "GİRİŞ kodu" — Opus
    // taze göz 10-23 F6: pencere konusu olan sözcükleri de düşürüp etiketi boşaltıyordu).
    const window: number[] = [];
    let k = j - 1;
    for (; k >= 0 && k >= j - VALUE_WINDOW; k--) {
      if (coded(k) || isSecretAt(k)) break;
      window.push(k);
    }
    let farthestValue = -1;
    window.forEach((w, n) => {
      if (topicless(raws[w])) farthestValue = n;
    });
    for (let n = 0; n <= farthestValue; n++) beforeSecret.add(window[n]);
    // Kodu olan şeyin / ağ sözcüğünün ÖNÜNDEKİ değer de aynı kuralla düşer ("MAVİ kelebek ağ şifresi", "kelebek wifi şifresi", "kelebek kahve
    // deniz havuz wifi şifresi" — mutasyon turu + Opus taze göz F7 + Haiku 10-23 gece-4); en uzak konusuz sözcükten uzaktaki sözlük sözcüğü kalır
    // ("havuz ısıtması bozuk, wifi şifresi" → "havuz ısıtması").
    if (k >= 0 && k >= j - VALUE_WINDOW && coded(k)) {
      const outer: number[] = [];
      for (let m = k - 1; m >= 0 && m >= k - 4 && !coded(m) && !isSecretAt(m); m--) outer.push(m);
      let far = -1;
      outer.forEach((w, n) => {
        if (topicless(raws[w])) far = n;
      });
      for (let n = 0; n <= far; n++) beforeSecret.add(outer[n]);
    }
  }
  const out: string[] = [];
  // Sır sözcüğünden SONRAKİ sözcük değerin parçası olabilir ("wifi şifresi HALA kelebek mi", "parolası mavi ejderha") → yalnız sözlükte
  // konusu olan sözcük kalır ("kelebek şifresi çalışmıyor WIFI") (R15: yalnız hemen ardındaki sözcük düşüyordu).
  // Sır sözcüğünün HEMEN ardındaki üç sözcük de (sözlük sözcüğü olsa da) değer sayılır ("wifi şifresi kahve DENİZ mi" — Opus taze göz 10-23
  // F7); kodu olan şey / ağ sözcüğü değer değildir ("kelebek şifresi çalışmıyor WIFI").
  let afterSecret = false;
  let sinceSecret = -1;
  for (let i = 0; i < raws.length; i++) {
    const raw = raws[i];
    const f = folded[i];
    if (beforeSecret.has(i)) continue;
    if (isSecretAt(i)) {
      afterSecret = true;
      sinceSecret = 0;
      continue;
    }
    if (sinceSecret >= 0) sinceSecret = coded(i) ? -1 : sinceSecret + 1;
    if (sinceSecret >= 1 && sinceSecret <= 3) continue;
    if (afterSecret && topicless(raw)) continue;
    if (SPELLED_DIGITS.has(f)) continue;
    // Rakam taşıyan belirteç `needTerms`te zaten yok ("5g", "lale2025" — ölçüldü) → `distinct` onu eler.
    if (!distinct.has(f) || raw.length > 20) continue;
    if (isName(f) || isSecretAt(i) || EMAIL_PARTS.has(f)) continue;
    const prev = folded[i - 1] ?? "";
    const next = folded[i + 1] ?? "";
    // Sır sözcüğünün ardındaki sözcük değerin kendisi olabilir; unvanın komşusu kişi adıdır.
    if ((prev && isSecretAt(i - 1)) || honorific(HONORIFIC_BEFORE, prev) || honorific(HONORIFIC_AFTER, next)) continue;
    if (honorific(HONORIFIC_BEFORE, f) || honorific(HONORIFIC_AFTER, f)) continue;
    // Değer sır sözcüğünden ÖNCE de yazılır ("kelebek şifresi" — kodu olan şey değilse: "kapı kodu" kalır); e-posta adresinin yerel kısmı
    // alan adından önce gelir; bilinen adın YALIN hâlinin bitişiğindeki konusuz sözcük soyadıdır ("john smith"; "mehmetin odası" değil).
    // Sözlükte konusu olan sözcük kalır ("wifi şifresi").
    // İki sözcüklük değer ("MAVİ kelebek şifresi") ve kodu olan şeyin önündeki değer ("kelebek ağ şifresi") `beforeSecret`te.
    if (topicless(raw) && ((next && isSecretAt(i + 1) && !CODED_THINGS.has(f)) || EMAIL_PARTS.has(next) || nameParts.includes(prev) || nameParts.includes(next))) continue;
    // Sorgu küçük harfle yazılır; sözlükte konusu olmayan Büyük Harfli sözcük özel addır ("Ahmet", "Netflix").
    if (titleCase(raw) && topicsWithSymptomsOf(raw).length === 0) continue;
    const word = raw.toLocaleLowerCase("tr");
    if (out.includes(word)) continue;
    out.push(word);
    if (out.length >= TOPIC_MAX_WORDS) break;
  }
  const label = out.join(" ").slice(0, TOPIC_MAX_CHARS).trim();
  return label.length >= 2 ? label : null;
}
