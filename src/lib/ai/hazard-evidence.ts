import { foldTurkishAscii, neutralizeNonEmergency } from "@/lib/ai/fallback";
import { gasDetectorSounding, smokeDetectorSounding } from "@/lib/ai/gas-detector-alarm";

// ---------------------------------------------------------------------------
// FİZİKSEL TEHLİKE KANITI — bağlam ilkesi (kurucu kararı 10-02 akşam, Sabah Kararları 51 + 55). Saf, LLM'siz, deterministik.
//
// Kurucunun sınırları (aynen):
//  · "Prizden duman çıkıyor, yanık kokuyor" → AÇIK tehlike; model yanlış yorumlasa da acil koruması KALKMAZ; devir modeli BEKLEMEDEN
//    yapılır (10-02'deki koddan güvenlik satırı 10-11'de kurucu kararıyla KALKTI — misafire metin gitmez, ev sahibine acil uyarı).
//  · "Çay kaynarken buhar çıkıyor" → otomatik yangın alarmı olmamalı.
//  · "Çaydanlıktan siyah duman geliyor, sapı eriyor" → çaydanlık geçiyor diye normal SAYILMAZ (nesne adı istisna değildir).
//  · "Komşunun sigara dumanı geliyor" → genellikle şikâyet; nefes alamama / yoğun, kaynağı bilinmeyen duman kararı değiştirir.
//  · "Yangın yok, gaz kokusu da yok" → sözcükler geçti diye kesin tehlike sayılmaz.
//  · "Su bastı" her durumda 112 gerekçesi değildir: taşan lavabo ile elektrik tesisatına ulaşan su aynı risk değil.
//  · Model arızasında güvenli taraf YALNIZ değerlendirilmekte olan olası tehlike için; modelin her hatası sıradan mesajı acile çevirmez.
//
// Düzeyler (mesaj = cümleciklerin en ağırı):
//  · `clear`     — açık tehlike kanıtı (aktif yangın, gaz kokusu / kaçağı, yoğun / siyah / elektrikten gelen duman, duman + yanık kokusu,
//                  erime, nefes alamama, elektrik çarpması, elektriğe ulaşan su). Model geçersiz kılamaz.
//  · `possible`  — olası tehlike (yalın duman / yanık kokusu, su baskını, çalan duman alarmı, kıvılcım, istenen ateşin — şömine, mum,
//                  mangal — betimlenmesi, tehlikeyi SORAN cümle). Kararı anlama modeli verir; model koşmadıysa / düştüyse güvenli taraf.
//  · `mentioned` — tehlike sözcüğü yalnız ANILIYOR: olumsuzlanmış ("yangın yok"), geçmiş / bitmiş ("dün yangın çıktı, söndürdük"),
//                  varsayım ("yangın çıkarsa"), ekipman / yer sorusu ("yangın tüpü nerede", "duman dedektörü var mı"). Model acil derse
//                  acil; model düşerse acil SAYILMAZ.
//  · `none`      — fiziksel tehlike sözcüğü yok (sağlık / güvenlik / kilitli kalma gibi öteki acil sınıfları BU modülün konusu değil).
// Alıntı (çift tırnak / «») içindeki metin değerlendirilmez. Kalıplar sınırlı ayraçlı (karesel iş yok; süre pinli).
//
// Yanlış AÇIK hüküm pahalıdır (QR'da model hiç çağrılmaz, misafire cevap gitmez, ev sahibine kritik e-posta gider) →
// açık düzey yalnız tehlikeyi BİLDİREN cümlede: soru cümlesi (gaz dışında) ve istenen ateşin betimlenmesi en fazla `possible`.
// ---------------------------------------------------------------------------

export type HazardKind = "fire" | "smoke" | "gas" | "water" | "electric";
export type HazardLevel = "clear" | "possible" | "mentioned" | "none";
export interface HazardEvidence {
  level: HazardLevel;
  /** Açık ya da olası düzeydeki tür(ler); `mentioned` / `none` için boş. */
  kinds: HazardKind[];
}

const RANK: Record<HazardLevel, number> = { none: 0, mentioned: 1, possible: 2, clear: 3 };

const NL = "(?<![\\p{L}\\p{N}])";
const NR = "(?![\\p{L}\\p{N}])";
const LB = "\\p{L}{0,12}";
const rx = (parts: readonly string[]) => new RegExp(parts.join("|"), "iu");
const rxg = (parts: readonly string[]) => new RegExp(parts.join("|"), "giu");

/** Elektrik nesnesi (duman / su / kıvılcım ile aynı cümlecikte → açık tehlike). Katlanmış biçim. */
const ELECTRIC_OBJ = rx([
  `${NL}(?:priz${LB}|elektrik${LB}|sigorta${LB}|kablo${LB}|lamba${LB}|avize${LB}|fis${NR}|fisi${NR}|sarj\\s+alet${LB}|adaptor${LB})`,
  `${NL}(?:outlets?|sockets?|electric${LB}|wiring|wires?|fuse\\s*box|fuses?|light\\s+fixtures?|lamps?|plugs?|charger|extension\\s+cord)${NR}`,
  `${NL}(?:steckdose${LB}|strom${LB}|sicherung${LB}|kabel${LB}|lampe${LB}|stecker${LB}|elektri${LB})`,
  `${NL}(?:prises?|électri${LB}|electri${LB}|câbles?|cables?|fils?\\s+électriques?|ampoules?|chargeur)${NR}`,
  `${NL}(?:enchufe${LB}|eléctric${LB}|cable${LB}|lámpara${LB}|lampara${LB}|cargador)`,
  `${NL}(?:розетк${LB}|электр${LB}|провод${LB}|щит${LB}|ламп${LB})`,
  `(?:مقبس|الكهرباء|كهرباء|سلك|الأسلاك|المصباح)`,
]);

/** Pişirme DIŞI elektrikli cihaz: dumanı elektrik arızasıdır ("klimadan duman çıkıyor"). Fırın / tost makinesi / ocak BİLEREK yok (yanan yemek). */
const SMOKE_APPLIANCE = rx([
  `${NL}(?:klima${LB}|televizyon${LB}|buzdolab${LB}|camasir\\s+makine${LB}|kurutma\\s+makine${LB}|bulasik\\s+makine${LB}|isitici${LB}|vantilator${LB}|modem${LB}|bilgisayar${LB}|sac\\s+kurutma${LB}|fon\\s+makine${LB})`,
  `${NL}(?:ac|a/c|air\\s*con${LB}|air\\s+conditioner|tv|television|fridge|refrigerator|washing\\s+machine|washer|dryer|dishwasher|heater|space\\s+heater|fan|router|laptop|computer|hair\\s*dryer)${NR}`,
  `${NL}(?:klimaanlage|klimager[aä]t|fernseher|k[uü]hlschrank|waschmaschine|trockner|sp[uü]lmaschine|heizl[uü]fter|f[oö]hn|router)${NR}`,
  `${NL}(?:climatiseur|clim|t[ée]l[ée]|t[ée]l[ée]vision|frigo|r[ée]frig[ée]rateur|lave-linge|machine\\s+[aà]\\s+laver|s[eè]che-linge|lave-vaisselle|radiateur|s[eè]che-cheveux)${NR}`,
  `${NL}(?:aire\\s+acondicionado|televisor|tele|nevera|frigor[ií]fico|lavadora|secadora|lavavajillas|calefactor|secador)${NR}`,
  `${NL}(?:кондиционер${LB}|телевизор${LB}|холодильник${LB}|стиральн${LB}|сушил${LB}|посудомоечн${LB}|обогреват${LB}|фен${NR})`,
  `(?:مكيف|المكيف|تلفزيون|التلفزيون|ثلاجة|الثلاجة|غسالة|الغسالة|مجفف|سخان)`,
]);
/** Elektrik ARIZASI belirtisi (su baskınıyla birlikte → suyun elektriğe ulaştığı açık tehlike: "…lambalar yanıp sönüyor"). */
const ELECTRIC_ANOMALY = rx([
  `${NL}(?:yanip\\s+son${LB}|titriyor|cizirti${LB}|cizirdiyor|sigorta\\s+(?:atti|atiyor|atmis)|elektrik\\s+(?:gitti|kesildi|gidip\\s+geliyor)|kivilcim${LB})`,
  `${NL}(?:flicker${LB}|buzzing|crackling|sparking|sparks?|(?:breaker|fuse)\\s+(?:tripped|blew|keeps?\\s+tripping)|power\\s+(?:went\\s+out|cut\\s+out|keeps?\\s+cutting))${NR}`,
  `${NL}(?:flacker${LB}|knistert|funken${LB}|sicherung\\s+(?:ist\\s+)?(?:raus|rausgeflogen|herausgesprungen)|strom\\s+(?:ist\\s+)?weg)${NR}`,
  `${NL}(?:clignot${LB}|gr[ée]sill${LB}|[ée]tincelle${LB}|disjonct${LB}|plus\\s+d'[ée]lectricit[ée])${NR}`,
  `${NL}(?:parpade${LB}|chispa${LB}|chisporrote${LB}|salt[oó]\\s+(?:el\\s+)?(?:diferencial|fusible|autom[aá]tico)|se\\s+fue\\s+la\\s+luz)${NR}`,
  `${NL}(?:мига${LB}|мерца${LB}|искр${LB}|треск${LB}|выбило\\s+пробки|пропал\\s+свет)`,
  `(?:يومض|ترمش|شرار${LB}|انقطعت\\s+الكهرباء)`,
]);
/** Yoğunluk / renk / yayılma (duman açık tehlike olur). */
const INTENSITY = rx([
  `${NL}(?:yogun|kalin|siyah|kapkara|kara\\s+duman|her\\s+yer${LB}\\s+(?:duman${LB}|doldu|kapladi|dolu)|dolu|doldu${LB}|kapladi|goz\\s+gozu\\s+gormuyor)${NR}`,
  `${NL}(?:thick|black|heavy|dense|everywhere|full\\s+of|filled|filling|pouring\\s+out)${NR}`,
  `${NL}(?:dicht${LB}|schwarz${LB}|uberall|überall|voller)${NR}`,
  `${NL}(?:épais${LB}|epais${LB}|noir${LB}|partout|envahi${LB})${NR}`,
  `${NL}(?:dens[oa]s?|negr[oa]s?|por\\s+todas\\s+partes|lleno|llena)${NR}`,
  `${NL}(?:густ${LB}|ч[её]рн${LB}|везде|повсюду)`,
  `(?:كثيف|أسود|في\\s+كل\\s+مكان)`,
]);
/** Erime. */
const MELT = rx([
  `${NL}(?:eriyor|eridi|erimis|erimeye)${NR}`,
  `${NL}(?:melting|melted)${NR}`,
  `${NL}(?:schmilzt|geschmolzen)${NR}`,
  `${NL}(?:fond|fondu${LB})${NR}`,
  `${NL}(?:se\\s+derrite|derriti${LB})`,
  `${NL}(?:плав${LB}|расплав${LB})`,
  `(?:يذوب|ذاب)`,
]);
/** Nefes alamama / boğulma (duman ya da gazla birlikte → açık tehlike). */
const BREATH = rx([
  `${NL}(?:nefes\\s+al(?:a|ama)m${LB}|nefes\\s+alinmiyor|bogul${LB}|oksur${LB}\\s+(?:duramiyor|durmuyor))`,
  `${NL}(?:can'?t\\s+breathe|cannot\\s+breathe|hard\\s+to\\s+breathe|choking|suffocat${LB})`,
  `${NL}(?:kann\\s+nicht\\s+atmen|können\\s+nicht\\s+atmen|konnen\\s+nicht\\s+atmen|keine\\s+luft|ersticken)`,
  `${NL}(?:(?:ne\\s+)?(?:peux|peut|pouvons)\\s+pas\\s+respirer|étouff${LB}|etouff${LB})`,
  `${NL}(?:no\\s+(?:puedo|podemos)\\s+respirar|asfixi${LB})`,
  `${NL}(?:не\\s+(?:могу|можем)\\s+дышать|задыха${LB})`,
  `(?:لا\\s+(?:أستطيع|نستطيع)\\s+التنفس|اختناق)`,
]);
/** Yanık kokusu (duman ile aynı mesajda, olumsuzlanmamış → açık tehlike; tek başına olası, elektrik nesnesiyle açık). */
const BURNING_SMELL = rx([
  `${NL}(?:yanik\\s+koku${LB}|yanik\\s+kokuyor|yanmis\\s+koku${LB}|plastik\\s+koku${LB}|kablo\\s+yanigi)`,
  `${NL}(?:burning\\s+smell|smell\\s+of\\s+burning|smells?\\s+(?:like\\s+)?burn${LB}|burnt\\s+smell|smell\\s+something\\s+burning)`,
  `${NL}(?:brandgeruch|verbrannt${LB}\\s+riech${LB}|riecht\\s+(?:es\\s+)?verbrannt|riecht\\s+(?:es\\s+)?nach\\s+verbrannt${LB})`,
  `${NL}(?:odeur\\s+de\\s+brûlé|odeur\\s+de\\s+brule|sent\\s+le\\s+brûlé|sent\\s+le\\s+brule)`,
  `${NL}(?:olor\\s+a\\s+quemado|huele\\s+a\\s+quemado)`,
  `${NL}(?:запах\\s+гари|пахнет\\s+гарью|запах\\s+горел${LB}|пахнет\\s+горел${LB})`,
  `(?:رائحة\\s+(?:حريق|احتراق|شيء\\s+يحترق|بلاستيك\\s+محترق))`,
]);
/** Çalan / öten alarm (ekipman anılışını olası tehlikeye çevirir). */
const ALARM_ACTIVE = rx([
  `${NL}(?:caliyor|calmaya|caldi|otuyor|ottu|ötüyor|öttü|ses\\s+(?:veriyor|cikariyor)|bipliyor|bip\\s+bip|uyari\\s+veriyor)`,
  `${NL}(?:going\\s+off|went\\s+off|beeping|sounding|ringing|keeps?\\s+beeping|is\\s+on)${NR}`,
  `${NL}(?:piep${LB}|klingelt|geht\\s+los|losgegangen|schlägt\\s+an|schlagt\\s+an)${NR}`,
  `${NL}(?:sonne|bipe|retentit|s'est\\s+déclenché${LB})`,
  `${NL}(?:suena|sonando|pita|pitando|se\\s+activó|se\\s+activo)`,
  `${NL}(?:срабат${LB}|сработал${LB}|пищит|звенит)`,
  `(?:يرن|يصفر|انطلق)`,
]);

