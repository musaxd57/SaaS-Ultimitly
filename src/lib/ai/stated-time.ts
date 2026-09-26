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
// Kör batarya 09-25 (kapsam): ASCII yazım ("cikiyoruz", "cıkıcaz"), kipli "we should be out / be gone by", "we're off",
// "hit the road", "yola koyuluyoruz", havalimanına gitmek (tasarım gereği ayrılma), DE "reisen … ab / checken … aus /
// verlassen / fahren … los", FR "partir / quitter / départ", ES "saldremos / salimos / nos vamos / dejaremos el piso".
const CHECKOUT_CUE =
  /(?<!a)ç[ıi]k(?!olata|let|artma|rık|rik|ıntı|inti|maz\s+soka[kğ])|(?<![a-zçğıöşü])c[ıi]k(?:[ıi]yor|ar|er|aca|[ıi]ca|[ıi]ş|is)|ayr[ıi]l(?!ık|ik\b)|terk(?!os)|boşalt|bosalt|yola\s+koyul|check(?:ing|ed)?[\s-]?out|(?:\b(?:we|i)(?:'ll|\s+will|'re|'m|\s+are|\s+am|\s+should|\s+must|'d|\s+would|\s+need\s+to|\s+have\s+to)?\s+be\s+(?:out|gone)|head(?:ing)?\s+out)(?![a-z])|\b(?:we|i)(?:'re|'m|\s+are|\s+am|'ll\s+be|\s+will\s+be)\s+off(?![a-z])(?!\s+to\s+(?!(?:the\s+)?airport))|hit\s+the\s+road|(?:head(?:ing)?|go(?:ing)?)\s+to\s+the\s+airport|(?<![a-zçğıöşü])gid(?:iyor|eriz|erim|ece)|(?<!c)leav|depart(?!man|ment)|vacat(?!ion)|auscheck|abreis|reis\p{L}*\s+(?:\S+\s+){0,5}?ab(?![a-zäöü])|check\p{L}*\s+(?:\S+\s+){0,5}?aus(?![a-zäöü])|verlass|fahren\s+(?:\S+\s+){0,5}?los(?![a-z])|(?<![a-zé])(?:on\s+part|je\s+pars|part(?:ir|irons|irai|ons|ez))(?![a-zé])|quitt(?:er|erons|erai|ons)(?![a-z])|départ(?![a-z])|sald(?:remos|ré|rá|rán)(?![a-z])|salimos|salgo(?![a-z])|nos\s+(?:vamos|iremos)|dejar(?:emos|é)?\s+(?:el|la)\s+(?:piso|apartamento|casa)/u;

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
 * YAPAMAMA cümleciği beyan değildir (kör batarya 09-25): "Saat 10'da çıkamayız", "11'de çıkamayacağız, 13'te çıkarız",
 * "10'da çıkış yapamıyoruz", "We can't leave at 11, we'll leave at 12". O saat OLMAYACAK saattir. Ret (↑DEPARTURE_REFUSAL)
 * mesajın tamamını düşürür; yapamama YALNIZ kendi cümleciğini bağlar — aynı mesajdaki gerçek beyan ("13'te çıkarız") kalır.
 */
const DEPARTURE_INABILITY =
  /ç[ıi]kam(?:a(?:y|z|m|d(?!an))|[ıi]yor)|ayr[ıi]lam(?:a(?:y|z|m|d(?!an))|[ıi]yor)|(?:çıkış|cikis|check[\s-]?out)\s+yap(?:am|m(?:ay|[ıi]yor|ad(?!an)|az))|ç[ıi]kma(?:y[ıi]|k)\s+(?:düşünmüyor|dusunmuyor|istemiyor|planlamıyor|planlamiyor)|ç[ıi]kmam[ıi]z\s+mümkün\s+değil|(?:aren'?t|are\s+not|am\s+not|'re\s+not|'m\s+not)\s+(?:leaving|checking)|not\s+going\s+to\s+(?:leave|check)|(?:don'?t|do\s+not)\s+(?:want|plan|intend)\s+to\s+(?:leave|check)|rather\s+not\s+(?:leave|check)|can'?t\s+(?:check|leave)|cannot\s+(?:check|leave)|can\s+not\s+(?:check|leave)|(?:won'?t|will\s+not)\s+be\s+able\s+to\s+(?:check|leave)|(?:unable|not\s+able)\s+to\s+(?:check|leave)|ne\s+(?:pouvons|pourrons|peux|pourrai)\s+pas\s+(?:partir|quitter)|no\s+(?:podemos|podremos|puedo|podré)\s+(?:salir|dejar)/;

/**
 * SORU / İSTEK cümleciği beyan değildir (kör batarya 09-25): "12'de çıkabilir miyiz?", "13.30'da çıksak sorun olur mu?",
 * "Can we check out at 1pm?", "Is a late checkout at 2 possible?". Misafir izin istiyor; kayıt "misafir 13:00'te çıkacağını
 * yazdı" demek olurdu. Yalnız SORU CÜMLECİĞİ düşer: "11'de çıkacağız, olur mu?" beyanı etkilenmez. Soru işaretiyle biten
 * cümlenin SON cümleciği de sorudur ("Geç çıkış 13:00 gibi?").
 */
