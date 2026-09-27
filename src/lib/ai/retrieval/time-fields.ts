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
}

/**
 * Cümle sınırı: nokta (ardından RAKAM gelmiyorsa) / ünlem / soru / noktalı virgül / satır. Cümlecik sınırı: virgül ve iki
 * yanı da cümlecik olan boşluklu uzun tire (↓`splitKeeping`).
 * 🚨 Eski kalıp `(?<!\d)\.(?!\d)` rakamdan SONRA gelen noktayı sınır saymıyordu → "Giriş 15:00.
 * Çıkış 11:00." TEK cümlecik olup iki alanı birden taşıyor ve iki saat de düşüyordu. "12.00"
 * yazımı yine bölünmez (noktanın ardında rakam var).
 * 09-27: cümle ile cümlecik AYRI tutulur — koşul cümleciği ("If the flat is free, …", "Taksi isterseniz, …") AYNI cümlenin
 * sonraki cümleciklerine bağlam taşır.
 */
const SENTENCE_SPLIT = /\.(?!\d)|[!?;\n]+/;
const CLAUSE_SPLIT = /,+/;
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
const ENDS_WITH_TIME = /(?:\d{1,2}[:.]\d{2}|\d{1,2}\s*(?:am|pm))\W*$/i;
const STARTS_WITH_TIME = /^\W*\d{1,2}(?:[:.]\d{2}|\s*(?:am|pm)\b)/i;
/** Boşluklu uzun / orta tire: "You're welcome to arrive after 4 pm — the lockbox works around the clock". */
const DASH_SEP = /(\s[—–]\s)/;
const AND_SEP = /(\s(?:ve|and|&)\s)/i;
/**
 * Ayırıcıdan böler. Aralığın iki ucu ile `min` sözcükten kısa yan ("Giriş – 15:00" etiketi, "Check-in — 3 pm") yeniden
 * birleşir; birleşen metinde ayırıcı AYNEN kalır (host raporu cümleciği gösterir).
 */
function splitKeeping(text: string, sep: RegExp, min: number): string[] {
  const bits = text.split(sep);
  const out = [bits[0]];
  for (let i = 1; i < bits.length; i += 2) {
    const prev = out[out.length - 1];
    const next = bits[i + 1] ?? "";
    const range = ENDS_WITH_TIME.test(prev) && STARTS_WITH_TIME.test(next);
    if (range || tokenize(prev).length < min || tokenize(next).length < min) out[out.length - 1] = prev + bits[i] + next;
    else out.push(next);
  }
  return out;
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
const SERVICE_TAILS = ["help", "support", "desk", "counter", "assist", "instruction", "destek", "yardim", "talimat", "guide", "rehber", "checklist", "list", "bilgi", "info", "detail", "detay", "reminder", "hatirlat", "form", "link", "kod", "code", "mesaj", "message"];
/** Kendi çalışma saati olan yerler (kalemin konaklama saatine ödünç verilmez). */
const OWN_HOURS_STEMS = ["resepsiyon", "reception", "danisma", "concierge", "ofis", "office", "lobi", "lobby", "guvenlik", "security", "kapici"];
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
const TR_CONDITIONAL_VERB_G =
  /[a-zçğıöşü]*(?:s[ae]n[ıi]z|[aeıiuü][rz]s[ae]|(?:acak|ecek|yor)s[ae])(?![a-zçğıöşü])|(?<![a-zçğıöşü])(?:müsaitse|uygunsa|mümkünse|yoksa|değilse|boşsa|doluysa|hazırsa)(?![a-zçğıöşü])/g;
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
/** Saat koşulun içinde mi: parça bir Türkçe koşul fiiliyle BİTİYOR ya da saatten önce "if you / in case" var. */
const insideCondition = (clause: string, start: number) => endsWithCondition(clause) || /\b(?:if you|in case)\b/i.test(clause.slice(0, start));
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
];
function availabilityCondition(toks: readonly string[], text: string): boolean {
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const n = toks[i + 1] ?? "";
    if (/^(?:musait|hazir|bos)(?:sa|se|ise)$/.test(t)) return true;
    if (/^(?:musait|hazir|bos)$/.test(t) && /^(?:olursa|ise)$/.test(n)) return true;
    if (/^musaitli/.test(t) && (n === "gore" || n.startsWith("durum"))) return true;
    if (/^(?:misafir|konuk|rezervasyon)/.test(t) && toks.slice(i + 1, i + 4).some((x) => /^(?:yoksa|olmazsa|gelmezse|bulunmazsa)$/.test(x))) return true;
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
const EXTENSION = /^(?:uzat|extend|extension)/;
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
const ACCESS_START = /^(?:calis|aktif|activ|gecerli|valid|work|yours|sizin|hazir|ready|teslim|alabilirsiniz|alinabilir|collect)/;
const ACCESS_END = /^(?:gecersiz|devre|expir|deactiv|sona|biter|bitiyor|kapan)/;
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
const RULE_SUFFIX = /(?:mayin|meyin|mayiniz|meyiniz|malisiniz|melisiniz|malidir|melidir|mali|meli)$/;
const ruleSignal = (toks: readonly string[]) =>
  toks.some((t) => RULE_EXACT.has(t) || RULE_PREFIX.some((p) => t.startsWith(p)) || RULE_SUFFIX.test(t));
/** Spor salonu yalnız açık sözcükle ("salon" = oturma odası / kuaför salonu); havuz yalnız açık sözcükle ("şezlong" plajda da). */
const GYM_WORD = /^(?:spor|fitness|gym)/;
const POOL_WORD = /^(?:havuz|pool|yuzme|swim)/;
/** Havuzun KENDİSİ değil (09-27): "havuz barı", "pool towels", "pool table" (bilardo), "havuz partisi" — saat o yerin / olayın saatidir. */
const POOL_TAILS = ["bar", "kafe", "cafe", "restoran", "restaurant", "snack", "bufe", "masa", "table", "towel", "havlu", "part", "semsiye", "umbrella"];
/**
 * Başka tesis / etkinlik / bakım (09-27): "The sauna next to the gym is open 4–10 pm", "spor salonunda 19:00'da pilates dersi",
 * "Havuz pazartesi 08:00–10:00 arası bakım nedeniyle kapalı" — spor salonunun / havuzun açık olduğu saat DEĞİL.
 */
const OTHER_FACILITY = /^(?:sauna|hamam|spa|spada|spaya|steam|buhar|jakuzi|jacuzzi|tenis|tennis|bilardo|billiard)$/;
const ACTIVITY = /^(?:ders|class|lesson|pilates|yoga|kurs|course|antrenman|training|aerobi|zumba|aqua)/;
const MAINTENANCE = /^(?:bakim(?:i|da|dan|a|lari|lar)?|maintenance|onarim|repair|repairs)$/;
const TIME_TOKEN = /^\d{2}:\d{2}$/;

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
}

