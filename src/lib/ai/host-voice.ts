// ---------------------------------------------------------------------------
// TASLAK = EV SAHİBİNİN SESİ (09-25, kurucu: "müşteriye gitmiyor, ev sahibine taslak — neden 'ev sahibiniz görebilir'
// yazıyor?"). SAF: DB/ağ yok.
//
// Cevap modeli tek bir metin yazar ve kapı onu SONRA değerlendirir: metin misafire otomatik gidebilir, bu yüzden
// istem ona dürüst DEVİR cümlesini öğretir ("mesajınız kaydedildi; ev sahibiniz görebilir" — AI "ilettim" diyemez,
// makbuzu yok). Ama aynı metin ev sahibine TASLAK olarak gösterildiğinde (gelen kutusu önerisi, Ayarlar önizlemesinde
// gönderilmeyecek cevap) altında EV SAHİBİNİN imzası vardır ve üçüncü şahıs cümlesi anlamsızdır.
//
// Kural: YALNIZ ev sahibine gösterilen metinde, istemin öğrettiği KALIP cümleler ev sahibinin ağzına çevrilir. Kapı,
// müsaitlik kontrolü ve erken giriş akışı ORİJİNAL metne bakar (erteleme tanıma bu kalıba dayanır); otomatik giden
// mesaj ve QR sohbeti bu fonksiyondan GEÇMEZ. Tanınmayan biçim (başka dil, serbest anlatım) olduğu gibi kalır — ev
// sahibi zaten düzenleyip kendisi gönderir.
// ---------------------------------------------------------------------------

const TR_FOLLOW_UP = "kontrol edip size dönüş yapacağım";

// 🚨 GERİ İZLEME (inceleme 09-25): özne kalıbı BOŞLUKSUZ bir karakterle başlar ve özneyle kalıp arasında TEK boşluk
// aranır — ardışık `\s+ … \s+` zinciri 4.000 karakterlik boşluk dolu taslakta kübik geri izlemeydi. Özne içinde
// "13.00" gibi saat noktası cümle sonu sayılmaz (`\.(?=\d)`). Kalıp öncesi `\s+` (mutasyon R10) yalnız KARESEL kalır ve
// 4.000 karakter tavanında hızlıdır — yani tek boşluk bir güvenlik değil sadelik seçimidir (çift boşluklu nadir biçim çevrilmez).
const SUBJECT = String.raw`(\S(?:[^.!?…\n]|\.(?=\d))*?)`;
// ";"/"," sonrasında gelir → küçük harf (büyük "İsteğiniz" yalnız cümle başındaki TR_RECORDED biçiminde).
const NOUN_TR = "(?:mesajınız|talebiniz|isteğiniz)";

/** "X ev sahibinizin kararıdır; mesajınız kaydedildi, ev sahibiniz görebilir." → "X için kontrol edip size dönüş yapacağım." */
const TR_DECISION = new RegExp(
  String.raw`(^|[.!?…]\s+|\n)${SUBJECT}\sev sahibinizin kararıdır[;,]\s*${NOUN_TR}\s+kaydedildi[;,]?\s*(?:ve\s+)?ev sahibiniz görebilir\.`,
  "gu",
);
/** "Mesajınız kaydedildi; ev sahibiniz görebilir." → "Mesajınızı aldım; kontrol edip size dönüş yapacağım." */
const TR_RECORDED = /(^|[^\p{L}])(mesajınız|talebiniz|[iİ]steğiniz)\s+kaydedildi[;,]?\s*(?:ve\s+)?ev sahibiniz görebilir/giu;
const TR_ACCUSATIVE: Record<string, string> = { mesajınız: "mesajınızı", talebiniz: "talebinizi", isteğiniz: "isteğinizi" };

/**
 * "Bu ev sahibinizin kararıdır" (istemin kendi örneği; ";"/","dan sonra da: "…bağlı; bu ev sahibinizin kararıdır")
 * → "Bunu kontrol edip …" ("Bu için" bozuk Türkçe).
 */
