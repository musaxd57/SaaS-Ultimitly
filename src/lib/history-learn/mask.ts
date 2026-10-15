import "server-only";

import { redactDoorCodes } from "@/lib/guest-chat";
import { fenceSafe } from "@/lib/ai/semantic/fence";
import type { LearnPair } from "./pairs";

// ---------------------------------------------------------------------------
// GEÇMİŞTEN ÖĞREN — MODELE GİDEN ÇİFTİN MASKESİ (tasarım §2.2: "misafir adı / telefon / e-posta / kapı kodu modele gitmeden").
//
// 🚨 GENEL REDAKSİYON (`redactSensitive` / `redactForSemanticModel`) BURADA KULLANILMAZ (Opus incelemesi 10-15, ölçüldü): günlük
// redaksiyonu "name: … / password: …" alanını satır sonuna kadar `[REDACTED]`, 6+ haneyi `[NUM]` yapıyor → "WiFi name: Lale_5G
// password: sunny2024" ve "Wi-Fi şifresi 12345678" modele bilgisiz gidiyordu; bu özelliğin İŞİ tam olarak o bilgiyi öğrenmek.
// Bunun yerine HEDEFLİ maske, sıra bilinçli:
//  ① misafir adı → `{isim}` — Türkçe harf aileleri BİR sınıf (i/İ/ı/I, ş/s, ç/c, ğ/g, ö/o, ü/u: "İlker" ↔ "ilker" ↔ "Ilker"); tam ad
//     + ≥3 harfli her parça; yalnız kesme ile ek ("Ayşe'ye") ve sevgi eki ("Ayşeciğim") tanınır — "Deniz" adı "denize" sözcüğünü
//     silmesin diye çıplak ek tanınmaz (kalan risk ↓taslak kapısında ad taraması ile işaretlenir).
//  ② kapı / kutu / giriş kodu DEĞERİ → "(kod gizlendi)" (`redactDoorCodes`, kurucu 10-11). Wi-Fi şifresi GİZLENMEZ.
//  ③ e-posta → `[EMAIL]`; telefon (+ ya da 0 ile başlayan, 10–13 hane) → `[PHONE]`. Tarih / saat / fiyat / 8 haneli şifre dokunulmaz.
//  ④ veri ayracı taklidi silinir (`fenceSafe`) — misafir metni VERİDİR (K10-s).
//  ⑤ EN SON kırpma (maske önce: kırpılan telefon / ad yarısı maskeden kaçmasın).
// ---------------------------------------------------------------------------

/** Çiftte tek tarafın modele giden üst sınırı (karakter). */
export const LEARN_SIDE_MAX_CHARS = 1_500;

/** Türkçe + yaygın aksan aileleri (Opus 10-15: "José" ↔ "Jose"). Aile içindeki her harf aynı sınıfa gider. */
const FAMILIES = ["iİıIíìîïÍÌÎÏ", "şŞsS", "çÇcC", "ğĞgG", "öÖoOóòôõÓÒÔÕ", "üÜuUúùûÚÙÛ", "eEéèêëÉÈÊË", "aAáàâãäÁÀÂÃÄ", "nNñÑ"];
/** Sınıf DIŞINDA kaçış — tire YOK (Opus 10-15 F10: `u` bayrağında sınıf dışı `\-` geçersiz → "Jean-Pierre" bütün okumayı düşürüyordu). */
const esc = (c: string) => c.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
/** Sınıf İÇİNDE kaçış — `]`, `\`, `^`, `-`. */
const escInClass = (c: string) => c.replace(/[\]\\^-]/gu, "\\$&");

/** Bir harf için Türkçe aile + büyük/küçük sınıfı. */
function charClass(c: string): string {
  const fam = FAMILIES.find((f) => f.includes(c));
  if (fam) return `[${escInClass(fam)}]`;
  const lo = c.toLocaleLowerCase("tr");
  const up = c.toLocaleUpperCase("tr");
  const set = new Set([c, lo, up, c.toLowerCase(), c.toUpperCase()]);
  return set.size === 1 ? esc(c) : `[${[...set].map(escInClass).join("")}]`;
}

