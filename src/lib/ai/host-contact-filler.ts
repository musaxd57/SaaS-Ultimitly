// ---------------------------------------------------------------------------
// "EV SAHİBİNİZE YAZIN / ARAYIN" MİSAFİRE YAZILMAZ — HER DİLDE, HER BİÇİMDE (kurucu kararları R13-b / R13-c 10-28 gece ve K-1029-A/B/C
// 10-29 gece; aynen `docs/INCELEME-2026-10-28-gece-dongusu.md` 10-29 bölümü, tasarım `docs/TASARIM-2026-10-29-ev-sahibine-yonlendirme-yasagi.md`):
//   "zaten hostla yazışıyorlar" · "cümle silinir, doğru cevap gider, cevapsız soru AÇIK kalır, asla 'cevaplandı' değil" · GD5: "yalnız
//   talimat yan cümlesi silinir, bilgi gider" (geçici) · "ek / koşul eki sezgileri karar vermesin, anlamı model okusun".
//
// Kural (saf; `suggestReply` cevabın SON adımında çağırır → kanal, QR, "AI öner", Ayarlar testi, demo aynı):
//   · Misafiri ev sahibine yazmaya / ulaşmaya / aramaya / sormaya gönderen HER cümle çıkar (`hostContactKindOf`: bilgi yönlendirmesi,
//     koşullu başvurma, yedi dilli başvurma + ev sahibinin sesiyle "bize yazın"; ev sahibi bir önceki cümlede anıldıysa zamirle "message him").
//     "Yazın" hiçbir koşulda kalmaz.
//   · ÜÇ TÜR silme (v3, Opus v2 incelemesi 10-30 — kurucunun konu bazlı "bilgim yok" kuralının 4. maddesiyle aynı ilke: "kalan cümleler düşen
//     isteğin konusuna değinmesin, yarım tarif kalmasın"):
//       – GENEL KAPANIŞ ("Herhangi bir sorunda ev sahibinize yazın", "Feel free to message your host", "Diğer sorularınız için …"): yalnız o
//         çıkar, cevap gider (R13-b/c).
//       – KONULU ("Kuaför için ev sahibiniz bilgi verebilir"): çıkar; kalan metin O KONUYA HİÇ değinmiyorsa gider (soru size açık kalır),
//         değiniyorsa ("Sanırım sauna 22'ye kadar açık. Ev sahibinize teyit edin.") cevabın TAMAMI tutulur.
//       – KONUSUZ / GÖNDERGESEL ("Detaylar için", "Bu konuda", "about it", "If you need them", koşulsuz "Please contact your host"): neyin
//         cevapsız kaldığı belli değil → cevabın TAMAMI tutulur (eski "yönlendirme = bilgim yok" davranışı).
//   · "Arayın" model sinyali olmadan TUTULMAZ (K-1029-C). Tek istisna GÜVENLİK: tehlike / acil numara aynı koşul zincirindeyse ("Gaz kokusu
//     alırsanız 112'yi arayın ve ev sahibinize ulaşın") "arayın" kalır. Güvenlik cümlesinde yazma / sorma / iletişim yan cümlesi çıkar, ADIMLAR
//     kalır; başvurmadan SONRA adım varsa ya da temiz ayrılamıyorsa cevabın TAMAMI tutulur (taslak da boş — adım sessizce düşmez).
//   · GD5 yan cümle: koşulsuz baş yan cümle(ler) bilgi taşıyorsa kalır, ilk koşul / talimat yan cümlesinden sonuna kadar çıkar. Kısıtlayan
//     kuyruk ("but only if you message your host") baş kısmı koşulsuz izne çevireceği için bütün cümle çıkar. İki nokta sınır değildir; baş
//     kısım yalnız konu etiketi ("For the sauna", "Regarding …", "Sauna için", "Otoparka gelince") ya da nezaketse bütün cümle çıkar.
//   · Satır sonuyla bölünmüş cümle önce birleştirilir; gövdesi silinen başlık / koşul başlığı ("**Parking**", "If the Wi-Fi stops working:"),
//     boş liste numarası, "P.S.", yalnız emoji de düşer.
//   · Çıkan her parçanın kaydı (`removals`): tür, biçim, yan cümle mi, ayırt edici kökler, konu, genel mi — METİN YOK.
//   · Cevabın TAMAMI tutulur (`nothingLeft`, metne dokunulmaz) ayrıca: selam / nezaket dışında içerik kalmadıysa, kalan metin belirsizlik /
//     tahmin / yetersizlik / ret / özür / "ev sahibinin kararı" söylüyorsa ya da bir devir / görünürlük bildirimi taşıyorsa (K10). O zaman TASLAK
//     (`draft`) silinmiş metindir — yasaklı cümle "AI öner"e / hazır taslağa yazılmaz.
// Misafire yeni söz EKLENMEZ; yalnız ÇIKARILIR. Kalan metin bütün kapılardan yine geçer. Doğrusal.
// ---------------------------------------------------------------------------

import {
  hostContactKindOf,
  isConditionLikeClause,
  mentionsBusiness,
  mentionsHostOnly,
  namesCallContact,
  namesWriteContact,
  pronounHostContactKind,
  withBusinessOwnerContext,
  type HostContactKind,
} from "./absence";
import { contentStemsOf, isSubstantiveSentence, replySentencesOf } from "./no-instruction-filler";
import { carriesHandoffNotice, vetoOutgoingReply } from "./output-veto";
import { defersDecisionToHost } from "./availability-claims";
import { isGreetingOnly } from "./code-greeting";
import { distinctiveTokens, overlapLoose } from "@/lib/conversation-items/topic-absence";
import { topicsWithSymptomsOf } from "@/lib/conversation-items/relation";

/**
 * Güvenlik uyarısı: gerçek tehlike / acil servis sözcüğü taşıyan cümle (genel "acil durumda ev sahibinizi arayın" kapanışı DEĞİL).
 * GD9 (gece döngüsü 10-29): Türkçe gövdeler tehlike sözcüğüne benzeyen adları dışlar — gazete / gazino / gazoz / gazi (Gaziantep), polisaj /
 * polisiye / polister, karbonat. K-1029-A: "Fire TV / Fire Stick", "gas station", "smoke-free" de uyarı değildir. Opus F3 (10-30): cihaz / fatura
 * adı ("gaz ocağı", "gas stove", "gas bill", "fire extinguisher", "smoke alarm battery") tehlike değildir; acil NUMARA çıplak sayı olarak
 * sayılmaz (otopark 110, oda 112, 155 TL) — yalnız arama yönergesiyle ya da acil sözcüğüyle. Opus v2 incelemesi (10-30): su kaçağı / su
 * basması / elektrik çarpması / kıvılcım / kısa devre de güvenlik adımıdır ("ana vanayı kapatın", "sigortayı indirin" sessizce düşmesin).
 */
const SAFETY_HAZARD =
  /(?<![\p{L}\p{N}])(?:gaz(?!ete|ino|oz|i|l[ıi])(?!\s+(?:oca[kğ]|soba|f[ıi]r[ıi]n|fatura|sayac))\p{L}{0,8}|gas(?!\s*(?:station|stove|cooker|hob|oven|burner|grill|bbq|barbecue|bill|meter|price))|yang[ıi]n(?!\s+(?:t[üu]p|s[öo]nd[üu]r))\p{L}{0,8}|fire(?!\s*(?:tv|stick|place|pit|wood|extinguisher|blanket))|duman\p{L}{0,8}(?!\s+(?:dedekt[öo]r\p{L}*\s+)?pil)|smoke(?![-\s]?free)(?!\s+(?:alarm|detector)\s+batter)|karbon(?!at)\p{L}{0,8}|carbon monoxide|co (?:alarm|detector)|monoxyde de carbone|mon[óo]xido de carbono|угарн\p{L}{0,4}|gas(?:geruch|leck\p{L}{0,2}|austritt|alarm)|kohlenmonoxid\p{L}{0,2}|(?:rauch|brand|feuer|co-?)melder\p{L}{0,2}|itfaiye\p{L}{0,8}|ambulans\p{L}{0,8}|ambulance|polis(?!aj|iye|ter)\p{L}{0,8}|police|feuer(?!zeug|stelle|l[öo]scher)|rauch(?!er|en)|incendie|fumée|incendio|humo|пожар\p{L}{0,4}|газ(?!ет)\p{L}{0,4}|дым\p{L}{0,4}|su ka[çc]\p{L}{0,8}|su bas\p{L}{0,8}|sel(?:\s+bask[ıi]n\p{L}*)|elektrik [çc]arp\p{L}{0,8}|[çc]arp[ıi]l\p{L}{0,8}|k[ıi]v[ıi]lc[ıi]m\p{L}{0,4}|k[ıi]sa devre|water leak\p{L}{0,3}|leak\p{L}{0,3}|flood\p{L}{0,3}|electric(?:al)? shock|shock|spark\p{L}{0,3}|short circuit|wasserschaden|rohrbruch|wasser (?:tritt aus|austritt|l[äa]uft aus)|wenn wasser austritt|überschwemm\p{L}{0,4}|stromschlag|funken|kurzschluss|fuite|inondation|d[ée]charge [ée]lectrique|[ée]tincelle\p{L}{0,2}|court-circuit|fuga\p{L}{0,2}|inundaci[óo]n|descarga el[ée]ctrica|chispa\p{L}{0,2}|cortocircuito|протечк\p{L}{0,2}|затоп\p{L}{0,4}|удар\p{L}{0,2} током|искр\p{L}{0,3}|замыкани\p{L}{0,2}|burning (?:smell|odou?r)|smell of burning|smells? (?:like )?burning|exposed wir\p{L}{0,3}|bare wir\p{L}{0,3}|overheat\p{L}{0,3}|scorch\p{L}{0,3}|yan[ıi]k koku\p{L}{0,3}|a[çc][ıi]kta (?:kalan )?kablo\p{L}{0,3}|a[şs][ıi]r[ıi] [ıi]s[ıi]n\p{L}{0,6}|verbrannt riech\p{L}{0,2}|riecht verbrannt|brandgeruch|(?:freiliegende|blanke) kabel|[üu]berhitz\p{L}{0,4}|odeur de br[ûu]l[ée]|fils? d[ée]nud[ée]s?|surchauff\p{L}{0,4}|olor a quemado|cables? (?:pelados?|expuestos?)|sobrecalent\p{L}{0,4}|запах гари|горел\p{L}{0,3}|оголённ\p{L}{0,3}|оголенн\p{L}{0,3}|перегрев\p{L}{0,3})(?![\p{L}\p{N}])/iu;
