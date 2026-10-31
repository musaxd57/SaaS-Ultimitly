// ---------------------------------------------------------------------------
// DEVAM EDEN KİŞİSEL TEHLİKE — mahsur kalma · zorla giriş · tehdit / saldırı (kurucu 10-31, `docs/TASARIM-2026-10-31-devam-eden-tehlike-uyarisi.md`).
// SAF, LLM'siz, veritabanısız, YAPRAK modül (hiçbir şey import etmez: hem acil sözcük ağı `fallback.ts` hem tehlike okuyucusu
// `hazard-evidence.ts` kullanır — döngü olmasın).
//
// Kurucunun tablosu (aynen):
//   "Asansörde kaldık, çıkamıyoruz."               → acil uyarı
//   "Biri kapıyı zorluyor!"                        → "hırsız" kelimesi geçmese de acil uyarı
//   "Hırsızlığa karşı kasa var mı?"                → normal bilgi sorusu
//   "Asansörde mahsur kalırsak kimi arayacağız?"   → varsayımsal soru; tek başına aktif acil değil
// "Tek başına kelime eklemek doğru çözüm olmaz": isim ("hırsız", "asansör", "tehdit") DEĞİL, olayı BİLDİREN çekimli öbek aranır (üçüncü kişi
// zorlama — "kapıyı zorluyorum / zorladık" kapıda kalan misafirin kendisidir; "zorlamıyor" olumsuz). Öbek ögeleri arasına en çok iki kısa sözcük
// girebilir ("adam bizi bıçakla tehdit ediyor"). Kod AÇIK bildirimi yakalar; belirsizliği anlama modeli değerlendirir (model yoksa da açık
// bildirim kaybolmaz).
//
// Düzeyler (yan cümle başına, mesaj = en ağırı):
//   clear    — bildirim cümlesi ("Biri kapıyı zorluyor!"). Model geçersiz kılamaz; model yokken de uyarı.
//   possible — soru biçimi ("Kapıyı mı zorluyorlar?"), geçmiş / aktarılan anlatım ("Dün gece biri kapıyı zorladı", "yorumlarda … yazıyor") ya
//              da bitmiş olay ("… ama kurtulduk"): karar anlama modelinde.
//   none     — koşul / varsayım ("kalırsak", "kalma durumunda", "if someone breaks in"), olumsuz ("kimse girmedi", "nobody is breaking in"),
//              alıntı, böcek saldırısı, iş gereği zorlama ("çilingir kapıyı zorluyor"), ev sahibi / platform cezası "tehdidi".
// Kalıplar sabit sözcükle başlar, tekrarlar sınırlı ({0,n}, sözcük ≤20 harf); metin 8.000 karakterde kesilir, yan cümle sayısı sınırlı —
// karesel iş yok (süre pini `person-danger-cost.test.ts`).
// ---------------------------------------------------------------------------

export type PersonDangerKind = "trapped" | "intrusion" | "threat";
const PERSON_DANGER_KINDS: readonly string[] = ["trapped", "intrusion", "threat"];
export function isPersonDangerKind(kind: string): kind is PersonDangerKind {
  return PERSON_DANGER_KINDS.includes(kind);
}
export type PersonDangerLevel = "clear" | "possible" | "none";
export interface PersonDanger {
  level: PersonDangerLevel;
  kinds: PersonDangerKind[];
}

const L = "(?<![\\p{L}\\p{N}])";
const R = "(?![\\p{L}\\p{N}])";
const W = "\\p{L}{0,8}";
/** Araya giren en çok iki kısa sözcük ("bizi [bıçakla] tehdit", "kapıyı [hemen] zorluyor"). */
const F = "(?:\\p{L}{1,20} ){0,2}";
const rx = (parts: readonly string[]) => new RegExp(parts.map((p) => `${L}(?:${p})${R}`).join("|"), "u");
/** Arapça: bitişik ön ekler (و / ف / ال) sözcüğün parçası — sınır yalnız sağda. */
const rxAr = (parts: readonly string[]) => new RegExp(parts.map((p) => `(?:${p})`).join("|"), "u");
/** Türkçe 3. kişi şimdiki zaman ("zorluyor / zorluyo / zorluyorlar") — 1. kişi ("zorluyorum") eşleşmez. */
const yor = (stem: string) => `${stem}iyo(?:r)?(?:lar)?|${stem}uyo(?:r)?(?:lar)?`;