/** Suyun elektriğe TEMASI (aynı cümlecikte elektrik nesnesiyle: "avizenin içine damlıyor"). */
const WATER_CONTACT = rx([
  `${NL}(?:daml${LB}|akiyor|siziyor|giriyor|girdi|ulasti|ulasiyor|islandi|islak${LB}|bulasti)`,
  `${NL}(?:drip${LB}|leak${LB}|reach${LB}|getting\\s+into|got\\s+into|into\\s+the|wet|soaked)${NR}`,
  `${NL}(?:tropft|läuft|lauft|nass|eingedrungen)${NR}`,
  `${NL}(?:goutte${LB}|coule|mouill${LB}|dans\\s+la)${NR}`,
  `${NL}(?:gotea${LB}|moja${LB}|mojad${LB}|entra|dentro\\s+del?)${NR}`,
  `${NL}(?:капает|теч[её]т|мокр${LB}|залил${LB}|попала)`,
  `(?:يقطر|يتسرب|مبلل|دخل)`,
]);
/** Sigara İÇME izni / alışkanlığı (İngilizce "smoke" fiili) — tehlike bildirimi değil, ev kuralı sorusu. */
const SMOKING_HABIT = rx([
  `${NL}(?:can|may|could|do|does|is\\s+it\\s+(?:ok|okay|allowed|possible|fine)\\s+to|are\\s+(?:we|guests)\\s+allowed\\s+to|allowed\\s+to|permitted\\s+to|want\\s+to|like\\s+to|where\\s+(?:can|to)|ok\\s+to)\\s+(?:(?:i|we|you|they|guests|one|people)\\s+)?smoke${NR}`,
  `${NL}smoking\\s+(?:is\\s+)?(?:allowed|permitted|prohibited|forbidden|area|areas|policy|ban|rules?|room|indoors|inside|outside|on\\s+the)${NR}`,
  `${NL}(?:no[-\\s]smoking|non[-\\s]?smok${LB}|smokers?|smoke[-\\s]free)${NR}`,
  `${NL}smoke\\s+(?:a\\s+)?(?:cigarettes?|cigars?|weed|shisha|hookah|vapes?|pipe)${NR}`,
  `${NL}sigara\\s+(?:\\S+\\s+){0,2}?(?:icebilir${LB}|icilebilir${LB}|icmek${LB}|icilir${LB}|icilmez${LB}|icmemiz|icme${NR}|yasak${LB}|serbest${LB})`,
  // Kişi öznesiyle "smoke / fume / raucht" sigara içmektir ("None of us smoke", "We'll be smoking on the terrace", "Mon mari fume").
  `${NL}(?:i|we|they|he|she|my\\s+(?:husband|wife|partner|friend|dad|mom|father|mother|son|daughter)|none\\s+of\\s+us|both\\s+of\\s+us|one\\s+of\\s+us|nobody|no\\s+one)(?:'ll|'d|'m|'re)?\\s+(?:(?:will|would|don'?t|do\\s+not|doesn'?t|never|also|sometimes|usually|only|am|are|is)\\s+){0,2}(?:be\\s+)?smok(?:e|es|ing)${NR}`,
  `${NL}(?:je|tu|il|elle|on|nous|vous|ils|elles|mari|femme|ami|amie|copain|copine|p[eè]re|m[eè]re|personne)\\s+(?:ne\\s+)?fum(?:e|es|ent|ons|ez)${NR}`,
  `${NL}(?:fumer|fumeurs?|non-fumeurs?)${NR}`,
  `${NL}(?:ich|er|sie|wir|ihr|mann|frau|freund|freundin|vater|mutter|niemand)\\s+(?:\\S+\\s+)?(?:rauch(?:e|t|en|st)|raucher${LB})${NR}`,
  `${NL}(?:rauchen|raucher${LB}|nichtraucher${LB})${NR}`,
]);
/** Dumanın BİLİNEN zararsız kaynağı (sigara, nargile, mangal, tütsü): yoğunluk tek başına açık tehlike yapmaz (nefes alamama yapar). */
const BENIGN_SMOKE_SOURCE = rx([
  `${NL}(?:sigara${LB}|tutun${LB}|nargile${LB}|mangal${LB}|barbeku${LB}|tutsu${LB}|egzoz${LB})`,
  `${NL}(?:cigarettes?|cigars?|tobacco|shisha|hookah|vapes?|vaping|bbq|barbecue|barbeque|grill${LB}|incense|exhaust)${NR}`,
  `${NL}(?:zigarette${LB}|zigarre${LB}|tabak${LB}|shisha|grill${LB}|r[aä]ucherst[aä]bchen|abgas${LB})${NR}`,
  `${NL}(?:cigarettes?|tabac|chicha|barbecue|encens|pot\\s+d'échappement)${NR}`,
  `${NL}(?:cigarr${LB}|tabaco|cachimba|barbacoa|parrilla|asado|incienso|tubo\\s+de\\s+escape)${NR}`,
  `${NL}(?:сигарет${LB}|сигар${LB}|табак${LB}|кальян${LB}|мангал${LB}|шашлык${LB}|благовони${LB}|выхлоп${LB})`,
  `(?:سجائر|سيجارة|تبغ|شيشة|الشيشة|شواء|الشواء|بخور|عادم)`,
]);
/** Argo övgü ("You're on fire!", "This place is fire") — tehlike değil. "The apartment is ON fire" açık tehlike kalır. */
const FIRE_SLANG = rx([
  `${NL}(?:you(?:'re|\\s+are|\\s+guys\\s+are)|u\\s+r|we(?:'re|\\s+are))\\s+(?:so\\s+|really\\s+|totally\\s+|absolutely\\s+)?on\\s+fire${NR}`,
  `${NL}(?:place|view|apartment|flat|spot|stay|location|vibe|décor|decor)\\s+(?:is|was)\\s+(?:so\\s+|absolutely\\s+|literally\\s+)?fire(?!\\s+(?:in|at|on|near))${NR}`,
]);
/** Ürün / cihaz adı ("Fire TV", "Fire Stick") — tehlike anılışı değil; taramadan önce nötrlenir. */
const FIRE_PRODUCT = /(?<![\p{L}\p{N}])fire\s*(?:tv|stick|tablet|hd|os)(?![\p{L}\p{N}])/giu;

