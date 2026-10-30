// ---------------------------------------------------------------------------
// "EV SAHİBİNİZE YAZIN / ARAYIN" MİSAFİRE YAZILMAZ — HER DİLDE, HER BİÇİMDE (kurucu kararları R13-b / R13-c 10-28 gece ve K-1029-A/B/C
// 10-29 gece; aynen `docs/INCELEME-2026-10-28-gece-dongusu.md` 10-29 bölümü, tasarım `docs/TASARIM-2026-10-29-ev-sahibine-yonlendirme-yasagi.md`):
//   "zaten hostla yazışıyorlar" · "cümle silinir, doğru cevap gider, cevapsız soru AÇIK kalır, asla 'cevaplandı' değil" · GD5: "yalnız
//   talimat yan cümlesi silinir, bilgi gider" (geçici) · "ek / koşul eki sezgileri karar vermesin, anlamı model okusun".
//
// Kural (saf; `suggestReply` cevabın SON adımında çağırır → kanal, QR, "AI öner", Ayarlar testi, demo aynı):
//   · Misafiri ev sahibine yazmaya / ulaşmaya / aramaya / sormaya gönderen HER cümle çıkar (`hostContactKindOf`: bilgi yönlendirmesi,
//     koşullu başvurma, yedi dilli başvurma + ev sahibinin sesiyle "bize yazın"). "Yazın" hiçbir koşulda kalmaz.
//   · "Arayın" model sinyali olmadan TUTULMAZ (koşul ekiyle "misafir varsayımsal sordu" sezgisi KALDIRILDI — K-1029-C: ek sezgisi karar
//     vermez). Model sinyali (`AI_UNDERSTANDING_SITUATION_ENABLED`, kapalı) ölçülene kadar sorusu ev sahibine açık kalır (kurucuya soru F1).
//   · Güvenlik uyarısı (gaz / yangın / duman / acil NUMARA YÖNERGESİ) "arayın" cümlesinde KALIR; tehlike sözcüğü dar okunur ("Fire TV", "gas
//     station", "smoke-free", "gaz ocağı" uyarı değil; çıplak "110 / 112" sayısı yalnız "112'yi arayın / call 112 / im Notfall 112" biçiminde).
//     Güvenlik talimatında YAZMA / haber verme kuyruğu ("…, pencereleri açın ve ev sahibinize yazın") yalnız kuyruk olarak silinir, talimat
//     kalır; kuyruk temiz ayrılamıyorsa cevabın TAMAMI tutulur — güvenlik talimatı asla sessizce düşmez (Opus F9).
//   · GD5 yan cümle: cümlenin KOŞULSUZ baş yan cümle(ler)i bilgi taşıyorsa onlar kalır, ilk koşul / talimat yan cümlesinden SONUNA kadar her
//     şey çıkar ("…yazın, kendisi teknisyen gönderir" koşulsuz söze dönmesin). Kalan metin özgün sözcüklerin özgün sırasıdır (yalnız SİLME);
//     dedektör kalan metne yeniden koşar; şüphede bütün cümle çıkar. İki nokta yan cümle sınırı DEĞİLDİR ("Otopark: ev sahibinize sorun" —
//     iki noktanın önü yönlendirmenin konusudur) ve baş kısım yalnız KONU ETİKETİ ya da nezaketse ("For the sauna", "Sauna için", "Of
//     course", "Merhaba Ayşe") kesim geçersizdir — bütün cümle çıkar (Opus F1 / F8).
//   · Satır sonuyla bölünmüş cümle ("…, message\nyour host.") önce birleştirilir (Opus F4).
//   · Çıkan her parçanın kaydı (`removals`): tür, biçim, yan cümle mi, ayırt edici kökler, konu, genel mi — METİN YOK (saklanmaz, izlere
//     yazılmaz). Kökler / konular yönlendirmenin KAPSAMINDAN okunur: konusuz bilgi yönlendirmesi ("Detaylar için / Bu konuda ev sahibinize
//     danışın") önceki cümlenin konusunu taşır; bilgi yönlendirmesi asla "genel" değildir (Opus F6 / F11). Hangi isteğin açık kalacağına
//     çağıran karar verir (`conversation-items/host-contact-settle.ts`).
//   · Geriye selam / nezaket dışında içerik kalmazsa, kalan metin belirsizlik / yetersizlik / özür söylüyorsa ("emin değilim", "net değil",
//     "ayarlayamıyorum", "sorry" — eski "yönlendirme = bilgim yok" ağı bunları da örtüyordu, Opus F5), ya da başvurma cümlesi bir devir /
//     görünürlük bildirimi taşıyorsa (K10, Opus F7) metne DOKUNULMAZ, `nothingLeft` → kapı tutar, ev sahibi yanıtlar. O zaman da TASLAK
//     (`draft`) silinmiş metindir — yasaklı cümle "AI öner"e / hazır taslağa yazılmaz (Opus F10).
// Misafire yeni söz EKLENMEZ; yalnız ÇIKARILIR. Kalan metin bütün kapılardan yine geçer. Doğrusal.
// ---------------------------------------------------------------------------