/** Katlama: küçük harf, Latin aksanı sökülür (ş→s, ğ→g, é→e, ñ→n), ı→i. Kiril / Arap yazısına dokunulmaz ("й" "и" olmasın). */
export function foldForPersonDanger(s: string): string {
  return s
    .replace(/İ/g, "i")
    .toLowerCase()
    .normalize("NFD")
    .replace(/(\p{Script=Latin})\p{M}+/gu, "$1")
    .normalize("NFC")
    .replace(/ı/g, "i")
    .replace(/[’`´]/g, "'")
    .replace(/\s+/g, " ");
}

const EN_SUBJ = "(?:someone|somebody|a man|a guy|some guy|some men|two men|a stranger|strangers|a person|men|people|they|he|she|a woman|a group)";
const EN_BE = "(?: is| are|'s|'re| has| have|'ve)?";
const ROOM_EN = "(?:apartment|flat|room|house|home|place|bedroom|unit)";

const TRAPPED = [
  rx([
    // TR
    `asansor(?:de|da|un icinde) (?:mahsur |kilitli )?(?:kaldik|kaldim|kaldilar|kaldi|kaldiniz)`,
    `asansor(?:de|da|un icinde) ${F}(?:sikistik|sikistim|sikistilar|sikisti)`,
    `mahsur (?:kaldik|kaldim|kaldilar|kaldi)`,
    `(?:banyo|tuvalet|oda|balkon|asansor|iceri|ice|daire|ev)${W} (?:kilitli|mahsur) (?:kaldik|kaldim|kaldilar|kaldi)`,
    `(?:iceride|icerde) (?:kilitli |mahsur )?(?:kaldik|kaldim|kaldilar) ${F}(?:cikamiyoruz|cikamiyorum|cikamiyorlar)`,
    `asansor ${F}(?:bozuldu|durdu|takildi|sikisti|arizalandi) ${F}(?:icinde|iceride|icerde)(?:yiz|yim|ler)?`,
    // EN
    `(?:stuck|trapped|locked) in (?:the|an|a|our) (?:elevator|lift)`,
    `(?:elevator|lift) (?:is |got |has |just )?(?:stuck|stopped|broke down|broken down) (?:with (?:us|me|people|my \\p{L}{1,12}) inside|and (?:we|i)(?:'re|'m| are| am) (?:inside|in it|stuck|trapped))`,
    `(?:we|i)(?:'re|'m| are| am) (?:locked|trapped|stuck) (?:inside|in (?:the|our|a|my) (?:bathroom|toilet|room|elevator|lift|apartment|flat|balcony|bedroom))`,
    `(?:locked|trapped|stuck) inside (?:the |our |a )?(?:bathroom|toilet|room|elevator|lift|apartment|flat|balcony)`,
    `(?:can't|cannot|cant) get out (?:of )?(?:the |our )?(?:elevator|lift|bathroom|toilet|room|balcony)`,
    // DE
    `(?:stecke|stecken|steckt|stecken fest|stecke fest|steckt fest|feststecken|steckengeblieben|stecken geblieben|eingeschlossen|gefangen|eingesperrt) im (?:aufzug|fahrstuhl|lift)`,
    `im (?:aufzug|fahrstuhl|lift) (?:sind wir |bin ich )?(?:fest|stecken|steckengeblieben|stecken geblieben|eingeschlossen|gefangen|eingesperrt)`,
    // FR
    `(?:bloque|bloquee|bloques|bloquees|coince|coincee|coinces|coincees|enferme|enfermee|enfermes|enfermees) dans l'? ?ascenseur`,
    `(?:nous sommes|je suis|on est) (?:bloque|coince|enferme)\\p{L}{0,3} (?:dans|a l'interieur)`,
    // ES
    `(?:atrapad[oa]s?|encerrad[oa]s?) en (?:el ascensor|el bano|la habitacion)`,
    `(?:estamos|estoy) (?:atrapad[oa]s?|encerrad[oa]s?)`,
    // RU
    `застрял${W} в лифте`,
    `в лифте застрял${W}`,
    `(?:нас|меня) заперли`,
    `(?:мы|я) (?:заперты|заперт|заперта) (?:в|внутри)`,
  ]),
  rxAr([`(?:عالق|عالقين|عالقون|محتجز|محتجزين|محتجزون|محبوس|محبوسين|علقنا|علقت)\\s+في\\s+(?:ال)?مصعد`]),
] as const;

const INTRUSION = [
  rx([
    // TR — üçüncü kişi zorlama / izinsiz giriş
    `kapi(?:yi|mizi|mi|nizi) (?:mi |mu )?${F}(?:${yor("zorl")}|zorladi(?:lar)?|zorlamaya calis(?:iyo(?:r)?(?:lar)?|ti(?:lar)?)|kirmaya calis(?:iyo(?:r)?(?:lar)?|ti(?:lar)?)|${yor("kir")}|kirdi(?:lar)?|tekmeliyo(?:r)?(?:lar)?|tekmeledi(?:ler)?|acmaya calisiyo(?:r)?(?:lar)?|yumrukluyo(?:r)?(?:lar)?)`,
    `kapiyi zorlayan (?:biri|birisi|adam|birileri|kisi)`,
    `zorla (?:iceri |eve |daireye )?(?:girdi|girdiler|giriyo(?:r)?(?:lar)?|girmis(?:ler)?|girmeye calisiyo(?:r)?(?:lar)?)`,
    `hirsiz(?:lar)? (?:girdi|girdiler|girmis|girmisler|iceride|icerde|evde|dairede|odada)`,
    `(?:iceride|icerde|evde|dairede|odada|odamizda|evimizde|salonda|bahcede) ${F}(?:yabanci|tanimadigimiz|tanimadigim|bilmedigimiz) (?:biri|birisi|birileri|adam|adamlar|kisi|kisiler)`,
    `(?:yabanci|tanimadigimiz) (?:biri|birisi|birileri|adam|kisi) ${F}(?:iceride|icerde|evde|dairede|odada|iceri girdi|iceri giriyor)`,
    `(?:biri|birisi|birileri|adam|adamlar|yabanci biri|tanimadigimiz biri|hirsiz) ${F}(?:iceri|iceriye|eve|daireye|odaya|pencereden|balkondan|bahceden|camdan) (?:girdi|girdiler|giriyo(?:r)?(?:lar)?|girmis(?:ler)?|girmeye calisiyo(?:r)?(?:lar)?)`,
    `(?:iceri|iceriye|eve|daireye|odaya|pencereden|balkondan|camdan) (?:biri|birisi|birileri|yabanci biri) (?:girdi|girdiler|giriyo(?:r)?|girmis|girmeye calisiyo(?:r)?(?:lar)?)`,
    `(?:evimiz|dairemiz|odamiz) ${F}soyuldu`,
    `soyulduk`,
    // EN
    `${EN_SUBJ}${EN_BE} (?:just )?(?:trying to )?(?:break in|break into|breaking in|breaking into|broke in|broke into|broken into|force (?:the|our|my) door|forcing (?:the|our|my) door|forced (?:the|our|my) door|kick(?:ing|ed)? (?:in )?(?:the|our|my) door|get into (?:the|our|my) ${ROOM_EN}|getting into (?:the|our|my) ${ROOM_EN}|got into (?:the|our|my) ${ROOM_EN})`,
    `${EN_SUBJ}(?: is| are|'s|'re) trying to (?:open (?:the |our |my )?(?:door|window)|get in|enter|break in|force (?:the |our |my )?(?:door|lock))`,
    `${EN_SUBJ}(?: is| are|'s|'re) (?:in|inside) (?:the|our|my) ${ROOM_EN}`,
    `there(?:'s| is| are) (?:an intruder|intruders|a burglar|burglars|a stranger|strangers|someone|somebody|a man) (?:in|inside) (?:the|our|my) ${ROOM_EN}`,
    `(?:an )?intruders? (?:in|inside) (?:the|our|my)`,
    `${ROOM_EN} (?:was|has been|got|is being) (?:broken into|burgled|burglarized|robbed)`,
    `we(?:'ve| have)? (?:been|got|were) (?:robbed|burgled)`,
    // DE
    `(?:jemand|einer|ein mann|leute|fremde|sie|er) (?:versucht|versuchen) (?:die tur aufzubrechen|einzubrechen|reinzukommen|die tur zu offnen)`,
    `(?:jemand|einer|ein mann|ein fremder) bricht (?:\\p{L}{1,20} ){0,4}(?:die tur auf|ein)`,
    `(?:es ist )?(?:jemand|ein fremder|ein mann) (?:ist )?(?:in|bei uns in) (?:der|unserer|meiner) wohnung`,
    `(?:ein )?einbrecher (?:im|in der|in unserer|ist in)`,
    `(?:bei uns )?(?:wurde|ist) (?:bei uns )?eingebrochen`,
    `wir wurden (?:ausgeraubt|bestohlen)`,
    // FR
    `(?:quelqu'un|un homme|des gens|ils|on|il) (?:essaie|essaye|essaient|tente|tentent) (?:de |d')(?:forcer|entrer|ouvrir|rentrer)`,
    `(?:quelqu'un|un homme|on|ils|il) (?:force|forcent) (?:la|notre) porte`,
    `il y a (?:quelqu'un|un inconnu|un homme|des gens|un intrus) (?:dans|chez) (?:l'? ?appartement|la chambre|nous|la maison|le logement)`,
    `(?:il y a )?un (?:voleur|cambrioleur|intrus) (?:dans|chez)`,
    `(?:nous avons|on a) ete cambriol${W}`,
    `on nous a cambriol${W}`,
    // ES
    `(?:alguien|un hombre|unos hombres|unos tipos) (?:esta |estan )?(?:forzando|intentando forzar|intentando entrar|intentando abrir|intenta forzar|intentan forzar|intenta entrar|intentan entrar)`,
    `(?:alguien|un hombre) (?:ha )?(?:entro|entrado) (?:en|a) (?:el piso|el apartamento|la casa|la habitacion)`,
    `hay (?:alguien|un hombre|un desconocido|gente) (?:dentro|en) (?:del|el|la) (?:apartamento|piso|habitacion|casa)`,
    `(?:han|ha) entrado (?:en|a) (?:el piso|el apartamento|la casa|casa|la habitacion)`,
    `(?:hay )?un (?:ladron|intruso) (?:en|dentro)`,
    `(?:nos han robado|entraron a robar|han entrado a robar)`,
    // RU
    `кто-то ${F}(?:пытается|пытаются) (?:взломать|войти|вломиться|открыть|проникнуть)`,
    `(?:какой-то мужчина|мужчина|люди|кто-то) (?:ломится|ломятся|выламывает|выламывают)`,
    `(?:ломится|ломятся) в (?:дверь|квартиру)`,
    `в квартире (?:кто-то|чужой|посторонний|вор)`,
    `к нам (?:вломились|залезли|ворвались)`,
    `нас ограбили`,
    `(?:взломали|взламывают) (?:дверь|замок|квартиру)`,
  ]),
  rxAr([
    `(?:شخص|أحد|احد|رجل|رجال)\\s+(?:ما\\s+)?(?:يحاول|يحاولون)\\s+(?:كسر|فتح|خلع|دخول|الدخول|اقتحام)`,
    `(?:يكسر|يكسرون|يخلع|يخلعون)\\s+الباب`,
    `(?:دخل|دخلوا)\\s+(?:لص|لصوص|شخص\\s+غريب)`,
    `(?:لص|لصوص)\\s+في\\s+(?:الشقة|المنزل|البيت|الغرفة)`,
  ]),
] as const;

const THREAT = [
  rx([
    // TR
    `(?:bizi|beni|annemi|babami|esimi|cocugumu|cocuklari|arkadasimi) ${F}tehdit (?:ediyo(?:r)?(?:lar)?|etti(?:ler)?)`,
    `(?:bicak|silah|tabanca)${W} ${F}tehdit (?:ediyo(?:r)?(?:lar)?|etti(?:ler)?)`,
    `(?:adam|biri|birisi|komsu|adamlar|kisi|sahis|yabanci) ${F}tehdit (?:ediyo(?:r)?(?:lar)?|etti(?:ler)?)`,
    `tehdit (?:ediliyoruz|ediliyorum)`,
    `(?:bize|bana|anneme|esime|cocuga) ${F}saldir(?:di|dilar|iyo(?:r)?(?:lar)?)`,
    `(?:bizi|beni) ${F}dov(?:du|duler|uyo(?:r)?(?:lar)?)`,
    // EN
    `(?:threatening|threatened|attacking|attacked|assaulted|assaulting) (?:to (?:kill|hurt|attack|beat|stab|shoot) )?(?:us|me|my (?:wife|husband|kids|children|son|daughter|family|friend|partner|mother|father))`,
    `threatened to (?:kill|hurt|attack|beat|stab|shoot) (?:us|me)`,
    `(?:we|i)(?:'re|'m| are| am) being (?:threatened|attacked)`,
    // DE
    `(?:bedroht|bedrohen) (?:uns|mich)`,
    `(?:wir |ich )?(?:werden|wurden|werde|wurde) (?:bedroht|angegriffen)`,
    `(?:greift|greifen|griff|griffen) (?:uns|mich) an`,
    // FR
    `(?:nous|me|m') ?(?:menace|menacent|a menace|ont menace|agresse|a agresse|ont agresse|attaque|a attaque|ont attaque)`,
    `(?:nous sommes|je suis) (?:menace|agresse)${W}`,
    // ES
    `(?:nos|me) (?:esta |estan )?(?:amenaza|amenazan|amenazando|amenazo|amenazaron|ataco|atacaron|atacando|agredio|agredieron)`,
    // RU
    `(?:нам|мне) угрожа${W}`,
    `угрожа${W} (?:нам|мне)`,
    `(?:на нас|на меня) напал${W}`,
    `нас (?:бьют|избили)`,
  ]),
  rxAr([`يهدد(?:نا|ني|وننا|ونني)`, `(?:هاجمنا|هاجموني|هاجمونا|اعتدى\\s+علينا|اعتدوا\\s+علينا)`]),
] as const;

const KINDS: readonly (readonly [PersonDangerKind, readonly RegExp[]])[] = [
  ["trapped", TRAPPED],
  ["intrusion", INTRUSION],
  ["threat", THREAT],
];

/** Asansör arızası + "içindeyiz" İKİ yan cümleye bölünmüş olabilir ("Asansör durdu, içindeyiz", "The lift stopped - we're inside"). */
const ELEVATOR_FAULT = new RegExp(
  [
    `${L}asansor ${F}(?:bozuldu|durdu|takildi|sikisti|arizalandi)${R}`,
    `${L}(?:elevator|lift) (?:is |got |has |just )?(?:stuck|stopped|broke down|broken down)${R}`,
    `${L}(?:aufzug|fahrstuhl|lift) (?:steckt|hangt|ist) (?:fest|stecken geblieben|stehen geblieben)${R}`,
    `${L}l'? ?ascenseur (?:est )?(?:bloque|en panne|coince)${R}`,
    `${L}ascensor (?:se )?(?:atasco|paro|esta atascado)${R}`,
    `${L}лифт (?:застрял|остановился|сломался)${R}`,
    `المصعد\\s+(?:توقف|تعطل|علق)`,
  ].join("|"),
  "u",
);
const WE_INSIDE = new RegExp(
  [
    `${L}(?:biz )?(?:icindeyiz|icindeyim|icerideyiz|icerdeyiz|iceride kaldik|icinde kaldik)${R}`,
    `${L}(?:we|i)(?:'re|'m| are| am) (?:still )?(?:inside|in it|stuck inside|trapped inside)${R}`,
    `${L}(?:wir sind|ich bin) (?:noch )?(?:drin|darin|drinnen)${R}`,
    `${L}(?:nous sommes|je suis|on est) (?:dedans|a l'interieur)${R}`,
    `${L}(?:estamos|estoy) dentro${R}`,
    `${L}(?:мы|я) (?:внутри|в нем|в нём)${R}`,
    `نحن\\s+(?:بالداخل|داخله|في\\s+الداخل)`,
  ].join("|"),
  "u",
);

/** Türkçe koşul eki eşleşmenin ÜSTÜNDE ya da hemen ardındaki sözcükte: "mahsur kalırsak", "kaldıysak", "zorluyorsa". */
const HYPO_TR_SUFFIX = new RegExp(
  `${L}\\p{L}{2,16}(?:ir|ar|er|ur|maz|mez|di|du|ti|tu|yor|mis|mus)(?:s[ae]|ys[ae])(?:k|m|n|niz|lar|ler)?${R}|${L}(?:olursa|olsa|kalsak|girse|girerse)${R}`,
  "u",
);
/** Ad / zarf-fiil koşulu eşleşmenin ardındaki iki sözcükte: "kalma durumunda", "kalınca", "kaldığımızda". */
const HYPO_TR_NOMINAL = new RegExp(
  `${L}(?:durumunda|halinde|takdirde)${R}|${L}\\p{L}{2,16}(?:inca|ince|unca|unce|diginde|duginde|tiginde|tuginde|diginda|duginda|tiginda|tuginda|digimizda|dugumuzda|tigimizda|digimde|dugumde|digimda|dugumda)${R}`,
  "u",
);
/** Koşul / genel soru sözcüğü eşleşmenin HEMEN ÖNÜNDE (son altı sözcük): "if someone breaks in", "eğer biri…", "what if", "has anyone ever". */
const HYPO_MARKER = new RegExp(
  [
    `${L}(?:eger|sayet|varsayalim|diyelim ki)${R}`,
    `${L}(?:if|in case|what if|suppose|supposing|imagine|hypothetically|should (?:we|i|someone|somebody|anyone)|has anyone|have you ever|ever)${R}`,
    `${L}(?:wenn|falls|im falle|angenommen)${R}`,
    `${L}(?:si|en cas d'?|au cas ou|en caso de|imagina|supongamos)${R}`,
    `${L}(?:если|в случае|допустим)${R}`,
    `(?:إذا|لو\\s|في\\s+حال)`,
  ].join("|"),
  "u",
);
/** Geçmiş anlatım — olay bitmiş olabilir: kararı model verir (olası). */
const PAST = new RegExp(
  [
    `${L}(?:dun|dun gece|gecen (?:gece|hafta|ay|yil|sene|sefer)|onceki (?:gun|gece)|bir keresinde|daha once)${R}`,
    `${L}(?:yesterday|last (?:night|week|month|year|time)|the other day|once before|years ago)${R}`,
    `${L}(?:gestern|letzte (?:nacht|woche)|vorgestern|letztes jahr|letzten (?:sommer|winter|monat)|vergangen\\p{L}{0,3})${R}`,
    // Başka bir yerde olmuş olay ("başka bir otelde", "in another hotel").
    `${L}(?:baska bir otel\\p{L}{0,4}|baska otel\\p{L}{0,4}|another hotel|other hotel|anderen hotel|autre hotel|otro hotel|другом отеле)${R}`,
    `(?:فندق\\s+آخر|السنة\\s+الماضية)`,
    // Fransızca "hier" BİLEREK yok: Almancada "burada" ("Jemand bricht hier ein").
    `${L}(?:la semaine derniere|l'annee derniere|l'an dernier|l'an passe)${R}`,
    `${L}(?:ayer|anoche|la semana pasada|el ano pasado)${R}`,
    `${L}(?:вчера|на прошлой неделе|в прошлом году)${R}`,
    `(?:أمس|امس|البارحة|الأسبوع\\s+الماضي|العام\\s+الماضي)`,
  ].join("|"),
  "u",
);
/** Aktarılan anlatım (yorum / ilan / duyulan) — misafirin kendi bildirimi değil: olası. */
const REPORTED = new RegExp(
  [
    `${L}(?:yorum\\p{L}{0,8}|yaziyor\\p{L}{0,4}|yazmis\\p{L}{0,4}|okudum|duydum|anlatti\\p{L}{0,4}|anlatmis\\p{L}{0,4}|haber\\p{L}{0,6}|onceki misafir\\p{L}{0,4})${R}`,
    `${L}(?:reviews?|reviewer|i read|we read|i heard|we heard|said that|says that|mentioned|mentions|according to)${R}`,
    // Dizi / film / haber anlatımı ("dizide adam kapıyı kırıp giriyor").
    `${L}(?:dizi\\p{L}{0,6}|film\\p{L}{0,6}|movie|series|netflix|tv show|show${R}|serie\\p{L}{0,2}|сериал\\p{L}{0,3}|фильм\\p{L}{0,3}|news|thriller|watching|izliyor\\p{L}{0,4}|izledik|izledim|regarde|schaue|viendo|смотр\\p{L}{0,4})${R}`,
    `(?:مسلسل|فيلم)`,
    `${L}(?:bewertung\\p{L}{0,3}|rezension\\p{L}{0,3}|gelesen|gehort)${R}`,
    `${L}(?:avis|commentaire\\p{L}{0,2}|j'ai lu|j'ai entendu)${R}`,
    `${L}(?:resena\\p{L}{0,2}|comentario\\p{L}{0,2}|lei|escuche)${R}`,
    `${L}(?:отзыв\\p{L}{0,3}|читал\\p{L}{0,2}|слышал\\p{L}{0,2})${R}`,
    `(?:تقييم|مراجعة|سمعت|قرأت)`,
  ].join("|"),
  "u",
);
/** Bitmiş olay ("… ama kurtulduk", "we got out", "polis geldi, gitti") — mesajın herhangi bir yerinde: açık → olası. */
const RESOLVED = new RegExp(
  [
    `${L}(?:kurtulduk|kurtuldum|kurtardilar|cikardilar|ciktik|ciktim|kacti(?:lar)?|gittiler|polis geldi|artik guvendeyiz|sorun cozuldu)${R}`,
    `${L}(?:we got out|i got out|got us out|we're out now|we are out now|they left|he left|she left|ran away|is gone|are gone|police came|police arrived|we're safe now|we are safe now)${R}`,
    `${L}(?:wir sind (?:jetzt )?raus|sind weg|ist weg|polizei (?:ist )?(?:da|gekommen))${R}`,
    `${L}(?:nous sommes sortis|on est sortis|il est parti|ils sont partis|la police est (?:la|arrivee))${R}`,
    `${L}(?:ya salimos|se fue|se fueron|llego la policia)${R}`,
    `${L}(?:мы выбрались|он ушел|они ушли|полиция приехала|ничего страшного|все в порядке)${R}`,
    // "sorun yok / no problem / c'est reparti" — olay bitmiş ve misafir sakin.
    `${L}(?:sorun yok|problem yok|no problem|no worries|all good now|kein problem|alles gut|c'est reparti|pas de souci|pas de probleme|sin problema|ya funciona)${R}`,
    `(?:لا\\s+مشكلة|ثم\\s+اشتغل)`,
  ].join("|"),
  "u",
);
/**
 * Olumsuz özne / yüklem eşleşmenin HEMEN ÖNÜNDE (araya en çok bir sözcük): "nobody is breaking in", "he is not threatening us", "никто не
 * ломится". Çıplak "no / ne" YOK: "Oh no, someone is breaking in" ve Türkçe "ne" (soru) olumsuzlama değildir.
 */
const NEG_BEFORE =
  /(?:^|[\s,])(?:no one|noone|nobody|not|never|isn't|aren't|kimse|hic kimse|niemand|nicht|kein|keiner|personne|nadie|никто|не|لا\s+أحد|لم|لا)\s+(?:\S+\s+)?$/u;
/** Saldıranın böcek olduğu mecaz ("sivrisinekler saldırdı", "Mücken greifen uns an", "الدبابير تهاجمنا"). Sözcük BAŞINDA ("mari" içindeki "arı",
 * "devant" içindeki "ant" değil — kör set #2 10-31: kısa sözcükler gerçek tehdidi susturuyordu). */
const NON_PERSON_ATTACKER = new RegExp(
  `${L}(?:sivrisinek|bocek|ari(?:lar|lari)?${R}|karinca|kene${R}|pire${R}|mosquito|bugs?${R}|insect|bees?${R}|wasps?${R}|hornet|ants?${R}|mucke|insekt|wespe|moustique|insecte|guepe|insecto|avispa|abeja|комар|насеком|ос[аы]${R})|(?:بعوض|حشر|نحل|دبابير|دبور|زنابير)`,
  "u",
);
/** İş gereği / doğa olayı zorlama ("çilingir kapıyı zorluyor", "rüzgar kapıyı zorluyor") zorla giriş değildir. */
const NON_INTRUDER = new RegExp(
  `${L}(?:cilingir|polis|tamirci|teknisyen|usta${R}|kargocu|kurye|ruzgar|firtina|temizlikci|gorevli|itfaiye|locksmith|police|plumber|technician|repairman|courier|wind${R}|storm|cleaner|schlusseldienst|schluesseldienst|polizei|handwerker|serrurier|plombier|vent${R}|cerrajero|policia|fontanero|viento|слесарь|полиция|ветер)|(?:سباك|الشرطة|الرياح)`,
  "u",
);
/** Ev sahibi / platform / ceza "tehdidi" ve spor / dizi anlatımı ("Airbnb bizi ceza ile tehdit ediyor", "maçta rakip takım bize saldırdı") kişisel
 * tehlike değildir. */
const NON_PERSON_THREAT = new RegExp(
  `${L}(?:ev sahibi|host${R}|airbnb|booking|platform|plateforme|plataforma|yonetim|resepsiyon|ceza|ucret|para${R}|kotu yorum|fine${R}|fees?${R}|charge|bad review|landlord|management|vermieter|strafe|gebuhr|proprietaire|amende|frais${R}|propietario|multa|tarifa|хозяин|штраф|комисси|mac${R}|macta|takim|rakip|match|team${R}|game${R}|spiel|equipe|partido|equipo|матч|команд)|(?:المالك|غرامة|رسوم|مباراة|فريق)`,
  "u",
);
/** Alıntı (kısa, tırnaklı) değerlendirilmez — yorum / ilan metni aktarımı. */
const QUOTED = /[“«„][^“”"«»„\n]{1,120}[”"»“]|(?<![\p{L}\p{N}])"[^“”"«»„\n]{1,120}"/gu;
/** Yan cümle ayracı (yakalanır: soru işareti). Tire / iki nokta yalnız boşluklu biçimde ("Кто-то" bölünmesin). */
const CLAUSE_SPLIT = /([.!?;,\n…؟،]+|\s[-–—:]+\s|:\s)/u;
/** Türkçe soru eki YALNIZ yan cümle sonunda ("zorluyor mu", "var mı acaba") — İspanyolca / İtalyanca "mi" (benim) soru değildir. */
const TR_QUESTION = /\sm[iu](?:\s+(?:acaba|ki))?\s*$/u;
const MAX_CLAUSES = 64;
const MAX_CHARS = 8_000;