// ─── tehlike anılışları (tür başına) ─────────────────────────────────────────────────────────────────────────────────
/** Türkçe "yan-" fiili yalnız YANMAYAN nesnede yangındır ("perde yanıyor"); "kombi / lamba / fırın yanıyor" çalışıyor demektir. */
const TR_BURNING_OBJECT = `(?:perde|koltuk|yatak|hali|cop|bina|cati|mutfak|oda|ev|daire|balkon|priz|kablo|duvar|tavan|kanepe|battaniye)`;
const MENTION: Record<HazardKind, RegExp> = {
  fire: rxg([
    `${NL}(?:yangin${LB}|alevler${LB}|alev\\s+al${LB}|alevlen${LB}|alev\\s+(?:var|cikiyor|yukseliyor|goruyorum|goruyoruz)|ates\\s+(?:al|cik)${LB}|tutus${LB})`,
    `${NL}${TR_BURNING_OBJECT}${LB}\\s+(?:yaniyor|yanmaya\\s+basladi)${NR}`,
    `${NL}(?:fires?|flames?|on\\s+fire|caught\\s+fire)${NR}`,
    `${NL}(?:feuer|brennt|flammen|fängt\\s+feuer|fangt\\s+feuer)${NR}`,
    `${NL}(?:feuermelder${LB}|brandmelder${LB}|feuerl[oö]scher${LB})`,
    `${NL}(?:(?:ein|der|den|einen|grosser|großer)\\s+brand|brand\\s+(?:in|im|ausgebrochen))${NR}`,
    `${NL}(?:feu|feux|incendie|flammes?|brûle|brule)${NR}`,
    `${NL}(?:fuego|incendio|(?:en|las|unas)\\s+llamas|se\\s+(?:está\\s+|esta\\s+)?quema${LB}|arde${LB})${NR}`,
    `${NL}(?:пожар${LB}|огонь|огня|горит|пламя|загорел${LB})`,
    `(?:حريق|الحريق|نار|النار|لهب|يحترق|اشتعل${LB})`,
  ]),
  smoke: rxg([
    `${NL}(?:duman${LB})`,
    `${NL}(?:smoke|smoking|smoky|smoked)${NR}`,
    `${NL}(?:rauch|raucht|qualm${LB})${NR}`,
    `${NL}(?:rauchmelder${LB}|rauchwarnmelder${LB})`,
    `${NL}(?:fumée|fumee|fumées|fument|fume)${NR}`,
    `${NL}(?:humo|humeando|echa\\s+humo)${NR}`,
    `${NL}(?:дым${LB})`,
    `(?:دخان|الدخان)`,
  ]),
  gas: rxg([
    `${NL}(?:(?:dogal)?gaz\\s+(?:m[iu]\\s+)?(?:koku${LB}|kokuyor|kacag${LB}|kacak${LB}|kaciyor|sizint${LB}|siziyor)|gaz\\s+gibi\\s+koku${LB}|karbonmonoksit${LB})`,
    `${NL}(?:gas\\s+(?:smell${LB}|leak${LB})|smells?\\s+(?:of|like)\\s+gas|smell\\s+gas|carbon\\s+monoxide)${NR}`,
    `${NL}(?:gasgeruch|riecht\\s+(?:es\\s+)?nach\\s+gas|gasleck|gas\\s+(?:tritt|strömt|stromt)\\s+aus|kohlenmonoxid)${NR}`,
    `${NL}(?:odeur\\s+de\\s+gaz|sent\\s+le\\s+gaz|fuite\\s+de\\s+gaz|monoxyde\\s+de\\s+carbone)${NR}`,
    `${NL}(?:olor\\s+a\\s+gas|huele\\s+a\\s+gas|fuga\\s+de\\s+gas|monóxido\\s+de\\s+carbono|monoxido\\s+de\\s+carbono)${NR}`,
    `${NL}(?:запах\\s+газа|пахнет\\s+газом|утечк${LB}\\s+газа|угарн${LB}\\s+газ${LB})`,
    `(?:رائحة\\s+(?:ال)?غاز|تسرب\\s+(?:ال)?غاز|أول\\s+أكسيد\\s+الكربون)`,
  ]),
  water: rxg([
    `${NL}(?:su\\s+bas${LB}|su\\s+baskin${LB}|sel\\s+(?:var|bast${LB})|su\\s+tas${LB}|tavandan\\s+su|su\\s+(?:akiyor|damliyor|siziyor|kaciriyor|fiskiriyor|ulasti|ulasiyor|giriyor|girdi)|su\\s+kacag${LB}|tasti|tasiyor)`,
    `${NL}(?:flood${LB}|water\\s+(?:leak${LB}|is\\s+leaking|everywhere|pouring|dripping|coming\\s+(?:in|through|from))|leak${LB}\\s+from\\s+the\\s+ceiling|overflow${LB})`,
    `${NL}(?:uberflutet|überflutet|überschwemm${LB}|uberschwemm${LB}|wasserschaden|wasser\\s+(?:läuft|lauft|tropft|steht)|rohrbruch)`,
    `${NL}(?:inond${LB}|dégât\\s+des\\s+eaux|degat\\s+des\\s+eaux|fuite\\s+d'?\\s?eau|l'eau\\s+coule)`,
    `${NL}(?:inund${LB}|fuga\\s+de\\s+agua|gotea${LB}|agua\\s+por\\s+todas\\s+partes|se\\s+sale\\s+el\\s+agua)`,
    `${NL}(?:затоп${LB}|потоп|протечк${LB}|теч[её]т\\s+вода|вода\\s+теч[её]т|прорвал${LB})`,
    `(?:فيضان|غمرت\\s+المياه|تسرب\\s+(?:ال)?مياه|تسريب\\s+(?:ال)?مياه|الماء\\s+يتسرب)`,
  ]),
  electric: rxg([
    `${NL}(?:elektrik\\s+carp${LB}|carpildi${LB}|carpildim|akim\\s+carp${LB}|kivilcim${LB}|kacak\\s+akim${LB}|akim\\s+kacir${LB}|akim\\s+kaciyo${LB}|elektrik\\s+kacag${LB})`,
    `${NL}(?:(?:dus|priz|makine|isitici|kettle|firin|buzdolab|kombi|lamba|salter|kablo|musluk|batarya|caydanli)\\p{L}{0,8}(?:\\s+\\p{L}{1,12}){0,2}\\s+carp(?:iyo|ti)|(?:priz|kablo|fis)\\p{L}{0,6}(?:\\s+\\p{L}{1,12}){0,1}\\s+(?:isiniyo|isindi|eri(?:yo|di|mis)))`,
    `${NL}(?:(?:gives?|gave|giving)\\s+(?:me|us|you)\\s+(?:an?\\s+)?(?:electric\\s+|small\\s+|little\\s+|mild\\s+)?shocks?|got\\s+(?:an?\\s+)?(?:small\\s+|little\\s+|mild\\s+)?shock(?:ed)?\\s+(?:from|when|by)|tingl(?:e|es|ing)\\s+(?:from|when)|(?:sockets?|outlets?|plugs?|cables?|wires?|kettles?|heaters?|chargers?|extension\\s+(?:cords?|leads?)|power\\s+strips?|toasters?|boilers?|appliances?)\\s+(?:is\\s+|are\\s+|gets?\\s+|getting\\s+|keeps?\\s+)?(?:very\\s+|really\\s+|burning\\s+)?(?:hot|overheating|melting|smoking))${NR}`,
    `${NL}(?:electric\\s+shock|electrocut${LB}|got\\s+shocked|shocked\\s+me|sparks?|sparking|(?:electrical|current)\\s+leak${LB}|leaking\\s+(?:current|electricity))${NR}`,
    `${NL}(?:stromschlag|elektrischen\\s+schlag|funken${LB})${NR}`,
    `${NL}(?:électrocut${LB}|electrocut${LB}|décharge\\s+électrique|étincelle${LB}|etincelle${LB})`,
    `${NL}(?:descarga\\s+eléctrica|descarga\\s+electrica|electrocut${LB}|chispa${LB})`,
    `${NL}(?:удар${LB}\\s+током|ударило\\s+током|искр${LB})`,
    `(?:صعق${LB}|شرار${LB})`,
  ]),
};
const KINDS = Object.keys(MENTION) as HazardKind[];

/** "Yanıyor / brennt / горит" fiili IŞIK bağlamında yanmak değildir ("Licht brennt im Flur", "горит лампочка", "اشتعل الضوء"). */
const BURN_VERB = /^(?:brennt|brûle|brule|горит|загорел\p{L}*|arde\p{L}*|se\s+(?:está\s+|esta\s+)?quema\p{L}*|يحترق|اشتعل\p{L}*)$/iu;
const LIGHT_CONTEXT = rx([
  `${NL}(?:light|lights|indicator|led|lamp|bulb|screen|display)${NR}`,
  `${NL}(?:licht${LB}|lampe${LB}|anzeige${LB}|kontrollleuchte${LB}|leuchte${LB}|birne${LB})${NR}`,
  `${NL}(?:lumi[eè]re${LB}|voyant${LB}|ampoule${LB}|veilleuse${LB})${NR}`,
  `${NL}(?:luz${NR}|luces|piloto${LB}|indicador${LB}|l[aá]mpara${LB}|bombilla${LB})${NR}`,
  `${NL}(?:свет${LB}|лампочк${LB}|индикатор${LB}|ламп${LB}|огон[её]к${LB}|экран${LB}|кнопк${LB}|значок${LB}|подсветк${LB}|диод${LB})`,
  `(?:ضوء|الضوء|مصباح|المصباح|لمبة|اللمبة|إشارة|مؤشر|المؤشر)`,
]);

/** Gösterge SİMGESİ ("ekranda alev simgesi", "display shows a flame") — alev sözcüğü yangın değildir. */
const ICON_CONTEXT = rx([
  `${NL}(?:ekran${LB}|simge${LB}|isaret${LB}|gosterge${LB}|sembol${LB})`,
  `${NL}(?:display|screen|icon|symbol|sign|panel|indicator|shows?|showing)${NR}`,
  `${NL}(?:anzeige${LB}|display|symbol${LB}|zeigt)${NR}`,
  `${NL}(?:[ée]cran|ic[oô]ne|symbole|affiche${LB}|voyant)${NR}`,
  `${NL}(?:pantalla|icono|s[ií]mbolo|muestra|indicador)${NR}`,
  `${NL}(?:экран${LB}|дисплей${LB}|значок${LB}|иконк${LB}|символ${LB}|показывает)`,
  `(?:الشاشة|شاشة|رمز|أيقونة|إشارة)`,
]);
const FLAME_WORD = /^(?:alev\p{L}*|flames?|flamme\p{L}*|(?:en|las|unas)\s+llamas|пламя|لهب)$/iu;

// ─── yalnız ANILIŞ yapan bağlamlar ───────────────────────────────────────────────────────────────────────────────────
/** Ekipman / yer / sigorta sözcüğü (tehlike adının ±2 sözcük çevresinde → ekipman anılışı). */
const EQUIPMENT = rx([
  `${NL}(?:alarm${LB}|dedektor${LB}|sondurucu${LB}|tup${LB}|merdiven${LB}|cikis${LB}|kacis${LB}|battaniye${LB}|sensor${LB}|algilayici${LB}|sigortas${LB}|tatbikat${LB}|musluk${LB}|vana${LB}|sayac${LB}|ocag${LB}|ocak${NR}|faturas${LB}|tupu)`,
  `${NL}(?:alarms?|detectors?|extinguishers?|exits?|escapes?|blankets?|insurance|sensors?|drills?|hydrants?|safety|valves?|meters?|stove|cooker|bill|hob|pit|place|works)${NR}`,
  `${NL}(?:melder${LB}|alarm${LB}|löscher|loscher|ausgang|decke|schutz|versicherung|herd|rechnung)${NR}`,
  `${NL}(?:détecteur${LB}|detecteur${LB}|alarme${LB}|extincteur${LB}|sortie${LB}|issue${LB}|couverture|assurance|cuisinière|cuisiniere|facture|d'artifice|rouge|vert)${NR}`,
  `${NL}(?:detector${LB}|alarma${LB}|extintor${LB}|salida${LB}|manta|seguro|cocina|factura|artificiales)${NR}`,
  `${NL}(?:датчик${LB}|сигнализац${LB}|огнетушител${LB}|выход${LB}|плит${LB}|сч[её]т${LB})`,
  `(?:كاشف|إنذار|طفاية|مخرج|فاتورة|موقد)`,
]);
/** Olumsuzlama — tehlike adının ÖNÜNDE (≤30 karakter). Türkçe "ne … ne …" ayrıca (`neitherNor`); tek "ne" ("Bu ne duman!") olumsuz değil. */
/**
 * U3 (Codex 10-07): olumsuzlama penceresi BAĞLACI AŞMAZ — "we have no power and smoke is coming out of the socket", "there is no water
 * and fire in the kitchen", "duman var ama yangın yok" ayrı önermelerdir; bir yarının olumsuzu ötekinin tehlikesini silmez. Metin
 * katlanmıştır (ASCII Türkçe). Türkçe "o" ve İspanyolca "o" BİLEREK yok (Türkçede zamir).
 */
