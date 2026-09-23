// ---------------------------------------------------------------------------
// İDDİA DESTEĞİ — deterministik, LLM'siz GÖLGE ölçüm (09-23; "Halüsinasyon kontrolü (MVP)").
//
// Model cevabındaki SOMUT iddiaları (saat, tarih, para, yüzde, kod/şifre, telefon, URL, e-posta,
// birimli miktar, sayı) çıkarır ve her birinin modelin GÖRDÜĞÜ veride (mülk alanları, rezervasyon,
// komşuluk, teklif, üslup rehberi, bilgi tabanı) harfiyen geçip geçmediğini sınıflar:
//   ctx   = yetkili veride var · op = yalnız önceki operatör/AI mesajında · echo = yalnız misafirin
//   yazdığında (OTORİTE DEĞİL) · const = acil numara (112 …) · none = DESTEKSİZ.
//
// 🚨 KARAR DEĞİLDİR. Hiçbir gönderim kararı bu modülü okumaz (mekanik pin: kapı modülleri içe
// aktarmaz). Kaynaksız somut iddiayı ENGELLEMEK (P5) kurucu onayı ister; bu modül o kararın
// ölçümünü üretir. Çıktı PII'SİZ: yalnız sayılar + kapalı-küme sınıf adları (ham değer ASLA).
//
// Ölçüm (09-23 ajan, yeniden üretilebilir batarya): 139 dayanaklı cevapta 0 yanlış alarm; 45
// uydurmanın 43'ü yakalandı; bağımsız ayrık küme (istemin few-shot örnekleri + demo cevapları) 0
// yanlış alarm. KAPSAM SINIRI: yalnız sayısal/kod/iletişim iddiaları — "otopark ücretsiz" gibi
// sözel uydurma GÖRÜNMEZ; `u = 0` "cevap dayanaklı" demek DEĞİLDİR (`n` bu yüzden kaydedilir).
// Yalnız ASCII rakamlar; DE/FR/RU/AR sayı sözcükleri kapsam dışı.
//
// Karşılaştırma KATI: birimli miktar/para AYNI sınıf + normalize değerle eşleşmeli ("5 dakika"
// yalnız 5 dakikayı/300 saniyeyi destekler, "5 kişi"yi değil); kod büyük/küçük harfe duyarlı ve
// telefon/tarih/saat/para içindeki rakam dizisi KOD SAYILMAZ ("0532" telefonun parçasıdır).
// ---------------------------------------------------------------------------

export type ClaimClass =
  | "time"
  | "date"
  | "money"
  | "percent"
  | "code"
  | "phone"
  | "url"
  | "email"
  | "distance"
  | "duration"
  | "people"
  | "floor"
  | "count"
  | "number";

export const CLAIM_CLASSES: readonly ClaimClass[] = [
  "time", "date", "money", "percent", "code", "phone", "url", "email",
  "distance", "duration", "people", "floor", "count", "number",
];

export type SupportKind = "ctx" | "op" | "echo" | "const" | "none";

/** Modelin gördüğü veri, üç yetki düzeyinde (istem kurulurken AYNI değişkenlerden üretilir). */
export interface ClaimContext {
  /** Yetkili VERİ: mülk alanları, rezervasyon + zaman bağlamı, komşuluk, teklif, üslup, KB satırları. */
  facts: string[];
  /** İstem geçmişindeki önceki operatör/AI mesajları (otorite değil ama bizim sözümüz). */
  operator: string[];
  /** Misafirin yazdıkları (güncel mesaj + geçmiş) — OTORİTE DEĞİL. */
  guest: string[];
  /** Kodun türettiği, metinde harfiyen yazmayan sayılar (ör. gece sayısı). */
  derivedNumbers?: number[];
}

/** PII'siz denetim özeti (kanıt JSON'una girer). */
export interface ClaimAudit {
  v: 1;
  /** Çıkarılan iddia sayısı. */
  n: number;
  ctx: number;
  op: number;
  echo: number;
  /** Acil numara gibi dünya sabitleri. */
  k: number;
  /** Desteksiz iddia sayısı. */
  u: number;
  /** Desteksiz iddiaların sınıfları (tekil, sabit sıra). */
  uc: ClaimClass[];
  /** Yalnız misafir metniyle "desteklenen" sınıflar (ör. misafirin tahmin ettiği kodu onaylamak). */
  ec: ClaimClass[];
}