const RANK: Record<PersonDangerLevel, number> = { none: 0, possible: 1, clear: 2 };
/** Eşleşmenin ardındaki n sözcük (koşul eki "mahsur kalırsak" / "kalma durumunda" orada). */
const nextWords = (text: string, from: number, n: number) => text.slice(from).split(" ").filter(Boolean).slice(0, n).join(" ");

function guarded(text: string, kind: PersonDangerKind, index: number, length: number): boolean {
  const before = text.slice(0, index);
  if (HYPO_TR_SUFFIX.test(text.slice(index, index + length) + " " + nextWords(text, index + length, 1))) return false;
  if (HYPO_TR_NOMINAL.test(nextWords(text, index + length, 2))) return false;
  if (HYPO_MARKER.test(before.trim().split(" ").slice(-6).join(" "))) return false;
  if (NEG_BEFORE.test(before.slice(-24))) return false;
  if (kind === "threat" && (NON_PERSON_ATTACKER.test(text) || NON_PERSON_THREAT.test(text))) return false;
  // Zorlayan özne iş gereği / doğa (eşleşmenin kendisinde ya da hemen önündeki üç sözcükte) — "…gelmezseniz polisi ararım" değil.
  if (kind === "intrusion" && NON_INTRUDER.test(`${before.trim().split(" ").slice(-3).join(" ")} ${text.slice(index, index + length)}`)) return false;
  return true;
}