/** Sevgi / hitap ekleri (bitişik): Ayşeciğim, Mehmetcim. Çıplak çekim eki bilerek YOK (↑①). */
const ENDEARMENT = "(?:c[iıuü]ğ[iıuü]m|ç[iıuü]ğ[iıuü]m|c[iıuü]m|ç[iıuü]m)?";

/** Derlenmiş ad kalıbı önbelleği (Opus 10-15: kapı her çağrıda yeniden derliyordu — 1000 ad × 300 taslak ≈ 26 sn CPU). */
const NAME_RE_CACHE = new Map<string, RegExp>();
const NAME_RE_CACHE_MAX = 5_000;

/**
 * Adın derlenmiş kalıbı (GLOBAL bayraklı) — yalnız `replace` / `search` ile kullanılır (ikisi de `lastIndex`'i yok sayar / sıfırlar;
 * `test` / `exec` DURUMLUDUR, kullanılmaz).
 */
export function namePattern(name: string): RegExp {
  const hit = NAME_RE_CACHE.get(name);
  if (hit) return hit;
  // Derlenemeyen ad (beklenmeyen karakter) okumayı DÜŞÜRMEZ: düz harf kaçışıyla yeniden denenir, o da olmazsa eşleşmeyen kalıp.
  let re: RegExp;
  try {
    re = buildNamePattern(name);
  } catch {
    try {
      re = new RegExp(`(?<![\\p{L}\\p{N}])${name.trim().replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?![\\p{L}\\p{N}])`, "giu");
    } catch {
      re = /(?!)/gu;
    }
  }
  if (NAME_RE_CACHE.size >= NAME_RE_CACHE_MAX) NAME_RE_CACHE.clear();
  NAME_RE_CACHE.set(name, re);
  return re;
}

