// ---------------------------------------------------------------------------
// ADSIZ YAPAY ZEKÂ + KODLA SELAM (K10-o "D", kurucu onayı 09-28; anahtar `AI_CODE_GREETING_ENABLED`, VARSAYILAN KAPALI).
//
// Misafirin adı MİSAFİRİN metnidir (sağlayıcıdaki görünen ad): istemin "rezervasyon" bölümünde güvenilir olgu gibi duruyordu
// ("Ada Otopark Ücretsiz" gibi bir ad talimat taşıyabilir) ve her cevapta soyadıyla modele gidiyordu. Anahtar açıkken:
//   · model adı GÖRMEZ (istem rezervasyon satırı, bilgi tabanı `{isim}` → "misafirimiz", geçmişte ad → "[Misafir]"),
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

/** Selam satırı; dil tabloda yoksa `null` (cevap selamsız başlar). */
export function greetingLine(language: string | null | undefined, name: string | null): string | null {
  if (!isGreetingLanguage(language)) return null;
  const g = GREETINGS[language];
  return name ? g.named(name) : g.nameless;
}

/**
 * Cevabın BAŞINDAKİ selam kalıbı (model anahtar açıkken de selam yazarsa): selam sözcüğü + en çok iki sözcük (ad / "there" /
 * "misafirimiz") + noktalama. Yalnız cevabın başı; sınırlı tekrar → doğrusal. Selamdan sonra metin kalmıyorsa silinmez.
 */
const LEADING_GREETING =
  /^\s*(?:merhabalar|merhaba|selamlar|selam|iyi günler|İyi günler|iyi akşamlar|İyi akşamlar|günaydın|hello|hi|hey|dear|hallo|guten tag|guten abend|guten morgen|bonjour|bonsoir|salut|hola|buenos días|buenas tardes|здравствуйте|привет|добрый день|добрый вечер|مرحباً|مرحبا|أهلاً|أهلا)(?:[ \t]+[^\s,!.،]{1,30}){0,2}[ \t]*[,!.،][ \t]*(?:\r?\n[ \t]*)*/iu;

/** Baştaki selamı siler; silindiyse ilk harfi dilin kuralıyla büyütür (Türkçe "i" → "İ"). */
export function stripLeadingGreeting(reply: string, language?: string | null): string {
  const m = LEADING_GREETING.exec(reply);
  if (!m) return reply;
  const rest = reply.slice(m[0].length);
  if (!rest.trim()) return reply;
  const cps = Array.from(rest);
  const upper = language === "tr" ? cps[0].toLocaleUpperCase("tr") : cps[0].toUpperCase();
  // Tek karaktere büyüyen harf büyütülür; "ß" → "SS" gibi çok karakterli büyük hâlde özgün harf kalır.
  return (Array.from(upper).length === 1 ? upper : cps[0]) + cps.slice(1).join("");
}

/**
 * Anahtar açıkken modelin cevabını misafire gidecek metne çevirir: baştaki selam silinir; İLK cevapsa ve ton "short" değilse
 * kodun selam satırı eklenir. İlk cevap bilgisi yoksa (tek mesajlık önizleme) ilk cevap sayılır.
 */
export function applyCodeGreeting(opts: {
  reply: string;
  firstReply: boolean;
  tone: string;
  language: string | null | undefined;
  name: string | null;
}): string {
  const body = stripLeadingGreeting(opts.reply, opts.language);
  if (!opts.firstReply || opts.tone === "short") return body;
  const line = greetingLine(opts.language, opts.name);
  return line ? `${line}\n\n${body}` : body;
}