import { hostContactKindOf, isConditionLikeClause, namesWriteContact, type HostContactKind } from "./absence";
import { contentStemsOf, isSubstantiveSentence, replySentencesOf } from "./no-instruction-filler";
import { carriesHandoffNotice } from "./output-veto";
import { defersDecisionToHost } from "./availability-claims";
import { isGreetingOnly } from "./code-greeting";
import { distinctiveTokens } from "@/lib/conversation-items/topic-absence";
import { topicsWithSymptomsOf } from "@/lib/conversation-items/relation";

/**
 * Güvenlik uyarısı: gerçek tehlike / acil servis sözcüğü taşıyan cümle (genel "acil durumda ev sahibinizi arayın" kapanışı DEĞİL).
 * GD9 (gece döngüsü 10-29): Türkçe gövdeler tehlike sözcüğüne benzeyen adları dışlar — gazete / gazino / gazoz / gazi (Gaziantep), polisaj /
 * polisiye / polister, karbonat. K-1029-A: "Fire TV / Fire Stick", "gas station", "smoke-free" de uyarı değildir. Opus F3 (10-30): cihaz adı
 * ("gaz ocağı", "gas stove", "Gasherd") tehlike değildir; acil NUMARA çıplak sayı olarak sayılmaz (otopark 110, oda 112, 155 TL) — yalnız arama
 * yönergesiyle ("112'yi arayın", "call / dial 112", "звоните 112") ya da acil sözcüğüyle ("im Notfall 112", "acil durumda 112").
 */
const SAFETY_HAZARD =
  /(?<![\p{L}\p{N}])(?:gaz(?!ete|ino|oz|i|l[ıi])(?!\s+(?:oca[kğ]|soba|f[ıi]r[ıi]n))\p{L}{0,8}|gas(?!\s*(?:station|stove|cooker|hob|oven|burner|grill|bbq|barbecue))|yang[ıi]n\p{L}{0,8}|fire(?!\s*(?:tv|stick|place|pit|wood))|duman\p{L}{0,8}|smoke(?![-\s]?free)|karbon(?!at)\p{L}{0,8}|carbon monoxide|co (?:alarm|detector)|monoxyde de carbone|mon[óo]xido de carbono|угарн\p{L}{0,4}|gas(?:geruch|leck\p{L}{0,2}|austritt|alarm)|kohlenmonoxid\p{L}{0,2}|(?:rauch|brand|feuer|co-?)melder\p{L}{0,2}|itfaiye\p{L}{0,8}|ambulans\p{L}{0,8}|ambulance|polis(?!aj|iye|ter)\p{L}{0,8}|police|feuer(?!zeug|stelle)|rauch(?!er|en)|incendie|fumée|incendio|humo|пожар\p{L}{0,4}|газ(?!ет)\p{L}{0,4}|дым\p{L}{0,4})(?![\p{L}\p{N}])/iu;
const EMERGENCY_NUMBER = new RegExp(
  "(?:(?<![\\p{L}])(?:call|dial|ring|phone|ara(?:y[ıi]n(?:[ıi]z)?|yabilirsiniz|man[ıi]z)?|r[uü]fen sie|w[äa]hlen sie|appelez|composez|llame|marque|звоните|позвоните|наберите)" +
    "(?:\\s+(?:the|die|le|el|номер|number|numaras[ıi]))?\\s+" +
    "|(?<![\\p{L}])(?:acil(?:\\s+durum\\p{L}{0,4})?|emergency|emergencies|notfall|notruf|urgence|urgences|emergencia|экстренн\\p{L}{0,4})[\\p{P}\\s]+(?:\\p{L}+\\s+){0,2}?)" +
    "(?:112|911|110|155|187|999)(?![\\p{N}])" +
    "|(?<![\\p{N}])(?:112|911|110|155|187|999)\\s*['’]?\\s*(?:y[ıi]|ye|ya|[ıi])?\\s+(?:ara\\p{L}{0,8}|ula[şs]\\p{L}{0,8}|call|dial)",
  "iu",
);

export function isSafetyWarningSentence(sentence: string): boolean {
  return SAFETY_HAZARD.test(sentence) || EMERGENCY_NUMBER.test(sentence);
}