function clauseFields(clause: string, ctx: { stay?: boolean } = {}): ClauseInfo {
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
    if (isIn(t) || isOut(t)) {
      const spatial = t === "girisin" && (SPATIAL.test(next) || (/^(?:hemen|tam)$/.test(next) && SPATIAL.test(toks[i + 2] ?? "")));
      const service = SERVICE_TAILS.some((p) => next.startsWith(p));
      // "Arrivals after 22:00 must use the key box": geç varışların SINIFI, giriş saati değil.
      const lateClass = t === "arrivals" && toks.includes("after");
      if (spatial || service || lateClass) {
        homonym = true;
        continue;
      }
      if (isIn(t) && (isPlaceHead(prev) || ENTRY_PLACE_TAILS.some((p) => next.startsWith(p)))) {
        homonym = true;
        continue;
      }
      // "Çıkış kapısı" yalnız YALIN biçimde kapıdır ("Çıkışta kapıyı kilitleyin" konaklama çıkışıdır).
      // 09-27: "otobüs çıkışı / ferry departure" da aracın kalkışıdır.
      if (isOut(t) && (EXIT_HEADS.has(prev) || isPlaceHead(prev) || isTransport(prev) || ((t === "cikis" || t === "exit") && next.startsWith("kapi")))) {
        homonym = true;
        continue;
      }
      // "giriş günü / çıkış günü" = GÜN, saat değil.
      if (next.startsWith("gun")) {
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
  if (lexical.includes("checkin") && enterVerbOnly) {
    const enters = toks.some((t) => (YOU_ENTER.test(t) && !NEG_IMPERATIVE.test(t)) || STAY_PLACE_DAT.test(t));
    if (!enters || otherPlace) lexical = lexical.filter((f) => f !== "checkin");
  }
  if (!lexical.includes("quiet_hours") && toks.some((t) => NOISE_EXTRA.has(t))) lexical = [...lexical, "quiet_hours"];
  const vacate = toks.some((t) => VACATE.test(t) && !NEG_IMPERATIVE.test(t)) && toks.some((t) => STAY_PLACE.test(t));
  const departsStay =
    !lexical.includes("checkout") &&
    (vacate || (toks.some((t) => STAY_PLACE_ABL.test(t)) && toks.some((t) => YOU_DEPART.test(t) && !NEG_IMPERATIVE.test(t))));
  const stayNoun = toks.some((t) => STAY_NOUN.test(t) || t === "stay");
  const stayScope = (stayNoun || ctx.stay === true) && lexical.length === 0 && foreign.length === 0;
  const stayBegin = stayScope && toks.some((t) => STAY_BEGIN.test(t));
  const stayEnd = stayScope && toks.some((t, i) => STAY_END.test(t) || (t === "sona" && /^er/.test(toks[i + 1] ?? "")));
  const accessStart =
    lexical.length === 0 &&
    foreign.every((id) => id === "keys" || id === "credentials") &&
    toks.some((t) => ACCESS_NOUN.test(t)) &&
    toks.some((t) => ACCESS_START.test(t)) &&
    !toks.some((t) => ACCESS_END.test(t) || WIFI.test(t)) &&
    !luggage;
  const extension = toks.some((t) => EXTENSION.test(t));
  const raw = [
    ...lexical,
    ...(departsStay || stayEnd ? ["checkout"] : []),
    ...(stayBegin || accessStart ? ["checkin"] : []),
    ...extra,
  ].map((f) => (extension && f === "checkout" ? "late_checkout" : f));
  const contact = toks.some((t) => CONTACT_EXACT.has(t) || CONTACT_STEMS.some((h) => t.startsWith(h)));
  // İletişim PENCERESİ: iletişim sözü + aralık / "…'e kadar" ("temizlik ekibimize 09:00-18:00 arası yazabilirsiniz").
  const contactWindow = contact && (mentions.length >= 2 || mentions.some((m) => timeRole(clause, m.start, m.end).until));
  const sending = toks.some((t) => SEND_PREFIX.test(t) || SEND_EXACT.has(t));
  const facility = toks.some((t, i) => OTHER_FACILITY.test(t) || MAINTENANCE.test(t) || (ACTIVITY.test(t) && toks[i - 1] !== "of"));
  const poolOk = toks.some((t, i) => POOL_WORD.test(t) && !POOL_TAILS.some((p) => (toks[i + 1] ?? "").startsWith(p) || (toks[i + 2] ?? "").startsWith(p)));
  // "Dry cleaner / kuru temizleme" bir DÜKKAN; "temizlik malzemesi" bir ÜRÜN — dairenin temizlik saati değil.
  const cleaningShop = toks.some(
    (t, i) =>
      (t === "dry" && /^clean/.test(toks[i + 1] ?? "")) ||
      (t === "kuru" && /^temiz/.test(toks[i + 1] ?? "")) ||
      (/^(?:temizlik|cleaning)/.test(t) && /^(?:malzeme|supplies|supply|product|urun)/.test(toks[i + 1] ?? "")),
  );
  const fields = raw.filter(
    (f) =>
      (f !== "checkout" || outWord || vacate || stayEnd) &&
      (f !== "quiet_hours" || quietPhrase(toks) || ruleSignal(toks)) &&
      (f !== "gym" || (toks.some((t) => GYM_WORD.test(t)) && !facility)) &&
      (f !== "pool" || (poolOk && !facility)) &&
      (f !== "cleaning" || !cleaningShop) &&
      !(luggageAction && STAY_FIELDS.has(f)) &&
      !contactWindow &&
      !sending,
  );
  // Kendi çalışma saati olan yerler sözlükte kavram değil ama konaklama saati de DEĞİL: "Giriş"
  // başlıklı kalemde "Resepsiyon 09:00-18:00 arası açıktır" giriş saati sanılıyordu (ölçüldü 09-23).
  const ownHours = toks.some((t) => OWN_HOURS_STEMS.some((h) => t.startsWith(h)));
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
    extension,
    accessOnly: accessStart,
    topic: transport || luggage,
    availability: availabilityCondition(toks, clause),
    stayNoun,
    freeEarly,
    freeLate,
    standard,
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

/** Saatin ardındaki sözcük ("14:00'e kadar", "11:00 sonrası", "15:00'ten önceki / itibaren") ya da önündeki ("until / after / before / from"). */
function timeRole(clause: string, start: number, end: number): { until: boolean; after: boolean; before: boolean; from: boolean } {
  const tail = clause.slice(end, end + 16).toLocaleLowerCase("tr");
  const head = clause.slice(Math.max(0, start - 10), start).toLocaleLowerCase("en");
  const suffixThen = (w: string) => new RegExp(`^\\s*(?:['’\`]\\s*)?[a-zçğıöşü]{0,4}\\s*${w}`).test(tail);
  return {
    until: suffixThen("kadar") || /\b(?:until|till|up to)\s*$/.test(head),
    after: suffixThen("sonra") || /\bafter\s*$/.test(head),
    before: suffixThen("önce") || /\bbefore\s*$/.test(head),
    from: suffixThen("itibaren") || /\bfrom\s*$/.test(head),
  };
}

/**
 * Saatin alanın DEĞERİ olmadığı durumlar (09-27): geç çıkış / geç girişte "11:00 sonrası" standart saattir (sınır),
 * erken girişte "15:00'ten önceki" de öyle; başvuru noktası cümleciğinde ("çıkıştan sonra … 14:00'e kadar") "kadar"
 * saati başka bir işin saatidir; koşulun İÇİNDEKİ saat ve geç kalış cümleciğinde "22:00'den sonra" eşiktir; erişim
 * kuralından gelen girişte yalnız başlangıç saati okunur.
 */
function excludedTime(field: string, role: ReturnType<typeof timeRole> & { inCondition: boolean }, info: ClauseInfo): boolean {
  if ((field === "late_checkout" || field === "late_checkin") && role.after) return true;
  if ((field === "early_checkin" || field === "early_checkout") && role.before) return true;
  if (STAY_FIELDS.has(field) && role.inCondition) return true;
  if ((field === "checkin" || field === "checkout") && info.reference && role.until) return true;
  if ((field === "checkin" || field === "checkout") && info.lateness && role.after) return true;
  if (field === "checkin" && info.accessOnly && (role.until || role.before)) return true;
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
  const titleFields = clauseFields(title).fields;
  const titleField = titleFields.length === 1 ? titleFields[0] : null;
  // KATEGORİ ÖDÜNCÜ — en zayıf dayanak, en son (inceleme 09-23): "Varış bilgileri" başlıklı `checkin`
  // kalemindeki "14:00'ten sonra gelebilirsiniz" hiçbir alan adlandırmıyor; kategori bilgisi atılınca
  // mülkün 15:00'ı ile GERÇEK çelişki kaçıyordu. Yalnız cümlecik ve başlık alan adlandırmıyorsa ve
  // cümlecik başka bir konudan söz etmiyorsa kullanılır (başlık ödüncüyle aynı kural).
  const categoryField = category === "checkin" || category === "checkout" ? category : null;
  // "p.m." noktaları cümlecik sınırı sanılmasın (işaret kaybolur, 15:00 → 03:00 okunurdu).
  const flat = text.replace(/\b([ap])\.m\./gi, "$1m");
  const hits: FieldTimeHit[] = [];
  for (const sentence of flat.split(SENTENCE_SPLIT)) {
    let carriedTopic = false;
    let carriedAvailability = false;
    // Tire ile ayrılan devam cümleciği önceki parçanın konusunu taşır ("we can book a taxi to the airport — most guests go for
    // 9:30 AM"; "take out the trash — the bin lorry comes at 8am"): ödünç almaz.
    const clauses = sentence.split(CLAUSE_SPLIT).flatMap((x) => splitKeeping(x, DASH_SEP, 3).map((c, di) => ({ c, dash: di > 0 })));
    let dashTopic = false;
    for (const { c, dash } of clauses) {
      const whole = clauseFields(c);
      if (!dash) dashTopic = false;
      if (CONDITION_RESET.test(c)) carriedAvailability = false;
      const availability = carriedAvailability || whole.availability;
      const byAnd = whole.split ? splitKeeping(c, AND_SEP, 1) : [c];
      for (const piece of byAnd) {
        const parts = splitAtCondition(piece);
        const conditionTopic = parts.length > 1 && clauseFields(parts[0]).topic;
        parts.forEach((part, pi) => {
          const mentions = timeMentions(part);
          if (mentions.length === 0) return;
          const info = clauseFields(part, { stay: whole.stayNoun });
          const otherConcept =
            info.otherConcept || carriedTopic || dashTopic || (pi > 0 && conditionTopic) || (byAnd.length > 1 && whole.otherConcept);
          let field: string | null = null;
          let via: FieldTimeHit["via"] = "clause";
          if (info.fields.length === 1) field = info.fields[0];
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
          const kept = new Set<string>();
          for (const m of mentions) {
            const role = { ...timeRole(part, m.start, m.end), inCondition: insideCondition(part, m.start) };
            if (!excludedTime(field, role, info)) kept.add(m.time);
          }
          for (const time of kept) hits.push({ field, time, via, clause: part.trim() });
        });
      }
      dashTopic ||= whole.otherConcept;
      // Müsaitlik ifadesi ("Subject to availability, …", "Müsaitliğe göre, …") kendiliğinden koşuldur: cümlenin devamına geçer.
      carriedAvailability ||= whole.availability;
      if (isConditionClause(c)) carriedTopic ||= whole.topic;
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
