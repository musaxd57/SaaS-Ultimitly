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
    `${B}(?:(?:otuyor|ottu|caliyor|caldi|bipliyor|bipledi|susmuyor)(?:lar|m|n|k|mus|mu|mi|du|dum|dun|duk|dular)?|(?:otmeye|calmaya|biplemeye) basla\\p{L}{0,6}|bip bip|bip sesi (?:veriyor|cikariyor|geliyor)|ses (?:veriyor|cikariyor)|uyari veriyor|alarm veriyor|otup duruyor|calip duruyor)${E}`,
    "gu",
  ),
  // "is on" BİLEREK YOK: "the CO detector is on the ceiling" yer cümlesidir.
  en: new RegExp(`${B}(?:beep(?:s|ing|ed)?|chirp(?:s|ing|ed)?|buzz(?:es|ing|ed)?|going off|went off|goes off|gone off|sounding|sounded|ringing|blaring|screaming)${E}`, "gu"),
  de: new RegExp(`${B}(?:piept|piepst|piepen|piepsen|gepiept|piepton|klingelt|schlagt an|schlagt alarm|alarm schlagt|hat angeschlagen|geht los|losgegangen|heult|ertont)${E}`, "gu"),
  fr: new RegExp(`${B}(?:sonne|sonnent|sonner|a sonne|bipe|bipent|retentit|se declenche|s'est declenche|declenche)${E}`, "gu"),
  es: new RegExp(`${B}(?:suena|suenan|sonando|sonar|sono|pita|pitan|pitando|pito|se activo|se ha activado)${E}`, "gu"),
};
const LANGS = Object.keys(GAS_DETECTOR) as Lang[];
const ALL_DETECTORS: readonly RegExp[] = [...Object.values(GAS_DETECTOR), ...Object.values(SMOKE_DETECTOR)];
/**
 * DİL KARIŞIMI (Haiku incelemesi 10-13): misafir dili karıştırır ("CO alarmı sürekli beep yapıyor"). Ad bir dilde, fiil başka dilde ise
 * YALNIZ başka bir dilde sıradan sözcük OLMAYAN fiiller eşleşir: Fransızca "sonne / sonner" (Almanca "Sonne" = güneş), İspanyolca
 * "sono" (İtalyanca "sono" = -im), "pita / pito / pitan" (pide, düdük) yalnız kendi dilinin adıyla. İngilizce "ringing" de yalnız
 * İngilizce adla (3. inceleme: "CO dedektörü nerede, telefon ringing" — çalan telefondur).
 */
const CROSS_LANGUAGE_SAFE = new RegExp(
  `${B}(?:beep(?:s|ing|ed)?|chirp(?:s|ing|ed)?|buzz(?:es|ing|ed)?|going off|went off|goes off|gone off|sounding|sounded|blaring|screaming|piept|piepst|piepen|piepsen|gepiept|piepton|bipe|bipent|retentit|suena|suenan|sonando|(?:otuyor|ottu|caliyor|caldi|bipliyor|bipledi|susmuyor)(?:lar|m|n|k|mus|mu|mi|du|dum|dun|duk|dular)?|bip bip)${E}`,
  "gu",
);

/**
 * Olumsuzlama — ses fiilinin hemen ÖNÜNDE (≤ 28 karakter; araya en çok iki sözcük: "not making any beeps", "hat nicht gepiept").
 * Olumsuz sözcükten sonra boşluk ŞART ("neden" ≠ "ne"). Fransızca "ne" BİLEREK YOK: Türkçede "ne" sorudur ("ne ötüyor böyle?") —
 * Fransızca olumsuzluk ardındaki "pas / plus" ile tanınır (↓). Türkçe olumsuzluk çekimdedir ve olumlu fiil listesine girmez.
 */
const PLAIN_NEG =
  /(?:^|\s)(?:not|isn't|isnt|aren't|arent|wasn't|wasnt|doesn't|doesnt|didn't|didnt|hasn't|hasnt|haven't|havent|won't|wont|never|no longer|no|ya no|nicht|kein|keine|nie)\s((?:\p{L}{1,12}\s){0,2})$/u;