const QUESTION_CLAUSE =
  /(?:^|\s)m[ıiuü](?:y[ıiuü][mz]|s[ıiuü]n(?:[ıiuü]z)?|d[ıiuü]r)?(?=\s|$)|ç[ıi]ksa[kmn]|ayr[ıi]lsa[kmn]|(?:çıkış|cikis)\s+yapsa[kmn]|^\s*(?:can|could|may|might|would|will|shall|should|is|are|do|does)\s+(?:we|i|it|a|the|there|you)(?=\s)|any\s+chance|(?:^|\s)(?:können|dürfen|könnten)\s+wir|est-ce\s+qu|pouvons-nous|peut-on|¿|(?:^|\s)(?:podemos|podríamos)\s/;

/**
 * BAŞKA BİR ARACIN kalkışı ve NESNELİ "leave" çıkış değildir (kör batarya 09-25): "Our train leaves at 10", "Our flight
 * departs at 13:20", "Our bus departs at 12, so we'll leave at 11", "Trenimiz 10'da gidiyor", "We'll leave the car at the
 * airport at 9". İpucu testinden ÖNCE nötrlenir (↓ulaç gibi); aynı mesajdaki gerçek ipucu ("we'll leave at 11") kalır.
 * Mutasyon turu 09-25: UZUN YOL aracının kalkış İSMİ de ("our departure flight", "the flight's departure", "departure of
 * our train", "départ du vol", "vol de départ") — `depart` / `départ` ipucudur ve uçağın saatini çıkış saati diye kabul
 * ediyordu. Taksi / shuttle / transfer isim dalında YOK: kapıdan alma saati çoğunlukla misafirin çıktığı saattir. Almanca /
 * İspanyolca araç fiilleri ("Zug fährt", "vuelo sale") ipucu olmadığı için burada YOK (nötrlemeleri yalnız ↓işareti
 * bırakırdı; araç sözcüğü cümleciği zaten yalnız-saat olmaktan çıkarır).
 */
const OTHER_DEPARTURE =
  /(?:train|flight|plane|bus|coach|ferry|boat|ship|taxi|cab|uber|shuttle|transfer|tram|metro)\s+(?:\p{L}+\s+){0,2}?(?:leaves|departs|leaving|departing|left|departed|will\s+(?:leave|depart))|(?:train|flight|plane|bus|coach|ferry|boat|ship)(?:'s)?\s+(?:\p{L}+\s+){0,1}?departure|departure\s+(?:flight|train|plane|bus|coach|ferry|(?:time\s+)?(?:of|for)\s+(?:(?:the|our|my|your)\s+)?(?:train|flight|plane|bus|coach|ferry|boat|ship))|départ\s+(?:du|de\s+(?:notre|mon|ma|la|l'|nos|mes|votre))\s*(?:vol|train|avion|bus|bateau|ferry)|(?:vol|train|avion|bus|bateau|ferry)\s+de\s+départ|(?:uça[kğ]|tren|otobüs|otobus|feribot|vapur|taksi|servis|transfer)\p{L}*\s+(?:\S+\s+){0,2}?(?:gidiyor|gidecek|çıkıyor|cikiyor|çıkacak|kalkıyor|ayrılıyor)(?![a-zçğıöşü])|leav(?:e|ing)\s+(?:the|our|my|your)\s+(?:car|keys?|bags?|luggage|suitcases?|stuff|things|rubbish|trash)|(?<![a-zçğıöşü])(?:plaj|deniz|konser|yemeğ|yemek|tur|müze|muze|çarşı|carsi|alışveriş|alisveris|gezi|gezme|gezinti|yürüyüş|yuruyus|havuz|sahil|park)\p{L}{0,2}\s+(?:\S+\s+){0,1}?(?:ç[ıi]k|c[ıi]k|gid)\p{L}*|(?:head(?:ing)?|go(?:ing)?|be)\s+out\s+(?:\S+\s+){0,3}?for\s+(?:a\s+|the\s+)?(?:dinner|lunch|breakfast|brunch|drinks|tour|walk|hike|swim|day|evening|sightseeing|shopping)|check(?:ed|ing)?[\s-]?out\s+(?:the|a|an|this|that|some)\s+(?!(?:flat|apartment|room|place|property|house|home|unit|studio|villa|airbnb)(?![a-z]))/gu;

/**
 * Nötrlenen ifadenin YERİNE konan sözcük (↑OTHER_DEPARTURE). Boşluk DEĞİL (mutasyon turu 09-25): "We leave tomorrow, the
 * train leaves at 10" — boşlukla silinen "train leaves" ikinci cümleciği "the … at 10" bırakıyordu; ileri bakış onu
 * yalnız-saat cümleciği (↓isTimeOnlyClause) sanıp TREN saatini çıkış saati diye kabul ediyordu ("Yarın çıkıyoruz, plaja
 * gidiyoruz 10'da" de). Hiçbir ipucu / dolgu / ayırıcı kalıbına uymayan harf dizisi: cümlecikte BAŞKA bir olay olduğunu
 * taşır, başka bir şey söylemez.
 */