interface Claim {
  cls: ClaimClass;
  keys: string[];
  /** Katı eşleşme için birim-normalize anahtarlar ("duration|s300", "money|TRY|750"). */
  tkeys?: string[];
  /** Yalnız eşleştirme için (kod büyük/küçük harf) — ASLA kaydedilmez. */
  raw: string;
  at: number;
  end: number;
}

// ─── normalizasyon ─────────────────────────────────────────────────────────

/** NFKC + Türkçe küçük harf + ASCII katlama; rakamlar dokunulmaz. */
export function foldForClaims(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/İ/g, "i")
    .replace(/I/g, "ı")
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ç/g, "c")
    .replace(/ğ/g, "g")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/â/g, "a")
    .replace(/î/g, "i")
    .replace(/û/g, "u")
    .replace(/[’‘`´]/g, "'")
    .replace(/[“”«»„]/g, '"')
    .replace(/[–—−]/g, "-");
}

const TR_UNITS: Record<string, number> = { bir: 1, iki: 2, uc: 3, dort: 4, bes: 5, alti: 6, yedi: 7, sekiz: 8, dokuz: 9 };
const TR_TENS: Record<string, number> = { on: 10, yirmi: 20, otuz: 30, kirk: 40, elli: 50, altmis: 60, yetmis: 70, seksen: 80, doksan: 90 };
const EN_SMALL: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11,
  twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const EN_TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60 };
const ORDINALS: Record<string, number> = {
  birinci: 1, ikinci: 2, ucuncu: 3, dorduncu: 4, besinci: 5, altinci: 6, yedinci: 7, sekizinci: 8, dokuzuncu: 9, onuncu: 10,
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
};

const alt = (o: Record<string, number>) =>
  Object.keys(o)
    .sort((a, b) => b.length - a.length)
    .join("|");
const TRU = alt(TR_UNITS);
const TRT = alt(TR_TENS);
const ENS = alt(EN_SMALL);
const ENT = alt(EN_TENS);

/** Sayı SÖZCÜĞÜNÜN önünde durabileceği birim sözcükleri (katlanmış). */
const UNIT_WORDS =
  "(?:dakika|dk|saniye|sn|saat|gun|gece|hafta|km|kilometre|metre|kisi|kisilik|misafir|yetiskin|cocuk|arac|araba|kat|havlu|yatak|oda|banyo|adet|tane|kapsul|anahtar|" +
  "minutes?|mins?|seconds?|hours?|days?|nights?|weeks?|miles?|meters?|metres?|floors?|guests?|people|persons?|adults?|children|kids|towels?|beds?|bedrooms?|rooms?|bathrooms?|cars?|blocks?|steps?|adim)";
/** Bu sözcüklerden SONRA gelen çıplak sayı (sözcüğü) saattir. */
const CLOCK_BEFORE = "(?:saat|sabah|aksam|oglen|ogle|ogleden sonra|gece)";
/** Sayı sözcüğünden sonraki Türkçe hâl eki ("dokuzda", "beste"). */
const TR_SUF = "(?:'?(?:da|de|ta|te|dan|den|tan|ten|a|e|ya|ye|i|u|yi|yu|er|ar|ser|sar)?)";

/**
 * Sayı SÖZCÜKLERİ → rakam.
 *  · bağlam tarafı ("all"): cömert — yalnız desteği GENİŞLETİR. İstisna: Türkçe "on" (=10) ve
 *    İngilizce edatlar ("on the", "onu/ona") → "on" yalnız bileşikte, birimden önce ya da saat
 *    sözcüğünden sonra çevrilir.
 *  · cevap tarafı ("unit"): YALNIZ birimden önce ya da saat sözcüğünden sonra — "bir sorun",
 *    "one of", "just a second" asla sahte iddia olmaz.
 */
function wordsToDigits(f: string, mode: "all" | "unit"): string {
  let s = f;
  if (mode === "all") {
    s = s.replace(/\byarim (saat|dakika)/g, (_m, u: string) => `yarim ${u} (0.5 ${u} / 30 ${u === "saat" ? "dakika" : "saniye"})`);
    s = s.replace(/\bceyrek saat/g, "ceyrek saat (15 dakika)");
    s = s.replace(/\bhalf an hour/g, "half an hour (30 minutes)");
  }
  const unitAfter = `(?=[\\s-]*${UNIT_WORDS})`;
  const clockB = `(?<=\\b${CLOCK_BEFORE}\\s)`;
  const rep = (w: string, trSuffix: boolean, fn: (...g: string[]) => string) => {
    const pats =
      mode === "all"
        ? [`\\b${w}(?=${trSuffix ? TR_SUF : ""}\\b)`]
        : [`\\b${w}${unitAfter}`, `${clockB}${w}(?=${TR_SUF}\\b)`];
    for (const p of pats) s = s.replace(new RegExp(p, "g"), (_m, ...g) => fn(...(g as string[])));
  };
  rep(`(${TRT}) ?(${TRU})`, true, (t, u) => String(TR_TENS[t] + TR_UNITS[u]));
  rep(`(${ENT})[ -](one|two|three|four|five|six|seven|eight|nine)`, false, (t, u) => String(EN_TENS[t] + EN_SMALL[u]));
  s = s.replace(
    new RegExp(`\\b(${alt(ORDINALS)})\\b${mode === "unit" ? "(?=\\s?(?:kat|floor))" : ""}`, "g"),
    (_m, w: string) => `${ORDINALS[w]}.`,
  );
  rep(`(${ENT}|${ENS})`, false, (w) => String(EN_TENS[w] ?? EN_SMALL[w]));
  const trTensNoOn = Object.keys(TR_TENS)
    .filter((k) => k !== "on")
    .join("|");
  rep(`(${trTensNoOn}|${TRU})`, true, (w) => String(TR_TENS[w] ?? TR_UNITS[w]));
  for (const p of [`\\bon${unitAfter}`, `${clockB}on(?=${TR_SUF}\\b)`]) s = s.replace(new RegExp(p, "g"), "10");
  if (mode === "all") {
    s = s.replace(/\b(\d+) ?yuz\b/g, (_m, a: string) => String(Number(a) * 100));
    s = s.replace(/\b(\d+) ?bin\b/g, (_m, a: string) => String(Number(a) * 1000));
  } else {
    s = s.replace(/\b(\d+) bin(?= ?(?:tl|try|lira|₺|euro|eur|avro|dolar|usd|\$))/g, (_m, a: string) => String(Number(a) * 1000));
  }
  return s;
}

// ─── çıkarım ───────────────────────────────────────────────────────────────

const TR_MONTHS: Record<string, number> = {
  ocak: 1, subat: 2, mart: 3, nisan: 4, mayis: 5, haziran: 6, temmuz: 7, agustos: 8, eylul: 9, ekim: 10, kasim: 11, aralik: 12,
};
const EN_MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10,
  november: 11, december: 12, jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const MONTHS = { ...TR_MONTHS, ...EN_MONTHS };

const CURRENCY_AFTER = "(?:tl|try|₺|lira|eur|euros?|avro|€|\\$|usd|dolar|dollars?|£|gbp|sterlin|pounds?)";
const CURRENCY_BEFORE = "(?:₺|\\$|€|£|tl|eur|usd|try)";
const NUM = "(?:\\d{1,3}(?:[.,]\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)";

function parseAmount(raw: string): number {
  const r = raw.replace(/\s/g, "");
  const grouped = /^(\d{1,3}(?:[.,]\d{3})+)(?:[.,](\d{1,2}))?$/.exec(r);
  if (grouped) return Number(grouped[1].replace(/[.,]/g, "")) + (grouped[2] ? Number(`0.${grouped[2]}`) : 0);
  return Number(r.replace(",", "."));
}

function currencyCode(c: string): string {
  if (/^(tl|try|₺|lira)/.test(c)) return "TRY";
  if (/^(eur|euro|avro|€)/.test(c)) return "EUR";
  if (/^(\$|usd|dolar|dollar)/.test(c)) return "USD";
  if (/^(£|gbp|sterlin|pound)/.test(c)) return "GBP";
  return "X";
}

/** Birimli miktarın kanonik anahtarı: mesafe→metre, süre→saniye, gece ayrı, adet eşyaya göre. */
function typedQuantity(cls: ClaimClass, unit: string, v: number): string {
  const u = unit.replace(/'.*$/, "");
  const r = (x: number) => Math.round(x * 1000) / 1000;
  if (cls === "distance") {
    if (/^(km|kilomet)/.test(u)) return `distance|m${r(v * 1000)}`;
    if (/^(mi|mile)/.test(u)) return `distance|m${r(v * 1609)}`;
    if (/^(adim|step)/.test(u)) return `distance|step${v}`;
    return `distance|m${r(v)}`;
  }
  if (cls === "duration") {
    if (/^(gece|night)/.test(u)) return `nights|${v}`;
    if (/^(sn|sec|saniye)/.test(u)) return `duration|s${r(v)}`;
    if (/^(dk|min|dakika)/.test(u)) return `duration|s${r(v * 60)}`;
    if (/^(saat|hour|hr)/.test(u)) return `duration|s${r(v * 3600)}`;
    if (/^(gun|day)/.test(u)) return `duration|s${r(v * 86400)}`;
    if (/^(hafta|week)/.test(u)) return `duration|s${r(v * 604800)}`;
    return `duration|?${v}`;
  }
  if (cls === "count") {
    const item = /^(havlu|towel)/.test(u)
      ? "towel"
      : /^(yatak odasi|bedroom)/.test(u)
        ? "bedroom"
        : /^(yatak|bed)/.test(u)
          ? "bed"
          : /^(banyo|bathroom)/.test(u)
            ? "bath"
            : /^(oda|room)/.test(u)
              ? "room"
              : /^(arac|araba|car|space|yer)/.test(u)
                ? "car"
                : /^(anahtar|key)/.test(u)
                  ? "key"
                  : /^(m2|metrekare|sqm)/.test(u)
                    ? "m2"
                    : /^(mbps)/.test(u)
                      ? "mbps"
                      : /^(derece|°)/.test(u)
                        ? "deg"
                        : /^(yildiz|star)/.test(u)
                          ? "star"
                          : "item";
    return `count|${item}|${v}`;
  }
  return `${cls}|${v}`;
}

const tkey = (h: number, m: number) => `t${((h % 24) + 24) % 24}:${String(m).padStart(2, "0")}`;
const dkey = (d: number, m: number) => `d${d}.${m}`;

/** Birim aileleri: `long` ek alabilir; `short` ardından harf gelmemeli (kesme + ek serbest). */
const UNIT_FAMILIES: { cls: ClaimClass; long: string[]; short: string[] }[] = [
  { cls: "distance", long: ["kilometre", "kilometers?", "metrelik", "metre", "meters?", "metres?", "miles?", "adim", "steps"], short: ["km", "m", "mi"] },
  {
    cls: "duration",
    long: ["dakika", "minutes?", "saniye", "seconds?", "saatlik", "hours?", "gunluk", "gun", "days?", "gecelik", "gece", "nights?", "hafta", "weeks?"],
    short: ["dk", "mins?", "sn", "secs?", "hrs?", "saat"],
  },
  { cls: "people", long: ["kisilik", "kisi", "misafir", "yetiskin", "cocuk", "guests?", "persons?", "people", "adults?", "children", "kids"], short: [] },
  { cls: "floor", long: ["floors?", "katli"], short: ["kat"] },
  {
    cls: "count",
    long: ["havlu", "towels?", "yatak odasi", "yatak", "bedrooms?", "beds?", "banyo", "bathrooms?", "oda", "rooms?", "aracl", "arac", "araba", "cars?", "adet", "tane", "pieces?", "kapsul", "anahtar", "keys?", "spaces?", "metrekare", "sqm", "mbps", "derece", "yildiz", "stars?"],
    short: ["m2", "°c?"],
  },
];

/** Katlanmış + sayıya çevrilmiş metinden iddialar. `raw` = özgün metin (kod büyük/küçük harfi için). */
function extract(text: string, raw: string): Claim[] {
  const out: Claim[] = [];
  // Karakter başına bayrak: bir karakter iki iddiaya giremez (O(1) örtüşme — liste O(n²) idi).
  const used = new Uint8Array(text.length + 1);
  const take = (re: RegExp, fn: (m: RegExpExecArray) => Omit<Claim, "at" | "end"> | Omit<Claim, "at" | "end">[] | null) => {
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const s = m.index;
      const e = m.index + m[0].length;
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      if (used.subarray(s, e).includes(1)) continue;
      const c = fn(m);
      if (!c) continue;
      used.fill(1, s, e);
      for (const x of Array.isArray(c) ? c : [c]) out.push({ ...x, at: s, end: e });
    }
  };

  take(/\b(?:https?:\/\/|www\.)[^\s,;)"'<>]+/g, (m) => ({
    cls: "url",
    keys: [`u${m[0].replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[./]+$/, "")}`],
    raw: m[0],
  }));
  // Sınırlı + belirteç başına çapalı (sınırsız biçim 24k'lık girdide O(n²) idi).
  take(/(?<![a-z0-9._%+-])[a-z0-9._%+-]{1,64}@[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63}){0,4}\.[a-z]{2,24}\b/g, (m) => ({ cls: "email", keys: [`e${m[0]}`], raw: m[0] }));
  // "7/24" bir mülk/host iddiasıdır (dünya sabiti DEĞİL).
  take(/(?<![\d/])(?:7\/24|24\/7|7 gun 24 saat|24 saat|24 hours|round the clock)(?![\d/])/g, (m) => ({ cls: "duration", keys: ["x24x7"], raw: m[0] }));

  take(new RegExp(`\\b(\\d{1,2}) ?- ?(\\d{1,2})\\.? (${alt(MONTHS)})(?![a-z])[a-z']*`, "g"), (m) =>
    [m[1], m[2]].map((x) => ({ cls: "date" as const, keys: [dkey(+x, MONTHS[m[3]])], raw: m[0] })),
  );
  take(new RegExp(`\\b(${alt(EN_MONTHS)})\\.? (\\d{1,2}) ?- ?(\\d{1,2})(?!\\d)`, "g"), (m) =>
    [m[2], m[3]].map((x) => ({ cls: "date" as const, keys: [dkey(+x, EN_MONTHS[m[1]])], raw: m[0] })),
  );
  take(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b/g, (m) => {
    const d = +m[1];
    const mo = +m[2];
    return d >= 1 && d <= 31 && mo >= 1 && mo <= 12 ? { cls: "date", keys: [dkey(d, mo)], raw: m[0] } : null;
  });
  take(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (m) => ({ cls: "date", keys: [dkey(+m[3], +m[2])], raw: m[0] }));
  take(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th|\\.)?(?: of)? (${alt(MONTHS)})(?![a-z])[a-z']*(?: (\\d{4}))?`, "g"), (m) => {
    const d = +m[1];
    return d >= 1 && d <= 31 ? { cls: "date", keys: [dkey(d, MONTHS[m[2]])], raw: m[0] } : null;
  });
  // "September 18" — YALNIZ İngilizce ay adı (Türkçe "ocak 3" = ocak/fırın, "aralik 5" = aralık/boşluk).
  take(new RegExp(`\\b(${alt(EN_MONTHS)})\\.? (\\d{1,2})(?:st|nd|rd|th)?(?!\\d)(?:,? (\\d{4}))?`, "g"), (m) => {
    const d = +m[2];
    return d >= 1 && d <= 31 ? { cls: "date", keys: [dkey(d, EN_MONTHS[m[1]])], raw: m[0] } : null;
  });

  // Para — saatlerden ÖNCE ("2.50 tl").
  take(new RegExp(`(?<![a-z])(${CURRENCY_BEFORE}) ?(${NUM})(?!\\d)`, "g"), (m) => {
    const v = parseAmount(m[2]);
    return { cls: "money", keys: [`n${v}`], tkeys: [`money|${currencyCode(m[1])}|${v}`], raw: m[0] };
  });
  take(new RegExp(`\\b(${NUM})(?: ?- ?(${NUM}))? ?(${CURRENCY_AFTER})(?![a-z])`, "g"), (m) =>
    [m[1], m[2]].filter((x): x is string => Boolean(x)).map((x) => {
      const v = parseAmount(x);
      return { cls: "money" as const, keys: [`n${v}`], tkeys: [`money|${currencyCode(m[3])}|${v}`], raw: m[0] };
    }),
  );
  take(/(?:%|\byuzde )\s?(\d+(?:[.,]\d+)?)|\b(\d+(?:[.,]\d+)?)\s?%/g, (m) => ({ cls: "percent", keys: [`n${parseAmount(m[1] ?? m[2])}`], raw: m[0] }));

  // Telefon: + / 00 / 0 öneki, 10–13 hane; son 10 hane karşılaştırılır.
  take(/(?:\+|\b00|\b0)\s?\d[\d\s().-]{7,20}\d(?!\d)/g, (m) => {
    const digits = m[0].replace(/\D/g, "");
    return digits.length >= 10 && digits.length <= 13 ? { cls: "phone", keys: [`p${digits.slice(-10)}`], raw: m[0] } : null;
  });
  // Acil numaralar — dünya sabiti, YALNIZ acil sözcüğünün yanında.
  take(/\b(112|155|156|110|177|911|999)\b/g, (m) => {
    const win = text.slice(Math.max(0, m.index - 60), m.index + 40);
    return /(acil|ambulans|polis|itfaiye|emergenc|ambulance|police|fire|arayin|call|dial)/.test(win)
      ? { cls: "phone", keys: [`k${m[1]}`], raw: m[0] }
      : null;
  });

  // Saatler.
  take(/\b([01]?\d|2[0-4])[:.]([0-5]\d)(?!\d)(?!\.\d)(?:\s?([ap])\.?m\.?(?![a-z]))?/g, (m) => {
    let h = +m[1];
    const mi = +m[2];
    const ap = m[3];
    if (ap === "p" && h < 12) h += 12;
    if (ap === "a" && h === 12) h = 0;
    const keys = [tkey(h, mi)];
    if (m[0].includes(".") && !ap && mi >= 1 && mi <= 12) keys.push(dkey(+m[1], mi)); // "15.09" tarih de olabilir
    return { cls: "time", keys, raw: m[0] };
  });
  take(/\b(1[0-2]|0?[1-9])\s?(?:([ap])\.?m\.?|(o'?clock))(?![a-z])/g, (m) => {
    let h = +m[1];
    if (m[3]) return { cls: "time", keys: [tkey(h, 0), tkey(h + 12, 0)], raw: m[0] };
    if (m[2] === "p" && h < 12) h += 12;
    if (m[2] === "a" && h === 12) h = 0;
    return { cls: "time", keys: [tkey(h, 0)], raw: m[0] };
  });
  take(/\b([01]?\d|2[0-3])h([0-5]\d)?\b/g, (m) => ({ cls: "time", keys: [tkey(+m[1], m[2] ? +m[2] : 0)], raw: m[0] }));
  take(/\b(noon|midnight|gece yarisi|ogle vakti)\b/g, (m) => ({
    cls: "time",
    keys: [m[1] === "noon" || m[1] === "ogle vakti" ? tkey(12, 0) : tkey(0, 0)],
    raw: m[0],
  }));
  take(/\b(saat|sabah|ogleden sonra|oglen|ogle|aksam|gece)\s(\d{1,2})(?:[:.](\d{2}))?(?=[\s'.,;!?)]|[a-z]|$)/g, (m) => {
    const q = m[1];
    const h = +m[2];
    const mi = m[3] ? +m[3] : 0;
    if (h > 24) return null;
    let hs: number[];
    if (h >= 13 || h === 0) hs = [h];
    else if (q === "sabah") hs = [h];
    else if (q === "ogleden sonra" || q === "aksam") hs = [h + 12];
    else if (q === "oglen" || q === "ogle") hs = h === 12 ? [12] : [h + 12];
    else if (q === "gece") hs = h >= 7 ? [h + 12] : [h];
    else hs = h === 12 ? [12] : [h, h + 12];
    return { cls: "time", keys: hs.map((x) => tkey(x, mi)), raw: m[0] };
  });

  take(/\b(\d{1,2})(?:\.|st|nd|rd|th)\s?(?:kat|floor)/g, (m) => ({ cls: "floor", keys: [`n${+m[1]}`], tkeys: [`floor|${+m[1]}`], raw: m[0] }));

  // Gizli-benzeri anahtar sözcükten sonraki kod (belirteçte rakam ya da tırnak şart).
  const KW =
    "\\b(?:sifre[a-z]*|parola[a-z]*|password|passcode|pin|kod[a-z]*|code|ssid|ag adi|agin adi|ag ismi|network(?: name)?|wi-?fi(?: agi[a-z]*| adi)?|wlan|zil|kapi no|door code|keybox)(?![a-z])";
  take(new RegExp(`${KW}[^\\S\\n]*(?:[:=]|(?:is|olarak|de|da)(?![a-z]))?[^\\S\\n]*(["']?)([^\\s"',;()]{3,40})`, "g"), (m) => {
    const tok = m[2].replace(/[.!?:]+$/, "");
    if (!/\d/.test(tok) && m[1] === "") return null;
    if (/^(ve|and|or|veya|yok|none|nedir|neydi|ne|what)$/.test(tok)) return null;
    const r = rawToken(raw, tok);
    return { cls: "code", keys: [`c${r}`], raw: r };
  });
  // Harf + rakam karışık tekil belirteç ("3b", "lalenet_5g"); "15te", "2nd", "10dk" DEĞİL.
  take(/\b(?=[a-z_-]*\d)(?=\d*[a-z])[a-z0-9_-]{2,24}\b/g, (m) => {
    const t = m[0];
    if (/^\d{1,4}[a-z]{2,}$/.test(t)) return null;
    if (/^m2$/.test(t)) return null;
    const r = rawToken(raw, t);
    return { cls: "code", keys: [`c${r}`], raw: r };
  });

  // Birimli miktarlar (+ "10-15 dakika" aralığı).
  for (const fam of UNIT_FAMILIES) {
    const alts = [...fam.long.map((u) => `${u.replace(/ /g, "\\s")}[a-z']*`), ...fam.short.map((u) => `${u}(?:'[a-z]+)?(?![a-z])`)];
    const re = new RegExp(`\\b(${NUM})(?: ?(?:-|ile|to|or|veya) ?(${NUM}))?(?:'[a-z]{1,4})?[\\s-]?(?:${alts.join("|")})`, "g");
    take(re, (m) => {
      const unit = /[a-z°][a-z\s°]*$/.exec(m[0])?.[0].trim() ?? "";
      return [m[1], m[2]].filter((x): x is string => Boolean(x)).map((x) => {
        const v = parseAmount(x);
        return { cls: fam.cls, keys: [`n${v}`], tkeys: [typedQuantity(fam.cls, unit, v)], raw: m[0] };
      });
    });
  }

  // Tek başına 4–8 hane → kod (yıl biçimi → sayı).
  take(/\b\d{4,8}\b/g, (m) =>
    /^(19|20)\d{2}$/.test(m[0]) ? { cls: "number", keys: [`n${+m[0]}`], raw: m[0] } : { cls: "code", keys: [`c${m[0]}`], raw: m[0] },
  );
  take(/\b\d+(?:[.,]\d+)?\b/g, (m) => ({ cls: "number", keys: [`n${parseAmount(m[0])}`], raw: m[0] }));

  return out;
}

/** Kodun özgün yazımını geri bul (kodlar büyük/küçük harfe duyarlıdır). */
function rawToken(raw: string, foldedTok: string): string {
  for (const p of raw.normalize("NFKC").split(/[\s"“”«»',;()]+/)) {
    const clean = p.replace(/[.!?:]+$/, "");
    if (foldForClaims(clean) === foldedTok) return clean;
    const inner = /[A-Za-z0-9_-]+/.exec(clean)?.[0];
    if (inner && foldForClaims(inner) === foldedTok) return inner;
  }
  return foldedTok;
}

// ─── bağlam dizini ─────────────────────────────────────────────────────────

interface Index {
  /** Telefon/tarih/saat/para/url/e-posta/yüzde aralıkları: içlerindeki rakam dizisi KOD değildir. */
  nonCodeSpans: [number, number][];
  keys: Set<string>;
  typed: Set<string>;
  nums: Set<string>;
  folded: string;
  raw: string;
}

const NON_CODE_CLASSES = new Set<ClaimClass>(["phone", "date", "time", "money", "url", "email", "percent"]);

function buildIndex(texts: readonly string[], derived: readonly number[] = []): Index {
  const raw = texts.join("\n").normalize("NFKC");
  const f = wordsToDigits(foldForClaims(raw), "all");
  const claims = extract(f, raw);
  const keys = new Set<string>();
  const typed = new Set<string>();
  const nums = new Set<string>();
  for (const c of claims) {
    for (const k of c.keys) keys.add(k);
    for (const t of c.tkeys ?? []) typed.add(t);
  }
  // Metindeki HER sayı. Binlik gruplu ("4.500") TEK sayıdır — parçası ("500") sızmaz;
  // "15.10.2026" / "15:00" tamsayı parçalarını verir.
  for (const m of f.matchAll(/\d+(?:[.,:]\d+)*/g)) {
    const t = m[0];
    if (/^\d{1,3}(?:[.,]\d{3})+$/.test(t)) {
      nums.add(`n${parseAmount(t)}`);
      continue;
    }
    if (/^\d+[.,]\d{1,2}$/.test(t)) nums.add(`n${parseAmount(t)}`);
    for (const p of t.split(/[.,:]/)) nums.add(`n${+p}`);
  }
  for (const k of keys) {
    if (k.startsWith("t")) {
      const [h, mi] = k.slice(1).split(":").map(Number);
      nums.add(`n${h}`);
      nums.add(`n${h > 12 ? h - 12 : h}`);
      if (mi) nums.add(`n${mi}`);
    }
    if (k.startsWith("d")) {
      const [d, mo] = k.slice(1).split(".").map(Number);
      nums.add(`n${d}`);
      nums.add(`n${mo}`);
    }
  }
  for (const d of derived) {
    nums.add(`n${d}`);
    typed.add(`nights|${d}`);
    typed.add(`duration|s${d * 86400}`);
  }
  const nonCodeSpans = claims.filter((c) => NON_CODE_CLASSES.has(c.cls)).map((c) => [c.at, c.end] as [number, number]);
  return { keys, typed, nums, folded: f, raw, nonCodeSpans };
}

const escapeRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function supportedBy(c: Claim, ix: Index): boolean {
  // KATI: birimli miktar/para yalnız AYNI sınıf + normalize değerle.
  if (c.tkeys && c.tkeys.length > 0) return c.tkeys.some((t) => ix.typed.has(t));
  for (const k of c.keys) {
    if (k.startsWith("n")) {
      if (ix.nums.has(k)) return true;
      continue;
    }
    if (ix.keys.has(k)) return true;
    if (k.startsWith("c")) {
      const tok = k.slice(1);
      // Özgün bağlamda büyük/küçük harfe DUYARLI tekil belirteç …
      if (!new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(tok)}(?![\\p{L}\\p{N}])`, "u").test(ix.raw)) continue;
      // … ve en az bir geçişi telefon/tarih/saat/para aralığının DIŞINDA ("0532" telefonun parçası).
      const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(foldForClaims(tok))}(?![\\p{L}\\p{N}])`, "gu");
      for (let m = re.exec(ix.folded); m; m = re.exec(ix.folded)) {
        const a = m.index;
        const b = m.index + m[0].length;
        if (!ix.nonCodeSpans.some(([x, y]) => a < y && b > x)) return true;
      }
    }
    if ((k.startsWith("u") || k.startsWith("e")) && ix.folded.includes(k.slice(1))) return true;
    if (k.startsWith("p") && ix.folded.replace(/[\s().-]/g, "").includes(k.slice(1))) return true;
  }
  return false;
}

const CONSTANT_KEYS = new Set(["k112", "k155", "k156", "k110", "k177", "k911", "k999"]);

/** Cevaptaki iddiaları çıkar ve desteğini sınıfla. Saf; asla fırlatmaması çağıranda sarılarak sağlanır. */
export function auditClaims(reply: string, ctx: ClaimContext): ClaimAudit {
  const claims = extract(wordsToDigits(foldForClaims(reply), "unit"), reply);
  const facts = buildIndex(ctx.facts, ctx.derivedNumbers ?? []);
  const op = buildIndex(ctx.operator);
  const guest = buildIndex(ctx.guest);
  const audit: ClaimAudit = { v: 1, n: claims.length, ctx: 0, op: 0, echo: 0, k: 0, u: 0, uc: [], ec: [] };
  const uc = new Set<ClaimClass>();
  const ec = new Set<ClaimClass>();
  for (const c of claims) {
    let s: SupportKind;
    if (c.keys.some((k) => CONSTANT_KEYS.has(k))) s = "const";
    else if (supportedBy(c, facts)) s = "ctx";
    else if (supportedBy(c, op)) s = "op";
    else if (supportedBy(c, guest)) s = "echo";
    else s = "none";
    if (s === "ctx") audit.ctx++;
    else if (s === "op") audit.op++;
    else if (s === "echo") {
      audit.echo++;
      ec.add(c.cls);
    } else if (s === "const") audit.k++;
    else {
      audit.u++;
      uc.add(c.cls);
    }
  }
  audit.uc = CLAIM_CLASSES.filter((x) => uc.has(x));
  audit.ec = CLAIM_CLASSES.filter((x) => ec.has(x));
  return audit;
}

/** Hiç fırlatmayan sarmal: ölçüm, cevabı ASLA bozamaz. */
export function auditClaimsSafe(reply: string, ctx: ClaimContext | undefined): ClaimAudit | undefined {
  if (!ctx) return undefined;
  try {
    return auditClaims(reply, ctx);
  } catch {
    return undefined;
  }
}
