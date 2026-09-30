// ---------------------------------------------------------------------------
// ADSIZ YAPAY ZEKÂ + KODLA SELAM (K10-o "D", kurucu onayı 09-28; anahtar `AI_CODE_GREETING_ENABLED`, VARSAYILAN KAPALI).
//
// Misafirin adı MİSAFİRİN metnidir (sağlayıcıdaki görünen ad): istemin "rezervasyon" bölümünde güvenilir olgu gibi duruyordu
// ("Ada Otopark Ücretsiz" gibi bir ad talimat taşıyabilir) ve her cevapta soyadıyla modele gidiyordu. Anahtar açıkken:
//   · model adı rezervasyon alanından GÖRMEZ (istem rezervasyon satırı yok, bilgi tabanı `{isim}` → "misafirimiz"); misafir
//     metninde ad YALNIZ kimlik konumunda "[Misafir]" olur (kurucu kararı 09-30 — "Deniz manzarası" silinmez; tam gizlilik iddiası YOK),
//   · model selam YAZMAZ (istem + örnek cevaplar),
//   · selamı KOD ekler — YALNIZ ilk cevapta, misafirin dilinde, hitap adı YALNIZ kanalın ayrı ad alanından
//     (`Reservation.guestGivenName`, migration 57); yoksa adsız ("Merhaba,"). İlk kelimeyi ad sanmak YOK (Codex kuralı).
//   · model yine de selamla başlarsa o selam silinir (çift selam / tekrar selam olmaz).
// Anahtar kapalıyken istem ve cevap bayt bayt eski (pinli). YAPRAK modül (yalnız `kb-placeholders` — o da yaprak).
// Tasarım + kararlar: `docs/TASARIM-2026-09-28-misafir-adi.md`.
// ---------------------------------------------------------------------------

import { GUEST_NAME_FALLBACK, guestFirstNameForPrompt } from "@/lib/kb-placeholders";

/** Anahtar TEK YERDE okunur; yalnız "1" açar. */
export function codeGreetingEnabled(): boolean {
  return process.env.AI_CODE_GREETING_ENABLED === "1";
}

export type GreetingLanguage = "tr" | "en" | "de" | "fr" | "es" | "ru" | "ar";

/** Selam kalıpları (kurucu 09-28: resmî tonda da "Merhaba Ayşe,"). Tabloda olmayan dilde selam satırı YOK. */
const GREETINGS: Record<GreetingLanguage, { named: (name: string) => string; nameless: string }> = {
  tr: { named: (n) => `Merhaba ${n},`, nameless: "Merhaba," },
  en: { named: (n) => `Hello ${n},`, nameless: "Hello," },
  de: { named: (n) => `Hallo ${n},`, nameless: "Hallo," },
  fr: { named: (n) => `Bonjour ${n},`, nameless: "Bonjour," },
  es: { named: (n) => `Hola ${n},`, nameless: "Hola," },
  ru: { named: (n) => `Здравствуйте, ${n}!`, nameless: "Здравствуйте!" },
  ar: { named: (n) => `مرحباً ${n}،`, nameless: "مرحباً،" },
};

const isGreetingLanguage = (lang: string | null | undefined): lang is GreetingLanguage =>
  typeof lang === "string" && Object.hasOwn(GREETINGS, lang);

/** Hitap adının en fazla sözcük ve kod noktası sayısı. */
const SALUTATION_MAX_WORDS = 3;
const SALUTATION_MAX_CHARS = 40;

/**
 * Selamda kullanılacak ad — YALNIZ kanalın ayrı ad alanından. En çok üç sözcük, HER sözcük baştan sona ad biçimli (harf + ad
 * birleştiricileri; rakam / iki nokta / görünmez ayırıcı yok), en çok 40 kod noktası, yer tutucu değil ("Misafir …"). Aksi `null`
 * (selam adsız). Güvenlik sözcüğü REDDEDİLMEZ: "Ateş" gerçek bir addır; ad yalnız misafirin kendisine giden selamda durur.
 */
