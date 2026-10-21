import { blankPoliteConditionals } from "@/lib/ai/polite-conditional";
// ─────────────────────────────────────────────────────────────────────────────
// GAZ / KARBONMONOKSİT DEDEKTÖRÜ ÖTÜYOR → OLASI GAZ ACİLİ (G4, kurucu kararı 10-13 "Olası gaz acili say"; DENETIM 08-09 #15)
//
// "Evde karbonmonoksit var" zaten acildi; ama dedektörün KENDİSİNİN ötmesi ("Der Kohlenmonoxidmelder piept", "CO alarm is beeping",
// "Gaz alarmı ötüyor") bazı dillerde / yazımlarda tehlike sayılmıyordu → yapay zekâ "Dedektör mutfak tavanında" gibi bilgi cevabı
// verebiliyordu. Misafir pil uyarısını gerçek alarmdan ayıramaz; karar ev sahibinindir. Kural (tek kaynak, iki ağ okur):
//   · Kanal: `isSafetyEmergencyText` (fallback.ts) → `safety_emergency` → yapay zekâ cevap göndermez, ev sahibine acil.
//   · QR: `hazardEvidenceOf` (hazard-evidence.ts) → açık gaz tehlikesi → model çağrılmaz, ev sahibine kritik bildirim. QR da metni
//     ALINTI SİLİNMEDEN verir (`CO dedektörü "bip bip" yapıyor` iki ağda aynı sonuç — Haiku incelemesi 10-13).
// Kapsam BİLİNÇLİ dar (kurucunun sorusundaki kural): GAZ / CO dedektörü adı + öten / çalan / bip fiili — aynı cümlede ya da hemen
// ardındaki KISA devam cümlesinde ("…mutfakta. Sürekli ötüyor!"). Duman dedektörü bugünkü kuralında kalır (olası duman, karar
// modele). Dedektörün YERİNİ / varlığını sormak ("dedektör nerede?", "Is there a CO detector?"), olumsuz ("ötmüyor", "is not
// beeping", "hat nicht gepiept") ve varsayım ("If the CO alarm goes off…" — varsayım sözcüğü SESTEN ÖNCE) tehlike DEĞİL.
// Fiil kümesi dil başınadır (Almanca "Sonne" = güneş, Fransızca "sonne" = çalıyor): eşleşme yalnız AYNI dilin adıyla.
//
// YAPRAK modül (hiçbir şey import etmez). Kalıplar sabit sözcüklerden oluşur, iç içe niceleyici yok; metin cümlelere bölünür, ad ile
// fiil tek geçişte eşlenir (sıralı iki işaretçi) → 50.000 karakterde de doğrusal iş (süre pini testte). Uzun mesajda (K10-t) yalnız
// acil ağı koşar; bu kural orada da koşar, o yüzden metin KESİLMEZ.
// ─────────────────────────────────────────────────────────────────────────────

const B = "(?<![\\p{L}\\p{N}])"; // sözcük başı
const E = "(?![\\p{L}\\p{N}])"; // sözcük sonu

type Lang = "tr" | "en" | "de" | "fr" | "es";

/** Gaz / CO dedektörü adı, dil başına (katlanmış metinde: küçük harf, aksansız, Türkçe harfler ASCII). */
const GAS_DETECTOR: Record<Lang, RegExp> = {
  // karbonmonoksit / CO / (doğal)gaz + dedektör / alarm / sensör / algılayıcı (+ iyelik / hâl eki); "CO-dedektörü" tireli de.
  tr: new RegExp(`${B}(?:karbon ?monoksit|co|(?:dogal ?)?gaz)[- ](?:kacak |kacagi )?(?:dedektor|detektor|alarm|sensor|algilayici)\\p{L}{0,6}${E}`, "gu"),
  en: new RegExp(`${B}(?:carbon[- ]monoxide|co|gas)[- ](?:detector|alarm|sensor|monitor)s?${E}`, "gu"),
  // Bitişik bileşikler ("Kohlenmonoxidmelder", "CO-Melder", "CO Melder", "Gaswarnmelder", "Gasalarm").
  de: new RegExp(`${B}(?:kohlenmonoxid|co|gas)[- ]?(?:warn)?(?:melder|alarm|sensor)\\p{L}{0,3}${E}`, "gu"),
  fr: new RegExp(`${B}(?:detecteur|alarme|capteur)s? (?:de |d'|a )?(?:monoxyde de carbone|co|gaz)${E}`, "gu"),
  es: new RegExp(`${B}(?:detector|detectores|alarma|alarmas|sensor|sensores) de (?:monoxido de carbono|co|gas)${E}`, "gu"),
};

/**
 * DUMAN / YANGIN DEDEKTÖRÜ (H3, kurucu kararı 10-13 "Evet, doğrudan ev sahibine"): aynı kural, aynı fiil / olumsuz / varsayım / devam
 * cümlesi işleyişi. Evde duman alarmı ile yangın alarmı aynı cihazdır ("smoke alarm" = "fire alarm", "Rauchmelder" = "Brandmelder").
 */
const SMOKE_DETECTOR: Record<Lang, RegExp> = {
  tr: new RegExp(`${B}(?:duman|yangin)[- ](?:dedektor|detektor|alarm|sensor|algilayici)\\p{L}{0,6}${E}`, "gu"),
  en: new RegExp(`${B}(?:smoke|fire)[- ](?:detector|alarm|sensor)s?${E}`, "gu"),
  de: new RegExp(`${B}(?:rauch|rauchwarn|brand|feuer|feuerwarn)[- ]?(?:melder|alarm)\\p{L}{0,3}${E}`, "gu"),
  fr: new RegExp(`${B}(?:detecteur|alarme)s? (?:de |d'|a )?(?:fumee|incendie)${E}`, "gu"),
  es: new RegExp(`${B}(?:detector|detectores|alarma|alarmas) (?:de|contra) (?:humo|incendios?)${E}`, "gu"),
};