/**
 * Çıkarılan parçada sayılmayan köklerin başlangıçları (katlanmış ASCII, aksansız): ev sahibi adları, iletişim fiilleri, genel sorun / koşul /
 * nezaket sözcükleri, yedi dilin işlev sözcükleri. Kalan kök yoksa çıkarılan koşullu parça GENEL kapanıştır (hiçbir isteğe ait değildir).
 * Opus F12 (10-30): karşılaştırma aksanı / Kiril büyük-küçük harfi katlayarak yapılır ("écrivez", "hôte", "problème" eskiden kök sayılıyordu).
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
  "out more further detai detay bilgi info ayrint diger baska other else weitere andere autre otra otro друг " +
  // Zamirle gönderme ("message him", "ona yazın", "schreiben Sie ihm", "écrivez-lui", "напишите ему") — zamir konu değildir.
  "him her them ona kendisi onlar ihm lui leur ему ей им нему ней just einfach понадоб"
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
 * ADRES konusuna çeviriyordu; cevaplanmış adres isteği açılıyor, asıl sauna isteği "cevaplandı" kapanıyordu). "konum" (yer) dışarıda.
 */
const REFERRAL_MARKER_WORDS = /(?<![\p{L}])(?:konu(?!m)\p{L}{0,8}|hakk[ıi]nda|ilgili)(?![\p{L}])/giu;

/** Ayrıntı / bilgi isteyen yönlendirme ("Detaylar için", "for more information", "für weitere Informationen") — konu cevapsız kalmıştır. */
const DETAIL_MARKER =
  /(?<![\p{L}])(?:detay\p{L}{0,8}|ayr[ıi]nt\p{L}{0,8}|bilgi\p{L}{0,8}|details?|info|information|specifics?|einzelheiten|infos|informationen|d[ée]tails?|pr[ée]cisions?|renseignements?|detalles?|informaci[óo]n|подробн\p{L}{0,6}|информаци\p{L}{0,4}|تفاصيل|معلومات)(?![\p{L}])/iu;

/** "Diğer / başka sorularınız için …" — yönlendirme belli bir isteği değil GERİ KALANI anar (genel kapanış). */
const OTHER_MARKER = /(?<![\p{L}])(?:diğer|diger|başka|baska|other|else|weitere\p{L}{0,2}|andere\p{L}{0,2}|autres?|otras?|otros?|друг\p{L}{0,4}|أخرى|اخرى)(?![\p{L}])/iu;

export interface HostContactRemoval {
  kind: HostContactKind;
  /** Bilgi yönlendirmesi ("… için ev sahibinize sorabilirsiniz") ya da koşullu / kapanış başvurması. */
  form: "referral" | "conditional";
  /** Cümlenin bir yan cümlesi çıkarıldı (bilgi taşıyan baş kısım kaldı). */
  appendix: boolean;
  /** Çıkan parçanın (ya da konusuz yönlendirmede önceki cümlenin) ayırt edici kökleri (ev sahibi / iletişim / genel sorun sözcükleri hariç). */
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
  /** Kapı cevabın TAMAMINI tutar (selam / nezaket dışında içerik kalmadı, kalan metin belirsizlik söylüyor ya da bildirim taşıyor). */
  nothingLeft: boolean;
  /**
   * Ev sahibinin taslağı: başvurma cümleleri ÇIKARILMIŞ metin (`nothingLeft` iken de; selamdan ibaret kalırsa boş). Yasaklı cümle taslağa
   * yazılmaz (tasarım A3 / S9, Opus F10).
   */
  draft: string;
}

/** Çıkan parça + konusuz bilgi yönlendirmesinde önceki cümle → kayıt. Selam ve hitap adı (misafirin adı) kök sayılmaz (Opus P3-f). */
function removalOf(kind: HostContactKind, removed: string, appendix: boolean, previous: string | null): HostContactRemoval {
  const form = kind === "referral" ? "referral" : "conditional";
  const read = (text: string) => {
    const body = withoutLeadingSalutation(text);
    const stems = distinctiveTokens(body).filter((t) => !isNoiseStem(t));
    const topics = topicsWithSymptomsOf(body.replace(REFERRAL_MARKER_WORDS, " "));
    return { stems, topics };
  };
  let { stems, topics } = read(removed);
  // "Diğer sorularınız için" GERİ KALANI anar; koşul / kapanış izi ("Herhangi bir sorunda", "feel free", "bei Fragen", "если возникнут
  // вопросы") genel kapanıştır. AYRINTI isteyen yönlendirme ("Detaylar için", "If you need more details", "for more information") CEVAPSIZ
  // bir bilgi isteğine işaret eder → koşul izi taşısa da genel değildir (Opus F6: sahipsizse beyan edilen her istek açılır).
  const other = OTHER_MARKER.test(removed);
  const detail = DETAIL_MARKER.test(removed);
  const closing = !detail && (other || form === "conditional" || isConditionLikeClause(removed));
  // Konusuz bilgi yönlendirmesi ("Detaylar için / Bu konuda / for details ev sahibinize danışın", "If you need more details, message your
  // host") önceki cümlenin (yan cümle kesiminde baş kısmın) konusuna gönderir (Opus F6 / F11). Başvurma kapanışı ("Varınca ev sahibinizi
  // arayın", "Herhangi bir sorunda ev sahibinize yazın") genel kalır: istekleri kapsama kuralı (`host-contact-settle.ts` kural 4) okur.
  if (!closing && stems.length === 0 && topics.length === 0 && previous) ({ stems, topics } = read(previous));
  stems = [...new Set(stems)].sort();
  topics = [...new Set(topics)].sort();
  const generic = stems.length === 0 && topics.length === 0 && closing;
  return { kind, form, appendix, stems, topics, generic };
}

