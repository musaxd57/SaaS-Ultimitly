// Deterministic evidence check for statedCheckoutTime (Codex #29 + follow-up).
// The model's claim "the guest stated they'll check out at HH:MM" is persisted
// onto the RESERVATION (guestCheckoutTime) and feeds turnover planning — so a
// regex-valid but HALLUCINATED time must never be written. Two requirements,
// both evaluated per sentence-segment of the guest's own message:
//   1. the segment plausibly CONTAINS that time, and
//   2. the same segment carries a CHECKOUT cue (çık/ayrıl/leave/depart/
//      check-out/…) — "Check-in 18:00 mi?" or "Dinner at 18:00" name a time
//      but say nothing about checking out and must be rejected.
// It is a hallucination stopper, not a full NLU parser: conservative on bare
// numbers ("2 valizimiz var" can never anchor a claim), tolerant on real
// checkout statements ("18:00'de çıkacağız", "we'll leave around 6pm").

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

// ç[ıi]k / ayr[ıi]l: JS toLowerCase maps ASCII "I" to "i" (not "ı"), so an
// all-caps "ÇIKACAĞIZ" lowercases to "çikacağiz" — match both vowels.
// "check[\s-]?out" never matches "check-in" (the "out" is required).
// (?<!a) excludes "açık" (open/clear) — a very common word that embeds "çık" and
// would otherwise falsely mark any nearby time as a stated checkout time.
// ⚠️ YANLIŞ DOSTLAR VETOLU (saldırgan denetimi, 08-01). İpucu düz altdizi
// taramasıydı ve alakasız kelimeleri "çıkış" sayıyordu — ölçüldü:
//   "Çikolata bıraktık size, saat 15:00'te dönüyoruz" → 15:00 KABUL  (çik)
//   "Vacation starts at 13:00"                        → 13:00 KABUL  (vacat)
//   ayrıca: çiklet · çıkartma · çıkrık · çıkıntı · departman · cleaver
// `(?<!a)` yalnız "açık" örneğini yamalamıştı. Vetolar KISITLAYICI: ipucu
// düşürmek fonksiyonu daha az kabul eder hâle getirir (güvenli yön).
// İkinci inceleme 09-25: "checking out at 11" / "we checked out at 10" / "we'll be out by 10" / "we head out at 10" /
// "Yarın 10'da gidiyoruz" de ipucudur (nereye gidildiği — havalimanı, yemek — cevap modelinin işi; bu yüklem uydurma durdurucu).
// Kör batarya (09-25): "be out" YALNIZ we/I öznesiyle ("The power will be out until 2pm" çıkış değil); "çıkmaz sokak" bir yerdir.
const CHECKOUT_CUE =
  /(?<!a)ç[ıi]k(?!olata|let|artma|rık|rik|ıntı|inti|maz\s+soka[kğ])|ayr[ıi]l(?!ık|ik\b)|terk(?!os)|boşalt|bosalt|check(?:ing|ed)?[\s-]?out|(?:\b(?:we|i)(?:'ll|\s+will|'re|'m|\s+are|\s+am)?\s+be\s+|head(?:ing)?\s+)out(?![a-z])|(?<![a-zçğıöşü])gid(?:iyor|eriz|erim|ece)|(?<!c)leav|depart(?!man|ment)|vacat(?!ion)|auscheck/;

/**
 * ULAÇ (gerund) İPUCU DEĞİLDİR (denetim, 08-01 — ikinci tur).
 *
 * "çıkmadan önce", "ayrılmadan önce" bir ZAMAN BELİRTECİDİR, çıkış saati beyanı
 * değil. `CHECKOUT_CUE` bunları `ç[ıi]k`/`ayr[ıi]l` ile ipucu sayıyordu; ilk
 * turda olumsuzlama vetosuna `(?!an)` çapası koyunca veto da devreden çıktı ve
 * ortada YENİ bir halüsinasyon sınıfı kaldı — ampirik ölçüldü:
 *   "Çıkmadan önce 09:00'da kahvaltı yapabilir miyiz" → 09:00 KABUL
 *   "Ayrılmadan önce 08:00'de market açık olur mu"    → 08:00 KABUL
 * Yani misafirin kahvaltı/kargo/taksi saati rezervasyona çıkış saati diye
 * yazılıyordu.
 *
 * Çözüm: ulacı ipucu testinden ÖNCE metinden SİL. Böylece ne ipucu sayılır ne
 * de olumsuzluk sayılır — nötrleşir. Cümlecikte BAŞKA bir gerçek ipucu varsa
 * ("…? Saat 11:00'de çıkıyoruz") o hâlâ çalışır (testli).
 */
// `-madan` DIŞINDAKİ ulaç/zarf biçimleri de nötrlenir: "çıkarken 09:00'da market
// açık olur mu" ölçüldü ve 09:00 KABUL ediliyordu (saldırgan denetimi, 08-01).
const CHECKOUT_GERUND =
  /(ç[ıi]kma|ayr[ıi]lma|boşaltma|bosaltma)dan\b|(ç[ıi]k|ayr[ıi]l)(arken|ırken|irken|acakken|ecekken)/g;

/**
 * AYRILMA FİİLİNİN OLUMSUZU — MESAJ SEVİYESİNDE VETO (denetim, 08-01 — ikinci tur).
 *
 * Olumsuzlamayı cümlecik seviyesine indirmek "11:00'de çıkacağız, temizlik
 * yapmayın" vakasını kurtardı ama GERİ ÇEKİLMEYİ (retraction) kaybetti — ölçüldü:
 *   "Çıkışımız 11:00, ama planı değiştirdik çıkmayacağız" → 11:00 KABUL
 *   "Saat 11:00'de çıkıyoruz. Aslında çıkmayacağız."      → 11:00 KABUL
 * Misafir aynı mesajda beyanını GERİ ALIYOR ve biz ilk cümleciği kanıt sayıyoruz.
 *
 * Ayrım net: misafir "AYRILMIYORUM" diyorsa mesajın TAMAMI kanıt olmaktan çıkar
 * (nerede söylediği fark etmez). "Şunu yapmayın" gibi genel kalıplar ise yalnız
 * kendi cümleciğini bağlar — başka bir cümledeki gerçek beyanı düşürmemeli.
 */
const DEPARTURE_REFUSAL = new RegExp(
  [
    // ⚠️ İLERİ-OLUMSUZ BAKIŞLAR ŞART. "çıkmad" tek başına "çıkma-DAN"ı,
    // "çıkmam" ise "çıkma-MIZ"ı yakalar; ikisi de FİİL-İSİM biçimidir ve
    // TAMAMEN MEŞRU çıkış cümleleridir ("çıkmadan önce anahtarı nereye
    // bırakalım", "çıkmamız gereken saat 11:00 mi"). İlk yazımda çapa yoktu ve
    // bir denetim ajanı ölçerek yakaladı (denetim, 08-01).
    // çıkmıyoruz / çıkmayacağız / çıkmadık / çıkmam / çıkmaz
    "ç[ıi]km[ıi]yor",
    "ç[ıi]kmayaca",
    "ç[ıi]kmad(?!an)",
    "ç[ıi]kmam(?![ıia])",
    // "çıkmaz sokak" bir YER adıdır (ikinci inceleme 09-25: "Ev çıkmaz sokakta mı? 11'de çıkarız" reddediliyordu).
    "ç[ıi]kmaz(?!\\s+soka[kğ])",
    // ayrılmıyoruz / ayrılmayacağız / ayrılmadık / ayrılmam / ayrılmaz
    "ayr[ıi]lm[ıi]yor",
    "ayr[ıi]lmayaca",
    "ayr[ıi]lmad(?!an)",
    "ayr[ıi]lmam(?![ıia])",
    "ayr[ıi]lmaz",
    // İngilizce / diğer diller
    "won'?t leav",
    "will not leav",
    "not leaving",
    "won'?t check\\s?-?out",
    "won'?t be (?:leaving|checking)",
    "not checking\\s?-?out",
    "do(n'?t| not) check\\s?-?out",
    "ne partons pas",
    "nicht aus",
  ].join("|"),
);

/**
 * CÜMLECİK seviyesinde bağlayan genel olumsuz kalıplar. "11:00'de çıkacağız,
 * lütfen sabah temizlik yapmayın" mesajında olumsuz olan İKİNCİ cümleciktir —
 * mesaj geneline uygulanırsa meşru beyan düşerdi (07-31 pini).
 */
const CLAUSE_NEGATION = /yapmay[ıi]n/;

/**
 * CÜMLECİK AYIRICISI (↓ iki fonksiyon aynı kuralı kullanır): virgül / noktalı virgül, bağlaçlar, boşluklu tire ve rakamlar
 * ARASINDA olmayan iki nokta ("18:00" saatin kendisidir). İkinci inceleme 09-25: "so / since / için" da ("Uçağımız 15:30'da
 * olduğu için 12 gibi çıkarız", "The cleaner can come at 11 since we leave at 10"); "öğleden sonra" bölünmez.
 */
const CLAUSE_SEPARATOR =
  /[,;]+|\s+(?:ve|and|ama|but|fakat|(?<!(?:öğleden|ogleden)\s+)sonra|then|ayrıca|çünkü|için|because|so|since|while|yani)\s+|\s+[-–—]\s+|(?<!\d):(?!\d)/g;

/**
 * iPhone'un kıvrık kesme işareti ("11’de") düz olana çevrilir — ikinci inceleme 09-25: ipucu ve ek okunmuyordu. Satır içi
 * boşluk dizileri TEK boşluğa indirilir: cümlecik ayırıcısı (`\s+ve\s+` …) uzun boşluk dizisinde karesel iş yapıyordu (kör
 * batarya 09-25: 20.000 boşlukta ~0,9 sn senkron CPU). Satır sonu cümle sınırıdır, korunur.
 */
function normalizeMessage(message: string): string {
  return message.replace(/[\u2018\u2019\u02BC\u2032]/g, "'").replace(/[^\S\n]+/g, " ").toLowerCase();
}

/**
 * Bu uzunluğun üstündeki mesajda saat kanıtı ARANMAZ (false = kayıt yok, güvenli yön): düzenli ifadelerin en kötü durum
 * maliyeti sınırlı kalır. Gerçek bir çıkış saati beyanı bu uzunluğa yaklaşmaz.
 */
const MAX_STATED_TIME_MESSAGE_CHARS = 4000;

/** True when `message` plausibly states HH:MM AS A CHECKOUT TIME. */
export function timeStatedInMessage(hhmm: string, message: string): boolean {
  const parsed = HHMM.exec(hhmm.trim());
  if (!parsed || message.length > MAX_STATED_TIME_MESSAGE_CHARS) return false;
  const h = Number(parsed[1]);
  const min = Number(parsed[2]);

  // İKİ SEVİYELİ BÖLME (denetim, 08-01).
  //
  // CÜMLE sınırı (`. ! ? \n`) AŞILAMAZ — fonksiyonun varlık sebebi olan
  // halüsinasyon sınıfı tam olarak budur: "Dinner at 18:00. We leave tomorrow."
  // farklı bir cümleden ipucu ödünç alamaz. (Rakamlar arasındaki nokta bir saat
  // ayırıcısıdır — "18.30" — cümle sonu değil.)
  //
  // CÜMLECİK sınırı (`, ;`) İÇERİDE. Türkçede cümlecikler ağırlıkla virgülle
  // bağlanır; ayırıcıya eklenmeseydi "aynı cümlecikte olmalı" garantisi fiilen
  // yoktu ("Uçağımız 19:30'da, sabah 8 gibi çıkarız" → 19:30 kabul ediliyordu).
  // İpucunun HEMEN ARDINDAKİ cümleciğe bakılır ("yarın çıkıyoruz, saat 10:00
  // gibi"), ama YALNIZ AYNI CÜMLE İÇİNDE ve YALNIZ İLERİ: geriye bakmak
  // düzeltilen tehdidin ta kendisini geri açardı.
  //
  // ⚠️ İLK YAZIMDA İLERİ-BAKIŞ TÜM AYIRICILAR İÇİN KOŞUYORDU ve cümle sınırını
  // da aşıyordu — yani düzeltmenin kendisi halüsinasyon sınıfını ters yönden
  // geri açmıştı. Bir denetim ajanı ölçerek yakaladı.
  //
  // ⚠️ ASCII TİRE AYIRICI DEĞİLDİR: "check-out" ipucunu böler ve TÜM İngilizce
  // beyanları sessizce öldürür (ölçüldü, testle pinli).
  const lower = normalizeMessage(message);

  // MESAJ SEVİYESİ VETO: misafir ayrılmayı REDDEDİYORSA mesajın tamamı kanıt
  // olmaktan çıkar — geri çekilme ("çıkışımız 11:00, ama çıkmayacağız") nerede
  // geçerse geçsin beyanı iptal eder (↑DEPARTURE_REFUSAL).
  if (DEPARTURE_REFUSAL.test(lower)) return false;

  // Ulaçları NÖTRLE: ne ipucu ne olumsuzluk sayılsınlar (↑CHECKOUT_GERUND).
  const neutral = lower.replace(CHECKOUT_GERUND, " ");

  for (const sentence of neutral.split(/(?:[!?\n]|(?<!\d)\.|\.(?!\d))+/)) {
    // ⚠️ BAĞLAÇLAR DA CÜMLECİK AYIRICISIDIR (saldırgan denetimi, 08-01). Ayırıcı
    // yalnız `,;` iken tek bir "ve"/"and"/tire garantiyi deliyordu — ölçüldü:
    //   "Akşam yemeği saat 18:00. Yarın çıkıyoruz"  → 18:00 RED  ✅
    //   "Akşam yemeği saat 18:00 ve yarın çıkıyoruz" → 18:00 KABUL ❌
    // Aynı iki cümle, YALNIZ bağlaç değişti. İleri bakış zaten cümle içinde
    // kaldığı için meşru "yarın çıkıyoruz ve saat 10:00 gibi" bozulmaz.
    // ⚠️ İKİ NOKTA rakamlar ARASINDA bölünemez — "18:00" saatin kendisidir.
    const clauses = sentence.split(CLAUSE_SEPARATOR);
    for (let i = 0; i < clauses.length; i++) {
      if (!CHECKOUT_CUE.test(clauses[i])) continue;
      // Genel olumsuz kalıplar YALNIZ kendi cümleciğini bağlar (↑CLAUSE_NEGATION).
      if (CLAUSE_NEGATION.test(clauses[i])) continue;
      if (segmentStatesTime(clauses[i], h, min)) return true;
      // İleri bakış YALNIZ ipucu cümleciğinin KENDİ saati yoksa ("yarın çıkıyoruz, saat 10:00 gibi"). Kendi saati varsa o
      // saat onundur; sonraki cümleciğin saati başka bir işe aittir — inceleme 09-25: "11'de çıkarız demiştim; çıkmadan
      // önce 09:00'da kahvaltı…" 09:00'ı çıkış diye kabul ediyordu. İkinci inceleme: sonraki cümlecik de YALNIZ bir saatten
      // (+ dolgu) ibaret olmalı — "Yarın çıkıyoruz, uçağımız 15:00'te" uçuş saatini çıkış diye kabul ediyordu.
      const next = clauses[i + 1];
      if (
        next &&
        !CLAUSE_NEGATION.test(next) &&
        timeTokens(clauses[i]).length === 0 &&
        isTimeOnlyClause(next) &&
        segmentStatesTime(next, h, min)
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Gün dilimi sözcüğü sayının 12 saatlik okunuşunu SABİTLER (ikinci inceleme 09-25): "sabah 10" yalnız 10:00, "akşam 6"
 * yalnız 18:00 — eskiden "Akşam 6'da çıkıyoruz" 06:00'ı, "Sabah 10'da çıkarız" 22:00'yi de doğruluyordu.
 */
function dayPeriodOf(before: string, after: string): "am" | "pm" | null {
  if (
    /(?:^|\s)(?:sabah|sabahleyin|sabaha karşı|sabaha karsi)\s*(?:saat\s*)?$/.test(before) ||
    /^\s*(?:in the morning|this morning)(?![a-z])/.test(after)
  ) {
    return "am";
  }
  if (
    /(?:^|\s)(?:akşam|aksam|akşamüstü|öğlen|oglen|öğle|ogle|öğleden sonra)\s*(?:saat\s*)?$/.test(before) ||
    /^\s*(?:in the (?:evening|afternoon)|this (?:evening|afternoon)|tonight)(?![a-z])/.test(after)
  ) {
    return "pm";
  }
  return null;
}

/** Does this (lowercased) segment plausibly contain the time h:min? */
function segmentStatesTime(text: string, h: number, min: number): boolean {
  // 1) Explicit hour:minute / hour.minute mentions, optional am/pm suffix. Bir tarihin parçası ("12.10.2026") saat
  //    değildir — ikinci inceleme 09-25: "12.10.2026'da çıkıyoruz" 12:10'u doğruluyordu.
  for (const m of text.matchAll(/(?<![\d/.])(\d{1,2})[:.](\d{2})(?![\d/.]*\d)\s*(a\.?m\.?|p\.?m\.?)?/g)) {
    let hh = Number(m[1]);
    const mm = Number(m[2]);
    if (hh > 23 || mm > 59) continue;
    const isPm = m[3]?.startsWith("p") ?? false;
    const isAm = m[3]?.startsWith("a") ?? false;
    const at = m.index ?? 0;
    if (isReplacedTime(text.slice(0, at), text.slice(at + m[0].length)) || isCheckinLabeled(text.slice(0, at))) continue;
    const period = isPm || isAm ? null : dayPeriodOf(text.slice(0, at), text.slice(at + m[0].length));
    if ((isPm || period === "pm") && hh < 12) hh += 12;
    if (isAm && hh === 12) hh = 0;
    if (mm !== min) continue;
    if (hh === h) return true;
    // A bare "6:30" for a checkout honestly means 18:30 as often as 06:30 —
    // accept the afternoon reading when neither am/pm, a day-period word nor a leading zero ("09:00" = 24 saat) pins it down.
    if (!isPm && !isAm && !period && !m[1].startsWith("0") && hh < 12 && hh + 12 === h) return true;
  }

  // 2) Bare-hour mentions — ONLY next to a time cue. Başka bir saatin / tarihin İÇİNDEKİ rakam sayılmaz (ikinci inceleme
  //    09-25): "11:00'de çıkış yapacağız"daki "00" 00:00 ve 12:00'ı, "Saat 10:30'da"daki "10" 10:00'ı doğruluyordu.
  for (const m of text.matchAll(/(?<![\d:./,])\d{1,2}(?!\d)(?![:./,]\d)/g)) {
    const n = Number(m[0]);
    if (n > 23) continue;
    const at = m.index ?? 0;
    const before = text.slice(0, at);
    const after = text.slice(at + m[0].length);
    // "11 buçuk" = 11:30. Çeyrek / "half past" / "quarter to" TAM SAAT DEĞİLDİR ve okunmaz (güvenli yön: kabul edilmez) —
    // eskiden "Saat 11 buçukta çıkarız" 11:00'ı doğruluyordu.
    const half = /^\s*'?\s*bu[çc]uk/.test(after);
    if (!half && (/^\s*'?[a-zçğıöşü]{0,3}\s*[çc]eyrek/.test(after) || /(?:half|quarter)\s+(?:past|to|after|before)\s*$/.test(before))) {
      continue;
    }
    if ((half ? 30 : 0) !== min) continue;
    // Sayaç / para / tarih / numara saat değildir ("at 15 EUR", "10 Ekim", "oda 10") — `timeTokens` ile aynı kural. "Buçuk"
    // ardındaki sözcük de sayılır: "2 buçuk saatte", "10 buçuk euro" saat değil (kör batarya 09-25).
    if (COUNTER_AFTER.test(afterHalf(after)) || NUMBER_BEFORE.test(before)) continue;
    if (isReplacedTime(before, after) || isCheckinLabeled(before)) continue;
    // (?:^|\s) instead of \b — JS \b is ASCII-only and fails on ö/ğ/ş etc.
    const cueBefore = /(?:^|\s)(?:saat|at|by|um|around|öğlen|sabah|akşam)\s*$/.test(before);
    const cueAfter =
      half ||
      /^\s*(?:a\.?m\.?\b|p\.?m\.?\b|o'?clock\b|uhr\b|gibi\b|civar|sular|ish\b)/.test(after) ||
      /^\s?'?[dt][ae]\b/.test(after) || // "18'de", "18de", "11 de"
      /^'?[ae]\s+kadar/.test(after); // "11'e kadar"
    if (!cueBefore && !cueAfter) continue;
    const isPm = /^\s*p\.?m\.?\b/.test(after);
    const isAm = /^\s*a\.?m\.?\b/.test(after);
    const period = isPm || isAm ? null : dayPeriodOf(before, after);
    let hh = n;
    if ((isPm || period === "pm") && hh < 12) hh += 12;
    if (isAm && hh === 12) hh = 0;
    if (hh === h) return true;
    // Baştaki sıfır 24 saattir ("08'de" 20:00 değil) — açık saatle aynı kural.
    if (!isPm && !isAm && !period && !m[0].startsWith("0") && n < 12 && n + 12 === h) return true;
  }

  // 3) Sözcükle öğle: "Yarın öğlen çıkarız", "we'll leave at noon" = 12:00 (ardından saat gelmiyorsa: "öğlen 1" 13:00'tür).
  // "öğlen yemeği" (öğle yemeği) bir saat değildir.
  if (
    h === 12 &&
    min === 0 &&
    /(?:^|\s)(?:öğlen|oglen|öğleyin|noon|midday)(?!\s*(?:saat\s*)?\d)(?!\s+yeme)(?![a-zçğıöşü])/.test(text)
  ) {
    return true;
  }
  return false;
}

/** "Buçuk" sözcüğünden SONRAKİ metin (sayaç denetimi için); buçuk yoksa metin aynen. */
function afterHalf(after: string): string {
  return after.replace(/^\s*'?\s*bu[çc]uk\p{L}*/u, "");
}

/** Giriş saati olarak ETİKETLENEN saat çıkış saati değildir: "Giriş 15:00 çıkış 11:00 değil mi?", "Check-in 3pm check-out 11am". */
function isCheckinLabeled(before: string): boolean {
  return /(?:^|\s)(?:giriş|giris|check[\s-]?in|arrival|varış|varis)(?:\s+saat\p{L}*)?\s*:?\s*$/u.test(before);
}

/**
 * Değiştirilen saat beyan DEĞİLDİR (ikinci inceleme 09-25): "10'da değil 11'de çıkarız", "Saat 10 yerine 11:30'da",
 * "not at 10", "instead of 10" — eskiden eski saat de "beyan edildi" sayılıyordu. (Düzeltme yolu `timeTokens` kullanır ve
 * eski saati BİLEREK görür.)
 */
function isReplacedTime(before: string, after: string): boolean {
  return (
    // Açık saatin eşleşmesi ardındaki boşluğu da yer ("10:00 yerine") → boşluk isteğe bağlı.
    /^(?:'?[a-zçğıöşü]{1,3})?\s*(?:yerine|değil|degil)(?![a-zçğıöşü])/.test(after) ||
    /(?:^|\s)(?:instead of|rather than|not)\s+(?:at\s+)?$/.test(before)
  );
}

/**
 * Cümlecik YALNIZ bir saatten (+ dolgu sözcüklerinden) mi ibaret: "saat 10:00 gibi", "around 10am", "10'da olur". İleri
 * bakış ve düzeltme yolu başka bir olayın saatini ("uçağımız 15:00'te", "11'de temizlikçi gelebilir") çıkış saati
 * sanmasın diye (ikinci inceleme 09-25).
 */
const TIME_FILLER =
  /(?:^|\s)(?:saat|gibi|civar\p{L}*|sular\p{L}*|falan|kadar|bu[çc]uk\p{L}*|lütfen|lutfen|please|belki|muhtemelen|tahminen|herhalde|yaklaşık|yaklasik|olur|olabilir|olacak|diyelim|sabah|akşam|aksam|öğlen|oglen|around|about|approximately|approx|probably|maybe|at|by|ish|or|so|in|the|morning|evening|afternoon|am|pm|a\.m\.|p\.m\.|o'clock|uhr|um|gegen)(?=\s|$)/gu;
function isTimeOnlyClause(text: string): boolean {
  const rest = text
    .replace(/\d{1,2}(?:[:.]\d{2})?(?:'?[a-zçğıöşü]{1,4})?/gu, " ")
    .replace(TIME_FILLER, " ")
    .replace(/[^\p{L}]+/gu, "");
  return rest.length === 0;
}

/**
 * DÜZELTME (09-25, kurucu örneği: "10 demiştim ama 11 olacak"). Misafir daha önce KAYITLI çıkış saatini değiştiriyorsa
 * mesajda çıkış fiili olmayabilir — `timeStatedInMessage` bunu reddediyordu ve eski saat kayıtlı kalıyordu. Anlamı (bu bir
 * çıkış saati düzeltmesi mi, yoksa "10 kişi demiştik ama 11 olacağız" mı) cevap modeli çözer; bu yüklem yalnız
 * HALÜSİNASYON durdurucudur. İnceleme 09-25 (P2) ile sıkılaştı — ilk sürüm tek bir sayıyı iki saat birden sayıyordu ("10
 * demiştim, aynen geçerli" → 22:00; "8 kişiyiz" → 20:00) ve uçuş saatini düzeltme diye kabul ediyordu:
 *  · cümlede TAM İKİ saat belirteci olmalı; eski saat biri, yeni saat ÖTEKİ (aynı belirteç iki saati karşılayamaz). Üç
 *    saatli cümle ("Sabah 10 dedik ama uçağımız 14:00'te, 11'de çıkarız") bu yoldan kabul edilmez — çıkış fiili taşıyan
 *    saat zaten `timeStatedInMessage` ile kabul edilir;
 *  · sayaç / sıra sayıları saat değildir: ardında kişi / tane / gece / valiz / saat (süre) …, önünde oda / kat / daire / no
 *    …; tarih parçası (25/09, 10.11.) saat değildir;
 *  · cümlede bir DÜZELTME ya da ÇIKIŞ işareti olmalı (demiştim / yerine / değil / olacak / instead / çıkış …);
 *  · ayrılmayı reddetme vetosu aynen geçerli ("10'da çıkmayacağız" — güvenli yön: eski saat kalır).
 */
export function timeCorrectedInMessage(previousHhmm: string, newHhmm: string, message: string): boolean {
  const prev = HHMM.exec(previousHhmm.trim());
  const next = HHMM.exec(newHhmm.trim());
  if (!prev || !next || message.length > MAX_STATED_TIME_MESSAGE_CHARS) return false;
  const prevMin = Number(prev[1]) * 60 + Number(prev[2]);
  const nextMin = Number(next[1]) * 60 + Number(next[2]);
  if (prevMin === nextMin) return false;
  const lower = normalizeMessage(message);
  if (DEPARTURE_REFUSAL.test(lower)) return false;
  for (const sentence of lower.split(/(?:[!?\n]|(?<!\d)\.|\.(?!\d))+/)) {
    if (!CORRECTION_CUE.test(sentence) && !CHECKOUT_CUE.test(sentence)) continue;
    const tokens = timeTokens(sentence);
    if (tokens.length !== 2) continue;
    const [a, b] = tokens;
    // Yeni saatin KENDİ cümleciği de bir düzeltme / çıkış işareti taşımalı ya da yalnız saatten ibaret olmalı ("10
    // demiştim, 11'de") — ikinci inceleme 09-25: "10 demiştik, değişmedi, 11'de temizlikçi gelebilir" temizlikçinin saatini
    // çıkış yapıyordu.
    const newTimeClauseOk = (at: number) => {
      const clause = clauseAround(sentence, at);
      return CORRECTION_CUE.test(clause) || CHECKOUT_CUE.test(clause) || isTimeOnlyClause(clause);
    };
    if (a.readings.includes(prevMin) && b.readings.includes(nextMin) && newTimeClauseOk(b.at)) return true;
    if (b.readings.includes(prevMin) && a.readings.includes(nextMin) && newTimeClauseOk(a.at)) return true;
  }
  return false;
}

/** `at` konumunu içeren cümlecik (↑CLAUSE_SEPARATOR — ileri bakışla aynı sınırlar). */
function clauseAround(sentence: string, at: number): string {
  let start = 0;
  for (const m of sentence.matchAll(CLAUSE_SEPARATOR)) {
    const i = m.index ?? 0;
    if (i >= at) return sentence.slice(start, i);
    start = i + m[0].length;
  }
  return sentence.slice(start);
}

/** Düzeltme işareti: "10 demiştim ama 11 olacak", "10 yerine 11", "10 değil 11", "instead of 10", "I said 10". */
const CORRECTION_CUE =
  /demişt|dedim|dedik|söylemişt|yazmışt|yerine|değil|degil|olacak|olsun|yapal|çekel|cekel|değiş|degis|instead|said|rather|change|actually|make it|not\s|korrigier|statt|plutôt|au lieu|en vez|en lugar/;

// Sayaç / süre sözcükleri (sayının ARDINDA) ve sıra/numara sözcükleri (ÖNÜNDE): saat değildir. İkinci inceleme 09-25:
// sıra sayısı ("10'unda", "11'inci", "the 11th"), ay adı ("10 Ekim", "10 June") ve yaş ("10 yaşında") da — "10'unda değil
// 11'inde çıkıyoruz" kayıtlı çıkış saatini 10'dan 11'e taşıyordu.
const COUNTER_AFTER =
  /^\s*'?(?:s?[ıiuü]n[dt][ae]|[ıiuü]?nc[ıiuü]|st\b|nd\b|rd\b|th\b|yaş|ocak|şubat|subat|mart|nisan|mayıs|mayis|haziran|temmuz|ağustos|agustos|eylül|eylul|ekim|kasım|kasim|aralık|aralik|jan|feb|mar\b|march|apr|may\b|jun|jul|aug|sep|oct|nov|dec|kişi|kisi|yetişkin|yetiskin|çocuk|cocuk|bebek|misafir|gece|gün|gun|hafta|ay(?!\p{L})|yıl|yil|valiz|bavul|çanta|canta|tane|adet|havlu|çarşaf|carsaf|yastık|yastik|battaniye|şişe|sise|towels?|blankets?|pillows?|bottles?|araba|araç|arac|oda|yatak|dakika|dk(?!\p{L})|saat|kat(?!\p{L})|numara|people|persons?|guests?|adults?|kids?|children|nights?|days?|weeks?|months?|years?|bags?|suitcases?|pieces?|cars?|rooms?|beds?|minutes?|mins?|hours?|hrs?|floors?|%|€|\$|£|₺|tl(?!\p{L})|eur|usd|euro|lira)/u;
const NUMBER_BEFORE =
  /(?:^|\s)(?:oda|kat|daire|no|numara|kapı|kapi|blok|room|floor|apt|apartment|flat|door|number|nr|zimmer|chambre|habitación|habitacion)\.?\s*(?:no\.?\s*)?:?\s*$/u;

/**
 * Cümledeki saat belirteçleri — her biri AYRI bir konum, okunuşları (gün içi dakika). Açık saat ("10:00", "6.30 pm")
 * tam okunur (öğleden sonra okunuşu yalnız am/pm yoksa); çıplak tam sayı ("10") ancak tarih/sayaç/numara değilse sayılır.
 */
function timeTokens(text: string): { at: number; readings: number[] }[] {
  const out: { at: number; readings: number[] }[] = [];
  const taken: [number, number][] = [];
  for (const m of text.matchAll(/(?<![\d/.])(\d{1,2})[:.](\d{2})(?![\d/.]*\d)\s*(a\.?m\.?|p\.?m\.?)?/g)) {
    let hh = Number(m[1]);
    const mm = Number(m[2]);
    if (hh > 23 || mm > 59) continue;
    const isPm = m[3]?.startsWith("p") ?? false;
    const isAm = m[3]?.startsWith("a") ?? false;
    const at0 = m.index ?? 0;
    const period = isPm || isAm ? null : dayPeriodOf(text.slice(0, at0), text.slice(at0 + m[0].length));
    if ((isPm || period === "pm") && hh < 12) hh += 12;
    if (isAm && hh === 12) hh = 0;
    const readings = [hh * 60 + mm];
    if (!isPm && !isAm && !period && !m[1].startsWith("0") && hh < 12) readings.push((hh + 12) * 60 + mm);
    out.push({ at: at0, readings });
    taken.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
  }
  for (const m of text.matchAll(/(?<![\d:./,])(\d{1,2})(?!\d)(?![:./,]\d)/g)) {
    const at = m.index ?? 0;
    if (taken.some(([s0, e0]) => at >= s0 && at < e0)) continue;
    const n = Number(m[1]);
    if (n > 23) continue;
    const after = text.slice(at + m[1].length);
    if (COUNTER_AFTER.test(afterHalf(after)) || NUMBER_BEFORE.test(text.slice(0, at))) continue;
    // "10 buçuk" = 10:30 (segmentStatesTime ile aynı); çeyrek / "half past" okunmaz — belirteç sayılmaz.
    const half = /^\s*'?\s*bu[çc]uk/.test(after);
    if (!half && (/^\s*'?[a-zçğıöşü]{0,3}\s*[çc]eyrek/.test(after) || /(?:half|quarter)\s+(?:past|to|after|before)\s*$/.test(text.slice(0, at)))) {
      continue;
    }
    const mm = half ? 30 : 0;
    const isPm = /^\s*p\.?m\.?(?![a-z])/.test(after);
    const isAm = /^\s*a\.?m\.?(?![a-z])/.test(after);
    // "10 demiştim ama akşam 7 olacak": gün dilimi okunuşu sabitler (ikinci inceleme 09-25: 07:00 da kabul ediliyordu).
    const period = isPm || isAm ? null : dayPeriodOf(text.slice(0, at), after);
    let hh = n;
    if ((isPm || period === "pm") && hh < 12) hh += 12;
    if (isAm && hh === 12) hh = 0;
    const readings = [hh * 60 + mm];
    if (!isPm && !isAm && !period && hh < 12) readings.push((hh + 12) * 60 + mm);
    out.push({ at, readings });
  }
  return out.sort((x, y) => x.at - y.at);
}