const NEG_CONJ = "(?:and|or|but|ve|veya|ama|fakat|ancak|und|oder|aber|et|ou|mais|y|pero|и|или|но|а|و)";
const NEG_BEFORE = rx([
  `${NL}hic(?:bir)?\\s+$`,
  `${NL}(?:no|not|without|never|isn'?t|aren'?t|wasn'?t|there(?:'s|\\s+is|\\s+was)\\s+no|nor)\\s+(?:(?!${NEG_CONJ}\\s)\\S+\\s+){0,2}$`,
  `${NL}(?:kein${LB}|nicht|ohne|weder)\\s+(?:(?!${NEG_CONJ}\\s)\\S+\\s+){0,2}$`,
  `${NL}(?:pas\\s+de|pas\\s+d'|aucun${LB}|sans|ni)\\s+(?:(?!${NEG_CONJ}\\s)\\S+\\s+){0,2}$`,
  `${NL}(?:no\\s+hay|sin|ningún|ningun${LB}|ni|no\\s+(?:huele|sale|hay|se\\s+ve))\\s+(?:(?!${NEG_CONJ}\\s)\\S+\\s+){0,2}$`,
  `${NL}(?:нет|не|без|ни)\\s+(?:(?!${NEG_CONJ}\\s)\\S+\\s+){0,2}$`,
  `(?:لا\\s+يوجد|ليس\\s+هناك|لا|بدون|ولا)\\s+(?:(?!${NEG_CONJ}\\s)\\S+\\s+){0,2}$`,
]);
/** Olumsuzlama — tehlike adının ARDINDA (≤30 karakter). */
const NEG_AFTER = rx([
  `^\\s*(?:(?!${NEG_CONJ}\\s)\\S+\\s+){0,3}?(?:yok${LB}|degil${LB}|olmadi${LB}|cikmiyor|cikmadi|gelmiyor|gelmedi|kokmuyor|kokmadi|yanmiyor|yanmadi|basmadi|basmiyor|carpmadi|gormedik|duymadik)${NR}`,
  `^\\s*(?:(?!${NEG_CONJ}\\s)\\S+\\s+){0,2}?(?:nicht|keine?n?)${NR}`,
  `^\\s*(?:(?!${NEG_CONJ}\\s)\\S+\\s+){0,2}?pas${NR}`,
  `^\\s*(?:(?!${NEG_CONJ}\\s)\\S+\\s+){0,2}?(?:нет|не\\s+было)${NR}`,
]);
/** Belirsizlik ("emin değilim", "not sure") tehlikeyi olumsuzlamaz. */
const UNSURE_AFTER = rx([`^\\s*(?:\\S+\\s+){0,2}?(?:emin|kesin)\\s+degil${LB}`]);
/** "Yalnız X değil" / "not just X" olumsuzlama DEĞİLDİR (X'e ek olarak). */
const NOT_ONLY = rx([
  `${NL}(?:sadece|yalnizca|yalniz|bir\\s+tek)${NR}`,
  `${NL}not\\s+(?:just|only)${NR}`,
  `${NL}nicht\\s+nur${NR}`,
  `${NL}pas\\s+(?:seulement|que|uniquement)${NR}`,
  `${NL}no\\s+s[oó]lo${NR}`,
  `${NL}не\\s+только`,
  `(?:ليس\\s+فقط)`,
]);
/** Geçmiş / bitmiş olay (cümlecik düzeyi). "Az önce / just now" BİLEREK yok — hâlâ süren olaydır. */
const PAST = rx([
  `${NL}(?:dun${LB}|gecen\\s+(?:gece|hafta|ay|sene|yil)|onceki\\s+(?:gun|gece)|sondurduk|sondu|sonduruldu|sondurdum|artik\\s+yok|gecti${NR}|gecmis\\s+olsun\\s+ama|evvelki)`,
  `${NL}(?:yesterday|last\\s+(?:night|week|month|year)|the\\s+other\\s+day|put\\s+(?:it\\s+)?out|extinguished|no\\s+longer|it'?s\\s+out\\s+now|last\\s+time)${NR}`,
  `${NL}(?:gestern|letzte\\s+(?:nacht|woche)|gelöscht|geloscht|nicht\\s+mehr|vorgestern)${NR}`,
  `${NL}(?:hier|la\\s+semaine\\s+dernière|la\\s+semaine\\s+derniere|éteint${LB}|eteint${LB}|plus\\s+de\\s+(?:fumée|feu))${NR}`,
  `${NL}(?:ayer|la\\s+semana\\s+pasada|apagad${LB}|apagamos|ya\\s+no\\s+hay)${NR}`,
  `${NL}(?:вчера|на\\s+прошлой\\s+неделе|потушил${LB}|больше\\s+нет|уже\\s+нет)`,
  `(?:أمس|الأسبوع\\s+الماضي|أطفأ${LB}|لم\\s+يعد)`,
]);
/** Süren olay ("dünden beri", "since yesterday") geçmiş DEĞİLDİR — geçmiş testinden önce nötrlenir. */
const SINCE = rxg([
  `${NL}(?:dunden|dun\\s+(?:aksamdan|geceden|sabahtan|ogleden))\\s+(?:beri|bu\\s+yana)${NR}`,
  `${NL}since\\s+(?:yesterday|last\\s+(?:night|week))${NR}`,
  `${NL}seit\\s+(?:gestern|letzter\\s+nacht|vorgestern)${NR}`,
  `${NL}depuis\\s+(?:hier|la\\s+semaine\\s+derni[eè]re)${NR}`,
  `${NL}desde\\s+(?:ayer|la\\s+semana\\s+pasada|anoche)${NR}`,
  `${NL}(?:со\\s+вчерашнего|со\\s+вчера|с\\s+вечера)`,
  `(?:منذ\\s+(?:أمس|الأمس|البارحة))`,
]);
/** Varsayım / koşul (cümlecik düzeyi). */
const HYPOTHETICAL = rx([
  `${NL}(?:\\p{L}{2,12}(?:ar|er|ir|ur|maz|mez)s[ae](?:m|n|k|niz|nuz|ler|lar)?|olursa|olsa|varsa|yoksa|durumunda|halinde|takdirde|olasi\\s+bir|eger|sayet)${NR}`,
  `${NL}(?:if\\s+(?:there|a|the|we|you|it|smoke|fire|gas)|in\\s+case\\s+of|what\\s+if|should\\s+there\\s+be|in\\s+the\\s+event\\s+of|hypothetically)${NR}`,
  `${NL}(?:wenn|falls|im\\s+(?:brand|not)fall|was\\s+tun\\s+bei)${NR}`,
  `${NL}(?:si\\s+(?:il|le|la|un|une|jamais|on)|en\\s+cas\\s+d${LB}|que\\s+faire\\s+(?:en|si))${NR}`,
  `${NL}(?:si\\s+(?:hay|se|el|la|un|una)|en\\s+caso\\s+de|qué\\s+hacer\\s+(?:si|en)|que\\s+hacer\\s+(?:si|en))${NR}`,
  `${NL}(?:если|в\\s+случае|что\\s+делать\\s+(?:если|при))`,
  `(?:إذا|في\\s+حالة|لو\\s+)`,
]);
/**
 * Nezaket / belirsizlik kalıpları KOŞUL DEĞİLDİR ("isterseniz", "mümkünse", "if you can", "لو سمحت" = lütfen, "I'm not sure if"):
 * tehlike bildirimini varsayıma ÇEVİRMESİN diye varsayım testinden önce nötrlenir.
 */
const POLITE = rxg([
  `${NL}(?:zahmet\\s+olmazsa|mumkunse|mumkun\\s+ise|isterseniz|isterse|dilerseniz|uygunsa|musaitseniz|musaitse|rica\\s+etsem)${NR}`,
  `${NL}if\\s+(?:you\\s+(?:can|could|don'?t\\s+mind|have\\s+(?:a\\s+)?(?:time|moment|minute|chance)|are\\s+(?:able|free|available)|want|wish|like|please)|possible|needed|necessary|that'?s\\s+(?:ok|okay|alright|fine))${NR}`,
  `${NL}(?:not\\s+sure|don'?t\\s+know|no\\s+idea|can'?t\\s+tell|wondering|unsure)\\s+(?:if|whether)${NR}`,
  `${NL}(?:wenn|falls)\\s+(?:möglich|moglich|sie\\s+(?:können|konnen|mögen|mogen|wollen)|es\\s+(?:geht|ihnen\\s+passt))${NR}`,
  `${NL}si\\s+(?:possible|vous\\s+(?:pouvez|voulez|le\\s+pouvez)|ça\\s+vous\\s+(?:va|dérange)|ca\\s+vous\\s+(?:va|derange))${NR}`,
  `${NL}si\\s+(?:es\\s+posible|puede[ns]?|pudiera[ns]?|no\\s+es\\s+molestia|le\\s+parece)${NR}`,
  `${NL}если\\s+(?:можно|не\\s+сложно|не\\s+трудно|возможно|вам\\s+удобно)`,
  `(?:لو\\s+سمحت${LB}|إذا\\s+(?:أمكن|ممكن|سمحت${LB}|تكرمت${LB})|من\\s+فضلك)`,
]);