/** Yan cümle ayracı: virgül / noktalı virgül / Arapça virgül (ardından boşluk) ve sınırlı bağlaçlar. URL / saat bölünmez. İki nokta DEĞİL (F1). */
const CLAUSE_BOUNDARY = /[,;،](?=\s)|\s(?=(?:ve|ama|fakat|ancak|and|but|und|aber|et|mais|y|pero|и|но|و)\s)/gu;
/** Yalnız güçlü ayraç (noktalı virgül / Arapça virgül) — bilgi yönlendirmesinde virgülden önceki kısım çoğu zaman yönlendirmenin KONUSUDUR
 *  ("For the sauna, please message your host"), noktalı virgülden önceki kısım ise ayrı bir bilgi cümlesidir. */
const STRONG_BOUNDARY = /[;،](?=\s)/gu;
const LEADING_CONJ = /^(?:ve|ama|fakat|ancak|and|but|und|aber|et|mais|y|pero|и|но|و)\s+/iu;
/** `CLAUSE_BOUNDARY`ın durumsuz (g bayraksız) eşi — yalnız "cümlede yan cümle ayracı var mı". */
const CLAUSE_BOUNDARY_TEST = new RegExp(CLAUSE_BOUNDARY.source, "u");
const CLAUSE_BOUNDARY_TEST_G = new RegExp(CLAUSE_BOUNDARY.source, "gu");
/**
 * Koşulla AYNI yan cümledeki emir (adım): Türkçe yüklem sonda ("Duman dedektörü öterse balkon kapısını açın"; koşul eki "-sanız" değil),
 * Almanca "drehen Sie", Fransızca "ouvrez" ("vous sentez" değil), Rusça "откройте". Sınırlı, doğrusal.
 */
const IMPERATIVE_STEP: readonly RegExp[] = [
  /\p{L}{2,}(?:[ıiuü]n|[ıiuü]n[ıiuü]z|y[ıiuü]n)\s*$/u,
  /(?<![\p{L}])\p{L}{2,}en sie(?![\p{L}])/iu,
  /(?<!vous )(?<![\p{L}])\p{L}{2,}ez(?![\p{L}])/iu,
  /(?<![\p{L}])\p{L}{2,}(?:ите|йте)(?![\p{L}])/iu,
];
/** Türkçe ulaç zinciri ("açıp", "kapatıp", "çıkıp") — virgülsüz ardışık adım. */
const CONVERB_CHAIN = /\p{L}{2,}[ıiuü]p(?![\p{L}])/u;

/**
 * Baş kısım yalnız KONU ETİKETİ mi (Opus F1): önden konu edatı + en çok dört sözcük ("For the sauna", "Regarding late checkout", "Zur Sauna",
 * "Pour le parking", "Sobre el aparcamiento", "По поводу парковки") ya da Türkçe arkadan edat ("Sauna için", "Otopark konusunda", "Havuz
 * hakkında"). Sayı taşıyan baş kısım etiket değildir. Sabit uzunluklu, çapalı — doğrusal.
 */
const TOPIC_LABEL_HEAD = new RegExp(
  "^(?:[-•*]\\s*)?(?:" +
    "(?:for|about|regarding|concerning|re|as for|as to|as regards|with regard to|in regard to|with respect to|in terms of|on|zu[rm]?|f[üu]r|wegen|bez[üu]glich|hinsichtlich|betreffend|pour|concernant|quant [àa]|[àa] propos d(?:e|u|es|['’])|au sujet d(?:e|u|es|['’])|para (?:el|la|los|las|su|tu)|sobre|en cuanto a|respecto a|acerca d(?:e|el)|по поводу|насч[её]т|относительно|касательно|о|об|для|بخصوص|بالنسبة ل\\p{L}{0,4}|حول|عن)" +
    "(?:\\s+[\\p{L}'’-]+){1,4}" +
    "|(?:[\\p{L}'’-]+\\s+){1,4}(?:i[çc]in|konusunda|konusuyla|hakk[ıi]nda|ile ilgili|bak[ıi]m[ıi]ndan|a[çc][ıi]s[ıi]ndan)" +
    ")$",
  "iu",
);
/** Baş kısım yalnız nezaket / onay mı ("Of course", "Sure", "Tabii", "Elbette", "Natürlich", "Bien sûr", "Claro", "Конечно") — Opus F8 ek. */
const COURTESY_HEAD =
  /^(?:of course|sure|certainly|absolutely|definitely|no problem|tabii(?: ki)?|elbette|kesinlikle|memnuniyetle|nat[üu]rlich|gerne|selbstverst[äa]ndlich|bien s[ûu]r|avec plaisir|claro(?: que s[ií])?|por supuesto|con gusto|конечно|разумеется|بالتأكيد|طبعا)$/iu;

