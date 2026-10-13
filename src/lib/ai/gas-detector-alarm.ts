// ─────────────────────────────────────────────────────────────────────────────
// GAZ / KARBONMONOKSİT DEDEKTÖRÜ ÖTÜYOR → OLASI GAZ ACİLİ (G4, kurucu kararı 10-13 "Olası gaz acili say"; DENETIM 08-09 #15)
//
// "Evde karbonmonoksit var" zaten acildi; ama dedektörün KENDİSİNİN ötmesi ("Der Kohlenmonoxidmelder piept", "CO alarm is beeping",
// "Gaz alarmı ötüyor") bazı dillerde / yazımlarda tehlike sayılmıyordu → yapay zekâ "Dedektör mutfak tavanında" gibi bilgi cevabı
// verebiliyordu. Misafir pil uyarısını gerçek alarmdan ayıramaz; karar ev sahibinindir. Kural (tek kaynak, iki ağ okur):
//   · Kanal: `isSafetyEmergencyText` (fallback.ts) → `safety_emergency` → yapay zekâ cevap göndermez, ev sahibine acil.
//   · QR: `hazardEvidenceOf` (hazard-evidence.ts) → açık gaz tehlikesi → model çağrılmaz, ev sahibine kritik bildirim.
// Kapsam BİLİNÇLİ dar (kurucunun sorusundaki kural): GAZ / CO dedektörü adı + öten / çalan / bip fiili, AYNI cümlede. Duman dedektörü
// bugünkü kuralında kalır (olası duman, karar modele). Dedektörün YERİNİ / varlığını sormak ("dedektör nerede?", "Is there a CO
// detector?"), olumsuz ("ötmüyor", "is not beeping") ve varsayım ("If the CO alarm goes off…") tehlike DEĞİL.
//
// YAPRAK modül (hiçbir şey import etmez). Kalıplar sabit sözcüklerden oluşur, iç içe niceleyici yok; metin cümlelere bölünür ve her
// cümle doğrusal taranır → 50.000 karakterde de sınırlı iş (süre pini testte). Uzun mesajda (K10-t) yalnız acil ağı koşar; bu kural
// orada da koşar, o yüzden metin KESİLMEZ.
// ─────────────────────────────────────────────────────────────────────────────

const B = "(?<![\\p{L}\\p{N}])"; // sözcük başı
const E = "(?![\\p{L}\\p{N}])"; // sözcük sonu

/** Gaz / CO dedektörü adı (katlanmış metinde: küçük harf, aksansız, Türkçe harfler ASCII). */
const DETECTOR = new RegExp(
  [
    // TR: karbonmonoksit / CO / (doğal)gaz + dedektör / alarm / sensör / algılayıcı (+ iyelik / hâl eki)
    `${B}(?:karbon ?monoksit|co|(?:dogal ?)?gaz) (?:kacak |kacagi )?(?:dedektor|alarm|sensor|algilayici)\\p{L}{0,6}${E}`,
    // EN
    `${B}(?:carbon[- ]monoxide|co|gas) (?:detector|alarm|sensor|monitor)s?${E}`,
    `${B}co-(?:detector|alarm|sensor)s?${E}`,
    // DE: bitişik bileşikler ("Kohlenmonoxidmelder", "CO-Melder", "CO Melder", "Gaswarnmelder", "Gasalarm")
    `${B}(?:kohlenmonoxid|co|gas)[- ]?(?:warn)?(?:melder|alarm|sensor)\\p{L}{0,3}${E}`,
    // FR
    `${B}(?:detecteur|alarme|capteur)s? (?:de |d'|a )?(?:monoxyde de carbone|co|gaz)${E}`,
    // ES
    `${B}(?:detector|detectores|alarma|alarmas|sensor|sensores) de (?:monoxido de carbono|co|gas)${E}`,
  ].join("|"),
  "gu",
);