/**
 * DURDU (ses bitti): "stopped beeping", "dejó de sonar", "a cessé de sonner", "hat aufgehört zu piepen". Önünde DÜZ olumsuz varsa çift
 * olumsuzdur → ses SÜRÜYOR ("has not stopped", "no ha dejado de", "hat nicht wirklich aufgehört zu" — Haiku son kontrolü 10-13).
 */
const STOPPED_NEG = /(?:^|\s)(?:stopped|dejo de|ha dejado de|a cesse de|a arrete de|aufgehort zu)\s(?:\p{L}{1,12}\s){0,1}$/u;
const PLAIN_NEG_TAIL = /(?:^|\s)(?:not|hasn't|hasnt|haven't|havent|never|no|nunca|nicht|nie|ne|jamais)\s(?:\p{L}{1,12}\s){0,2}$/u;
/** Olumsuzlama — ses fiilinin hemen ARDINDA (≤ 14 karakter): "piept nicht", "(ne) sonne pas / plus", "no suena nunca". */
const NEG_AFTER = /^\s(?:nicht|nie|pas|plus|mehr nicht|nunca)(?![\p{L}\p{N}])/u;
/** Varsayım / yordam sorusu — yalnız SESTEN ÖNCE gelirse: "If the CO alarm goes off…" evet; "…is beeping, I don't know if…" hayır. */
const HYPOTHETICAL_SRC =
  "(?:^|\\s)(?:if|in case|what if|should the|what (?:do|should) (?:i|we) do when|falls|wenn|sollte|eger|durumunda|halinde|au cas ou|en cas de|que faire si|en caso de|que hago si|que hacer si)(?![\\p{L}\\p{N}])";