/** Arapça tehlike sözcükleri (belirlilik öneki "ال" sözcüğe bitişik — Latin sözcük sınırı burada işlemez; v3 yeniden incelemesi SAFE-4). */
const SAFETY_HAZARD_AR = /رائحة\s+(?:ال)?غاز|تسرب\s+(?:ال)?غاز|(?:ال)?دخان|(?:ال)?حريق|إنذار|انذار|تسرب|ماس كهربائي|صعق|شرار|أول أكسيد الكربون|رائحة حريق|ارتفاع حرارة/u;
const EMERGENCY_NUMBER = new RegExp(
  "(?:(?<![\\p{L}])(?:call|dial|ring|phone|ara(?:y[ıi]n(?:[ıi]z)?|yabilirsiniz|man[ıi]z)?|r[uü]fen sie|w[äa]hlen sie|appelez|composez|llame|marque|звоните|позвоните|наберите)" +
    "(?:\\s+(?:the|die|le|el|номер|number|numaras[ıi]))?\\s+" +
    "|(?<![\\p{L}])(?:acil(?:\\s+durum\\p{L}{0,4})?|emergency|emergencies|notfall|notruf|urgence|urgences|emergencia|экстренн\\p{L}{0,4})[\\p{P}\\s]+(?:\\p{L}+\\s+){0,2}?)" +
    "(?:112|911|110|155|187|999)(?![\\p{N}])" +
    // Sayıdan sonra TEK boşluk niceleyicisi (v3 yeniden incelemesi COST-2: `\s*['’]?\s*X?\s+` boşluk dizisinde kübikti).
    "|(?<![\\p{N}])(?:112|911|110|155|187|999)(?:['’]?(?:y[ıi]|ye|ya|[ıi]))?\\s+(?:ara\\p{L}{0,8}|ula[şs]\\p{L}{0,8}|call|dial)",
  "iu",
);

export function isSafetyWarningSentence(sentence: string): boolean {
  return SAFETY_HAZARD.test(sentence) || SAFETY_HAZARD_AR.test(sentence) || EMERGENCY_NUMBER.test(sentence);
}

/**
 * Çıkarılan parçada sayılmayan köklerin başlangıçları (katlanmış ASCII, aksansız): ev sahibi adları, iletişim fiilleri, genel sorun / koşul /
 * nezaket sözcükleri, yedi dilin işlev sözcükleri. Kalan kök yoksa parça KONUSUZDUR. Karşılaştırma aksanı / Kiril büyük-küçük harfi katlayarak
 * yapılır (Opus F12).
 */
const HOST_CONTACT_NOISE = (
  "sahib evsah host owner landl hostes gastgeb vermiet eigent hote propri anfitr duen хозя владел арендод мне нам مضيف مالك " +
  "yaz mesaj ara ulas haber bild iletis irtib danis sor yeniden tekrar call phon ring messag text writ mail email contact reach touch let know " +
  "inform drop line note send ask check notif schreib kontakt ruf meld wend benach inform ecriv contac appel joign preven envoy adress " +
  "escrib llam contact comuniq pong envi avis напиш позвон свяж сообщ обрат пиши звони дайте знать راسل تواصل اتصل اكتب ارسل " +
  "sorun sikint problem aksil herhangi bir sey seyi ihtiyac olur olursa durum durumd husus konu feel free hesit anyth somet wrong issue " +
  "need question happen come comes went break come any fragen falls wenn zogern bitte gern direkt einfach besoin cas hesitez toute quest " +
  "dude cualq caso algo si если случа любы вопрос что-то что нибудь возник اذا حال تتردد " +
  "lutfen please kindly rica dilerseniz isterseniz memnun happy glad help yardim keyif enjoy stay konakl hosca iyi gunler days " +
  // Varış koşulu ("Varınca ev sahibinizi arayın", "Upon arrival, call your host") konu değildir.
  "varin varis vardi gelin gelince geldig arriv upon ankunf ankomm llegad llegue llegar arrivee приезд приед وصول " +
  // Genel olasılık / süre / arıza fiilleri ("Konaklamanız boyunca bir sorun yaşarsanız", "Acil bir durumda", "çalışmazsa") konu değildir.
  "boyunca yasar yasan during throughout while acil emerg urgent calis work funktion fonction funcion работ gerek " +
  // Opus F12: işlev sözcükleri / zarflar / kip çekimleri ("Bei Fragen schreiben Sie bitte Ihrem Gastgeber", "Si tiene algún problema",
  // "iletişime geçebilirsiniz", "contact your host directly", "via the Airbnb app") konu değildir.
  "bei ihre ihrem ihren ihrer sie uns mir jederzeit gerne votre vos nous moi tout tiene tienes algun usted nos вам вашему ваш " +
  "gecebil atabil ulasabil yazabil arayabil sorabil danisabil bildireb direct right away immediat anytime via app airbnb booking platform " +
  "out more further fazla daha detai detay bilgi info ayrint diger baska other else weitere andere autre otra otro друг " +
  "latest current guncel aktuell actuel actualiz always here burada " +
  // Yer / konum zamiri ("yerleri için ev sahibiniz bilgi verebilir", "for their location") önceki cümlenin konusuna gönderir.
  "yer place locat where nerede " +
  // Zamirle gönderme ("message him", "ona yazın", "schreiben Sie ihm", "écrivez-lui", "напишите ему") — zamir konu değildir.
  "him her them ona kendisi onlar ihm lui leur ему ей им нему ней just einfach понадоб " +
  // v4: yeni iletişim fiilleri / seslenilenler (konu değildir).
  "coordin arrang report rais mention flag discuss sort settl confirm verif check double request keep updat posted loop team staff ekib " +
  "cohost co-host klar klaer sprech rucksp stimm halten aktar haberd rica talep renseign verifi parl pose joign comuniq pregunt avis dej " +
  "уточн спрос предупред напрям استفسر راجع أخطر اخطر أخبر اعلم أعلم equipe equipo " +
  "stop stopp surg aparec ocurr passiert happen arise"
).split(" ");
/** Aksan / Kiril harfi katlanmış küçük biçim (tek geçiş). */
function foldToken(t: string): string {
  return t.toLocaleLowerCase("tr").normalize("NFKD").replace(/\p{M}/gu, "").replace(/ı/g, "i");
}
function isNoiseStem(t: string): boolean {
  const f = foldToken(t);
  return HOST_CONTACT_NOISE.some((n) => f === n || (n.length >= 3 && f.startsWith(n)));
}

/**
 * Yönlendirme sözcükleri konu değildir: "bu konuda / konusunda / hakkında / about this / dazu" (Opus F11: sözlük "konuda"yı `konum` →
 * ADRES konusuna çeviriyordu). "konum" (yer) dışarıda.
 */
const REFERRAL_MARKER_WORDS = /(?<![\p{L}])(?:konu(?!m)\p{L}{0,8}|hakk[ıi]nda|ilgili)(?![\p{L}])/giu;

/** Ayrıntı / bilgi isteyen yönlendirme ("Detaylar için", "for more information", "für weitere Informationen") — konu cevapsız kalmıştır. */
const DETAIL_MARKER =
  /(?<![\p{L}])(?:detay\p{L}{0,8}|ayr[ıi]nt\p{L}{0,8}|bilgi\p{L}{0,8}|details?|info|information|specifics?|einzelheiten|infos|informationen|d[ée]tails?|pr[ée]cisions?|renseignements?|detalles?|informaci[óo]n|подробн\p{L}{0,6}|информаци\p{L}{0,4}|تفاصيل|معلومات)(?![\p{L}])/iu;

/**
 * Göndergesel yönlendirme ("If you have any questions ABOUT IT", "If you need THEM", "Bu konuda bir sorunuz olursa", "Saatleriyle ilgili",
 * "about the opening times") koşul izi taşısa da GENEL kapanış değildir — önceki cümlenin konusuna gönderir (Opus v2 incelemesi launder-02).
 * "about your stay" gibi konaklama geneli göndergesel sayılmaz.
 */
const ANAPHORIC_MARKER =
  /(?<![\p{L}])(?:it|them|this(?! (?:stay|visit|trip|time|apartment|flat|property|week))|that|these|those|about (?:the|your)(?! (?:stay|visit|trip))|if you need (?:it|them|this|that|one)|should you (?:need|want|wish) (?:it|them|this|that|one)|regarding (?:the|your)(?! (?:stay|visit|trip))|bu|bunu|bunun|bunlar\p{L}{0,4}|bununla|şu|onu|onlar\p{L}{0,4}|ilgili|hakk[ıi]nda|konu\p{L}{0,8}|dazu|dar[üu]ber|davon|damit|diesbez[üu]glich|[àa] ce sujet|[àa] ce propos|en avez|esto|eso|ello|al respecto|это\p{L}{0,2}|этом|их|него|ней|них|ذلك|هذا|هذه)(?![\p{L}])/iu;

/**
 * İHTİYAÇ GÖNDERMESİ ("if needed / isterseniz / gerekirse / si besoin / bei Bedarf / при необходимости / عند الحاجة"): kapanış önceki
 * cevaba bağlanır ama kendi başına GENEL kapanıştır ("Wi-Fi şifresi … Si besoin, envoyez-nous un message." → şifre gider). Kalan metin
 * belirsizlik ("temizlik programına bağlı", "depends on") ya da izin ("Erken giriş mümkün") söylüyorsa silme onu kesin / koşulsuz bir cevaba
 * çevirirdi → cevabın tamamı tutulur (v3 yeniden incelemesi SETTLE-01; sonda `needReferenceRemoved`).
 */