/**
 * Öten / çalan / bip — süren ya da az önce olan ses; dil başına OLUMLU biçimler. Türkçe fiil yalnız kişi / soru / rivayet / geçmiş
 * ekiyle biter ("ötüyor", "ötüyormuş", "ötüyordu", "çalıyor mu"): "öttüğünü duymadım" (ad-fiil), "ötmüyor" (olumsuz çekim) ve
 * "çalıyorsa / öttüyse" (koşul eki — bildirim değil koşul) EŞLEŞMEZ; ayrı koşul denetimi bu yüzden yok (mutasyon 10-13: ölü koddu).
 * "Susmuyor" (ses sürüyor) olumlu bildirimdir.
 */
const SOUNDING: Record<Lang, RegExp> = {
  tr: new RegExp(
    `${B}(?:(?:otuyor|ottu|caliyor|caldi|bipliyor|bipledi|susmuyor)(?:lar|m|n|k|mus|mu|mi|du|dum|dun|duk|dular)?|(?:otmeye|calmaya|biplemeye) basla\\p{L}{0,6}|(?:otmeyi|calmayi|biplemeyi) birakti\\p{L}{0,4}|sustu|durdu|durmuyor|ciglik at(?:iyor|ti)\\p{L}{0,4}|bip bip|bip sesi (?:veriyor|cikariyor|geliyor)|ses (?:veriyor|cikariyor)|uyari veriyor|alarm veriyor|otup duruyor|calip duruyor)${E}`,
    "gu",
  ),
  // "is on" BİLEREK YOK: "the CO detector is on the ceiling" yer cümlesidir.
  // shriek / screech / squeal / whine / wail / howl / whistle / honk yalnız dil karışımı listesinde (başka dilde sözcük değil; mutasyon AG4).
  en: new RegExp(`${B}(?:beep(?:s|ing|ed)?|chirp(?:s|ing|ed)?|buzz(?:es|ing|ed)?|going off|went off|goes off|gone off|sounds|sounding|sounded|ringing|blaring|screaming|(?:won't|wont|will not|doesn't|doesnt|does not|never) stops?(?! \\p{L}{2,}ing)|keeps going(?! on))${E}`, "gu"),
  de: new RegExp(`${B}(?:piept|piepst|piepen|piepsen|gepiept|piepton|klingelt|klingelte|heulte|schlagt an|schlagt alarm|alarm schlagt|hat angeschlagen|geht los|losgegangen|heult|ertont|hort nicht auf)${E}`, "gu"),
  fr: new RegExp(`${B}(?:sonne|sonnent|sonner|a sonne|bipe|bipent|retentit|retentissait|se declenche|s'est declenche|declenche|ne s'arrete pas|s'arrete pas)${E}`, "gu"),
  es: new RegExp(`${B}(?:suena|suenan|sonando|sonar|sono|pita|pitan|pitando|pito|pitaba|pitaban|se activo|se ha activado|no para(?! de))${E}`, "gu"),
};
const LANGS = Object.keys(GAS_DETECTOR) as Lang[];
/** Herhangi bir dedektör adı (gaz ya da duman, her dil) — tek tarama (maliyet: devam cümlesi başına bir geçiş). */
const ANY_DETECTOR = new RegExp(
  [...Object.values(GAS_DETECTOR), ...Object.values(SMOKE_DETECTOR)].map((re) => `(?:${re.source})`).join("|"),
  "u",
);
/**
 * DİL KARIŞIMI (Haiku incelemesi 10-13): misafir dili karıştırır ("CO alarmı sürekli beep yapıyor"). Ad bir dilde, fiil başka dilde ise
 * YALNIZ başka bir dilde sıradan sözcük OLMAYAN fiiller eşleşir: Fransızca "sonne / sonner" (Almanca "Sonne" = güneş), İspanyolca
 * "sono" (İtalyanca "sono" = -im), "pita / pito / pitan" (pide, düdük) yalnız kendi dilinin adıyla. İngilizce "ringing" de yalnız
 * İngilizce adla (3. inceleme: "CO dedektörü nerede, telefon ringing" — çalan telefondur).
 */
const CROSS_LANGUAGE_SAFE = new RegExp(
  `${B}(?:beep(?:s|ing|ed)?|chirp(?:s|ing|ed)?|buzz(?:es|ing|ed)?|going off|went off|goes off|gone off|sounding|sounded|blaring|scream(?:s|ing|ed)?|shriek(?:s|ing|ed)?|screech(?:es|ing|ed)?|squeal(?:s|ing|ed)?|whin(?:es|ing|ed)|wail(?:s|ing|ed)?|howl(?:s|ing|ed)?|whistl(?:es|ing|ed)|honk(?:s|ing|ed)?|piept|piepst|piepen|piepsen|gepiept|piepton|piepte|piepten|piepste|bipe|bipent|bipait|bipaient|retentit|sonnait|sonnaient|suena|suenan|sonando|sonaba|sonaban|(?:otuyor|ottu|caliyor|caldi|bipliyor|bipledi|susmuyor)(?:lar|m|n|k|mus|mu|mi|du|dum|dun|duk|dular)?|bip bip)${E}`,
  "gu",
);
/** Herhangi bir ses fiili (her dil + dil karışımı; başka dilde sözcük olmayan geçmiş süreklilikler — sonnait, sonaba, piepte — yalnız
 * dil karışımı listesinde, mutasyon AC3 ikinci kopyayı ölü buldu) — sessiz komşu cümlenin olguları hiç hesaplanmaz (maliyet; Haiku 5–6. tur ölçümü). */
const ANY_SOUND = new RegExp([...Object.values(SOUNDING), CROSS_LANGUAGE_SAFE].map((re) => `(?:${re.source})`).join("|"), "u");

/**
 * Olumsuzlama — ses fiilinin hemen ÖNÜNDE (≤ 28 karakter; araya en çok iki sözcük: "not making any beeps", "hat nicht gepiept").
 * Olumsuz sözcükten sonra boşluk ŞART ("neden" ≠ "ne"). Fransızca "ne" BİLEREK YOK: Türkçede "ne" sorudur ("ne ötüyor böyle?") —
 * Fransızca olumsuzluk ardındaki "pas / plus" ile tanınır (↓). Türkçe olumsuzluk çekimdedir ve olumlu fiil listesine girmez.
 */