export function salutationNameOf(givenName: string | null | undefined): string | null {
  if (typeof givenName !== "string") return null;
  const words = givenName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > SALUTATION_MAX_WORDS) return null;
  // Her sözcük baştan sona ad biçimli olmalı. Yer tutucu sözcük ("Misafir", "Rezervasyon") da burada düşer: `guestFirstNameForPrompt`
  // yer tutucuda `null` döner (ayrı bir yer tutucu kontrolü ölü koddu — mutasyon 09-28).
  for (const w of words) if (guestFirstNameForPrompt(w) !== w) return null;
  const joined = words.join(" ");
  return Array.from(joined).length > SALUTATION_MAX_CHARS ? null : joined;
}

/** Modele giden `{isim}` değeri: anahtar açıkken HİÇBİR ad ("misafirimiz"); kapalıyken bugünkü kural. */
export function modelGuestFirstName(guestIdentifier: string | null | undefined): string {
  if (codeGreetingEnabled()) return GUEST_NAME_FALLBACK;
  return guestFirstNameForPrompt(guestIdentifier) ?? GUEST_NAME_FALLBACK;
}

/**
 * SAKLAMA TEMİZLİĞİ — KODUN SELAM SATIRINDAKİ AD (kurucu kararı 09-30). Kısa adlar ("Su", "Al") gövdenin geri kalanında ARANMAZ
 * ("Su gelmiyor" şikâyeti bozulmasın), ama İLK satır tablodaki adlı selamla ("Merhaba Su,", "Hello Al,") BİREBİR aynıysa o satırdaki
 * ad `mark` ile değiştirilir. Başka satırlara ve başka biçimlere dokunulmaz; eşleşme yoksa gövde bayt bayt aynı.
 */
export function redactNameInCodeGreetingLine(body: string, name: string, mark: string): string {
  const nl = body.indexOf("\n");
  const firstRaw = nl === -1 ? body : body.slice(0, nl);
  const first = firstRaw.trim();
  if (!first || !name) return body;
  for (const lang of Object.keys(GREETINGS) as GreetingLanguage[]) {
    if (first === GREETINGS[lang].named(name)) {
      const at = firstRaw.indexOf(first);
      return body.slice(0, at) + GREETINGS[lang].named(mark) + body.slice(at + first.length);
    }
  }
  return body;
}

/** Selam satırı; dil tabloda yoksa `null` (cevap selamsız başlar). */
export function greetingLine(language: string | null | undefined, name: string | null): string | null {
  if (!isGreetingLanguage(language)) return null;
  const g = GREETINGS[language];
  return name ? g.named(name) : g.nameless;
}

