// ---------------------------------------------------------------------------
// DOĞRULANMIŞ ERKEN GİRİŞ — METİN ÇAPRAZ KONTROLLERİ (09-24, güvenlik incelemesi). Saf; YALNIZ otomatik gönderimi
// ENGELLER (taslak yine hazırlanır), hiçbir şeyi onaylatmaz. Kelime ağı büyütmesi değildir: karar anlama katmanında
// ve kodda kalır; bu iki kontrol modellerin ortak yanılgısına karşı deterministik bir ikinci bakıştır.
//
//  · `time_mismatch_text`: "iki bağımsız model" aynı modelin iki çağrısıdır (`semanticModel()`); ortak bir yanlış okuma
//    `sources: 2` sayılırdı. Misafirin KENDİ yazdığı açık saatler onaylanacak saatle eşleşmeli: hiç açık saat yoksa ya
//    da BAŞKA bir saat de geçiyorsa (uçak iniş saati, bavul saati…) otomatik gönderim yok.
//  · `day_unverified`: varış günü gelen "YARIN 12'de" mesajı "bugün 12:00" onayı almasın. Bugünden başka bir güne işaret
//    (yarın, hafta günü, tarih) varsa otomatik gönderim yok. Bugünü adlandıran hafta günü / tarih engel sayılmaz.
// ---------------------------------------------------------------------------

import { dateKeyInTimeZone } from "@/lib/timezone";

const H = String.raw`([01]?\d|2[0-3])`;
/** Unicode sözcük başı/sonu (JS `\b` yalnız ASCII'dir: "öbür", "çarşamba", Kiril sözcükleri `\b` ile HİÇ eşleşmez). */
const WB = String.raw`(?<![\p{L}\p{N}_])`;
const WE = String.raw`(?![\p{L}\p{N}_])`;
const MM = String.raw`([0-5]\d)`;

/** Bir saat anının adayları (gün içi dakika). 12'den küçük çıplak saat öğleden sonrası da olabilir ("2'de" = 14:00). */
function bareHour(h: number): number[] {
  return h < 12 && h > 0 ? [h * 60, (h + 12) * 60] : [h * 60];
}

function ampm(h: number, mm: number, marker: string): number[] {
  const pm = /^p/.test(marker);
  const hh = h % 12 + (pm ? 12 : 0);
  return [hh * 60 + mm];
}

/**
 * Metindeki AÇIK saat anmaları — her anma için aday dakikalar. Yalnız saat biçimleri (SS:DD / SS.DD, am/pm, "saat N",
 * "N'de / N gibi", "at N", "um N Uhr", "Nh", "a las N", "в N", "الساعة N"); "2 kişi", "3 gece", "14 Ekim" saat değildir.
 */
export function explicitTimeMentions(text: string): number[][] {
  const t = ` ${text.normalize("NFKC").toLowerCase().replace(/[’`]/g, "'")} `;
  const out: number[][] = [];
  const taken: Array<[number, number]> = [];
  const add = (start: number, end: number, cands: number[]) => {
    if (taken.some(([s, e]) => start < e && end > s)) return;
    taken.push([start, end]);
    out.push(cands);
  };
  const scan = (re: RegExp, fn: (m: RegExpExecArray) => number[] | null) => {
    for (const m of t.matchAll(re)) {
      const cands = fn(m as RegExpExecArray);
      if (cands && m.index !== undefined) add(m.index, m.index + m[0].length, cands);
    }
  };
  // Öncelik sırası: dakikalı biçimler önce (üst üste binen daha genel eşleşme alınmaz).
  scan(new RegExp(String.raw`(?<![\d.:])${H}[:.]${MM}\s*(a\.?m\.?|p\.?m\.?)?(?![\d])`, "gu"), (m) => {
    const h = Number(m[1]);
    const mm = Number(m[2]);
    return m[3] ? ampm(h, mm, m[3]) : [h * 60 + mm];
  });
  scan(new RegExp(String.raw`(?<![\d.:])${H}\s*(a\.?m\.?|p\.?m\.?)(?![a-z])`, "gu"), (m) => ampm(Number(m[1]), 0, m[2]));
  scan(new RegExp(String.raw`(?<![\d.:])${H}\s*h\s*${MM}?(?![a-z\d])`, "gu"), (m) => [Number(m[1]) * 60 + (m[2] ? Number(m[2]) : 0)]);
  scan(new RegExp(String.raw`(?<![\d.:])${H}\s*uhr\b`, "gu"), (m) => [Number(m[1]) * 60]);
  scan(new RegExp(String.raw`${WB}(?:saat|at|around|by|um|gegen|ab|vers|las|в)\s+${H}(?![\d:.])`, "gu"), (m) => bareHour(Number(m[1])));
  scan(new RegExp(String.raw`(?<![\d.:])${H}\s*(?:'\s*)?(?:de|da|te|ta)(?![a-zçğıöşü])`, "gu"), (m) => bareHour(Number(m[1])));
  scan(new RegExp(String.raw`(?<![\d.:])${H}\s+(?:gibi|civarı|civari|sularında|sularinda)`, "gu"), (m) => bareHour(Number(m[1])));
  scan(new RegExp(String.raw`الساعة\s*([0-9٠-٩]{1,2})`, "gu"), (m) => {
    const h = Number(m[1].replace(/[٠-٩]/g, (c) => String("٠١٢٣٤٥٦٧٨٩".indexOf(c))));
    return h >= 0 && h < 24 ? bareHour(h) : null;
  });
  return out;
}