function trFollowUp(subject: string): string {
  const bare = /(^|[;,:]\s+)([bB])u$/u.exec(subject);
  return bare
    ? `${subject.slice(0, bare.index)}${bare[1]}${bare[2]}unu ${TR_FOLLOW_UP}`
    : `${subject} için ${TR_FOLLOW_UP}`;
}

/** Cevabın başındaki selam/hitap ("Hi Anna, …") — EN_DECISION öznesine katılmaz. */
const EN_GREETING = /^(?:hi|hello|hey|dear|good (?:morning|afternoon|evening))\b[^,]{0,40},\s/iu;

/** "Whether X is the host's call; your request has been recorded and is visible to your host." */
const EN_DECISION =
  /(^|[.!?]\s+|\n)(\S[^.!?;\n]*?)\sis the host's call;\s*your (?:request|message|dates) (?:has|have) been recorded and (?:is|are) visible to your host\./gu;
/** "Your message has been recorded and is visible to your host." (cümle başında ya da ";" / "," sonrası) */
const EN_RECORDED =
  /(^|[.!?;,]\s*|\n)(Y|y)our (message|request|dates|report) (?:has|have) been recorded and (?:is|are) visible to your host\./gu;

/**
 * Cevapta istemin DEVİR / KAYIT cümlesi var mı ("Mesajınız kaydedildi; ev sahibiniz görebilir." · "Your request has been
 * recorded and is visible to your host."). Konuşma öğeleri kapısı okur: bırakılan bir istek için misafire otomatik
 * "kaydedildi" GİTMEZ (kurucu 09-26). Yalnız istemin öğrettiği iki dildeki KALIP tanınır (serbest anlatım / başka dil
 * bilinen sınır — birincil koruma cevap modelinin beyanı + istem kuralı). `search` genel bayraklı kalıbın `lastIndex`ine
 * dokunmaz (durumsuz).
 */
export function hasRecordedHandoff(reply: string): boolean {
  return reply.search(TR_RECORDED) !== -1 || reply.search(EN_RECORDED) !== -1;
}

const lowerFirst = (s: string) => (s ? s[0].toLocaleLowerCase("en") + s.slice(1) : s);

function matchCase(template: string, sample: string): string {
  return sample[0] === sample[0].toLocaleUpperCase("tr") && sample[0] !== sample[0].toLocaleLowerCase("tr")
    ? template[0].toLocaleUpperCase("tr") + template.slice(1)
    : template;
}

/** Ev sahibine gösterilecek taslak: istemin devir kalıpları ev sahibinin ağzına çevrilir; gerisi aynen. */
export function hostVoiceDraft(reply: string): string {
  if (!reply) return reply;
  return reply
    .replace(TR_DECISION, (_m, lead: string, subject: string) => `${lead}${trFollowUp(subject)}.`)
    .replace(TR_RECORDED, (_m, lead: string, noun: string) => `${lead}${matchCase(`${TR_ACCUSATIVE[noun.toLocaleLowerCase("tr")]} aldım`, noun)}; ${TR_FOLLOW_UP}`)
    .replace(EN_DECISION, (_m, lead: string, subject: string) => {
      // Selam/hitap öneki ("Hi Anna, whether …") öznede kalmaz, olduğu gibi korunur.
      const prefix = EN_GREETING.exec(subject)?.[0] ?? "";
      const what = subject.slice(prefix.length);
      return `${lead}${prefix}I'll check ${lowerFirst(what.trim())} and get back to you.`;
    })
    // "I" büyük kalır (";" sonrasında da): cümle ev sahibinin birinci tekil sesiyle başlar.
    .replace(EN_RECORDED, (_m, lead: string, _y: string, noun: string) =>
      `${lead}${noun === "dates" ? "I've noted your dates" : `I've received your ${noun}`} and will get back to you shortly.`,
    );
}