// ─── Yakınlık ipuçları: NESNE / KİŞİ + canlı EYLEM aynı yan cümlede, en çok 4 sözcük arayla ──────────────────────────────────────────────
// Sabit öbek listesi gerçek mesajların yarısını kaçırıyordu (kör set 10-31: 52/105). Gerçek bildirimler kalıba değil ANLAM PARÇALARINA dayanır:
// "kapı / pencere / kilit" + "kırıyorlar / tekmeliyor / forcing / aufgebrochen", "yabancı / hırsız" + "odada / girdi", "bıçak" + "çekti",
// "asansör" + "durdu" + "içinde". Sözcükler kök (önek) eşleşmesiyle; Arapça bitişik ön ek nedeniyle alt dize. Tavanlı sözcük dizisi — doğrusal.
type Cue = (t: string) => boolean;
const stems = (list: readonly string[]): Cue => (t) => list.some((x) => t.startsWith(x));
const exact = (list: readonly string[]): Cue => (t) => list.includes(t);
const ar = (list: readonly string[]): Cue => (t) => list.some((x) => t.includes(x));
const anyOf = (...cs: Cue[]): Cue => (t) => cs.some((c) => c(t));
/** Türkçe 1. kişi (ben / biz) çekimi: "kırıyorum, zorladık" — kapıda kalan misafirin kendisi. */
const TR_FIRST_PERSON = /(?:um|uz|im|iz|dim|dik|tim|tik|dum|duk|tum|tuk|yim|yiz|yum|yuz)$/u;
const trLive = (list: readonly string[]): Cue => (t) => list.some((x) => t.startsWith(x)) && !TR_FIRST_PERSON.test(t);

