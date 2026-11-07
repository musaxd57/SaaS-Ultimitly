// ---------------------------------------------------------------------------
// GERÇEK MESAJ ÖRNEKLEMİ — saf, tohumlu, tekrarlanabilir (09-24). Operatör betiği kurucunun makinesinde çağırır.
//
// Neden katmanlı örnekleme: rastgele 300 misafir mesajında konaklama değişikliği isteği birkaç düzine çıkar —
// isabet ölçüsü için az. Bu yüzden iki katman: GENİŞ aday katmanı (saat / tarih / konaklama sözcüğü geçen her
// mesaj) + geri kalandan rastgele katman. 🚨 Aday süzgeci ürünün dedektörü DEĞİLDİR ve bilerek ondan bağımsız ve
// çok daha geniştir: ürünün kelime ağıyla seçmek, ölçülecek şeyi ölçüm setine gömmek (kelime ağının kaçırdığı
// dolaylı istekler sete hiç girmezdi) demekti. Katman boyutları çıktıya yazılır (oranlar yeniden ağırlıklanabilir).
// ---------------------------------------------------------------------------

/** Türkçe + aksan katlaması (yalnız süzgeç için; metni DEĞİŞTİRMEZ). */
function fold(s: string): string {
  return s
    .toLocaleLowerCase("tr")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/ı/g, "i");
}