function isLabelHead(head: string): boolean {
  const h = head.trim();
  if (/\d/.test(h)) return false;
  return TOPIC_LABEL_HEAD.test(h) || COURTESY_HEAD.test(h) || isBareGreeting(h);
}

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
  /** Kesim yalnız ilk silinen yan cümle bir KOŞULSA geçerli ("Havlular dolapta, internet giderse … sorun") — bilgi yönlendirmesinde
   *  koşulsuz virgül kesimi yönlendirmenin konusunu bırakırdı ("For the sauna, please message your host"). */
  requireConditionBreak = false,
): { kept: string; removed: string } | null {
  const body = sentence.trimEnd();
  const endPunct = /[.!?。]+$/u.exec(body)?.[0] ?? "";
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
  const head = core.slice(0, keepUntil).replace(/[\s,;:،]+$/u, "").trimEnd();
  if (!head || !isSubstantiveSentence(head) || !carriesInformation(head) || isLabelHead(head)) return null;
  const kept = `${head}${endPunct || "."}`;
  // Kalan baş kısım da başvurma ya da koşul taşıyorsa (kesim temiz değil) bütün cümle çıkar.
  if (hostContactKindOf(kept) !== null || isConditionLike(head)) return null;
  return { kept, removed: core.slice(keepUntil) };
}

/**
 * Güvenlik talimatının SON yan cümlesi başvurma ise ("If you smell gas, turn off the valve, open the windows and message your host") yalnız
 * o kuyruk çıkar; kalan baş kısım başvurma taşımamalı, güvenlik uyarısı olarak kalmalı ve koşuldan başka bir ADIM taşımalı. Baş kısım yalnız
 * koşulsa ("If you smell gas, message your host") `"conditionOnly"` — kaybedilecek adım yok, cümle bütün çıkar ("If you smell gas." gitmez).
 * Olmazsa `null` (çağıran adım varsa cevabın tamamını tutar).
 */
function cutTrailingContactClause(sentence: string): { kept: string; removed: string } | "conditionOnly" | null {
  const body = sentence.trimEnd();
  const endPunct = /[.!?。]+$/u.exec(body)?.[0] ?? "";
  const core = body.slice(0, body.length - endPunct.length);
  const cuts: number[] = [];
  for (const m of core.matchAll(CLAUSE_BOUNDARY)) cuts.push(m.index ?? 0);
  for (let i = cuts.length - 1; i >= 0; i--) {
    const tail = core.slice(cuts[i]).replace(/^[\s,;:،]+/u, "").replace(LEADING_CONJ, "");
    if (hostContactKindOf(tail) === null) continue;
    const head = core.slice(0, cuts[i]).replace(/[\s,;:،]+$/u, "").trimEnd();
    if (!head || hostContactKindOf(head) !== null || !isSafetyWarningSentence(head)) return null;
    const steps = head
      .split(CLAUSE_BOUNDARY_TEST_G)
      .map((c) => c.replace(/^[\s,;:،]+/u, "").replace(LEADING_CONJ, "").trim())
      .filter(Boolean);
    if (!steps.some((c) => !isConditionLike(c) || IMPERATIVE_STEP.some((re) => re.test(c)))) return "conditionOnly";
    return { kept: `${head}${endPunct || "."}`, removed: core.slice(cuts[i]) };
  }
  return null;
}

/** Kalan baş kısım BİLGİ taşıyor mu: sayı ya da genel sorun / nezaket / konaklama sözcüğü olmayan içerik kökü ("During your stay",
 *  "Teşekkürler", "Enjoy your stay" bilgi değildir — GD5 mutasyonları G5c / G5g, Opus F8). Kökler `contentStemsOf` biçiminde (ilk 5 harf). */