// ─── AÇIK tehlike (tür başına, olumsuzlanmamış + şimdiki cümlecikte) ───────────────────────────────────────────────
/** Tutuşma / yangın bildirimi — istenen ateş bağlamında da açık ("Tava alev aldı", "The candle set the curtain on fire"). */
const STRONG_FIRE = rx([
  `${NL}(?:yangin\\s+(?:cikti|var|basladi|cikiyor|oldu)|alev\\s+al${LB}|alev\\s+(?:var|cikiyor|yukseliyor|goruyorum|goruyoruz)|ates\\s+(?:aldi|cikti|aliyor|almis)|tutustu${LB}|tutusuyor)`,
  `${NL}${TR_BURNING_OBJECT}${LB}\\s+(?:yaniyor|yanmaya\\s+basladi|alev${LB})`,
  `${NL}(?:(?:there(?:'s|\\s+is)|we\\s+have)\\s+a\\s+fire|on\\s+fire|caught\\s+fire|in\\s+flames|fire\\s+broke\\s+out|there\\s+(?:are|were)\\s+flames|flames\\s+everywhere|(?:i|we)\\s+(?:can\\s+)?see\\s+flames)${NR}`,
  `${NL}fire\\s+in\\s+the\\s+(?:kitchen|apartment|flat|room|bedroom|bathroom|building|house|hall${LB}|living\\s+room|stairwell|garage|balcony|oven|microwave|toaster)${NR}`,
  `${NL}(?:es\\s+brennt|(?:ein|der|den|einen|grosser|großer)\\s+brand|brand\\s+(?:in|im|ausgebrochen)|in\\s+flammen|feuer\\s+(?:ausgebrochen|bricht)|fängt\\s+feuer|fangt\\s+feuer|feuer\\s+gefangen)${NR}`,
  `${NL}(?:il\\s+y\\s+a\\s+(?:le|un)\\s+(?:feu|incendie)|(?:est|sont)\\s+en\\s+feu|au\\s+feu|(?:prend|a\\s+pris|ont\\s+pris)\\s+feu|incendie\\s+(?:dans|à|a|au|chez)|en\\s+flammes)${NR}`,
  `${NL}(?:hay\\s+(?:un\\s+)?(?:fuego|incendio)|en\\s+llamas|se\\s+prendi[oó]\\s+fuego|prendi[oó]\\s+fuego|incendio\\s+en|(?:cocina|casa|apartamento|piso|habitaci[oó]n|edificio)\\s+(?:est[aá]\\s+)?ard${LB})${NR}`,
  `${NL}(?:пожар${LB}|загорел(?:ся|ась|ось|ись))`,
  `(?:حريق|الحريق|اشتعل${LB})`,
]);
/** Ateşin BETİMLENMESİ — istenen ateş bağlamında (şömine, mum, mangal…) olası, aksi hâlde açık. */
const DESCRIPTIVE_FIRE = rx([
  `${NL}(?:alevler${LB}|alevlen${LB})`,
  `${NL}(?:is\\s+burning|flames\\s+(?:are|coming)|fire\\s+in\\s+the)${NR}`,
  `${NL}(?:brennt\\s+(?:es|die|der|das|in|im))${NR}`,
  `${NL}(?:горит|пламя)`,
  `(?:النار\\s+(?:في|تشتعل))`,
]);
/** İstenen / denetimli ateş bağlamı. */
const CONTROLLED_FIRE = rx([
  `${NL}(?:somine${LB}|mum(?:lar|u|un|dan|da|a|lari|larin)?${NR}|mangal${LB}|barbeku${LB}|kamp\\s+ates${LB}|tutsu${LB}|soba${LB}|cakmak${LB})`,
  `${NL}(?:fireplace|fire\\s*place|candles?|bbq|barbecue|barbeque|grill|campfire|bonfire|fire\\s*pit|incense|wood\\s*stove|burners?|pilot\\s+light|lighter|matches)${NR}`,
  `${NL}(?:kamin${LB}|kerze${LB}|grill${LB}|lagerfeuer|feuerzeug|r[aä]ucherst[aä]bchen)${NR}`,
  `${NL}(?:chemin[ée]e|bougies?|barbecue|feu\\s+de\\s+(?:camp|chemin[ée]e|bois)|briquet|encens)${NR}`,
  `${NL}(?:chimenea|velas?|barbacoa|parrilla|asado|fogata|hoguera|mechero|incienso)${NR}`,
  `${NL}(?:камин${LB}|свеч${LB}|мангал${LB}|шашлык${LB}|костр${LB}|костер|костёр|зажигалк${LB}|печк${LB}|благовони${LB})`,
  `(?:مدفأة|المدفأة|شمع${LB}|الشمع${LB}|شواء|الشواء|ولاعة|بخور)`,
]);
/** Denetimden çıkma / yayılma (istenen ateş bağlamında açık tehlikeye çevirir). */
const SPREAD = rx([
  `${NL}(?:yayil${LB}|sicra${LB}|kontrolden\\s+cik${LB}|sonduremi${LB}|sonmuyor|sonmedi|tasiyor|tasti|buyuyor|buyudu|perde${LB}|hali(?:ya|yi|da|nin)?${NR}|koltu${LB}|yatag${LB}|yatak${LB}|battaniye${LB}|mobilya${LB}|duvar${LB}|tavan${LB}|cati${LB})`,
  `${NL}(?:spread${LB}|out\\s+of\\s+control|(?:can'?t|cannot|couldn'?t|won'?t)\\s+(?:put\\s+(?:it\\s+)?out|be\\s+put\\s+out|go\\s+out|stop)|curtains?|carpet|rugs?|sofa|couch|bed|mattress|blankets?|furniture|walls?|ceiling|roof)${NR}`,
  `${NL}(?:breitet\\s+sich|ausgebreitet|au[sß]er\\s+kontrolle|vorhang${LB}|teppich${LB}|sofa${LB}|bett${NR}|betten|m[oö]bel${LB})${NR}`,
  `${NL}(?:se\\s+propage${LB}|incontr[oô]lable${LB}|rideaux?|tapis|canap[ée]|(?:le|du|au)\\s+lit|plafond|meubles?)${NR}`,
  `${NL}(?:se\\s+(?:est[aá]\\s+)?propag${LB}|fuera\\s+de\\s+control|cortinas?|alfombra${LB}|sof[aá]|cama${NR}|techo|muebles?)${NR}`,
  `${NL}(?:распространя${LB}|не\\s+можем\\s+потушить|штор${LB}|ков[её]р${LB}|диван${LB}|кроват${LB}|потол${LB}|мебел${LB})`,
  `(?:ينتشر|انتشر|ستارة|ستائر|سجادة|أريكة|سرير|السقف|أثاث)`,
]);
const CLEAR_WATER_ELECTRIC = rx([
  `${NL}su${LB}\\s+(?:\\S+\\s+){0,3}?(?:priz${LB}|elektrik${LB}|sigorta${LB}|kablo${LB}|lamba${LB}|avize${LB}|panel${LB})`,
  `${NL}(?:priz${LB}|elektrik${LB}|sigorta${LB}|kablo${LB}|lamba${LB}|avize${LB})\\s+(?:\\S+\\s+){0,3}?su\\s+(?:bas|ak|damla|siz|kac|gir|ulas|bulas)${LB}`,
  `${NL}water\\s+(?:\\S+\\s+){0,4}?(?:outlets?|sockets?|electric${LB}|wiring|fuse\\s*box|fuses?|light\\s+fixtures?|lamps?|plugs?)${NR}`,
  `${NL}(?:outlets?|sockets?|wiring|fuse\\s*box|light\\s+fixtures?)\\s+(?:\\S+\\s+){0,3}?(?:wet|water|flooded|leak${LB})${NR}`,
  `${NL}wasser\\s+(?:\\S+\\s+){0,4}?(?:steckdose${LB}|strom${LB}|sicherung${LB}|kabel${LB}|lampe${LB})`,
  `${NL}(?:eau|l'eau)\\s+(?:\\S+\\s+){0,4}?(?:prise${LB}|électri${LB}|electri${LB}|câble${LB}|tableau)`,
  `${NL}agua\\s+(?:\\S+\\s+){0,4}?(?:enchufe${LB}|eléctric${LB}|electric${LB}|cable${LB}|lámpara|lampara)`,
  `${NL}вод${LB}\\s+(?:\\S+\\s+){0,4}?(?:розетк${LB}|электр${LB}|провод${LB}|щит${LB})`,
  `(?:الماء|المياه)\\s+(?:\\S+\\s+){0,4}?(?:مقبس|الكهرباء|كهرباء|الأسلاك)`,
]);
const CLEAR_ELECTRIC = rx([
  `${NL}(?:elektrik\\s+carpti|elektrik\\s+carpiyor|carpildi${LB}|carpildim|akim\\s+carpti)`,
  // Kaçak akım = dokunan çarpılır (kurucu 10-14 taraması: "Kahve makinesi kaçak akım yapıyor" hiçbir ağa takılmıyordu; kanal ağında
  // "elektrik kaçağı" vardı, burada yoktu — iki ağ eşit).
  `${NL}(?:kacak\\s+akim${LB}|akim\\s+kacir${LB}|elektrik\\s+kacag${LB})`,
  // Elektrikli özneyle çarpma + aşırı ısınan / eriyen priz-kablo (10-14, Haiku; kanal ağıyla aynı kalıplar).
  `${NL}(?:(?:dus|priz|makine|isitici|kettle|firin|buzdolab|kombi|lamba|salter|kablo|musluk|batarya|caydanli)\\p{L}{0,8}(?:\\s+\\p{L}{1,12}){0,2}\\s+carp(?:iyo|ti)|(?:priz|kablo|fis)\\p{L}{0,6}(?:\\s+\\p{L}{1,12}){0,1}\\s+(?:isiniyo|isindi|eri(?:yo|di|mis)))`,
  `${NL}(?:(?:gives?|gave|giving)\\s+(?:me|us|you)\\s+(?:an?\\s+)?(?:electric\\s+|small\\s+|little\\s+|mild\\s+)?shocks?|got\\s+(?:an?\\s+)?(?:small\\s+|little\\s+|mild\\s+)?shock(?:ed)?\\s+(?:from|when|by)|tingl(?:e|es|ing)\\s+(?:from|when)|(?:sockets?|outlets?|plugs?|cables?|wires?|kettles?|heaters?|chargers?|extension\\s+(?:cords?|leads?)|power\\s+strips?|toasters?|boilers?|appliances?)\\s+(?:is\\s+|are\\s+|gets?\\s+|getting\\s+|keeps?\\s+)?(?:very\\s+|really\\s+|burning\\s+)?(?:hot|overheating|melting|smoking))${NR}`,
  `${NL}(?:(?:electrical|current)\\s+leak${LB}|leaking\\s+(?:current|electricity))${NR}`,
  `${NL}(?:electric\\s+shock|electrocuted|got\\s+(?:an\\s+)?(?:electric\\s+)?shock(?:ed)?|shocked\\s+me)${NR}`,
  `${NL}(?:stromschlag|elektrischen\\s+schlag)${NR}`,
  `${NL}(?:électrocuté${LB}|electrocute${LB}|décharge\\s+électrique|decharge\\s+electrique)`,
  `${NL}(?:descarga\\s+eléctrica|descarga\\s+electrica|electrocutad${LB})`,
  `${NL}(?:ударило\\s+током|удар${LB}\\s+током)`,
  `(?:صعق${LB})`,
]);
/** Türkçe soru eki tehlikeyi SORAR ("yangın var mı", "duman mı geliyor") — soru işareti olmadan da. */
const TR_QUESTION = rx([`${NL}(?:var|yok)\\s+m[iu]${NR}`, `${NL}m[iu]\\s+(?:var|geliyor|kokuyor|cikiyor|yaniyor|aliyor|oldu|cikti)${NR}`]);

const BARE_ALARM =
  /^(?:(?:imdat|help|hilfe|au\s+secours|socorro|ayuda|помогите|النجدة)\s+)?(?:yangin|fire|feuer|au\s+feu|feu|fuego|incendio|пожар|حريق)(?:\s+(?:var|imdat|help|hilfe))?$/iu;