const TIME_CUES: readonly RegExp[] = [
  /\b\d{1,2}[:.]\d{2}\b/u, // 11:00 · 14.30
  /\b\d{1,2}\s*(?:am|pm|a\.m\.|p\.m\.)(?![\p{L}])/iu, // 11am · 3 pm
  /\b(?:saat|sa\.)\s*\d{1,2}\b/iu, // saat 11
  /\b\d{1,2}\s*['’]?\s*(?:de|da|te|ta|e|a|ye|ya)\b/iu, // 12'de · 3'te · 11'e
  /\b\d{1,2}\s+(?:gibi|civari|sularinda|itibariyle|gibisinden)\b/iu, // 11 gibi
  /\b\d{1,2}(?:[./-]\d{1,2}){1,2}\b/u, // 14.10 · 14/10/2026
  /\b(?:at|around|by|until|till|um|vers|a las|к)\s+\d{1,2}\b/iu, // at 11 · um 14 · vers 15
];

/**
 * Konaklama / zaman sözcükleri (katlanmış, ÖNEK eşleşmesi). Bilerek GENİŞ: "gel", "kal", "cik", "gir" gibi kökler
 * pek çok alakasız mesajı da alır — aday katmanı fazla almalı, eksik almamalı.
 */
const STAY_STEMS: readonly string[] = [
  // tr
  "erken", "gec", "uzat", "ekstra", "fazladan", "gece", "gun", "yarin", "bugun", "aksam", "sabah", "ogle", "kal",
  "cik", "gir", "gel", "var", "ulas", "hazir", "temizl", "birak", "bavul", "valiz", "bagaj", "canta", "esya", "musait",
  "bos", "dolu", "rezervasyon", "tarih", "ucus", "ucak", "saat", "check",
  // en
  "early", "late", "extend", "extension", "extra", "another", "more night", "stay", "arriv", "land", "flight", "ready",
  "clean", "luggage", "bag", "drop", "store", "leave", "depart", "available", "availab", "free", "booking", "book",
  "date", "tonight", "tomorrow", "today", "night", "morning", "evening", "noon", "hour", "time",
  // de
  "fruh", "spat", "verlang", "ankunft", "anreise", "abreise", "gepack", "nacht", "morgen", "zimmer", "frei",
  // fr
  "tot", "tard", "prolong", "arrive", "depart", "bagage", "nuit", "demain", "libre", "heure",
  // es
  "temprano", "tarde", "extender", "llegada", "salida", "equipaje", "noche", "manana", "hora", "disponible",
  // ru / ar (kök)
  "рано", "поран", "поздн", "позж", "продл", "заезд", "заех", "выезд", "выех", "остат", "задерж", "багаж", "ноч",
  "завтра", "свобод",
  "مبكر", "متأخر", "تمديد", "وصول", "مغادرة", "ليلة", "غدا", "متاح",
];

const MONTHS_AND_DAYS =
  /\b(?:ocak|subat|mart|nisan|mayis|haziran|temmuz|agustos|eylul|ekim|kasim|aralik|pazartesi|sali|carsamba|persembe|cuma|cumartesi|pazar|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|monday|tuesday|wednesday|thursday|friday|saturday|sunday|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|lunes|martes|miercoles|jueves|viernes|sabado|domingo)/u;

/** GENİŞ aday süzgeci (ürünün dedektöründen bağımsız). */
export function isStayCandidate(text: string): boolean {
  if (TIME_CUES.some((re) => re.test(text))) return true;
  const f = fold(text);
  if (MONTHS_AND_DAYS.test(f)) return true;
  const words = f.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return STAY_STEMS.some((stem) => (stem.includes(" ") ? f.includes(stem) : words.some((w) => w.startsWith(stem))));
}

/** Kaba dil tahmini — yalnız rapordaki dil kırılımı için (karar DEĞİL). */
export function guessLanguage(text: string): string {
  if (/[؀-ۿ]/u.test(text)) return "ar";
  if (/[Ѐ-ӿ]/u.test(text)) return "ru";
  const f = ` ${text.toLocaleLowerCase("tr")} `;
  const has = (words: string[]) => words.some((w) => f.includes(` ${w} `) || f.includes(` ${w}?`) || f.includes(` ${w},`));
  if (/[ığşİ]/u.test(text) || has(["bir", "ve", "mi", "mı", "mu", "mü", "için", "yarın", "merhaba", "teşekkürler", "tesekkurler", "geliriz", "miyiz", "mıyız", "var", "yok", "saat"]))
    return "tr";
  if (/ß/u.test(text) || has(["und", "ich", "wir", "nicht", "bitte", "danke", "können", "koennen", "ist", "das", "der", "die"])) return "de";
  if (has(["nous", "vous", "est", "pour", "merci", "bonjour", "peut", "avec", "le", "la", "les"])) return "fr";
  if (/[ñ¿¡]/u.test(text) || has(["gracias", "hola", "por", "para", "podemos", "el", "los", "las", "una", "que"])) return "es";
  return "en";
}

/** Tekrar ayıklama anahtarı: aynı kısa mesaj ("Thank you!") sete yüz kez girmesin. */
export function dedupeKey(text: string): string {
  return fold(text).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** FNV-1a 32 bit → mulberry32: tohumdan tekrarlanabilir sayı akışı. */
export function seededRandom(seed: string): () => number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleWithout<T>(xs: readonly T[], k: number, rnd: () => number): T[] {
  const a = xs.slice();
  const n = Math.min(k, a.length);
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rnd() * (a.length - i));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

export type Stratum = "candidate" | "rest";

export interface StratifiedSample<T> {
  picked: { item: T; stratum: Stratum }[];
  /** Tekrar ayıklamasından SONRAKİ evren boyutları (yeniden ağırlıklandırma için). */
  population: Record<Stratum, number>;
}

/**
 * Tekrarları ayıklar, iki katmana böler, her katmandan tohumlu rastgele örnek alır. Sonuç sırası da tohumla
 * karıştırılır (etiketleyen katmanı sıradan tahmin edemesin).
 */
export function stratifiedSample<T>(
  items: readonly T[],
  opts: { text: (t: T) => string; candidateQuota: number; restQuota: number; seed: string },
): StratifiedSample<T> {
  const seen = new Set<string>();
  const cand: T[] = [];
  const rest: T[] = [];
  for (const it of items) {
    const key = dedupeKey(opts.text(it));
    if (key.length < 2 || seen.has(key)) continue;
    seen.add(key);
    (isStayCandidate(opts.text(it)) ? cand : rest).push(it);
  }
  const rnd = seededRandom(opts.seed);
  const picked = [
    ...sampleWithout(cand, opts.candidateQuota, rnd).map((item) => ({ item, stratum: "candidate" as const })),
    ...sampleWithout(rest, opts.restQuota, rnd).map((item) => ({ item, stratum: "rest" as const })),
  ];
  return { picked: sampleWithout(picked, picked.length, rnd), population: { candidate: cand.length, rest: rest.length } };
}