const PLAIN_NEG =
  /(?:^|\s)(?:not|isn't|isnt|aren't|arent|wasn't|wasnt|doesn't|doesnt|didn't|didnt|hasn't|hasnt|haven't|havent|won't|wont|never|nothing|no longer|no|ya no|nicht|nichts|kein|keine|nie|rien|nada)\s((?:\p{L}{1,12}\s){0,2})$/u;
/**
 * DURDU / ARTIK ÖTMÜYOR da BİLDİRİMDİR (Haiku 4. tur, kurucu sorusu H4'ün güvenli varsayılanı): ses ÇALMIŞ — "stopped beeping", "dejó de
 * sonar", "a cessé de sonner", "hat aufgehört zu piepen", "no longer beeps", "doesn't beep anymore", "piept nicht mehr", "ne sonne plus",
 * "ya no suena". Önce: "The CO alarm stopped beeping, should we stay in the house?" yapay zekâya kalıyordu. Çift olumsuz ("has not
 * stopped") zaten süren sestir. Yalnız hiç ÇALMAMIŞ ses ("is not beeping", "hat nicht gepiept") bildirim değil.
 */
const STOPPED_NEG = /(?:^|\s)(?:stopped|dejo de|ha dejado de|a cesse de|a arrete de|aufgehort zu)\s(?:\p{L}{1,12}\s){0,1}$/u;
const NO_LONGER_BEFORE = /(?:^|\s)(?:no longer|ya no)\s(?:\p{L}{1,12}\s){0,2}$/u;
const NO_LONGER_AFTER = /^(?:\s\p{L}{1,12}){0,2}\s(?:anymore|any more)(?![\p{L}\p{N}])|^\s(?:nicht mehr|mehr nicht|plus|no mas|nunca mas)(?![\p{L}\p{N}])/u;
/** Olumsuzlama — ses fiilinin hemen ARDINDA (≤ 14 karakter): "piept nicht", "(ne) sonne pas / plus", "no suena nunca". */
const NEG_AFTER = /^\s(?:nicht|nie|pas|plus|mehr nicht|nunca)(?![\p{L}\p{N}])/u;
/** Varsayım / yordam sorusu — yalnız SESTEN ÖNCE gelirse: "If the CO alarm goes off…" evet; "…is beeping, I don't know if…" hayır. */
const HYPOTHETICAL_SRC =
  "(?:^|\\s)(?:if|in case|what if|should the|what (?:do|should) (?:i|we) do when|falls|wenn|sollte|eger|durumunda|halinde|au cas ou|en cas de|que faire si|en caso de|que hago si|que hacer si)(?![\\p{L}\\p{N}])";
