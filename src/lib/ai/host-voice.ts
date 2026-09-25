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

/** "X ev sahibinizin kararıdır; mesajınız kaydedildi, ev sahibiniz görebilir." → "X için kontrol edip size dönüş yapacağım." */
const TR_DECISION =
  /(^|[.!?…]\s+|\n)([^.!?…\n]*?)\s+ev sahibinizin kararıdır[;,]\s*(?:mesajınız|talebiniz|isteğiniz)\s+kaydedildi[;,]?\s*(?:ve\s+)?ev sahibiniz görebilir\./gu;
/** "Mesajınız kaydedildi; ev sahibiniz görebilir." → "Mesajınızı aldım; kontrol edip size dönüş yapacağım." */
const TR_RECORDED = /(^|[^\p{L}])(mesajınız|talebiniz|isteğiniz)\s+kaydedildi[;,]?\s*(?:ve\s+)?ev sahibiniz görebilir/giu;
const TR_ACCUSATIVE: Record<string, string> = { mesajınız: "mesajınızı", talebiniz: "talebinizi", isteğiniz: "isteğinizi" };

/** "Whether X is the host's call; your request has been recorded and is visible to your host." */
const EN_DECISION =
  /(^|[.!?]\s+|\n)([^.!?;\n]+?)\s+is the host's call;\s*your (?:request|message|dates) (?:has|have) been recorded and (?:is|are) visible to your host\./gu;
/** "Your message has been recorded and is visible to your host." (cümle başında ya da ";" sonrası) */
const EN_RECORDED = /(^|[.!?;]\s*|\n)(Y|y)our (message|request|dates) (?:has|have) been recorded and (?:is|are) visible to your host\./gu;

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
    .replace(TR_DECISION, (_m, lead: string, subject: string) => `${lead}${subject} için ${TR_FOLLOW_UP}.`)
    .replace(TR_RECORDED, (_m, lead: string, noun: string) => `${lead}${matchCase(`${TR_ACCUSATIVE[noun.toLocaleLowerCase("tr")]} aldım`, noun)}; ${TR_FOLLOW_UP}`)
    .replace(EN_DECISION, (_m, lead: string, subject: string) => `${lead}I'll check ${lowerFirst(subject.trim())} and get back to you.`)
    // "I" büyük kalır (";" sonrasında da): cümle ev sahibinin birinci tekil sesiyle başlar.
    .replace(EN_RECORDED, (_m, lead: string, _y: string, noun: string) =>
      `${lead}${noun === "dates" ? "I've noted your dates" : `I've received your ${noun}`} and will get back to you shortly.`,
    );
}