// ---------------------------------------------------------------------------
// MODELİN BAŞTAKİ SELAMI (anahtar açıkken istem "selam yazma" der; model yine de yazarsa). 09-28 inceleme ajanı, çalıştırılarak:
//  · eski kalıp selam sözcüğünden sonra HERHANGİ iki sözcüğü siliyordu → "Günaydın Steakhouse, 5 dakika yürüme mesafesinde." misafire
//    "Merhaba Ana, 5 dakika yürüme mesafesinde." gidiyordu (restoranın adı kayıp; "Selam Pastanesi", "Hola Bar" da);
//  · "¡Hola!", "Good morning!", "Sayın misafirimiz,", "Merhaba, değerli misafirimiz!", noktalamasız "Merhaba⏎", "GÜNAYDIN," ve
//    emoji / kalın yazı / yön işaretiyle başlayan selam silinmiyordu → çift selam; yalnız selamdan ibaret cevaba ikinci selam ekleniyordu.
// Şimdi: selam sözcüğü + KAPALI hitap listesi ("misafirimiz", "there", "[Misafir]", "уважаемый гость"…) + noktalama ya da satır sonu
// SİLİNİR. Selamdan sonra listede olmayan sözcük geliyorsa ("Hi Michael," — misafirin yazdığı başka bir ad; "Günaydın Steakhouse,")
// model zaten selamlamıştır ya da bu içeriktir: cevaba DOKUNULMAZ ve kodun selamı EKLENMEZ (çift selam da içerik kaybı da olmaz).
// "Hello and welcome!" → "Welcome!" (selam + bağlaç silinir). Yalnız cevabın ilk 240 kod birimi; sabit sözcükler + sınırlı tekrar →
// doğrusal. Türkçe "ı / İ" eşleşmeden önce "i"ye indirilir (1:1, uzunluk aynı): "GÜNAYDIN", "İyi günler" de tanınır.
// ---------------------------------------------------------------------------
const GREETING_WORD = String.raw`(?:merhabalar|merhaba|selamlar|selam|iyi[ \t]+(?:günler|akşamlar|sabahlar|geceler)|günaydin|hello|hi|hey|good[ \t]+(?:morning|afternoon|evening|day)|greetings|hallo|guten[ \t]+(?:tag|morgen|abend)|bonjour|bonsoir|salut|hola|buen[oa]s[ \t]+(?:días|dias|tardes|noches)|здравствуйте|привет|добрый[ \t]+(?:день|вечер)|доброе[ \t]+утро|مرحباً|مرحبا|أهلاً|أهلا|السلام[ \t]+عليكم|مساء[ \t]+الخير|صباح[ \t]+الخير)`;
/** Tek başına hitap ("Sayın misafirimiz,", "Dear guest,", "Уважаемый гость!") — kendisi bir selam açılışıdır. */
const HONORIFIC = String.raw`(?:(?:sayin|değerli|degerli|sevgili)[ \t]+misafir(?:lerimiz|imiz|im)?|dear[ \t]+(?:guests?|friends?)|(?:liebe[rs]?|sehr[ \t]+geehrte[rs]?)[ \t]+(?:gast|gäste)|chère?s?[ \t]+(?:client(?:e|s|es)?|invité(?:e|s|es)?|voyageurs?|voyageuses?)|(?:estimad[oa]s?|querid[oa]s?)[ \t]+(?:huésped(?:es)?|clientes?)|(?:уважаем(?:ый|ая|ые)|дорог(?:ой|ая|ие))[ \t]+гост(?:ь|ья|и))`;
/** Selam sözcüğünden sonra gelebilecek KAPALI hitap listesi (model adı görmez; "[Misafir]" bizim gizleme işaretimiz). */
const ADDRESS = String.raw`(?:\[misafir\]|${HONORIFIC}|misafir(?:lerimiz|imiz|im)?|hanimefendi|beyefendi|there|guests?|everyone|all|friends?|بك|بكم)`;
const PICTO = String.raw`[\p{Extended_Pictographic}‍️]`;
const GREETING_PREFIX = String.raw`^[\s‎‏﻿]*[*_]{0,3}(?:${PICTO}{1,8}[ \t]*)?¡?`;
const GREETING_TAIL = String.raw`[*_]{0,3}(?:[ \t]*${PICTO}){0,8}[ \t]*(?:\r?\n[ \t]*)*`;
const KNOWN_GREETING = new RegExp(
  String.raw`${GREETING_PREFIX}(?:${GREETING_WORD}(?:[ \t]*(?:,[ \t]*)?${ADDRESS})?|${HONORIFIC})[ \t]*(?:[,!.،؛:]{1,3}|(?=\r?\n))${GREETING_TAIL}`,
  "iu",
);
/** Yalnız selamdan ibaret cevap ("Merhaba", "Hi there 👋") — noktalamasız da. */
const ONLY_GREETING = new RegExp(
  String.raw`${GREETING_PREFIX}(?:${GREETING_WORD}(?:[ \t]*(?:,[ \t]*)?${ADDRESS})?|${HONORIFIC})[ \t]*[,!.،؛:]{0,3}${GREETING_TAIL}\s*$`,
  "iu",
);
/** "Hello and welcome!", "Merhaba ve hoş geldiniz!" — selam + bağlaç silinir, gerisi kalır. */
const GREETING_AND = new RegExp(String.raw`${GREETING_PREFIX}${GREETING_WORD}[ \t]+(?:and|ve|und|et|y|и)[ \t]+`, "iu");
/** Selam sözcüğü + listede OLMAYAN en çok iki sözcük + noktalama: model başka birini selamlamış ya da içerik ("Günaydın Steakhouse,"). */
const OTHER_GREETING = new RegExp(String.raw`${GREETING_PREFIX}${GREETING_WORD}(?:[ \t]+[^\s,!.،؛:]{1,30}){1,2}[ \t]*[,!.،؛:]`, "iu");
const GREETING_SCAN = 240;

type LeadingGreeting = { kind: "none" } | { kind: "known"; rest: string } | { kind: "other" } | { kind: "only" };

