// ---------------------------------------------------------------------------
// SAAT ALANLARI — TEK KAYNAK (09-23). Bir KB metnindeki saatleri ALANA (giriş / çıkış / sessiz
// saat / havuz / spor salonu / temizlik / erken giriş / geç çıkış) atfeder ve iki saat kümesinin
// ya da KB ile mülk ayarının ÇELİŞİP çelişmediğine karar verir. Üç tüketici AYNI kuralı kullanır:
//   · retrieval çelişki koruması (`rerank.preserveTimeConflicts`),
//   · istemdeki KB ↔ mülk ayarı çelişki bloğu (`prompts.findTimeConflicts`),
//   · host'a gösterilen "Uyuşmayan saatler" raporu (`kb-time-conflicts.ts`);
//   · gönderim kapısı istemin çelişki listesini okur (`ai/time-conflict-gate.ts`, 09-25 — P4-b kodda).
// Eskiden İKİ ayrı kural vardı (retrieval alan bazlı, istem KATEGORİ bazlı) ve ikisi de ölçülmüş
// yanlış pozitif üretiyordu (09-23 ajan ölçümü, 46 kalem çifti + 28 kalem↔mülk vakası):
//   · istem: "Giriş 15:00, çıkış 11:00." yazan (mülkle UYUMLU) bir giriş kalemi "giriş saati:
//     ayar 15:00, bilgi tabanı 11:00" çelişkisi üretiyor, blok "güveni 0.75 altında tut" dediği için
//     uyumlu KB'li 7 kalemlik bir mülkte Wi-Fi/otopark sorularının 3/3'ü İNSANA düşüyordu;
//   · retrieval: 46 çiftte 18 yanlış alarm (erken giriş/geç çıkış saati, "bina girişi",
//     "acil çıkış", "çıkış günü", aralık inceltmesi, "12:00. Çıkış" nokta bölmesi, "3:00 PM").
//
// SAF: DB/ağ yok. Değişiklik = canlı AI davranışı → golden set + E7/R5 kontrolü ŞART.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { contentStems, phraseUnits, tokenize } from "./text";
import { matchConcepts, timeFieldsIn } from "./lexicon";

/** Alan → o alana atfedilen saatler ("SS:DD"). */
export type FieldTimes = ReadonlyMap<string, ReadonlySet<string>>;

/** Tek bir saat atfı: nereden geldiği (cümlecik mi başlık mı) ve hangi cümlecikte geçtiği. */
export interface FieldTimeHit {
  field: string;
  time: string;
  /** "clause" = cümleciğin kendisi alanı adlandırıyor · "title" = başlığın alanından ödünç. */
  via: "clause" | "title" | "category";
  clause: string;
  /**
   * KOŞULSUZ saat: sınır rolü (…'e kadar / …'ten itibaren / önce / sonra / by), aralık ucu, "en geç / at the latest" ve gün
   * koşulu ("hafta sonu", "on Sundays") YOK. Mülk ayarıyla kıyasta aynı kalemdeki iki koşulsuz saat çelişkidir
   * (↓`kbPropertyMismatch`); pencere uçları değildir.
   */
  point?: boolean;
  /**
   * Sınır yönü (09-27 saat okuma turu): "lower" = pencerenin başı ("from 15:00", "15:00'ten itibaren", aralığın ilk ucu), "upper" = sonu
   * ("until / by 11:00", "en geç", aralığın ikinci ucu). Mülk değeri kalemde yalnız sınır olarak geçerken sınırın YANLIŞ tarafındaki
   * koşulsuz saat çelişkidir ("Check-in from 15:00. Check-in at 14:00." ↓`kbPropertyMismatch`).
   */
  bound?: "lower" | "upper";
}

/**
 * Cümle sınırı: nokta (ardından RAKAM gelmiyorsa) / ünlem / soru / noktalı virgül / satır. Cümlecik sınırı: virgül ve iki
 * yanı da cümlecik olan boşluklu uzun tire (↓`splitKeeping`).
 * 🚨 Eski kalıp `(?<!\d)\.(?!\d)` rakamdan SONRA gelen noktayı sınır saymıyordu → "Giriş 15:00.
 * Çıkış 11:00." TEK cümlecik olup iki alanı birden taşıyor ve iki saat de düşüyordu. "12.00"
 * yazımı yine bölünmez (noktanın ardında rakam var).
 * 09-27: cümle ile cümlecik AYRI tutulur — koşul cümleciği ("If the flat is free, …", "Taksi isterseniz, …") AYNI cümlenin
 * sonraki cümleciklerine bağlam taşır. "|" ve madde işaretleri ("•") de cümle sınırıdır ("Check-in: 3 PM – 10 PM | Check-out: 11 AM",
 * "Giriş: 15:00 • Çıkış: 11:00"). SORU cümlesi
 * ("?" ile biten: "S: 12:00'de girebilir miyiz?", "Arriving after 11 pm?") hiçbir saat BİLDİRMEZ → okunmaz.
 */
const SENTENCE_SPLIT = /(\.(?!\d)|[!?;\n|•·▪◦]+)/;
const CLAUSE_SPLIT = /,+/;
/** Virgülden sonra saatle ya da ilgi zamiriyle başlayan cümlecik bir DEVAMDIR (↓`fieldTimeHits`). */
const CONTINUATION_START = /^\s*(?:\d{1,2}(?:[:.]\d{2}|\s*(?:am|pm)\b)|(?:which|who|whom|whose|where|that|ki)\b)/i;
/** am / pm işareti: "am", "a.m.", "a.m" (virgülden önce: "11 a.m, thank you"), "p.m." — ardından harf gelmez ("amount" değil). */
const AMPM = String.raw`[ap]\.?m\.?(?![a-z])`;
/**
 * "SS:DD / S.DD". Sonda `\b` DEĞİL `(?!\d)` (09-27 saat okuma turu): eksiz yapışık Türkçe ek de saattir ("11:00dir", "15:00ten");
 * "10.000" gibi uzun sayı yine saat değildir. Para / tarih / ölçü dışlaması ↓`notATime`.
 */
const HHMM_G = new RegExp(String.raw`\b([01]?\d|2[0-3])([:.])([0-5]\d)(?!\d)(\s*${AMPM})?`, "gi");
/** "11am", "3 pm", "4p.m." — dakikasız 12 saat biçimi. Önünde ":"/"." varsa DEĞİL ("10:10 am"deki "10 am"). */
const HOUR_AMPM_G = new RegExp(String.raw`(?<![:.\d])\b(1[0-2]|0?[1-9])\s*(${AMPM})`, "gi");
/**
 * "saat 11'e kadar" — dakikasız Türkçe saat. YALNIZ 10–23: "saat 3" günlük dilde çoğu zaman 15:00
 * demektir; 03:00 diye okumak mülk ayarı 15:00 ile SAHTE çelişki üretirdi (belirsizde hüküm yok).
 */
const SAAT_HOUR_G = /\bsaat\s+(1\d|2[0-3])(?![\d:.])/gi;
/**
 * "saat"SİZ dakikasız Türkçe saat (09-27 saat okuma turu): "Giriş 14'ten itibaren, çıkış 11'e kadar", "Çıkış 11'de". Yalnız 10–23
 * (↑ aynı belirsizlik kuralı), yalnız saat bildiren ek + sınır sözüyle ("'ten itibaren / sonra / önce", "'e kadar / dek") ya da
 * bulunma ekiyle; "'e kadar kişi / misafir / gece" sayımdır. ZAYIF kanıt (`bare`): alan ancak cümleciğin KENDİSİ adlandırıyorsa
 * okunur (↓`fieldTimeHits`) — başlıktan ödünç alınmaz ("Kapasite 12'de" giriş saati değil).
 */
const COUNTER =
  String.raw`(?:(?:kişi|kisi|misafir|konuk|yetişkin|yetiskin|çocuk|cocuk|evcil|köpek|kopek|kedi|hayvan|bavul|valiz|araç|arac|araba|yatak)[a-zçğıöşü]*|(?:gece|gün|gun|hafta|ay|yıl|yil|kg|km|metre|dakika|saat|lira|tl|euro|dolar|oda|kat)(?![a-zçğıöşü]))`;