function buildNamePattern(name: string): RegExp {
  const parts = name.trim().split(/\s+/u).filter(Boolean);
  const alts: string[] = [];
  const word = (w: string) => [...w].map(charClass).join("");
  if (parts.length > 1 && parts.join(" ").length >= 3) alts.push(parts.map(word).join("\\s+"));
  for (const p of parts) if ([...p].length >= 3) alts.push(word(p));
  if (!alts.length) return /(?!)/u;
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts.join("|")})${ENDEARMENT}(?![\\p{L}\\p{N}])`, "gu");
}

/** Bir ya da birden çok ad (rezervasyon adı + görünen misafir kimliği + gönderen adı — Opus 10-15 B2). */
export type GuestNames = string | readonly string[] | null | undefined;

export function maskName(text: string, guestNames: GuestNames): string {
  const list = (typeof guestNames === "string" ? [guestNames] : (guestNames ?? [])).filter((n) => n?.trim());
  // Uzun ad önce ("Ayşe Yılmaz" tam ad, sonra "Ayşe") — kısa ad uzunun parçasını yarım bırakmasın.
  return [...list].sort((a, b) => b.length - a.length).reduce((t, n) => t.replace(namePattern(n), "{isim}"), text);
}

const EMAIL_RE = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,24}/gu;
/** Telefon: + ya da 0 ile başlar, ayraçlı olabilir; 10–13 hane. Saat / tarih / fiyat / 8 haneli şifre bu biçime girmez. */
const PHONE_RE = /(?<![\d\p{L}])(?:\+\d|0)[\d\s().-]{8,20}\d(?![\d\p{L}])/gu;
/**
 * Başında 0 / + OLMAYAN Türkiye cep telefonu (Opus 10-15 B1: "numaram 532 123 45 67", "90 532 123 45 67" açıkta gidiyordu):
 * isteğe bağlı 90 + 5xx + 7 hane, ayraçlı. 10 haneli ve 5 ile başlayan sayısal Wi-Fi şifresi de maskelenir — taslak `needs_edit`
 * işaretiyle ev sahibine gider (fazla maske güvenli yön).
 */
const TR_MOBILE_RE = /(?<![\d\p{L}])(?:90[\s.-]?)?(?:5\d{2}|\(5\d{2}\))[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}(?![\d\p{L}])/gu;

/** IBAN (TR ve yabancı, ayraçlı / küçük harfli yazım dahil; en az 10 hane şartı) ve 11 haneli TC kimlik (KONTROL HANELİ — Opus 10-15 F18). */
const IBAN_RE = /(?<![\p{L}\d])[A-Za-z]{2}\d{2}(?:[\s-]?[A-Za-z0-9]{4}){3,7}(?:[\s-]?[A-Za-z0-9]{1,4})?(?![\p{L}\d])/gu;
const TC_ID_RE = /(?<![\d])[1-9]\d{10}(?![\d])/gu;
/** TC kimlik numarası algoritması — rastgele 11 haneli sayıların (rezervasyon no, Wi-Fi anahtarı) ~%99'u geçmez (Haiku 10-15). */
export function isTcKimlik(s: string): boolean {
  if (!/^[1-9]\d{10}$/u.test(s)) return false;
  const d = [...s].map(Number);
  const odd = d[0] + d[2] + d[4] + d[6] + d[8];
  const even = d[1] + d[3] + d[5] + d[7];
  if ((((odd * 7 - even) % 10) + 10) % 10 !== d[9]) return false;
  return d.slice(0, 10).reduce((a, b) => a + b, 0) % 10 === d[10];
}

/**
 * KAPI KODU — RAKAM OLMAYAN DEĞER (Opus 10-15 F17; kurucu 10-11 "geçmişte kodu gizle"): `redactDoorCodes` yalnız 4–8 haneyi gizler;
 * "Kapı şifresi KILIT", "kutu kodu dört beş dokuz sıfır", "keybox: A1B2" modele gidiyordu. Kapı / kutu / tuş paneli + kod / şifre
 * sözcüğünden SONRAKİ en çok 6 sözcükten "kod benzeri" olanlar "(kod gizlendi)" olur; "Kutu kodu giriş günü sabah mesajla
 * gönderilir" gibi düz anlatım DOKUNULMAZ. Eşleşme Türkçe küçük harfe çevrilmiş kopyada aranır ("GİRİŞ KODU" — `i` bayrağı İ'yi
 * katlamaz), değiştirme özgün metinde aynı konumda (tr küçük harf 1:1). Doğrusal: sözcük sözcük.
 */
const DOOR_WORD_SRC =
  "(?<![\\p{L}])(?:(?:kap[ıi]|kutu|anahtar\\s+kutusu|keybox|key\\s*box|lock\\s*box|lockbox|keypad|tu[şs]\\s+paneli|door|gate|giri[şs]|kilit|ak[ıi]ll[ıi]\\s+kilit|smart\\s+lock)[\\p{L}]{0,8}\\s{0,3}(?:kod|[şs]ifre|code|pin|password|passcode)[\\p{L}]{0,6}|keybox|key\\s*box|lock\\s*box|lockbox|keypad)";
// Değer kuyruğu BELİRSİZLİKSİZ: sözcük + (tek ayraç + sözcük){0,5} — bir sözcük iki parçaya bölünemez (karesel iş yok).
const DOOR_VALUE_RE = new RegExp(`${DOOR_WORD_SRC}[\\s:=-]{0,3}([^\\s.,;!?]+(?:[ \\t][^\\s.,;!?]+){0,5})`, "gu");
const DIGIT_WORDS = new Set([
  "sıfır", "sifir", "bir", "iki", "üç", "uc", "üc", "dört", "dort", "beş", "bes", "altı", "alti", "yedi", "sekiz", "dokuz",
  "on", "yirmi", "otuz", "kırk", "kirk", "elli", "altmış", "altmis", "yetmiş", "yetmis", "seksen", "doksan", "yüz", "yuz", "bin",
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "twenty", "thirty", "forty", "fifty",
  "sixty", "seventy", "eighty", "ninety", "hundred",
]);
const digitWord = (w: string) => w.split(/[-–]/u).every((p) => p !== "" && DIGIT_WORDS.has(p.toLocaleLowerCase("tr").replace(/[^\p{L}]/gu, "")));
/**
 * Kod benzeri sözcük: ≥3 rakam, harf + rakam karışık, # * gibi işaret ya da en az 4 harfli TAMAMI büyük harf ("KILIT"; metnin geneli
 * büyük harfle yazılmışsa bu son kural kapanır — "KAPI KODU GİRİŞ GÜNÜ" düz anlatımdır).
 */
function isCodeLike(w: string, shouting: boolean): boolean {
  const digits = (w.match(/\d/gu) ?? []).length;
  if (digits >= 3 || (digits >= 1 && /\p{L}/u.test(w))) return true;
  if (/[#*@&$%+=_]/u.test(w)) return true;
  return !shouting && /^\p{Lu}{4,}$/u.test(w.replace(/[^\p{L}]/gu, "")) && w === w.toLocaleUpperCase("tr");
}
function maskDoorValues(text: string): string {
  const lower = text.toLocaleLowerCase("tr");
  if (lower.length !== text.length) return text; // tr küçük harf 1:1 değilse (beklenmez) dokunma — redactDoorCodes yine koştu
  const letters = text.replace(/[^\p{L}]/gu, "");
  const shouting = letters.length >= 12 && letters.replace(/[^\p{Lu}]/gu, "").length / letters.length > 0.6;
  let out = "";
  let last = 0;
  for (const m of lower.matchAll(DOOR_VALUE_RE)) {
    const start = m.index ?? 0;
    const full = text.slice(start, start + m[0].length);
    const tail = text.slice(start + m[0].length - m[1].length, start + m[0].length);
    const words = tail.split(/[ \t]/u);
    let hide = 0;
    let run = 0;
    while (run < words.length && digitWord(words[run])) run += 1;
    const spelledDigits = words.slice(0, run).reduce((n, w) => n + w.split(/[-–]/u).length, 0);
    if (spelledDigits >= 3) hide = run;
    if (!hide) while (hide < words.length && isCodeLike(words[hide], shouting)) hide += 1;
    // Tek sözcüklük değer, büyük harfle başlıyor ve ardından cümle bitiyor: "Kapı şifresi Lale." (ad değil parola).
    if (!hide && words.length === 1 && /^\p{Lu}/u.test(words[0])) hide = 1;
    if (!hide) continue;
    const head = full.slice(0, full.length - tail.length);
    const kept = words.slice(hide).join(" ");
    out += text.slice(last, start) + `${head}(kod gizlendi)${kept ? ` ${kept}` : ""}`;
    last = start + m[0].length;
  }
  return last === 0 ? text : out + text.slice(last);
}

function maskContacts(text: string): string {
  return text
    .replace(EMAIL_RE, "[EMAIL]")
    .replace(PHONE_RE, (m) => {
      const digits = m.replace(/\D/gu, "").length;
      return digits >= 10 && digits <= 15 ? "[PHONE]" : m;
    })
    .replace(TR_MOBILE_RE, "[PHONE]")
    .replace(IBAN_RE, (m) => ((m.match(/\d/gu) ?? []).length >= 10 ? "[IBAN]" : m))
    .replace(TC_ID_RE, (m) => (isTcKimlik(m) ? "[ID]" : m));
}

const clip = (s: string) => (s.length > LEARN_SIDE_MAX_CHARS ? `${s.slice(0, LEARN_SIDE_MAX_CHARS)} …` : s);

export function maskForLearning(text: string, guestNames: GuestNames): string {
  return clip(fenceSafe(maskContacts(maskDoorValues(redactDoorCodes(maskName(text, guestNames))))));
}

export interface MaskedPair {
  /** Çift numarası (1'den; yeni → eski) — modelin kanıt göstermesi bu numarayla. */
  n: number;
  conversationId: string;
  /** Cevap ayı (YYYY-MM) — "en yeni bilgi" kararı için; gün / saat taşınmaz. */
  month: string;
  question: string;
  answer: string;
}

export function maskPairs(
  pairs: readonly LearnPair[],
  guestNameByConversation: Readonly<Record<string, GuestNames>>,
): MaskedPair[] {
  return pairs.map((p, i) => ({
    n: i + 1,
    conversationId: p.conversationId,
    month: p.answeredAt.toISOString().slice(0, 7),
    question: maskForLearning(p.question, guestNameByConversation[p.conversationId]),
    answer: maskForLearning(p.answer, guestNameByConversation[p.conversationId]),
  }));
}
