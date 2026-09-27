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
const HHMM_G = /\b([01]?\d|2[0-3])[:.]([0-5]\d)\b(\s*(?:a\.m\.|p\.m\.|am|pm)(?![a-z]))?/gi;
/** "11am", "3 pm" — dakikasız 12 saat biçimi. Önünde ":"/"." varsa DEĞİL ("10:10 am"deki "10 am"). */
const HOUR_AMPM_G = /(?<![:.\d])\b(1[0-2]|0?[1-9])\s*(a\.m\.|p\.m\.|am|pm)(?![a-z])/gi;
/**
 * "saat 11'e kadar" — dakikasız Türkçe saat. YALNIZ 10–23: "saat 3" günlük dilde çoğu zaman 15:00
 * demektir; 03:00 diye okumak mülk ayarı 15:00 ile SAHTE çelişki üretirdi (belirsizde hüküm yok).
 */
const SAAT_HOUR_G = /\bsaat\s+(1\d|2[0-3])(?![\d:.])/gi;

function to24(h: number, marker: string | undefined): number {
  if (!marker) return h;
  const pm = /^p/i.test(marker.trim());
  if (pm && h < 12) return h + 12;
  if (!pm && h === 12) return 0;
  return h;
}
const pad = (h: number, m: string) => `${String(h).padStart(2, "0")}:${m}`;

/** Metindeki saatler, "SS:DD" biçiminde (am/pm 24 saate çevrilir). */
export function timesIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(HHMM_G)) out.add(pad(to24(Number(m[1]), m[3]), m[2]));
  for (const m of text.matchAll(HOUR_AMPM_G)) out.add(pad(to24(Number(m[1]), m[2]), "00"));
  for (const m of text.matchAll(SAAT_HOUR_G)) out.add(pad(Number(m[1]), "00"));
  return out;
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
function splitKeeping(text: string, sep: RegExp, min: number): string[] {
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
    if (range || !prevEnough || !nextEnough) {
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
const TRANSPORT_STEMS = ["otobus", "dolmus", "minibus", "ferry", "feribot", "vapur", "tekne", "train", "tren", "metro", "tram", "shuttle", "servis", "flight", "ucak", "plane", "airport", "havaliman", "havaalan", "liman", "iskele", "taksi", "transfer", "cruise", "sofor", "driver", "chauffeur", "otogar"];
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
const CONDITION_RESET = /^\s*(?:değilse|degilse|yoksa|aksi\s+(?:halde|takdirde)|otherwise|else)\b/i;
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
];
function availabilityCondition(toks: readonly string[], text: string): boolean {
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const n = toks[i + 1] ?? "";
    if (/^(?:musait|hazir|bos)(?:sa|se|ise)$/.test(t)) return true;
    if (/^(?:musait|hazir|bos)$/.test(t) && /^(?:olursa|ise)$/.test(n)) return true;
    if (/^musaitli/.test(t) && (n === "gore" || n.startsWith("durum"))) return true;
    if (/^(?:misafir|konuk|rezervasyon|kimse)/.test(t) && toks.slice(i + 1, i + 4).some((x) => /(?:yoksa|mazsa|mezse|m[iu]yorsa)$/.test(x))) return true;
  }
  return EN_AVAILABILITY.some((re) => re.test(text));
}
/** Bağımsız "erken / early" (bir giriş-çıkış sözcüğünü nitelemiyor): "Erken gelirseniz …", "erkenden yerleşebilirsiniz", "check in early". */
const EARLY_FREE = /^(?:erken|erkenden|early|earlier)$/;
/** Bağımsız "geç / late": "Çıkışı geç yapmak isterseniz 13:00'e kadar kalabilirsiniz". "En geç" = son saat, hariç. */
const LATE_FREE = /^(?:gec|late|later)$/;
/** Standart / olumsuz / "yine de" anlatımı: erken-geç eşlemesi YAPILMAZ ("Erken gelseniz bile giriş 15:00'te"). */
const STANDARD_EXACT = new Set(["standart", "standard", "normal", "normalde", "normally", "regular", "usual", "usually", "yine", "gene", "bile", "still", "even", "anyway", "regardless", "degil", "not", "never", "cannot"]);
const NEG_VERB = /(?:ama|eme|ma|me)z(?:siniz|sin|lar|ler|dir)?$/;
/** "Acil çıkış / yangın çıkışı" — konaklama ÇIKIŞI değil, bir KAPI. */
const EXIT_HEADS = new Set(["acil", "yangin", "emergency", "fire"]);
/** "Erken giriş / geç çıkış" AYRI alandır: mülkün giriş/çıkış saatiyle KIYASLANMAZ. */
const MODIFIERS: Record<string, "early" | "late"> = { erken: "early", early: "early", gec: "late", late: "late" };
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
const OTHER_PLACE_DAT = /^(?:bina|otopark|site|havuz|garaj|park|bahce|lobi|bodrum|blok|plaj|deniz|spor|salon|asansor|teras|cati|balkon)[a-z]*(?:ye|ya|e|a)$/;
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
 * "…'TEN SONRA" TÜRÜ BAŞVURU (Codex 09-27): "Çıkıştan sonra 12:00'de anahtarı bırakın", "After check-out, at 12:00, …" — başvuru
 * noktasından SONRA gelen saat çıkıştan sonraki işin anıdır, çıkışın değeri olamaz. Önce türü ("before check-out at 11:00") değerdir,
 * dokunulmaz. Metin `tr` küçük harfle aranır (uzunluk korunur → konumlar cümlecikle aynı).
 */