const NEED_REFERENCE =
  /(?<![\p{L}])(?:if (?:needed|necessary|required|so|desired)|if you(?:['’]d like| (?:want|wish|prefer|would like))(?! (?:anything|something|more|other|further|help))|gerekirse|gerekiyorsa|gerekli g[öo]r[üu]rseniz|isterseniz|dilerseniz|arzu ederseniz|uygun g[öo]r[üu]rseniz|falls n[öo]tig|bei bedarf|wenn n[öo]tig|falls gew[üu]nscht|wenn gew[üu]nscht|wenn sie m[öo]chten|falls sie m[öo]chten|si besoin|si n[ée]cessaire|au besoin|si vous le souhaitez|si vous souhaitez|si vous le d[ée]sirez|si vous voulez|si lo necesita|si lo necesitas|si es necesario|de ser necesario|si lo desea|si lo deseas|si desea|si quiere|si gusta|при необходимости|если нужно|если необходимо|если хотите|по желанию|если потребуется|عند الحاجة|إذا رغبت|اذا رغبت|إذا أردت|اذا اردت|إن أردت)(?![\p{L}])/iu;

/** "Diğer / başka sorularınız için …" — yönlendirme belli bir isteği değil GERİ KALANI anar (genel kapanış). */
const OTHER_MARKER = /(?<![\p{L}])(?:diğer|diger|başka|baska|other|else|weitere\p{L}{0,2}|andere\p{L}{0,2}|autres?|otras?|otros?|друг\p{L}{0,4}|أخرى|اخرى)(?![\p{L}])/iu;

/** Güvenlik talimatının devam cümlesi ("Then …", "Ardından …", "Danach …"). */
const SAFETY_CONTINUATION =
  /^\s*(?:then|after that|afterwards|next|also|ardından|sonra|daha sonra|ayrıca|danach|dann|anschließend|ensuite|puis|après|luego|después|затем|потом|после этого|ثم|بعد ذلك)(?![\p{L}])/iu;
/** Silinen bilgi yönlendirmesi kendi konusuyla / karşıtlıkla başlıyor ("…, but for the sauna hours …", "…, sauna saatleri için ise …"). */
const OWN_TOPIC_TAIL =
  /^[\s,;]*(?:but|however|though|ama|fakat|ancak|aber|jedoch|mais|cependant|pero|sin embargo|но|однако|لكن)(?![\p{L}])|(?<![\p{L}])(?:i[çc]in ise|ise)(?![\p{L}])/iu;
/**
 * TEYİT / DOĞRULAMA isteyen yönlendirme ("teyit edin", "confirm with your host", "уточните", "klären Sie") kalan bilgiyi belirsiz kılar: silinirse
 * tahmin kesin gibi giderdi → konulu / göndergesel silmede cevabın tamamı tutulur. "Detaylar için / for more information" ise belirsizlik
 * değil, eksik kalan ayrıntıdır: kalan bilgi gider, soru ev sahibine açık kalır (kurucu 10-30: "'Binada sauna var.' gitsin").
 */
const CONFIRM_MARKER =
  /(?<![\p{L}])(?:teyit\p{L}{0,14}|do[ğg]rula\p{L}{0,14}|onayla\p{L}{0,14}|kesinle[şs]tir\p{L}{0,14}|netle[şs]tir\p{L}{0,14}|emin ol\p{L}{0,14}|kontrol (?:et|edin|edebilirsiniz|ettirin)\p{L}{0,14}|dan[ıi][şs]\p{L}{0,14}|confirm\p{L}{0,14}|verif\p{L}{0,14}|double-?check\p{L}{0,14}|check with|make sure|clarif\p{L}{0,14}|best[äa]tig\p{L}{0,14}|abkl[äa]r\p{L}{0,14}|kl[äa]ren|vergewisser\p{L}{0,14}|nachfrag\p{L}{0,14}|v[ée]rifi\p{L}{0,14}|pr[ée]cis\p{L}{0,14}|aclar\p{L}{0,14}|aseg[úu]r\p{L}{0,14}|consult\p{L}{0,14}|уточн\p{L}{0,14}|подтверд\p{L}{0,14}|подтвержд\p{L}{0,14}|провер\p{L}{0,14}|تأكد|تأكيد|التحقق|استفسر)(?![\p{L}])/iu;
/** Genel sorun / ihtiyaç kapanışı ("Bir şeye ihtiyacınız olursa haber vermeniz yeterli") ön koşul değildir. */
const HC_TROUBLE_CONTINGENCY =
  /(?<![\p{L}])(?:sorun\p{L}{0,6}|s[ıi]k[ıi]nt[ıi]\p{L}{0,6}|problem\p{L}{0,6}|ihtiya[çc]\p{L}{0,8}|bir [şs]ey\p{L}{0,4}|herhangi bir|anything|something|any (?:questions?|issues?|problems?)|problems?|issues?|questions?|fragen|probleme?n?|besoin|probl[èe]mes?|algo|problemas?|preguntas?|вопрос\p{L}{0,3}|что-(?:то|нибудь)|проблем\p{L}{0,3})(?![\p{L}])/iu;
/** Arıza / bozulma olasılığı ("if it doesn't work", "if anything breaks", "çalışmazsa", "funktioniert … nicht") — kapanış izi. */
const FAILURE_CONTINGENCY =
  /(?<![\p{L}])(?:(?:does ?n['’]?t|does not|do ?n['’]?t|do not|won['’]?t|will not|is ?n['’]?t|is not) work(?:ing)?|stops? working|fails?|breaks?(?: down)?|goes wrong|çal[ıi][şs]mazsa|olmazsa|a[çc][ıi]lmazsa|bozulursa|funktioniert (?:\p{L}+ )?nicht|ne fonctionne pas|no funciona|не работает|لا يعمل)(?![\p{L}])/iu;
/** Varış koşulu ("Varınca / Upon arrival / Bei Ankunft") genel kapanış izidir (konu değil). */
const ARRIVAL_MARKER =
  /(?<![\p{L}])(?:var[ıi]nca|vard[ıi][ğg][ıi]n[ıi]zda|geldi[ğg]inizde|gelince|upon arrival|on arrival|when you arrive|bei ankunft|nach (?:ihrer )?ankunft|[àa] votre arriv[ée]e|al llegar|по приезд\p{L}*|عند الوصول)(?![\p{L}])/iu;

export interface HostContactRemoval {
  kind: HostContactKind;
  /** Bilgi yönlendirmesi ("… için ev sahibinize sorabilirsiniz") ya da koşullu / kapanış başvurması. */
  form: "referral" | "conditional";
  /** Cümlenin bir yan cümlesi çıkarıldı (bilgi taşıyan baş kısım kaldı). */
  appendix: boolean;
  /** Çıkan parçanın (ya da göndergesel yönlendirmede önceki cümlenin) ayırt edici kökleri (ev sahibi / iletişim / genel sorun sözcükleri hariç). */
  stems: string[];
  /** Çıkan parçanın sözlük konuları (yönlendirme sözcükleri hariç). */
  topics: string[];
  /** Hiçbir isteğe ait olmayan genel kapanış ("Herhangi bir sorunda ev sahibinize yazın.", "Diğer sorularınız için ev sahibinize yazın."). */
  generic: boolean;
}

export interface HostContactAnalysis {
  /** Gönderilecek metin (hiçbir şey çıkmadıysa ya da `nothingLeft` ise birebir aynı). */
  text: string;
  removals: HostContactRemoval[];
  /** Kapı cevabın TAMAMINI tutar (yukarıdaki şartlar). */
  nothingLeft: boolean;
  /**
   * Ev sahibinin taslağı: başvurma cümleleri ÇIKARILMIŞ metin (`nothingLeft` iken de; selamdan ibaret kalırsa ya da bir güvenlik adımı temiz
   * ayrılamadığı için tutulduysa BOŞ — tek tıkla adımsız metin gönderilmesin). Yasaklı cümle taslağa yazılmaz (tasarım A3 / S9, Opus F10).
   */
  draft: string;
}

/**
 * closing = genel kapanış · topical = konulu bilgi yönlendirmesi (kalan metin konuya değinirse tutulur) · contingent = konulu OLASILIK kapanışı
 * ("If the Wi-Fi fails, message your host" — kalan Wi-Fi şifresi doğru cevaptır; olasılık sorusunu "cevaplandı" kuralı açık tutar) ·
 * anaphoric = konusuz / göndergesel (cevabın tamamı tutulur).
 */
type RemovalScope = "closing" | "topical" | "contingent" | "anaphoric";

/** Çıkan parça → kayıt + tür. Selam ve hitap adı (misafirin adı) kök sayılmaz (Opus P3-f). */
function removalOf(
  kind: HostContactKind,
  removed: string,
  appendix: boolean,
  previous: string | null,
  /** Güvenlik kesiminde silinen kuyruk ("… and message your host"): koşulu ve konusu kalan güvenlik talimatındadır → kapanış. */
  forceClosing = false,
  /** Madde satırının başlığı ("If the Wi-Fi stops working:" / "**Parking**") — maddenin koşulu / konusu odur. */
  lead: string | null = null,
  /** Aynı önceki cümle birçok silmede yeniden okunmasın (v3 yeniden incelemesi COST-3: karesel). */
  cache: Map<string, { stems: string[]; topics: string[] }> | null = null,
): { removal: HostContactRemoval; scope: RemovalScope; confirms: () => boolean } {
  const form = kind === "referral" ? "referral" : "conditional";
  const read = (text: string) => {
    const hit = cache?.get(text);
    if (hit) return { stems: [...hit.stems], topics: [...hit.topics] };
    const body = withoutLeadingSalutation(text);
    const stems = distinctiveTokens(body).filter((t) => !isNoiseStem(t));
    const topics = topicsWithSymptomsOf(body.replace(REFERRAL_MARKER_WORDS, " "));
    cache?.set(text, { stems, topics });
    return { stems: [...stems], topics: [...topics] };
  };
  const scoped = lead ? `${lead.replace(/\*+/gu, "").replace(/:\s*$/u, ",")} ${removed}` : removed;
  // İşaretler hem özgün hem Türkçe küçük harfli biçimde aranır ("İsterseniz" büyük İ ile /i bayrağında "isterseniz" olmaz).
  const scopedForms = [scoped, scoped.toLocaleLowerCase("tr")];
  const has = (re: RegExp) => scopedForms.some((f) => re.test(f));
  let { stems, topics } = read(scoped);
  const topicless = stems.length === 0 && topics.length === 0;
  const contingent = has(OTHER_MARKER) || has(ARRIVAL_MARKER) || isConditionLikeClause(scoped);
  // "Diğer konular / sorularınız için" GERİ KALANI anar: göndergesel sözcük ("konular") taşısa da genel kapanıştır.
  // Az önce cevaplanan şeyin ARIZA olasılığı ("If it doesn't work, just message your host", "If anything breaks during this stay") kapanıştır —
  // zamir göndergesel değildir (v3 yeniden incelemesi wf3-fp-03).
  const failureContingency = has(FAILURE_CONTINGENCY);
  const closing =
    forceClosing || (!has(DETAIL_MARKER) && (has(OTHER_MARKER) || failureContingency || (!has(ANAPHORIC_MARKER) && contingent)));
  const scope: RemovalScope = forceClosing
    ? "closing"
    : !topicless
      ? contingent && !has(DETAIL_MARKER)
        ? "contingent"
        : "topical"
      : closing
        ? "closing"
        : "anaphoric";
  // Göndergesel yönlendirmenin kaydı önceki cümlenin konusunu taşır (cevabın tamamı tutulsa da ev sahibine giden kayıt doğru isteği anar).
  if (scope === "anaphoric" && previous) ({ stems, topics } = read(previous));
  stems = [...new Set(stems)].sort();
  topics = [...new Set(topics)].sort();
  // Teyit işareti yalnız konulu / göndergesel silmede okunur (↓kısmi karar): uzun kapanış / koşul gövdesinde boşuna taranmaz (süre pini).
  let confirms: boolean | undefined;
  return {
    removal: { kind, form, appendix, stems, topics, generic: scope === "closing" && topicless },
    scope,
    confirms: () => (confirms ??= has(CONFIRM_MARKER)),
  };
}

/**
 * Sondaki cümle sonu noktalaması / ayraç dizisi — sondan geriye doğrusal tarama. `[.!?。]+$` ve `[\s,;:،]+$` uzun nokta / boşluk / virgül
 * dizisinde (dizi metnin sonunda değilken) karesel geri izliyordu (v3 maliyet incelemesi cost-coverage-11).
 */
function trailingSentencePunct(s: string): string {
  let i = s.length;
  while (i > 0 && ".!?。".includes(s[i - 1])) i--;
  return s.slice(i);
}
function trimTrailingSeparators(s: string): string {
  let i = s.length;
  while (i > 0 && /[\s,;:،]/u.test(s[i - 1])) i--;
  return s.slice(0, i);
}

/** Yan cümle ayracı: virgül / noktalı virgül / Arapça virgül (ardından boşluk) ve sınırlı bağlaçlar. URL / saat bölünmez. İki nokta DEĞİL (F1). */
const CLAUSE_BOUNDARY = /[,;،](?=\s)|\s(?=(?:ve|ama|fakat|ancak|and|but|und|aber|et|mais|y|pero|и|но|و)\s)/gu;
/** Yalnız güçlü ayraç (noktalı virgül / Arapça virgül) — bilgi yönlendirmesinde virgülden önceki kısım çoğu zaman yönlendirmenin KONUSUDUR. */
const STRONG_BOUNDARY = /[;،](?=\s)/gu;
const LEADING_CONJ = /^(?:ve|ama|fakat|ancak|and|but|und|aber|et|mais|y|pero|и|но|و|or|ya da|veya|yahut|oder|ou|o|или|أو)\s+|^و(?=\p{L}{2})/iu;
/** Güvenlik çözümlemesinde "veya / or" da yan cümle sınırıdır ("call 112 or message your host"); Arapça bitişik "و" ("وغادر … وراسل"). */
const SAFETY_BOUNDARY = /[,;،](?=\s)|\s(?=(?:ve|ama|fakat|ancak|and|but|und|aber|et|mais|y|pero|и|но|و|or|ya da|veya|yahut|oder|ou|o|или|أو)\s)|\s(?=و\p{L}{2})/gu;

/**
 * Koşulla AYNI yan cümledeki emir (adım): Türkçe yüklem sonda ("Duman dedektörü öterse balkon kapısını açın"; koşul eki "-sanız" değil),
 * Almanca "drehen Sie" (cümle başındaki ters koşul "Sollten Sie" değil), Fransızca "ouvrez" ("vous sentez" değil), Rusça "откройте" ("Если
 * увидите" değil). Sınırlı, doğrusal.
 */
function hasImperativeStep(clause: string): boolean {
  const c = clause.trim();
  // Sözcük başı çapası: çapasız `\p{L}{2,}` uzun tek sözcükte karesel (v3 maliyet incelemesi cost-coverage-10).
  if (/(?<![\p{L}])\p{L}{2,}(?:[ıiuü]n|[ıiuü]n[ıiuü]z|y[ıiuü]n)$/u.test(c)) return true;
  if (/(?<=\S\s)(?<![\p{L}])(?!(?:sollten|k[öo]nnten|m[üu]ssten|w[üu]rden|wenn|falls)\s)\p{L}{2,}en sie(?![\p{L}])/iu.test(c)) return true;
  if (/(?<!vous )(?<![\p{L}])\p{L}{2,}ez(?![\p{L}])/iu.test(c) && !/^(?:si|quand|lorsque)\s/iu.test(c)) return true;
  if (/(?<![\p{L}])\p{L}{2,}(?:ите|йте)(?![\p{L}])/iu.test(c) && !/^(?:если|когда|в случае)\s/iu.test(c)) return true;
  return false;
}
/** Yalnız koşul yan cümlesi: koşul izi var, emir yok ve kısa (en çok altı sözcük — "If you smell gas leave the flat" gibi virgülsüz koşul +
 *  adım yan cümlesi KOŞUL sayılmaz, adım sessizce silinmesin — v2 incelemesi safety-wiring-01). */
function isPureCondition(clause: string): boolean {
  return isConditionLike(clause) && !hasImperativeStep(clause) && clause.trim().split(/\s+/u).length <= 6;
}
function hasStep(clause: string): boolean {
  return !isPureCondition(clause);
}
/** Türkçe ulaç zinciri ("açıp", "kapatıp", "çıkıp") — virgülsüz ardışık adım. */
const CONVERB_CHAIN = /(?<![\p{L}])\p{L}{2,}[ıiuü]p(?![\p{L}])/u;

/**
 * Baş kısım yalnız KONU ETİKETİ mi (Opus F1 + v2 incelemesi launder-03 / overhold-6):
 *   – açık konu belirteci ("Regarding …", "Speaking of …", "When it comes to …", "Was … betrifft", "Что касается …", "Otoparka gelince",
 *     "Otopark konusunda") → uzunluk / sayı fark etmez, etikettir;
 *   – belirsiz edat ("For …", "Zur …", "Sobre …", "Для …", "… için") → yalnız en çok dört sözcük, sayı yok ve fiil yoksa ("For parking use spot B",
 *     "Zur Sauna gehen Sie geradeaus", "Sobre la mesa hay toallas" bilgidir).
 */
const PURE_TOPIC_HEAD = new RegExp(
  "^(?:(?:regarding|concerning|as for|as to|as regards|with regard to|in regard to|with respect to|in terms of|on the (?:topic|subject|matter) of|speaking of|when it comes to|re:?|bez[üu]glich|hinsichtlich|betreffend|in bezug auf|quant [àa]|concernant|en ce qui concerne|[àa] propos d(?:e|u|es|['’])|au sujet d(?:e|u|es|['’])|en cuanto a|(?:con )?respecto a|en lo que respecta a|acerca d(?:e|el)|что касается|по поводу|насч[её]т|относительно|касательно|بخصوص|بالنسبة ل\\p{L}{0,4}|فيما يخص)(?:\\s+[\\p{L}\\p{N}'’:.-]+){1,10}" +
    "|(?:[\\p{L}\\p{N}'’-]+\\s+){1,8}(?:konusunda|konusuyla|hakk[ıi]nda|ile ilgili(?: olarak)?|bak[ıi]m[ıi]ndan|a[çc][ıi]s[ıi]ndan)" +
    "|(?:[\\p{L}'’-]+\\s+){0,6}[\\p{L}'’-]+(?:[ae]|y[ae]|n[ae]) gelince" +
    "|was (?:[\\p{L}'’-]+\\s+){1,6}betrifft)$",
  "iu",
);
const AMBIGUOUS_TOPIC_HEAD = new RegExp(
  "^(?:(?:for|about|on|zu[rm]?|f[üu]r|wegen|pour|para (?:el|la|los|las|su|tu)|sobre|о|об|для|حول|عن)(?:\\s+[\\p{L}'’-]+){1,4}" +
    "|(?:[\\p{L}'’-]+\\s+){1,4}i[çc]in)$",
  "iu",
);
const VERB_HINT =
  /(?<![\p{L}])(?:is|are|was|were|use|take|go|press|turn|open|close|leave|put|enter|find|walk|drive|park|has|have|there|ist|sind|gehen|nehmen|dr[üu]cken|[öo]ffnen|parken|gibt|est|sont|prenez|allez|appuyez|ouvrez|garez|es|son|est[aá]n?|hay|tome|vaya|pulse|abra|aparque|есть|используйте|возьмите|идите|нажмите|откройте)(?![\p{L}])/iu;
/** Baş kısım yalnız nezaket / onay mı ("Of course", "Sure", "Tabii", "Elbette", "Natürlich", "Bien sûr", "Claro", "Конечно") — Opus F8 ek. */
const COURTESY_HEAD =
  /^(?:of course|sure|certainly|absolutely|definitely|no problem|tabii(?: ki)?|elbette|kesinlikle|memnuniyetle|nat[üu]rlich|gerne|selbstverst[äa]ndlich|bien s[ûu]r|avec plaisir|claro(?: que s[ií])?|por supuesto|con gusto|конечно|разумеется|بالتأكيد|طبعا)$/iu;

function isLabelHead(head: string): boolean {
  const h = head.trim().replace(/^[-•*#]+\s*/u, "").replace(/\*+/gu, "").trim();
  if (PURE_TOPIC_HEAD.test(h)) return true;
  if (/\d/.test(h)) return false;
  if (AMBIGUOUS_TOPIC_HEAD.test(h) && !VERB_HINT.test(h)) return true;
  return COURTESY_HEAD.test(h) || isBareGreeting(h);
}

/**
 * Kısıtlayan kuyruk ("but only if you message your host in advance", "aber nur wenn Sie Ihrem Gastgeber schreiben", "ancak ev sahibinize bir
 * gün önceden yazarsanız") — silinince baş kısım koşulsuz İZNE döner ("A baby cot can be provided.") → bütün cümle çıkar (v2 incelemesi
 * launder-06).
 */
const RESTRICTIVE_TAIL =
  /(?<![\p{L}])(?:only if|but only|as long as|provided (?:that|you)|on condition|nur wenn|nur falls|sofern|vorausgesetzt|seulement si|à condition|pourvu que|solo si|sólo si|siempre (?:y )?cuando|siempre que|con tal de que|только если|при условии|лишь если|yeter ki|şart[ıi]yla|ko[şs]uluyla|kayd[ıi]yla)(?![\p{L}])|(?<![\p{L}])ancak\s(?:\S+\s){0,8}?\S*(?:rsan[ıi]z|rsen[ıi]z)(?![\p{L}])/iu;

/**
 * GD5 (K-1029-B): cümlenin koşulsuz baş yan cümlelerini döner — ilk koşul / talimat yan cümlesinden SONUNA kadar her şey çıkar. Kalan
 * metin cümlenin BAŞ KISMIDIR (yalnız silme), en az bir yan cümlesi bilgi taşır ve dedektör ona yeniden koşar. Olmazsa `null` (cümle bütün
 * olarak çıkar). Doğrusal.
 */
export function splitInstructionClauses(sentence: string): string | null {
  return splitInstructionClausesWithTail(sentence)?.kept ?? null;
}

function splitInstructionClausesWithTail(
  sentence: string,
  strongOnly = false,
  /** Kesim yalnız ilk silinen yan cümle bir KOŞULSA geçerli — bilgi yönlendirmesinde koşulsuz virgül kesimi yönlendirmenin konusunu bırakırdı. */
  requireConditionBreak = false,
): { kept: string; removed: string } | null {
  const body = sentence.trimEnd();
  const endPunct = trailingSentencePunct(body);
  const core = body.slice(0, body.length - endPunct.length);
  const cuts: number[] = [];
  for (const m of core.matchAll(strongOnly ? STRONG_BOUNDARY : CLAUSE_BOUNDARY)) cuts.push(m.index ?? 0);
  if (cuts.length === 0) return null;
  let keepUntil = -1;
  let start = 0;
  for (const cut of [...cuts, core.length]) {
    const clause = core.slice(start, cut).replace(/^[\s,;:،]+/u, "").replace(LEADING_CONJ, "");
    if (!clause.trim()) {
      start = cut;
      continue;
    }
    if (hostContactKindOf(clause) !== null || isConditionLike(clause)) {
      if (requireConditionBreak && !isConditionLike(clause)) return null;
      break;
    }
    keepUntil = cut;
    start = cut;
  }
  if (keepUntil <= 0 || keepUntil >= core.length) return null;
  const head = trimTrailingSeparators(core.slice(0, keepUntil));
  if (!head || !isSubstantiveSentence(head) || !carriesInformation(head) || isLabelHead(head)) return null;
  const removed = core.slice(keepUntil);
  if (RESTRICTIVE_TAIL.test(removed)) return null;
  const kept = `${head}${endPunct || "."}`;
  // Kalan baş kısım da başvurma ya da koşul taşıyorsa (kesim temiz değil) bütün cümle çıkar.
  if (hostContactKindOf(kept) !== null || isConditionLike(head)) return null;
  return { kept, removed };
}

type SafetyOutcome = { keep: true } | { kept: string; removed: string } | { removeWhole: true } | { hold: true };

/**
 * Güvenlik uyarısı taşıyan cümlede başvurma (Opus F9 + v2 incelemesi launder-01, overhold-1/2, safety-wiring-01…05). Yan cümleler çözülür:
 *   – başvurma yan cümlesi ve onun KOŞUL ZİNCİRİ (son koşul yan cümlesinden başvurmaya kadar) bulunur;
 *   – yalnız ARAMA ("arayın / call / ulaşın") ve tehlike / acil numara aynı zincirdeyse cümle AYNEN kalır (kurucu K-1029-C);
 *   – öbür hâlde başvurma + yalnız ona ait koşul yan cümleleri çıkar: başvurmadan SONRA yan cümle varsa (adım düşerdi) ya da temiz
 *     ayrılamıyorsa cevabın TAMAMI tutulur; geriye adım kalmıyorsa ("If you smell gas, message your host") bütün cümle çıkar.
 */
function safetyOutcome(sentence: string, hazardContext = false): SafetyOutcome {
  const body = sentence.trimEnd();
  const endPunct = trailingSentencePunct(body);
  const core = body.slice(0, body.length - endPunct.length);
  const bounds = [0];
  for (const m of core.matchAll(SAFETY_BOUNDARY)) bounds.push(m.index ?? 0);
  bounds.push(core.length);
  const clauses: { start: number; text: string }[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const text = core.slice(bounds[i], bounds[i + 1]).replace(/^[\s,;:،]+/u, "").replace(LEADING_CONJ, "").trim();
    if (text) clauses.push({ start: bounds[i], text });
  }
  const ci = clauses.findIndex((c) => hostContactKindOf(c.text) !== null);
  const callOnly = (t: string) => namesCallContact(t) && !namesWriteContact(t);
  if (ci < 0) {
    // Başvurma yan cümlelere ayrılamıyor (tek yan cümlede koşul + başvurma ya da bölünmüş): aramaysa kurucu kuralı, değilse adım varsa tut.
    if (callOnly(sentence)) return { keep: true };
    return CONVERB_CHAIN.test(sentence) || clauses.length > 1 ? { hold: true } : { removeWhole: true };
  }
  let condIdx = -1;
  for (let k = ci; k >= 0; k--) {
    if (isConditionLike(clauses[k].text)) {
      condIdx = k;
      break;
    }
  }
  const chain = clauses.slice(condIdx < 0 ? 0 : condIdx, ci + 1);
  if (callOnly(clauses[ci].text) && (hazardContext || chain.some((c) => isSafetyWarningSentence(c.text)))) {
    // Arama kalır; ardından gelen YAZMA / kapanış yan cümlesi ("; for anything else, feel free to message them", "и напишите ему", "and then text
    // them a photo") çıkar — "yazın" hiçbir koşulda kalmaz (v3 yeniden incelemesi SAFE-1). Ardında adım varsa temiz kesilemez → tutulur.
    const wi = clauses.findIndex((c, k) => k > ci && (namesWriteContact(c.text) || hostContactKindOf(c.text) !== null));
    if (wi < 0) return { keep: true };
    if (clauses.slice(wi + 1).some((c) => hasStep(c.text) && !namesWriteContact(c.text))) return { hold: true };
    let w = wi;
    while (w > ci + 1 && !hasImperativeStep(clauses[w - 1].text) && clauses[w - 1].text.split(/\s+/u).length <= 4) w--;
    const keptHead = trimTrailingSeparators(core.slice(0, clauses[w].start));
    return keptHead ? { kept: `${keptHead}${endPunct || "."}`, removed: core.slice(clauses[w].start) } : { hold: true };
  }
  if (clauses.slice(ci + 1).length > 0) return { hold: true };
  // Başvurma yan cümlesi tek başına bir koşul + başvurma ise ("Gaz kokusu alırsanız pencereleri açıp ev sahibinize yazın") ulaç zinciri adım taşır.
  if (CONVERB_CHAIN.test(clauses[ci].text)) return { hold: true };
  let g = ci;
  while (g > 0 && isPureCondition(clauses[g - 1].text)) g--;
  const head = clauses.slice(0, g);
  if (head.length === 0 || !head.some((c) => hasStep(c.text))) return { removeWhole: true };
  // Nesnesi silinen çıplak fiil ("If you smell gas, call or message your host" → "…, call.") temiz değil → tutulur (SAFE-3 / SAFE-5).
  if (head[head.length - 1].text.split(/\s+/u).length <= 1) return { hold: true };
  const headText = trimTrailingSeparators(core.slice(0, clauses[g].start));
  if (!headText || hostContactKindOf(headText) !== null) return { hold: true };
  return { kept: `${headText}${endPunct || "."}`, removed: core.slice(clauses[g].start) };
}

/** Kalan baş kısım BİLGİ taşıyor mu: sayı, evet / hayır cevabı ya da genel sorun / nezaket / konaklama sözcüğü olmayan içerik kökü
 *  ("During your stay", "Teşekkürler", "Enjoy your stay", "Thanks for reaching out!" bilgi değildir — Opus F8, v2 incelemesi launder-11). */
const GENERIC_TROUBLE_STEMS = new Set([
  "sorun", "probl", "issue", "herha", "anyth", "somet", "wrong", "durum", "ihtiy", "konak", "stay", "shoul", "troub", "quest", "conce",
  "yardi", "help", "helpi", "assis", "memnu", "happy", "glad", "sevin", "olsun", "durin", "need", "neede", "olurs", "yasar", "yasad",
  "tesek", "thank", "merci", "danke", "graci", "спаси",
  // Opus F8 (10-30): nezaket / temenni / onay — yedi dil.
  "messa", "mesaj", "enjoy", "hope", "hopin", "havin", "great", "time", "nice", "lovel", "wonde", "pleas", "welco", "cours",
  "sure", "certa", "absol", "defin", "keyif", "umari", "umarı", "gecer", "geçer", "gecir", "geçir", "hosge", "hoşge", "diler", "diliy",
  "tabii", "elbet", "nachr", "genie", "aufen", "schön", "schon", "profi", "sejou", "séjou", "bonne", "agrea", "disfr", "estan", "mensa",
  "natur", "gerne", "claro", "supue", "конеч", "прият", "отдых", "сообщ", "хорош", "votre", "about", "regar", "glück", "gluck",
  // 10-30 tekrar oynatma + v2 incelemesi launder-11: "Thank you for letting me know, Alex.", "Rica ederim.", "Thanks for reaching out!",
  // "I understand.", "Good question!", "Mesajınızı aldım.", "Anlıyorum.", "Ich wünsche Ihnen einen schönen Urlaub!", "¡Buen viaje!".
  "letti", "know", "rica", "ederi", "rien", "nada", "gesch", "пожал", "عفوا", "reach", "askin", "under", "patie", "good", "aldim", "anliy",
  "anlad", "viele", "wunsc", "urlau", "excel", "souha", "buen", "viaje", "escri", "شكرا", "لرسا", "رسال",
  // İşlev sözcükleri (Almanca / Fransızca / İspanyolca — "Vielen Dank für Ihre Nachricht! Ich wünsche Ihnen einen schönen Urlaub!").
  "dank", "ihre", "ihnen", "einen", "eine", "einem", "einer", "ihrer", "ihren", "ihrem", "sehr", "haben", "pour", "vous", "nous", "avec", "dans", "para",
  "usted", "todo", "toda", "okay", "every", "alrig",
]);
/** Evet / hayır cevabı bilgidir ("Yes, of course!" — "Can I bring my dog?"), "No problem" nezakettir. */
const YES_NO_ANSWER =
  /^\s*(?!no (?:problem|worries)|nein,? kein problem|non,? pas de probl)(?:yes|yep|yeah|no|nope|evet|hay[ıi]r|ja|nein|oui|non|sí|да|нет|نعم|لا)(?![\p{L}])/iu;
function carriesInformation(clause: string): boolean {
  const body = withoutLeadingSalutation(clause);
  if (/\d/.test(body) || YES_NO_ANSWER.test(body)) return true;
  // Hitap adı (", Alex." / ", Ayşe!") nezaketi bilgiye çevirmez — yalnız virgülden sonra cümle / yan cümle sonunda duran BÜYÜK harfli sözcük
  // (Almanca adlar "Der Schlüssel ist im Briefkasten" silinmez — v2 incelemesi overhold-4).
  const withoutNames = body.replace(/,\s*\p{Lu}[\p{Ll}'’-]+(?=\s*(?:[.!?,]|$))/gu, " ");
  return contentStemsOf(withoutNames).some((stem) => !GENERIC_TROUBLE_STEMS.has(stem));
}

function isConditionLike(clause: string): boolean {
  return isConditionLikeClause(clause);
}

/**
 * Selam sözcükleri — "Здравствуйте, Alex!", "Merhaba Ayşe," gibi yalnız selam + hitap adı bilgi değildir (10-30 tekrar oynatma). Hitap adı yalnız
 * BÜYÜK harfle başlayan sözcük ("Merhaba, havuz kapalı." bir cevaptır — v2 incelemesi overhold-7).
 */
const GREETING_WORDS =
  "(?:merhaba|selam(?:lar)?|iyi (?:günler|akşamlar|geceler)|günaydın|hello|hi|hey|dear|good (?:morning|afternoon|evening)|hallo|guten (?:tag|morgen|abend)|liebe[rs]?|bonjour|bonsoir|salut|hola|buenos días|buenas (?:tardes|noches)|здравствуйте|привет|добрый (?:день|вечер)|доброе утро|مرحبا|أهلا|السلام عليكم)";
const SALUTATION_HEAD = new RegExp(`^\\s*${GREETING_WORDS}(?![\\p{L}])`, "iu");
/** Baştaki selam + en çok üç BÜYÜK harfle başlayan hitap sözcüğü (misafirin adı) silinmiş metin; selam yoksa aynen. Doğrusal. */
function withoutLeadingSalutation(text: string): string {
  const m = SALUTATION_HEAD.exec(text);
  if (!m) return text;
  let rest = text.slice(m[0].length);
  for (let i = 0; i < 3; i++) {
    const n = /^[\s,،]*\p{Lu}[\p{L}'’-]*/u.exec(rest);
    if (!n) break;
    rest = rest.slice(n[0].length);
  }
  return rest.replace(/^[\s,،!.;:]+/u, "");
}

function isBareGreeting(sentence: string): boolean {
  if (isGreetingOnly(sentence.trim())) return true;
  return SALUTATION_HEAD.test(sentence) && withoutLeadingSalutation(sentence).replace(/[\s\p{P}\p{S}]/gu, "") === "";
}

/**
 * Kayıt / görünürlük BİLDİRİMİ (K10 sınıfı) — çıktı vetosunun kalıbında olmayan biçimler (10-30 tekrar oynatma + v2 incelemesi safety-wiring-06):
 * "ваш запрос зафиксирован, хозяин может его увидеть", "your host can also see this conversation", "Your host also has access to this chat",
 * "Ev sahibiniz de bu yazışmayı görüyor". Silmeden sonra kalan metinde ya da başvurma cümlesinde varsa cevabın TAMAMI tutulur.
 */
const VISIBILITY_NOTICE = new RegExp(
  [
    "(?:хозя|владел)\\p{L}{0,4}\\s+(?:\\p{L}+\\s+){0,2}?(?:может|сможет|увидит)(?:\\s+\\p{L}+){0,2}?\\s+увидеть",
    "(?:хозя|владел)\\p{L}{0,4}\\s+(?:\\p{L}+\\s+){0,1}?увидит",
    "(?:сообщени|запрос|просьб|заявк)\\p{L}{0,4}\\s+(?:[\\p{L}-]+\\s+){0,6}?(?:зафиксирован|записан|сохранен|зарегистрирован|передан)",
    "(?:host|owner)\\s+(?:can|will|may|is able to)\\s+(?:also\\s+)?(?:be\\s+able\\s+to\\s+)?(?:see|view|read|follow)\\s+(?:it|this|your|the)",
    "(?:host|owner)\\s+(?:also\\s+)?(?:has|have)\\s+access\\s+to\\s+(?:this|the)\\s+(?:chat|conversation|messages?)",
    "gastgeber\\p{L}{0,2}\\s+(?:kann|wird)\\s+(?:sie|es|ihre?|diese[ns]?|den)\\s+(?:\\p{L}+\\s+)?(?:auch\\s+)?(?:sehen|lesen)",
    "ev ?sahib\\p{L}{0,6}\\s+(?:de\\s+)?(?:bu\\s+)?(?:yaz[ıi][şs]may[ıi]|konu[şs]may[ıi]|mesajla[şs]may[ıi]|sohbeti|mesajlar[ıi](?:n[ıi]z[ıi])?)\\s+g[öo]r\\p{L}{0,8}",
  ].join("|"),
  "iu",
);

/**
 * Silmeden sonra kalan metin belirsizlik / tahmin / yetersizlik / paylaşılmamış bilgi / müsaitliğe bağlılık / ret / özür söylüyor mu (Opus F5 +
 * v2 incelemesi launder-04 / 05, overhold-3): eskiden yönlendirme cümlesi `admitsMissingKnowledge` ile cevabın TAMAMINI tutuyordu. Sözcük
 * sınırlı (önü harf değil; "internet değil" "net değil" değildir, "أسفل" "اسف" değildir), çekimler açık yazılı; koşullu kullanım ("emin
 * değilseniz mavi olana basın", "If you don't know where to park, …", "Aksi belirtilmemişse") sayılmaz. Doğrusal; ŞÜPHEDE TUT yönünde.
 */
const REMAINDER_HOLD = new RegExp(
  "(?<![\\p{L}])(?:" +
    [
      // TR
      "emin de[ğg]il(?:im|iz)?", "kesin de[ğg]il(?:im|iz|dir)?", "net de[ğg]il(?:dir)?", "belli de[ğg]il(?:dir)?", "bilmiyorum", "bilemiyorum",
      "s[öo]yleyeme(?:m|yiz|iyorum|iyoruz)", "diyeme(?:m|yiz)", "teyit edeme\\p{L}*", "teyit edemi\\p{L}*", "do[ğg]rulayam\\p{L}*",
      "payla[şs][ıi]lmam[ıi][şs]", "belirtilmemi[şs]", "belirtmemi[şs]", "bilgi verilmemi[şs]", "ayarlayam\\p{L}*", "garanti edem\\p{L}*",
      "m[üu]saitli[ğg]e ba[ğg]l[ıi]", "duruma ba[ğg]l[ıi]", "\\p{L}+(?:[ae]|y[ae]|n[ae]) ba[ğg]l[ıi](?:d[ıi]r)?(?=\\s*[.!,;]|$)", "tam emin de[ğg]il\\p{L}*", "pek emin de[ğg]il\\p{L}*", "[üu]zg[üu]n[üu](?:m|z)", "kusura bakma\\p{L}*", "[öo]z[üu]r dile\\p{L}*",
      "payla[şs]ama\\p{L}*", "yard[ıi]mc[ıi] olam\\p{L}*", "bulamad[ıi]\\p{L}*", "g[öo]remiyorum", "kontrol edemi\\p{L}*", "eri[şs]im(?:im)? yok",
      "elimde (?:bir [şs]ey|bilgi|kay[ıi]t) yok", "sanırım", "san[ıi]r[ıi]m", "muhtemelen", "galiba", "herhalde",
      // EN
      "(?<![iı]f you(?:'re| are) )not sure", "not (?:100 ?%|a hundred percent|completely|entirely|totally|fully|quite|really|absolutely) (?:sure|certain)", "unsure",
      "depends on", "depending on", "dependent on", "not certain", "uncertain", "can'?t confirm", "cannot confirm", "not able to confirm",
      "unable to confirm", "can'?t say", "cannot say", "can'?t tell", "cannot tell", "(?<![iı]f you )(?:don'?t|do not) know", "not been shared",
      "hasn'?t been shared", "wasn'?t shared", "not specified", "not been specified", "not mentioned", "hasn'?t mentioned", "has not mentioned",
      "can'?t arrange", "cannot arrange", "unable to arrange", "not able to arrange", "can'?t guarantee", "cannot guarantee",
      "depends on availability", "subject to availability", "depending on availability", "sorry", "apologi\\p{L}*", "i'?m afraid", "i am afraid",
      "can'?t share", "cannot share", "unable to share", "not able to share", "can'?t provide", "cannot provide", "can'?t help", "cannot help",
      "unable to help", "not able to help", "can'?t check", "cannot check", "(?:don'?t|do not) have access", "(?:aren'?t|isn'?t|not) listed",
      "need your host to", "(?<![iı]f you )(?:couldn'?t|could not|can'?t|cannot) find", "no information", "probably", "i believe", "i think",
      "might be", "may be", "likely", "presumably",
      // DE
      "nicht (?:ganz |v[öo]llig |hundertprozentig |so )?sicher", "h[äa]ngt (?:\\p{L}+ ){0,3}?ab", "wei(?:ß|ss) (?:ich )?nicht", "nicht sagen", "nicht best[äa]tigen", "keine angaben", "nicht angegeben", "nach verf[üu]gbarkeit",
      "von der verf[üu]gbarkeit", "entschuldig\\p{L}*", "tut (?:mir|uns) leid", "nicht teilen", "nicht weitergeben", "nicht helfen", "keinen zugriff",
      "nicht pr[üu]fen", "wahrscheinlich", "vermutlich", "ich glaube", "ich denke", "m[öo]glicherweise", "eventuell",
      // FR
      "pas s[ûu]r(?:e|s|es)?(?=\\s*(?:[.!?,;]|$|de |que ))", "pas (?:tout [àa] fait|enti[èe]rement|compl[èe]tement) s[ûu]r\\p{L}*", "d[ée]pend (?:de|du|des)", "pas certain\\p{L}*", "ne sais pas", "ne peux pas (?:confirmer|partager|communiquer|donner|vous aider|aider)",
      "pas en mesure", "pas pr[ée]cis[ée]\\p{L}*", "pas indiqu[ée]\\p{L}*", "selon disponibilit\\p{L}*", "sous r[ée]serve de disponibilit\\p{L}*",
      "d[ée]sol[ée]\\p{L}*", "excus\\p{L}*", "pas d'acc[èe]s", "probablement", "je crois", "je pense", "peut-[êe]tre", "sans doute",
      // ES
      "no estoy (?:del todo |completamente |totalmente )?segur\\p{L}*", "depende de\\p{L}*", "no sé(?=(?: si| d[oó]nde| cu[aá]ndo| qu[ée])(?![\\p{L}])|\\s*[.!?,]|$)", "no puedo (?:confirmar|garantizar|compartir|facilitar|dar|ayudar)",
      "no se ha indicado", "no est[aá] especificad\\p{L}*", "seg[uú]n disponibilidad", "sujeto a disponibilidad", "lo siento", "disculp\\p{L}*",
      "perd[oó]n", "no tengo acceso", "no encuentro", "probablemente", "creo que", "quiz[aá]s?", "tal vez", "posiblemente",
      // RU
      "не уверен\\p{L}*", "не совсем уверен\\p{L}*", "зависит от", "не знаю", "не могу (?:подтвердить|сказать|поделиться|сообщить|дать|помочь)", "не указан\\p{L}*", "зависит от наличия",
      "извин\\p{L}*", "к сожалению, я", "нет доступа", "не наш[её]л\\p{L}*", "скорее всего", "наверное", "возможно", "вероятно", "думаю",
      // AR
      "لست متأكد\\p{L}*", "لا أعرف", "لا اعرف", "لا يمكنني (?:تأكيد|مشاركة|المساعدة)", "لا أستطيع المساعدة", "آسف\\p{L}*", "اسف", "نعتذر",
      "حسب التوفر", "ربما", "على الأرجح", "أعتقد",
    ].join("|") +
    ")(?![\\p{L}])",
  "iu",
);
/**
 * Silinen parça bir ÖN KOŞUL söylüyor mu ("arrange it with your host beforehand", "önceden haber vermeniz gerekiyor", "ayarlamanız yeterli",
 * "the day before") — kalan metin bir İZİN / olanak söylüyorsa ("Early check-in is possible", "evcil hayvan kabul ediliyor") silme onu koşulsuz
 * bir "evet"e çevirirdi → cevabın tamamı tutulur (v3 yeniden incelemesi LAUNDER-03). Genel sorun / ihtiyaç kapanışı ön koşul değildir.
 */
const PRECONDITION = new RegExp(
  "(?<![\\p{L}])(?:beforehand|in advance|ahead of time|the day before|before (?:you arrive|your arrival|arrival|check-?in|check-?out)|" +
    "(?<!if )you(?:['’]ll| will)? (?:just |only )?(?:need|have) to|you must|be sure to|make sure (?:to|you)|" +
    "[öo]nceden|bir g[üu]n [öo]nce|gelmeden [öo]nce|\\p{L}+(?:man[ıi]z|men[ie]z)[ıi]? (?:yeterli|gerek(?:iyor|ir|li|mektedir)|[şs]art)|gerekmektedir|" +
    "vorher|im voraus|vorab|rechtzeitig|m[üu]ssen sie|sie m[üu]ssen|[àa] l['’]avance|au pr[ée]alable|la veille|vous devez|il faut|" +
    "con antelaci[óo]n|de antemano|previamente|el d[íi]a anterior|debe|tiene que|заранее|накануне|нужно|необходимо|должны)(?![\\p{L}])|مسبقا|مسبقاً|قبل الوصول|يجب",
  "iu",
);
const PERMISSION = new RegExp(
  "(?<![\\p{L}])(?:possible|allowed|permitted|approved|accepted|welcome|fine|okay|ok|available|can(?! ?not)|m[üu]mk[üu]n|olur|uygun|kabul|izin|serbest|" +
    "m[öo]glich|erlaubt|gestattet|willkommen|autoris\\p{L}*|permis|accept\\p{L}*|posible|permitid\\p{L}*|aceptad\\p{L}*|можно|возможно|разрешен\\p{L}*)(?![\\p{L}])|ممكن|مسموح",
  "iu",
);
function remainderNeedsHost(text: string): boolean {
  const plain = text.replace(/[’‘]/g, "'");
  return [plain.toLocaleLowerCase("tr"), plain.toLowerCase()].some((f) => REMAINDER_HOLD.test(f));
}

/**
 * Mantıksal satırlar (Opus F4): sonu cümle / madde noktalamasıyla bitmeyen satırın ardından KÜÇÜK harfle başlayan satır aynı cümlenin
 * devamıdır ("If the Wi-Fi fails, message\nyour host."). Madde işaretiyle başlayan satır yeni satırdır. Doğrusal.
 */
function logicalLines(reply: string): string[][] {
  const groups: string[][] = [];
  for (const line of reply.split("\n")) {
    const prev = groups[groups.length - 1];
    const last = prev?.[prev.length - 1]?.trimEnd() ?? "";
    const continues = !!prev && last !== "" && !/[.!?。:;…]$/u.test(last) && /^\s*\p{Ll}/u.test(line) && !/^\s*[-•*]/u.test(line);
    if (continues) prev.push(line);
    else groups.push([line]);
  }
  return groups;
}

/**
 * Silmeden sonra tek başına kalan artık: boş liste numarası ("2."), "P.S.", "Note:", yalnız emoji / noktalama (v2 incelemesi launder-10). İç içe
 * yıldızlı tek düzenli ifade boşluk dizisinde KÜBİKTİ (v3 yeniden incelemesi COST-1: 4 bin karakterde 10–17 sn) → işaretler silinir, geriye harf /
 * rakam kalmıyorsa artıktır. Doğrusal.
 */
const RESIDUE_TOKENS = /\d{1,3}[.)]|p\.?\s?s\.?|n\.?\s?b\.?|note|not|hinweis|remarque|nota|примечание|ملاحظة/giu;
function isResidue(x: string): boolean {
  return x.replace(RESIDUE_TOKENS, "").replace(/[\s\p{P}\p{S}\p{Extended_Pictographic}\u200d\ufe0f]/gu, "") === "";
}
/** Başlık satırı: iki noktayla biten ya da en çok dört sözcüklük, cümle noktalaması olmayan satır ("**Parking**", "If the Wi-Fi stops working:"). */
function isHeaderLine(line: string): boolean {
  const t = line.trim().replace(/^[-•*#>]+\s*/u, "").replace(/\*+/gu, "").trim();
  if (!t) return false;
  if (/:\s*$/u.test(t)) return true;
  return !/[.!?。]$/u.test(t) && t.split(/\s+/u).length <= 4;
}

export function analyzeHostContact(reply: string): HostContactAnalysis {
  if (!reply.trim()) return { text: reply, removals: [], nothingLeft: false, draft: reply };
  const removals: HostContactRemoval[] = [];
  const scopes: RemovalScope[] = [];
  const confirms: (() => boolean)[] = [];
  let forceHold = false;
  let safetyHold = false;
  let preconditionRemoved = false;
  let needReferenceRemoved = false;
  let previous: string | null = null;
  const readCache = new Map<string, { stems: string[]; topics: string[] }>();
  // Önceki cümleye bağlı okumalar (işletme mi, yalnız ev sahibi mi, güvenlik talimatı mı) önceki cümle DEĞİŞİNCE bir kez hesaplanır — uzun
  // bir cümlenin ardından gelen binlerce kısa başvurma cümlesi onu her seferinde yeniden taramasın (10-30 ölçümü: 100.000 karakterde 4,3 sn,
  // karesel).
  let prevFacts: { of: string; business?: boolean; hostOnly?: boolean; safety?: boolean } = { of: "" };
  const factsOf = (p: string) => (prevFacts.of === p ? prevFacts : (prevFacts = { of: p }));
  const prevBusiness = (p: string) => {
    const f = factsOf(p);
    if (f.business === undefined) f.business = mentionsBusiness(p);
    return f.business;
  };
  const prevHostOnly = (p: string) => {
    const f = factsOf(p);
    if (f.hostOnly === undefined) f.hostOnly = mentionsHostOnly(p);
    return f.hostOnly;
  };
  // Cümle başına çıktı vetosu yalnız cevabın TAMAMI vetoya takılıyorsa gerekir: bir cümlede yakalanan söz / iletme iddiası bütün cevapta da
  // yakalanır (10-30 ölçümü: 109.098 metinde karşı örnek 0). Temiz cevapta veto bir kez koşar (uzun cevapta cümle sayısı kadar değil).
  let replyVetoed: boolean | undefined;
  const replyCarriesVeto = () => {
    if (replyVetoed === undefined) replyVetoed = vetoOutgoingReply(reply) !== null;
    return replyVetoed;
  };
  const prevSafety = (p: string) => {
    const f = factsOf(p);
    if (f.safety === undefined) f.safety = isSafetyWarningSentence(p);
    return f.safety;
  };
  const record = (r: { removal: HostContactRemoval; scope: RemovalScope; confirms: () => boolean }) => {
    removals.push(r.removal);
    scopes.push(r.scope);
    confirms.push(r.confirms);
  };
  const groups = logicalLines(reply);
  const lines = groups.map((group, gi) => {
    const joined = group.length === 1 ? group[0] : group.map((l) => l.trim()).join(" ");
    // Önceki satır bir başlıksa ("If the Wi-Fi stops working:", "**Parking**") bu satırdaki başvurmanın koşulu / konusu odur.
    const prevLine = gi > 0 ? groups[gi - 1].join(" ") : "";
    const lead = prevLine.trim() && isHeaderLine(prevLine) ? prevLine.trim() : null;
    const out: string[] = [];
    let changed = false;
    for (const s of replySentencesOf(joined)) {
      // Ev sahibi bir ÖNCEKİ cümlede anıldıysa zamirle gönderme ("Your host Mehmet lives nearby. If anything comes up, just message him.").
      // Önceki cümle bir işletme andıysa "the owner" o işletmenindir (v3 yeniden incelemesi wf3-fp-06).
      const kind =
        hostContactKindOf(withBusinessOwnerContext(s, previous !== null && prevBusiness(previous))) ??
        (previous !== null && prevHostOnly(previous) ? pronounHostContactKind(s) : null);
      if (!kind) {
        out.push(s);
        if (s.trim()) previous = s;
        continue;
      }
      changed = true;
      // 🚨 K10 DEVİR / BİLDİRİM taşıyan başvurma cümlesi: kurucu kuralı "Hiçbir şey gitmesin" → cevabın TAMAMI tutulur (Opus F7). Çıktı
      // vetosunun işaretleyeceği söz / iletme iddiası ("I've passed this on to your host", "ilettim", "and I will arrange a replacement") da:
      // süzgeç onu silseydi veto kalan metinde göremez, cevabın geri kalanı giderdi (v3 yeniden incelemesi LAUNDER-02 / VETO-1).
      if (carriesHandoffNotice(s) || VISIBILITY_NOTICE.test(s) || (replyCarriesVeto() && vetoOutgoingReply(s) !== null)) {
        forceHold = true;
        record(removalOf(kind, s, false, previous, false, null, readCache));
        continue;
      }
      // Önceki cümle bir güvenlik talimatıysa devam cümlesi ("Then leave the apartment and call your host from outside.") aynı zincirdir —
      // tahliye adımı sıradan yönlendirme gibi silinmesin (v3 yeniden incelemesi SAFE-2).
      const safetyContinuation = previous !== null && SAFETY_CONTINUATION.test(s) && prevSafety(previous);
      if (isSafetyWarningSentence(s) || safetyContinuation) {
        const o = safetyOutcome(s, safetyContinuation);
        if ("keep" in o) {
          out.push(s);
          previous = s;
          continue;
        }
        if ("hold" in o) {
          forceHold = true;
          safetyHold = true;
          record(removalOf(kind, s, false, previous, false, null, readCache));
          continue;
        }
        if ("removeWhole" in o) {
          record(removalOf(kind, s, false, previous, false, null, readCache));
          continue;
        }
        out.push(o.kept + (/\s$/u.test(s) ? " " : ""));
        record(removalOf(kind, o.removed, true, o.kept, true, null, readCache));
        previous = o.kept;
        continue;
      }
      // Bilgi yönlendirmesi ("Sauna için, lütfen ev sahibinize yazın") virgülden kesilmez: baş kısmı yönlendirmenin KONUSUDUR, bilgi değil.
      // Ancak silinen yan cümle karşıtlıkla ya da KENDİ konusuyla başlıyorsa ("…, but for the sauna hours please message your host", "…, sauna
      // saatleri için ise …") baş kısım ayrı bir cevaptır — GD5: yalnız talimat yan cümlesi çıkar (v3 yeniden incelemesi wf3-fp-01).
      const cut =
        kind === "referral"
          ? (splitInstructionClausesWithTail(s, true) ??
            splitInstructionClausesWithTail(s, false, true) ??
            ((c) => (c && OWN_TOPIC_TAIL.test(c.removed) ? c : null))(splitInstructionClausesWithTail(s)))
          : splitInstructionClausesWithTail(s);
      const removedPart = cut !== null ? cut.removed : s;
      // Silinen parça kendi belirsizliğini / tahminini taşıyorsa ("I'm not 100% sure about this, so it's best to confirm with your host") kalan
      // iddia kesin gibi gitmez (v3 yeniden incelemesi LAUNDER-01). Ön koşul + kalan izin → tutulur (LAUNDER-03, sonda).
      if (remainderNeedsHost(removedPart)) forceHold = true;
      if (PRECONDITION.test(removedPart) && !HC_TROUBLE_CONTINGENCY.test(removedPart)) preconditionRemoved = true;
      if (NEED_REFERENCE.test(removedPart) || NEED_REFERENCE.test(removedPart.toLocaleLowerCase("tr"))) needReferenceRemoved = true;
      if (cut !== null) {
        out.push(cut.kept + (/\s$/u.test(s) ? " " : ""));
        record(removalOf(kind, cut.removed, true, cut.kept, false, null, readCache));
        previous = cut.kept;
      } else {
        record(removalOf(kind, s, false, previous, false, lead, readCache));
      }
    }
    // Değişen satırda tek başına kalan artık ("2.", "P.S.", "🙏") düşer.
    const kept = changed ? out.filter((x) => !isResidue(x)) : out;
    const text = kept.join("").trim();
    return { text: changed ? text : group.join("\n"), changed, dropped: changed && text === "" && joined.trim() !== "" };
  });
  if (removals.length === 0) return { text: reply, removals, nothingLeft: false, draft: reply };
  // Gövdesi tamamen silinen bölümün başlığı da düşer ("**Parking**\nIf you have questions, please message your host.").
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.changed || l.dropped || !l.text.trim() || !isHeaderLine(l.text)) continue;
    let j = i + 1;
    let body = 0;
    let droppedBody = 0;
    while (j < lines.length && lines[j].text.trim() !== "" || (j < lines.length && lines[j].dropped)) {
      body++;
      if (lines[j].dropped) droppedBody++;
      j++;
    }
    if (body > 0 && droppedBody === body) l.dropped = true;
  }
  // Tamamen çıkarılan satır düşer; özgün boş satır (paragraf arası) kalır.
  const text = lines
    .filter((l) => !l.dropped)
    .map((l) => l.text)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const sentences = text.split("\n").flatMap((l) => replySentencesOf(l));
  const informative = sentences.some((s) => isSubstantiveSentence(s) && !isBareGreeting(s) && carriesInformation(s));
  const draft = safetyHold ? "" : sentences.some((s) => s.trim() && !isBareGreeting(s)) ? text : "";
  // KONULU / göndergesel silme: silinen parça kalan bilgiyi TEYİDE açıyorsa ("Sanırım sauna 22'ye kadar açık. Sauna saatleri için ev sahibinize
  // teyit edin.") ya da kalan metin bir izin söylüyorsa yarım / tahmini / koşullu cevaptır → tutulur. "Detaylar için ev sahibinize yazabilirsiniz"
  // ise eksik ayrıntıdır: kalan bilgi gider, soru ev sahibine açık kalır ("cevaplandı" kuralı silmeyi görür; kurucu 10-30).
  // Yalnız konulu / göndergesel silme kısmi sayılabilir; teyit işareti, izin ve kalan metnin kökleri yalnız o zaman okunur (kapanış / koşul
  // silmesinde uzun metin boşuna taranmaz — süre pini `host-contact-cost.test.ts`).
  let permissionLeft: boolean | null = null;
  let keptStems: string[] | null = null;
  let keptTopics: string[] | null = null;
  const partial = () =>
    removals.some((r, i) => {
      if (scopes[i] !== "anaphoric" && scopes[i] !== "topical") return false;
      if (!confirms[i]() && !(permissionLeft ??= PERMISSION.test(text))) return false;
      if (scopes[i] === "anaphoric") return true;
      keptStems ??= distinctiveTokens(text);
      keptTopics ??= topicsWithSymptomsOf(text);
      return overlapLoose(r.stems, keptStems) > 0 || r.topics.some((t) => keptTopics!.includes(t));
    });
  // Kalan metin kararı ev sahibine bırakıyorsa, belirsizlik / tahmin / yetersizlik / ret / özür söylüyorsa ya da bildirim taşıyorsa
  // yönlendirme bir cevabın parçası değil, CEVAPSIZLIĞIN parçasıdır → eskisi gibi tamamı tutulur (kurucu kararları 10-01, 09-11, K10).
  const notice = () => carriesHandoffNotice(text) || VISIBILITY_NOTICE.test(text);
  // Yalnız genel kapanış silindiyse kalan metin, kapanışsız aynı cevapla AYNI muameleyi görür — kapanış eklemek cevabı sıkılaştırmaz (R13-b/c;
  // v3 yeniden incelemesi wf3-fp-04: "Luggage may be left …", "erişim yok", "creo que le encantará" tutuluyordu).
  // "Gerekirse / isterseniz" kapanışı genel kapanıştır; yalnız kalan metin belirsizlik ya da izin söylüyorsa silme onu kesinleştirirdi.
  const remainderHedge = () => (removals.some((r) => !r.generic) || needReferenceRemoved) && remainderNeedsHost(text);
  const conditionalYes = () => (preconditionRemoved || needReferenceRemoved) && PERMISSION.test(text);
  // Hepsi saf yüklem; ucuzdan pahalıya kısa devre (tamamı zaten tutulan uzun cevapta kalan metin boşuna taranmaz — süre pini).
  if (forceHold || !informative || partial() || notice() || defersDecisionToHost(text) || remainderHedge() || conditionalYes()) {
    return { text: reply, removals, nothingLeft: true, draft };
  }
  return { text, removals, nothingLeft: false, draft: text };
}

export interface HostContactFillerResult {
  /** Gönderilecek metin (bir şey çıkarılmadıysa ya da yalnız bu cümleler varsa birebir aynı). */
  text: string;
  /** Cevap yalnız çıkarılması gereken ev sahibine başvurma talimatından oluşuyor → kapı tutar (ev sahibi yanıtlar). */
  hostContactOnly: boolean;
  removals: HostContactRemoval[];
  /** Ev sahibinin taslağı (başvurma cümleleri çıkarılmış; `hostContactOnly` iken de). */
  draft: string;
}

/** Uyumluluk sarmalayıcısı (eski imza): misafir metni ve bilgi tabanı artık karar vermez (K-1029-C) — yalnız imza korunur. */
export function stripHostContactFiller(reply: string, _guestTexts?: readonly string[], _kbTexts?: readonly string[]): HostContactFillerResult {
  const a = analyzeHostContact(reply);
  return { text: a.text, hostContactOnly: a.nothingLeft, removals: a.removals, draft: a.draft };
}