const QUOTED = /[“"«„][^“”"«»„\n]{1,80}[”"»“]/gu;
/** Cümlecik sınırları: noktalama + virgül + karşıtlık bağlaçları ("yangın yok AMA duman var" iki ayrı cümlecik). Ayraç YAKALANIR (soru işareti). */
const CLAUSE_SPLIT =
  /((?:(?<!\d)[.](?!\d)|[!?;,\n…؟،]|(?<![\p{L}\p{N}])(?:ama|fakat|ancak|lakin|but|however|aber|jedoch|mais|pero|sino|но|однако|لكن|ولكن)(?![\p{L}\p{N}]))+)/u;

interface Clause {
  text: string;
  /** Cümlecik soru mu (ardında soru işareti ya da Türkçe soru eki)? */
  question: boolean;
}

function clausesOf(folded: string): Clause[] {
  const parts = folded.split(CLAUSE_SPLIT);
  const out: Clause[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const text = (parts[i] ?? "").trim();
    if (!text) continue;
    const delim = parts[i + 1] ?? "";
    out.push({ text, question: /[?؟]/u.test(delim) || TR_QUESTION.test(text) });
  }
  return out;
}

/** Cümlecik başına değerlendirilen anılış tavanı: tekrar eden sözcük dizisi ("duman duman duman…") doğrusal ve sınırlı iş kalsın. */
const MENTION_CAP = 32;
/** Değerlendirilen anılış sayacı — YALNIZ test (tavanın işi gerçekten sınırladığını pinler; tavansız 8.000 karakterde 145 ms ↔ 6 ms). */
let mentionEvals = 0;
export function __hazardMentionEvalCount(): number {
  return mentionEvals;
}

/**
 * 🚨 U3 (Codex 10-07): tavan "tehlike YOK" kanıtı DEĞİLDİR. Eskiden ilk 32 anılıştan sonrası sessizce atılıyordu → 32 kez "no fire"
 * ardından gelen GERÇEK yangın görünmüyordu. Şimdi: aynı bağlam penceresindeki (±32 karakter) anılış bir kez değerlendirilir (tekrar
 * eden dizi doğrusal ve sınırlı kalır — penceresi aynı olanın olumsuzlama / ekipman hükmü de aynıdır); BENZERSİZ anılış sayısı tavanı
 * aşarsa o tür `overflow` olur ve cümlecik en az OLASI sayılır (karar modele kalır; asla "anılış"a inmez).
 */
const MENTION_WINDOW = 32;
function mentionsIn(clause: string): { mentions: { kind: HazardKind; index: number; length: number }[]; overflow: HazardKind[] } {
  const out: { kind: HazardKind; index: number; length: number }[] = [];
  const overflow: HazardKind[] = [];
  const light = LIGHT_CONTEXT.test(clause);
  for (const kind of KINDS) {
    let seen = 0;
    const windows = new Set<string>();
    for (const m of clause.matchAll(MENTION[kind])) {
      const at = m.index ?? 0;
      const key = clause.slice(Math.max(0, at - MENTION_WINDOW), at + m[0].length + MENTION_WINDOW);
      if (windows.has(key)) continue;
      windows.add(key);
      if (++seen > MENTION_CAP) {
        overflow.push(kind);
        break;
      }
      mentionEvals++;
      // Işık bağlamındaki "yanma" fiili tehlike anılışı değildir.
      if (kind === "fire" && light && BURN_VERB.test(m[0])) continue;
      // Gösterge simgesi olarak alev ("boiler display shows a flame") yangın anılışı değildir.
      if (kind === "fire" && FLAME_WORD.test(m[0]) && ICON_CONTEXT.test(clause)) continue;
      out.push({ kind, index: m.index ?? 0, length: m[0].length });
    }
  }
  return { mentions: out, overflow };
}

/** Anılış olumsuzlanmış mı (önünde ≤30, ardında ≤30 karakter; "yalnız X değil" olumsuzlama değil)? */
function negated(clause: string, at: number, len: number): boolean {
  const before = clause.slice(Math.max(0, at - 30), at);
  const after = clause.slice(at + len, at + len + 30);
  if (NOT_ONLY.test(before) || NOT_ONLY.test(after.slice(0, 12)) || UNSURE_AFTER.test(after)) return false;
  return NEG_BEFORE.test(before) || NEG_AFTER.test(after) || neitherNor(clause);
}

/** Türkçe "ne … ne …" (ne yangın var ne duman): cümlecikte iki ayrı "ne". */
function neitherNor(clause: string): boolean {
  return (clause.match(/(?<![\p{L}\p{N}])ne(?=\s)/gu) ?? []).length >= 2;
}

/**
 * Anılış bir ekipman / yer adının parçası mı (±2 sözcük)? 🚨 U3 (Codex 10-07): YALNIZ isim biçimindeki anılış ("fire alarm", "yangın
 * tüpü", "smoke detector") ekipman olabilir. Tehlike bir OLAY fiiliyle anılıyorsa ("the stove caught fire", "mutfaktaki ocak alev aldı",
 * "Herd brennt", "плита горит") ekipman onun ÖZNESİDİR — bileşik değil, gerçek yangın; eskiden ±3 sözcük penceresi bunu anılışa indiriyordu.
 */
const EQUIPMENT_IN_WORD = /(?:melder|l[oö]scher|detector|dedektor)/iu;
const HAZARD_EVENT_VERB =
  /(?:alev\s+al|alevlen|alev\s+(?:var|cikiyor|yukseliyor)|ates\s+(?:al|cik)|tutus|yaniyor|yanmaya|on\s+fire|caught\s+fire|brennt|f[aä]ngt\s+feuer|br[uû]le|quema|arde|горит|загорел|يحترق|اشتعل)/iu;
function equipmentMention(clause: string, at: number, len: number): boolean {
  const mention = clause.slice(at, at + len);
  if (HAZARD_EVENT_VERB.test(mention)) return false;
  if (EQUIPMENT_IN_WORD.test(mention)) return true;
  const before = clause.slice(Math.max(0, at - 28), at);
  const after = clause.slice(at + len, at + len + 28);
  const near = `${before.split(/\s+/).slice(-3).join(" ")} ${mention} ${after.split(/\s+/).slice(0, 3).join(" ")}`;
  return EQUIPMENT.test(near.replace(mention, " "));
}

/** Cümlecik geçmiş / varsayım mı (nezaket ve süren-olay kalıpları önce nötrlenir)? */
function pastOrHypothetical(clause: string): boolean {
  const ctx = clause.replace(POLITE, " ").replace(SINCE, " ");
  return PAST.test(ctx) || HYPOTHETICAL.test(ctx);
}

/** Soru cümlesinde gaz dışındaki açık tür olasıya iner (gaz kokusu sorusu da bildirimdir). */
function capQuestion(clear: Set<HazardKind>, kinds: Set<HazardKind>, question: boolean): { level: HazardLevel; kinds: HazardKind[] } {
  if (question) for (const k of [...clear]) if (k !== "gas") clear.delete(k);
  if (clear.size > 0) return { level: "clear", kinds: [...clear] };
  return { level: "possible", kinds: [...kinds] };
}

/**
 * `next`: hemen ardındaki KISA cümlecik (≤5 sözcük, canlı) — "Bu ne duman böyle, her yer doldu!", "…alevler yükseliyor, halıya sıçradı!"
 * gibi yoğunluk / yayılma / erime bildirimi ayrı cümleciğe düşer.
 */
/** Mesaj düzeyi sinyaller — canlı cümleciklerde BİR KEZ hesaplanır (cümlecik başına tüm mesajı taramak karesel işti). */
interface MessageSignals {
  breath: boolean;
  burningSmell: boolean;
  waterReachesElectric: boolean;
  electricAnomaly: boolean;
  benignSmokeSource: boolean;
}

function clauseLevel(clause: Clause, signals: MessageSignals, next: string | null): { level: HazardLevel; kinds: HazardKind[] } {
  const scan = mentionsIn(clause.text);
  const mentions = scan.mentions;
  const result = clauseVerdict(clause, signals, next, mentions);
  // Taranamayan anılış varken cümlecik "yok / anılış"a İNEMEZ (U3): en az olası, karar modele.
  if (scan.overflow.length > 0 && RANK[result.level] < RANK.possible) return { level: "possible", kinds: [...new Set(scan.overflow)] };
  return result;
}

function clauseVerdict(
  clause: Clause,
  signals: MessageSignals,
  next: string | null,
  mentions: { kind: HazardKind; index: number; length: number }[],
): { level: HazardLevel; kinds: HazardKind[] } {
  const text = clause.text;
  const withNext = next ? `${text} ${next}` : text;
  if (mentions.length === 0) {
    if (pastOrHypothetical(text)) return { level: "none", kinds: [] };
    // Tehlike adı yok ama elektriğe ulaşan su yapısı ("su prizlere ulaştı") tek başına açık tehlikedir.
    if (CLEAR_WATER_ELECTRIC.test(text)) return capQuestion(new Set(["water"]), new Set(["water"]), clause.question);
    // Yanık kokusu tek başına olası; elektrik nesnesiyle ("prizden yanık kokusu geliyor") açık.
    const smell = BURNING_SMELL.exec(text);
    if (smell && !negated(text, smell.index, smell[0].length)) {
      return capQuestion(new Set(ELECTRIC_OBJ.test(text) ? ["smoke"] : []), new Set(["smoke"]), clause.question);
    }
    return { level: "none", kinds: [] };
  }
  if (pastOrHypothetical(text)) return { level: "mentioned", kinds: [] };
  const live = mentions.filter((m) => !negated(text, m.index, m.length));
  if (live.length === 0) return { level: "mentioned", kinds: [] };
  const alarm = ALARM_ACTIVE.test(text);
  const real = live.filter((m) => !equipmentMention(text, m.index, m.length));
  if (real.length === 0) return alarm ? { level: "possible", kinds: [...new Set(live.map((m) => m.kind))] } : { level: "mentioned", kinds: [] };

  // Sigara içme izni ("Can we smoke on the balcony?") ve argo övgü ("You're on fire!") tehlike bildirimi değildir: o anılış YALNIZ anılış.
  const reported = real.filter(
    (m) => !(m.kind === "smoke" && SMOKING_HABIT.test(text)) && !(m.kind === "fire" && FIRE_SLANG.test(text)),
  );
  if (reported.length === 0) return { level: "mentioned", kinds: [] };
  const kinds = new Set(reported.map((m) => m.kind));
  const clear = new Set<HazardKind>();
  const intense = INTENSITY.test(withNext);
  const escalating = intense || MELT.test(withNext) || signals.breath || SPREAD.test(withNext);
  if (kinds.has("fire") && (STRONG_FIRE.test(text) || (DESCRIPTIVE_FIRE.test(text) && (!CONTROLLED_FIRE.test(text) || escalating)))) {
    clear.add("fire");
  }
  if (kinds.has("gas")) clear.add("gas");
  if (kinds.has("electric") && (CLEAR_ELECTRIC.test(text) || ELECTRIC_OBJ.test(text))) clear.add("electric");
  if (
    kinds.has("water") &&
    (CLEAR_WATER_ELECTRIC.test(text) || ELECTRIC_OBJ.test(text) || signals.waterReachesElectric || signals.electricAnomaly)
  ) {
    clear.add("water");
  }
  if (
    kinds.has("smoke") &&
    (ELECTRIC_OBJ.test(text) ||
      SMOKE_APPLIANCE.test(text) ||
      MELT.test(withNext) ||
      signals.breath ||
      signals.burningSmell ||
      // Kaynağı BİLİNEN zararsız duman (sigara, mangal…) yoğun da olsa şikâyettir — kaynak mesajın herhangi bir canlı cümleciğinde.
      (intense && !signals.benignSmokeSource))
  ) {
    clear.add("smoke");
  }
  if ((kinds.has("smoke") || kinds.has("gas")) && signals.breath) clear.add(kinds.has("gas") ? "gas" : "smoke");
  return capQuestion(clear, kinds, clause.question);
}

/** Canlı cümleciklerden birinde su ELEKTRİK nesnesine temas ediyor mu ("…avizenin içine damlıyor")? */
function waterReachesElectric(liveClauses: readonly string[]): boolean {
  return liveClauses.some((c) => ELECTRIC_OBJ.test(c) && WATER_CONTACT.test(c));
}

/**
 * Misafir mesajının fiziksel tehlike kanıtı. Tek kaynak: QR'da modelsiz devir (55; satır 10-11'de kalktı), acil alarmının bağlamla kaldırılması (51) ve
 * model arızasında güvenli taraf kuralı bu düzeyi okur.
 */
export function hazardEvidenceOf(message: string | null | undefined): HazardEvidence {
  if (typeof message !== "string" || message.trim() === "") return { level: "none", kinds: [] };
  // K6 bağlam kuralı (yer / eşya sorusu, "acil değil") AYNEN önce; sonra çift tırnaklı / «» kısa alıntılar ve ürün adları değerlendirmeden çıkar.
  const contextual = neutralizeNonEmergency(foldTurkishAscii(message.slice(0, 8_000).replace(/\s+/g, " ")));
  const folded = contextual.replace(QUOTED, " ").replace(FIRE_PRODUCT, " ");
  // Yalnız haykırış ("Yangın!", "Fire!!", "Au feu !", "¡Fuego!", "Пожар!") açık tehlikedir; ünlemsiz tek sözcük ("Yangın") modele kalır.
  if (BARE_ALARM.test(folded.replace(/[\s!¡.]+/gu, " ").trim()) && /[!¡]/u.test(folded)) return { level: "clear", kinds: ["fire"] };
  // Mesaj düzeyi sinyaller (yanık kokusu, nefes, suyun elektriğe teması) yalnız olumsuzlanmamış / geçmiş olmayan cümleciklerden sayılır.
  const clauses = clausesOf(folded);
  const liveClauses = clauses.map((c) => c.text).filter((c) => !pastOrHypothetical(c) && !negatedSignal(c));
  const live = liveClauses.join(" . ");
  const signals: MessageSignals = {
    breath: BREATH.test(live),
    burningSmell: BURNING_SMELL.test(live),
    waterReachesElectric: waterReachesElectric(liveClauses),
    electricAnomaly: ELECTRIC_ANOMALY.test(live),
    benignSmokeSource: BENIGN_SMOKE_SOURCE.test(live),
  };
  let best: HazardEvidence = { level: "none", kinds: [] };
  const kinds = new Set<HazardKind>();
  for (let i = 0; i < clauses.length; i++) {
    const clause = clauses[i];
    const following = clauses[i + 1]?.text ?? null;
    const next =
      following && following.split(/\s+/).length <= 5 && !pastOrHypothetical(following) && !negatedSignal(following) ? following : null;
    const r = clauseLevel(clause, signals, next);
    if (RANK[r.level] > RANK[best.level]) {
      best = { level: r.level, kinds: [] };
      kinds.clear();
    }
    if (r.level === best.level) for (const k of r.kinds) kinds.add(k);
  }
  // G4 (kurucu kararı 10-13 "Olası gaz acili say"): gaz / CO dedektörü ÖTÜYOR → açık gaz tehlikesi (model çağrılmaz, ev sahibine kritik
  // bildirim). Kanal ağıyla tek kaynak ve AYNI girdi sınıfı: K6 nötrlemesi sonrası, ALINTI SİLİNMEDEN (kanal ağı alıntıyı silmez;
  // `CO dedektörü "bip bip" yapıyor` iki ağda aynı sonuç — Haiku incelemesi 10-13). Başka açık tür varsa korunur.
  // H3 (kurucu kararı 10-13 "Evet, doğrudan ev sahibine"): duman / yangın dedektörü ötüyor → aynı şekilde açık duman tehlikesi.
  const gasAlarm = gasDetectorSounding(contextual);
  const smokeAlarm = smokeDetectorSounding(contextual);
  if (gasAlarm || smokeAlarm) {
    if (best.level !== "clear") kinds.clear();
    if (gasAlarm) kinds.add("gas");
    if (smokeAlarm) kinds.add("smoke");
    return { level: "clear", kinds: [...kinds] };
  }
  return { level: best.level, kinds: best.level === "clear" || best.level === "possible" ? [...kinds] : [] };
}

/** Cümlecikteki yanık kokusu / nefes sinyalinin kendisi olumsuzlanmış mı ("yanık kokusu yok")? */
function negatedSignal(clause: string): boolean {
  for (const re of [BURNING_SMELL, BREATH]) {
    const m = re.exec(clause);
    if (m && negated(clause, m.index, m[0].length)) return true;
  }
  return false;
}

// ─── 55 (10-02) GERİ ALINDI — kurucu kararı 10-11: "112'yi arayın yazmasın, yönlendirme olmayacak hiçbir şekilde". Misafirin dilindeki
// güvenlik satırları (SAFETY_LINES / safetyLineFor) kaldırıldı; tehlike yalnız bağlamla TANINIR (devir + ev sahibine acil uyarı), misafire
// koddan hiçbir yönerge gitmez. ─────────────────────────────────────────────────────────────────────────────────────────────────────

// ─── 51: bağlamla kaldırılan alarmda KAYNAKSIZ güvence verilmez ("normaldir, güvenlidir") ────────────────────────────────
const REASSURANCE = rx([
  `${NL}(?:normal(?:dir)?|gayet\\s+normal|guvenli(?:dir)?|tehlikeli\\s+degil${LB}|tehlike\\s+yok|endiselen${LB}|merak\\s+etmeyin|korkmayin|zararsiz${LB}|sorun\\s+yok|sorun\\s+degil)${NR}`,
  `${NL}(?:(?:it'?s|that'?s|this\\s+is|is|are)\\s+(?:perfectly\\s+|completely\\s+|totally\\s+|quite\\s+)?(?:normal|safe|harmless|fine)|nothing\\s+to\\s+worry|no\\s+need\\s+to\\s+worry|don'?t\\s+worry|no\\s+danger|not\\s+dangerous|no\\s+cause\\s+for\\s+concern)${NR}`,
  `${NL}(?:(?:ist|sind)\\s+(?:ganz\\s+|völlig\\s+|vollig\\s+)?(?:normal|ungefährlich|ungefahrlich|harmlos|sicher)|keine\\s+sorge|kein\\s+grund\\s+zur\\s+sorge|keine\\s+gefahr)${NR}`,
  `${NL}(?:(?:c'est|est)\\s+(?:tout\\s+à\\s+fait\\s+|parfaitement\\s+)?(?:normal|sans\\s+danger|inoffensif)|pas\\s+de\\s+danger|ne\\s+vous\\s+inquiétez\\s+pas|aucun\\s+danger)${NR}`,
  `${NL}(?:(?:es|está|esta)\\s+(?:totalmente\\s+|completamente\\s+)?(?:normal|segur[oa]|inofensiv[oa])|no\\s+se\\s+preocupe|no\\s+hay\\s+peligro|sin\\s+peligro)${NR}`,
  `${NL}(?:это\\s+нормально|безопасно|не\\s+опасно|не\\s+волнуйтесь|не\\s+беспокойтесь|нет\\s+опасности)`,
  `(?:طبيعي|آمن|لا\\s+خطر|لا\\s+داعي\\s+للقلق|لا\\s+تقلق)`,
]);

/** Cevap tehlike konusunda güvence veriyor mu (katlanmış biçimde)? */
export function hasSafetyReassurance(reply: string | null | undefined): boolean {
  if (typeof reply !== "string" || reply.trim() === "") return false;
  return REASSURANCE.test(foldTurkishAscii(reply.replace(/\s+/g, " ")));
}

// ─── ACİL ARAMA YÖNERGESİ (kurucu kararı 10-11: "112'yi arayın yazmasın … hiçbir şekilde") ─────────────────────────────────────────
// Misafire giden cevapta "112'yi / polisi / ambulansı / acil servisi arayın" yönergesi. Yalnız numara ("Ambulans: 112") yönerge DEĞİL
// (kurucu: "sorulursa numarasını verebilir"); "ev sahibinizi / bizi arayın" acil servis değil. Yönerge = arama fiilinin NESNESİ acil
// servis / numara: Türkçede nesne fiilden önce (en çok iki sözcük arayla: "112'yi hemen arayın"), öteki dillerde fiilden sonra (en çok üç
// sözcük: "Rufen Sie sofort die Polizei"); arada "bizi / us / uns …" nesnesi varsa yönerge değil. Daire / kat / dahili numarası ("Daire
// 117'de", "155 dahili") acil numara değil (Haiku incelemesi 10-11). Aksan / hemze katlanır (ä, í, إ). Pencereler sınırlı → doğrusal.
const EMERGENCY_NUMBER = `${NL}(?<!(?:daire|kat|dahili|oda|no|apartment|room|flat|unit|suite|apt|numara|number)\\.?\\s{0,2})(?:112|155|156|110|177|911|999|117|118|119|190|101|102|103|997|091)${NR}(?!\\s*(?:numarali|nolu|no${NR}|dahili)|['’]?[dt][ae]n?${NR})`;
const EMERGENCY_SERVICE = `${NL}(?:acil\\s+servis${LB}|acil\\s+yardim${LB}|ambulans${LB}|polis${LB}|itfaiye${LB}|jandarma${LB}|emergency\\s+(?:services?|number|line)|ambulance|police|fire\\s+(?:department|brigade|service)|notruf${LB}|notarzt${LB}|krankenwagen|rettungs(?:dienst|wagen)|polizei|feuerwehr|pompiers|urgences|samu|emergencias|policia|bomberos|ambulancia|скор\\p{L}{0,8}|полици\\p{L}{0,8}|пожарн\\p{L}{0,8}|экстренн\\p{L}{0,8}|(?:ب|و|ل)?(?:ال)?(?:اسعاف|شرط\\p{L}{0,2}|طوار\\p{L}{0,2}))`;
const TR_CALL = `(?:ara(?:y|m)\\p{L}{0,12}|cagir\\p{L}{0,8}|cevir\\p{L}{0,8}|tusla\\p{L}{0,8}|ulas\\p{L}{0,10}|basvur\\p{L}{0,8}|telefon\\s+(?:ed|ac)\\p{L}{0,10}|haber\\s+ver\\p{L}{0,8})${NR}`;
const OTHER_CALL = `${NL}(?:call|dial|phone|ring|contact\\p{L}{0,4}|rufen|anrufen|wahlen|appel\\p{L}{0,4}|compos\\p{L}{0,4}|llam\\p{L}{0,4}|marque|звон\\p{L}{0,6}|позвон\\p{L}{0,6}|вызов\\p{L}{0,6}|набер\\p{L}{0,6}|اتصل\\p{L}{0,4})${NR}`;
const NOT_US = `(?!(?:bizi|beni|bize|bana|ev|sahib\\p{L}*|us|me|uns|mich|nous|moi|nos)${NR})`;
const EMERGENCY_DIRECTIVE = rx([
  `(?:${EMERGENCY_NUMBER}|${EMERGENCY_SERVICE})\\S{0,6}(?:\\s+${NOT_US}\\S{1,20}){0,2}\\s+${TR_CALL}`,
  `${OTHER_CALL}(?:\\s+${NOT_US}\\S{1,20}){0,3}\\s+(?:${EMERGENCY_NUMBER}|${EMERGENCY_SERVICE})`,
]);

/** Cevap misafiri acil numarayı / acil servisi ARAMAYA yönlendiriyor mu (Türkçe + aksan katlanmış biçimde)? */
export function hasEmergencyCallDirective(reply: string | null | undefined): boolean {
  if (typeof reply !== "string" || reply.trim() === "") return false;
  const folded = foldTurkishAscii(reply.replace(/\s+/g, " ")).normalize("NFD").replace(/\p{M}/gu, "");
  return EMERGENCY_DIRECTIVE.test(folded);
}

/**
 * Güvencenin bilgi tabanında dayanağı var mı ("Kombi çalışırken bacadan buhar çıkması normaldir.")? Bilgi tabanı metninde güvence
 * sözü bir tehlike / buhar sözcüğünün ±120 karakter çevresinde geçmeli. Dayanak yoksa güvence KAYNAKSIZDIR.
 */
const REASSURANCE_TOPIC = rx([
  `${NL}(?:duman${LB}|buhar${LB}|yanik${LB}|koku${LB}|alarm${LB}|ses${LB}|gaz${LB}|su${NR}|kivilcim${LB})`,
  `${NL}(?:smoke|steam|vapou?r|smell|alarm|noise|gas|water|spark${LB})${NR}`,
  `${NL}(?:rauch|dampf|geruch|alarm|gas|wasser|funken)${NR}`,
  `${NL}(?:fumée|fumee|vapeur|odeur|alarme|gaz|eau)${NR}`,
  `${NL}(?:humo|vapor|olor|alarma|gas|agua)${NR}`,
  `${NL}(?:дым${LB}|пар${NR}|запах${LB}|газ${LB}|вод${LB})`,
  `(?:دخان|بخار|رائحة|غاز|ماء)`,
]);
export function kbSupportsReassurance(kbFacts: readonly string[] | null | undefined): boolean {
  for (const raw of kbFacts ?? []) {
    if (typeof raw !== "string" || raw === "") continue;
    const fact = foldTurkishAscii(raw.slice(0, 24_000).replace(/\s+/g, " "));
    const re = new RegExp(REASSURANCE.source, "giu");
    for (const m of fact.matchAll(re)) {
      const at = m.index ?? 0;
      if (REASSURANCE_TOPIC.test(fact.slice(Math.max(0, at - 120), at + m[0].length + 120))) return true;
    }
  }
  return false;
}

// ─── 51: acil KARARI (bağlam ilkesi) ──────────────────────────────────────────────────────────────────────────────────
export interface HazardDecisionInput {
  /** Değerlendirilen misafir metinleri (QR: güncel mesaj; kanal: cevapsız mesajların tamamı). */
  texts: readonly string[];
  /** Anlama katmanı başarıyla koştu mu (kapalı / düştü = false)? */
  understandingRan: boolean;
  /** Anlama katmanı bu turda "acil" dedi mi? */
  understandingEmergency: boolean;
}
export interface HazardDecision {
  evidence: HazardEvidence;
  /** Fiziksel tehlike için ACİL mi (güvenlik satırı + alarm)? */
  emergency: boolean;
  /**
   * Kelime ağının "acil" etiketi bu turda bağlamla KALDIRILDI mı? Yalnız: fiziksel düzey açık DEĞİL; etiket yalnız fiziksel tehlike
   * sözcüklerinden ve / veya bağlamı belirsiz kalıplardan (`AMBIGUOUS_EMERGENCY`) geliyor (maskelenince mesajda acil kalmıyor); ve: anılan
   * fiziksel tehlike (olumsuz / geçmiş / varsayım) ya da anlama modeli koştu ve "acil değil" dedi (koşmadıysa güvenli taraf: etiket kalır).
   */
  lexicalCleared: boolean;
  /**
   * Kalkan etiket OLASI fiziksel tehlikeden mi geldi? O zaman acil değil ama ev sahibinin işi: etiket ŞİKÂYET olarak kalır (kurucu: "Komşunun
   * sigara dumanı geliyor → genellikle şikâyet akışı"; kettle dumanı, tavandan akan su). Anılan tehlike / belirsiz kalıp → etiket tamamen kalkar.
   */
  clearedAsIssue: boolean;
}

/**
 * Kelime ağı etiketlerinin bağlam kararından geçmiş hâli (TEK kural — kanal kapısı, QR kapısı, öğe planı, rozet ve karar kaydı aynı sırayı
 * kullanır): etiket kalkmadıysa aynen; kalktıysa acil etiketi düşer, olası tehlikede yerine (yoksa) şikâyet gelir.
 */
export function contextLabels(labels: readonly string[], decision: { lexicalCleared?: boolean; clearedAsIssue?: boolean } | null | undefined): string[] {
  if (!decision?.lexicalCleared || !labels.includes("safety_emergency")) return [...labels];
  if (!decision.clearedAsIssue) return labels.filter((l) => l !== "safety_emergency");
  return labels.includes("complaint")
    ? labels.filter((l) => l !== "safety_emergency")
    : labels.map((l) => (l === "safety_emergency" ? "complaint" : l));
}

/**
 * 51 a–f — acil sözcük ağının ANLAMI BAĞLAMA BAĞLI kalıpları (kurucu: "51'e de bağlam ilkesini uygula"). Bu kalıplardan gelen "acil" etiketini
 * ANLAMA MODELİ kaldırabilir (koştu ve "acil değil" dedi); model koşmadıysa / düştüyse etiket kalır (güvenli taraf). Aynı mesajda başka acil
 * sözcüğü varsa maskeden sonra da kalır → kaldırılmaz ("Помогите, пожалуйста! Мама упала…", "Emergency! What's the number?").
 *  a) övgü "-(y)A bayılmak" (sevmek): yönelme ekli ad + 1. şahıs ("Daireye bayıldık", "Manzaraya bayıldım"); öteki şahıslarda yalnız bilinen
 *     yer / şey adıyla ("Çocuklar havuza bayıldı"). "Annem bayıldı", "Hepimiz bayıldık, başımız dönüyor" AÇIK kalır.
 *  b) "düştü" öznesi bağlantı / fiyat / ölçü ("İnternet düştü", "Fiyatlar düştü mü?", "Suyun basıncı düştü"); "Annem düştü" açık kalır.
 *  d) Rusça nezaket "Помогите, пожалуйста, …" (tek başına "Помогите!" açık kalır).
 *  e) ağa / uygulamaya giriş yapamama ("No puedo entrar a la red wifi", "Не могу войти в сеть Wi-Fi", "لا أستطيع الدخول إلى شبكة الواي فاي").
 *  f) acil numara / varsayım / aile acil durumu ("What's the emergency number, just in case?", "Acil bir durumda hangi numarayı…",
 *     "cancel due to a family emergency"). Arapça "رقم الطوارئ" / "في حالة الطوارئ" kalıbı YOK: Arapça acil sözcük ağı "طوارئ"yi acil saymıyor
 *     (kaldırılacak etiket doğmuyor, ölçüldü; pinli) — ağa eklenirse buraya da eklenir. Rusça "номер скорой / экстренной службы" ve
 *     "в экстренном случае" de öyle (ağ saymıyor; "скорой" ayrıca olay sözcüğü sayılır).
 * Kural ihlali ağının "party / parti" belirsizliği (51 g) bu modülün konusu DEĞİL: karar ev kuralı sinyalini (bugün gölgede) ister — ayrı onay.
 */
const TR_PRAISE_NOUNS =
  "(?:daire|ev|evin|oda|manzara|havuz|teras|balkon|plaj|deniz|kahvalti|konum|mahalle|bahce|mutfak|dekor|dekorasyon|jakuzi|sauna|sehir|mekan|tasarim|banyo|salon|yatak|esya|ortam|atmosfer)";
const AMBIGUOUS_EMERGENCY = rxg([
  `${NL}(?:\\p{L}{1,20}y[ae]|${TR_PRAISE_NOUNS}\\p{L}{0,6}[ae])\\s+(?:cok\\s+|resmen\\s+|adeta\\s+|gercekten\\s+)?bayil(?:dik|dim|iyoruz|iyorum)${NR}`,
  `${NL}${TR_PRAISE_NOUNS}\\p{L}{0,6}[ae]\\s+(?:cok\\s+|resmen\\s+|adeta\\s+|gercekten\\s+)?bayil(?:di|diniz|dilar|iyor|iyorlar|iyorsunuz|acak|acaksiniz)${NR}`,
  `${NL}(?:internet\\p{L}*|wi-?fi\\p{L}*|net${NR}|baglanti\\p{L}*|sinyal\\p{L}*|fiyat\\p{L}*|basinc\\p{L}*|sicaklik\\p{L}*|sarj\\p{L}*|hiz\\p{L}*|kalite\\p{L}*)\\s+(?:\\p{L}+\\s+)?dustu\\p{L}{0,6}${NR}`,
  `${NL}no\\s+(?:puedo|podemos)\\s+(?:entrar|acceder|conectar(?:me|nos)?)\\s+(?:a|al|en)\\s+(?:la\\s+|el\\s+|mi\\s+)?(?:red|wifi|wi-fi|internet|aplicaci[oó]n|app|cuenta)${NR}`,
  `(?:لا\\s+(?:أستطيع|نستطيع|يمكنني|يمكننا)\\s+(?:الدخول|الاتصال)\\s+(?:إلى|ب)\\s*(?:شبكة|الشبكة|الواي\\s*فاي|الإنترنت|التطبيق|الحساب))`,
  `${NL}(?:emergency\\s+(?:number|phone|contact)s?|notfall\\p{L}*nummer\\p{L}*|notrufnummer\\p{L}*|num[eé]ro\\s+d'urgence|n[uú]mero\\s+de\\s+emergencia|acil\\s+(?:durum\\s+)?numara\\p{L}*)${NR}`,
  `${NL}(?:in\\s+case\\s+of\\s+(?:an\\s+)?emergenc\\p{L}*|just\\s+in\\s+case|im\\s+notfall|en\\s+cas\\s+d'urgence|en\\s+caso\\s+de\\s+emergencia|acil\\s+bir\\s+durumda|acil\\s+durumlarda)${NR}`,
  `${NL}(?:family\\s+emergenc\\p{L}*|aile(?:vi|mde|mizde)?\\s+(?:bir\\s+)?acil\\s+durum\\p{L}*|famili[äa]re[nrs]?\\s+notfall\\p{L}*|urgence\\s+familiale|emergencia\\s+familiar)${NR}`,
]);
/**
 * Rusça kalıplar AYRI ve yalnız mesajda olay sözcüğü YOKKEN maskelenir: Rusça acil sözcük ağı sağlık olaylarında zayıf ("Мама упала, идёт кровь"
 * tek başına acil sayılmıyor — Sabah Kararları 51 EK) → "Помогите, пожалуйста! Мама упала…" mesajında tek tetik "помогите" olabilir.
 */
const AMBIGUOUS_EMERGENCY_RU = rxg([
  `${NL}помогите,?\\s+пожалуйста${NR}`,
  `${NL}не\\s+(?:могу|можем)\\s+(?:войти|зайти|подключиться)\\s+(?:в|к)\\s+(?:сеть|wi-?fi|вай-?фай|интернет|приложени\\p{L}*|аккаунт)`,
]);
const RU_INCIDENT =
  /(?:упал|кров|травм|скор(?:ую|ая|ой)|сознани|не\s+дыш|сломал|перелом|бол[ьи]|приступ|ранен|порез|поранил|ож[её]г|обж[её]г|задыха|судорог|инсульт|инфаркт|аллерги|отравл|пожар|дым|газ|затоп|ударил|умира|плохо|врач|больниц|полици|украл|напал|угрож)/iu;

export function maskAmbiguousEmergency(folded: string): string {
  const out = folded.replace(AMBIGUOUS_EMERGENCY, " ");
  return RU_INCIDENT.test(out) ? out : out.replace(AMBIGUOUS_EMERGENCY_RU, " ");
}

export function hazardDecisionFor(
  input: HazardDecisionInput,
  lexicalEmergencyOf: (text: string) => boolean,
): HazardDecision {
  let evidence: HazardEvidence = { level: "none", kinds: [] };
  for (const t of input.texts) {
    const e = hazardEvidenceOf(t);
    if (RANK[e.level] > RANK[evidence.level]) evidence = e;
    else if (e.level === evidence.level) evidence = { level: e.level, kinds: [...new Set([...evidence.kinds, ...e.kinds])] };
  }
  const level = evidence.level;
  const emergency =
    level === "clear" ||
    (level === "possible" && (!input.understandingRan || input.understandingEmergency)) ||
    (level === "mentioned" && input.understandingRan && input.understandingEmergency);
  const lexicalAny = input.texts.some((t) => lexicalEmergencyOf(t));
  // Fiziksel tehlike sözcükleri ve bağlamı belirsiz kalıplar maskelenince mesajda acil kalmıyorsa etiket BAĞLAMA bağlıdır (kaldırılabilir).
  const maskedPhysical = input.texts.map((t) => maskHazardMentions(t));
  const clearable = input.texts.every((t, i) => !lexicalEmergencyOf(t) || !lexicalEmergencyOf(maskAmbiguousEmergency(maskedPhysical[i])));
  const ambiguousInvolved = input.texts.some((t, i) => lexicalEmergencyOf(t) && lexicalEmergencyOf(maskedPhysical[i]));
  const modelSaysNo = input.understandingRan && !input.understandingEmergency;
  const lexicalCleared =
    lexicalAny &&
    clearable &&
    !emergency &&
    // Belirsiz kalıp (övgü, bağlantı düştü, nezaket, acil numara…) ve anılışsız / olası fiziksel düzey: kararı MODEL verir; anılan (olumsuz /
    // geçmiş / varsayım) fiziksel tehlike model koşmadan da kalkar.
    (ambiguousInvolved ? modelSaysNo : level === "mentioned" || ((level === "possible" || level === "none") && modelSaysNo));
  return { evidence, emergency, lexicalCleared, clearedAsIssue: lexicalCleared && level === "possible" };
}

/** Fiziksel tehlike anılışlarını nötr işaretle değiştirir — kalan metinde BAŞKA bir acil sınıfı var mı diye bakmak için. */
const HAZARD_WORDS_FOR_MASK = rxg([
  `${NL}(?:yangin${LB}|alev${LB}|ates${LB}|tutus${LB}|duman${LB}|yanik${LB}|yaniyor|yandi|gaz${LB}|dogalgaz${LB}|su\\s+bas${LB}|sel${NR}|kivilcim${LB}|elektrik\\s+carp${LB}|carpildi${LB})`,
  `${NL}(?:fire${LB}|flames?|burn${LB}|smok${LB}|gas${LB}|flood${LB}|leak${LB}|spark${LB}|shock${LB}|electrocut${LB})`,
  `${NL}(?:feuer${LB}|brand${LB}|brennt|flammen|rauch${LB}|gas${LB}|uberflut${LB}|überflut${LB}|funken|stromschlag|wasser${LB})`,
  `${NL}(?:feu${LB}|incendie${LB}|flammes?|brûle|brule|fumée${LB}|fumee${LB}|gaz|inond${LB}|étincelle${LB})`,
  `${NL}(?:fuego${LB}|incendio${LB}|llamas|quema${LB}|humo${LB}|gas${NR}|inund${LB}|chispa${LB})`,
  `${NL}(?:пожар${LB}|огон${LB}|огн${LB}|гор${LB}|пламя|дым${LB}|газ${LB}|затоп${LB}|искр${LB}|ток${LB})`,
  `(?:حريق|نار|النار|لهب|يحترق|دخان|الدخان|غاز|فيضان|شرار${LB}|صعق${LB})`,
]);
export function maskHazardMentions(text: string): string {
  return foldTurkishAscii(text).replace(HAZARD_WORDS_FOR_MASK, " ");
}