/** "HH:MM" → gün içi dakika. */
function minutesOf(hhmm: string): number | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(hhmm.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * Otomatik gönderimi engeller mi: cevapsız mesajlarda açık saat YOK ya da onaylanacak saatle eşleşmeyen bir açık saat VAR.
 */
export function timeMismatchInTexts(texts: readonly string[], approvedTime: string | null): boolean {
  const approved = approvedTime ? minutesOf(approvedTime) : null;
  if (approved === null) return true;
  const mentions = texts.flatMap((x) => explicitTimeMentions(x));
  if (mentions.length === 0) return true;
  return mentions.some((cands) => !cands.includes(approved));
}

const day = (alts: string) => new RegExp(`${WB}(?:${alts})${WE}`, "iu");
const WEEKDAYS: readonly RegExp[] = [
  // Pazar=0 … Cumartesi=6 (JS `getDay` sırası); her dil kendi biçimleriyle. İngilizce kısaltmalardan yalnız başka anlamı
  // olmayanlar (tue/thu/fri); "mon/wed/sat/sun" sıradan sözcüklerle çakışır ("mon mari", "we sat").
  day(String.raw`pazar|sunday|sonntag|dimanche|domingo|воскресень\p{L}*`),
  day(String.raw`pazartesi|monday|montag|lundi|lunes|понедельник\p{L}*`),
  day(String.raw`salı|sali|tuesday|tue|tues|dienstag|mardi|martes|вторник\p{L}*`),
  day(String.raw`çarşamba|carsamba|wednesday|mittwoch|mercredi|miércoles|miercoles|сред[аыу]`),
  day(String.raw`perşembe|persembe|thursday|thu|thur|thurs|donnerstag|jeudi|jueves|четверг\p{L}*`),
  day(String.raw`cuma|friday|fri|freitag|vendredi|viernes|пятниц\p{L}*`),
  day(String.raw`cumartesi|saturday|samstag|samedi|sábado|sabado|суббот\p{L}*`),
];
/** Bugünden başka günü GÖRELİ adlandıran sözcükler (bugün/today sayılmaz). */
const OTHER_DAY = new RegExp(
  [
    String.raw`${WB}(?:yarın|yarin|öbür\s*gün|obur\s*gun|ertesi\s*gün|ertesi\s*gun)`,
    String.raw`${WB}(?:tomorrow|day\s+after)${WE}`,
    String.raw`${WB}(?:übermorgen|ubermorgen)${WE}`,
    String.raw`(?<!guten\s)(?<!am\s)${WB}morgen${WE}`,
    String.raw`${WB}(?:demain|après-demain|apres-demain)${WE}`,
    String.raw`(?<!la\s)(?<!esta\s)${WB}mañana${WE}`,
    String.raw`${WB}pasado\s+mañana${WE}`,
    String.raw`${WB}(?:послезавтра|завтра)`,
    String.raw`(?:غدا|غداً|بعد\s+غد)`,
    // Gelecek hafta / N gün sonra (hafta günü adı geçmese de başka gün).
    String.raw`${WB}(?:haftaya|gelecek\s+hafta|önümüzdeki\s+hafta|onumuzdeki\s+hafta)`,
    String.raw`${WB}(?:next\s+week|nächste[nr]?\s+woche|nachste[nr]?\s+woche|semaine\s+prochaine|pr[óo]xima\s+semana|следующей\s+неделе)`,
    String.raw`${WB}\d{1,2}\s*gün\s*sonra`,
    String.raw`${WB}in\s+\d{1,2}\s+days${WE}`,
  ].join("|"),
  "iu",
);
// Regex parçaları. Rusça ay adları çekimlidir ("октября") → kök + harfler.
const MONTHS: ReadonlyArray<readonly string[]> = [
  ["ocak", "january", "jan", "januar", "janvier", "enero", "январ\\p{L}*"],
  ["şubat", "subat", "february", "feb", "februar", "février", "fevrier", "febrero", "феврал\\p{L}*"],
  ["mart", "march", "mar", "märz", "marz", "mars", "marzo", "март\\p{L}*"],
  ["nisan", "april", "apr", "avril", "abril", "апрел\\p{L}*"],
  ["mayıs", "mayis", "may", "mai", "mayo", "ма[йя]"],
  ["haziran", "june", "jun", "juni", "juin", "junio", "июн\\p{L}*"],
  ["temmuz", "july", "jul", "juli", "juillet", "julio", "июл\\p{L}*"],
  ["ağustos", "agustos", "august", "aug", "août", "aout", "agosto", "август\\p{L}*"],
  ["eylül", "eylul", "september", "sep", "sept", "septembre", "septiembre", "сентябр\\p{L}*"],
  ["ekim", "october", "oct", "oktober", "octobre", "octubre", "октябр\\p{L}*"],
  ["kasım", "kasim", "november", "nov", "novembre", "noviembre", "ноябр\\p{L}*"],
  ["aralık", "aralik", "december", "dec", "dezember", "décembre", "decembre", "diciembre", "декабр\\p{L}*"],
];

/** Bugünü (mülk dilimi) adlandırmayan bir gün anması var mı. */
export function mentionsAnotherDay(texts: readonly string[], now: Date, timeZone: string): boolean {
  const [y, mo, d] = dateKeyInTimeZone(now, timeZone).split("-").map(Number);
  const todayDow = new Date(Date.UTC(y, mo - 1, d, 12)).getUTCDay();
  for (const raw of texts) {
    const t = raw.normalize("NFKC").toLowerCase();
    if (OTHER_DAY.test(t)) return true;
    for (let dow = 0; dow < 7; dow++) if (dow !== todayDow && WEEKDAYS[dow].test(t)) return true;
    // "14 Ekim" / "14 de octubre" / "Ekim 14" / "14th" / "14.10" / "14/10": bugünse engel değil.
    for (let mi = 0; mi < 12; mi++) {
      const names = MONTHS[mi].join("|");
      for (const m of t.matchAll(new RegExp(String.raw`(?<!\d)(\d{1,2})\.?\s*(?:de\s+)?(?:${names})${WE}|${WB}(?:${names})\s+(\d{1,2})(?!\d)`, "giu"))) {
        const day = Number(m[1] ?? m[2]);
        if (!(day === d && mi + 1 === mo)) return true;
      }
    }
    for (const m of t.matchAll(/(?<![\d:.])(\d{1,2})(?:st|nd|rd|th)(?![\p{L}])/giu)) if (Number(m[1]) !== d) return true;
    for (const m of t.matchAll(/(?<![\d:.])(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?(?![\d:])/gu)) {
      const dd = Number(m[1]);
      const mm = Number(m[2]);
      // "12.30" gibi saat (ay > 12) tarih değildir; tarih biçimi bugünü göstermiyorsa engel.
      if (mm < 1 || mm > 12 || dd < 1 || dd > 31) continue;
      if (!(dd === d && mm === mo)) return true;
    }
  }
  return false;
}
