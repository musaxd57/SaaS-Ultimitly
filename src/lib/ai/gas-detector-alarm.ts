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
const DETECTOR: Record<Lang, RegExp> = {
  // karbonmonoksit / CO / (doğal)gaz + dedektör / alarm / sensör / algılayıcı (+ iyelik / hâl eki); "CO-dedektörü" tireli de.
  tr: new RegExp(`${B}(?:karbon ?monoksit|co|(?:dogal ?)?gaz)[- ](?:kacak |kacagi )?(?:dedektor|detektor|alarm|sensor|algilayici)\\p{L}{0,6}${E}`, "gu"),
  en: new RegExp(`${B}(?:carbon[- ]monoxide|co|gas)[- ](?:detector|alarm|sensor|monitor)s?${E}`, "gu"),
  // Bitişik bileşikler ("Kohlenmonoxidmelder", "CO-Melder", "CO Melder", "Gaswarnmelder", "Gasalarm").
  de: new RegExp(`${B}(?:kohlenmonoxid|co|gas)[- ]?(?:warn)?(?:melder|alarm|sensor)\\p{L}{0,3}${E}`, "gu"),
  fr: new RegExp(`${B}(?:detecteur|alarme|capteur)s? (?:de |d'|a )?(?:monoxyde de carbone|co|gaz)${E}`, "gu"),
  es: new RegExp(`${B}(?:detector|detectores|alarma|alarmas|sensor|sensores) de (?:monoxido de carbono|co|gas)${E}`, "gu"),
};

/**
 * Öten / çalan / bip — süren ya da az önce olan ses; dil başına OLUMLU biçimler. Türkçe fiil yalnız kişi / soru / rivayet ekiyle
 * biter ("ötüyor", "ötüyormuş", "çalıyor mu"): "öttüğünü duymadım" (ad-fiil) ve "ötmüyor" (olumsuz çekim) eşleşmez. "Susmuyor"
 * (susmuyor = ses sürüyor) olumlu bildirimdir.
 */
const SOUNDING: Record<Lang, RegExp> = {
  tr: new RegExp(
    `${B}(?:(?:otuyor|ottu|caliyor|caldi|bipliyor|bipledi|susmuyor)(?:lar|m|n|k|mus|mu|mi|du|dum|dun|duk|dular)?|(?:otmeye|calmaya|biplemeye) basla\\p{L}{0,6}|bip bip|bip sesi (?:veriyor|cikariyor|geliyor)|ses (?:veriyor|cikariyor)|uyari veriyor|alarm veriyor|otup duruyor|calip duruyor)${E}`,
    "gu",
  ),
  // "is on" BİLEREK YOK: "the CO detector is on the ceiling" yer cümlesidir.
  en: new RegExp(`${B}(?:beep(?:s|ing|ed)?|chirp(?:s|ing|ed)?|buzz(?:es|ing|ed)?|going off|went off|goes off|gone off|sounding|sounded|ringing|blaring|screaming)${E}`, "gu"),
  de: new RegExp(`${B}(?:piept|piepst|piepen|piepsen|gepiept|piepton|klingelt|schlagt an|hat angeschlagen|geht los|losgegangen|heult|ertont)${E}`, "gu"),
  fr: new RegExp(`${B}(?:sonne|sonnent|sonner|a sonne|bipe|bipent|retentit|se declenche|s'est declenche|declenche)${E}`, "gu"),
  es: new RegExp(`${B}(?:suena|suenan|sonando|sonar|sono|pita|pitan|pitando|pito|se activo|se ha activado)${E}`, "gu"),
};
const LANGS = Object.keys(DETECTOR) as Lang[];
/**
 * DİL KARIŞIMI (Haiku incelemesi 10-13): misafir dili karıştırır ("CO alarmı sürekli beep yapıyor"). Ad bir dilde, fiil başka dilde ise
 * YALNIZ başka bir dilde sıradan sözcük OLMAYAN fiiller eşleşir: Fransızca "sonne / sonner" (Almanca "Sonne" = güneş), İspanyolca
 * "sono" (İtalyanca "sono" = -im), "pita / pito / pitan" (pide, düdük) yalnız kendi dilinin adıyla.
 */
const CROSS_LANGUAGE_SAFE = new RegExp(
  `${B}(?:beep(?:s|ing|ed)?|chirp(?:s|ing|ed)?|buzz(?:es|ing|ed)?|going off|went off|goes off|gone off|sounding|sounded|ringing|blaring|screaming|piept|piepst|piepen|piepsen|gepiept|piepton|bipe|bipent|retentit|suena|suenan|sonando|(?:otuyor|ottu|caliyor|caldi|bipliyor|bipledi|susmuyor)(?:lar|m|n|k|mus|mu|mi|du|dum|dun|duk|dular)?|bip bip)${E}`,
  "gu",
);