function leadingGreeting(reply: string): LeadingGreeting {
  const head = reply.slice(0, GREETING_SCAN).replace(/[ıİ]/g, "i");
  if (reply.length <= GREETING_SCAN && ONLY_GREETING.test(head)) return { kind: "only" };
  const m = KNOWN_GREETING.exec(head) ?? GREETING_AND.exec(head);
  if (m) {
    const rest = reply.slice(m[0].length);
    return rest.trim() ? { kind: "known", rest } : { kind: "only" };
  }
  return OTHER_GREETING.test(head) ? { kind: "other" } : { kind: "none" };
}

/**
 * İlk harfi büyütür. Türkçe kuralı ("i" → "İ") dil "tr" ise ya da dil bilinmiyor ve metin Türkçeye özgü harf taşıyorsa (09-28 inceleme:
 * dil belirsizken "iyi ki" → "Iyi ki" oluyordu; İngilizce "it's" → "İt's" olmasın diye yalnız ğ / ı / ş işaretiyle).
 */
function capitalizeFirst(text: string, language: string | null | undefined): string {
  const cps = Array.from(text);
  if (cps.length === 0) return text;
  const turkish = language === "tr" || (!language && /[ğışĞİŞ]/u.test(text));
  const upper = turkish ? cps[0].toLocaleUpperCase("tr") : cps[0].toUpperCase();
  // Tek karaktere büyüyen harf büyütülür; "ß" → "SS" gibi çok karakterli büyük hâlde özgün harf kalır.
  return (Array.from(upper).length === 1 ? upper : cps[0]) + cps.slice(1).join("");
}

/** Baştaki TANINAN selamı siler ve ilk harfi büyütür; tanınmayan selam, selamdan ibaret cevap ve selamsız cevap AYNEN döner. */
export function stripLeadingGreeting(reply: string, language?: string | null): string {
  const g = leadingGreeting(reply);
  return g.kind === "known" ? capitalizeFirst(g.rest, language) : reply;
}

/**
 * Anahtar açıkken modelin cevabını misafire gidecek metne çevirir: baştaki tanınan selam silinir; İLK cevapsa ve ton "short" değilse
 * kodun selam satırı eklenir. Model tanınmayan biriyle selamlaştıysa ya da cevap yalnız selamsa cevaba dokunulmaz, kodun selamı
 * eklenmez (çift selam yok). İlk cevap bilgisi yoksa (tek mesajlık önizleme) ilk cevap sayılır.
 */
export function applyCodeGreeting(opts: {
  reply: string;
  firstReply: boolean;
  tone: string;
  language: string | null | undefined;
  name: string | null;
}): string {
  const g = leadingGreeting(opts.reply);
  if (g.kind === "other" || g.kind === "only") return opts.reply;
  const body = g.kind === "known" ? capitalizeFirst(g.rest, opts.language) : opts.reply;
  if (!opts.firstReply || opts.tone === "short") return body;
  const line = greetingLine(opts.language, opts.name);
  return line ? `${line}\n\n${body}` : body;
}

/**
 * GEÇMİŞTEKİ KODUN SELAM SATIRI (anahtar açıkken): kendi giden mesajlarımızın ilk satırı tablodaki bir dilin adlı ya da adsız selamıyla
 * BİREBİR aynıysa istemdeki geçmişten çıkarılır. Hitap adı 3 karakterden kısaysa ("Su", "Jo") ya da tek / iki karakterlik CJK adsa silme
 * anahtarı olmaz ve her turda modele geri dönerdi (09-28 inceleme). Başka ilk satırlara dokunulmaz; geriye metin kalmıyorsa aynen döner.
 */
export function withoutCodeGreetingLine(body: string, givenName: string | null | undefined): string {
  const nl = body.indexOf("\n");
  const first = (nl === -1 ? body : body.slice(0, nl)).trim();
  const name = salutationNameOf(givenName);
  const isCodeLine = (Object.keys(GREETINGS) as GreetingLanguage[]).some(
    (lang) => first === GREETINGS[lang].nameless || (name !== null && first === GREETINGS[lang].named(name)),
  );
  if (!isCodeLine) return body;
  // Satır sonu yoksa (gövde yalnız selam satırı) `slice(0)` gövdenin kendisidir → aşağıda aynen döner.
  const rest = body.slice(nl + 1).replace(/^(?:[ \t]*\r?\n)+/, "");
  return rest.trim() ? rest : body;
}
