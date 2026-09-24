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
// Yanlış alarm yalnız otomatik gönderimi durdurur (host tek tıkla gönderir); kaçırılan başka gün ise yanlış günün
// onayını gönderir — kurallar bu yüzden kapsayıcı yazılır (09-24 inceleme: ekli Türkçe adlar, büyük İ, Arapça hareke).
// ---------------------------------------------------------------------------

import { dateKeyInTimeZone } from "@/lib/timezone";

const H = String.raw`([01]?\d|2[0-3])`;
/** Unicode sözcük başı/sonu (JS `\b` yalnız ASCII'dir: "öbür", "çarşamba", Kiril sözcükleri `\b` ile HİÇ eşleşmez). */
const WB = String.raw`(?<![\p{L}\p{N}_])`;
const WE = String.raw`(?![\p{L}\p{N}_])`;
const MM = String.raw`([0-5]\d)`;

/**
 * Karşılaştırma biçimi: NFKC + küçük harf + birleşen nokta (U+0307: "İ".toLowerCase() = "i̇") + Arapça harekeler
 * (tenvin "غدًا" ↔ "غدا"). Türkçe büyük "I" ASCII "i" olur — listeler ASCII eşlerini de taşır.
 */
function fold(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\u0307/g, "")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[’`]/g, "'");
}

/** Bir saat anının adayları (gün içi dakika). 12'den küçük çıplak saat öğleden sonrası da olabilir ("2'de" = 14:00). */
function atHour(h: number, mm = 0): number[] {
  return h < 12 && h > 0 ? [h * 60 + mm, (h + 12) * 60 + mm] : [h * 60 + mm];
}

function ampm(h: number, mm: number, marker: string): number[] {
  const pm = /^p/.test(marker);
  const hh = h % 12 + (pm ? 12 : 0);
  return [hh * 60 + mm];
}

/**
 * Metindeki AÇIK saat anmaları — her anma için aday dakikalar. Saat biçimleri (SS:DD / SS.DD, am/pm, "saat N", "N'de /
 * N gibi", "at N", "um N Uhr", "N Uhr MM", "Nh", "a las N", "в N", "الساعة N") ve yarım/çeyrek anlatımları ("11 buçuk",
 * "halb 12" = 11:30, "half past 11", "quarter to 12", "12 y media", "11h et demie"). "2 kişi", "3 gece", "14 Ekim" saat
 * değildir. Cümle sonundaki saat ("at 9.") da anmadır.
 */
export function explicitTimeMentions(text: string): number[][] {
  const t = ` ${fold(text)} `;
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
  const hourBefore = (h: number) => (h === 0 ? 23 : h - 1);
  // Öncelik sırası: yarım/çeyrek ve dakikalı biçimler önce (üst üste binen daha genel eşleşme alınmaz).
  scan(new RegExp(String.raw`(?<![\d.:])${H}\s*buçuk`, "gu"), (m) => atHour(Number(m[1]), 30));
  scan(new RegExp(String.raw`${WB}halb\s+${H}${WE}`, "gu"), (m) => atHour(hourBefore(Number(m[1])), 30));
  scan(new RegExp(String.raw`${WB}half\s+past\s+${H}${WE}`, "gu"), (m) => atHour(Number(m[1]), 30));
  scan(new RegExp(String.raw`${WB}quarter\s+past\s+${H}${WE}`, "gu"), (m) => atHour(Number(m[1]), 15));
  scan(new RegExp(String.raw`${WB}quarter\s+to\s+${H}${WE}`, "gu"), (m) => atHour(hourBefore(Number(m[1])), 45));
  scan(new RegExp(String.raw`(?<![\d.:])${H}\s+y\s+media${WE}`, "gu"), (m) => atHour(Number(m[1]), 30));
  scan(new RegExp(String.raw`(?<![\d.:])${H}\s+y\s+cuarto${WE}`, "gu"), (m) => atHour(Number(m[1]), 15));
  scan(new RegExp(String.raw`(?<![\d.:])${H}\s*(?:h|heures?)\s+et\s+demie${WE}`, "gu"), (m) => atHour(Number(m[1]), 30));
  scan(new RegExp(String.raw`(?<![\d.:])${H}\s*(?:h|heures?)\s+et\s+quart${WE}`, "gu"), (m) => atHour(Number(m[1]), 15));
  scan(new RegExp(String.raw`(?<![\d.:])${H}\s*uhr\s+${MM}(?!\d)`, "gu"), (m) => [Number(m[1]) * 60 + Number(m[2])]);
  scan(new RegExp(String.raw`(?<![\d.:])${H}[:.]${MM}\s*(a\.?m\.?|p\.?m\.?)?(?![\d])`, "gu"), (m) => {
    const h = Number(m[1]);
    const mm = Number(m[2]);
    return m[3] ? ampm(h, mm, m[3]) : [h * 60 + mm];
  });
  scan(new RegExp(String.raw`(?<![\d.:])${H}\s*(a\.?m\.?|p\.?m\.?)(?![a-z])`, "gu"), (m) => ampm(Number(m[1]), 0, m[2]));
  scan(new RegExp(String.raw`(?<![\d.:])${H}\s*h\s*${MM}?(?![a-z\d])`, "gu"), (m) => [Number(m[1]) * 60 + (m[2] ? Number(m[2]) : 0)]);
  scan(new RegExp(String.raw`(?<![\d.:])${H}\s*uhr${WE}`, "gu"), (m) => [Number(m[1]) * 60]);
  // Nokta ardından RAKAM gelmiyorsa cümle sonudur ("at 9." / "saat 10.") — saat anması sayılır.
  scan(new RegExp(String.raw`${WB}(?:saat|at|around|by|um|gegen|ab|vers|las|в)\s+${H}(?![\d:]|\.\d)`, "gu"), (m) => atHour(Number(m[1])));
  scan(new RegExp(String.raw`(?<![\d.:])${H}\s*(?:'\s*)?(?:de|da|te|ta)(?![a-zçğıöşü])`, "gu"), (m) => atHour(Number(m[1])));
  scan(new RegExp(String.raw`(?<![\d.:])${H}\s+(?:gibi|civarı|civari|sularında|sularinda)`, "gu"), (m) => atHour(Number(m[1])));
  scan(new RegExp(String.raw`الساعة\s*([0-9٠-٩]{1,2})`, "gu"), (m) => {
    const h = Number(m[1].replace(/[٠-٩]/g, (c) => String("٠١٢٣٤٥٦٧٨٩".indexOf(c))));
    return h >= 0 && h < 24 ? atHour(h) : null;
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

// ─── gün ─────────────────────────────────────────────────────────────────────

/**
 * Hafta günü adları (Pazar=0 … Cumartesi=6, JS `getDay` sırası). `tr`: Türkçe ad + en fazla 5 harf ek ("cumartesiye",
 * "cumaya"); aynı sözcüğe uyan EN UZUN ad kazanır ("cumartesi" ≠ "cuma", "pazartesi" ≠ "pazar"). `stem`: Rusça çekimli
 * kök ("среди"/"средство" yanlış eşleşmesin diye çarşamba tam biçimlerle). `ar`: Arapça, belirli harf "ال" ile (+ tek
 * harfli ön ek و/ب/ف/ل). Diğerleri tam sözcük. İngilizce kısaltmalardan
 * yalnız başka anlamı olmayanlar (tue/thu/fri); "mon/wed/sat/sun" sıradan sözcüklerle çakışır.
 */
type DayName = { dow: number; name: string; mode: "exact" | "tr" | "stem" | "ar" };
const DAY_NAMES: readonly DayName[] = (
  [
    [0, "tr", ["pazar"]],
    [0, "exact", ["sunday", "sonntag", "dimanche", "domingo"]],
    [0, "stem", ["воскресень"]],
    [0, "ar", ["الأحد", "الاحد"]],
    [1, "tr", ["pazartesi"]],
    [1, "exact", ["monday", "montag", "lundi", "lunes"]],
    [1, "stem", ["понедельник"]],
    [1, "ar", ["الاثنين", "الإثنين"]],
    [2, "tr", ["salı", "sali"]],
    [2, "exact", ["tuesday", "tue", "tues", "dienstag", "mardi", "martes"]],
    [2, "stem", ["вторник"]],
    [2, "ar", ["الثلاثاء", "الثلاثا"]],
    [3, "tr", ["çarşamba", "carsamba"]],
    [3, "exact", ["wednesday", "mittwoch", "mercredi", "miércoles", "miercoles"]],
    [3, "exact", ["среда", "среду", "среды"]],
    [3, "ar", ["الأربعاء", "الاربعاء"]],
    [4, "tr", ["perşembe", "persembe"]],
    [4, "exact", ["thursday", "thu", "thur", "thurs", "donnerstag", "jeudi", "jueves"]],
    [4, "stem", ["четверг"]],
    [4, "ar", ["الخميس"]],
    [5, "tr", ["cuma"]],
    [5, "exact", ["friday", "fri", "freitag", "vendredi", "viernes"]],
    [5, "stem", ["пятниц"]],
    [5, "ar", ["الجمعة", "الجمعه"]],
    [6, "tr", ["cumartesi"]],
    [6, "exact", ["saturday", "samstag", "samedi", "sábado", "sabado"]],
    [6, "stem", ["суббот"]],
    [6, "ar", ["السبت"]],
  ] as const
).flatMap(([dow, mode, names]) => names.map((name) => ({ dow, name, mode })));

/** Sözcüğün adlandırdığı hafta günü (yoksa `null`). */
function weekdayOf(word: string): number | null {
  let best: DayName | null = null;
  for (const d of DAY_NAMES) {
    const hit =
      d.mode === "exact"
        ? word === d.name
        : d.mode === "tr"
          ? word.startsWith(d.name) && word.length - d.name.length <= 5
          : d.mode === "stem"
            ? word.startsWith(d.name)
            : word === d.name || (word.length === d.name.length + 1 && /^[وبفل]/.test(word) && word.endsWith(d.name));
    if (hit && (!best || d.name.length > best.name.length)) best = d;
  }
  return best ? best.dow : null;
}

/** "Gelecek / önümüzdeki / next …" + hafta günü = başka gün (bugünün adı olsa bile). */
const NEXT_WORDS = new Set([
  "next",
  "gelecek",
  "önümüzdeki",
  "onumuzdeki",
  "haftaya",
  "prochain",
  "prochaine",
  "nächste",
  "nächsten",
  "nächster",
  "nachste",
  "nachsten",
  "próximo",
  "proximo",
  "próxima",
  "proxima",
  "следующий",
  "следующую",
  "следующей",
  "следующем",
  "следующая",
  "следующее",
]);

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
    // Tam sözcük: "завтрак" (kahvaltı) "завтра" değildir.
    String.raw`${WB}(?:послезавтра|завтра)${WE}`,
    // "غداء" (öğle yemeği) "غدا" değildir; harekeler karşılaştırmadan önce silinir.
    String.raw`غدا(?!ء)`,
    String.raw`بعد\s+غد`,
    // Gelecek hafta / N gün sonra (hafta günü adı geçmese de başka gün).
    String.raw`${WB}(?:haftaya|gelecek\s+hafta|önümüzdeki\s+hafta|onumuzdeki\s+hafta)`,
    String.raw`${WB}(?:next\s+week|nächste[nr]?\s+woche|nachste[nr]?\s+woche|semaine\s+prochaine|pr[óo]xima\s+semana|следующей\s+неделе)`,
    String.raw`${WB}(?:\d{1,2}|bir|iki|üç|uc|dört|dort|beş|bes|birkaç|birkac)\s*gün\s*sonra`,
    String.raw`${WB}in\s+(?:\d{1,2}|a|one|two|three|four|five|a\s+couple\s+of|a\s+few)\s+days?${WE}`,
  ].join("|"),
  "u",
);

/** Ay adları (regex parçaları). Türkçe adlar ek alır ("ekimde"); Rusça çekimli kök; diğerleri tam sözcük. */
const TR_SUFFIX = String.raw`\p{L}{0,5}`;
const MONTHS: ReadonlyArray<readonly string[]> = [
  [`ocak${TR_SUFFIX}`, "january", "jan", "januar", "janvier", "enero", String.raw`январ\p{L}*`],
  [`şubat${TR_SUFFIX}`, `subat${TR_SUFFIX}`, "february", "feb", "februar", "février", "fevrier", "febrero", String.raw`феврал\p{L}*`],
  [`mart${TR_SUFFIX}`, "march", "mar", "märz", "marz", "mars", "marzo", String.raw`март\p{L}*`],
  [`nisan${TR_SUFFIX}`, "april", "apr", "avril", "abril", String.raw`апрел\p{L}*`],
  [`mayıs${TR_SUFFIX}`, `mayis${TR_SUFFIX}`, "may", "mai", "mayo", "ма[йя]"],
  [`haziran${TR_SUFFIX}`, "june", "jun", "juni", "juin", "junio", String.raw`июн\p{L}*`],
  [`temmuz${TR_SUFFIX}`, "july", "jul", "juli", "juillet", "julio", String.raw`июл\p{L}*`],
  [`ağustos${TR_SUFFIX}`, `agustos${TR_SUFFIX}`, "august", "aug", "août", "aout", "agosto", String.raw`август\p{L}*`],
  [`eylül${TR_SUFFIX}`, `eylul${TR_SUFFIX}`, "september", "sep", "sept", "septembre", "septiembre", String.raw`сентябр\p{L}*`],
  [`ekim${TR_SUFFIX}`, "october", "oct", "oktober", "octobre", "octubre", String.raw`октябр\p{L}*`],
  [`kasım${TR_SUFFIX}`, `kasim${TR_SUFFIX}`, "november", "nov", "novembre", "noviembre", String.raw`ноябр\p{L}*`],
  [`aralık${TR_SUFFIX}`, `aralik${TR_SUFFIX}`, "december", "dec", "dezember", "décembre", "decembre", "diciembre", String.raw`декабр\p{L}*`],
];
const MONTH_PATTERNS: readonly RegExp[] = MONTHS.map((names) => {
  const alts = names.join("|");
  return new RegExp(String.raw`(?<!\d)(\d{1,2})\.?\s*(?:de\s+)?(?:${alts})${WE}|${WB}(?:${alts})\s+(\d{1,2})(?!\d)`, "gu");
});

/** Bugünü (mülk dilimi) adlandırmayan bir gün anması var mı. */
export function mentionsAnotherDay(texts: readonly string[], now: Date, timeZone: string): boolean {
  const [y, mo, d] = dateKeyInTimeZone(now, timeZone).split("-").map(Number);
  const todayDow = new Date(Date.UTC(y, mo - 1, d, 12)).getUTCDay();
  const isToday = (dd: number, mm: number) => dd === d && mm === mo;
  for (const raw of texts) {
    const t = fold(raw);
    if (OTHER_DAY.test(t)) return true;
    const words = t.match(/[\p{L}]+/gu) ?? [];
    for (let i = 0; i < words.length; i++) {
      const dow = weekdayOf(words[i]);
      if (dow === null) continue;
      if (dow !== todayDow || (i > 0 && NEXT_WORDS.has(words[i - 1]))) return true;
    }
    // "14 Ekim" / "14 de octubre" / "Ekim 14" / "15 ekimde": bugünse engel değil.
    for (let mi = 0; mi < 12; mi++) {
      for (const m of t.matchAll(MONTH_PATTERNS[mi])) {
        if (!isToday(Number(m[1] ?? m[2]), mi + 1)) return true;
      }
    }
    for (const m of t.matchAll(/(?<![\d:.])(\d{1,2})(?:st|nd|rd|th)(?![\p{L}])/gu)) if (Number(m[1]) !== d) return true;
    // Noktalı tarih GÜN.AY ("14.10"); "12.30" gibi saat (ay > 12) tarih değildir.
    for (const m of t.matchAll(/(?<![\d:.])(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?(?![\d:])/gu)) {
      const dd = Number(m[1]);
      const mm = Number(m[2]);
      if (mm < 1 || mm > 12 || dd < 1 || dd > 31) continue;
      if (!isToday(dd, mm)) return true;
    }
    // Eğik çizgili tarih her iki okumayla (GÜN/AY ve ABD AY/GÜN): geçerli okumalardan HİÇBİRİ bugün değilse başka gün.
    for (const m of t.matchAll(/(?<![\d:./])(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?![\d:])/gu)) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      const readings: [number, number][] = [];
      if (b >= 1 && b <= 12 && a >= 1 && a <= 31) readings.push([a, b]);
      if (a >= 1 && a <= 12 && b >= 1 && b <= 31) readings.push([b, a]);
      if (readings.length > 0 && !readings.some(([dd, mm]) => isToday(dd, mm))) return true;
    }
  }
  return false;
}