const GENERIC_TROUBLE_STEMS = new Set([
  "sorun", "probl", "issue", "herha", "anyth", "somet", "wrong", "durum", "ihtiy", "konak", "stay", "shoul", "troub", "quest", "conce",
  "yardi", "help", "helpi", "assis", "memnu", "happy", "glad", "sevin", "olsun", "durin", "need", "neede", "olurs", "yasar", "yasad",
  "tesek", "thank", "merci", "danke", "graci", "спаси",
  // Opus F8 (10-30): nezaket / temenni / onay — yedi dil.
  "messa", "mesaj", "mesaj", "enjoy", "hope", "hopin", "havin", "great", "time", "nice", "lovel", "wonde", "pleas", "welco", "cours",
  "sure", "certa", "absol", "defin", "keyif", "umari", "umarı", "gecer", "geçer", "gecir", "geçir", "hosge", "hoşge", "diler", "diliy",
  "tabii", "elbet", "nachr", "genie", "aufen", "schön", "schon", "profi", "sejou", "séjou", "bonne", "agrea", "disfr", "estan", "mensa",
  "natur", "gerne", "claro", "supue", "конеч", "прият", "отдых", "сообщ", "хорош", "votre", "about", "regar", "glück", "gluck",
  // 10-30 tekrar oynatma: "Thank you for letting me know, Alex.", "Rica ederim." (rica ederim / you're welcome / de rien / de nada).
  "letti", "know", "rica", "ederi", "rien", "nada", "gesch", "пожал", "عفوا",
]);
function carriesInformation(clause: string): boolean {
  const body = withoutLeadingSalutation(clause);
  if (/\d/.test(body)) return true;
  // Cümle içindeki BÜYÜK harfli sözcük (hitap adı: "…, Alex.") nezaketi bilgiye çevirmez — yalnız bu okumada sayılmaz.
  const withoutNames = body.replace(/(?<=[\p{L}\p{N},;:]\s+)\p{Lu}[\p{Ll}'’-]+/gu, " ");
  return contentStemsOf(withoutNames).some((stem) => !GENERIC_TROUBLE_STEMS.has(stem));
}

function isConditionLike(clause: string): boolean {
  return isConditionLikeClause(clause);
}

/**
 * Yalnız selam ("Здравствуйте, Alex!", "Merhaba Ayşe,", "Hi Alex") — silmeden sonra geriye bu kalırsa içerik kalmamıştır (10-30 tekrar
 * oynatma: Rusça selam tek başına misafire gidiyordu). Selam + en çok üç ad sözcüğü; sınırlı tekrar, doğrusal.
 */
const GREETING_WORDS =
  "(?:merhaba|selam(?:lar)?|iyi (?:günler|akşamlar|geceler)|günaydın|hello|hi|hey|dear|good (?:morning|afternoon|evening)|hallo|guten (?:tag|morgen|abend)|liebe[rs]?|bonjour|bonsoir|salut|hola|buenos días|buenas (?:tardes|noches)|здравствуйте|привет|добрый (?:день|вечер)|доброе утро|مرحبا|أهلا|السلام عليكم)";
const BARE_GREETING = new RegExp(`^\\s*${GREETING_WORDS}(?:[\\s,،!.]+[\\p{L}'’-]+){0,3}[\\s,،!.]*$`, "iu");
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

/**
 * Kayıt / görünürlük BİLDİRİMİ (K10 sınıfı) — çıktı vetosunun kalıbında olmayan biçimler (10-30 tekrar oynatma ölçtü, hepsi Rusça modelden):
 * "ваш запрос зафиксирован, хозяин может его увидеть", "Ваше сообщение … записано; хозяин сможет его увидеть", "your host will be able to
 * see it". Başvurma cümlesi bunu taşıyorsa cevabın TAMAMI tutulur (Opus F7: yalnız "silmemek" yetmiyordu — olay koşullu biçimde hiçbir kural
 * tutmuyor, talimat + bildirim birlikte gidiyordu).
 */
const VISIBILITY_NOTICE = new RegExp(
  [
    "(?:хозя|владел)\\p{L}{0,4}\\s+(?:\\p{L}+\\s+){0,2}?(?:может|сможет|увидит)(?:\\s+\\p{L}+){0,2}?\\s+увидеть",
    "(?:хозя|владел)\\p{L}{0,4}\\s+(?:\\p{L}+\\s+){0,1}?увидит",
    "(?:сообщени|запрос|просьб|заявк)\\p{L}{0,4}\\s+(?:[\\p{L}-]+\\s+){0,6}?(?:зафиксирован|записан|сохранен|зарегистрирован|передан)",
    "(?:host|owner)\\s+(?:can|will|may)\\s+(?:also\\s+)?(?:be\\s+able\\s+to\\s+)?(?:see|view|read)\\s+(?:it|this|your)",
    "gastgeber\\p{L}{0,2}\\s+(?:kann|wird)\\s+(?:sie|es|ihre?)\\s+(?:\\p{L}+\\s+)?(?:sehen|lesen)",
  ].join("|"),
  "iu",
);

function isBareGreeting(sentence: string): boolean {
  return isGreetingOnly(sentence.trim()) || BARE_GREETING.test(sentence);
}

/**
 * Silmeden sonra kalan metin belirsizlik / yetersizlik / paylaşılmamış bilgi / müsaitliğe bağlılık / özür söylüyor mu (Opus F5 — AKLAMA):
 * eskiden yönlendirme cümlesi `admitsMissingKnowledge` ile cevabın TAMAMINI tutuyordu ve bu zayıf yokluk cümlelerini de örtüyordu; silme o
 * ağı kaldırınca "I'm not sure about the sauna hours." / "Telefon numarası paylaşılmamış." misafire gidiyordu. Kapalı liste, alt dize
 * (doğrusal); ŞÜPHEDE TUT yönünde. Üç biçim: Türkçe küçültme, genel küçültme, aksansız.
 */
const REMAINDER_HOLD = [
  // TR
  "emin değil", "emin degil", "kesin değil", "kesin degil", "net değil", "net degil", "belli değil", "belli degil", "bilmiyorum", "bilemiyorum",
  "söyleyemem", "soyleyemem", "söyleyemiyorum", "soyleyemiyorum", "teyit edemi", "teyit edeme", "doğrulayamı", "dogrulayami", "doğrulayamam",
  "dogrulayamam", "paylaşılmamış", "paylasilmamis", "belirtilmemiş", "belirtilmemis", "yazılmamış", "yazilmamis", "bilgi verilmemi", "bilgi verilmemi",
  "ayarlayamı", "ayarlayami", "ayarlayamam", "garanti edeme", "garanti edemi", "müsaitliğe bağlı", "musaitlige bagli", "duruma bağlı",
  "duruma bagli", "üzgünüm", "uzgunum", "üzgünüz", "uzgunuz", "kusura bakma", "özür dile", "ozur dile",
  // EN
  "not sure", "unsure", "not certain", "uncertain", "can't confirm", "cannot confirm", "not able to confirm", "unable to confirm",
  "can't say", "cannot say", "can't tell", "cannot tell", "don't know", "do not know", "not been shared", "hasn't been shared",
  "wasn't shared", "not specified", "not been specified", "not mentioned", "can't arrange", "cannot arrange",
  "unable to arrange", "not able to arrange", "can't guarantee", "cannot guarantee", "depends on availability", "subject to availability",
  "depending on availability", "sorry", "apologi", "i'm afraid", "i am afraid",
  // DE
  "nicht sicher", "weiß nicht", "weiss nicht", "nicht sagen", "nicht bestätigen", "nicht bestatigen", "keine angaben", "nicht angegeben",
  "nach verfügbarkeit", "nach verfugbarkeit", "von der verfügbarkeit", "von der verfugbarkeit", "entschuldig", "tut mir leid", "tut uns leid",
  // FR
  "pas sûr", "pas sur ", "pas certain", "ne sais pas", "ne peux pas confirmer", "pas en mesure", "pas précisé", "pas precise", "pas indiqué",
  "pas indique", "selon disponibilit", "sous réserve de disponibilit", "sous reserve de disponibilit", "désolé", "desole", "excus",
  // ES
  "no estoy segur", "no sé", "no se si", "no puedo confirmar", "no puedo garantizar", "no se ha indicado", "no está especificad",
  "no esta especificad", "según disponibilidad", "segun disponibilidad", "sujeto a disponibilidad", "lo siento", "disculp", "perdón", "perdon",
  // RET (10-30 tekrar oynatma: "Başka bir dairenin giriş kodunu paylaşamam." eskiden yönlendirmeyle birlikte TAMAMEN tutuluyordu; kurucuya
  // soru — o zamana kadar eskisi gibi tutulur).
  "paylaşama", "paylasama", "can't share", "cannot share", "unable to share", "not able to share", "can't provide", "cannot provide",
  "nicht teilen", "nicht weitergeben", "ne peux pas partager", "ne peux pas communiquer", "ne peux pas donner", "no puedo compartir",
  "no puedo facilitar", "no puedo dar", "не могу поделиться", "не могу сообщить", "не могу дать", "لا يمكنني مشاركة",
  // RU
  "не уверен", "не знаю", "не могу подтвердить", "не могу сказать", "не указан", "зависит от наличия", "извин", "сожалению, я",
  // AR
  "لست متأكد", "لا أعرف", "لا اعرف", "لا يمكنني تأكيد", "آسف", "اسف", "نعتذر", "حسب التوفر",
] as const;
function remainderNeedsHost(text: string): boolean {
  const plain = text.replace(/[’‘]/g, "'");
  const forms = [plain.toLocaleLowerCase("tr"), plain.toLowerCase()];
  forms.push(forms[1].normalize("NFKD").replace(/\p{M}/gu, ""));
  return REMAINDER_HOLD.some((h) => forms.some((f) => f.includes(h)));
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

export function analyzeHostContact(reply: string): HostContactAnalysis {
  if (!reply.trim()) return { text: reply, removals: [], nothingLeft: false, draft: reply };
  const removals: HostContactRemoval[] = [];
  let forceHold = false;
  let previous: string | null = null;
  const lines = logicalLines(reply).map((group) => {
    const joined = group.length === 1 ? group[0] : group.map((l) => l.trim()).join(" ");
    const out: string[] = [];
    let changed = false;
    for (const s of replySentencesOf(joined)) {
      const kind = hostContactKindOf(s);
      if (!kind) {
        out.push(s);
        if (s.trim()) previous = s;
        continue;
      }
      changed = true;
      // 🚨 K10 DEVİR / BİLDİRİM taşıyan başvurma cümlesi ("If anything breaks, message your host; your host can also see it", "напишите
      // хозяину — хозяин сможет его увидеть"): kurucu kuralı "Hiçbir şey gitmesin" → cevabın TAMAMI tutulur (Opus F7). Yalnız silmemek
      // yetmiyordu: olay koşullu biçimde hiçbir aşağı kural tutmuyor, talimat + bildirim birlikte gidiyordu.
      if (carriesHandoffNotice(s) || VISIBILITY_NOTICE.test(s)) {
        forceHold = true;
        removals.push(removalOf(kind, s, false, previous));
        continue;
      }
      // Güvenlik uyarısı: "arayın" cümlesi kalır ("Gaz kokusu alırsanız 112'yi arayın ve ev sahibinize ulaşın"); YAZMA / haber verme kuyruğu
      // varsa yalnız kuyruk çıkar, talimat kalır — ayrılamıyorsa cevabın tamamı tutulur (Opus F9: talimat sessizce düşmesin).
      if (isSafetyWarningSentence(s)) {
        if (kind !== "write" && !namesWriteContact(s)) {
          out.push(s);
          previous = s;
          continue;
        }
        const tail = cutTrailingContactClause(s);
        if (tail === "conditionOnly") {
          removals.push(removalOf(kind, s, false, previous));
          continue;
        }
        if (tail === null) {
          // Tek yan cümlelik "koşul + yazın" ("Gaz kokusu alırsanız ev sahibinize yazın.") kaybedilecek bir güvenlik ADIMI taşımaz → cümle
          // çıkar ("yazın" hiç kalmaz). Ayraçlı ya da ulaç zincirli ("pencereleri açıp ev sahibinize yazın") cümle temiz ayrılamadıysa
          // adım sessizce düşmesin → cevabın tamamı tutulur.
          const steps = CLAUSE_BOUNDARY_TEST.test(s) || CONVERB_CHAIN.test(s);
          if (steps) forceHold = true;
          removals.push(removalOf(kind, s, false, previous));
          continue;
        }
        out.push(tail.kept + (/\s$/u.test(s) ? " " : ""));
        removals.push(removalOf(kind, tail.removed, true, tail.kept));
        previous = tail.kept;
        continue;
      }
      // Bilgi yönlendirmesi ("Sauna için, lütfen ev sahibinize yazın") virgülden kesilmez: baş kısmı yönlendirmenin KONUSUDUR, bilgi değil.
      const cut =
        kind === "referral"
          ? (splitInstructionClausesWithTail(s, true) ?? splitInstructionClausesWithTail(s, false, true))
          : splitInstructionClausesWithTail(s);
      if (cut !== null) {
        out.push(cut.kept + (/\s$/u.test(s) ? " " : ""));
        removals.push(removalOf(kind, cut.removed, true, cut.kept));
        previous = cut.kept;
      } else {
        removals.push(removalOf(kind, s, false, previous));
      }
    }
    const text = out.join("").trim();
    return { text: changed ? text : group.join("\n"), dropped: changed && text === "" && joined.trim() !== "" };
  });
  if (removals.length === 0) return { text: reply, removals, nothingLeft: false, draft: reply };
  // Tamamen çıkarılan satır düşer; özgün boş satır (paragraf arası) kalır.
  const text = lines
    .filter((l) => !l.dropped)
    .map((l) => l.text)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const sentences = text.split("\n").flatMap((l) => replySentencesOf(l));
  const informative = sentences.some((s) => isSubstantiveSentence(s) && !isBareGreeting(s) && carriesInformation(s));
  const draft = sentences.some((s) => s.trim() && !isBareGreeting(s)) ? text : "";
  // Silmeden sonra kalan metin kararı ev sahibine bırakıyorsa ("Erken giriş ev sahibinin kararıdır", "это решение принимает хозяин") ya da
  // belirsizlik / yetersizlik / özür söylüyorsa yönlendirme bir cevabın parçası değil, CEVAPSIZLIĞIN parçasıdır → eskisi gibi tamamı tutulur
  // (10-30 tekrar oynatma + Opus F5: eskiden "yönlendirme = bilgim yok" kuralıyla tutulan bu cevaplar silmeden sonra gidiyordu; kurucu
  // kararları 10-01 "ev sahibinizin kararıdır misafire gitmez" ve 09-11 "bilgim yok misafire asla gitmez").
  if (forceHold || !informative || defersDecisionToHost(text) || remainderNeedsHost(text)) return { text: reply, removals, nothingLeft: true, draft };
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