const ENTRY_OBJ = anyOf(
  exact(["lock", "locks"]),
  stems(["kapi", "pencere", "kilit", "door", "window", "tur", "fenster", "schloss", "porte", "fenetre", "serrure", "puerta", "ventana", "cerradura", "двер", "окн", "окно", "замок"]),
  exact(["cam", "cami", "camini"]),
  ar(["باب", "نافذ", "شباك", "قفل"]),
);
const BREAK_VERB = anyOf(
  trLive(["zorluyo", "zorlamaya", "kiriyo", "kirmaya", "kirip", "tekmeliyo", "yumrukluyo", "kurcaliyo", "zorladilar", "kirdilar", "kirdi", "zorladi", "kiriliyo"]),
  exact(["forcing", "breaking", "kicking", "smashing", "prying", "forced", "smashed", "kicked", "broke", "busting"]),
  stems(["aufbrech", "aufgebroch", "aufgehebelt", "aufhebel", "eingeschlagen", "einschlag", "tritt", "treten", "hebelt"]),
  exact(["force", "forcent", "casse", "cassent", "defonce", "defoncent", "coups", "fracture", "fracturent"]),
  exact(["forzando", "rompiendo", "rompen", "pateando", "patean", "golpeando", "forzaron", "rompieron", "reventando"]),
  stems(["ломают", "ломит", "ломят", "выбива", "разбива", "взламыва", "вскрыва", "выламыва"]),
  ar(["يكسر", "يركل", "يخلع", "يحطم", "كسروا", "خلعوا"]),
);
const STRANGER = anyOf(
  stems(["yabanci", "tanimadig", "hirsiz", "intruder", "stranger", "burglar", "thie", "robber", "fremde", "einbrecher", "dieb", "inconnu", "intrus", "cambrioleur", "voleur", "desconocid", "intruso", "ladron", "посторонн", "чужой", "чужие", "вор"]),
  ar(["غريب", "لص", "لصوص"]),
);
const PRESENCE = anyOf(
  stems(["iceride", "icerde", "odada", "odamizda", "salonda", "dairede", "evde", "evimizde", "yatak odas", "girdi", "girmis", "girdiler", "bedroom", "apartment", "flat", "room", "house", "entered", "inside", "wohnung", "zimmer", "schlafzimmer", "haus", "eingebrochen", "chambre", "appartement", "maison", "entres", "entre", "habitacion", "piso", "casa", "apartamento", "dentro", "entrado", "entraron", "квартир", "спальн", "комнат", "дом", "залезл", "внутри"]),
  ar(["الشقة", "شقة", "غرفة", "المنزل", "البيت", "داخل", "دخل"]),
);
const WEAPON = anyOf(
  stems(["bicak", "silah", "tabanca", "knife", "gun", "pistol", "messer", "waffe", "pistole", "couteau", "arme", "pistolet", "cuchillo", "navaja", "pistola", "нож", "пистолет", "ствол"]),
  ar(["سكين", "مسدس", "سلاح"]),
);
const WEAPON_VERB = anyOf(
  trLive(["cekti", "cekiyo", "gosterdi", "gosteriyo", "savuruyo", "dogrultt", "tehdit"]),
  exact(["pulled", "drew", "pointing", "pointed", "waving", "threatening", "brandishing"]),
  stems(["zog", "gezogen", "bedroh", "droht", "sorti", "menac", "pointe", "saco", "sacado", "apunta", "amenaz", "достал", "наставил", "угрожа"]),
  ar(["سحب", "شهر", "يهدد", "يلوح"]),
);
const HIT_VERB = anyOf(
  trLive(["vuruyo", "dovuyo", "dovdu", "vurdu", "saldiriyo", "saldirdi", "itekliyo"]),
  exact(["beating", "hitting", "hit", "punched", "punching", "attacking", "attacked", "assaulted", "assaulting", "choking"]),
  stems(["schlagt", "geschlagen", "angegriffen", "frapp", "agress", "attaqu", "pegando", "pega", "golpe", "agredi", "ataca", "бьет", "бьёт", "бьют", "ударил", "напал", "напада", "избил", "избива"]),
  ar(["يضرب", "ضرب", "يعتدي", "اعتدى", "هاجم"]),
);
const ME_US = anyOf(
  exact(["beni", "bizi", "bana", "bize", "me", "us", "mich", "uns", "mir", "m'a", "nous", "nos", "меня", "нас", "мне", "нам"]),
  (t) => /(?:ني|نا)$/u.test(t) && /[\u0600-\u06FF]/u.test(t),
);
/** Türkçe / Arapça biçim kendi başına öldürme tehdidi ("öldürürüz diyorlar"); öteki dillerde "beni / bizi" yakında şart ("tuer" Almanca "Tür"). */
const KILL_THREAT_SELF = anyOf(stems(["oldururuz", "olduruz", "oldurecekler", "oldureceg", "olduruce"]), ar(["قتلنا", "يقتلنا", "سنقتل", "بقتلنا"]));
/** "Patronum beni öldürür", "my boss will kill me", "mon patron va me tuer" — deyim (özne patron / aile). */
const IDIOM_KILLER = new RegExp(
  `${L}(?:boss|patron\\p{L}{0,3}|chef${R}|jefe|mom|mum|mother|dad|wife|husband|annem|babam|esim|karim|kocam|mutter|vater|mere${R}|pere${R}|madre|padre|начальник|мама|папа|жена|муж${R})|(?:مديري|امي|أمي|زوجتي)`,
  "u",
);
const KILL_VERB = anyOf(exact(["kill", "tuer", "matar", "matarnos", "matarme", "umbringen", "abstechen"]), stems(["убью", "убьём", "убьем", "убить"]));
const ELEVATOR = anyOf(stems(["asansor", "elevator", "lift", "aufzug", "fahrstuhl", "ascenseur", "ascensor", "лифт"]), ar(["مصعد"]));
const STOPPED = anyOf(
  trLive(["durdu", "kaldi", "takildi", "bozuldu", "arizalandi", "sikisti"]),
  exact(["stopped", "stuck", "broke", "jammed", "stehen", "steckt", "stecken", "arrete", "bloque", "coince", "paro", "atasco", "atascado", "parado"]),
  stems(["остановил", "застрял", "встал"]),
  ar(["توقف", "علق", "تعطل"]),
);
const INSIDE = anyOf(
  stems(["icinde", "iceride", "icerde", "kisiyiz", "inside", "drin", "dedans", "dentro", "adentro", "внутри", "там"]),
  ar(["بداخله", "داخله", "بالداخل", "فيه"]),
);
/** Pencereden / camdan GİRME eylemi (yağmur / kuş / koku değil — özne süzgeci aşağıda). */
const ENTER_VERB = anyOf(
  trLive(["giriyo", "girdi", "tirmaniyo", "giriyor"]),
  exact(["entering", "climbing", "climbed", "crawling", "getting"]),
  stems(["steigt", "klettert", "eingestiegen", "entre", "rentre", "entrando", "trepando", "лезет", "лезут", "залез", "влез"]),
  ar(["يدخل", "يتسلق", "دخل"]),
);
const WINDOW = anyOf(stems(["pencere", "window", "fenster", "fenetre", "ventana", "окн", "окно"]), exact(["cam", "camdan"]), ar(["نافذ", "شباك"]));
const NON_PERSON_ENTRY = /(?:hava |hava$|air |air$|luft|aire|воздух|هواء|الهواء|gunes|sun |sunlight|sonne|soleil|солнц|شمس|yagmur|su |kus|kedi|bocek|ruzgar|isik|koku|rain|water|bird|cat |bug|wind|light|smell|regen|wasser|vogel|katze|pluie|eau|oiseau|chat |lluvia|agua|pajaro|gato|дожд|вода|птиц|кошк|مطر|ماء|طائر|قطة)/u;
/** Silahlı kişinin SALDIRGAN davranışı: bağırma / kapıda bekleme ("kapıda silahlı biri bağırıyor", "man with a knife at the door yelling"). */
const AGGRO = anyOf(
  trLive(["bagiriyo", "bagirdi", "kapida", "kapinin", "kapiya", "bekliyo", "vuruyo"]),
  exact(["yelling", "shouting", "screaming", "door", "outside", "waiting", "banging"]),
  stems(["schreit", "brullt", "tur", "draussen", "hurle", "crie", "porte", "grita", "puerta", "орет", "орёт", "кричит", "двер"]),
  ar(["يصرخ", "الباب", "خارج"]),
);
const LOCKED_IN = anyOf(
  stems(["kilitli", "kilitlendi", "kilitlendik", "kilitlendim", "eingeschlossen", "eingesperrt", "enferm", "encerrad", "заперт", "заперл"]),
  exact(["locked"]),
  ar(["محبوس", "محبوسة", "حبسنا"]),
);
const SMALL_ROOM = anyOf(
  stems(["banyo", "tuvalet", "oda", "bathroom", "toilet", "bedroom", "room", "bad", "badezimmer", "toilette", "zimmer", "salle", "chambre", "bano", "habitacion", "ванн", "туалет", "комнат", "спальн"]),
  ar(["حمام", "غرفة"]),
);
const LOCKED_OUT = /(?:locked out|disarida kald|disarida|ausgesperrt|dehors|afuera|fuera de)/u;
/** Misafirin KENDİ kapısı / kapıda kalma ("my own door", "kendi kapımı", "meine eigene Tür", "свою дверь", "locked myself out"): zorla giriş değil. */
const OWN_ACCESS =
  /(?:my own|our own|myself out|locked out|kendi kapi|kendi kapimizi|kendi kapimi|disarida kald|ausgesperrt|eigene|meine eigene|unsere eigene|ma propre|notre propre|mi propia|nuestra propia|свою|сам вскры|بنفسي)/u;