const HYPOTHETICAL_ALL = new RegExp(HYPOTHETICAL_SRC, "gu");
/** Devam cümlesi: bir önceki cümledeki dedektörü sürdüren kısa cümle ("It keeps beeping!", "Sürekli ötüyor!", "Es piept."). */
const CONTINUATION_START =
  /^(?:it|it's|its|the one|that one|this one|that|this|still|keeps|now|again|constantly|er|es|sie|immer|standig|il|elle|ca|encore|toujours|sigue|esta|ahora|todavia|surekli|hala|simdi|durmadan|yine|hep)(?![\p{L}\p{N}])/u;
/**
 * Zamir / zarfsız devam cümlesi yalnız TEK sözcük ("Ötüyor!") ya da doğrudan SES fiiliyle başlayan cümle ("Suena sin parar!") —
 * "Telefon çalıyor." başka bir öznedir (3. inceleme; zarf listesi son kontrol: "Şimdi ötüyor!").
 */
const CONTINUATION_MAX_WORDS = 1;
/**
 * GERİYE ATIF: önceki cümlede AÇIKLANMAMIŞ ses (dedektör adı ve olumsuzlanmamış başka kaynak yok), bu cümle bir dedektörü anıyor →
 * bildirim ("Something keeps beeping. It's the CO alarm.", "Bir şey sürekli ötüyor. CO alarmıymış.", "Something keeps beeping. Where is
 * the CO alarm?" — ses dedektör olabilir; karar ev sahibinin). Claude 6. tur sondası; tanıtım kalıbı şartı mutasyonla (V5) gereksiz çıktı.
 */
const PRONOUN_RIGHT_BEFORE = /(?:^|\s)(?:it|er|es|sie|il|elle|ca|o)\s$/u;
/**
 * Devam cümlesinde ÇIPLAK dedektör adı (niteleyicisiz: "the alarm", "le détecteur", "der Melder", "la alarma", "alarm") sesin hemen önünde
 * → önceki cümledeki dedektöre atıf ("Where is the CO alarm? Le détecteur sonne.", "The alarm keeps beeping" — Haiku 13. tur).
 */
const GENERIC_DETECTOR_BEFORE =
  /(?:^|\s)(?:detector|alarm|sensor|detecteur|alarme|capteur|melder|warnmelder|alarma|dedektor\p{L}{0,4}|alarm\p{L}{0,4}|sensor\p{L}{0,4})(?:\s(?:in|on|at|by|near|im|am|dans|sur|en|de)\s(?:(?:the|my|our|der|die|das|dem|le|la|l'|el)\s)?\p{L}{1,14})?\s(?:\p{L}{1,12}\s)?$/u;
/** Ses fiilinin hemen önünde özne zamiri ("Last night it went off", "er piept") — devam cümlesi işareti (Haiku 4. tur). */
const PRONOUN_BEFORE = /(?:^|\s)(?:it|it's|its|er|es|sie|il|elle|ca|o)\s(?:\p{L}{1,12}\s)?$/u;
const SOURCE_WORDS =
  "phone|telephone|mobile|cell|doorbell|clock|oven|microwave|washer|washing machine|dryer|dishwasher|fridge|timer|kettle|printer|tv|television|music|car|truck|laptop|computer|tablet|router|elevator|lift|baby monitor|burglar|intruder|wind|dogs?|cats?|birds?|kids?|child|children|bab(?:y|ies)|people|traffic|ruzgar\\p{L}{0,4}|kopek\\p{L}{0,4}|cocuk\\p{L}{0,6}|bebe[kg]\\p{L}{0,4}|kedi\\p{L}{0,4}|kus\\p{L}{0,4}|trafik\\p{L}{0,4}|hund\\p{L}{0,2}|kinder|katze|vogel|verkehr|vent|chien\\p{L}{0,2}|enfants?|chat|oiseaux?|circulation|viento|perros?|ninos?|gatos?|pajaros?|trafico|einbruch\\p{L}{0,8}|hirsiz\\p{L}{0,4}|antirrobo|intrusion|neighbou?r\\p{L}{0,6}|telefon\\p{L}{0,6}|zil\\p{L}{0,4}|saat\\p{L}{0,4}|firin\\p{L}{0,4}|mikrodalga\\p{L}{0,4}|makine\\p{L}{0,4}|buzdolab\\p{L}{0,4}|caydanli[kg]\\p{L}{0,4}|yazici\\p{L}{0,4}|televizyon\\p{L}{0,4}|muzi[kg]\\p{L}{0,4}|komsu\\p{L}{0,6}|araba\\p{L}{0,4}|camasir\\p{L}{0,8}|kurutma\\p{L}{0,8}|bilgisayar\\p{L}{0,4}|asansor\\p{L}{0,4}|handy|wecker|klingel|wasserkocher|drucker|fernseher|musik|nachbar\\p{L}{0,4}|auto|trockner|waschmaschine|aufzug|telefono|movil|portable|reveil|horno|minuteur|bouilloire|imprimante|tele|musique|voisin\\p{L}{0,2}|voiture|seche-linge|ordinateur|ascenseur|hervidor|secadora|ordenador|ascensor|impresora|musica|vecino\\p{L}{0,2}|coche";
const OTHER_SOUND_SOURCE = new RegExp(`(?<![\\p{L}\\p{N}])(?:${SOURCE_WORDS})(?![\\p{L}\\p{N}])`, "gu");
/** Olumsuzlanan kaynak adı kaynak değildir ("It is not my phone, it is beeping", "Not my phone, it keeps beeping", "telefon değil" — Haiku 5. tur). */
const NEG_BEFORE_SOURCE =
  /(?:^|\s)(?:not|isn't|isnt|wasn't|wasnt|aren't|arent|no|nicht|kein|keine|pas|ni)\s(?:(?:my|the|a|mein|meine|das|der|die|mon|ma|le|la|mi|el)\s)?$/u;
const NEG_AFTER_SOURCE = /^\p{L}{0,6}\s(?:degil|degildi)(?![\p{L}\p{N}])/u;
/**
 * YER tamlayıcısındaki cihaz adı ses kaynağı değildir (Haiku 8. tur: "Something keeps beeping near the kettle. It's the CO alarm.",
 * "…in the kitchen next to the kettle") — edat önde (near / next to / by / neben / près de / cerca de …) ya da Türkçe ardıl edat sonda
 * ("çaydanlığın yanında").
 */
const LOC_BEFORE_SOURCE =
  /(?:^|\s)(?:near|next to|by|beside|behind|above|below|under|over|in front|on top|opposite|across from|in|at|on|inside|from|neben|bei|beim|im|am|uber|unter|hinter|vor|auf|dans|sur|pres|a cote|au-dessus|sous|devant|en face|cerca|junto|al lado|encima|debajo|delante|frente|enfrente|en|dentro)(?:\s(?:of|de|del|du|des|a|al|au|aux|dem|der))?\s(?:(?:the|my|our|a|an|der|die|das|dem|den|le|la|l'|el|un|une|mi|mein|meinem)\s)?$/u;
const LOC_AFTER_SOURCE = /^\p{L}{0,6}\s(?:yaninda|yakininda|ustunde|altinda|arkasinda|onunde)(?![\p{L}\p{N}])/u;
/** Cihaz adı yalnız niteleyici mi (olumsuzlanmış ya da yer tamlayıcısında)? */
function sourceIsModifier(text: string, at: number, end: number): boolean {
  const before = text.slice(Math.max(0, at - 20), at);
  const after = text.slice(end, end + 16);
  return NEG_BEFORE_SOURCE.test(before) || NEG_AFTER_SOURCE.test(after) || LOC_BEFORE_SOURCE.test(before) || LOC_AFTER_SOURCE.test(after);
}
/**
 * SES BAŞKA BİR CİHAZIN MI? (Haiku 3–9. tur — cihaz adını cümlecikte GÖRMEK yetmiyordu: "in the dryer room", "lift lobby", "near the
 * kettle" gerçek CO bildirimini susturuyordu.) Cihaz sesin DİLBİLGİSİ KOMŞUSU ise ses onundur:
 *  · özne olarak hemen önünde, araya en çok iki sözcük ("my phone is beeping", "the kettle no longer beeps", "müziği hâlâ çalıyor");
 *  · fiil-önce dizilişte hemen ardında, isteğe bağlı belirleyiciyle ("piept mein Handy", "suena el teléfono", "beeping phone").
 * Olumsuzlanan / yer tamlayıcısındaki cihaz sayılmaz. Bunun dışında yalnız açık bağlama (↓ ATTRIBUTION: "it's the kettle") koparır.
 */
const SOURCE_SUBJECT_BEFORE = new RegExp(`(?<![\\p{L}\\p{N}])(?:${SOURCE_WORDS})(?:'s)?\\s(?:\\p{L}{1,12}\\s){0,2}$`, "u");
const SOURCE_AT_START = new RegExp(`^(?:${SOURCE_WORDS})`, "u");
const ANY_DETECTOR_G = new RegExp(ANY_DETECTOR.source, "gu");
const CO_SUBJECT_TAIL = /^\s(?:and|&|ve|ile|und|et|y)\s(?:[\p{L}']{1,14}\s){1,4}$/u;
const ANIMATE_PRONE = /^(?:shriek|screech|squeal|whin|wail|howl|whistl|honk|scream)/u;
const CONJ_START = /^(?:and|y|et|und|ve|e|then|und dann|puis)(?![\p{L}\p{N}])/u;
const SOURCE_RIGHT_AFTER = new RegExp(
  `^\\s(?:(?:my|the|our|a|an|mein|meine|das|der|die|le|la|mon|ma|el|mi|su)\\s)?(?:${SOURCE_WORDS})(?![\\p{L}\\p{N}])`,
  "u",
);
function soundOfOtherSource(text: string, s: Span): boolean {
  const lo = Math.max(0, s.start - 48);
  const m = SOURCE_SUBJECT_BEFORE.exec(text.slice(lo, s.start));
  if (m) {
    const at = lo + m.index;
    const word = SOURCE_AT_START.exec(m[0])?.[0] ?? "";
    // Cihazla ses arasındaki sözcükler bağlaçla başlıyorsa cihaz özne değildir ("Está al lado del horno y suena", "im Auto und piept").
    const between = m[0].slice(word.length).replace(/^'s/u, "").trimStart();
    if (!sourceIsModifier(text, at, at + word.length) && !CONJ_START.test(between)) return true;
  }
  return SOURCE_RIGHT_AFTER.test(text.slice(s.end, s.end + 32));
}

/**
 * DURDU sesi BAŞKA cihazınsa dedektörün sesi değildir (Haiku 5. tur: "The microwave stopped beeping, is the CO alarm okay?" gaz acili
 * sayılıyordu): ses o cihazın (↑) ve sesten önce aynı cümlede dedektör adı YOK. Dedektör adı önce geçiyorsa ses onundur — virgüllü liste
 * dahil (Haiku 6–7. tur: "The CO alarm next to the oven stopped beeping", "The CO alarm, the phone and the kettle stopped beeping").
 * Bilinçli bedel: "The CO alarm is fine, the microwave stopped beeping" de ev sahibine (güvenli yön). YALNIZ durdu biçiminde — süren seste
 * "CO alarmı ve telefonum ötüyor" gerçek bildirimdir.
 */
const CLAUSE_MAX = 160;
function otherDeviceStopped(sentence: string, s: Span): boolean {
  return soundOfOtherSource(sentence, s) && !ANY_DETECTOR.test(sentence.slice(Math.max(0, s.start - CLAUSE_MAX), s.start));
}
const ATTRIBUTION = new RegExp(
  `(?:^|\\s)(?:that's|thats|that is|it's|its|it is|this is|das ist|das war|es ist|c'est|es el|es la|es mi|bu|o)\\s(?:just |only |nur |juste |solo |sadece )?(?:my |the |our |a |an |mein |meine |das |der |die |le |la |mon |ma |mi |el |benim )?(?:${SOURCE_WORDS})(?![\\p{L}\\p{N}])(?!'s? (?:room|zimmer)|\\s(?:room|zimmer|chambre|oda\\p{L}{0,3}))`,
  "u",
);
/**
 * Geri alma: ardındaki cümle çıplak "Hayır." ya da "Hayır, çaydanlık." ("Something keeps beeping. Is it the CO alarm? No." — Haiku 8. tur).
 * "No, it keeps beeping!" geri alma DEĞİL (kaynak yok, ses var).
 */
const RETRACTION_NEXT = new RegExp(
  `^(?:no|nope|nein|non|hayir|degil)(?:$|,?\\s(?:(?:it's|its|it is|that's|the|my|a|an|der|die|das|le|la|el|mi|bu|o)\\s){0,3}(?:${SOURCE_WORDS})(?![\\p{L}\\p{N}]))`,
  "u",
);

/**
 * GEÇMİŞ ZAMAN İNDİRİMİ YOK (Haiku son kontrolü 10-13, üç tur, ölçüldü): "dün gece öttü, şimdi iyi" ayrımı sözcük listesiyle GÜVENLİ
 * kurulamıyor — "bitti" sözcüğü başka nesneyi anlatabiliyor ("Dün gece gaz alarmı öttü ve kombi durdu", "…bebek sustu", "I checked the
 * boiler and it's fine", "…and we turned off the gas valve") ve her turda yeni yanlış negatif çıktı. Kural: dedektör öttü bildirimi
 * geçmiş zamanda da ev sahibine (G4 itilmiş hâliyle aynı; H3 "öterse doğrudan ev sahibine"). Yalnız SESİN KENDİSİ durdu / olumsuz
 * ("stopped beeping", "is not beeping") bildirim değildir.
 */
/** SES SÜRÜYOR beyanı — yordam biçimli cümleyi de bildirime çevirir ("When the CO alarm goes off it won't stop"). */
const ONGOING = /(?:^|\s)(?:won't stop|wont stop|will not stop|doesn't stop|doesnt stop|does not stop|never stops|keeps|still|nonstop|non-stop|right now|just now|hala|halen|surekli|durmadan|az once|demin|eben|gerade|immer noch|hort nicht auf|toujours|a l'instant|en ce moment|sigue|todavia|ahora mismo|recien|no para)(?![\p{L}\p{N}])/u;
/**
 * Gelecek zaman sesin hemen önünde ("It will beep for five seconds", "it'll beep", "il va sonner", "va a sonar") — bildirim değil. İKİ
 * istisna (Haiku son kontrolü 10-13): araya giren sözcük SÜRME fiiliyse ses ŞU AN var ("is going to keep beeping until someone comes",
 * "va a seguir sonando", "wird weiter piepen"); İspanyolca çıplak "va" + ulaç süren zamandır ("la alarma de gas va sonando").
 */
const FUTURE_BEFORE = /(?:(?:^|\s)(will|going to|gonna|wird|werden|va|vont|sera|va a|van a)|\p{L}('ll))\s(?:(\p{L}{1,12})\s)?$/u;
const KEEP_VERB = /^(?:keep|continue|stay|remain|still|seguir|weiter|noch|continuer)$/u;
const ES_GERUND = /^(?:sonando|pitando)$/u;
function futureBefore(sentence: string, s: Span): boolean {
  const m = FUTURE_BEFORE.exec(sentence.slice(Math.max(0, s.start - 24), s.start));
  if (!m) return false;
  if (m[3] && KEEP_VERB.test(m[3])) return false;
  if (m[1] === "va" && !m[3] && ES_GERUND.test(sentence.slice(s.start, s.end))) return false;
  return true;
}
/**
 * Yordam sorusu: "When the smoke alarm goes off, what do I do?" — "when / whenever / quand / cuando" DOĞRUDAN dedektörü yönetiyor
 * (araya en çok bir belirleyici) + GENİŞ zaman. Yan cümlenin kendi öznesi varsa ana cümle BİLDİRİMDİR (Haiku son kontrolü 10-13:
 * "When I open the door the smoke alarm goes off", "Whenever I cook the CO alarm beeps" → ev sahibine). Sürüyor beyanı da bildirimdir.
 */
const WHEN_GOVERNS =
  /(?:^|\s)(?:when|whenever|quand|cuando)\s(?:(?:the|my|our|your|his|her|their|its|this|that|a|an|any|each|le|la|les|un|une|mon|ma|mes|ton|ta|son|sa|notre|votre|el|los|las|una|mi|mis|tu|su|sus|nuestra|nuestro|der|die|das|den|ein|eine|mein|meine|unser|unsere|ihr|ihre)\s|l')?$/u;
const GENERIC_PRESENT = /^(?:goes off|beeps|chirps|buzzes|sounds|sonne|sonnent|suena|suenan|pita|pitan)$/u;

/** Cümle yakınlığı: ad ile fiil arasında en çok bu kadar karakter (iki yönde de: "Es piept der CO-Melder", "Suena la alarma de gas"). */
const NEAR = 80;

/** Katlama: küçük harf, aksan / birleştirici işaret silinir, Türkçe harfler ASCII, boşluklar teke iner. Önceden katlanmış metinde etkisiz. */
function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/ß/g, "ss")
    .replace(/[’`´]/g, "'")
    .replace(/\s+/g, " ");
}

type Span = { start: number; end: number };

function spans(re: RegExp, text: string): Span[] {
  const out: Span[] = [];
  for (const m of text.matchAll(re)) out.push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  return out;
}

/** Fiil gerçekten SES bildiriyor mu (olumsuz / koşul / varsayım değil)? */
/**
 * "Doesn't stop beeping" / "no para de sonar" — olumsuz + DUR fiili = ses SÜRÜYOR (çift olumsuz; Haiku incelemesi 10-13). DUR fiili
 * olumsuz sözcük ile ses fiilinin ARASINDA olmalı (3. inceleme: "Stop it, the CO alarm isn't ringing" çift olumsuz DEĞİLDİR).
 * Almanca ayrılabilir "hört nicht auf zu piepen": "hört" olumsuzdan ÖNCE gelir → ayrıca tanınır.
 */
const STOP_VERB = /(?:^|\s)(?:stop|stops|stopping|quit|aufhoren|aufgehort|arrete|arreter|para|parar|deja|dejar)(?:\s|$)/u;
/** Almanca ayrılabilir "hört (leider) nicht auf zu piepen" — "hört" ile "nicht" arasında en çok iki sözcük. */
const DE_STOP_SEPARABLE = /(?:^|\s)(?:hort|hoert)(?: \p{L}{1,12}){0,2} nicht auf zu $/u;

/**
 * "sounds / sounded / sounding" ardından DEĞERLENDİRME gelirse ses değil görüştür (Haiku 15. tur: "Sounds good, the smoke alarm is in the
 * hall", "The CO alarm sounds like a good idea", "the fire alarm test sounded fine").
 */
const SOUNDS_OPINION =
  /^\s(?:like (?:(?:a|an)\s)?(?:good|great|nice|bad|fine|perfect|plan|idea|deal|fun|joke|lot|you|we|they|it will|it would)|good|great|fine|perfect|ok|okay|nice|right|reasonable|interesting|lovely|amazing|awesome|cool|wonderful|excellent|helpful|about right|to me|logical|easy|simple)(?![\p{L}\p{N}])/u;

function liveSound(sentence: string, s: Span, firstHypo: number): boolean {
  if (/^sound(?:s|ed|ing)$/u.test(sentence.slice(s.start, s.end)) && SOUNDS_OPINION.test(sentence.slice(s.end, s.end + 16))) return false;
  const before = sentence.slice(Math.max(0, s.start - 40), s.start);
  // Ses ÇALMIŞ (durdu / artık ötmüyor) → olumsuz denetimi atlanır (↑ STOPPED_NEG).
  const soundedBefore =
    STOPPED_NEG.test(before) || NO_LONGER_BEFORE.test(before) || NO_LONGER_AFTER.test(sentence.slice(s.end, s.end + 30));
  if (soundedBefore) {
    // Başka cihazın durdu sesi dedektöre bağlanmaz ("The microwave stopped beeping, is the CO alarm okay?").
    if (otherDeviceStopped(sentence, s)) return false;
  } else {
    const neg = PLAIN_NEG.exec(before);
    // Olumsuzluk BAŞKA bir yüklemi bağlaçla bitiriyorsa sese uzanmaz (Claude 2. dalga #18): "The CO alarm is not working AND beeping",
    // "çalışmıyor ve ötüyor" — "not … and" arasındaki sözcük ayrı yüklemdir, ses olumsuzlanmamıştır.
    if (neg && !STOP_VERB.test(` ${neg[1]}`) && !DE_STOP_SEPARABLE.test(before) && !NEG_ENDS_IN_CONJUNCTION.test(` ${neg[1]}`)) return false;
    if (NEG_AFTER.test(sentence.slice(s.end, s.end + 14))) return false;
  }
  if (futureBefore(sentence, s)) return false;
  return !(firstHypo < s.start) || hypotheticalReleased(sentence, firstHypo, s.start);
}

/** Olumsuzluk penceresinin son sözcüğü bağlaç mı ("not working and ", "nicht kaputt und ")? */
const NEG_ENDS_IN_CONJUNCTION = /\s(?:and|or|but|und|oder|aber|et|ou|mais|y|o|pero|ve|veya|ama|и|или|но)\s$/u;
/** Karşıtlık bağlacı: önceki varsayım / belirsizlik cümleciği burada KAPANIR ("Sorry if this is silly BUT the CO alarm is beeping"). */
const CONTRAST = /(?:^|\s)(?:but|however|though|aber|jedoch|ama|ancak|fakat|lakin|mais|pero|sin embargo|но|однако)(?![\p{L}\p{N}])/u;
/** Varsayım penceresi — sınırlı (her ses için doğrusal tarama karesel olmasın). */
const HYPO_RELEASE_WINDOW = 200;

/**
 * Varsayım sözcüğü sesten ÖNCE ama başka bir cümlecikte (Claude 2. dalga #53): araya karşıtlık bağlacı girdiyse ("I don't know if it matters
 * but the CO detector is beeping") ya da virgülden sonraki cümlecik SÜREN sesi söylüyorsa ("Not sure if it's serious, the CO alarm keeps
 * beeping") ses canlıdır. Ayrımdan sonra YENİ bir varsayım sözcüğü varsa ("Not sure, but if the alarm beeps…") varsayım sürer. Virgülden
 * sonra süreklilik işareti yoksa ("If we cook, will the CO alarm beep?") eski davranış (varsayım).
 */
function hypotheticalReleased(sentence: string, firstHypo: number, soundStart: number): boolean {
  const from = Math.max(firstHypo, soundStart - HYPO_RELEASE_WINDOW);
  const between = sentence.slice(from, soundStart);
  let cut = -1;
  const contrast = CONTRAST.exec(between);
  if (contrast) cut = contrast.index + contrast[0].length;
  else {
    const comma = between.lastIndexOf(",");
    if (comma >= 0 && ONGOING.test(sentence.slice(from + comma, Math.min(sentence.length, from + comma + HYPO_RELEASE_WINDOW)))) cut = comma + 1;
  }
  if (cut < 0) return false;
  return spans(HYPOTHETICAL_ALL, blankPoliteConditionals(between.slice(cut))).length === 0;
}

/** Sıralı iki işaretçi: herhangi bir ad–fiil çifti ≤ NEAR karakter mi? O(D + S) (iki dizi de konuma göre sıralı). */
function anyNear(detectors: readonly Span[], sounds: readonly Span[]): boolean {
  let i = 0;
  for (const s of sounds) {
    while (i < detectors.length && detectors[i].end < s.start - NEAR) i++;
    if (i < detectors.length && detectors[i].start <= s.end + NEAR) return true;
  }
  return false;
}

/** Misafir metni bir gaz / CO dedektörünün ŞU AN (ya da az önce) öttüğünü bildiriyor mu? */
export function gasDetectorSounding(message: string | null | undefined): boolean {
  return detectorSounding(message, GAS_DETECTOR);
}

/** Misafir metni bir duman / yangın dedektörünün ŞU AN (ya da az önce) öttüğünü bildiriyor mu? (H3, kurucu kararı 10-13) */
export function smokeDetectorSounding(message: string | null | undefined): boolean {
  return detectorSounding(message, SMOKE_DETECTOR);
}

function detectorSounding(message: string | null | undefined, DETECTOR: Record<Lang, RegExp>): boolean {
  if (typeof message !== "string" || message.length === 0) return false;
  const sentences = fold(message).split(/[.!?;؟\n]+/u).map((s) => s.trim());
  // Cümle başına BİR KEZ (maliyet pini: ses başına cümle taraması 50.000 karakterde karesel idi).
  const ongoing = sentences.map((s) => ONGOING.test(s));
  const hasSound = sentences.map((s) => ANY_SOUND.test(s));
  const allSounds = (text: string) => [...LANGS.map((l) => SOUNDING[l]), CROSS_LANGUAGE_SAFE].flatMap((re) => spans(re, text));
  for (let k = 0; k < sentences.length; k++) {
    const sentence = sentences[k];
    if (sentence.length < 6) continue;
    // Dedektör adı yoksa cümle okunmaz — yoğun kısa cümlelerde sabit maliyet (Haiku 5. tur ölçümü).
    const detectorsByLang = LANGS.map((lang) => spans(DETECTOR[lang], sentence));
    if (detectorsByLang.every((d) => d.length === 0)) continue;
    // İlk varsayım sözcüğünün yeri yeter (ses ondan sonraysa varsayımdır) — ses başına tarama yok (maliyet O(S + H)).
    // Y1 (10-14 dış inceleme): nezaket kalıbı ("If you have a moment, our CO alarm is beeping") varsayım DEĞİL — tehlike okuyucusuyla
    // aynı liste, konum koruyarak boşlanır; gerçek varsayım ("If the CO alarm beeps, what should we do?") aynen kalır.
    const firstHypo = spans(HYPOTHETICAL_ALL, blankPoliteConditionals(sentence))[0]?.start ?? Infinity;
    const live = (s: Span) => liveSound(sentence, s, firstHypo);
    // Canlı / hava kaynaklı olabilen fiiller (howl, whistle, honk, screech …) AYNI cümlede de öznesine bakar (Haiku 18. tur: "The wind is
    // whistling, where is the CO detector?", "The kids are screeching next to the smoke alarm"). Eski fiillerde bilinçli olarak yok —
    // "CO alarmı ve telefonum ötüyor" gerçek bildirimdir.
    // ORTAK ÖZNE: dedektör adı sesin öznesine BAĞLAÇLA bağlı ("The CO alarm and the dog are howling" — Haiku 19. tur); "The CO alarm is
    // fine and the dog is howling" ortak özne DEĞİL (Haiku 20. tur) — dedektör adı ile ses arasında yalnız bağlaç + en çok 4 sözcük.
    const detectorEarlierInClause = (s: Span) => {
      const w = sentence.slice(Math.max(0, s.start - CLAUSE_MAX), s.start);
      const clause = w.slice(w.lastIndexOf(",") + 1);
      let lastEnd = -1;
      for (const m of clause.matchAll(ANY_DETECTOR_G)) lastEnd = (m.index ?? 0) + m[0].length;
      return lastEnd >= 0 && CO_SUBJECT_TAIL.test(clause.slice(lastEnd));
    };
    const sameLive = (s: Span) =>
      live(s) &&
      !(ANIMATE_PRONE.test(sentence.slice(s.start, s.end)) && soundOfOtherSource(sentence, s) && !detectorEarlierInClause(s));
    const crossSounds = spans(CROSS_LANGUAGE_SAFE, sentence).filter(sameLive);
    // Yordam okuması yalnız GENİŞ zamanlı ve sürüyor beyanı olmayan sese uygulanır (↑ WHEN_GOVERNS).
    const procedural = (s: Span) => !ongoing[k] && GENERIC_PRESENT.test(sentence.slice(s.start, s.end));
    const crossReport = crossSounds.filter((s) => !procedural(s));
    // 1) AYNI CÜMLE: ad ile canlı ses ≤ NEAR.
    for (const [li, lang] of LANGS.entries()) {
      const detectors = detectorsByLang[li];
      if (detectors.length === 0) continue;
      const governed = detectors.filter((d) => WHEN_GOVERNS.test(sentence.slice(Math.max(0, d.start - 24), d.start)));
      const governedSet = new Set(governed);
      const free = governed.length === 0 ? detectors : detectors.filter((d) => !governedSet.has(d));
      const sounds = spans(SOUNDING[lang], sentence).filter(sameLive);
      if (anyNear(free, sounds) || anyNear(free, crossSounds)) return true;
      if (governed.length > 0 && (anyNear(governed, sounds.filter((s) => !procedural(s))) || anyNear(governed, crossReport))) return true;
    }
    // 2) DEVAM CÜMLESİ, ses başına (Haiku 3–7. tur): devam işareti (devam sözcüğü / tek sözcük / sesle başlama / sesin önünde özne zamiri:
    //    "Last night it went off"); ses cümledeki İLK dedektör adından ÖNCE ("It keeps beeping, the smoke alarm is fine"); varsayım sesten
    //    ÖNCE gelirse sayılmaz ("…even if I open the window" bildirim); bağlama cümlesi ("that's my phone") ya da sesin cümleciğindeki
    //    kaynak ("Now my phone is beeping", "Piept mein Handy") koparır.
    const next = sentences[k + 1] ?? "";
    if (firstHypo === Infinity && next.length > 0 && hasSound[k + 1] && !ATTRIBUTION.test(next)) {
      const nextStarts = CONTINUATION_START.test(next) || next.split(" ").length <= CONTINUATION_MAX_WORDS;
      const firstDetectorNext = ANY_DETECTOR.exec(next)?.index ?? Infinity;
      const firstHypoNext = spans(HYPOTHETICAL_ALL, blankPoliteConditionals(next))[0]?.start ?? Infinity;
      const continues = (s: Span) =>
        s.start < firstDetectorNext &&
        (nextStarts ||
          s.start === 0 ||
          PRONOUN_BEFORE.test(next.slice(Math.max(0, s.start - 20), s.start)) ||
          GENERIC_DETECTOR_BEFORE.test(next.slice(Math.max(0, s.start - 32), s.start))) &&
        !soundOfOtherSource(next, s) &&
        liveSound(next, s, firstHypoNext);
      // Dil değişimi (Haiku 12. tur: "Where is the CO alarm? Il sonne."): başka dilin ses fiili yalnız özne zamiri HEMEN önündeyse —
      // "Sonne" (Almanca güneş) gibi çakışmaya açık fiiller böylece yalnız fiil konumunda sayılır.
      const pronounRightBefore = (s: Span) =>
        PRONOUN_RIGHT_BEFORE.test(next.slice(Math.max(0, s.start - 8), s.start)) ||
        GENERIC_DETECTOR_BEFORE.test(next.slice(Math.max(0, s.start - 32), s.start));
      for (const [li, lang] of LANGS.entries()) {
        const own = detectorsByLang[li].length > 0;
        if (spans(SOUNDING[lang], next).some((s) => (own || pronounRightBefore(s)) && continues(s))) return true;
      }
      if (spans(CROSS_LANGUAGE_SAFE, next).some(continues)) return true;
    }
    // 3) GERİYE ATIF (↑): önceki (ya da arada sessiz bir cümle varsa bir önceki) cümlede AÇIKLANMAMIŞ canlı ses — dedektör adı yok, bağlama
    //    yok, sesin cümleciğinde kaynak yok. Geri alma ("Is it the CO alarm? No, it's the kettle.", "It's the CO alarm, no, it's the kettle")
    //    bağlamayı bu ya da ardındaki cümlede taşır → sayılmaz.
    const p = k > 0 && hasSound[k - 1] ? k - 1 : k > 1 && hasSound[k - 2] && !ANY_DETECTOR.test(sentences[k - 1]) ? k - 2 : -1;
    if (p >= 0) {
      const prev = sentences[p];
      if (
        !ANY_DETECTOR.test(prev) &&
        !ATTRIBUTION.test(prev) &&
        !ATTRIBUTION.test(sentence) &&
        !ATTRIBUTION.test(next) &&
        // Geri alma ardındaki cümlede dedektör yeniden anılmıyorsa ("No, the kettle isn't the problem, it's the CO alarm" geri alma değil).
        !(RETRACTION_NEXT.test(next) && !ANY_DETECTOR.test(next))
      ) {
        const firstHypoPrev = spans(HYPOTHETICAL_ALL, blankPoliteConditionals(prev))[0]?.start ?? Infinity;
        if (allSounds(prev).some((s) => !soundOfOtherSource(prev, s) && liveSound(prev, s, firstHypoPrev))) return true;
      }
    }
  }
  return false;
}