const AFTER_REF =
  /(?:(?<![a-zçğıöşü])(?:çıkış|giriş|varış)[a-zçğıöşü]*?(?:tan|ten|dan|den)|(?<![a-zçğıöşü])(?:çıkış|giriş)\s+(?:yap|saat)[a-zçğıöşü]*?(?:tan|ten|dan|den)|(?<![a-zçğıöşü])(?:çık|gir|ayrıl|var|gel)[a-zçğıöşü]*?(?:dıktan|dikten|duktan|dükten|tıktan|tikten|tuktan|tükten))\s+sonra(?![a-zçğıöşü])|\bafter\s+(?:the\s+|your\s+)?(?:check[\s-]?out|check[\s-]?in|checkout|checkin|arrival|departure)\b/;
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
}

function clauseFields(clause: string, ctx: { stay?: boolean; access?: boolean; rule?: boolean; spanObj?: boolean; category?: string | null } = {}): ClauseInfo {
  const toks = tokenize(clause);
  const keep: string[] = [];
  const extra: string[] = [];
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
      // "giriş günü / çıkış günü / departure day" = GÜN, saat değil.
      if (next.startsWith("gun") || next === "day" || next === "days") {
        homonym = true;
        continue;
      }
      // "en geç çıkış" = en son çıkış saati (çıkış alanı); "geç çıkış" = ayrı alan.
      const mod = MODIFIERS[prev];
      if (mod && toks[i - 2] !== "en") {
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
  const foreign = matchConcepts(stems, { loose: true })
    .filter((m) => !m.concept.timeField)
    .map((m) => m.concept.id);
  const transport = toks.some(isTransport);
  // Çıkış ALANI yalnız açık bir çıkış sözcüğüyle: "çık-" fiilinin 3. şahsı ve İngilizce "leaves / departures" (bir aracın,
  // bir programın kalkışı) çıkış sözcüğüyle aynı köke iner; "leave / departure" de ulaşım cümleciğinde çıkış değil.
  const outWord = toks.some(
    (t, i) =>
      t.startsWith("cikis") ||
      t === "checkout" ||
      (t === "check" && toks[i + 1] === "out") ||
      YOU_LEAVE.test(t) ||
      (!transport && (t.startsWith("ayril") || t === "leave" || t === "leaving" || t === "departure")),
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
  const departsStay =
    !lexical.includes("checkout") &&
    (vacate || (toks.some((t) => STAY_PLACE_ABL.test(t)) && toks.some((t) => YOU_DEPART.test(t) && !NEG_IMPERATIVE.test(t))));
  const stayNoun = toks.some((t) => STAY_NOUN.test(t) || t === "stay");
  const stayScope = (stayNoun || ctx.stay === true) && lexical.length === 0 && foreign.length === 0;
  const stayBegin = stayScope && toks.some((t) => STAY_BEGIN.test(t));
  const stayEnd = stayScope && toks.some((t, i) => STAY_END.test(t) || (t === "sona" && /^er/.test(toks[i + 1] ?? "")));
  const roles = mentions.map((m) => timeRole(clause, m.start, m.end));
  const accessNoun = toks.some((t) => ACCESS_NOUN.test(t));
  const accessFree = foreign.every((id) => id === "keys" || id === "credentials") && !toks.some((t) => WIFI.test(t)) && !luggage;
  const departing = departureDay(toks);
  const endVerb = toks.some((t, i) => ACCESS_END.test(t) || (ACCESS_START.test(t) && negatedStart(toks, i)));
  const accessStart =
    lexical.length === 0 &&
    accessFree &&
    accessNoun &&
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
  const span =
    (accessNoun || ctx.spanObj === true || toks.some((t) => STAY_PLACE.test(t) || STAY_PLACE_ACC.test(t))) &&
    toks.some((t) => SPAN_VERB.test(t)) &&
    roles.some((r) => r.from || r.after) &&
    roles.some((r) => r.until);
  const extension = toks.some((t) => EXTENSION.test(t));
  const raw = [
    ...lexical,
    ...(departsStay || stayEnd || accessEnd ? ["checkout"] : []),
    ...(stayBegin || accessStart ? ["checkin"] : []),
    ...extra,
  ].map((f) => (extension && f === "checkout" ? "late_checkout" : f));
  const contact = toks.some((t) => CONTACT_EXACT.has(t) || CONTACT_STEMS.some((h) => t.startsWith(h)));
  // İletişim PENCERESİ: iletişim sözü + aralık / "…'e kadar" ("temizlik ekibimize 09:00-18:00 arası yazabilirsiniz").
  const contactWindow = contact && (mentions.length >= 2 || mentions.some((m) => timeRole(clause, m.start, m.end).until));
  const sending = toks.some((t) => SEND_PREFIX.test(t) || SEND_EXACT.has(t));
  const facility = toks.some((t, i) => OTHER_FACILITY.test(t) || MAINTENANCE.test(t) || (ACTIVITY.test(t) && toks[i - 1] !== "of"));
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
      !contactWindow &&
      !sending,
  );
  // Kendi çalışma saati olan yerler sözlükte kavram değil ama konaklama saati de DEĞİL: "Giriş"
  // başlıklı kalemde "Resepsiyon 09:00-18:00 arası açıktır" giriş saati sanılıyordu (ölçüldü 09-23).
  const ownHours =
    toks.some((t) => OWN_HOURS_STEMS.some((h) => t.startsWith(h))) ||
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
    if ((t === "after" || t === "before") && /^(?:checkin|checkout|arrival|departure)$/.test(n1 === "the" || n1 === "your" ? n2 : n1)) return true;
    return false;
  });
  // Gün kaymalı başvuru ("varıştan bir gün önce", "the day after arrival", "the evening before you leave"): saat başka bir işin
  // saatidir — hiçbir rolde giriş/çıkış değeri değildir.
  const strongReference = reference && toks.some((t) => /^(?:day|days|gun|evening|aksam|night|gece|morning|sabah)$|^gun[a-z]{0,2}$/.test(t));
  const freeEarly = toks.some((t, i) => EARLY_FREE.test(t) && !["en", "the"].includes(toks[i - 1] ?? "") && !isIn(toks[i + 1] ?? "") && !isOut(toks[i + 1] ?? "") && toks[i + 1] !== "check");
  const freeLate = toks.some((t, i) => LATE_FREE.test(t) && toks[i - 1] !== "en" && !isIn(toks[i + 1] ?? "") && !isOut(toks[i + 1] ?? "") && toks[i + 1] !== "check");
  const standard = toks.some((t) => STANDARD_EXACT.has(t) || NEG_VERB.test(t));
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
    fields.length < raw.length ||
    foreign.length > 0;
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
      homonym || ownHours || luggageAction || contact || sending || transport || otherPlace || facility || lateness || fields.length < raw.length,
    topic: transport || luggage,
    availability: availabilityCondition(toks, clause),
    stayNoun,
    freeEarly,
    freeLate,
    standard,
    afterRefEnd: reference ? afterReferenceEnd(clause) : -1,
    dayQualified: DAY_QUALIFIER.test(clause.toLocaleLowerCase("tr")),
  };
}