/**
 * Olumsuzlama — ses fiilinin hemen ÖNÜNDE (≤ 28 karakter; araya en çok iki sözcük: "not making any beeps", "hat nicht gepiept").
 * Olumsuz sözcükten sonra boşluk ŞART ("neden" ≠ "ne"). Fransızca "ne" BİLEREK YOK: Türkçede "ne" sorudur ("ne ötüyor böyle?") —
 * Fransızca olumsuzluk ardındaki "pas / plus" ile tanınır (↓). Türkçe olumsuzluk çekimdedir ve olumlu fiil listesine girmez.
 */
const NEG_BEFORE =
  /(?:^|\s)(?:not|isn't|isnt|aren't|arent|wasn't|wasnt|doesn't|doesnt|didn't|didnt|never|no longer|stopped|no|ya no|nicht|kein|keine|nie)\s(?:\p{L}{1,12}\s){0,2}$/u;
/** Olumsuzlama — ses fiilinin hemen ARDINDA (≤ 14 karakter): "piept nicht", "(ne) sonne pas / plus", "no suena nunca". */
const NEG_AFTER = /^\s(?:nicht|nie|pas|plus|mehr nicht|nunca)(?![\p{L}\p{N}])/u;
/** Türkçe koşul eki fiile bitişik ("çalıyorsa", "öttüyse") → bildirim değil koşul (fallback.ts `CONDITIONAL_TAIL` emsali). */
const TR_CONDITIONAL_TAIL = /^[ry]?s[ae]/u;
/** Varsayım / yordam sorusu — yalnız SESTEN ÖNCE gelirse: "If the CO alarm goes off…" evet; "…is beeping, I don't know if…" hayır. */
const HYPOTHETICAL_SRC =
  "(?:^|\\s)(?:if|in case|what if|should the|whenever|what (?:do|should) (?:i|we) do when|falls|wenn|sollte|eger|durumunda|halinde|au cas ou|en cas de|que faire si|en caso de|que hago si|que hacer si)(?![\\p{L}\\p{N}])";
const HYPOTHETICAL_ALL = new RegExp(HYPOTHETICAL_SRC, "gu");
/** Devam cümlesi: bir önceki cümledeki dedektörü sürdüren kısa cümle ("It keeps beeping!", "Sürekli ötüyor!", "Es piept."). */
const CONTINUATION_START = /^(?:it|it's|its|still|keeps|er|es|sie|il|elle|ca|sigue|esta|surekli|hala|durmadan|yine|hep)(?![\p{L}\p{N}])/u;
const CONTINUATION_MAX_WORDS = 3;

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
/** "Doesn't stop beeping" / "hört nicht auf zu piepen" — olumsuz + DUR fiili = ses SÜRÜYOR (çift olumsuz; Haiku incelemesi 10-13). */
const STOP_VERB = /(?:^|\s)(?:stop|stops|stopping|quit|hort|hoert|aufhoren|arrete|arreter|para|parar|deja|dejar)(?:\s|$)/u;

function liveSound(sentence: string, s: Span, hypoStarts: readonly number[]): boolean {
  const before = sentence.slice(Math.max(0, s.start - 28), s.start);
  if (NEG_BEFORE.test(before) && !STOP_VERB.test(before)) return false;
  if (NEG_AFTER.test(sentence.slice(s.end, s.end + 14))) return false;
  if (TR_CONDITIONAL_TAIL.test(sentence.slice(s.end, s.end + 3))) return false;
  return !hypoStarts.some((h) => h < s.start);
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
  if (typeof message !== "string" || message.length === 0) return false;
  const sentences = fold(message).split(/[.!?;؟\n]+/u).map((s) => s.trim());
  for (let k = 0; k < sentences.length; k++) {
    const sentence = sentences[k];
    if (sentence.length < 6) continue;
    const hypo = spans(HYPOTHETICAL_ALL, sentence).map((h) => h.start);
    const next = sentences[k + 1] ?? "";
    const nextIsContinuation =
      next.length > 0 &&
      (CONTINUATION_START.test(next) || next.split(" ").length <= CONTINUATION_MAX_WORDS) &&
      spans(HYPOTHETICAL_ALL, next).length === 0;
    const crossSounds = spans(CROSS_LANGUAGE_SAFE, sentence).filter((s) => liveSound(sentence, s, hypo));
    const crossNext = hypo.length === 0 && nextIsContinuation && spans(CROSS_LANGUAGE_SAFE, next).some((s) => liveSound(next, s, []));
    for (const lang of LANGS) {
      const detectors = spans(DETECTOR[lang], sentence);
      if (detectors.length === 0) continue;
      const sounds = spans(SOUNDING[lang], sentence).filter((s) => liveSound(sentence, s, hypo));
      if (anyNear(detectors, sounds) || anyNear(detectors, crossSounds)) return true;
      // Hemen ardındaki kısa devam cümlesi ("…in the kitchen. It keeps beeping!") — ses orada, dedektör burada, varsayım yok.
      if (hypo.length === 0 && nextIsContinuation && spans(SOUNDING[lang], next).some((s) => liveSound(next, s, []))) return true;
      if (crossNext) return true;
    }
  }
  return false;
}