const HYPOTHETICAL_ALL = new RegExp(HYPOTHETICAL_SRC, "gu");
/** Devam cümlesi: bir önceki cümledeki dedektörü sürdüren kısa cümle ("It keeps beeping!", "Sürekli ötüyor!", "Es piept."). */
const CONTINUATION_START =
  /^(?:it|it's|its|still|keeps|now|again|constantly|er|es|sie|immer|standig|il|elle|ca|encore|toujours|sigue|esta|ahora|todavia|surekli|hala|simdi|durmadan|yine|hep)(?![\p{L}\p{N}])/u;
/**
 * Zamir / zarfsız devam cümlesi yalnız TEK sözcük ("Ötüyor!") ya da doğrudan SES fiiliyle başlayan cümle ("Suena sin parar!") —
 * "Telefon çalıyor." başka bir öznedir (3. inceleme; zarf listesi son kontrol: "Şimdi ötüyor!").
 */
const CONTINUATION_MAX_WORDS = 1;
/**
 * Devam cümlesi BAŞKA bir ses kaynağından söz ediyorsa dedektöre bağlanmaz (Haiku son kontrolü: "Where is the CO detector? Now my phone
 * is beeping", "Wo ist der CO-Melder? Piept mein Handy"). YALNIZ devam cümlesinde: aynı cümlede "CO alarmı ve telefonum ötüyor" gerçek
 * bildirimdir, kaçırılmaz.
 */
const PRONOUN_START = /^(?:it|it's|its|er|es|sie|il|elle|ca|o)(?![\p{L}\p{N}])/u;
const OTHER_SOUND_SOURCE =
  /(?<![\p{L}\p{N}])(?:phone|telephone|mobile|cell|doorbell|clock|oven|microwave|washer|dishwasher|fridge|timer|telefon\p{L}{0,6}|zil\p{L}{0,4}|saat\p{L}{0,4}|firin\p{L}{0,4}|mikrodalga\p{L}{0,4}|makine\p{L}{0,4}|buzdolab\p{L}{0,4}|handy|wecker|klingel|telefono|movil|portable|reveil|horno|minuteur)(?![\p{L}\p{N}])/u;

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

function liveSound(sentence: string, s: Span, firstHypo: number): boolean {
  const before = sentence.slice(Math.max(0, s.start - 40), s.start);
  const stopped = STOPPED_NEG.exec(before);
  if (stopped) {
    // "Durdu" — önünde düz olumsuz yoksa ses bitti; varsa çift olumsuz (ses sürüyor).
    if (!PLAIN_NEG_TAIL.test(before.slice(0, stopped.index + 1))) return false;
  } else {
    const neg = PLAIN_NEG.exec(before);
    if (neg && !STOP_VERB.test(` ${neg[1]}`) && !DE_STOP_SEPARABLE.test(before)) return false;
  }
  if (NEG_AFTER.test(sentence.slice(s.end, s.end + 14))) return false;
  if (futureBefore(sentence, s)) return false;
  return !(firstHypo < s.start);
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
  for (let k = 0; k < sentences.length; k++) {
    const sentence = sentences[k];
    if (sentence.length < 6) continue;
    // İlk varsayım sözcüğünün yeri yeter (ses ondan sonraysa varsayımdır) — ses başına tarama yok (maliyet O(S + H)).
    const firstHypo = spans(HYPOTHETICAL_ALL, sentence)[0]?.start ?? Infinity;
    const next = sentences[k + 1] ?? "";
    const nextIsContinuation =
      next.length > 0 &&
      (CONTINUATION_START.test(next) ||
        next.split(" ").length <= CONTINUATION_MAX_WORDS ||
        [...LANGS.map((l) => SOUNDING[l]), CROSS_LANGUAGE_SAFE].some((re) => spans(re, next)[0]?.start === 0)) &&
      // Kendi dedektör adını taşıyan cümle kendi turunda okunur ("The CO alarm is in the kitchen. The smoke alarm is still beeping." gaz
      // DEĞİL, duman — Haiku 3. tur).
      !ALL_DETECTORS.some((re) => spans(re, next).length > 0);
    // Devam cümlesinde varsayım da SESTEN ÖNCE gelirse sayılır ("It keeps beeping even if I open the window" bildirimdir — Haiku 3. tur).
    const firstHypoNext = nextIsContinuation ? (spans(HYPOTHETICAL_ALL, next)[0]?.start ?? Infinity) : Infinity;
    // Başka ses kaynağı devam cümlesini dedektörden koparır ("Now my phone is beeping", "Piept mein Handy"); zamirle başlayan cümlede ses
    // kaynaktan ÖNCE geliyorsa dedektördür ("It keeps beeping and the phone is ringing too").
    const otherAt = nextIsContinuation ? (OTHER_SOUND_SOURCE.exec(next)?.index ?? Infinity) : Infinity;
    const pronounNext = PRONOUN_START.test(next);
    const live = (s: Span) => liveSound(sentence, s, firstHypo);
    const liveNext = (s: Span) => (otherAt === Infinity || (pronounNext && s.end <= otherAt)) && liveSound(next, s, firstHypoNext);
    const crossSounds = spans(CROSS_LANGUAGE_SAFE, sentence).filter(live);
    const crossNext = firstHypo === Infinity && nextIsContinuation && spans(CROSS_LANGUAGE_SAFE, next).some(liveNext);
    // Yordam okuması yalnız GENİŞ zamanlı ve sürüyor beyanı olmayan sese uygulanır (↑ WHEN_GOVERNS).
    const procedural = (s: Span) => !ongoing[k] && GENERIC_PRESENT.test(sentence.slice(s.start, s.end));
    const crossReport = crossSounds.filter((s) => !procedural(s));
    for (const lang of LANGS) {
      const detectors = spans(DETECTOR[lang], sentence);
      if (detectors.length === 0) continue;
      const governed = detectors.filter((d) => WHEN_GOVERNS.test(sentence.slice(Math.max(0, d.start - 24), d.start)));
      const governedSet = new Set(governed);
      const free = governed.length === 0 ? detectors : detectors.filter((d) => !governedSet.has(d));
      const sounds = spans(SOUNDING[lang], sentence).filter(live);
      if (anyNear(free, sounds) || anyNear(free, crossSounds)) return true;
      if (governed.length > 0 && (anyNear(governed, sounds.filter((s) => !procedural(s))) || anyNear(governed, crossReport))) return true;
      // Hemen ardındaki kısa devam cümlesi ("…in the kitchen. It keeps beeping!") — ses orada, dedektör burada, varsayım yok.
      if (firstHypo === Infinity && nextIsContinuation && spans(SOUNDING[lang], next).some(liveNext)) return true;
      if (crossNext) return true;
    }
  }
  return false;
}