/** Cümlecikteki saat geçişleri, konumlarıyla (`timesIn` ile AYNI kalıplar) — bağlam kuralları saatin önüne/ardına bakar. */
function timeMentions(clause: string): { time: string; start: number; end: number }[] {
  const out: { time: string; start: number; end: number }[] = [];
  const at = (m: RegExpMatchArray, time: string) => out.push({ time, start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  for (const m of clause.matchAll(HHMM_G)) at(m, pad(to24(Number(m[1]), m[3]), m[2]));
  for (const m of clause.matchAll(HOUR_AMPM_G)) at(m, pad(to24(Number(m[1]), m[2]), "00"));
  for (const m of clause.matchAll(SAAT_HOUR_G)) at(m, pad(Number(m[1]), "00"));
  return out;
}

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
    from: suffixThen("itibaren") || /\bfrom\s*$/.test(head) || /^\s*['’`]?\s*(?:dan|den|tan|ten)(?![a-zçğıöşü])(?!\s*(?:sonra|önce|itibaren))/.test(tail),
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
  // Saat yalnız RAKAMLA yazılır (SS:DD, S am/pm, "saat S") → rakamsız metinde okuma yok; boşuna tam tarama yapılmaz (A3 09-27).
  if (!/\d/.test(text)) return [];
  const titleFields = clauseFields(title, { category }).fields;
  const titleField = titleFields.length === 1 ? titleFields[0] : null;
  // KATEGORİ ÖDÜNCÜ — en zayıf dayanak, en son (inceleme 09-23): "Varış bilgileri" başlıklı `checkin`
  // kalemindeki "14:00'ten sonra gelebilirsiniz" hiçbir alan adlandırmıyor; kategori bilgisi atılınca
  // mülkün 15:00'ı ile GERÇEK çelişki kaçıyordu. Yalnız cümlecik ve başlık alan adlandırmıyorsa ve
  // cümlecik başka bir konudan söz etmiyorsa kullanılır (başlık ödüncüyle aynı kural).
  const categoryField = category === "checkin" || category === "checkout" ? category : null;
  // "p.m." noktaları cümlecik sınırı sanılmasın (işaret kaybolur, 15:00 → 03:00 okunurdu).
  // "11 a.m. A taxi …": işaretin noktası cümle sonuysa (ardından büyük harf) korunur, yoksa iki cümle birleşir.
  const flat = text.replace(/\b([aApP])\.[mM]\.(?=\s+[A-ZÇĞİÖŞÜ])/g, "$1m.").replace(/\b([ap])\.m\./gi, "$1m");
  const hits: FieldTimeHit[] = [];
  const bits = flat.split(SENTENCE_SPLIT);
  for (let si = 0; si < bits.length; si += 2) {
    // Soru cümlesi bir saat BİLDİRMEZ ("S: 12:00'de girebilir miyiz?" / "Arriving after 11 pm?").
    if ((bits[si + 1] ?? "").includes("?")) continue;
    const sentence = bits[si];
    let carriedTopic = false;
    let carriedAvailability = false;
    // Saatsiz "After check-out," / "Çıkıştan sonra," çerçevesi (Codex 09-27): sonraki cümleciğin ÖDÜNÇ aldığı giriş/çıkış saati
    // çıkıştan sonraki işin anıdır ("After check-out, at 12:00, please drop the key"). Kendi giriş/çıkış sözcüğünü taşıyan
    // cümlecik etkilenmez ("…, check-in for the next stay is at 15:00").
    let carriedAfterRef = false;
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
    const clauses = sentence.split(CLAUSE_SPLIT).flatMap((x) => splitKeeping(x, DASH_SEP, 3).map((c, di) => ({ c, dash: di > 0 })));
    let dashTopic = false;
    for (const { c, dash } of clauses) {
      const whole = clauseFields(c, { category });
      if (!dash) dashTopic = false;
      const continuation = CONTINUATION_START.test(c);
      const carryField = (prevLabel || (continuation && /^\s*\d/.test(c))) && prevFields.length === 1 ? prevFields[0] : null;
      const inherited: boolean = continuation && prevOther;
      if (CONDITION_RESET.test(c)) carriedAvailability = false;
      const availability = carriedAvailability || whole.availability;
      const byAnd = whole.split
        ? splitKeeping(c, AND_SEP, 1)
            .flatMap((p) => (clauseFields(p, { category }).fields.length > 1 ? splitKeeping(p, PAREN_SEP, 1) : [p]))
            .flatMap((p) => (clauseFields(p, { category }).fields.length > 1 ? p.split(EN_CONDITION_SPLIT) : [p]))
        : [c];
      // Ortak yüklem ("Both the indoor pool and the gym are open 7:00–21:00", "Havuz ve spor salonu 08:00-20:00 arası açık"):
      // saatsiz, KISA (≤4 sözcük), kural dili taşımayan isim öbeğinin (konaklama dışı) alanı sonraki parçanın saatlerini de alır.
      // Kendi yüklemi olan parça ("No glass by the pool and no music after 9 pm") ayrı bir kuraldır, aktarılmaz.
      let pending: string[] = [];
      for (const piece of byAnd) {
        const parts = splitAtCondition(piece);
        const conditionTopic = parts.length > 1 && clauseFields(parts[0]).topic;
        if (byAnd.length > 1 && timeMentions(piece).length === 0) {
          const pieceInfo = clauseFields(piece);
          if (tokenize(piece).length <= 4 && !pieceInfo.rule) pending.push(...pieceInfo.fields.filter((f) => !STAY_FIELDS.has(f)));
          continue;
        }
        parts.forEach((part, pi) => {
          const mentions = timeMentions(part);
          if (mentions.length === 0) return;
          const info = clauseFields(part, { stay: whole.stayNoun || stayInSentence, access: whole.accessNoun, rule: whole.rule, spanObj, category });
          if (info.span) {
            // Süre: başlangıç saati giriş, bitiş saati çıkış.
            for (const m of mentions) {
              const r = timeRole(part, m.start, m.end);
              const f = r.until ? "checkout" : r.from || r.after ? "checkin" : null;
              if (f) hits.push({ field: f, time: m.time, via: "clause", clause: part.trim(), point: false });
            }
            return;
          }
          const otherConcept =
            info.otherConcept ||
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
          if (info.fields.length === 1) field = info.fields[0];
          else if (info.fields.length === 0 && carryField && byAnd.length === 1 && !info.vetoed) {
            field = carryField;
            fromCarry = true;
          }
          else if (info.fields.length === 0 && titleField && !otherConcept) {
            field = titleField;
            via = "title";
          } else if (info.fields.length === 0 && titleFields.length === 0 && categoryField && !otherConcept) {
            field = categoryField;
            via = "category";
          }
          if (field === "checkout" && via !== "clause" && info.extension) field = "late_checkout";
          // Koşula bağlı / erken-geç anlatımlı giriş-çıkış bir İSTİSNADIR (mülkün standart saatiyle kıyaslanmaz). Erken sözü
          // yalnız koşuldaysa ("Erken gelirseniz 15:00'ten sonra yerleşebilirsiniz") "…'ten sonra / itibaren" saati STANDART
          // sınırdır; geç sözü yalnız "…'e kadar" saatini geç çıkış yapar ("Geç çıkmak isterseniz 13:00'e kadar kalabilirsiniz").
          if (!whole.standard && !info.standard) {
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
          const inConditionAt = conditionAt(part);
          for (const f of [field, ...carried]) {
            // saat → koşulsuz mu (aynı saat birden çok kez geçerse biri koşulsuzsa koşulsuz)
            const kept = new Map<string, boolean>();
            for (const m of mentions) {
              const role = {
                ...timeRole(part, m.start, m.end),
                inCondition: inConditionAt(m.start),
                range: ranged.has(m),
                afterRef: (info.afterRefEnd >= 0 && m.start >= info.afterRefEnd) || (carriedAfterRef && (via !== "clause" || fromCarry)),
              };
              if (excludedTime(f, role, info)) continue;
              const point =
                !role.until && !role.after && !role.before && !role.from && !role.by && !role.range &&
                !info.dayQualified && !whole.dayQualified && !boundNear(part, m.start, m.end);
              kept.set(m.time, (kept.get(m.time) ?? false) || point);
            }
            for (const [time, point] of kept) hits.push({ field: f, time, via, clause: part.trim(), point });
          }
        });
      }
      dashTopic ||= whole.otherConcept;
      prevOther = whole.otherConcept || inherited;
      prevFields = whole.fields;
      prevLabel = timeMentions(c).length === 0 && tokenize(c).length <= 3;
      // Müsaitlik ifadesi ("Subject to availability, …", "Müsaitliğe göre, …") kendiliğinden koşuldur: cümlenin devamına geçer.
      carriedAvailability ||= whole.availability;
      if (isConditionClause(c)) carriedTopic ||= whole.topic;
      if (whole.afterRefEnd >= 0 && timeMentions(c).length === 0) carriedAfterRef = true;
    }
  }
  return hits;
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

/**
 * Bir KB kaleminin atıfları mülk ayarıyla UYUŞMUYOR mu (istem çelişki bloğu + gönderim kapısı + ev sahibi raporu — tek kural).
 * `propertyTimeMismatch`in küme kuralı + AYNI KALEMDE İKİ KOŞULSUZ SAAT (Codex 09-27): mülkün değeri kalemde koşulsuz geçiyor
 * ve kalem başka bir koşulsuz saat de söylüyorsa ("Çıkış 11:00. Çıkış 12:00.") o saat çelişkidir. Pencere uçları ("15:00'ten
 * itibaren, en geç 22:00", "10:00–11:00 arası"), gün koşulu ("hafta sonu 16:00") ve ayrı alanlar (erken giriş / geç çıkış)
 * koşulsuz sayılmaz → eski davranış.
 */
export function kbPropertyMismatch(
  hits: readonly Pick<FieldTimeHit, "field" | "time" | "point">[],
  field: string,
  propertyValue: string | null,
): string[] {
  const own = hits.filter((h) => h.field === field);
  if (!propertyValue || own.length === 0) return [];
  const times = new Set(own.map((h) => h.time));
  if (!times.has(propertyValue)) return propertyTimeMismatch(times, propertyValue);
  const points = new Set(own.filter((h) => h.point).map((h) => h.time));
  if (!points.has(propertyValue)) return [];
  return [...points].filter((t) => t !== propertyValue).sort();
}