/** Öten / çalan / bip — süren ya da az önce olan ses (olumlu biçimler; olumsuz çekim "ötmüyor / çalmıyor" bu listeye girmez). */
const SOUNDING = new RegExp(
  [
    `${B}(?:otuyor|ottu|otmeye|otup|caliyor|caldi|calmaya|bipliyor|bipledi|bipleyip|bip bip|bip sesi|ses veriyor|ses cikariyor|uyari veriyor|alarm veriyor)`,
    // EN ("is on" BİLEREK YOK: "the CO detector is on the ceiling" yer cümlesidir)
    `${B}(?:beep(?:s|ing|ed)?|chirp(?:s|ing|ed)?|going off|went off|goes off|gone off|sounding|sounded|ringing|blaring|screaming)${E}`,
    // DE
    `${B}(?:piept|piepst|piepen|piepsen|gepiept|piepton|klingelt|schlagt an|hat angeschlagen|geht los|losgegangen|heult)${E}`,
    // FR
    `${B}(?:sonne|sonnent|a sonne|bipe|bipent|retentit|se declenche|s'est declenche|declenche)${E}`,
    // ES
    `${B}(?:suena|suenan|sonando|sono|pita|pitan|pitando|pito|se activo|se ha activado)${E}`,
  ].join("|"),
  "gu",
);

/**
 * Olumsuzlama — ses fiilinin hemen ÖNÜNDE (≤ 16 karakter; araya en çok bir sözcük: "not really beeping"). Olumsuz sözcükten sonra
 * boşluk ŞART ("neden" ≠ "ne"). Fransızca "ne" BİLEREK YOK: Türkçede "ne" sorudur ("ne ötüyor böyle?") — Fransızca olumsuzluk
 * ardındaki "pas / plus" ile tanınır (↓). Türkçe olumsuzluk çekimdedir ("ötmüyor") ve olumlu fiil listesine zaten girmez.
 */
const NEG_BEFORE = /(?:^|\s)(?:not|isn't|isnt|aren't|arent|wasn't|wasnt|doesn't|doesnt|didn't|didnt|never|no longer|stopped|no|ya no)\s(?:\p{L}{1,10}\s)?$/u;
/** Olumsuzlama — ses fiilinin hemen ARDINDA (≤ 12 karakter): "piept nicht", "(ne) sonne pas / plus", "no suena nunca". */
const NEG_AFTER = /^\s(?:nicht|nie|pas|plus|mehr nicht|nunca)(?![\p{L}\p{N}])/u;
/** Türkçe koşul eki fiile bitişik ("çalıyorsa", "öttüyse") → bildirim değil koşul (fallback.ts `CONDITIONAL_TAIL` emsali). */
const TR_CONDITIONAL_TAIL = /^[ry]?s[ae]/u;
/** Varsayım / yordam sorusu — cümlede: "If the CO alarm goes off…", "Wenn der CO-Melder piept…", "En caso de que suene…". */
const HYPOTHETICAL =
  /(?:^|\s)(?:if|in case|what if|should the|whenever|what (?:do|should) (?:i|we) do when|falls|wenn|sollte|eger|durumunda|halinde|au cas ou|en cas de|que faire si|en caso de|que hago si|que hacer si)(?![\p{L}\p{N}])/u;

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

/** Misafir metni bir gaz / CO dedektörünün ŞU AN (ya da az önce) öttüğünü bildiriyor mu? */
export function gasDetectorSounding(message: string | null | undefined): boolean {
  if (typeof message !== "string" || message.length === 0) return false;
  for (const sentence of fold(message).split(/[.!?;؟\n]+/u)) {
    if (sentence.length < 6 || HYPOTHETICAL.test(sentence)) continue;
    const detectors = [...sentence.matchAll(DETECTOR)];
    if (detectors.length === 0) continue;
    for (const s of sentence.matchAll(SOUNDING)) {
      const at = s.index ?? 0;
      const end = at + s[0].length;
      if (NEG_BEFORE.test(sentence.slice(Math.max(0, at - 16), at)) || NEG_AFTER.test(sentence.slice(end, end + 12))) continue;
      if (TR_CONDITIONAL_TAIL.test(sentence.slice(end, end + 3))) continue;
      for (const d of detectors) {
        const dStart = d.index ?? 0;
        const dEnd = dStart + d[0].length;
        const gap = at >= dEnd ? at - dEnd : dStart >= end ? dStart - end : 0;
        if (gap <= NEAR) return true;
      }
    }
  }
  return false;
}