const BARE_HOUR_G = new RegExp(
  String.raw`(?<![\d:.,/])\b(1\d|2[0-3])\s*['’]\s*(?:[dt][ae]n(?=\s+(?:itibaren|itibar[ıi]yla|itibariyle|sonra|önce|once)(?![a-zçğıöşü]))|y?[ae](?=\s+(?:kadar|dek|değin|degin)(?![a-zçğıöşü])(?!\s+(?:\d+\s+)?${COUNTER}))|[dt][ae](?![a-zçğıöşü]))`,
  "gi",
);
/** "11 buçukta" / "11'i çeyrek geçe" / "12'ye on kala" — "saat"siz (↓`clockTail` dakikayı çözer; çözülemeyen hiç okunmaz). */
const BARE_CLOCK_G =
  /(?<![\d:.,/])\b(1\d|2[0-3])(?=\s+bu[çc]u[kğg]|\s*['’]\s*(?:[ıiuü]\s+[^.,;]{1,24}?\s+ge[çc]e|y?[ae]\s+(?!kadar|dek)[^.,;]{1,24}?\s+kala|y?[ae]\s+(?:(?:yirmi|on)\s+be[şs]|be[şs]|on|[çc]eyrek|yirmi|\d{1,2})\s+var)(?![a-zçğıöşü]))/gi;
/** "saat 10-11 arası", "10-11 arası" — iki uçlu dakikasız Türkçe aralık (ikinci uç ayrıca okunur). */
const BARE_RANGE_G = /(?<![\d:.,/])\b(1\d|2[0-3])\s*[-–—]\s*(1\d|2[0-3])(?![\d:.])(?=\s+(?:arası|arasında|arasi|arasinda|saatleri|saatlerinde)(?![a-zçğıöşü]))/gi;
/**
 * Ortak am/pm (09-27): "3 – 10 pm", "between 3-8pm", "9 – 7 pm" — işaretsiz ilk uç, ikinci ucun işaretini alır; ilk uç ikinciden
 * büyük / eşitse öğleyi (ya da gece yarısını) geçen aralıktır, karşı işaret ("9 – 7 pm" = 09:00–19:00).
 */
const SHARED_FIRST_G = new RegExp(
  String.raw`(?<![:.\d])\b(1[0-2]|0?[1-9])(?![:.]?\d)(?!\s*[ap]\.?m\.?(?![a-z]))(?=\s*(?:[-–—]|to|till|until|and)\s*(1[0-2]|0?[1-9])(?:[:.][0-5]\d)?\s*(${AMPM}))`,
  "gi",
);
/** İşaretsiz "S:DD" ilk uç + işaretli ikinci uç ("3:00 – 10:00 PM"). */
const SHARED_TAIL = new RegExp(String.raw`^\s*(?:[-–—]|to|till|until|and)\s*(1[0-2]|0?[1-9])(?:[:.][0-5]\d)?\s*(${AMPM})`, "i");
/** "noon / midday / midnight", "12 noon", "gece yarısı" (09-27: "Check-out: 12 noon" hiç okunmuyordu). */
const NOON_G = /\b(?:12\s*)?(noon|midday|midnight)\b|(?<![a-zçğıöşü])gece\s+yar[ıi]s[ıi]/gi;

function to24(h: number, marker: string | undefined): number {
  if (!marker) return h;
  const pm = /^p/i.test(marker.trim());
  if (pm && h < 12) return h + 12;
  if (!pm && h === 12) return 0;
  return h;
}
const pad = (h: number, m: string) => `${String(h).padStart(2, "0")}:${m}`;
/** Ortak işaret: ilk uç ikinciden küçükse aynı işaret, değilse karşı işaret (öğleyi / gece yarısını geçen aralık). */
function sharedMarker(h1: number, h2: number, marker: string): string {
  const pm = /^p/i.test(marker.trim());
  return h1 % 12 < h2 % 12 ? (pm ? "pm" : "am") : pm ? "am" : "pm";
}

/** Dakikası çözülemeyen saat anlatımı ("geçe" / "kala" her zaman saat anlatımıdır; "…'e kadar … kala" değildir). */
const UNPARSED_CLOCK = /^\s*['’]?\s*(?:[ıiuü]\s+[^.,;]{1,24}?\s+ge[çc]e|y?[ae]\s+(?!kadar|dek)[^.,;]{1,24}?\s+kala)(?![a-zçğıöşü])/;
/** Türkçe dakika sözcüğü / rakamı ("on geçe", "yirmi beş kala", "10 geçe"); tanınmayan ("biraz", "birkaç") → null. */
const MINUTE_WORDS: Record<string, number> = { beş: 5, bes: 5, on: 10, onbeş: 15, onbes: 15, çeyrek: 15, ceyrek: 15, yirmi: 20, yirmibeş: 25, yirmibes: 25 };
function minuteWord(w: string): number | null {
  if (/^\d{1,2}$/.test(w)) return Number(w) >= 1 && Number(w) <= 59 ? Number(w) : null;
  return MINUTE_WORDS[w.replace(/\s+/g, "")] ?? null;
}
const MINUTE_ALT = String.raw`(?:yirmi|on)\s+be[şs]|yirmibe[şs]|onbe[şs]|be[şs]|on|[çc]eyrek|yirmi|\d{1,2}`;
const PAST_TAIL = /^\s*['’]?\s*[ıiuü]\s+((?:yirmi|on)\s+be[şs]|[a-zçğıöşü]+|\d{1,2})\s+ge[çc]e(?![a-zçğıöşü])/;
// "var" genel dilde de geçer ("12'ye kadar vaktiniz var"): yalnız TANINAN dakika sözcüğüyle saat anlatımıdır; "kala" hep saat anlatımı.
const TO_TAIL = new RegExp(String.raw`^\s*['’]?\s*y?[ae]\s+(${MINUTE_ALT})\s+(?:var|kala)(?![a-zçğıöşü])`);
/**
 * Dakika anlatımı (Türkçe): "11 buçuk" = 11:30, "11'i çeyrek / on geçe" = 11:15 / 11:10, "12'ye çeyrek / yirmi kala" = 11:45 / 11:40.
 * Dakikası çözülemeyen anlatım ("11'i biraz geçe", "12'ye birkaç dakika kala") → `null`: saat HİÇ okunmaz (kurucu 09-27: "belirsiz
 * ifadede kesin saat uydurmasın" — eski okuyucu "saat 11'i çeyrek geçe"yi de "11'i on geçe"yi de 11:00 okuyordu).
 */
function clockTail(h: number, after: string): { time: string; len: number } | null {
  const a = after.toLocaleLowerCase("tr");
  let m = /^\s+bu[çc]u[kğg][a-zçğıöşü]*/.exec(a);
  if (m) return { time: pad(h, "30"), len: m[0].length };
  m = PAST_TAIL.exec(a);
  if (m) {
    const min = minuteWord(m[1]);
    return min === null ? null : { time: pad(h, String(min).padStart(2, "0")), len: m[0].length };
  }
  m = TO_TAIL.exec(a);
  if (m) {
    const min = minuteWord(m[1]);
    return min === null ? null : { time: pad(h === 0 ? 23 : h - 1, String(60 - min).padStart(2, "0")), len: m[0].length };
  }
  // Başka biçimde "geçe / kala" ("11'i birkaç dakika geçe", "12'ye az kala"): dakika yok → saat de yok.
  if (UNPARSED_CLOCK.test(a)) return null;
  return { time: pad(h, "00"), len: 0 };
}

/**
 * "S.DD / SS:DD" gerçekten saat mi (09-27 saat okuma turu — dört inceleme ajanı): PARA ("€10.00", "2.50 EUR", "10.00 TL"), TARİH
 * ("15.04 tarihinde", "15.04.2026", "15.05–30.09"), ÖLÇÜ ("2.50 m", "1.25 kg") saat değildir. Noktalı yazımda dakika 5'in katı değil ve
 * geçerli bir ay ise (≤12: "15.04", "01.06") TARİHTİR; "22.10" gibi belirsiz yazım saat kalır.
 */
function notATime(text: string, start: number, end: number, sep: string, minutes: string): boolean {
  const before = text.slice(Math.max(0, start - 8), start);
  const after = text.slice(end, end + 14);
  if (/[€$£₺]\s*$/.test(before) || /(?<![a-z])(?:eur|usd|gbp|try|tl)\s*$/i.test(before)) return true;
  if (/^\s*(?:[€$£₺]|(?:tl|try|eur|euro|euros|usd|gbp|lira|dolar|dollars?|pounds?)(?![a-zçğıöşü]))/i.test(after)) return true;
  if (sep !== ".") return false;
  if (/^\.\d/.test(after) || /\d\.$/.test(before)) return true;
  if (/^\s*['’]?\s*(?:tarih|date)/i.test(after)) return true;
  if (/^\s*(?:km|kg|gb|mb|mbps|lt|ml|cm|mm|m²|m2|mt|metre|meter|metres|meters|kilometre|kilometer|%|°)(?![a-zçğıöşü])/i.test(after)) return true;
  const mm = Number(minutes);
  if (mm % 5 !== 0 && mm >= 1 && mm <= 12) return true;
  return /^\s*[-–—]\s*(?:2[4-9]|3[01])\.\d{2}/.test(after) || /(?:2[4-9]|3[01])\.\d{2}\s*[-–—]\s*$/.test(before);
}

/** Bir saat geçişi: saat, metindeki konumu; `bare` = "saat"siz dakikasız Türkçe biçim (zayıf kanıt, ↑`BARE_HOUR_G`). */
interface TimeMention {
  time: string;
  start: number;
  end: number;
  bare?: boolean;
}

/**
 * Metindeki saat geçişleri, konumlarıyla — TEK tarayıcı: `timesIn` (gönderim kapısı cevabın saatlerini buradan okur) ve okuyucunun
 * `timeMentions`ı aynı kalıpları kullanır. Çakışan eşleşmeden ilki (öncelik sırası) kalır.
 */
function scanTimes(text: string): TimeMention[] {
  const out: TimeMention[] = [];
  const add = (time: string, start: number, end: number, bare = false) => {
    if (out.some((m) => start < m.end && end > m.start)) return;
    out.push(bare ? { time, start, end, bare } : { time, start, end });
  };
  for (const m of text.matchAll(HHMM_G)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (notATime(text, start, end, m[2], m[3])) continue;
    const h = Number(m[1]);
    let marker = m[4];
    if (!marker && h >= 1 && h <= 12) {
      const tail = SHARED_TAIL.exec(text.slice(end, end + 24));
      if (tail) marker = sharedMarker(h, Number(tail[1]), tail[2]);
    }
    add(pad(to24(h, marker), m[3]), start, end);
  }
  for (const m of text.matchAll(HOUR_AMPM_G)) add(pad(to24(Number(m[1]), m[2]), "00"), m.index ?? 0, (m.index ?? 0) + m[0].length);
  for (const m of text.matchAll(SHARED_FIRST_G)) {
    const h = Number(m[1]);
    add(pad(to24(h, sharedMarker(h, Number(m[2]), m[3])), "00"), m.index ?? 0, (m.index ?? 0) + m[0].length);
  }
  for (const m of text.matchAll(SAAT_HOUR_G)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const tail = clockTail(Number(m[1]), text.slice(end, end + 32));
    if (!tail) continue;
    add(tail.time, start, end + tail.len);
    // "saat 10-11 arası": ikinci uç.
    const second = /^\s*[-–—]\s*(1\d|2[0-3])(?![\d:.])/.exec(text.slice(end, end + 8));
    if (second) add(pad(Number(second[1]), "00"), end + second[0].length - second[1].length, end + second[0].length);
  }
  for (const m of text.matchAll(NOON_G)) {
    const start = m.index ?? 0;
    if (/(?:\d|[ap]\.?m\.?)\s*$/i.test(text.slice(Math.max(0, start - 8), start))) continue;
    add(/^midnight$|^gece/i.test(m[1] ?? "gece") ? "00:00" : "12:00", start, start + m[0].length);
  }
  for (const m of text.matchAll(BARE_RANGE_G)) {
    const start = m.index ?? 0;
    add(pad(Number(m[1]), "00"), start, start + m[1].length, true);
    add(pad(Number(m[2]), "00"), start + m[0].length - m[2].length, start + m[0].length, true);
  }
  for (const m of text.matchAll(BARE_CLOCK_G)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const tail = clockTail(Number(m[1]), text.slice(end, end + 32));
    if (tail) add(tail.time, start, end + tail.len, true);
  }
  for (const m of text.matchAll(BARE_HOUR_G)) add(pad(Number(m[1]), "00"), m.index ?? 0, (m.index ?? 0) + m[0].length, true);
  return out.sort((a, b) => a.start - b.start);
}

/** Metindeki saatler, "SS:DD" biçiminde (am/pm 24 saate çevrilir). */
export function timesIn(text: string): Set<string> {
  return new Set(scanTimes(text).map((m) => m.time));
}

/** Saatle biten / saatle başlayan metin: aralığın iki ucu ("09:00 – 18:00", "between 2 pm and 5 pm") birbirinden ayrılmaz. */
const STARTS_WITH_TIME = /^\W*\d{1,2}(?:[:.]\d{2}|\s*(?:am|pm)\b)/i;
/** Boşluklu uzun / orta tire: "You're welcome to arrive after 4 pm — the lockbox works around the clock". */
const DASH_SEP = /(\s[—–]\s)/;
/**
 * İKİ alan adlandıran (ya da bir alanı konu vetosuyla düşen) cümleciğin ikinci bölücüsü: "ve / and / &" ve etiket satırının
 * ayırıcıları — "Check-in: 15:00 — Check-out: 11:00", "Giriş 15:00 / Çıkış 11:00" (09-27: ikisi de hiç okunmuyordu) ve iki
 * cümleciği bağlayan "because / çünkü / but / ama" ("Check-out is at 10 am because our cleaning takes place 10 am–2 pm"). Parantez
 * yalnız bundan sonra HÂLÂ iki alan taşıyan parçayı böler ("Giriş 15:00 (erken giriş 12:00"); "Havuz (09:00-18:00) ve spor
 * salonu (07:00-22:00)" saati etiketinden koparmaz. Tek alanlı cümlecik bölünmez ("Çok geç (01.00 sonrası) varışlarda"); aralık
 * hiç bölünmez.
 */
const AND_SEP = /(\s(?:ve|and|&|[-–—/]|because|cunku|çünkü|zira|but|ama|fakat|ancak|whereas|while)\s)/i;
/** İngilizce koşul bağlacından ÖNCE bölünür, bağlaç ikinci parçada kalır ("Check-out is at 11 am | unless you've arranged a late check-out until 1 pm"). */
const EN_CONDITION_SPLIT = /\s(?=(?:unless|if|in case|provided)\s)/i;
// `(?<!\s)`: eşleşme boşluk DİZİSİNİN başında başlar (en soldaki eşleşme zaten orasıdır → sonuç aynı); yoksa uzun boşluk dizisinde
// her konumdan yeniden taranıyordu (A3 09-27: 24k boşlukta ~290 ms).
const PAREN_SEP = /(?<!\s)(\s*[()]\s*)/;
/**
 * Ayırıcıdan böler. Aralığın iki ucu ile `min` sözcükten kısa yan ("Giriş – 15:00" etiketi, "Check-in — 3 pm") yeniden
 * birleşir; birleşen metinde ayırıcı AYNEN kalır (host raporu cümleciği gösterir).
 */
function splitKeeping(text: string, sep: RegExp, min: number, timeBreak = false): string[] {
  const bits = text.split(sep);
  const out = [bits[0]];
  // BÜYÜYEN parçanın belirteç sayısı her turda yeniden hesaplanmaz (A3 09-27: 4.000 kısa parçada ~2,4 sn karesel iş): parça
  // yalnız SONUNA ayırıcı + metin eklenerek büyür, önekin belirteçleri değişmez → "en az `min`" bir kez doğruysa hep doğrudur.
  let prevEnough = tokenize(bits[0]).length >= min;
  for (let i = 1; i < bits.length; i += 2) {
    const prev = out[out.length - 1];
    const next = bits[i + 1] ?? "";
    const nextEnough = tokenize(next).length >= min;
    const range = endsWithTime(prev) && STARTS_WITH_TIME.test(next);
    // Saatle biten parçadan sonra KENDİ saati olan kısa parça ayrı bir bilgidir ("Check-out 11:00 — breakfast until 10:00", 09-27):
    // yalnız tire bölücüsünde (`timeBreak`); aralık ("15:00 – 22:00") ve etiket ("Check-in — 3 pm") birleşik kalır.
    const own = timeBreak && !range && endsWithTime(prev) && scanTimes(next).length > 0;
    if (!own && (range || !prevEnough || !nextEnough)) {
      out[out.length - 1] = prev + bits[i] + next;
      if (!prevEnough) prevEnough = tokenize(out[out.length - 1]).length >= min;
    } else {
      out.push(next);
      prevEnough = nextEnough;
    }
  }
  return out;
}

/**
 * Metin bir SAATLE bitiyor mu — `/(?:\d{1,2}[:.]\d{2}|\d{1,2}\s*(?:am|pm))\W*$/i` ile BİREBİR (birim testi o kalıpla kıyaslar), ama
 * yalnız sondan bakar (büyüyen parçada her turda tüm metni taramasın): sondaki sözcük-dışı karakterler atılır, kalan metin
 * "SS:DD / S.DD" ya da "S am/pm" (arada boşluk olabilir) ile bitmeli.
 */
export function endsWithTime(s: string): boolean {
  let e = s.length;
  while (e > 0 && /\W/.test(s[e - 1])) e--;
  // Son 5 karakter (4 de yeterdi: "d:dd" en kısa biçim — mutasyon 09-27 eşdeğer; 5 "dd:dd"yi okunaklı gösterir).
  if (/\d{1,2}[:.]\d{2}$/.test(s.slice(Math.max(0, e - 5), e))) return true;
  if (e < 2 || !/^(?:am|pm)$/i.test(s.slice(e - 2, e))) return false;
  let j = e - 2;
  while (j > 0 && /\s/.test(s[j - 1])) j--;
  return j > 0 && /\d/.test(s[j - 1]);
}

/**
 * "Bina girişi / otoparka giriş / siteye giriş / otopark çıkışı" — konaklama giriş/çıkışı değil, bir
 * KAPI. 🚨 KÖK ÖNEKİYLE eşleşir (inceleme 09-23 ölçtü): tam-kelime kümesi "otoparka", "siteye",
 * "otopark çıkışı" biçimlerini kaçırıyor ve "Otoparka giriş 23:00'ten sonra kapalıdır" mülkün giriş
 * saatiyle ÇELİŞKİ sayılıyordu → uyumlu KB'de her soru insana devrediliyordu. 09-27: "araç girişi" de
 * ("Eski Çarşı'da 19.00–24.00 araç girişi yasak" giriş saati 19:00 sayılıyordu).
 */
const PLACE_HEAD_STEMS = ["bina", "otopark", "site", "havuz", "apartman", "garaj", "park", "bahce", "lobi", "bodrum", "blok", "sokak", "resepsiyon", "arac", "araba", "vehicle"];
/** Kısa yön sözcükleri önek OLAMAZ ("on" → "onu", "ana" → "anahtar"): yalnız tam eşleşme. */
const PLACE_HEAD_EXACT = new Set(["ana", "arka", "on", "yan", "kat", "main", "back", "front", "side"]);
const isPlaceHead = (t: string) => PLACE_HEAD_EXACT.has(t) || PLACE_HEAD_STEMS.some((h) => t.startsWith(h));
/**
 * "Giriş kapısı / holü / katı / koridoru" — ARDINDAKİ ad bir YER (09-25 model kıyası: "bavullarınızı 14:00'e kadar
 * dairenin giriş holünde bırakabilirsiniz" giriş saati 14:00 sayılıyor, çelişki kapısı her giriş sorusunu tutuyordu).
 */
const ENTRY_PLACE_TAILS = ["kapi", "hol", "hall", "koridor", "kat", "lobi", "merdiven"];
/** "Girişin arkası / önü / yanı / içi" (09-27): girişin YERİ ("girişin arkasındaki kapıdan çıkınca … 08:00–22:00 açık"). */
const SPATIAL = /^(?:arka|on|yan|karsi|ic|dis|ust|alt)/;
/**
 * "Check-in help / desk / talimatı / desteği" (09-27): giriş-çıkışın kendisi değil, bir HİZMET ya da BELGE ("call us 9–21",
 * "the check-in guide at 10am", "giriş bilgilerini göndermemiz için …", "check-out checklist at 6 pm", "giriş kodu").
 */
const SERVICE_TAILS = ["help", "support", "desk", "counter", "assist", "instruction", "destek", "yardim", "talimat", "guide", "rehber", "checklist", "list", "bilgi", "info", "detail", "detay", "reminder", "hatirlat", "form", "link", "kod", "code", "mesaj", "message", "talep", "taleb", "request", "istek", "isteg", "kontuar"];
/** Kendi çalışma saati olan yerler (kalemin konaklama saatine ödünç verilmez). */
const OWN_HOURS_STEMS = ["resepsiyon", "reception", "danisma", "concierge", "ofis", "office", "lobi", "lobby", "guvenlik", "security", "kapici", "desk", "lifeguard", "cankurtaran", "gate"];
/** Valiz / bavul (09-27): bırakma ve saklama saati konaklama saati DEĞİLDİR ("storage room" de bir valiz yeridir). */
const LUGGAGE_STEMS = ["valiz", "bavul", "bagaj", "luggage", "suitcase", "baggage", "bags", "storage"];
/** Valizle YAPILAN iş: cümlecikteki saat valizin saatidir ("Çıkıştan sonra valizlerinizi 14:00'e kadar bırakabilirsiniz"). */
const LUGGAGE_ACTION_STEMS = ["birak", "sakla", "emanet", "tut", "drop", "store", "keep", "leave", "hold", "deposit"];
/** İletişim / ulaşılabilirlik (09-27): "Karşılama görevlimize 09:00–21:00 arası ulaşabilirsiniz" giriş saati değil. */
const CONTACT_STEMS = ["ulas", "iletisim", "whatsapp", "mesaj", "call", "reach", "contact", "message", "availab"];
const CONTACT_EXACT = new Set(["arayin", "arayiniz", "arayabilirsiniz", "yazin", "yaziniz", "yazabilirsiniz"]);
/**
 * GÖNDERİM (09-27): "Kodu 10:00'da gönderiyoruz", "We send the check-in guide at 10am", "kimliğinizi 18:00'e kadar iletmeniz" —
 * saat bir şeyin GÖNDERİLDİĞİ andır, hiçbir alanın saati değil.
 */
const SEND_PREFIX = /^(?:gonder|paylas|ilet(?!isim))/;
const SEND_EXACT = new Set(["send", "sends", "sent", "sending", "share", "shares", "shared", "forward", "forwards", "forwarded", "email", "emails", "emailed", "text", "texts", "texted"]);
/** Ulaşım (09-27): "the last bus leaves at 23:00", "ferry departure 17:00" — aracın kalkışı konaklama çıkışı DEĞİL. */
const TRANSPORT_STEMS = ["otobus", "dolmus", "minibus", "ferry", "feribot", "vapur", "tekne", "train", "tren", "metro", "tram", "shuttle", "servis", "flight", "ucak", "plane", "airport", "havaliman", "havaalan", "liman", "iskele", "taksi", "transfer", "cruise", "sofor", "driver", "chauffeur", "otogar", "sefer", "kalkis"];
const TRANSPORT_EXACT = new Set(["bus", "buses", "boat", "boats", "port", "pier", "taxi", "cab", "tour", "tours", "tur", "turu", "turlar", "turlari"]);
const isTransport = (t: string) => TRANSPORT_EXACT.has(t) || TRANSPORT_STEMS.some((h) => t.startsWith(h));
/**
 * Koşul kipi (09-27): koşulun İÇİNDEKİ saat bir saat BİLDİRMEZ, talimatın koşuludur — "21.00'den sonra varacaksanız",
 * "uçağınız 23:00'ten sonra inerse", "if you arrive after 22:00". Türkçede koşul fiili koşulun SONUNDADIR → cümlecik
 * fiilden sonra İKİYE bölünür: koşul parçası ("Daireden çıkmanız gerekirse") ile ana parça ("22:00'den sonra kapıyı
 * kilitleyin") ayrı okunur; "Erken gelirseniz | giriş 15:00'ten sonra yapılır"ta saat ana parçada → gerçek giriş saati.
 */
// `(?<![a-zçğıöşü])`: eşleşme SÖZCÜK başında başlar — sözcük içinden başlayan her eşleşme sözcük başından da başlar ve
// `matchAll` onu önce bulur (sonuç aynı); yoksa uzun harf dizisinde her konumdan yeniden taranıyordu (A3 09-27: 24k'da ~1,6 sn).
const TR_CONDITIONAL_VERB_G =
  /(?<![a-zçğıöşü])[a-zçğıöşü]*(?:s[ae]n[ıi]z|[aeıiuü][rz]s[ae]|(?:acak|ecek|yor)s[ae]|m[ıiuü]şs[ae]|[dt][ıiuü]ys[ae])(?![a-zçğıöşü])|(?<![a-zçğıöşü])(?:müsaitse|uygunsa|mümkünse|yoksa|değilse|boşsa|doluysa|hazırsa)(?![a-zçğıöşü])/g;
/** Kalıba uyan ama koşul OLMAYAN sözcükler ("of course", "nurse", Türkçe karaktersiz "persembe / carsamba"). */
const NOT_CONDITIONAL = new Set(["course", "nurse", "purse", "verse", "reverse", "universe", "diverse", "adverse", "converse", "traverse", "disperse", "immerse", "rehearse", "terse", "curse", "persembe", "carsamba", "kursa", "tersane"]);
/** İlk gerçek koşul fiilinin BİTİŞ konumu (yoksa -1); `tr` küçük harf dönüşümü uzunluğu korur (İ → i, I → ı). */
function conditionEnd(text: string): number {
  for (const m of text.toLocaleLowerCase("tr").matchAll(TR_CONDITIONAL_VERB_G)) {
    if (!NOT_CONDITIONAL.has(m[0])) return (m.index ?? 0) + m[0].length;
  }
  return -1;
}
function splitAtCondition(clause: string): string[] {
  const cut = conditionEnd(clause);
  if (cut < 0 || cut >= clause.trimEnd().length) return [clause];
  return [clause.slice(0, cut), clause.slice(cut)];
}
/** Metin bir Türkçe koşul fiiliyle BİTİYOR mu ("Taksi isterseniz", "Daire müsaitse"). */
const endsWithCondition = (text: string) => {
  const last = text.trimEnd().split(/\s+/).pop() ?? "";
  return last !== "" && conditionEnd(last) === last.length;
};
/**
 * Saat koşulun içinde mi: parça bir Türkçe koşul fiiliyle BİTİYOR ya da saatten önce "if you / in case / unless" var. Parça
 * başına BİR KEZ hesaplanır (A3 09-27: saat başına tüm cümleciği yeniden taramak 4.000 saatlik kalemde ~0,9 sn); dönüş
 * `/\b(?:if you|in case|unless)\b/i.test(clause.slice(0, start))` ile BİREBİR: eşleşme [0, start) içinde bitmeli — sondaki
 * `\b` dilimin sonunda kendiliğinden sağlanır, dilim içinde ise ardından sözcük-dışı karakter gelmelidir.
 */
export function conditionAt(clause: string): (start: number) => boolean {
  if (endsWithCondition(clause)) return () => true;
  let free = Infinity;
  const exact = new Set<number>();
  for (const m of clause.matchAll(/\b(?:if you|in case|unless)/gi)) {
    const e = (m.index ?? 0) + m[0].length;
    if (e >= clause.length || !/\w/.test(clause[e])) free = Math.min(free, e);
    else exact.add(e);
  }
  return (start) => free <= start || exact.has(start);
}
/** Cümlecik bir KOŞUL mu (bağlamı aynı cümlenin sonraki cümleciklerine geçer): Türkçe koşul fiiliyle biter ya da "if …" ile başlar. */
const isConditionClause = (text: string) => endsWithCondition(text) || /^\s*(?:if|in case|unless|provided|as long as)\b/i.test(text);
/** "Değilse / aksi halde / otherwise" ile başlayan cümlecik önceki koşulu KAPATIR ("Daire hazırsa 13:00'te, değilse 15:00'te"). */
const CONDITION_RESET = /^\s*(?:değilse|degilse|yoksa|aksi\s+(?:halde|takdirde|taktirde|durumda)|otherwise|else|if\s+not)\b/i;
/**
 * MÜSAİTLİK KOŞULU (09-27): "daire hazırsa / müsaitse / boşsa", "önceki gece misafir yoksa", "müsaitliğe göre", "if the flat is
 * free", "subject to availability" — koşula bağlı bir giriş/çıkış İZNİ standart saat değil, İSTİSNADIR: giriş → erken giriş,
 * çıkış → geç çıkış ("Daire hazırsa 13:00'te girebilirsiniz" mülkün 15:00'iyle çelişki DEĞİL). Misafirin kendi durumu
 * ("müsaitseniz", "if you are free") müsaitlik değildir.
 */
const EN_AVAILABILITY = [
  /\bif\s+(?:the\s+)?(?:flat|apartment|room|house|villa|property|unit|place|studio)\s+(?:is|are)\s+(?:free|ready|available|vacant|empty)\b/i,
  /\bif\s+it(?:'s|’s|\s+is)\s+(?:free|ready|available|vacant)\b/i,
  /\b(?:subject\s+to|depending\s+on|based\s+on)\s+availability\b/i,
  /\bif\s+(?:there\s+(?:is|are)\s+)?no\s+(?:other\s+)?(?:guests?|bookings?|reservations?|arrivals?)\b/i,
  /\bif\s+(?:nobody|no\s+one|no-one)\b/i,
  // 09-27 saat okuma turu: "If available, you can check in at 1 pm", "availability permitting", temizlik bitmişse; İspanyolca /
  // Fransızca / Almanca / İtalyanca müsaitlik ("sujeto a disponibilidad", "selon disponibilité", "nach Verfügbarkeit").
  /\b(?:if|when|where)\s+available\b/i,
  /\bavailability\s+permitting\b/i,
  /\bif\s+(?:the\s+)?(?:cleaning|housekeeping)\s+(?:is|has\s+been)\s+(?:done|finished|completed?|over)\b/i,
  /\b(?:sujeto\s+a|seg[úu]n|bajo)\s+(?:la\s+)?disponibilidad(?![a-zà-ÿ])/i,
  /\bsi\s+est[áa]\s+disponible(?![a-zà-ÿ])/i,
  /\b(?:selon|sous\s+r[ée]serve\s+de)\s+(?:la\s+)?disponibilit[ée](?![a-zà-ÿ])/i,
  /\bsi\s+disponible(?![a-zà-ÿ])/i,
  /\b(?:nach|je\s+nach)\s+verf[üu]gbarkeit(?![a-zà-ÿ])|\bsofern\s+verf[üu]gbar(?![a-zà-ÿ])/i,
  /\b(?:salvo|secondo)\s+(?:la\s+)?disponibilit[àa](?![a-zà-ÿ])/i,
];
function availabilityCondition(toks: readonly string[], text: string): boolean {
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const n = toks[i + 1] ?? "";
    if (/^(?:musait|hazir|bos)(?:sa|se|ise)$/.test(t)) return true;
    if (/^(?:musait|hazir|bos)$/.test(t) && /^(?:olursa|ise)$/.test(n)) return true;
    // "Müsaitliğe göre / bağlı olarak", "doluluk durumuna göre", "uygunluğa bağlı" (09-27).
    if (/^(?:musaitli|uygunlu|doluluk)/.test(t) && (n === "gore" || n.startsWith("durum") || n.startsWith("bagli"))) return true;
    // "Uygunsa / uygun olursa" — "size uygunsa" misafirin kendi tercihi, müsaitlik değil.
    if ((t === "uygunsa" || (t === "uygun" && /^(?:olursa|ise)$/.test(n))) && !["size", "sizin"].includes(toks[i - 1] ?? "")) return true;
    // "Temizlik bitmişse / tamamlanırsa", "daire temizlenmişse / hazırlanmışsa" — hazırlık koşulu.
    if (/^(?:temizlen|hazirlan)[a-z]*(?:sa|se)$/.test(t)) return true;
    if (/^temizli/.test(t) && toks.slice(i + 1, i + 3).some((x) => /^(?:bit|tamamlan|yapil)[a-z]*(?:sa|se)$/.test(x))) return true;
    if (/^(?:misafir|konuk|rezervasyon|kimse)/.test(t) && toks.slice(i + 1, i + 4).some((x) => /(?:yoksa|mazsa|mezse|m[iu]yorsa)$/.test(x))) return true;
  }
  return EN_AVAILABILITY.some((re) => re.test(text));
}
/** Bağımsız "erken / early" (bir giriş-çıkış sözcüğünü nitelemiyor): "Erken gelirseniz …", "erkenden yerleşebilirsiniz", "check in early". */
const EARLY_FREE = /^(?:erken|erkenden|early|earlier)$/;
/** Bağımsız "geç / late": "Çıkışı geç yapmak isterseniz 13:00'e kadar kalabilirsiniz". "En geç" = son saat, hariç. */
const LATE_FREE = /^(?:gec|late|later)$/;
/** Standart / olumsuz / "yine de" anlatımı: erken-geç eşlemesi YAPILMAZ ("Erken gelseniz bile giriş 15:00'te"). */
const STANDARD_EXACT = new Set(["standart", "standard", "normal", "normalde", "normally", "regular", "usual", "usually", "yine", "gene", "bile", "still", "even", "anyway", "regardless", "degil", "not", "never", "cannot", "although", "though"]);
const NEG_VERB = /(?:ama|eme|ma|me)z(?:siniz|sin|lar|ler|dir)?$/;
/** "Acil çıkış / yangın çıkışı" — konaklama ÇIKIŞI değil, bir KAPI. */
const EXIT_HEADS = new Set(["acil", "yangin", "emergency", "fire"]);
/** "Erken giriş / geç çıkış" AYRI alandır: mülkün giriş/çıkış saatiyle KIYASLANMAZ. */
const MODIFIERS: Record<string, "early" | "late"> = {
  erken: "early",
  early: "early",
  gec: "late",
  late: "late",
  // Almanca ("Später Check-out bis 13:00 Uhr", "Früh-Check-in"; 09-27 saat okuma turu).
  später: "late",
  spater: "late",
  spät: "late",
  spat: "late",
  früher: "early",
  fruher: "early",
  früh: "early",
  fruh: "early",
};
/** Addan SONRA gelen sıfat (İspanyolca / Fransızca / İtalyanca): "Check-in anticipado", "check-out tardif", "check-in anticipato". */
const POST_MODIFIERS: Record<string, "early" | "late"> = {
  anticipado: "early",
  anticipada: "early",
  temprano: "early",
  anticipé: "early",
  anticipe: "early",
  anticipée: "early",
  anticipee: "early",
  anticipato: "early",
  tardío: "late",
  tardio: "late",
  tardía: "late",
  tardia: "late",
  tardif: "late",
  tardive: "late",
  tardivo: "late",
};
const isIn = (t: string) => t.startsWith("giris") || t === "checkin" || t.startsWith("arrival");
const isOut = (t: string) => t.startsWith("cikis") || t === "checkout" || t.startsWith("departure");
/**
 * Uzatma (09-27): "müsaitse 12:00'ye kadar uzatılabilir", "check-out can be extended to 13:00" — standart çıkış değil,
 * GEÇ ÇIKIŞ seçeneğidir (mülkün 11:00'iyle çelişki sayılmaz; geç çıkış alanına okunur).
 */
const EXTENSION = /^(?:uzat|extend|extension|gecik|delay)/;
/** Konaklama saati alanları (valiz / başvuru noktası kuralları bunlara uygulanır). */
const STAY_FIELDS = new Set(["checkin", "checkout", "early_checkin", "late_checkin", "early_checkout", "late_checkout"]);
/**
 * Misafire hitap eden "çık-" biçimleri ("12:00'de çıkın", "çıkabilirsiniz", "çıkmalısınız") çıkıştır; 3. şahıs
 * ("müzisyenler çıkıyor", "otobüs çıkıyor", "süre 3 dakikaya çıkabilir") çıkış DEĞİL — ikisi de aynı köke iner.
 */
const YOU_LEAVE = /^cik(?!ar).*(?:in|iniz|niz|abilirsiniz|malisiniz)$/;
/** Olumsuz emir ("çıkmayın / çıkmayınız"): bir ÇIKIŞ talimatı değil. */
const NEG_IMPERATIVE = /m[ae]yin(?:iz)?$/;
/**
 * "Daireden 12:00'de ayrılmanız gerekmektedir", "Odadan en geç 11:00'de çıkmalısınız" (09-27): sözlük "ayrılmanız / çıkmanız"
 * biçimlerini tanımıyordu → gerçek çıkış saati okunmuyor, çelişki kaçıyordu. Konaklama YERİNDEN ayrılma (ayrılma hâli) + misafire
 * hitap eden "çık- / ayrıl-" = çıkış. Olumsuz emir ("Balkona çıkmayın") ve ulaç ("Evden çıkıp plaja…") DEĞİL.
 */
const STAY_PLACE_ABL = /^(?:daire|ev|oda|mulk|apart|konut|villa)[a-z]*(?:den|dan|ten|tan)$/;
const YOU_DEPART = /^(?:cik(?!ar)|ayril)[a-z]*(?:in|iniz|niz|abilirsiniz|malisiniz|melisiniz)$/;
/**
 * BOŞALTMA (09-27): "Çıkış günü daireyi en geç 11.00'de boşaltmanızı rica ediyoruz", "Dairenin 11:00'de boşaltılması",
 * "Please vacate the apartment by 11 am" — konaklama yerini boşaltmak çıkıştır ("çıkış günü" sözü bir GÜN olsa da).
 */
const STAY_PLACE = /^(?:daire|oda|mulk|apart|konut|villa|flat|apartment|house|property|accommodation|studio)[a-z]*$|^ev(?:i|in|iniz|inizi|imiz|imizi)?$/;
const VACATE = /^(?:bosalt|vacate)/;
/**
 * "gir-" FİİLİ (09-27): sözlükte "giriş" ile AYNI köke iner ("gir") → "Havuza 21:00'den sonra girmek yasaktır" giriş + havuz
 * sayılıp saat düşüyordu. Açık bir giriş sözcüğü yoksa fiil girişi ancak konaklama YERİNE yönelirse ("Daireye 15:00'ten sonra
 * girilebilir") ya da misafire hitap ederse ("girebilirsiniz") adlandırır; başka bir yere yönelen ("havuza / otoparka / binaya")
 * hiç adlandırmaz ve cümleciği BAŞKA konu yapar.
 */
const YOU_ENTER = /^gir(?!is)[a-z]*(?:in|iniz|niz)$/;
const STAY_PLACE_DAT = /^(?:daire|oda|mulk|apart|konut|villa)[a-z]*(?:ye|ya|e|a)$|^(?:eve|evinize|evimize)$/;
// 09-27: "Oyun odasına / çamaşır odasına" (3. şahıs iyelikli oda = başka bir oda), "oyun alanına".
const OTHER_PLACE_DAT = /^(?:bina|otopark|site|havuz|garaj|park|bahce|lobi|bodrum|blok|plaj|deniz|spor|salon|asansor|teras|cati|balkon|odasi|alan)[a-z]*(?:ye|ya|e|a)$/;
/**
 * KONAKLAMANIN BAŞI / SONU (09-27): "Konaklamanız varış günü 15:00'te başlar", "Your stay ends at 11 am" — sözlükte giriş/çıkış
 * sözcüğü yok ama saat giriş/çıkıştır. Yalnız başka bir saat alanı ya da konu yokken ("konaklamanızın ilk günü kahvaltı 08:00'de
 * başlar" kahvaltıdır).
 */
const STAY_NOUN = /^konaklama/;
const STAY_BEGIN = /^(?:basla|begin|start)/;
const STAY_END = /^(?:biter|bitiyor|bitmektedir|end|ends|finish)/;
/**
 * ERİŞİMİN BAŞLADIĞI AN (09-27): "Kapı kodu giriş günü 15:00'ten itibaren çalışır", "The keys are yours from 2 pm" — kodun /
 * anahtarın misafire açıldığı saat GİRİŞ saatidir (mülk 14:00 diyorsa misafir 14:00'te kapıda kalır: gerçek çelişki). Yalnız
 * başlangıç ("itibaren / from / after / at") okunur; bitiş ("…'e kadar geçerli") ve kapanış anlatımı hüküm üretmez.
 */
const ACCESS_NOUN = /^(?:kod|anahtar|sifre|key|keys|code|codes|lockbox|keybox)/;
const ACCESS_START = /^(?:calis|aktif|activ|gecerli|valid|work|yours|sizin|hazir|ready|teslim|alabilirsiniz|alinabilir|collect|available)/;
const ACCESS_END = /^(?:gecersiz|devre|expir|deactiv|sona|biter|bitiyor|kapan|iptal|cancel|yitir)/;
/**
 * Olumsuzlanan / biten başlangıç fiili (09-27, mutasyon incelemesi): "Kapı kodu çıkış günü 11:00'den sonra çalışmaz", "The door code
 * stops working at 11 am", "will not / won't work", "no longer works", "geçerli değildir", "geçerliliğini yitirir" — erişimin BİTTİĞİ
 * andır. Başlangıç fiili sayılınca çıkış günü saati GİRİŞ okunuyordu (mülkün 15:00 girişiyle sahte "giriş 11:00" çelişkisi).
 */
const EN_NEGATORS = new Set(["not", "never", "stop", "stops", "stopped", "cease", "ceases", "ceased"]);
const EN_NEG_CONTRACTIONS = new Set(["won", "can", "don", "doesn", "isn", "aren", "wouldn", "didn"]);
function negatedStart(toks: readonly string[], i: number): boolean {
  const next = toks[i + 1] ?? "";
  const prev = toks[i - 1] ?? "";
  const prev2 = toks[i - 2] ?? "";
  return (
    NEG_VERB.test(toks[i]) ||
    /m[iu]yor/.test(toks[i]) ||
    next.startsWith("degil") ||
    ACCESS_END.test(next) ||
    EN_NEGATORS.has(prev) ||
    (prev === "longer" && prev2 === "no") ||
    (prev === "t" && EN_NEG_CONTRACTIONS.has(prev2))
  );
}
/** Erişimin GEÇERLİ olduğu süre ("11:00'e kadar geçerlidir"): çıkış günüyle birlikte bitiş = çıkış. */
const ACCESS_VALID = /^(?:gecerli|valid|calis|work|aktif|activ)/;
/** Erişimi GERİ VERMEK ("hand back / return / leave the keys … on departure day", "anahtarları çıkış günü … bırakın"). */
const ACCESS_RETURN = /^(?:return|hand|drop|leave|birak|iade)/;
/**
 * ÇIKIŞ GÜNÜ işareti (09-27): "çıkış günü", "ayrılacağınız gün", "check-out day", "the day you leave", "son gün" — erişimin bu
 * günde BİTMESİ çıkış saatidir ("Kapı şifreniz … çıkış günü saat 11:00'de iptal edilir" → çıkış 11:00).
 */
const departureDay = (toks: readonly string[]) =>
  toks.some(
    (t, i) =>
      (/^(?:cikis|ayril)/.test(t) && /^gun/.test(toks[i + 1] ?? "")) ||
      ((t === "checkout" || t === "departure") && /^day/.test(toks[i + 1] ?? "")) ||
      (t === "son" && /^gun/.test(toks[i + 1] ?? "")) ||
      (t === "last" && toks[i + 1] === "day") ||
      (t === "day" && toks[i + 1] === "you" && /^(?:leave|depart|check)/.test(toks[i + 2] ?? "")),
  );
/**
 * SÜRE (09-27): "The flat is yours from 2 pm … until 11 am", "Daireyi 15:00'ten 11:00'e kadar kullanabilirsiniz", "the code works
 * from 3 pm until 11 am on check-out day" — konaklama yerinin / erişimin BAŞI giriş, SONU çıkıştır (tek cümlecikte iki alan; saat
 * rolüne göre ayrılır).
 */
const SPAN_VERB = /^(?:yours|sizin|sizde|kullan|use|available|calis|aktif|activ|gecerli|valid|work)/;
/** "Daireyi … teslim etmeniz" (09-27): konaklama yerini teslim ETMEK çıkıştır ("anahtarı teslim almak" değil). */
const STAY_PLACE_ACC = /^(?:daire|oda|villa|apart|mulk|konut)[a-z]*(?:yi|yu|i|u)$|^(?:evi|evinizi)$/;
/** "Yerleşebilirsiniz" (09-27): misafire hitap eden ya da konaklama yerine yönelen "yerleş-" giriştir. */
const YOU_SETTLE = /^yerles[a-z]*(?:in|iniz|niz)$/;
/**
 * Personel öznesi (09-27): "Temizlik ekibimiz 11.30'da daireye giriyor" misafirin girişi DEĞİL — "gir- / yerleş-" kuralı
 * personel öznesiyle giriş üretmez.
 */
const STAFF = /^(?:ekib|ekip|temizlikci|gorevli|personel|staff|team|cleaner|housekeep|teknisyen|usta|bekci|kapici|tamirci)/;
const WIFI = /^(?:wifi|wi|internet|modem|network|password|parola)$/;
/** "noise" köke inince durak sözcüğe ("no") düşüyor, "loud / noisy / volume" sözlükte yok → sessizlik kuralı görünmüyordu (09-27). */
const NOISE_EXTRA = new Set(["noise", "noisy", "loud", "loudly", "volume"]);
/** Sessizlik saati AÇIK ifadesi (09-27): "sessizlik saatleri", "sessiz saatler", "quiet hours / quiet time". */
const quietPhrase = (toks: readonly string[]) =>
  toks.some((t, i) => t.startsWith("sessizli") || ((t === "sessiz" || t === "quiet") && /^(?:saat|hour|time)/.test(toks[i + 1] ?? "")));
/**
 * KURAL dili (09-27): yasak / rica / uyarı / olumsuz emir. "Gece 23:00'ten sonra müzik yasaktır", "Lütfen 22:00'den sonra
 * gürültü yapmayın", "No parties after 22:00" sessizlik kuralıdır; "iskele sabahları sakin", "canlı müzik duyulabilir",
 * "plaj barı 01:00'e kadar müzik yapıyor" anlatımdır — sessizlik saati DEĞİL.
 */
const RULE_EXACT = new Set(["lutfen", "please", "must", "should", "no", "not", "avoid", "keep", "respect", "refrain", "prohibited", "forbidden", "allowed", "permitted", "curfew", "tutun", "tutunuz", "kisin", "kisiniz", "olun", "olunuz", "dikkat"]);
const RULE_PREFIX = ["yasak", "kacin", "ozen", "rica", "izin", "kural", "rule", "serbest"];
const RULE_SUFFIX = /(?:mayin|meyin|mayiniz|meyiniz|malisiniz|melisiniz|malidir|melidir|mali|meli|[iu]lmaz|[iu]lmez|nmaz|nmez)$/;
const ruleSignal = (toks: readonly string[]) =>
  toks.some((t) => RULE_EXACT.has(t) || RULE_PREFIX.some((p) => t.startsWith(p)) || RULE_SUFFIX.test(t));
/** Spor salonu yalnız açık sözcükle ("salon" = oturma odası / kuaför salonu); havuz yalnız açık sözcükle ("şezlong" plajda da). */
const GYM_WORD = /^(?:spor|fitness|gym)/;
const POOL_WORD = /^(?:havuz|pool|yuzme|swim)/;
/** Havuzun KENDİSİ değil (09-27): "havuz barı", "pool towels", "pool table" (bilardo), "havuz partisi" — saat o yerin / olayın saatidir. */
const POOL_TAILS = ["bar", "kafe", "cafe", "restoran", "restaurant", "snack", "bufe", "masa", "table", "towel", "havlu", "part", "semsiye", "umbrella", "heater", "isitic", "pump", "pompa", "filter", "filtre"];
/**
 * Başka tesis / etkinlik / bakım (09-27): "The sauna next to the gym is open 4–10 pm", "spor salonunda 19:00'da pilates dersi",
 * "Havuz pazartesi 08:00–10:00 arası bakım nedeniyle kapalı" — spor salonunun / havuzun açık olduğu saat DEĞİL.
 */
const OTHER_FACILITY = /^(?:sauna|hamam|spa|spada|spaya|steam|buhar|jakuzi|jacuzzi|tenis|tennis|bilardo|billiard)$/;
const ACTIVITY = /^(?:ders|class|lesson|pilates|yoga|kurs|course|antrenman|antrenor|trainer|training|randevu|appointment|aerobi|zumba|aqua)/;
const MAINTENANCE = /^(?:bakim(?:i|da|dan|a|lari|lar)?|maintenance|onarim|repair|repairs)$/;
const TIME_TOKEN = /^\d{2}:\d{2}$/;
/**
 * Saate yapışık ek BELİRTEÇ olmaz (09-27 saat okuma turu): "14:00'tür" → "tur" TUR (tekne turu) sanılıp cümlecik ulaşım konusu
 * oluyordu — "Varış saatimiz 14:00'tür" / "Ayrılış saatimiz 13:00'tür" hiç okunmuyordu. Belirteçler eki atılmış metinden çıkarılır;
 * saatin rolü ("…'e kadar / …'ten itibaren") HAM cümlecikten okunmaya devam eder.
 */
const TIME_SUFFIX_G = /(\d{1,2}[:.]\d{2}|\b\d{1,2})\s*['’`]\s*[a-zçğıöşü]{1,6}(?![a-zçğıöşü])|(\d{1,2}[:.]\d{2})(?!\s*[ap]\.?m\b)[a-zçğıöşü]{1,6}(?![a-zçğıöşü])/gi;
const stripTimeSuffixes = (s: string) => s.replace(TIME_SUFFIX_G, (_m, a: string | undefined, b: string | undefined) => a ?? b ?? "");
/** Sefer çizelgesi (09-27): "First departure 04:00, last departure 01:00" — bir aracın kalkışı ("ilk / son sefer" ↑TRANSPORT_STEMS). */
const SCHEDULE_HEADS = new Set(["first", "last", "next", "final", "daily", "every"]);
const schedule = (toks: readonly string[]) => toks.some((t, i) => /^departures?$/.test(t) && SCHEDULE_HEADS.has(toks[i - 1] ?? ""));
/**
 * Başka bir YERİN girişi (09-27): "Topkapı Sarayı'na giriş 09:00'da başlıyor, son giriş 17:00'de", "müzeye giriş" — gezilecek yerin
 * saati, konaklama girişi değil (aynı cümlenin sonraki "son giriş"i de o yerindir, ↓`fieldTimeHits`).
 */
const ATTRACTION = /^(?:saray|muze|museum|kale(?!m)|castle|palace|cami|mosque|kilise|church|oren|sergi|galeri|gallery|akvaryum|aquarium|carsi|bazaar|plaj|beach|hamam|restoran|restaurant|kulup|club)/;
const DATIVE_TOKEN = /^(?:y?[ae]|n[ae])$/;
/** Ziyaretçi (09-27): "Ziyaretçilerin daireye girişi 22:00'den sonra yasaktır" misafirin girişi değil, bir ZİYARET kuralıdır. */
const VISITOR = /^(?:ziyaretci|visitor)/;
const visitorSubject = (toks: readonly string[]) =>
  toks.some(
    (t, i) =>
      VISITOR.test(t) ||
      (t === "dis" && /^misafir/.test(toks[i + 1] ?? "")) ||
      (/^(?:outside|external|unregistered)$/.test(t) && /^guest/.test(toks[i + 1] ?? "")) ||
      (t === "registered" && toks[i - 1] === "non"),
  );
/**
 * ÜCRET karşılığı saat (09-27): "You can check in from 12:00 for an extra €30", "check out at 1 pm for a €20 fee" ücretli bir SEÇENEKTİR
 * (erken giriş / geç çıkış), standart saat değil; "22:00'den sonra yapılan girişler için 200 TL ek ücret" bir eşiktir. Ücretsiz
 * ("free of charge", "ücretsiz", "no extra fee") ücret değildir; "in charge" (sorumlu) değildir.
 */
const FEE_WORD = /^(?:ucret(?!siz)[a-z]*|fee|fees|surcharge|surcharges|charge|charged|charges|zuschlag|gebuhr|gebühr|supplement|suplemento|frais)$/;
const FREE_WORD = /^(?:ucretsiz|bedava|free|complimentary|gratis|gratuit|kostenlos|gratuito)$/;
const EXTRA_WORD = /^(?:extra|ek|ekstra|additional)$/;
const MONEY_RE = /[€$£₺]|\b\d+(?:[.,]\d+)?\s*(?:tl|try|eur|euro|euros|usd|gbp|lira|dolar|dollars?)\b/i;
function feeClause(toks: readonly string[], clause: string): boolean {
  if (toks.some((t) => FREE_WORD.test(t)) || /\bno\s+(?:extra\s+)?(?:fee|charge|cost)s?\b/i.test(clause)) return false;
  return toks.some((t, i) => FEE_WORD.test(t) && toks[i - 1] !== "in") || (MONEY_RE.test(clause) && toks.some((t) => EXTRA_WORD.test(t)));
}
/** Taviz (09-27): "Erken gelseniz de giriş 15:00'te", "misafir olsa da" — koşul DEĞİL, standart saat ("bile / even" ↑STANDARD_EXACT). */
const TR_CONCESSIVE = /(?<![a-zçğıöşü])(?:[a-zçğıöşü]+s[ae]n[ıi]z|olsa|gelse|kalsa|çıksa|cıksa|girse|varsa|istese|isterse|yapsa)\s+d[ae](?![a-zçğıöşü])/;
/** Pencere SONU sözü (son kabul): "en geç 22:00", "at the latest", "no later than", "latest". */
const LATEST_NEAR = /(?<![a-zçğıöşü])en\s+geç(?![a-zçğıöşü])|\bat\s+the\s+latest\b|\b(?:no|not)\s+later\s+than\b|\blatest\b/;
const latestNear = (clause: string, start: number, end: number) =>
  LATEST_NEAR.test(clause.slice(Math.max(0, start - 24), start).toLocaleLowerCase("tr")) || LATEST_NEAR.test(clause.slice(end, end + 24).toLocaleLowerCase("tr"));
const DOOR_WORD = /^(?:kapi|door|doors|gate|gates)/;
const DOOR_CLOSE = /^(?:kapan|kilitlen|close|closes|closed|closing|lock|locks|locked)/;
/** "aç-" fiilinin çekimleri (ASCII katlanmış): "açabilirsiniz / açılıyor / açın / açar" — "ac" (AC) ve "acil" (acil) SÖZCÜKLERİ hariç. */
const AC_WORDS = new Set(["ac", "acil", "acilen", "acile", "acilde", "acilden", "acilin", "acildir", "aciliyet", "aciliyeti"]);
const NEUTRAL_VERB = (t: string) => (t.startsWith("ac") && !AC_WORDS.has(t) && /^ac(?:abil|il|ar|in|iyor|ma|mak|ti|tik|ik)/.test(t)) || ["get", "gets", "come", "comes"].includes(t);
/**
 * NESNELİ "leave" (09-27, A10 #2): "Please leave used towels in the bathtub by 10 am", "leave the trash before 9 am", "leave your car until
 * 12:00" bir şeyi BIRAKMAKTIR, çıkış değil. Nesne konaklama yeri ya da erişim adıysa ("leave the apartment / the keys by 11") çıkış kalır.
 */
const LEAVE_DETERMINERS = new Set(["the", "your", "used", "all", "any", "dirty", "our", "their", "its", "a", "an"]);
const LEAVE_NOT_OBJECT = /^(?:by|at|before|until|till|no|not|on|in|from|after|around|between|and|or|early|late|promptly|premises|place|unit|home|room|rooms|building)$/;
function leaveObject(toks: readonly string[], i: number): boolean {
  let j = i + 1;
  while (LEAVE_DETERMINERS.has(toks[j] ?? "")) j++;
  const n = toks[j] ?? "";
  return n !== "" && !LEAVE_NOT_OBJECT.test(n) && !TIME_TOKEN.test(n) && !/^\d/.test(n) && !STAY_PLACE.test(n) && !ACCESS_NOUN.test(n);
}
/** Olumsuz / yasak anlatımı: "No check-in after 22:00", "22:00'den sonra giriş yapılamaz / yasaktır". */
const NEGATION_TOKEN = (t: string) => t === "no" || t === "not" || t === "never" || t === "cannot" || NEG_VERB.test(t) || /(?:mamaktadir|memektedir|yasak)/.test(t);
/**
 * "…'TEN SONRA" TÜRÜ BAŞVURU (Codex 09-27): "Çıkıştan sonra 12:00'de anahtarı bırakın", "After check-out, at 12:00, …" — başvuru
 * noktasından SONRA gelen saat çıkıştan sonraki işin anıdır, çıkışın değeri olamaz. Önce türü ("before check-out at 11:00") değerdir,
 * dokunulmaz. Metin `tr` küçük harfle aranır (uzunluk korunur → konumlar cümlecikle aynı).
 */
const AFTER_REF =
  /(?:(?<![a-zçğıöşü])(?:çıkış|giriş|varış)[a-zçğıöşü]*?(?:tan|ten|dan|den)|(?<![a-zçğıöşü])(?:çıkış|giriş)\s+(?:yap|saat)[a-zçğıöşü]*?(?:tan|ten|dan|den)|(?<![a-zçğıöşü])(?:çık|gir|ayrıl|var|gel)[a-zçğıöşü]*?(?:dıktan|dikten|duktan|dükten|tıktan|tikten|tuktan|tükten))\s+sonra(?![a-zçğıöşü])|(?<![a-z])check[\s-]?(?:out|in)\s*['’]?\s*(?:tan|ten|dan|den)\s+sonra(?![a-zçğıöşü])|\bafter\s+(?:the\s+|your\s+)?(?:check[\s-]?out|check[\s-]?in|checkout|checkin|arrival|departure)\b/;
function afterReferenceEnd(clause: string): number {
  const m = AFTER_REF.exec(clause.toLocaleLowerCase("tr"));
  return m ? m.index + m[0].length : -1;
}
/** Gün / dönem koşulu: saat o güne özgü istisnadır, koşulsuz değer değil ("hafta sonu 16:00", "16:00 on Sundays"). */
const DAY_QUALIFIER =
  /(?<![a-zçğıöşü])(?:pazartesi|salı|çarşamba|perşembe|cuma|cumartesi|pazar|hafta\s*sonu|hafta\s*içi|bayram|resmi\s+tatil|kış)[a-zçğıöşü]*|\b(?:mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?|weekends?|weekdays?|holidays?|winter|summer|high\s+season|low\s+season)\b/;
/** Saatin yanındaki sınır sözü: "en geç 22:00", "22:00 at the latest", "no later than 11 am". */
const BOUND_NEAR =
  /(?<![a-zçğıöşü])en\s+(?:geç|erken)(?![a-zçğıöşü])|\bat\s+the\s+(?:latest|earliest)\b|\b(?:no|not)\s+(?:later|earlier)\s+than\b|\bnot\s+before\b|\b(?:latest|earliest)\b/;
const boundNear = (clause: string, start: number, end: number) =>
  BOUND_NEAR.test(clause.slice(Math.max(0, start - 24), start).toLocaleLowerCase("tr")) ||
  BOUND_NEAR.test(clause.slice(end, end + 24).toLocaleLowerCase("tr"));

interface ClauseInfo {
  fields: string[];
  /** Cümlecik BAŞKA bir konudan söz ediyor → başlık / kategori ÖDÜNCÜ alınmaz. */
  otherConcept: boolean;
  /** İki alan var ya da bir alanı konu vetosu düşürdü → "ve / and" ile bölmek parçaları ayırabilir. */
  split: boolean;
  /** Geç kalış anlatımı ("çok geç … varışlarda", "22:00'den sonraki girişler"): "…'den sonra" saati eşiktir. */
  lateness: boolean;
  /** Giriş/çıkış bir BAŞVURU noktası ("çıkıştan sonra", "after check-out"): "…'e kadar" saati o alanın değeri değil. */
  reference: boolean;
  /** Uzatma anlatımı: ödünç alınan çıkış alanı geç çıkıştır. */
  extension: boolean;
  /** Giriş alanı YALNIZ erişim kuralından: "…'e kadar / until / before" saati girişin değeri değil. */
  accessOnly: boolean;
  /** Çıkış alanı YALNIZ erişim bitişinden: "…'ten itibaren / from / after" saati çıkışın değeri değil. */
  accessEndOnly: boolean;
  /** Gün kaymalı başvuru: hiçbir saat giriş/çıkış değeri değil. */
  strongReference: boolean;
  /** Süre: başlangıç saati giriş, bitiş saati çıkış (↑SPAN_VERB). */
  span: boolean;
  /** Cümlecikte erişim adı var ("kod / anahtar / key"): "ve" ile bölünen parçalara bağlam olarak geçer. */
  accessNoun: boolean;
  /** Kural dili var: "ve" ile bölünen parçalarda sessizlik kuralı buna dayanır. */
  rule: boolean;
  /** Konu vetosu (valiz / iletişim / gönderim / ulaşım / kendi saati olan yer / tesis / başka yer / kapı-gün / geç kalış / düşen alan). */
  vetoed: boolean;
  /** Ulaşım / valiz sözü: koşul cümleciğindeyse aynı cümlenin ana cümleciğinde de ödünç almayı engeller. */
  topic: boolean;
  /** Müsaitlik koşulu (↑`availabilityCondition`). */
  availability: boolean;
  /** "Konaklamanız …": "ve / and" ile bölünen parçada başla-/bit- fiili konaklamaya bağlı kalır. */
  stayNoun: boolean;
  /** Bağımsız erken / geç sözü (↑`EARLY_FREE`, `LATE_FREE`). */
  freeEarly: boolean;
  freeLate: boolean;
  /** Standart / olumsuz anlatım (↑`STANDARD_EXACT`). */
  standard: boolean;
  /** "…'ten sonra" türü başvurunun BİTTİĞİ konum (yoksa -1): ardındaki saat giriş/çıkış değeri değil (↑`AFTER_REF`). */
  afterRefEnd: number;
  /** Gün / dönem koşulu var (↑`DAY_QUALIFIER`): saatler koşulsuz sayılmaz. */
  dayQualified: boolean;
  /** Ücret karşılığı seçenek (↑`feeClause`): giriş → erken giriş, çıkış → geç çıkış; "…'den sonra" saati eşiktir. */
  fee: boolean;
  /** Başka bir yerin girişi (↑ATTRACTION): aynı cümlenin sonraki çıplak "son giriş"i de o yerindir. */
  placeEntry: boolean;
  /** Yalnız müsaitlik sözünden ibaret cümlecik ("…, subject to availability."): önceki cümleciklerin giriş/çıkışı istisnadır. */
  pureAvailability: boolean;
  /** Olumsuz / yasak anlatımı (↑NEGATION_TOKEN): "No check-in after 22:00" giriş penceresinin sonudur. */
  negation: boolean;
  /** Konaklama çapası (daire / "check-in" / misafire hitap eden gir- / yerleş-): taşınan başka-yer girişi bu cümleciğe geçmez. */
  stayAnchor: boolean;
  /** Kapının kapanma / kilitlenme saati (kapının kendi çalışma saati): aynı cümlenin sonraki cümleciği de başka konudur. */
  doorSchedule: boolean;
}

function clauseFields(clause: string, ctx: { stay?: boolean; access?: boolean; rule?: boolean; spanObj?: boolean; category?: string | null } = {}): ClauseInfo {
  const toks = tokenize(stripTimeSuffixes(clause));
  const keep: string[] = [];
  const extra: string[] = [];
  let placeEntry = false;
  // Cümlecik bir KAPI / GÜN'den söz ediyorsa ("bina girişi", "acil çıkış", "çıkış günü") başka bir
  // konudan söz ediyordur: başlığın alanı ÖDÜNÇ ALINMAZ ("Giriş" başlıklı kalemde "Bina girişi
  // 23:00'te kilitlenir" giriş saati DEĞİL — ölçüldü, ödünçle sahte çelişki üretiyordu).
  let homonym = false;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const prev = toks[i - 1] ?? "";
    const next = toks[i + 1] ?? "";
    // Saatin hemen ardındaki kısa ek belirteci ("23:00'te" → "te") bir kavram ateşlemesin
    // ("te" → çay/tea; ölçüldü: saat yazılı her parça kahve sorusuna çekiliyordu).
    if (TIME_TOKEN.test(prev) && t.length <= 3) continue;
    // "ayrılış günü" = GÜN (09-27: "giriş günü 14:00'te başlar ve ayrılış günü 11:00'de sona erer" çıkış sözcüğü sayılıp başlangıcı da
    // çıkış yapıyordu). "varış" sözlükte alan değil → gün sayılmaz (sayılsaydı yalnız ödüncü engellerdi).
    if (t.startsWith("ayrilis") && next.startsWith("gun")) {
      homonym = true;
      continue;
    }
    if (isIn(t) || isOut(t)) {
      const spatial = t === "girisin" && (SPATIAL.test(next) || (/^(?:hemen|tam)$/.test(next) && SPATIAL.test(toks[i + 2] ?? "")));
      const service = SERVICE_TAILS.some((p) => next.startsWith(p));
      // "Arrivals after 22:00 must use the key box": geç varışların SINIFI, giriş saati değil.
      const lateClass = t === "arrivals" && toks.includes("after");
      if (spatial || service || lateClass) {
        homonym = true;
        continue;
      }
      // Bağlaçla ortak baş (09-27): "Giriş ve çıkış kapısı 07:00 ve 23:00'te kilitlenir", "giriş/çıkış kapısı" — kapı / hizmet adı İKİ
      // girişe de bağlıdır; ilki de kapıdır.
      const j = /^(?:ve|and|veya|or)$/.test(next) ? i + 2 : i + 1;
      const coordHead = (isIn(toks[j] ?? "") || isOut(toks[j] ?? "")) && toks[j] !== t ? toks[j + 1] ?? "" : "";
      if (coordHead && [...ENTRY_PLACE_TAILS, ...SERVICE_TAILS, "door", "gate", "exit"].some((p) => coordHead.startsWith(p))) {
        homonym = true;
        continue;
      }
      // Başka bir yerin girişi: "Topkapı Sarayı'na giriş", "müzeye giriş" (↑ATTRACTION).
      if (isIn(t) && (ATTRACTION.test(prev) || (DATIVE_TOKEN.test(prev) && ATTRACTION.test(toks[i - 2] ?? "")))) {
        homonym = true;
        placeEntry = true;
        continue;
      }
      // "ön" katlanınca İngilizce "on" olur: yer başı yalnız Türkçe giriş/çıkışta ("on arrival / on departure day" yer değil).
      const placeBefore = isPlaceHead(prev) && !(prev === "on" && !/^(?:giris|cikis)/.test(t));
      if (isIn(t) && (placeBefore || ENTRY_PLACE_TAILS.some((p) => next.startsWith(p)))) {
        homonym = true;
        continue;
      }
      // Başka bir şeyin girişi (09-27): "Check-in for the sunset boat tour", "tekne turu için giriş", "airport check-in"; Konum
      // kalemindeki Türkçe giriş/çıkış bir YERİN girişi/çıkışıdır ("metro istasyonunun çıkışı 22:00'de kapanıyor").
      const transportScoped =
        isTransport(prev) ||
        (next === "for" && toks.slice(i + 2, i + 7).some(isTransport)) ||
        (toks.slice(Math.max(0, i - 3), i).includes("icin") && toks.slice(Math.max(0, i - 6), i).some(isTransport));
      if (transportScoped || (ctx.category === "location" && /^(?:giris|cikis)/.test(t))) {
        homonym = true;
        continue;
      }
      // "Çıkış kapısı" yalnız YALIN biçimde kapıdır ("Çıkışta kapıyı kilitleyin" konaklama çıkışıdır).
      // 09-27: "otobüs çıkışı / ferry departure" da aracın kalkışıdır.
      if (isOut(t) && (EXIT_HEADS.has(prev) || placeBefore || ((t === "cikis" || t === "exit") && next.startsWith("kapi")))) {
        homonym = true;
        continue;
      }
      // "giriş günü / çıkış günü / departure day" = GÜN, saat değil. 09-27: gün BÖLÜMÜ de ("çıkış sabahı kahvaltı 08:00'de",
      // "giriş akşamı"; iyelikli biçim — yalın "Çıkış sabah 11'de" saatin nitelemesidir, dokunulmaz).
      if (
        next.startsWith("gun") ||
        next === "day" ||
        next === "days" ||
        /^(?:sabahi|aksami|gecesi|oglesi)/.test(next) ||
        (/^(?:checkout|checkin|departure|arrival)$/.test(t) && /^(?:morning|evening|night)$/.test(next))
      ) {
        homonym = true;
        continue;
      }
      // SON KABUL (09-27): "latest / last check-in", "son giriş", "en geç giriş" = giriş penceresinin SONU (geç giriş alanı), başlangıç
      // saati değil ("Latest check-in is 10 pm" mülkün 15:00'iyle sahte çelişkiydi). "En geç çıkış" ise çıkış saatinin kendisidir.
      if (isIn(t) && (prev === "latest" || prev === "last" || prev === "son" || (prev === "gec" && toks[i - 2] === "en"))) {
        if (!extra.includes("late_checkin")) extra.push("late_checkin");
        continue;
      }
      // "en geç çıkış" = en son çıkış saati (çıkış alanı); "geç çıkış" = ayrı alan. Addan sonraki sıfat da ("Check-in anticipado").
      const mod = (toks[i - 2] !== "en" ? MODIFIERS[prev] : undefined) ?? POST_MODIFIERS[next];
      if (mod) {
        const f = `${mod}_${isIn(t) ? "checkin" : "checkout"}`;
        if (!extra.includes(f)) extra.push(f);
        continue;
      }
    }
    keep.push(t);
  }
  const stems = contentStems(keep.join(" "));
  const units = phraseUnits(keep.join(" "));
  const mentions = timeMentions(clause);
  // GENEL FİİL "başka konu" değildir (09-27, A10 #1): "Kapıyı 14:00'ten itibaren açabilirsiniz" → "aç-" klimanın "ac"ına, "Kapı 14:00'te
  // açılıyor" → "acil"e, "You can get in from 2 pm" → "get" adres kalıbına iniyordu → başlığın giriş alanı ödünç alınmıyor, mülkün 15:00'iyle
  // GERÇEK çelişki kaçıyordu. Bu belirteçler yalnız "başka konu" sayımından çıkar (alan sözlüğü aynen görür); "AC" / "acil" sözcükleri kalır.
  const foreignStems = contentStems(keep.filter((t) => !NEUTRAL_VERB(t)).join(" "));
  const foreign = matchConcepts(foreignStems, { loose: true })
    .filter((m) => !m.concept.timeField)
    .map((m) => m.concept.id);
  const transport = toks.some(isTransport) || schedule(toks);
  // Çıkış ALANI yalnız açık bir çıkış sözcüğüyle: "çık-" fiilinin 3. şahsı ve İngilizce "leaves / departures" (bir aracın,
  // bir programın kalkışı) çıkış sözcüğüyle aynı köke iner; "leave / departure" de ulaşım cümleciğinde çıkış değil.
  const outWord = toks.some(
    (t, i) =>
      t.startsWith("cikis") ||
      t === "checkout" ||
      (t === "check" && toks[i + 1] === "out") ||
      // "yola çıkın" (yolculuğa başlamak) ve havalimanına varmak için çıkmak çıkış değil (09-27); DAİREDEN çıkmak çıkıştır.
      (YOU_LEAVE.test(t) && !/^yol/.test(toks[i - 1] ?? "") && !(transport && !toks.some((x) => STAY_PLACE_ABL.test(x)))) ||
      (!transport && (t.startsWith("ayril") || ((t === "leave" || t === "leaving") && !leaveObject(toks, i)) || t === "departure")),
  );
  const luggage = toks.some((t) => LUGGAGE_STEMS.some((h) => t.startsWith(h)));
  const luggageAction = luggage && toks.some((t) => LUGGAGE_ACTION_STEMS.some((h) => t.startsWith(h)));
  let lexical = timeFieldsIn(stems, units);
  // "gir-" fiili (↑YOU_ENTER): açık giriş sözcüğü yoksa yalnız konaklama yerine / misafire hitapla giriştir.
  const otherPlace = toks.some((t) => OTHER_PLACE_DAT.test(t));
  // Yalnız giriş kanıtı bir "gir-" fiiliyse (açık giriş sözcüğü yok): "Checking in after 15:00" gibi başka kanıt dokunulmaz.
  const enterVerbOnly = !keep.some((t) => isIn(t)) && toks.some((t) => /^gir(?!is)/.test(t));
  const staff = toks.some((t) => STAFF.test(t));
  if (lexical.includes("checkin") && enterVerbOnly) {
    // Olumsuz emir ("girmeyin") burada ayrıca elenmez (09-27 mutasyon incelemesi): kök sökücü onu "gir"e indirmez, yani giriş
    // kanıtı hep BAŞKA bir "gir-" biçiminden gelir ("15:00'ten önce girmek yasaktır lütfen girmeyin" = giriş 15:00).
    const enters = toks.some((t) => YOU_ENTER.test(t) || (STAY_PLACE_DAT.test(t) && !staff));
    if (!enters || otherPlace) lexical = lexical.filter((f) => f !== "checkin");
  }
  const settles =
    !lexical.includes("checkin") &&
    toks.some((t) => /^yerles/.test(t)) &&
    (toks.some((t) => YOU_SETTLE.test(t) && !NEG_IMPERATIVE.test(t)) || (toks.some((t) => STAY_PLACE_DAT.test(t)) && !staff));
  if (settles) lexical = [...lexical, "checkin"];
  // "temizlemeye / temizlenir" fiili sözlükte temizlik kavramına inmiyor (09-27: "odanızı 10:00-12:00 arası temizlemeye gelir").
  if (!lexical.includes("cleaning") && toks.some((t) => /^temizle/.test(t))) lexical = [...lexical, "cleaning"];
  if (!lexical.includes("quiet_hours") && toks.some((t) => NOISE_EXTRA.has(t))) lexical = [...lexical, "quiet_hours"];
  const handOver = toks.some((t, i) => t === "teslim" && /^(?:et|ed)/.test(toks[i + 1] ?? "")) && toks.some((t) => STAY_PLACE_ACC.test(t));
  const vacate = (toks.some((t) => VACATE.test(t) && !NEG_IMPERATIVE.test(t)) && toks.some((t) => STAY_PLACE.test(t))) || handOver;
  const departing = departureDay(toks);
  const youDepart = toks.some((t) => YOU_DEPART.test(t) && !NEG_IMPERATIVE.test(t));
  // "Çıkış günü en geç 11:00'de ayrılmanız gerekiyor" (09-27): çıkış GÜNÜ misafire hitap eden ayrıl- / çık- da çıkıştır.
  const departsStay = !lexical.includes("checkout") && (vacate || (youDepart && (toks.some((t) => STAY_PLACE_ABL.test(t)) || departing)));
  const stayNoun = toks.some((t) => STAY_NOUN.test(t) || t === "stay");
  const facility = toks.some((t, i) => OTHER_FACILITY.test(t) || MAINTENANCE.test(t) || (ACTIVITY.test(t) && toks[i - 1] !== "of"));
  // Başka bir özne (ders / tesis) varsa başla- / bit- onundur: "During your stay, yoga classes start at 8 am" (09-27).
  const stayScope = (stayNoun || ctx.stay === true) && lexical.length === 0 && foreign.length === 0 && !facility;
  const stayBegin = stayScope && toks.some((t) => STAY_BEGIN.test(t));
  const stayEnd = stayScope && toks.some((t, i) => STAY_END.test(t) || (t === "sona" && /^er/.test(toks[i + 1] ?? "")));
  const roles = mentions.map((m) => timeRole(clause, m.start, m.end));
  const accessNoun = toks.some((t) => ACCESS_NOUN.test(t));
  const accessFree = foreign.every((id) => id === "keys" || id === "credentials") && !toks.some((t) => WIFI.test(t)) && !luggage;
  const endVerb = toks.some((t, i) => ACCESS_END.test(t) || (ACCESS_START.test(t) && negatedStart(toks, i)));
  // Gün niteleyicisi olmayan iki uçlu erişim penceresi GÜNLÜKTÜR ("The gate code works from 7 am to 11 pm", "Bina kapısının kodu
  // 07:00–23:00 arası çalışır"; 09-27): girişin başladığı an değil. Giriş / çıkış GÜNÜYLE süre ise ↓span.
  const dailyWindow = rangeEnds(clause, mentions).size >= 2 && !departing && !toks.some((t, i) => isIn(t) && /^gun/.test(toks[i + 1] ?? ""));
  const accessStart =
    lexical.length === 0 &&
    accessFree &&
    accessNoun &&
    !dailyWindow &&
    toks.some((t, i) => ACCESS_START.test(t) && !negatedStart(toks, i)) &&
    (!endVerb || departing) &&
    roles.some((r) => !r.until && !r.before);
  // Erişimin ÇIKIŞ GÜNÜ bitmesi = çıkış ("… çıkış günü saat 11:00'de iptal edilir", "çıkış günü 11:00'e kadar geçerlidir").
  const accessEnd =
    !lexical.includes("checkout") &&
    accessFree &&
    (accessNoun || ctx.access === true) &&
    departing &&
    (endVerb || toks.some((t) => ACCESS_RETURN.test(t)) || (toks.some((t) => ACCESS_VALID.test(t)) && roles.some((r) => r.until)));
  const stayPlaceTok = toks.some((t) => STAY_PLACE.test(t) || STAY_PLACE_ACC.test(t));
  const span =
    // Başka bir alanın öznesi varsa süre onundur: "Villanın havuzu 09:00'dan 20:00'ye kadar kullanılabilir" havuz saatidir (09-27).
    !lexical.some((f) => !STAY_FIELDS.has(f)) &&
    (accessNoun || ctx.spanObj === true || stayPlaceTok) &&
    toks.some((t) => SPAN_VERB.test(t)) &&
    roles.some((r) => r.from || r.after) &&
    // "The apartment is yours from 2 pm and must be vacated by 11 am": konaklama yerinde "by" da bitiştir.
    roles.some((r) => r.until || (r.by && (vacate || stayPlaceTok)));
  const extension = toks.some((t) => EXTENSION.test(t));
  const raw = [
    ...lexical,
    ...(departsStay || stayEnd || accessEnd ? ["checkout"] : []),
    ...(stayBegin || accessStart ? ["checkin"] : []),
    ...extra,
  ].map((f) => (extension && f === "checkout" ? "late_checkout" : f));
  // "available" iletişim penceresidir ("Our team is available from 9 am to 9 pm") ama öznesi giriş / çıkışsa değil ("Check-in is
  // available from 2 pm to 10 pm"); "contactless check-in" iletişim değil (09-27).
  const stayLexical = lexical.some((f) => STAY_FIELDS.has(f));
  const contact = toks.some(
    (t) => CONTACT_EXACT.has(t) || (t !== "contactless" && CONTACT_STEMS.some((h) => t.startsWith(h) && (h !== "availab" || !stayLexical))),
  );
  // İletişim PENCERESİ: iletişim sözü + aralık / "…'e kadar" ("temizlik ekibimize 09:00-18:00 arası yazabilirsiniz").
  const contactWindow = contact && (mentions.length >= 2 || mentions.some((m) => timeRole(clause, m.start, m.end).until));
  const sending = toks.some((t) => SEND_PREFIX.test(t) || SEND_EXACT.has(t));
  const visitor = visitorSubject(toks);
  const poolOk = toks.some((t, i) => POOL_WORD.test(t) && !POOL_TAILS.some((p) => (toks[i + 1] ?? "").startsWith(p) || (toks[i + 2] ?? "").startsWith(p)));
  // Havuz / spor salonu YER olarak ("havuz başında kahvaltı 08:00-10:30", "breakfast by the pool"): saat oradaki başka işin saatidir.
  const facilityAsPlace =
    foreign.length > 0 &&
    toks.some((t, i) => {
      if (!POOL_WORD.test(t) && !GYM_WORD.test(t) && t !== "poolside") return false;
      const locative = (w: string | undefined) => !!w && /(?:da|de|ta|te)$/.test(w);
      const near = ["at", "by", "in", "beside", "near", "around"];
      return (
        t === "poolside" ||
        locative(t) ||
        (/^(?:bas|kenar|salon|alan|yan|etraf)/.test(toks[i + 1] ?? "") && locative(toks[i + 1])) ||
        near.includes(toks[i - 1] ?? "") ||
        (toks[i - 1] === "the" && near.includes(toks[i - 2] ?? ""))
      );
    });
  // "Dry cleaner / kuru temizleme" bir DÜKKAN; "temizlik malzemesi" bir ÜRÜN — dairenin temizlik saati değil.
  const cleaningShop = toks.some(
    (t, i) =>
      (t === "dry" && /^clean/.test(toks[i + 1] ?? "")) ||
      (t === "kuru" && /^temiz/.test(toks[i + 1] ?? "")) ||
      (/^(?:temizlik|cleaning)/.test(t) && /^(?:malzeme|supplies|supply|product|urun)/.test(toks[i + 1] ?? "")),
  );
  const fields = raw.filter(
    (f) =>
      (f !== "checkout" || outWord || vacate || stayEnd || accessEnd) &&
      (f !== "quiet_hours" || quietPhrase(toks) || ruleSignal(toks) || ctx.rule === true) &&
      (f !== "gym" || (toks.some((t) => GYM_WORD.test(t)) && !facility && !facilityAsPlace)) &&
      (f !== "pool" || (poolOk && !facility && !facilityAsPlace)) &&
      (f !== "cleaning" || !cleaningShop) &&
      !(luggageAction && STAY_FIELDS.has(f)) &&
      !(visitor && STAY_FIELDS.has(f)) &&
      !contactWindow &&
      !sending,
  );
  // Kapının kapanma / kilitlenme saati (09-27, A10 ikizi): "Kapılar 23:00'te kapanır, 07:00'de açılır" kapının kendi çalışma saatidir, giriş
  // saati değil (eski okuyucu giriş kaleminde 07:00 ve 23:00'i giriş saati sayıp sahte çelişki üretiyordu). Aynı cümlenin sonraki
  // cümleciğine de geçer (↓`fieldTimeHits`). "Kapıyı 14:00'ten itibaren açabilirsiniz" (misafire hitap) etkilenmez.
  const doorSchedule = toks.some((t) => DOOR_WORD.test(t)) && toks.some((t) => DOOR_CLOSE.test(t));
  // Kendi çalışma saati olan yerler sözlükte kavram değil ama konaklama saati de DEĞİL: "Giriş"
  // başlıklı kalemde "Resepsiyon 09:00-18:00 arası açıktır" giriş saati sanılıyordu (ölçüldü 09-23).
  const ownHours =
    toks.some((t) => OWN_HOURS_STEMS.some((h) => t.startsWith(h))) ||
    doorSchedule ||
    // Bina / sokak kapısının açık olduğu saat ("bina kapısı ise 07:00–23:00 arası açık", "the main door").
    toks.some((t, i) => /^(?:kapi|door)/.test(t) && (isPlaceHead(toks[i - 1] ?? "") || ["main", "front", "street", "sokak"].includes(toks[i - 1] ?? "")));
  // "Çok geç (01.00 sonrası) varışlarda", "22:00'den sonraki varışlarda / girişler": geç kalışı anlatır ("en geç" = son saat,
  // hariç; "Girişler 14:00'ten sonra yapılabilir" SONRAKİ değil → gerçek giriş saati kalır).
  const lateness =
    toks.some((t, i) => t === "gec" && toks[i - 1] !== "en") ||
    (toks.includes("sonraki") && toks.some((t) => /^(?:varis|gelis|giris|arrival|checkin)/.test(t)));
  // Başvuru noktası: "çıkıştan sonra", "varıştan bir gün önce", "çıkmadan önce", "check-out saatinden sonra", "after check-out".
  const reference = toks.some((t, i) => {
    const n1 = toks[i + 1] ?? "";
    const n2 = toks[i + 2] ?? "";
    const rel = (w: string | undefined) => w === "sonra" || w === "once";
    if (/^(?:cikis|giris|varis)[a-z]*(?:tan|ten|dan|den)$/.test(t) && [n1, n2, toks[i + 3]].some(rel)) return true;
    if (/^(?:cik|gir|ayril|var|gel)[a-z]*(?:madan|meden|dikten|diktan|tikten|tiktan|dukten|duktan)$/.test(t) && rel(n1)) return true;
    if ((t.startsWith("cikis") || t.startsWith("giris") || t === "checkout" || t === "checkin") && /^(?:yap|saat)[a-z]*(?:tan|ten|dan|den)$/.test(n1) && rel(n2)) return true;
    // "Check-out'tan sonra" (09-27): kesme işaretli ek ayrı belirteçtir.
    if ((t === "checkout" || t === "checkin") && /^(?:tan|ten|dan|den)$/.test(n1) && rel(n2)) return true;
    if ((t === "after" || t === "before") && /^(?:checkin|checkout|arrival|departure)$/.test(n1 === "the" || n1 === "your" ? n2 : n1)) return true;
    return false;
  });
  // Gün kaymalı başvuru ("varıştan bir gün önce", "the day after arrival", "the evening before you leave"): saat başka bir işin
  // saatidir — hiçbir rolde giriş/çıkış değeri değildir.
  const strongReference = reference && toks.some((t) => /^(?:day|days|gun|evening|aksam|night|gece|morning|sabah)$|^gun[a-z]{0,2}$/.test(t));
  // Saatsiz parantez ve "or / veya" ile gelen karşılaştırma bir SEÇENEĞİ anlatır, dışarıdaki saati erken / geç yapmaz (09-27: "Check-in
  // from 3 pm (earlier on request)" mülkün 14:00'üyle gerçek çelişkiyi erken giriş sayıp gizliyordu).
  const outerClause = clause.replace(/\(([^()]*)\)/g, (m0, inner: string) => (scanTimes(inner).length > 0 ? m0 : " "));
  const outerToks = outerClause === clause ? toks : tokenize(stripTimeSuffixes(outerClause));
  const alternative = (i: number) => ["or", "veya", "yada"].includes(outerToks[i - 1] ?? "") || (outerToks[i - 1] === "da" && outerToks[i - 2] === "ya");
  const freeEarly = outerToks.some(
    (t, i) =>
      EARLY_FREE.test(t) &&
      !["en", "the"].includes(outerToks[i - 1] ?? "") &&
      !alternative(i) &&
      !isIn(outerToks[i + 1] ?? "") &&
      !isOut(outerToks[i + 1] ?? "") &&
      outerToks[i + 1] !== "check",
  );
  const freeLate = outerToks.some(
    (t, i) =>
      LATE_FREE.test(t) &&
      outerToks[i - 1] !== "en" &&
      !alternative(i) &&
      !isIn(outerToks[i + 1] ?? "") &&
      !isOut(outerToks[i + 1] ?? "") &&
      outerToks[i + 1] !== "check",
  );
  const standard = toks.some((t) => STANDARD_EXACT.has(t) || NEG_VERB.test(t)) || TR_CONCESSIVE.test(clause.toLocaleLowerCase("tr"));
  // `loose`: yalnız-genişletme sözcükleri ("merdiven", "alarm", "depo"…) de BAŞKA KONU sayılır — sözlüğün katı tespiti
  // retrieval içindir, bu sezgi 09-26 ayrımından önceki hâliyle aynı kalır ("Merdiven kapısı 23:00'te kilitlenir" giriş saati değil).
  // 09-27: bir alan yukarıdaki kurallarla DÜŞTÜYSE cümlecik yine başka bir şeyden söz ediyordur ("müzisyenler çıkıyor" bir
  // giriş kaleminde giriş saati olmasın); ulaşım, gönderim ve başka bir yere "gir-" de başka konudur.
  const otherConcept =
    homonym ||
    ownHours ||
    luggageAction ||
    contact ||
    sending ||
    transport ||
    otherPlace ||
    facility ||
    lateness ||
    visitor ||
    fields.length < raw.length ||
    foreign.length > 0;
  const availability = availabilityCondition(toks, clause);
  return {
    fields: [...new Set(fields)],
    otherConcept,
    // Bir alanı KONU vetosu (valiz / iletişim penceresi / gönderim) düşürdüyse aynı cümlecikteki gerçek saat "ve / and" ile
    // ayrılabilir ("Valizlerinizi bırakabilirsiniz ve 15:00'te giriş yapabilirsiniz"). Sözcük süzgecinin düşürdüğü sahte eşleşme
    // ("salonda" → spor salonu) bölme sebebi DEĞİL: "07.00'den önce koridorda ve salonda sesi düşük tutun" tek kuraldır.
    split: fields.length > 1 || raw.some((f) => (luggageAction && STAY_FIELDS.has(f)) || contactWindow || sending),
    lateness,
    reference,
    strongReference,
    extension,
    accessOnly: accessStart,
    accessEndOnly: accessEnd,
    span,
    accessNoun,
    rule: ruleSignal(toks),
    vetoed:
      homonym ||
      ownHours ||
      luggageAction ||
      contact ||
      sending ||
      transport ||
      otherPlace ||
      facility ||
      lateness ||
      visitor ||
      fields.length < raw.length,
    topic: transport || luggage,
    availability,
    stayNoun,
    freeEarly,
    freeLate,
    standard,
    afterRefEnd: reference ? afterReferenceEnd(clause) : -1,
    dayQualified: DAY_QUALIFIER.test(clause.toLocaleLowerCase("tr")),
    fee: feeClause(toks, clause),
    placeEntry,
    pureAvailability: availability && raw.length === 0 && foreign.length === 0 && mentions.length === 0 && toks.length <= 5,
    negation: toks.some(NEGATION_TOKEN),
    doorSchedule,
    stayAnchor: toks.some(
      (t) =>
        STAY_PLACE.test(t) ||
        STAY_PLACE_DAT.test(t) ||
        STAY_PLACE_ABL.test(t) ||
        STAY_PLACE_ACC.test(t) ||
        t === "checkin" ||
        t === "checkout" ||
        YOU_ENTER.test(t) ||
        YOU_SETTLE.test(t),
    ),
  };
}

/** Cümlecikteki saat geçişleri, konumlarıyla (`timesIn` ile AYNI tarayıcı) — bağlam kuralları saatin önüne/ardına bakar. */
const timeMentions = (clause: string): TimeMention[] => scanTimes(clause);

/**
 * Metin bir saat taşıyabilir mi: `scanTimes`in her kalıbı bir RAKAM ya da "noon / midday / midnight / gece yarısı" ister. Taşıyamayan
 * metnin hiçbir parçası da taşıyamaz (parçalar alt dizidir).
 */
const NOON_WORD = /noon|midday|midnight|gece\s+yar/i;
const mayHoldTime = (s: string): boolean => /\d/.test(s) || NOON_WORD.test(s);

/**
 * Aralığın uçları: iki saat arasında yalnız tire / "ile / ve / and / to / until" (ve ilk saatin eki) var — "10:00–20:00",
 * "15:00 ile 22:00", "between 2 pm and 5 pm", "11:00'den 14:00'e".
 */
const RANGE_GAP = /^\s*(?:['’`]\s*[a-zçğıöşü]{1,4}\s*)?(?:[-–—]|ile|ve|and|to|till|until)?\s*$/i;
function rangeEnds<M extends { start: number; end: number }>(clause: string, mentions: readonly M[]): Set<M> {
  const out = new Set<M>();
  const sorted = [...mentions].sort((a, b) => a.start - b.start);
  for (let j = 1; j < sorted.length; j++) {
    // Boşluk dizileri teke indirilir: kalıbın her boşluğu `\s*` → sonuç aynı; uzun boşlukta karesel geri izleme olmaz (A3 09-27).
    if (!RANGE_GAP.test(clause.slice(sorted[j - 1].end, sorted[j].start).replace(/\s+/g, " "))) continue;
    out.add(sorted[j - 1]);
    out.add(sorted[j]);
  }
  return out;
}

/** Saatin ardındaki sözcük ("14:00'e kadar", "11:00 sonrası", "15:00'ten önceki / itibaren") ya da önündeki ("until / after / before / from"). */
function timeRole(clause: string, start: number, end: number): { until: boolean; after: boolean; before: boolean; from: boolean; by: boolean } {
  const tail = clause.slice(end, end + 16).toLocaleLowerCase("tr");
  const head = clause.slice(Math.max(0, start - 10), start).toLocaleLowerCase("en");
  const suffixThen = (w: string) => new RegExp(`^\\s*(?:['’\`]\\s*)?[a-zçğıöşü]{0,4}\\s*${w}`).test(tail);
  return {
    until: suffixThen("kadar") || /\b(?:until|till|up to)\s*$/.test(head),
    after: suffixThen("sonra") || /\bafter\s*$/.test(head),
    before: suffixThen("önce") || /\bbefore\s*$/.test(head),
    // "16:00'dan … 10:00'a kadar": ablatif tek başına "…'den" başlangıçtır ("…'ten sonra / önce / itibaren" kendi rolünde).
    // "itibaren / itibarıyla / itibariyle" (09-27: "15:00 itibarıyla" başlangıç sayılmıyordu).
    from: suffixThen("itibar") || /\bfrom\s*$/.test(head) || /^\s*['’`]?\s*(?:dan|den|tan|ten)(?![a-zçğıöşü])(?!\s*(?:sonra|önce|itibar))/.test(tail),
    by: /\bby\s*$/.test(head),
  };
}

/**
 * Saatin alanın DEĞERİ olmadığı durumlar (09-27): geç çıkış / geç girişte "11:00 sonrası" standart saattir (sınır),
 * erken girişte "15:00'ten önceki" de öyle; başvuru noktası cümleciğinde ("çıkıştan sonra … 14:00'e kadar") "kadar"
 * saati başka bir işin saatidir; koşulun İÇİNDEKİ saat ve geç kalış cümleciğinde "22:00'den sonra" eşiktir; erişim
 * kuralından gelen girişte yalnız başlangıç saati okunur.
 */
function excludedTime(
  field: string,
  role: ReturnType<typeof timeRole> & { inCondition: boolean; range: boolean; afterRef: boolean },
  info: ClauseInfo,
): boolean {
  if ((field === "checkin" || field === "checkout") && role.afterRef) return true;
  if ((field === "late_checkout" || field === "late_checkin") && role.after) return true;
  if ((field === "early_checkin" || field === "early_checkout") && role.before) return true;
  if (STAY_FIELDS.has(field) && role.inCondition) return true;
  // Başvuru noktasından sonraki ARALIK başka işin penceresidir ("çıkıştan sonra 10:00–20:00 arası …", 09-27 mutasyon incelemesi);
  // aynı cümlecikte "at 11:00" gibi tek saat alanın değeri olarak kalır.
  if ((field === "checkin" || field === "checkout") && info.reference && (role.until || role.by || role.range || info.strongReference)) return true;
  if ((field === "checkin" || field === "checkout") && info.lateness && role.after) return true;
  if (field === "checkin" && info.accessOnly && (role.until || role.before)) return true;
  if (field === "checkout" && info.accessEndOnly && (role.from || role.after)) return true;
  return false;
}

/**
 * SAAT → ALAN ATFI. Metin cümlelere, cümle cümleciklere ayrılır; her saat içinde geçtiği CÜMLECİĞİN alanına bağlanır.
 * Cümlecik iki alan adlandırıyorsa (ya da bir alanı kuralla düştüyse) "ve/and/&" ile bir kez daha, ardından koşul fiilinden
 * bölünür; hâlâ birden çok alan varsa saat HİÇBİR alana atfedilmez (belirsizde hüküm yok). Cümlecik alan adlandırmıyorsa
 * başlığın TEK alanı ödünç alınır — ama cümlecik BAŞKA bir konudan söz ediyorsa ("Kahvaltı 08:00'de") ödünç ALINMAZ.
 * 09-27 bağlam kuralları: koşul parçasındaki ulaşım / valiz sözü ana parçada da ödüncü engeller ("Havalimanı transferi
 * ayarladıysanız şoför 10:30'da bekliyor"); müsaitlik koşulu ya da bağımsız "erken / geç" sözü giriş/çıkışı erken giriş /
 * geç çıkış yapar ("Daire hazırsa 13:00'te girebilirsiniz") — standart / olumsuz anlatımda yapmaz.
 */
export function fieldTimeHits(title: string, text: string, category?: string | null): FieldTimeHit[] {
  // YEREL TAVSİYE (09-27, kör batarya): kalem mahalleyi anlatır — "Kaleye giriş 09:00-19:00, son giriş 18:30", "belediyenin kapalı
  // havuzu 07:00-22:00", "spor merkezi 06:00-24:00" mülkün giriş / havuz / spor salonu saati DEĞİL (mülk saatiyle sahte çelişki).
  if (category === "local_tips") return [];
  // Saat RAKAMLA yazılır (SS:DD, S am/pm, "saat S") ya da "noon / midnight / gece yarısı" → ikisi de yoksa okuma yok; boşuna tam tarama
  // yapılmaz (A3 09-27).
  if (!mayHoldTime(text)) return [];
  const key = hitsCacheKey(title, text, category);
  const cached = hitsCache.get(key);
  if (cached) {
    hitsCache.delete(key);
    hitsCache.set(key, cached);
    return cached.hits.map((h) => ({ ...h }));
  }
  const hits = readFieldTimeHits(title, text, category);
  const chars = title.length + text.length;
  if (chars <= hitsCacheLimits.chars) {
    hitsCache.set(key, { hits: hits.map((h) => ({ ...h })), chars });
    hitsCacheChars += chars;
    for (const [oldKey, old] of hitsCache) {
      if (hitsCache.size <= hitsCacheLimits.entries && hitsCacheChars <= hitsCacheLimits.chars) break;
      hitsCache.delete(oldKey);
      hitsCacheChars -= old.chars;
    }
  }
  return hits;
}

/**
 * SONUÇ ÖNBELLEĞİ (09-28 CPU denetimi, ölçüldü): okuyucu doğrusal ama pahalı (~10–16 µs/karakter) ve aynı metni tekrar tekrar
 * okuyordu — dizin her 10 dakikada bir parça parça, Bilgi Tabanı sayfası her açılışta tüm mülklerin kalemlerini, istem her cevapta.
 * 60 kalemlik gerçekçi bir bilgi tabanının dizini 1,4 sn, kötü niyetli içerik (60 × 20k) 20 sn olay döngüsünü kilitliyordu (ortak
 * sunucu, tüm kiracılar). Sonuç yalnız başlık + metin + kategoriye bağlıdır (saf fonksiyon) → anahtar üçünün SHA-256 özeti: aynı
 * girdi aynı sonucu verir, kiracılar arası sızıntı olamaz (içerik başka kiracıda da aynıdır). Kodlama `JSON.stringify` (sınırlar
 * belirsiz değil, yalnız vekil karakterler kaçışlı); kategori yoksa `null` (okuyucu `undefined` ile `null`u ayırmaz). Sınır: 2.000
 * giriş + toplam 4M karakter girdi (atıflar metnin parçalarını taşır), en uzun süre kullanılmayan çıkar. Dönüş her çağrıda YENİ
 * kopya — çağıran değiştirse de önbellek bozulmaz. Süreç başınadır; açılışta boş.
 */
const HITS_CACHE_LIMITS = Object.freeze({ entries: 2000, chars: 4_000_000 });
let hitsCacheLimits: { entries: number; chars: number } = HITS_CACHE_LIMITS;
const hitsCache = new Map<string, { hits: readonly FieldTimeHit[]; chars: number }>();
let hitsCacheChars = 0;

function hitsCacheKey(title: string, text: string, category: string | null | undefined): string {
  return createHash("sha256")
    .update(JSON.stringify([category ?? null, title, text]))
    .digest("base64");
}

/** Test kancaları (`__resetKbIndexCache` emsali). */
export function __resetFieldTimeHitsCache(): void {
  hitsCache.clear();
  hitsCacheChars = 0;
}
export function __fieldTimeHitsCacheStats(): { entries: number; chars: number; limits: { entries: number; chars: number } } {
  return { entries: hitsCache.size, chars: hitsCacheChars, limits: { ...hitsCacheLimits } };
}
/** Test kancası: sınırları küçültür (binlerce okuma yapmadan tahliye sınanır); argümansız = üretim sınırları. */
export function __setFieldTimeHitsCacheLimits(limits?: Partial<{ entries: number; chars: number }>): void {
  hitsCacheLimits = { ...HITS_CACHE_LIMITS, ...limits };
}

function readFieldTimeHits(title: string, text: string, category?: string | null): FieldTimeHit[] {
  // Aynı çağrıda aynı cümlecik birden çok kez taranıyordu (saat taraması + iki ayrı alan çözümlemesi); ikisi de saf → çağrı içinde
  // bir kez hesaplanır (09-28 CPU denetimi; sonuç birebir aynı). YALNIZ HIZ: 24k'lık tekrarlı girdide 161 → 35 ms ("1," × 12k: 419 →
  // 112 ms). Mutasyonda eşdeğer (çıktı aynı); süre farkı makine farkına dayanıklı bir pin için fazla dar — bilinçli pinsiz.
  const mentionMemo = new Map<string, TimeMention[]>();
  const mentionsOf = (s: string): TimeMention[] => {
    let m = mentionMemo.get(s);
    if (!m) mentionMemo.set(s, (m = scanTimes(s)));
    return m;
  };
  const categoryFieldsMemo = new Map<string, ClauseInfo>();
  const fieldsWithCategory = (s: string): ClauseInfo => {
    let f = categoryFieldsMemo.get(s);
    if (!f) categoryFieldsMemo.set(s, (f = clauseFields(s, { category })));
    return f;
  };
  const bareFieldsMemo = new Map<string, ClauseInfo>();
  const bareFields = (s: string): ClauseInfo => {
    let f = bareFieldsMemo.get(s);
    if (!f) bareFieldsMemo.set(s, (f = clauseFields(s)));
    return f;
  };
  const titleFields = fieldsWithCategory(title).fields;
  const titleField = titleFields.length === 1 ? titleFields[0] : null;
  // KATEGORİ ÖDÜNCÜ — en zayıf dayanak, en son (inceleme 09-23): "Varış bilgileri" başlıklı `checkin`
  // kalemindeki "14:00'ten sonra gelebilirsiniz" hiçbir alan adlandırmıyor; kategori bilgisi atılınca
  // mülkün 15:00'ı ile GERÇEK çelişki kaçıyordu. Yalnız cümlecik ve başlık alan adlandırmıyorsa ve
  // cümlecik başka bir konudan söz etmiyorsa kullanılır (başlık ödüncüyle aynı kural).
  const categoryField = category === "checkin" || category === "checkout" ? category : null;
  const flat = text
    // "approx. 2 pm", "ca. 14:00": kısaltma noktası cümle sonu değil (09-27: "Check-in is from approx. 2 pm" hiç okunmuyordu).
    .replace(/\b(approx|appr|approximately|ca|circa|yakl|apx|abt)\.(?=\s*\d)/gi, "$1")
    // "p.m." noktaları cümlecik sınırı sanılmasın (işaret kaybolur, 15:00 → 03:00 okunurdu); "4p.m." ve virgülden önceki "a.m," da.
    // "11 a.m. A taxi …": işaretin noktası cümle sonuysa (ardından büyük harf) korunur, yoksa iki cümle birleşir.
    .replace(/(?<![a-z])([aApP])\.[mM]\.(?=\s+[A-ZÇĞİÖŞÜ])/g, "$1m.")
    .replace(/(?<![a-z])([ap])\.m\.?(?![a-z])/gi, "$1m");
  const hits: FieldTimeHit[] = [];
  const bits = flat.split(SENTENCE_SPLIT);
  for (let si = 0; si < bits.length; si += 2) {
    // Soru cümlesi bir saat BİLDİRMEZ ("S: 12:00'de girebilir miyiz?" / "Arriving after 11 pm?").
    if ((bits[si + 1] ?? "").includes("?")) continue;
    const sentence = bits[si];
    // Saat taşıyamayan cümle hiçbir atıf üretmez ve cümleler arası durum yoktur (her durum değişkeni cümle başına) → okunmaz; sonuç
    // birebir aynı (09-28 CPU denetimi: saatsiz cümlelerde boşuna cümlecik çözümlemesi yapılıyordu).
    if (!mayHoldTime(sentence)) continue;
    const pair = respectivePair(sentence);
    if (pair) {
      hits.push(...pair);
      continue;
    }
    let carriedTopic = false;
    let carriedAvailability = false;
    // Saatsiz "After check-out," / "Çıkıştan sonra," çerçevesi (Codex 09-27): sonraki cümleciğin ÖDÜNÇ aldığı giriş/çıkış saati
    // çıkıştan sonraki işin anıdır ("After check-out, at 12:00, please drop the key"). Kendi giriş/çıkış sözcüğünü taşıyan
    // cümlecik etkilenmez ("…, check-in for the next stay is at 15:00").
    let carriedAfterRef = false;
    // TAVİZ (09-27): "Even if the apartment is ready, check-in is at 3 pm" — koşul gibi görünen cümlecik sonrakini erken / geç YAPMAZ.
    let carriedStandard = false;
    // Başka bir yerin girişi (09-27): "Topkapı Sarayı'na giriş 09:00'da başlıyor, son giriş 17:00'de" — sonraki çıplak "son giriş"
    // de o yerindir (konaklama çapası taşıyan cümlecik hariç).
    let carriedPlaceEntry = false;
    // Kapı çizelgesi ("Kapılar 23:00'te kapanır, 07:00'de açılır"): sonraki cümlecik de kapının saatidir.
    let carriedDoorSchedule = false;
    // Bu cümlede standart dışı anlatılmamış giriş/çıkış atıfları: sonda yalnız müsaitlik sözü gelirse ("…, subject to availability")
    // istisnaya (erken giriş / geç çıkış) döner.
    const convertible: number[] = [];
    // Süre nesnesi cümlenin herhangi bir cümleciğinde olabilir ("Daire, giriş gününüz 16:00'dan … 10:00'a kadar sizindir").
    const sentenceToks = tokenize(sentence);
    const spanObj = sentenceToks.some((t) => ACCESS_NOUN.test(t) || STAY_PLACE.test(t) || STAY_PLACE_ACC.test(t));
    // Konaklama öznesi cümlenin başka cümleciğinde olabilir ("Konaklamanız … 15:00'te başlar, ayrılış günü 11:00'de sona erer").
    const stayInSentence = sentenceToks.some((t) => STAY_NOUN.test(t) || t === "stay");
    // Virgülle devam (09-27): saatle ya da ilgi zamiriyle başlayan cümlecik ("…at 05:30, 08:30 and 11:30", "…desk, which is staffed
    // 8 am – 8 pm") önceki cümleciğin konusunu taşır; kısa ETİKET cümleciği ("Geç giriş, anahtar kutusu ile gece 01:00'e kadar")
    // alanını sonrakine verir.
    let prevOther = false;
    let prevFields: string[] = [];
    let prevLabel = false;
    // Tire ile ayrılan devam cümleciği önceki parçanın konusunu taşır ("we can book a taxi to the airport — most guests go for
    // 9:30 AM"; "take out the trash — the bin lorry comes at 8am"): ödünç almaz.
    const clauses = sentence.split(CLAUSE_SPLIT).flatMap((x) => splitKeeping(x, DASH_SEP, 3, true).map((c, di) => ({ c, dash: di > 0 })));
    let dashTopic = false;
    for (const { c, dash } of clauses) {
      const whole = fieldsWithCategory(c);
      if (!dash) dashTopic = false;
      if (whole.pureAvailability && !carriedStandard) {
        for (const k of convertible.splice(0)) {
          const h = hits[k];
          hits[k] = { ...h, field: h.field === "checkin" ? "early_checkin" : "late_checkout", point: false };
        }
      }
      const continuation = CONTINUATION_START.test(c);
      const carryField = (prevLabel || (continuation && /^\s*\d/.test(c))) && prevFields.length === 1 ? prevFields[0] : null;
      const inherited: boolean = continuation && prevOther;
      if (CONDITION_RESET.test(c)) carriedAvailability = false;
      const availability = carriedAvailability || whole.availability;
      const byAnd = whole.split
        ? splitKeeping(c, AND_SEP, 1)
            .flatMap((p) => (fieldsWithCategory(p).fields.length > 1 ? splitKeeping(p, PAREN_SEP, 1) : [p]))
            .flatMap((p) => (fieldsWithCategory(p).fields.length > 1 ? p.split(EN_CONDITION_SPLIT) : [p]))
        : [c];
      // Ortak yüklem ("Both the indoor pool and the gym are open 7:00–21:00", "Havuz ve spor salonu 08:00-20:00 arası açık"):
      // saatsiz, KISA (≤4 sözcük), kural dili taşımayan isim öbeğinin (konaklama dışı) alanı sonraki parçanın saatlerini de alır.
      // Kendi yüklemi olan parça ("No glass by the pool and no music after 9 pm") ayrı bir kuraldır, aktarılmaz.
      let pending: string[] = [];
      for (const piece of byAnd) {
        const parts = splitAtCondition(piece);
        const conditionTopic = parts.length > 1 && bareFields(parts[0]).topic;
        if (byAnd.length > 1 && mentionsOf(piece).length === 0) {
          const pieceInfo = bareFields(piece);
          if (tokenize(piece).length <= 4 && !pieceInfo.rule) pending.push(...pieceInfo.fields.filter((f) => !STAY_FIELDS.has(f)));
          continue;
        }
        parts.forEach((part, pi) => {
          const mentions = mentionsOf(part);
          if (mentions.length === 0) return;
          const info = clauseFields(part, { stay: whole.stayNoun || stayInSentence, access: whole.accessNoun, rule: whole.rule, spanObj, category });
          if (info.span) {
            // Süre: başlangıç saati giriş (alt uç), bitiş saati çıkış (üst uç).
            for (const m of mentions) {
              const r = timeRole(part, m.start, m.end);
              const f = r.until || r.by ? "checkout" : r.from || r.after ? "checkin" : null;
              if (f) hits.push({ field: f, time: m.time, via: "clause", clause: part.trim(), point: false, bound: f === "checkin" ? "lower" : "upper" });
            }
            return;
          }
          // Taşınan başka-yer girişi: konaklama çapası yoksa bu cümleciğin giriş/çıkış alanı o yerindir.
          const placeCarry = carriedPlaceEntry && !info.stayAnchor && !whole.placeEntry;
          const ownFields = placeCarry ? info.fields.filter((f) => !STAY_FIELDS.has(f)) : info.fields;
          const otherConcept =
            info.otherConcept ||
            placeCarry ||
            carriedDoorSchedule ||
            carriedTopic ||
            dashTopic ||
            inherited ||
            (pi > 0 && conditionTopic) ||
            (byAnd.length > 1 && whole.otherConcept);
          let field: string | null = null;
          let via: FieldTimeHit["via"] = "clause";
          // Alan kendi sözcüğünden değil, önceki kısa etiket/cümlecikten geliyorsa (↑carryField) — "After check-out," çerçevesi
          // de böyle taşınır; o zaman saat çerçevenin ardındaki işin anıdır.
          let fromCarry = false;
          if (ownFields.length === 1) field = ownFields[0];
          else if (ownFields.length === 0 && carryField && byAnd.length === 1 && !info.vetoed && !placeCarry) {
            field = carryField;
            fromCarry = true;
          }
          else if (ownFields.length === 0 && titleField && !otherConcept) {
            field = titleField;
            via = "title";
          } else if (ownFields.length === 0 && titleFields.length === 0 && categoryField && !otherConcept) {
            field = categoryField;
            via = "category";
          }
          if (field === "checkout" && via !== "clause" && info.extension) field = "late_checkout";
          const standard = whole.standard || info.standard || carriedStandard;
          // Koşula bağlı / erken-geç anlatımlı giriş-çıkış bir İSTİSNADIR (mülkün standart saatiyle kıyaslanmaz). Erken sözü
          // yalnız koşuldaysa ("Erken gelirseniz 15:00'ten sonra yerleşebilirsiniz") "…'ten sonra / itibaren" saati STANDART
          // sınırdır; geç sözü yalnız "…'e kadar" saatini geç çıkış yapar ("Geç çıkmak isterseniz 13:00'e kadar kalabilirsiniz").
          if (!standard) {
            const roles = mentions.map((m) => timeRole(part, m.start, m.end));
            const early = info.freeEarly || (whole.freeEarly && roles.some((r) => !r.after && !r.from));
            const late = whole.freeLate && roles.some((r) => r.until);
            if (field === "checkin" && (availability || early)) field = "early_checkin";
            else if (field === "checkout" && (availability || late)) field = "late_checkout";
          }
          if (!field) return;
          const carried = via === "clause" && !STAY_FIELDS.has(field) ? pending.filter((f) => f !== field) : [];
          pending = [];
          const ranged = rangeEnds(part, mentions);
          const firstRangeEnd = mentions.find((m) => ranged.has(m));
          const inConditionAt = conditionAt(part);
          const roles = mentions.map((m) => timeRole(part, m.start, m.end));
          // Pencerenin ALT ucu (başlangıç) cümlecikte var mı: "from / after / itibaren" ya da iki uçlu aralık. Olumsuz "after" ("No
          // check-in after 22:00") alt uç değil, pencerenin SONUDUR.
          const lowerRole = (r: (typeof roles)[number]) => r.from || (r.after && !info.negation);
          const hasLower = roles.some(lowerRole) || ranged.size > 0;
          for (const f of [field, ...carried]) {
            // alan + saat → koşulsuz mu (aynı saat birden çok kez geçerse biri koşulsuzsa koşulsuz) + sınır yönü
            const kept = new Map<string, { field: string; time: string; point: boolean; bound?: "lower" | "upper" }>();
            mentions.forEach((m, mi) => {
              // Zayıf kanıt ("saat"siz "14'ten", ↑BARE_HOUR_G) yalnız cümleciğin KENDİ alanına: başlık / kategori / taşınan alan olmaz.
              if (m.bare && (via !== "clause" || fromCarry)) return;
              const r = roles[mi];
              const upper = r.until || r.by || latestNear(part, m.start, m.end);
              let ff = f;
              // ÜCRET (↑feeClause): ücretli giriş erken giriş, ücretli çıkış geç çıkıştır; "…'den sonra" saati geç giriş EŞİĞİ.
              if (info.fee && !standard) {
                if (ff === "checkin") ff = r.after ? "late_checkin" : "early_checkin";
                else if (ff === "checkout") ff = r.before ? "early_checkout" : "late_checkout";
              }
              const role = {
                ...r,
                inCondition: inConditionAt(m.start),
                range: ranged.has(m),
                afterRef: (info.afterRefEnd >= 0 && m.start >= info.afterRefEnd) || (carriedAfterRef && (via !== "clause" || fromCarry)),
              };
              if (excludedTime(ff, role, info)) return;
              // SON KABUL (09-27): alt ucu olmayan "…'e kadar / by / en geç / latest" giriş saati ve "No check-in after 22:00" giriş
              // penceresinin SONUDUR (geç giriş alanı) — başlangıç saati değil ("Check-in is possible until 11 pm" mülkün 15:00'iyle
              // sahte çelişkiydi). Mülkün girişinden ÖNCE ya da ona eşit biten pencere yine çelişkidir (↓`kbPropertyMismatch`). Önce
              // giriş saati olarak ELENMEYEN saat eşlenir (başvuru / erişim kuralı: "varıştan bir gün önce 18:00'e kadar"); erişimin
              // geçerlilik sonu ("kod … 23:00'e kadar geçerlidir") pencere sonu değil.
              if (ff === "checkin" && !hasLower && !info.accessOnly && (upper || (r.after && info.negation))) ff = "late_checkin";
              const point =
                !role.until && !role.after && !role.before && !role.from && !role.by && !role.range &&
                !whole.dayQualified && !boundNear(part, m.start, m.end);
              const bound: "lower" | "upper" | undefined = lowerRole(r)
                ? "lower"
                : upper || r.after
                  ? "upper"
                  : role.range
                    ? m === firstRangeEnd
                      ? "lower"
                      : "upper"
                    : undefined;
              const key = `${ff}|${m.time}`;
              const prev = kept.get(key);
              kept.set(key, { field: ff, time: m.time, point: (prev?.point ?? false) || point, bound: prev?.bound ?? bound });
            });
            for (const k of kept.values()) {
              if ((k.field === "checkin" || k.field === "checkout") && !standard && !availability) convertible.push(hits.length);
              hits.push({ field: k.field, time: k.time, via, clause: part.trim(), point: k.point, ...(k.bound ? { bound: k.bound } : {}) });
            }
          }
        });
      }
      dashTopic ||= whole.otherConcept;
      prevOther = whole.otherConcept || inherited;
      prevFields = whole.fields;
      prevLabel = mentionsOf(c).length === 0 && tokenize(c).length <= 3;
      // Müsaitlik ifadesi ("Subject to availability, …", "Müsaitliğe göre, …") kendiliğinden koşuldur: cümlenin devamına geçer —
      // TAVİZ değilse ("Even if the apartment is ready, …" sonrakini standart bırakır).
      if (whole.standard && (whole.availability || isConditionClause(c))) carriedStandard = true;
      else carriedAvailability ||= whole.availability;
      if (whole.placeEntry) carriedPlaceEntry = true;
      if (whole.doorSchedule) carriedDoorSchedule = true;
      if (isConditionClause(c)) carriedTopic ||= whole.topic;
      if (whole.afterRefEnd >= 0 && mentionsOf(c).length === 0) carriedAfterRef = true;
    }
  }
  return hits;
}

/**
 * KARŞILIKLI EŞLEME (09-27 saat okuma turu): "Giriş ve çıkış saatleri 15:00 ve 11:00'dir", "Check-in and check-out times are 3 pm
 * and 11 am" — iki alan adı "ve / and / & / /" ile bağlı ve cümle tam İKİ saat taşıyor, aralarında yalnız "ve / and / & / / / ,"
 * var: saatler SIRAYLA alanlara gider (eskiden ikisi de çıkış okunuyordu). Aralık / pencere anlatımı ("…arası", "from", "kadar"),
 * kapı / hizmet ("giriş ve çıkış kapısı", "check-in and check-out help") ve yer başı ("otopark giriş ve çıkışı") eşlenmez.
 */
const PAIR_IN = String.raw`(?:giriş|giris|check[\s-]?in|checkin)`;
const PAIR_OUT = String.raw`(?:çıkış|cikis|check[\s-]?out|checkout)`;
const PAIR_RE = new RegExp(
  String.raw`(?<![a-zçğıöşü])(?:(${PAIR_IN})\s*(?:ve|and|&|/)\s*${PAIR_OUT}|${PAIR_OUT}\s*(?:ve|and|&|/)\s*${PAIR_IN})(?![a-zçğıöşü])`,
  "i",
);
function respectivePair(sentence: string): FieldTimeHit[] | null {
  const low = sentence.toLocaleLowerCase("tr");
  const m = PAIR_RE.exec(low);
  if (!m) return null;
  const jointWindow = /(?<![a-zçğıöşü])(?:arası|arasında|arasi|arasinda|between)(?![a-zçğıöşü])/.test(low);
  if (jointWindow) {
    // ORTAK PENCERE: "Giriş ve çıkış işlemleri 09:00 ve 18:00 arasında resepsiyonda yapılır" — ikisine birden ait tek pencere bir
    // HİZMET saatidir, ne giriş ne çıkış saati (eskiden çıkış 09:00 / 18:00 okunuyordu). Cümlede başka saat yoksa hiç okunmaz.
    const all = scanTimes(sentence);
    return all.length === 2 && rangeEnds(sentence, all).size === 2 ? [] : null;
  }
  const before = tokenize(sentence.slice(0, m.index)).pop() ?? "";
  const after = tokenize(sentence.slice(m.index + m[0].length))[0] ?? "";
  if (isPlaceHead(before) || [...ENTRY_PLACE_TAILS, ...SERVICE_TAILS, "door", "gate"].some((p) => after.startsWith(p))) return null;
  const rest = sentence.slice(m.index + m[0].length);
  const times = scanTimes(rest);
  if (times.length !== 2) return null;
  if (!/^\s*(?:['’`]\s*[a-zçğıöşü]{1,4}\s*)?(?:ve|and|&|\/|,)\s*$/i.test(rest.slice(times[0].end, times[1].start))) return null;
  const inFirst = m[1] !== undefined;
  const clause = sentence.trim();
  const point = !DAY_QUALIFIER.test(low);
  return [
    { field: inFirst ? "checkin" : "checkout", time: times[0].time, via: "clause", clause, point },
    { field: inFirst ? "checkout" : "checkin", time: times[1].time, via: "clause", clause, point },
  ];
}

/** Parça başına: alan → saatler (retrieval tüketicisi; başlık ödüncü DAHİL — temkinli taraf). */
export function extractFieldTimes(title: string, text: string, category?: string | null): FieldTimes {
  const out = new Map<string, Set<string>>();
  for (const h of fieldTimeHits(title, text, category)) {
    const set = out.get(h.field) ?? new Set<string>();
    set.add(h.time);
    out.set(h.field, set);
  }
  return out;
}

/**
 * İki saat kümesi ÇELİŞİR ⇔ ikisi de dolu ve hiçbiri ötekini KAPSAMIYOR. Simetrik (eski kural
 * çapa sırasına göre farklı hüküm veriyordu). "22:00-08:00" ile "22:00" çelişmez (inceltme);
 * "11:00" ile "12:00" çelişir.
 */
export function timeSetsConflict(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size === 0 || b.size === 0) return false;
  const aInB = [...a].every((t) => b.has(t));
  const bInA = [...b].every((t) => a.has(t));
  return !aInB && !bInA;
}

/** Mülk ayarındaki saat "SS:DD" (ya da "S:DD") değilse hüküm verilmez → null. */
export function normalizePropertyTime(value: string | null | undefined): string | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec((value ?? "").trim());
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}

/** Mülk ayarı ile karşılaştırılan alanlar — erken giriş/geç çıkış BİLEREK yok. */
export const PROPERTY_TIME_FIELDS = [
  { field: "checkin", property: "checkInTime" },
  { field: "checkout", property: "checkOutTime" },
] as const;

/**
 * KB saatleri mülk ayarıyla UYUŞMUYOR mu? Kural: alanın saat kümesi doluysa mülk ayarının
 * değeri o kümenin İÇİNDE olmalı ("15:00'ten itibaren, en geç 22:00" → {15:00, 22:00} ayarla
 * uyumlu). Uyuşmayan saatler (ayar hariç) döner.
 */
export function propertyTimeMismatch(times: ReadonlySet<string> | undefined, propertyValue: string | null): string[] {
  if (!propertyValue || !times || times.size === 0 || times.has(propertyValue)) return [];
  return [...times].filter((t) => t !== propertyValue).sort();
}

/** Günün dakikası; `wrap` açıksa 06:00'dan önceki saat ertesi güne sayılır (gece yarısını geçen son kabul: "Latest check-in 1 am"). */
function minuteOf(t: string, wrap = false): number {
  const [h, m] = t.split(":").map(Number);
  return (wrap && h < 6 ? h + 24 : h) * 60 + m;
}

/**
 * Bir KB kaleminin atıfları mülk ayarıyla UYUŞMUYOR mu (istem çelişki bloğu + gönderim kapısı + ev sahibi raporu — tek kural).
 * `propertyTimeMismatch`in küme kuralı + AYNI KALEMDE İKİ KOŞULSUZ SAAT (Codex 09-27): mülkün değeri kalemde koşulsuz geçiyor
 * ve kalem başka bir koşulsuz saat de söylüyorsa ("Çıkış 11:00. Çıkış 12:00.") o saat çelişkidir. Pencere uçları ("15:00'ten
 * itibaren, en geç 22:00", "10:00–11:00 arası"), gün koşulu ("hafta sonu 16:00") ve ayrı alanlar (erken giriş / geç çıkış)
 * koşulsuz sayılmaz → eski davranış.
 * 09-27 saat okuma turu (kurucu onayı):
 *   · SINIRIN YANLIŞ TARAFI (C1b): mülk değeri kalemde yalnız SINIR olarak geçiyorsa ("Check-in from 15:00") sınırın yanlış tarafındaki
 *     koşulsuz saat ("Check-in at 14:00") çelişkidir; doğru tarafındaki ("at 16:00") değil.
 *   · SON KABUL: giriş penceresinin sonu (geç giriş alanı: "Check-in until 14:00", "Latest check-in 10 pm") mülkün girişinden ÖNCE ya
 *     da ona EŞİTSE çelişkidir (pencere başlamadan biter); sonra bitiyorsa değil. 06:00'dan önceki son kabul ertesi gündür.
 */
export function kbPropertyMismatch(
  hits: readonly Pick<FieldTimeHit, "field" | "time" | "point" | "bound">[],
  field: string,
  propertyValue: string | null,
): string[] {
  if (!propertyValue) return [];
  const out = new Set<string>();
  const own = hits.filter((h) => h.field === field);
  if (own.length > 0) {
    const times = new Set(own.map((h) => h.time));
    if (!times.has(propertyValue)) {
      for (const t of propertyTimeMismatch(times, propertyValue)) out.add(t);
    } else {
      const points = new Set(own.filter((h) => h.point).map((h) => h.time));
      if (points.has(propertyValue)) {
        for (const t of points) if (t !== propertyValue) out.add(t);
      } else {
        const lower = own.some((h) => h.time === propertyValue && h.bound === "lower");
        const upper = own.some((h) => h.time === propertyValue && h.bound === "upper");
        const pv = minuteOf(propertyValue);
        for (const t of points) if ((lower && minuteOf(t) < pv) || (upper && minuteOf(t) > pv)) out.add(t);
      }
    }
  }
  if (field === "checkin") {
    const pv = minuteOf(propertyValue, true);
    for (const h of hits) if (h.field === "late_checkin" && minuteOf(h.time, true) <= pv) out.add(h.time);
  }
  return [...out].sort();
}