const OTHER_EVENT_MARK = " başkaolay ";

/**
 * CÜMLECİK seviyesinde bağlayan genel olumsuz kalıplar. "11:00'de çıkacağız,
 * lütfen sabah temizlik yapmayın" mesajında olumsuz olan İKİNCİ cümleciktir —
 * mesaj geneline uygulanırsa meşru beyan düşerdi (07-31 pini).
 */
const CLAUSE_NEGATION = /yapmay[ıi]n/;

/**
 * ÖNCEKİ beyanın AKTARIMI yeni beyan değildir (kör batarya 09-25): "10'da çıkacağımızı yazmıştım; 8'de çıkıyoruz". O
 * cümlecikteki saat eski saattir — yeni saat kendi cümleciğinden okunur. (Düzeltme yolu eski saati BİLEREK görür.)
 */
const REPORTED_EARLIER = /demişt|dedim|dedik|söylemişt|soylemist|yazmışt|yazmist|i\s+(?:said|wrote|told)|as\s+(?:i|we)\s+(?:said|mentioned|wrote)/;

/**
 * CÜMLECİK AYIRICISI (↓ iki fonksiyon aynı kuralı kullanır): virgül / noktalı virgül, bağlaçlar, boşluklu tire ve rakamlar
 * ARASINDA olmayan iki nokta ("18:00" saatin kendisidir). İkinci inceleme 09-25: "so / since / için" da ("Uçağımız 15:30'da
 * olduğu için 12 gibi çıkarız", "The cleaner can come at 11 since we leave at 10"); "öğleden sonra" bölünmez.
 */
const CLAUSE_SEPARATOR =
  /[,;]+|\s+(?:ve|and|ama|but|fakat|(?<!(?:öğleden|ogleden)\s+)sonra|then|ayrıca|çünkü|için|because|so|since|while|yani|diye|et|und|y|pero|mais|aber|dann|puis|luego)\s+|\s+[-–—]\s+|(?<!\d):(?!\d)|(?<=(?<![a-zçğıöşü])[a-zçğıöşü]{2,}[ıiuü]p)(?<!(?:trip|ship|skip|group|grup|setup|pickup|backup|soup|chip|clip|drip|flip|grip|strip|whip|kulüp|kulup|equip))\s+|(?<=[dt][ıiuü]ğ[ıiuü](?:m[ıiuü]z|n[ıiuü]z|m|n)d[ae]n?)\s+|(?<=[a-zçğıöşü]{2,}(?:[ıiuüae]rs[ae]|[ae]c[ae]ks[ae]|[dt][ıiuü]ys[ae]|m[ıiuü]şs[ae]|yors[ae]))\s+/g;

/**
 * iPhone'un kıvrık kesme işareti ("11’de") düz olana çevrilir — ikinci inceleme 09-25: ipucu ve ek okunmuyordu. Satır içi
 * boşluk dizileri TEK boşluğa indirilir: cümlecik ayırıcısı (`\s+ve\s+` …) uzun boşluk dizisinde karesel iş yapıyordu (kör
 * batarya 09-25: 20.000 boşlukta ~0,9 sn senkron CPU). Satır sonu cümle sınırıdır, korunur.
 */