/** Asansör / kilitli oda değil SOKAK: "Sokakta takip edildik" gibi dış mekân anlatımı kendi başına içeride tehlike değildir — yalnız bilgi. */
const CUE_WINDOW = 4;

interface Tok {
  t: string;
  at: number;
}
function tokensOf(text: string): Tok[] {
  const out: Tok[] = [];
  const re = /[^\s.,!?;:…"«»“”()]+/gu;
  let m: RegExpExecArray | null;
  // Fransızca kesme ("l'ascenseur", "d'entree", "qu'un") kök eşleşmesini bozmasın.
  while ((m = re.exec(text)) && out.length < 400) out.push({ t: m[0].replace(/^(?:l|d|qu|j|m|s|n|t)'/u, ""), at: m.index });
  return out;
}
/**
 * a ve b ipuçları en çok `window` sözcük arayla geçiyor mu? Dönen konum b'nin (EYLEMİN) karakter konumu: koruma denetimi özneyi eylemin
 * önündeki sözcüklerde arar ("Çilingir kapıyı zorluyor" iş gereği; "…zorluyor, gelmezseniz polisi ararım" değil).
 */
function near(toks: Tok[], a: Cue, b: Cue, window = CUE_WINDOW): number {
  // Doğrusal: her sözcük bir kez sınıflanır, her eylem için yalnız ±window komşuya bakılır (aday çiftlerinin çarpımı DEĞİL — tekrar eden
  // "kapı kapı kapı …" dizisinde karesel olurdu).
  const isA = toks.map((x) => a(x.t));
  for (let j = 0; j < toks.length; j++) {
    if (!b(toks[j].t)) continue;
    for (let i = Math.max(0, j - window); i <= Math.min(toks.length - 1, j + window); i++) if (i !== j && isA[i]) return toks[j].at;
  }
  return -1;
}

function cueKinds(text: string): { kind: PersonDangerKind; at: number }[] {
  const toks = tokensOf(text);
  const out: { kind: PersonDangerKind; at: number }[] = [];
  const firstPersonEn = /(?:^|\s)(?:i|we|i'm|we're|i've|we've|i'd|we had to|i had to)\s+(?:\p{L}+\s+){0,2}(?:forc|break|broke|kick|smash|pry)/u;
  let at = near(toks, ENTRY_OBJ, BREAK_VERB);
  if (at >= 0 && !firstPersonEn.test(text) && !OWN_ACCESS.test(text)) out.push({ kind: "intrusion", at });
  else if ((at = near(toks, STRANGER, PRESENCE, 5)) >= 0) out.push({ kind: "intrusion", at });
  if ((at = near(toks, WEAPON, WEAPON_VERB)) >= 0 || (at = near(toks, ME_US, HIT_VERB, 3)) >= 0 || ((at = near(toks, ME_US, KILL_VERB, 3)) >= 0 && !IDIOM_KILLER.test(text))) {
    out.push({ kind: "threat", at });
  } else {
    const k = toks.find((x) => KILL_THREAT_SELF(x.t));
    if (k) out.push({ kind: "threat", at: k.at });
  }
  if (!out.some((o) => o.kind === "intrusion") && (at = near(toks, WINDOW, ENTER_VERB, 4)) >= 0 && !NON_PERSON_ENTRY.test(text)) {
    out.push({ kind: "intrusion", at });
  }
  if (!out.some((o) => o.kind === "threat") && (at = near(toks, WEAPON, AGGRO, 6)) >= 0) out.push({ kind: "threat", at });
  // Arapça fiil + nesne eki tek sözcükte ("يضربني" beni dövüyor, "يهاجماننا" bize saldırıyorlar).
  if (!out.some((o) => o.kind === "threat")) {
    const t = toks.find((x) => /(?:يضرب|يهاجم|يعتدي|ضرب|هاجم)\p{L}*(?:ني|نا)$/u.test(x.t));
    if (t) out.push({ kind: "threat", at: t.at });
  }
  const elev = near(toks, ELEVATOR, STOPPED, 5);
  if ((elev >= 0 && toks.some((x) => INSIDE(x.t))) || ((at = near(toks, LOCKED_IN, SMALL_ROOM)) >= 0 && !LOCKED_OUT.test(text))) {
    out.push({ kind: "trapped", at: elev >= 0 ? elev : at });
  }
  return out;
}

function clauseKinds(text: string): PersonDangerKind[] {
  const kinds: PersonDangerKind[] = [];
  for (const [kind, res] of KINDS) {
    for (const re of res) {
      const m = re.exec(text);
      if (m && guarded(text, kind, m.index, m[0].length)) {
        kinds.push(kind);
        break;
      }
    }
  }
  for (const c of cueKinds(text)) {
    if (!kinds.includes(c.kind) && guarded(text, c.kind, c.at, 0)) kinds.push(c.kind);
  }
  return kinds;
}

/** Misafir metninde devam eden kişisel tehlike (mahsur / zorla giriş / tehdit) bildirimi. */
export function personDangerOf(message: string | null | undefined): PersonDanger {
  if (typeof message !== "string" || message.trim() === "") return { level: "none", kinds: [] };
  const folded = foldForPersonDanger(message.slice(0, MAX_CHARS)).replace(QUOTED, " ");
  const parts = folded.split(CLAUSE_SPLIT);
  const resolved = RESOLVED.test(folded);
  // Kapıda kalma bağlamı MESAJ düzeyinde ("Locked myself out, gonna try to force the door"): zorla giriş sayılmaz.
  const ownAccess = OWN_ACCESS.test(folded);
  let level: PersonDangerLevel = "none";
  let kinds = new Set<PersonDangerKind>();
  let clauses = 0;
  let prevElevatorFault = false;
  for (let i = 0; i < parts.length && clauses < MAX_CLAUSES; i += 2) {
    const text = (parts[i] ?? "").trim();
    if (!text) continue;
    clauses++;
    const found = clauseKinds(text).filter((k) => !(ownAccess && k === "intrusion"));
    // "Asansör durdu, içindeyiz": arıza bir yan cümlede, "içindeyiz" ardındakinde.
    if (prevElevatorFault && !found.includes("trapped")) {
      const inside = WE_INSIDE.exec(text);
      if (inside && guarded(text, "trapped", inside.index, inside[0].length)) found.push("trapped");
    }
    prevElevatorFault = ELEVATOR_FAULT.test(text) || near(tokensOf(text), ELEVATOR, STOPPED, 5) >= 0;
    if (found.length === 0) continue;
    const question = /[?؟]/u.test(parts[i + 1] ?? "") || TR_QUESTION.test(text);
    const r: PersonDangerLevel = question || resolved || PAST.test(text) || REPORTED.test(text) ? "possible" : "clear";
    if (RANK[r] > RANK[level]) {
      level = r;
      kinds = new Set(found);
    } else if (r === level) {
      for (const k of found) kinds.add(k);
    }
  }
  return { level, kinds: [...kinds] };
}