function normalizeMessage(message: string): string {
  return (
    message
      .replace(/[\u2018\u2019\u02BC\u2032\u00B4`]/g, "'")
      .replace(/[^\S\n]+/g, " ")
      .toLowerCase()
      // "10 a.m." — noktalar cümle bölücüsüne takılıp saati ipucundan ayırıyordu (kör batarya 09-25).
      .replace(/(?<![a-z])([ap])\.\s?m\.?(?![a-z])/g, "$1m")
  );
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

  // Ulaçları ve başka aracın kalkışını NÖTRLE: ne ipucu ne olumsuzluk sayılsınlar (↑CHECKOUT_GERUND, ↑OTHER_DEPARTURE).
  const neutral = lower.replace(CHECKOUT_GERUND, " ").replace(OTHER_DEPARTURE, OTHER_EVENT_MARK);

  // Önceki beyanın AKTARIMI (↑REPORTED_EARLIER) yalnız mesajda AKTARILMAMIŞ başka bir saatli çıkış beyanı varsa düşer
  // ("10'da çıkacağımızı yazmıştım; 8'de çıkıyoruz" → 10:00 eski); yoksa aktarım bir teyittir ("11'de çıkarız demiştim;
  // çıkmadan önce kahvaltı…" → 11:00 hâlâ plan).
  let reportedMatch = false;
  let freshStatement = false;
  for (const { sentence, question } of sentencesOf(neutral)) {
    // ⚠️ BAĞLAÇLAR DA CÜMLECİK AYIRICISIDIR (saldırgan denetimi, 08-01). Ayırıcı
    // yalnız `,;` iken tek bir "ve"/"and"/tire garantiyi deliyordu — ölçüldü:
    //   "Akşam yemeği saat 18:00. Yarın çıkıyoruz"  → 18:00 RED  ✅
    //   "Akşam yemeği saat 18:00 ve yarın çıkıyoruz" → 18:00 KABUL ❌
    // Aynı iki cümle, YALNIZ bağlaç değişti. İleri bakış zaten cümle içinde
    // kaldığı için meşru "yarın çıkıyoruz ve saat 10:00 gibi" bozulmaz.
    // ⚠️ İKİ NOKTA rakamlar ARASINDA bölünemez — "18:00" saatin kendisidir.
    const clauses = sentence.split(CLAUSE_SEPARATOR);
    const notStatement = (j: number) =>
      DEPARTURE_INABILITY.test(clauses[j]) || QUESTION_CLAUSE.test(clauses[j]) || (question && j === clauses.length - 1);
    for (let i = 0; i < clauses.length; i++) {
      if (!CHECKOUT_CUE.test(clauses[i])) continue;
      // Genel olumsuz kalıplar, yapamama ve soru YALNIZ kendi cümleciğini bağlar (↑CLAUSE_NEGATION, ↑DEPARTURE_INABILITY).
      if (CLAUSE_NEGATION.test(clauses[i]) || notStatement(i)) continue;
      const reported = REPORTED_EARLIER.test(clauses[i]);
      const ownTime = timeTokens(clauses[i]).length > 0;
      if (!reported && ownTime) freshStatement = true;
      if (segmentStatesTime(clauses[i], h, min)) {
        if (!reported) return true;
        reportedMatch = true;
        continue;
      }
      // İleri bakış YALNIZ ipucu cümleciğinin KENDİ saati yoksa ("yarın çıkıyoruz, saat 10:00 gibi"). Kendi saati varsa o
      // saat onundur; sonraki cümleciğin saati başka bir işe aittir — inceleme 09-25: "11'de çıkarız demiştim; çıkmadan
      // önce 09:00'da kahvaltı…" 09:00'ı çıkış diye kabul ediyordu. İkinci inceleme: sonraki cümlecik de YALNIZ bir saatten
      // (+ dolgu) ibaret olmalı — "Yarın çıkıyoruz, uçağımız 15:00'te" uçuş saatini çıkış diye kabul ediyordu.
      const next = clauses[i + 1];
      if (next && !CLAUSE_NEGATION.test(next) && !notStatement(i + 1) && !ownTime && isTimeOnlyClause(next)) {
        if (!reported && timeTokens(next).length > 0) freshStatement = true;
        if (segmentStatesTime(next, h, min)) {
          if (!reported) return true;
          reportedMatch = true;
        }
      }
    }
  }
  return reportedMatch && !freshStatement;
}

/**
 * Cümleler + soru işaretiyle bitip bitmediği. Rakamlar arasındaki nokta ("18.30") saat ayırıcısıdır, cümle sonu değil.
 */
function sentencesOf(text: string): { sentence: string; question: boolean }[] {
  const parts = text.split(/((?:[!?\n]|(?<!\d)\.|\.(?!\d))+)/);
  const out: { sentence: string; question: boolean }[] = [];
  for (let k = 0; k < parts.length; k += 2) out.push({ sentence: parts[k], question: (parts[k + 1] ?? "").includes("?") });
  return out;
}

/**
 * Gün dilimi sözcüğü sayının 12 saatlik okunuşunu SABİTLER (ikinci inceleme 09-25): "sabah 10" yalnız 10:00, "akşam 6"
 * yalnız 18:00 — eskiden "Akşam 6'da çıkıyoruz" 06:00'ı, "Sabah 10'da çıkarız" 22:00'yi de doğruluyordu.
 */
type DayPeriod = "am" | "pm" | "night";
// İngilizce gün dilimi sayının ÖNÜNDE de gelir (kör batarya 09-25): "tonight at 9", "Tomorrow morning at 7 we leave".
const EN_AM_BEFORE = /(?:^|\s)(?:(?:this|tomorrow|early)\s+morning|in\s+the\s+morning)\s+(?:at|around|about|by)?\s*$/;
const EN_PM_BEFORE =
  /(?:^|\s)(?:tonight|(?:this|tomorrow)\s+(?:evening|afternoon)|in\s+the\s+(?:evening|afternoon))\s+(?:at|around|about|by)?\s*$/;
function dayPeriodOf(before: string, after: string): DayPeriod | null {
  if (
    /(?:^|\s)(?:sabah|sabahleyin|sabaha karşı|sabaha karsi)(?:\s+erken(?:den)?)?\s*(?:saat\s*)?$/.test(before) ||
    EN_AM_BEFORE.test(before) ||
    /^\s*(?:h\s+|uhr\s+)?(?:in the morning|this morning|tomorrow morning|de la mañana|du matin|morgens)(?![a-z])/.test(after)
  ) {
    return "am";
  }
  if (
    /(?:^|\s)(?:akşam|aksam|akşamüstü|akşam üstü|akşam üzeri|akşamüzeri|aksam ustu|akşama doğru|aksama dogru|öğlen|oglen|öğle|ogle|öğleden sonra|ogleden sonra)\s*(?:saat\s*)?$/.test(before) ||
    EN_PM_BEFORE.test(before) ||
    /^\s*(?:h\s+|uhr\s+)?(?:in the (?:evening|afternoon)|this (?:evening|afternoon)|tomorrow (?:evening|afternoon)|tonight|de la (?:tarde|noche)|du soir|abends)(?![a-z])/.test(after)
  ) {
    return "pm";
  }
  // "Gece 11'de" 23:00, "gece 2'de" 02:00, "gece 12'de" 00:00 (↓to24).
  if (/(?:^|\s)(?:gece|geceleyin)\s*(?:saat\s*)?$/.test(before) || /^\s*at night(?![a-z])/.test(after)) return "night";
  return null;
}

/**
 * 24 saatlik okunuş. "Gece" 7–11 → akşam, 12 → 00:00, 1–6 → sabah. Gün dilimi / am-pm YOKSA öğleden sonra okunuşu ayrıca
 * kabul edilir ama YALNIZ 1–7 için (13:00–19:59: akşam uçuşu) — kör batarya 09-25: "10:30'da çıkış" 22:30'u, "Yarın 11'de
 * çıkıyoruz" 23:00'ü da doğruluyordu; 20:00 sonrası çıkış beyanı yok denecek kadar azdır (gerçekse ret güvenli yöndür).
 */
function to24(hh: number, isAm: boolean, isPm: boolean, period: DayPeriod | null): number {
  if ((isPm || period === "pm") && hh < 12) return hh + 12;
  if ((isAm || period === "night") && hh === 12) return 0;
  if (period === "night" && hh >= 7 && hh < 12) return hh + 12;
  return hh;
}
const afternoonAlternative = (hh: number) => hh >= 1 && hh <= 7;

/**
 * Bir saat belirtecinin ÖNÜNDEKİ metin — yalnız son 64 karakter. Önüne bakan her kalıp ("saat", "at", "tomorrow afternoon
 * around", "instead of checking out at", "check-in saati:", "before the breakfast around" …) `$`'a çapalıdır ve en fazla
 * birkaç sözcüktür; metnin tamamını vermek her belirteçte baştan tarama demekti (karesel — ölçüm 09-25: 4.000 karakterlik
 * "çıkış 1 1 1 …" 33–41 ms senkron CPU).
 */
const BEFORE_WINDOW_CHARS = 64;
function beforeOf(text: string, at: number): string {
  return text.slice(Math.max(0, at - BEFORE_WINDOW_CHARS), at);
}

/** Does this (lowercased) segment plausibly contain the time h:min? */
function segmentStatesTime(text: string, h: number, min: number): boolean {
  // 1) Explicit hour:minute / hour.minute mentions, optional am/pm suffix. Bir tarihin parçası ("12.10.2026") saat
  //    değildir — ikinci inceleme 09-25: "12.10.2026'da çıkıyoruz" 12:10'u doğruluyordu.
  for (const m of text.matchAll(/(?<![\d/.])(\d{1,2})(?:[:.]|h(?=\d{2}))(\d{2})(?![\d/.]*\d)\s*(a\.?m\.?|p\.?m\.?)?/g)) {
    let hh = Number(m[1]);
    const mm = Number(m[2]);
    if (hh > 23 || mm > 59) continue;
    const isPm = m[3]?.startsWith("p") ?? false;
    const isAm = m[3]?.startsWith("a") ?? false;
    const at = m.index ?? 0;
    const before = beforeOf(text, at);
    if (
      isReplacedTime(before, text.slice(at + m[0].length)) ||
      isCheckinLabeled(before) ||
      MEAL_TIME_BEFORE.test(before) ||
      DURATION_BEFORE.test(before)
    ) {
      continue;
    }
    const period = isPm || isAm ? null : dayPeriodOf(before, text.slice(at + m[0].length));
    const raw = hh;
    hh = to24(hh, isAm, isPm, period);
    if (mm !== min) continue;
    if (hh === h) return true;
    // A bare "6:30" for a checkout honestly means 18:30 as often as 06:30 — accept the afternoon reading when neither
    // am/pm, a day-period word nor a leading zero ("09:00" = 24 saat) pins it down (↑to24: yalnız 1–7).
    if (!isPm && !isAm && !period && !m[1].startsWith("0") && afternoonAlternative(raw) && raw + 12 === h) return true;
  }

  // 2) Bare-hour mentions — ONLY next to a time cue. Başka bir saatin / tarihin İÇİNDEKİ rakam sayılmaz (ikinci inceleme
  //    09-25): "11:00'de çıkış yapacağız"daki "00" 00:00 ve 12:00'ı, "Saat 10:30'da"daki "10" 10:00'ı doğruluyordu.
  for (const m of text.matchAll(/(?<![\d:./,])\d{1,2}(?!\d)(?![:./,]\d)(?!h\d)/g)) {
    const n = Number(m[0]);
    if (n > 23) continue;
    const at = m.index ?? 0;
    const before = beforeOf(text, at);
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
    if (isReplacedTime(before, after) || isCheckinLabeled(before) || MEAL_TIME_BEFORE.test(before)) continue;
    // (?:^|\s) instead of \b — JS \b is ASCII-only and fails on ö/ğ/ş etc.
    const cueBefore = /(?:^|\s)(?:saat|at|by|um|gegen|around|öğlen|sabah|akşam|à|vers|las)\s*$/.test(before);
    const cueAfter =
      half ||
      /^\s*(?:a\.?m\.?\b|p\.?m\.?\b|o'?clock\b|uhr\b|gibi\b|civar|sular|ish\b)/.test(after) ||
      /^\s?'?[dt][ae]\b/.test(after) || // "18'de", "18de", "11 de"
      /^\s?h(?![a-z0-9])/.test(after) || // "10h"
      /^'?[ae]\s+(?:kadar|doğru|dogru)/.test(after); // "11'e kadar", "3'e doğru"
    if (!cueBefore && !cueAfter) continue;
    const isPm = /^\s*p\.?m\.?\b/.test(after);
    const isAm = /^\s*a\.?m\.?\b/.test(after);
    const period = isPm || isAm ? null : dayPeriodOf(before, after);
    if (to24(n, isAm, isPm, period) === h) return true;
    // Baştaki sıfır 24 saattir ("08'de" 20:00 değil) — açık saatle aynı kural.
    if (!isPm && !isAm && !period && !m[0].startsWith("0") && afternoonAlternative(n) && n + 12 === h) return true;
  }

  // 3) Sözcükle öğle / gece yarısı: "Yarın öğlen çıkarız", "we'll leave at noon", "öğleye kadar" = 12:00 (ardından saat
  // gelmiyorsa: "öğlen 1" 13:00'tür); "gece yarısı", "midnight" = 00:00. "öğlen yemeği" (öğle yemeği) bir saat değildir.
  if (
    h === 12 &&
    min === 0 &&
    timeTokens(text).length === 0 &&
    /(?:^|\s)(?:öğlen|oglen|öğleyin|öğleye|ogleye|noon|midday|midi|mediodía|mediodia|mittag)(?!\s*(?:saat\s*)?\d)(?!\s+yeme)(?![a-zçğıöşü])/.test(text)
  ) {
    return true;
  }
  if (h === 0 && min === 0 && /(?:^|\s)(?:gece\s+yarısı|gece\s+yarisi|midnight|minuit|mitternacht|medianoche)(?![a-zçğıöşü])/.test(text)) {
    return true;
  }
  return false;
}

/** Süre saat değildir: "dans 2h30", "in 2:30", "2 saat 30 dakika içinde". */
const DURATION_BEFORE = /(?:^|\s)(?:dans|en|pendant|durant|in|for|within|içinde|icinde)\s*$/;

/** Yemeğin saati çıkış saati değildir: "After breakfast at 9 we'll leave" (kör batarya 09-25). */
const MEAL_TIME_BEFORE = /(?:^|\s)(?:after|before)\s+(?:the\s+)?(?:breakfast|lunch|dinner|brunch)\s+(?:at|around)\s*$/;

/** "Buçuk" sözcüğünden SONRAKİ metin (sayaç denetimi için); buçuk yoksa metin aynen. */
function afterHalf(after: string): string {
  return after.replace(/^\s*'?\s*bu[çc]uk\p{L}*/u, "");
}

/** Giriş saati olarak ETİKETLENEN saat çıkış saati değildir: "Giriş 15:00 çıkış 11:00 değil mi?", "Check-in 3pm check-out 11am". */
function isCheckinLabeled(before: string): boolean {
  return /(?:^|\s)(?:giriş|giris|check[\s-]?in|arrival|varış|varis)'?\p{L}{0,5}(?:\s+(?:saat\p{L}*|time))?\s*:?\s*$/u.test(before);
}

/**
 * Değiştirilen saat beyan DEĞİLDİR (ikinci inceleme 09-25): "10'da değil 11'de çıkarız", "Saat 10 yerine 11:30'da",
 * "not at 10", "instead of 10" — eskiden eski saat de "beyan edildi" sayılıyordu. (Düzeltme yolu `timeTokens` kullanır ve
 * eski saati BİLEREK görür.)
 */
function isReplacedTime(before: string, after: string): boolean {
  return (
    // Açık saatin eşleşmesi ardındaki boşluğu da yer ("10:00 yerine") → boşluk isteğe bağlı.
    /^(?:'?[a-zçğıöşü]{1,3})?\s*(?:(?:ç[ıi]kmak|ayr[ıi]lmak|ç[ıi]kmay[ıi]|ç[ıi]k[ıi]ş(?:\s+yapmak)?)\s+)?(?:yerine|değil|degil)(?![a-zçğıöşü])/.test(after) ||
    /(?:^|\s)(?:instead of|rather than|not)\s+(?:\p{L}+ing\s+(?:out\s+)?)?(?:at\s+)?$/u.test(before)
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
  for (const { sentence: raw, question } of sentencesOf(lower)) {
    // Başka aracın kalkışı çıkış ipucu değildir (↑OTHER_DEPARTURE) — ama olay ADI ham cümleden okunur: "Our flight leaves
    // at 13:00 instead of 11" nötrlenince "flight" sözcüğü de gider.
    const sentence = raw.replace(OTHER_DEPARTURE, OTHER_EVENT_MARK);
    if (!CORRECTION_CUE.test(sentence) && !CHECKOUT_CUE.test(sentence)) continue;
    // Çıkış ipucu yokken cümle BAŞKA bir olayı adlandırıyorsa düzeltme o olayındır (kör batarya 09-25): "Kahvaltı 10
    // demiştim ama 9 olsun", "Giriş 14 değil 15'te olacak", "The cleaner should come at 12 instead of 11", "My son is 11".
    if (!CHECKOUT_CUE.test(sentence) && OTHER_EVENT.test(raw)) continue;
    const tokens = timeTokens(sentence);
    if (tokens.length !== 2) continue;
    const [a, b] = tokens;
    // Yeni saatin KENDİ cümleciği de bir düzeltme / çıkış işareti taşımalı ya da yalnız saatten ibaret olmalı ("10
    // demiştim, 11'de") — ikinci inceleme 09-25: "10 demiştik, değişmedi, 11'de temizlikçi gelebilir" temizlikçinin saatini
    // çıkış yapıyordu.
    const newTimeClauseOk = (at: number) => {
      const clause = clauseAround(sentence, at);
      // Yapamama ve soru/istek cümleciğindeki saat yeni beyan değildir ("11 değil 12'de çıkabilir miyiz?").
      if (DEPARTURE_INABILITY.test(clause) || QUESTION_CLAUSE.test(clause)) return false;
      if (question && sentence.slice(at).search(CLAUSE_SEPARATOR) === -1) return false;
      return CORRECTION_CUE.test(clause) || CHECKOUT_CUE.test(clause) || isTimeOnlyClause(clause);
    };
    // Yeni saat eskisinin gün dilimini miras alır: eski saat öğleden sonraysa işaretsiz yeni saat de öyle okunabilir.
    const readsNew = (t: TimeToken) => t.readings.includes(nextMin) || (prevMin >= 12 * 60 && t.pmAlt === nextMin);
    if (a.readings.includes(prevMin) && readsNew(b) && newTimeClauseOk(b.at)) return true;
    if (b.readings.includes(prevMin) && readsNew(a) && newTimeClauseOk(a.at)) return true;
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

/** Düzeltme yolunda başka bir olayın adı (↑timeCorrectedInMessage; yalnız çıkış ipucu YOKKEN bakılır). */
const OTHER_EVENT =
  /kahvalt|giriş|giris|check[\s-]?in|varış|varis|uçu[sş]|uça[kğ]|tren|otobüs|otobus|feribot|vapur|taksi|transfer|temizlik|yemek|toplantı|randevu|oğl|kız[ıi]m|yaş|breakfast|dinner|lunch|flight|plane|train|bus(?![a-z])|ferry|taxi|cab(?![a-z])|shuttle|clean|tour|meeting|arriv|(?:my|our)\s+(?:son|daughter|kid|child)|years?\s+old|frühstück|flug|zug|petit[\s-]déjeuner|vol(?![a-z])|desayuno|vuelo/;

/** Düzeltme işareti: "10 demiştim ama 11 olacak", "10 yerine 11", "10 değil 11", "instead of 10", "I said 10". */
const CORRECTION_CUE =
  /demişt|dedim|dedik|söylemişt|yazmışt|yerine|değil|degil|olacak|olsun|yapal|çekel|cekel|değiş|degis|instead|said|rather|change|actually|make it|not\s|korrigier|statt|plutôt|au lieu|en vez|en lugar/;

// Sayaç / süre sözcükleri (sayının ARDINDA) ve sıra/numara sözcükleri (ÖNÜNDE): saat değildir. İkinci inceleme 09-25:
// sıra sayısı ("10'unda", "11'inci", "the 11th"), ay adı ("10 Ekim", "10 June") ve yaş ("10 yaşında") da — "10'unda değil
// 11'inde çıkıyoruz" kayıtlı çıkış saatini 10'dan 11'e taşıyordu.
const COUNTER_AFTER =
  /^\s*'?(?:s[ıiuü](?![a-zçğıöşü])|s?[ıiuü]n[dt][ae]|[ıiuü]?nc[ıiuü]|st\b|nd\b|rd\b|th\b|yaş|ocak|şubat|subat|mart|nisan|mayıs|mayis|haziran|temmuz|ağustos|agustos|eylül|eylul|ekim|kasım|kasim|aralık|aralik|jan|feb|mar\b|march|apr|may\b|jun|jul|aug|sep|oct|nov|dec|kişi|kisi|yetişkin|yetiskin|çocuk|cocuk|bebek|misafir|gece|gün|gun|hafta|ay(?!\p{L})|yıl|yil|valiz|bavul|çanta|canta|tane|adet|havlu|çarşaf|carsaf|yastık|yastik|battaniye|şişe|sise|towels?|blankets?|pillows?|bottles?|araba|araç|arac|oda|yatak|dakika|dk(?!\p{L})|saat|kat(?!\p{L})|numara|people|persons?|guests?|adults?|kids?|children|nights?|days?|weeks?|months?|years?|bags?|suitcases?|pieces?|cars?|rooms?|beds?|minutes?|mins?|hours?|hrs?|floors?|%|€|\$|£|₺|tl(?!\p{L})|eur|usd|euro|lira)/u;
const NUMBER_BEFORE =
  /(?:^|\s)(?:oda|kat|daire|no|numara|kapı|kapi|blok|room|floor|apt|apartment|flat|door|number|nr|zimmer|chambre|habitación|habitacion|ayın|ayin|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s*(?:no\.?\s*)?:?\s*$/u;

/**
 * Cümledeki saat belirteçleri — her biri AYRI bir konum, okunuşları (gün içi dakika). Açık saat ("10:00", "6.30 pm")
 * tam okunur (öğleden sonra okunuşu yalnız am/pm yoksa); çıplak tam sayı ("10") ancak tarih/sayaç/numara değilse sayılır.
 */
type TimeToken = { at: number; readings: number[]; pmAlt?: number };
function timeTokens(text: string): TimeToken[] {
  const out: TimeToken[] = [];
  const taken: [number, number][] = [];
  for (const m of text.matchAll(/(?<![\d/.])(\d{1,2})(?:[:.]|h(?=\d{2}))(\d{2})(?![\d/.]*\d)\s*(a\.?m\.?|p\.?m\.?)?/g)) {
    let hh = Number(m[1]);
    const mm = Number(m[2]);
    if (hh > 23 || mm > 59) continue;
    const isPm = m[3]?.startsWith("p") ?? false;
    const isAm = m[3]?.startsWith("a") ?? false;
    const at0 = m.index ?? 0;
    const period = isPm || isAm ? null : dayPeriodOf(beforeOf(text, at0), text.slice(at0 + m[0].length));
    const raw = hh;
    hh = to24(hh, isAm, isPm, period);
    const readings = [hh * 60 + mm];
    if (!isPm && !isAm && !period && !m[1].startsWith("0") && afternoonAlternative(raw)) readings.push((raw + 12) * 60 + mm);
    out.push({ at: at0, readings });
    taken.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
  }
  for (const m of text.matchAll(/(?<![\d:./,])(\d{1,2})(?!\d)(?![:./,]\d)(?!h\d)/g)) {
    const at = m.index ?? 0;
    if (taken.some(([s0, e0]) => at >= s0 && at < e0)) continue;
    const n = Number(m[1]);
    if (n > 23) continue;
    const after = text.slice(at + m[1].length);
    const before = beforeOf(text, at);
    if (COUNTER_AFTER.test(afterHalf(after)) || NUMBER_BEFORE.test(before)) continue;
    // "10 buçuk" = 10:30 (segmentStatesTime ile aynı); çeyrek / "half past" okunmaz — belirteç sayılmaz.
    const half = /^\s*'?\s*bu[çc]uk/.test(after);
    if (!half && (/^\s*'?[a-zçğıöşü]{0,3}\s*[çc]eyrek/.test(after) || /(?:half|quarter)\s+(?:past|to|after|before)\s*$/.test(before))) {
      continue;
    }
    const mm = half ? 30 : 0;
    const isPm = /^\s*p\.?m\.?(?![a-z])/.test(after);
    const isAm = /^\s*a\.?m\.?(?![a-z])/.test(after);
    // "10 demiştim ama akşam 7 olacak": gün dilimi okunuşu sabitler (ikinci inceleme 09-25: 07:00 da kabul ediliyordu).
    const period = isPm || isAm ? null : dayPeriodOf(before, after);
    const readings = [to24(n, isAm, isPm, period) * 60 + mm];
    if (!isPm && !isAm && !period && afternoonAlternative(n)) readings.push((n + 12) * 60 + mm);
    // İşaretsiz çıplak saat, düzeltilen saatin öğleden sonra okunuşunu MİRAS alabilir ("Akşam 10 dedim ama 9 olacak" = 21:00).
    out.push(!isPm && !isAm && !period && n >= 1 && n < 12 ? { at, readings, pmAlt: (n + 12) * 60 + mm } : { at, readings });
  }
  return out.sort((x, y) => x.at - y.at);
}
