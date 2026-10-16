// ---------------------------------------------------------------------------
// HASSAS TALEP + BAŞKA SORU AYNI TURDA: ÖNCE ANLAM İLİŞKİSİ (kurucu kararı 10-01 sabah, Sabah Kararları 17 + 18 "a"). Saf; DB / ağ yok.
//
// Sabit tür listesi (`core.COMPLAINT_INDEPENDENT_KINDS`) iki yönde yanlış karar veriyordu: "Klima çalışmıyor; çöp konteyneri nerede?"de çöp
// sorusunu tutuyor, "Otopark kapısı açılmıyor, nasıl çıkacağız?"da arızaya bağlı soruyu (otopark türü) cevaplanabilir sayıyordu. Yeni kural:
//  1. ANLAM (model): anlama katmanı her isteği işaretler (`relation`) — kendi konusu (`own_topic`), arıza çözümü (`fix_request`), şikâyetin /
//     iadenin / ev sahibi talebinin devamı (`follow_up`) ya da belirsiz (`unclear`). İşaret yok / tanınmıyor → belirsiz → TUTULUR.
//  2. KOD KORUMASI (yalnız sıkılaştırır): "kendi konusu" denen istek, tutulan talebin KONUSUNU paylaşıyorsa (otopark kapısı ↔ otopark
//     sorusu) ya da kendine ait bir konusu yoksa ("tekrar olursa ne yapmalı") yine bağlıdır. Şikâyet turunda ev kuralı sorusu bağlıdır
//     (şikâyet edene kural hatırlatması — kurucu: A seçeneği bunu kapsamaz).
//  3. ARIZA ÇÖZÜMÜ (18 "a"): yalnız şikâyet turunda, cihaz / tesis türünde ve tehlike sınıfı DIŞINDA cevaplanabilir; cevap bilgi tabanına
//     dayanmak zorunda (kapı `kb:` kaynağı ister) ve elektrik / gaz / sıcak su cihazı / yangın adımı taşıyamaz (kapı cevabı da tarar).
// Bağımsızlık işareti GÖNDERİM İZNİ DEĞİLDİR: kaynak, sır, erişim ve öteki bütün kapı kontrolleri aynen koşar. Hassas talep cevapla
// KAPANMAZ (`core.nextStatus`), ev sahibi bildirimi mesaj başına tektir (`flow.notifyHeldItems`). İşaret yalnız öğe kipi + şikâyet takibi
// anahtarı açıkken üretilir; yoksa bugünkü liste kuralı birebir (`plan.ts`).
// ---------------------------------------------------------------------------

import { expandQuery } from "@/lib/ai/retrieval/lexicon";
import { matchForeignConcepts } from "@/lib/ai/retrieval/lexicon-foreign";
import { contentStems, phraseUnits, tokenize } from "@/lib/ai/retrieval/text";
import { hasMoneyStatement } from "@/lib/ai/stay-money";
import type { ItemKind } from "./core";
import type { ItemRelation } from "./relation-kinds";

export { ITEM_RELATIONS, type ItemRelation } from "./relation-kinds";

/** Yanındaki soruyu bağlayabilen tutulan talepler (kurucu: şikâyet + iade / iptal + ev sahibiyle görüşme). */
export const RELATION_ANCHOR_KINDS: ReadonlySet<ItemKind> = new Set<ItemKind>(["complaint_issue", "cancellation_refund", "human_request"]);

/** Arıza çözümünün cevaplanabileceği cihaz / tesis türleri (ek koşul — tek başına izin değil). */
export const FIX_KINDS: ReadonlySet<ItemKind> = new Set<ItemKind>(["wifi", "appliance_help", "access_keys", "parking", "amenities"]);

/** Konu sayılmayan genel kavramlar (şifre / kod, "tavsiye / yakın", genel "kural") — iki ayrı soruyu yanlışlıkla bağlamasın. */
const GENERIC_TOPICS: ReadonlySet<string> = new Set(["credentials", "sights", "rules"]);

/** Türün kendi konusu (sorgu kavram taşımasa da): yalnız açık eşlemeler. */
const KIND_TOPICS: Readonly<Partial<Record<ItemKind, readonly string[]>>> = {
  parking: ["parking"],
  wifi: ["wifi"],
  trash: ["trash"],
  access_keys: ["keys"],
  checkin_time: ["checkin"],
  early_checkin: ["checkin"],
  checkout_time: ["checkout"],
  late_checkout: ["checkout"],
  pets: ["pets"],
};

/**
 * Tehlike sınıfının kavramları (Türkçe + yabancı sözlük): sıcak su / ısıtma (kombi, şofben, termosifon, "Warmwasser", "eau chaude"…).
 * BİLEREK yok: elektrik (`power`) — yabancı sözlükte "Strom / luz / свет / كهرباء" da onun, "Router vom Strom trennen" / "la luz del
 * router" modem tarifiydi; yangın (`fire`) — kalıbı "acil çıkış"tır ve ASCII katlamada "açılmıyor … çıkacağız" ona iniyordu (ölçüldü).
 * İkisi aşağıdaki açık sözlükle okunur (sigorta / şalter / pano / kesinti · yangın / duman / alev / kıvılcım).
 */
const HAZARD_TOPICS: ReadonlySet<string> = new Set(["hot_water", "heating"]);

/** Metnin konu kavramları (getirme sözlüğü; Türkçe kök + yabancı yüzey biçimi + yerel cihaz sözlüğü). Genel kavramlar düşer. */
export function topicsOf(text: string): string[] {
  if (!text || !text.trim()) return [];
  const { matched } = expandQuery(contentStems(text), matchForeignConcepts(text), phraseUnits(text), {
    possessive: true,
    tokens: tokenize(text),
  });
  const f = fold(text);
  const local = LOCAL_DEVICE_WORDS.filter(([re]) => re.test(f)).map(([, id]) => id);
  return [...new Set([...matched.map((m) => m.concept.id), ...local])].filter((id) => !GENERIC_TOPICS.has(id)).sort();
}

/**
 * Arızalı isteğin konuları (yalnız arıza koruması — sentetik şikâyet öğesinin konusu): genel konu + TV belirti adları (`TV_SYMPTOM` —
 * "Ekranda görüntü yok" sorgusunda "televizyon" geçmeyebilir). Sentetik şikâyet bağlayıcı türdür → konusu yalnız SIKILAŞTIRAN okumalara girer.
 */
export function faultTopics(queryTr: string, queryOriginal: string, kind: ItemKind): string[] {
  return [...new Set([...topicsWithSymptomsOf(queryTr), ...topicsWithSymptomsOf(queryOriginal), ...(KIND_TOPICS[kind] ?? [])])].sort();
}

/**
 * İsteğin konuları: Türkçe + özgün dildeki sorgu + türün kendi konusu. TV belirti adları ("Ekranda görüntü yok" → tv) YALNIZ bağlayıcı türde
 * (şikâyet / iade / ev sahibi talebi — hep hassas, hiç cevaplanmaz): onların konusu yalnız örtüşmeye ve bırakılan cihaz kümesine girer, ikisi de
 * yalnız SIKILAŞIR (Haiku 10-15 gece). Cevaplanabilir istekte belirti adı OKUNMAZ — Opus gece-2 M6 (ölçüldü): orada konu üç GEVŞETEN okumaya da
 * giriyordu (tarif var mı · kendi konusu var mı · cevaplanan konu bırakılan kümeden düşer); "Diyafonda görüntü yok" isteği TV tarifiyle
 * cevaplanabilir oluyordu. Bilgi tabanı tarafı (`kbRecipeTopics`, `kbSubjectTopics`) genel `topicsOf` ile kalır (Opus N2).
 */
export function requestTopics(queryTr: string, queryOriginal: string, kind: ItemKind): string[] {
  const read = RELATION_ANCHOR_KINDS.has(kind) ? topicsWithSymptomsOf : topicsOf;
  return [...new Set([...read(queryTr), ...read(queryOriginal), ...(KIND_TOPICS[kind] ?? [])])].sort();
}

/** Harf katlama (aksan, büyük harf, Türkçe ı/İ, Rusça ё): tehlike ve genel soru sözlükleri bu biçimde yazılır. */
function fold(s: string): string {
  return s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/ı/g, "i").replace(/[’‘ʼ`´]/g, "'");
}

const L = "(?<![\\p{L}\\p{N}])";
const R = "(?![\\p{L}\\p{N}])";
/** Kök + çekim eki (Türkçe ekler; diğer dillerde çoğul / çekim). */
const stemRe = (stems: readonly string[]) => new RegExp(`${L}(?:${stems.join("|")})\\p{L}{0,12}${R}`, "u");
/** Tam sözcük (yalnız verilen biçimler). */
const wordRe = (words: readonly string[]) => new RegExp(`${L}(?:${words.join("|")})${R}`, "u");

/**
 * YEREL CİHAZ SÖZLÜĞÜ (15 ajan A06, 10-01 — ölçüldü): getirme sözlüğünde olmayan ya da kök sökücünün kaçırdığı cihaz adları konu
 * vermiyordu ("şofben", "petek", "kondisyoner", "mikro dalga", "kilidi", "televizyonun", klima kumandasının "kar tanesi" simgesi,
 * "lave-linge", "televisor") → örtüşme koruması (şofben şikâyeti + "kendi konusu" denen şofben sorusu) ve bırakılan cihaz kapısı
 * ("Kumandada MODE tuşuna basıp kar tanesini seçin" klima adımıdır) göremiyordu. Getirme sözlüğüne EKLENMEZ: o canlı bilgi tabanı
 * seçimini değiştirir (ölçüm ister); burada yalnız konu eşlemesi. Katlanmış metin, sınırlı tekrar (doğrusal).
 */
const LOCAL_DEVICE_WORDS: readonly (readonly [RegExp, string])[] = [
  [new RegExp(`${L}sofben\\p{L}{0,10}${R}`, "u"), "hot_water"],
  [new RegExp(`${L}pete[kg]\\p{L}{0,10}${R}`, "u"), "heating"],
  [new RegExp(`${L}kondisyoner\\p{L}{0,10}${R}`, "u"), "ac"],
  [new RegExp(`${L}mikro[ -]?dalga\\p{L}{0,10}${R}`, "u"), "microwave"],
  [new RegExp(`${L}kilid\\p{L}{0,8}${R}`, "u"), "keys"],
  [new RegExp(`${L}televizyon\\p{L}{0,10}${R}`, "u"), "tv"],
  [new RegExp(`${L}televisor(?:es)?${R}`, "u"), "tv"],
  [new RegExp(`${L}(?:kar tanes\\p{L}{0,6}|snowflake\\p{L}{0,2}|schneeflocke\\p{L}{0,2}|flocon\\p{L}{0,2}|copo de nieve|снежинк\\p{L}{0,3})${R}`, "u"), "ac"],
  [new RegExp(`${L}lave[ -]linge${R}`, "u"), "laundry"],
];

/**
 * TV'nin BELİRTİ / parça adları (Opus 10-15 P2, ölçüldü): 5.1'in bırakılan TV için uydurduğu "Ekranda görüntü yoksa kaynak girişinin (HDMI/AV)
 * doğru seçili olduğundan emin olur musunuz" cümlesi "televizyon" sözcüğü geçmediği için bırakılan cihaz kapısından geçiyordu.
 * 🚨 `topicsOf`a (genel konu çıkarımı) GİRMEZ — Opus N2 (10-15 gece, ölçüldü): genel sözlükte "görüntülü diyafon" kalemi bilgi tabanında TV
 * TARİFİ sayılıyor (`kbRecipeTopics`), tarifsiz TV arızası "çözüm" olarak cevaplanabilir oluyordu (yani sıkılaştırmak yerine GEVŞETİYORDU) ve
 * "Görüntülü diyafon" başlığının anahtar tarifi kayboluyordu. Yalnız üç yerde okunur: cevap tarafı (`touchesHeldDevice`, kanıtsız adım
 * kemeri) ve istek tarafındaki arıza sinyali (`faultSignal`). "görüntülü" (diyafon / görüntülü arama) BİLEREK hariç; çıplak "ekran / kaynak /
 * kanal" yok (kumanda ekranı, sıcak su kaynağı…). Katlanmış metin, sınırlı tekrar.
 */
const TV_SYMPTOM = new RegExp(
  `${L}(?:goruntu(?!lu)\\p{L}{0,6}|hdmi|uydu alici\\p{L}{0,6}|siyah ekran|black screen|no picture|smart tv|kein bild|pas d'image|sin imagen)${R}`,
  "u",
);

/**
 * Görüntülü başka cihazlar (Opus gece-2 M6): metin bunlardan birini anıyorsa "görüntü yok" TV belirtisi SAYILMAZ ("Diyafonda görüntü yok",
 * "Kamera görüntüsü gelmiyor"). Katlanmış metin, sınırlı tekrar.
 */
const NON_TV_SCREEN = new RegExp(
  `${L}(?:diyafon\\p{L}{0,6}|interkom\\p{L}{0,6}|intercom\\p{L}{0,2}|kamera\\p{L}{0,6}|camera\\p{L}{0,2}|doorbell\\p{L}{0,2}|kapi zili\\p{L}{0,4}|gegensprech\\p{L}{0,8}|interphone\\p{L}{0,2}|portero\\p{L}{0,2}|домофон\\p{L}{0,3})${R}`,
  "u",
);

/** Cevap / arıza sinyali tarafının cihaz kavramları: genel konu çıkarımı + TV belirti adları (`TV_SYMPTOM`). */
function topicsWithSymptomsOf(text: string): string[] {
  const topics = topicsOf(text);
  if (topics.includes("tv")) return topics;
  const f = fold(text);
  return TV_SYMPTOM.test(f) && !NON_TV_SCREEN.test(f) ? [...topics, "tv"] : topics;
}

/**
 * TEHLİKE SINIFI (kurucu 18 "a" + 10-01 "Elektrik/gaz/sıcak su cihazına müdahaleyi çözüm istisnasına alma"): elektrik panosu / sigorta /
 * şalter, gaz / kombi / şofben / termosifon, sıcak su cihazı, yangın / duman / kıvılcım, cihazı açma / tamir. Yedi dil, katlanmış biçim.
 * Modem / priz / fiş adımı ("fişini prizden çekin"), kumanda tuşu, "güç düğmesi" tehlike DEĞİL. "Su ısıtıcısı" çaydanlık da sıcak su
 * cihazı da olabilir → tehlike sayılır (getirme sözlüğü onu sıcak su kavramına bağlar; temkinli yön, pinli). Yanlış "tehlike" yalnız
 * tutar (güvenli yön); kaçan tehlike adımı misafire gider — liste kavram sınıfıyla (`HAZARD_TOPICS`) birlikte okunur.
 */
const HAZARD_STEMS = stemRe([
  // tr
  "sigorta",
  "salter",
  "elektrik",
  "kombi",
  "sofben",
  "termosifon",
  "dogalgaz",
  "tupgaz",
  "boyler",
  "yangin",
  "duman",
  "kivilcim",
  "atesle",
  "tamir",
  // 15 ajan A06 (10-01, ölçüldü — "Petek vanasını tornavidayla gevşetin", "Ocak düğmesini bastırarak çakmakla yakın" gidiyordu)
  "tornavida",
  "cakmak",
  "kibrit",
  "petek",
  "peteg",
  // en
  "fuse",
  "breaker",
  "circuit",
  "boiler",
  "electrician",
  "ignit",
  "flame",
  "smoke",
  "unscrew",
  "screwdriver",
  "repair",
  // de
  "sicherung",
  "schutzschalter",
  "stromausfall",
  "therme",
  "durchlauferhitzer",
  "warmwasserbereiter",
  "gashahn",
  "gasgeruch",
  "zundflamme",
  "flamme",
  "rauch",
  "funken",
  "aufschraub",
  "schraubenzieher",
  "reparier",
  "hauptschalter",
  "gaszahler",
  "gasleitung",
  "heizkorper",
  "entluft",
  // fr
  "fusible",
  "disjoncteur",
  "electricit",
  "chaudiere",
  "chauffe-eau",
  "veilleuse",
  "fumee",
  "etincelle",
  "deviss",
  "tournevis",
  "repar",
  "radiateur",
  // es
  "disyuntor",
  "electricidad",
  "apagon",
  "caldera",
  "calentador",
  "fuego",
  "chispa",
  "desatornill",
  "destornillador",
  "radiador",
  "diferencial",
  // ru
  "предохранител",
  "электрощит",
  "электричеств",
  "газов",
  "бойлер",
  "водонагревател",
  "пламя",
  "огонь",
  "дым",
  "искрит",
  "открут",
  "отвертк",
  "ремонт",
  "рубильник",
  // ar (önek ekleri ayrı: "ال")
  "فيوز",
  "الفيوز",
  "قاطع",
  "القاطع",
  "غلاية",
  "الغلاية",
  "سخان",
  "السخان",
  "لهب",
  "اللهب",
  "دخان",
  "الدخان",
  "شرارة",
  "مفك",
  "تصليح",
  "اصلاح",
]);
/** Kısa / çok anlamlı sözcükler yalnız TAM biçimiyle ("gazete", "mağaza", "fireplace" tutulmaz). */
const HAZARD_WORDS = wordRe([
  "gaz",
  "gaza",
  "gazi",
  "gazin",
  "gazda",
  "gazdan",
  "gazla",
  "alev",
  "alevi",
  "alevler",
  "gas",
  "electricity",
  "fire",
  "fires",
  "spark",
  "sparks",
  "sparking",
  "feu",
  "termo",
  "humo",
  "purgez",
  "purger",
  "purgue",
  "purgar",
  "узо",
  "автомат",
  "автомата",
  "автоматы",
  "щиток",
  "щитка",
  "щитке",
  "котел",
  "котла",
  "котлу",
  "котле",
  "котлом",
  "искра",
  "искры",
  "газ",
  "газа",
  "газом",
  "газу",
  "غاز",
  "الغاز",
  "نار",
  "النار",
]);
/** Çok sözcüklü kalıplar (katlanmış metinde düz arama). */
const HAZARD_PHRASES: readonly string[] = [
  "sicak su cihaz",
  "sicak su kazan",
  "sicak su tank",
  "kacak akim",
  "elektrik pano",
  "sigorta kutu",
  "sayac pano",
  "kapagini ac",
  "kapagi ac",
  "water heater",
  "hot water tank",
  "pilot light",
  "power outage",
  "power cut",
  "no power",
  "electrical panel",
  "electric shock",
  "fuse box",
  "consumer unit",
  "trip switch",
  "burning smell",
  "open the cover",
  "remove the cover",
  "main switch",
  "with a match",
  "with a lighter",
  "light the stove",
  "light the burner",
  "light the oven",
  "light the hob",
  "light the gas",
  "fi-schalter",
  "fi schalter",
  // "FI" (kaçak akım rölesi) tek başına sözcük OLAMAZ: katlanmış "wi-fi" içinde tam sözcük olarak eşleşirdi → yalnız kalıp.
  "den fi ",
  "fi wieder",
  "tableau electrique",
  "chauffe eau",
  "ballon d'eau chaude",
  "coupure de courant",
  "robinet de gaz",
  "cuadro electrico",
  "llave de gas",
  "interruptor general",
  "стравите воздух",
  "воздух из батаре",
  "المفتاح الرئيسي",
  "لوحة الكهرباء",
  "انقطاع الكهرباء",
  // Kalıplar da KATLANIR: Arapça "ئ" katlamada "ي"ye iner ("الرئيسي" katlanmış metinde "الرييسي") — ölçüldü.
].map((p) => fold(p));

/** Metin tehlike sınıfına değiyor mu (kavram sınıfı ∨ yedi dilli sözlük). Saf, doğrusal. */
export function fixHazard(text: string): boolean {
  if (!text || !text.trim()) return false;
  const f = fold(text);
  if (HAZARD_STEMS.test(f) || HAZARD_WORDS.test(f)) return true;
  if (HAZARD_PHRASES.some((p) => f.includes(p))) return true;
  const { matched } = expandQuery(contentStems(text), matchForeignConcepts(text), phraseUnits(text), { possessive: true, tokens: tokenize(text) });
  return matched.some((m) => HAZARD_TOPICS.has(m.concept.id));
}

/**
 * ARIZA TARİFİ KALEMİ (karar 23 kör doğrulaması, 10-01 öğlen): bilgi tabanı kalemi bir cihaz / tesis için ADIM taşıyor mu — "tuşuna
 * basın", "30 saniye bekleyin", "yeniden başlatın", "HDMI 2'yi seçin", "açılmıyorsa…". Yalnız bilgi veren kalem ("Mutfakta kapsüllü kahve
 * makinesi var", "Bina asansörlüdür", "Ağ adı X, şifre Y") tarif DEĞİLDİR. Kurucunun 18. maddesi: arıza çözümü yalnız bilgi tabanında O
 * ARIZANIN tarifi varsa gider. Kör sette (set 4) tarifi olmayan arızada model ya BOŞ cevap verdi (ürün bunu "kullanılamaz çıktı" sayıp
 * yeniden deniyordu), ya "adımlar bilgide yok" yazdı ya da genel bir adım uydurup şifre kalemine dayandırdı — üçü de istek modele
 * sunulmadan önlenir. İşaretler sorun giderme fiilleridir (bas / bekle / seç / yeniden başlat / "-mıyorsa"); genel kullanım fiili
 * ("kullanın", "kapatın", "getirin") BİLEREK yok ("Çıkışta klimayı kapatın" klima tarifi değildir). Yedi dil, katlanmış biçim; ev sahibi
 * metni üzerinde, doğrusal.
 */
/**
 * İKİ KADEMELİ İŞARET (15 ajan A06, 10-01 — ölçüldü): tek kademede çıkış talimatı ("Çıkarken klimayı kapatıp anahtarı bırakın",
 * "Beim Verlassen die Klimaanlage ausschalten", "apague el aire al salir"), ev kuralı ("Mantenga la puerta cerrada"), ulaşım ("otobüsü
 * bekleyin", "warten Sie auf den Aufzug"), pazarlama ("select your pool day"), yalnız tırmandırma satırı ("If the TV is not working,
 * please message us", "Klima çalışmıyorsa bize yazın") ve İngilizce "basin" (lavabo = katlanmış "basın") TARİF sayılıyordu → o cihazın
 * arıza çözümü modele sunuluyordu (kurucu 18: yalnız O ARIZANIN tarifi varsa).
 *  · GÜÇLÜ işaret tek başına yeter: bas / dokun / yeniden başlat / sıfırla / fişten çek–tak (press, restart, reset, unplug…).
 *  · ZAYIF işaret (kapat / aç / bekle / seç / ayarla / çevir / değiştir / tut) ancak İKİ FARKLI zayıf işaretle ("Modemi kapatıp 30 saniye
 *    bekleyin", "ausschalten und wieder einschalten").
 *  · ARIZA ANMA ("-mıyorsa", "not working", "no funciona"…) sorun giderme başlığıdır ve tek başına yeter — YALNIZ tırmandırma satırı
 *    (arıza anma + "bize yazın / contact us" + hiçbir adım) tarif DEĞİLDİR. Bilgi / iş istemeyen koşul ("bilmiyorsanız", "istemiyorsanız",
 *    "kullanmıyorsanız") arıza anma sayılmaz.
 */
const RECIPE_STRONG_WORDS = wordRe([
  // tr ("basın" ayrı: İngilizce "basin" lavabodur)
  "basiniz",
  "basarak",
  "basip",
  "basili",
  "basinca",
  "basilinca",
  "basmaniz",
  "dokunun",
  "dokunup",
  "dokunarak",
  // en
  "press",
  "pressing",
  "restart",
  "reboot",
  "reset",
  "unplug",
  "replug",
  // de ("drücken" ayrı: katlanmış "drucken" yazdırmaktır)
  "druecken",
  "neustart",
  "neustarten",
  "zurucksetzen",
  // fr
  "appuyez",
  "appuyer",
  "redemarrez",
  "redemarrer",
  "debranchez",
  "rebranchez",
  // es
  "pulse",
  "presione",
  "reinicie",
  "reiniciar",
  "desenchufe",
  // ru (katlanmış: й → и)
  "нажмите",
  "нажать",
  "перезагрузите",
  // ar
  "اضغط",
  "اضغطوا",
  "اضغطي",
]);
/** Türkçe "basın" — İngilizce "the / wash / bathroom … basin" (lavabo) değil. */
const RECIPE_TR_BASIN = new RegExp(
  // Önceki sözcük TAM sözcük olmalı: "tuşuna basın"daki "…a " İngilizce "a basin" sayılmasın (ölçüldü).
  `(?<!(?:^|[^\\p{L}\\p{N}])(?:the|a|wash|hand|bathroom|kitchen|sink|this|each|your|stone|marble|double|small|large|big) )${L}basin${R}`,
  "u",
);
/** Almanca "drücken" — katlanmadan önce (katlanmış "drucken" = yazdırmak). */
const RECIPE_DE_DRUECKEN = new RegExp(`${L}drück(?:en|e|t)?${R}`, "u");
/** Kök + çekim (tr): sıfırla. Çıplak "tuş / düğme / button / Taste / bouton / botón / кнопка / زر" BİLEREK yok ("Kapıda tuşlu kilit var"). */
const RECIPE_STEMS = stemRe(["sifirla"]);
const RECIPE_STRONG_PHRASES: readonly string[] = [
  "yeniden baslat",
  "tekrar baslat",
  // RC60 regresyon koşusu (10-01 gece, set 6): "İnternet kesilirse modemi kapatın, 30 saniye bekleyip yeniden açın" (Türkçe güç döngüsü,
  // İngilizce "turn it back on"un karşılığı) ve dokunmatik "touch and hold the key symbol" tarif sayılmıyordu.
  // ("yeniden açınız" ayrı girdi DEĞİL: alt dize karşılaştırması "yeniden açın"la zaten tutar — mutasyonda eşdeğerdi, silindi.)
  "yeniden acin",
  "yeniden acip",
  "yeniden acabilirsiniz",
  "tekrar acin",
  "tekrar acip",
  "tekrar acabilirsiniz",
  "yeniden takin",
  "tekrar takin",
  "touch and hold",
  "tap and hold",
  "turn it back on",
  "turn off and on",
  "power cycle",
  "اعادة تشغيل",
  "اعد تشغيل",
].map((p) => fold(p));
/** Zayıf işaretler (genel kullanım da olabilir): ancak İKİ FARKLI zayıf işaret tarif sayılır. Küresel bayrak: farklı eşleşmeler sayılır. */
const RECIPE_WEAK_WORDS = new RegExp(
  `${L}(?:${[
    // tr
    "bekleyin",
    "bekleyiniz",
    "bekleyip",
    "bekledikten",
    "secin",
    "seciniz",
    "secip",
    "secerek",
    "ayarlayin",
    "ayarlayip",
    "ayarlayarak",
    "cevirin",
    "cevirip",
    "cevirerek",
    "kapatip",
    "degistirin",
    "degistirip",
    "takin",
    // en
    "hold",
    "holding",
    "select",
    "wait",
    "replace",
    // de
    "drucken",
    "ausschalten",
    "einschalten",
    "warten",
    "wahlen",
    "wechseln",
    "austauschen",
    // fr
    "maintenez",
    "eteignez",
    "rallumez",
    "attendez",
    "selectionnez",
    "remplacez",
    "changez",
    // es
    "mantenga",
    "apague",
    "encienda",
    "espere",
    "seleccione",
    "cambie",
    "reemplace",
    // ru
    "удерживаите",
    "выключите",
    "включите",
    "отключите",
    "подождите",
    "выберите",
    "замените",
    // ar
    "انتظر",
    "انتظروا",
    "اختر",
    "اختاروا",
    "استبدل",
  ].join("|")})${R}`,
  "gu",
);
const RECIPE_WEAK_PHRASES: readonly string[] = ["switch it off", "switch off", "turn it off", "fisini cek", "fisten cek", "fisini cikar"].map((p) => fold(p));
/**
 * KONTROL ADI (zayıf işaret, RC60 regresyon koşusu 10-01 gece): tek başına tarif DEĞİL ("Kapıda tuşlu kilit var", "The coil symbol on the
 * bottom") ama bir zayıf fiille birlikte tarif cümlesidir — "Source tuşuyla TV kaynağını seçin", "MODE tuşuyla COOL seçin", "touch and hold the
 * key symbol", "Maintenez le bouton enfoncé". Kapı anahtarı ("key / anahtar / Schlüssel / مفتاح") BİLEREK yok; "mod" tam sözcük ("modem" değil).
 */
const RECIPE_CONTROL_NOUNS = new RegExp(
  `${L}(?:${[
    // tr
    "tus(?:u|una|uyla|unu|lari|larina)?",
    "dugme(?:si|sine|ye|sini|yle)?",
    "mod(?:u|unu|una|da|unda|undan)?",
    "program(?:i|ini|ina|la)?",
    "simge(?:si|sini|sine)?",
    // en
    "buttons?",
    "mode",
    "settings?",
    "symbol",
    "icon",
    "dial",
    "knob",
    // de
    "tasten?",
    "knopf",
    "modus",
    "programm",
    "schalter",
    // fr
    "bouton",
    "touche",
    "programme",
    "interrupteur",
    "symbole",
    // es
    "boton",
    "tecla",
    "modo",
    "programa",
    "interruptor",
    "simbolo",
    // ru (katlanmış)
    "кнопк\\p{L}{0,3}",
    "режим\\p{L}{0,3}",
    "значок",
    "переключател\\p{L}{0,3}",
    // ar
    "زر",
    "الزر",
  ].join("|")})${R}`,
  "u",
);
/**
 * Olumsuz koşul ("çalışmıyorsa", "açılmıyorsa", "bağlanamıyorsanız") — sorun giderme başlığı. Bilmek / istemek / kullanmak / sevmek / tercih
 * etmek / gerekmek / anlamak arıza değildir ("Kahve makinesini kullanmayı bilmiyorsanız…"). Sınırlı tekrar (karesel iş yok).
 */
const RECIPE_CONDITIONAL = new RegExp(
  [
    `${L}(?!(?:bil|iste|kullan|sev|begen|tercih|gerek|anla)\\p{L}{0,3}m[iu]yorsa)\\p{L}{2,24}m[iu]yorsa(?:niz)?${R}`,
    // RC60 regresyon koşusu (10-01 gece): geniş zamanın olumsuz koşulu YALNIZ 3. şahıs ("çalışmazsa / açılmazsa / boşalmazsa"; "gelmezseniz"
    // misafirin eylemidir) ve kapalı küme olumlu arıza koşulu ("Kol yarıda sıkışırsa … çevirin", "İnternet kesilirse modemi …").
    `${L}(?!(?:bil|iste|kullan|sev|begen|tercih|gerek|anla|unut)\\p{L}{0,3}m[ae]zs[ae])\\p{L}{2,24}m[ae]zs[ae]${R}`,
    `${L}(?:sikisirsa|takilirsa|kesilirse|bozulursa|arizalanirsa)${R}`,
  ].join("|"),
  "u",
);
const RECIPE_FAULT_PHRASES: readonly string[] = [
  "not working",
  "doesn't work",
  "does not work",
  "isn't working",
  "won't turn on",
  "won't connect",
  "funktioniert nicht",
  "geht nicht",
  "ne fonctionne pas",
  "ne marche pas",
  "no funciona",
  "не работает",
  "لا يعمل",
].map((p) => fold(p));
/** Yalnız tırmandırma satırının işareti: "bize yazın / contact us …" (katlanmış biçim). */
const ESCALATION_CONTACT: readonly string[] = [
  "bize yaz",
  "bize ulas",
  "bize haber",
  "bize mesaj",
  "bizi ara",
  "ev sahibine yaz",
  "ev sahibine haber",
  "ev sahibini ara",
  "haber verin",
  "bildirin",
  "iletisime gec",
  "message us",
  "contact us",
  "let us know",
  "call us",
  "text us",
  "reach out",
  "get in touch",
  "contact the host",
  "message the host",
  "let the host know",
  "inform us",
  "schreiben sie uns",
  "kontaktieren sie uns",
  "melden sie sich",
  "rufen sie uns an",
  "geben sie uns bescheid",
  "sagen sie uns bescheid",
  "informieren sie uns",
  "contactez-nous",
  "contactez nous",
  "ecrivez-nous",
  "ecrivez nous",
  "prevenez-nous",
  "prevenez nous",
  "appelez-nous",
  "faites-nous savoir",
  "contactenos",
  "escribanos",
  "avisenos",
  "llamenos",
  "pongase en contacto",
  "напишите нам",
  "свяжитесь с нами",
  "сообщите нам",
  "позвоните нам",
  "تواصل معنا",
  "اتصل بنا",
  "راسلنا",
  "اخبرنا",
].map((p) => fold(p));

/** Bilgi tabanı kalemi bir sorun giderme TARİFİ taşıyor mu (başlık + metin). Saf, doğrusal. */
export function isFixRecipeText(text: string): boolean {
  if (!text || !text.trim()) return false;
  const f = fold(text);
  if (RECIPE_STRONG_WORDS.test(f) || RECIPE_TR_BASIN.test(f) || RECIPE_DE_DRUECKEN.test(text.toLowerCase()) || RECIPE_STEMS.test(f)) {
    return true;
  }
  if (RECIPE_STRONG_PHRASES.some((p) => f.includes(p))) return true;
  const weak = new Set<string>();
  for (const m of f.matchAll(RECIPE_WEAK_WORDS)) weak.add(m[0]);
  for (const p of RECIPE_WEAK_PHRASES) if (f.includes(p)) weak.add(p);
  // Kontrol adı TEK zayıf işaret sayılır (kaç kontrol adı geçerse geçsin): iki kontrol adı fiilsiz tarif yapmaz ("Tuş takımı ve düğme
  // kapının solunda").
  if (RECIPE_CONTROL_NOUNS.test(f)) weak.add("control-noun");
  if (weak.size >= 2) return true;
  if (!RECIPE_CONDITIONAL.test(f) && !RECIPE_FAULT_PHRASES.some((p) => f.includes(p))) return false;
  // Arıza anma tek başına başlıktır — yalnız tırmandırma satırı ("…çalışmıyorsa bize yazın", adım yok) değildir.
  return weak.size > 0 || !ESCALATION_CONTACT.some((p) => f.includes(p));
}

/** Kalemin cümleleri (nokta / ünlem / soru / noktalı virgül / satır / madde işareti). Saat ve ondalık noktası bölmez. */
function sentencesOf(text: string): string[] {
  return text.split(/(?<!\d)[.!?;]+(?!\d)|[\n•]+/u).filter((s) => s.trim() !== "");
}

/** Satırın cümleleri, sonlandırıcısıyla (soru işareti bilinsin). */
function lineSentences(line: string): { text: string; question: boolean }[] {
  const parts = line.split(/((?<!\d)[.!?;]+(?!\d))/u);
  const out: { text: string; question: boolean }[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const text = parts[i] ?? "";
    if (text.trim() !== "") out.push({ text, question: (parts[i + 1] ?? "").includes("?") });
  }
  return out;
}

/**
 * Soru / arıza BAŞLIĞI: "Çamaşır makinesinin kapağı açılmıyor: …", "Kahve makinesi çalışmıyor mu?", "If the router is not working". SSS
 * satırında cihaz bu cümlede anılır, tarif sonraki cümlededir ("2 dakika bekleyin; açılmazsa START/PAUSE tuşuna 3 saniye basılı tutun").
 * Yalnız iki nokta başlık DEĞİL: "Ağ adı: Lale-5G, şifre: …" bilgi cümlesidir, sonraki klima tarifine Wi-Fi'yi geçirmez.
 */
const TR_NEGATIVE_PRESENT = new RegExp(
  `${L}(?!(?:bil|iste|kullan|sev|begen|tercih|gerek|anla)\\p{L}{0,3}m[iu]yor)\\p{L}{2,24}m[iu]yor${R}`,
  "u",
);
function isProblemHeader(s: { text: string; question: boolean }): boolean {
  if (s.question) return true;
  const f = fold(s.text);
  return RECIPE_CONDITIONAL.test(f) || TR_NEGATIVE_PRESENT.test(f) || RECIPE_FAULT_PHRASES.some((p) => f.includes(p));
}

/** Başlıkta liste ayracı ("TV ve İnternet", "Wi-Fi / TV", "Heating & hot water") — yoksa başlık TEK konuyu adlandırır. */
const TITLE_LIST_SEPARATOR = /[,&+/|]|\s(?:ve|ile|and|und|et|y|и|или|or|oder|ou|o)\s|\sو/u;

/**
 * Tek kalemin tarif konuları (15 ajan A06 + RC60 regresyon koşusu 10-01 gece):
 *  · başlık TEK konuyu adlandırıyorsa (tek cihaz kavramı ya da liste ayracı YOK — "Otopark kapısı kumandası çalışmazsa" sözlükte otopark +
 *    kumanda kavramına iner ama tek cihazdır) başlığın cihazları;
 *  · başlık konusuz ("Sık sorulanlar") ya da liste ise ("TV ve İnternet") konu TARİF CÜMLESİNDEN: "Sık sorulanlar" kalemindeki tek klima
 *    adımı, yalnız ANILAN kahve makinesi / çamaşır makinesi / mikrodalga / Wi-Fi'yi tarifli yapmaz. Tarif cümlesi cihazı SATIRININ önceki
 *    cümlesinden alabilir — o cümle soru / arıza başlığıysa ("Çamaşır makinesinin kapağı açılmıyor: … 2 dakika bekleyin; açılmazsa
 *    START/PAUSE tuşuna basılı tutun") ya da tarif cümlesiyle aynı cihazı anıyorsa ("Otopark kapısı kumandayla açılır. Kumanda çalışmazsa
 *    … onay tuşuna basın"). Sonraki cümle ("Modem salonda") ve başka satır miras vermez;
 *  · tarif cümlesi hiç cihaz vermiyorsa eski kural (başlık ya da metnin tamamı).
 */
function recipeTopicsOfItem(title: string, content: string): string[] {
  const text = `${title}\n${content}`;
  if (!isFixRecipeText(text)) return [];
  const titleDevices = deviceTopicsOf(topicsOf(title));
  if (titleDevices.length === 1 || (titleDevices.length > 1 && !TITLE_LIST_SEPARATOR.test(fold(title)))) return titleDevices;
  const fromSentences = new Set<string>();
  for (const line of content.split(/[\n•]+/u)) {
    let previous: { devices: string[]; header: boolean } | null = null;
    for (const s of lineSentences(line)) {
      const own = deviceTopicsOf(topicsOf(s.text));
      if (isFixRecipeText(s.text)) {
        const inherited = previous && (previous.header || previous.devices.some((t) => own.includes(t))) ? previous.devices : [];
        for (const t of [...own, ...inherited]) {
          if (titleDevices.length === 0 || titleDevices.includes(t)) fromSentences.add(t);
        }
      }
      if (own.length > 0) previous = { devices: own, header: isProblemHeader(s) };
    }
  }
  if (fromSentences.size > 0) return [...fromSentences];
  return titleDevices.length > 0 ? titleDevices : deviceTopicsOf(topicsOf(text));
}

/**
 * İsteme giren bilgi tabanı kalemlerinden TARİF taşıyanların konu kavramları: arıza çözümü isteği ancak konusu bu kümedeyse cevap
 * modeline sunulur (`requestDependency`, `recipe`). Konu kavramı bulunmayan cihaz ("jakuzi") tarifle eşlenemez → ev sahibinde kalır.
 * Konu ÖNCE BAŞLIKTAN ("Klima", "Çamaşır makinesi", "Otopark kapısı açılmıyorsa"): metnin tamamı tarifin geçtiği yeri / fiilini de
 * kavrama çeviriyor (modem tarifindeki "yeniden açın" → klima, "TV ünitesinin rafında" → televizyon, şifredeki "Deniz" → plaj — ölçüldü);
 * başlık konusuz / çok konuluysa tarif cümlesinden (`recipeTopicsOfItem`).
 */
export function kbRecipeTopics(items: readonly { title: string; content: string }[]): Set<string> {
  const out = new Set<string>();
  for (const it of items) for (const t of recipeTopicsOfItem(it.title, it.content)) out.add(t);
  return out;
}

/**
 * KANITSIZ ARIZA ADIMI (kurucu 10-15 inceleme notu, aynen: "BOZUKLAR İÇİN BİLGİ TABANINDA YAZMAYAN ÖNERİLER VEREMEZ"; Opus 10-15 P3).
 * Anahtar `AI_FIX_SUPPORT_GATE_ENABLED` VARSAYILAN KAPALI (tam "1"). Yalnız sıkılaştırır: tutulan cevap ev sahibinde taslak kalır.
 */
export function fixSupportGateEnabled(): boolean {
  return process.env.AI_FIX_SUPPORT_GATE_ENABLED === "1";
}

/**
 * Misafire yöneltilmiş DENETİM adımı ("… emin olur musunuz", "kontrol edin", "make sure", "prüfen Sie", "vérifiez", "compruebe",
 * "проверьте"; deneme önerisi ayrı — `TRY_STEP`). `isFixRecipeText` bunları tarif saymaz (bilgi tabanı kalemi için doğru: "Kontrol edin" tek başına
 * tarif değildir) — ama 5.1'in uydurduğu TV adımı tam bu biçimdeydi ("kaynak girişinin doğru seçili olduğundan emin olur musunuz").
 * "check-in / check-out" denetim değildir. Katlanmış metin, sabit alternatifler (doğrusal).
 */
const GUEST_CHECK_STEP = new RegExp(
  [
    `${L}(?:kontrol (?:edin|ediniz|eder misiniz|edebilir misiniz|edip)|emin (?:olun|olunuz|olur musunuz|olabilir misiniz))${R}`,
    `${L}(?:make sure|ensure|verify|check(?![- ]?(?:in|out)${R}))${R}`,
    `${L}(?:prufen sie|uberprufen sie|stellen sie sicher|verifiez|assurez-vous|compruebe|verifique|asegurese|проверьте|убедитесь)${R}`,
    `(?:تأكد|تحقق)`,
  ].join("|"),
  "u",
);

/**
 * ARIZA GİDERME bağlamı (kullanım adımından ayrılır): olumsuz koşul ("-mıyorsa / -mazsa", "… yoksa"), arıza anma ("not working"), yeniden
 * başlatma / fişten çekme / sıfırlama ailesi, deneme ("dener misiniz", "try"). Kullanım adımı ("MODE tuşuyla soğutmayı seçin") bu bağlamı
 * taşımaz — o yalnız cihazın bilgi tabanında KONU olmasını ister; arıza giderme adımı o cihazın TARİFİNİ ister (kurucu 18 "a").
 */
const TROUBLESHOOT_CONTEXT = new RegExp(
  [
    `${L}\\p{L}{2,24} yoksa${R}`,
    `${L}if (?:the |your |it |there )?\\p{L}{0,16} ?(?:is not|isn't|doesn't|does not|won't|will not|still|no )`,
  ].join("|"),
  "u",
);

/**
 * Yeniden başlatma / fişten çekme / sıfırlama ailesi — kendi başına hem ADIM hem ARIZA GİDERME bağlamıdır ("Modemi kapatıp açın" — Haiku 10-15
 * gece: "kapatıp" tek zayıf işaret, "açın" hiçbir listede yoktu → cümle adım sayılmıyordu).
 */
const RESTART_STEP = new RegExp(
  [
    `${L}(?:restart|reboot|reset|unplug|replug|power cycle|turn it back on|neustart\\p{L}{0,2}|zurucksetzen|redemarr\\p{L}{0,3}|debranch\\p{L}{0,3}|rebranch\\p{L}{0,3}|reinici\\p{L}{0,3}|desenchuf\\p{L}{0,3}|перезагруз\\p{L}{0,4})${R}`,
    // "switch the AC off and on again", "turning it off and back on" (Opus gece-2 M2 — "turn off and on" yalnız bitişik biçimdi)
    `${L}(?:turn|turning|switch|switching|power|powering) (?:(?:it|the|your|this) )?(?:\\p{L}{1,20} ){0,2}off and (?:back )?on${R}`,
    // Almanca ayrılabilir fiil: "Starten Sie den Fernseher neu", "Schalten Sie die Klimaanlage aus und wieder ein"
    `${L}(?:starten sie (?:\\p{L}{1,20} ){0,4}neu|schalten sie (?:\\p{L}{1,20} ){0,4}aus und (?:wieder )?ein)${R}`,
    // Türkçe kibar biçim "-(y)abilirsiniz" 11–12 harf (Opus gece-2 M2, ölçüldü: "Klimayı kapatıp açabilirsiniz" adım sayılmıyordu)
    `${L}(?:yeniden|tekrar) (?:baslat|ac|tak)\\p{L}{0,12}${R}`,
    `${L}(?:sifirla\\p{L}{0,12}|fisini (?:cek|cikar)\\p{L}{0,12}|fisten cek\\p{L}{0,12}|kapatip (?:yeniden |tekrar )?ac\\p{L}{0,12})${R}`,
    // Arapça (katlanmış biçim — hemze işareti düşer): "أطفئ … ثم شغله", "أعد تشغيل", "افصل"
    ["أطفئ", "أعد تشغيل", "إعادة تشغيل", "افصل"].map((w) => fold(w)).join("|"),
  ].join("|"),
  "u",
);

/**
 * Misafire yöneltilmiş kip / ikinci şahıs adım biçimleri (Opus gece-2 M2 c): YALNIZ misafirin ARIZA bildirdiği cihazı anan cümlede adım
 * sayılır — kullanım cevabını etkilemez. Türkçe: sınırlı fiil listesi + emir / "-abilirsiniz" / "-manız yeterli" / "-ip"; ad durumu "-ın / -un"
 * ile karışmasın diye çıplak "-in" ekine fiil listesi dışında BAKILMAZ. Diğer diller: kip / nezaket yüklemleri. Katlanmış metin, sınırlı tekrar.
 */
const FAULT_DEVICE_STEP = new RegExp(
  [
    `${L}(?:sec|bas|bastir|degistir|temizle|al|getir|ayarla|ac|kapat|tak|cek|cikar|bekle|kullan|cevir|tut|baslat|bagla|gir|unut|yap|gec|koy|indir|yukselt|dusur|yenile|guncelle|kur|calistir|sok|kaldir|birak|doldur|bosalt|ayir)` +
      `(?:y?in|y?un|y?iniz|y?unuz|y?ip|y?up|y?abilir(?:siniz| misiniz)|y?ebilir(?:siniz| misiniz)|meniz|maniz|menizi|manizi|melisiniz|malisiniz)${R}`,
    // İkinci şahıs "-abilirsiniz" ve edilgen "-ılabilir / -ebilir" (edilebilir, bakılabilir, temizlenebilir) + "temizlenmesi / değiştirmek işe
    // yarar" — arızalı cihaz cümlesinde öneridir. Üçüncü şahıs "görebilir / olabilir" DEĞİL ("ev sahibiniz görebilir" bildirim cümlesiydi).
    `${L}\\p{L}{2,24}(?:ebilir|abilir)(?:siniz| misiniz)${R}`,
    `${L}\\p{L}{1,24}(?:il|ul|in|un|n)(?:ebilir|abilir)${R}`,
    `${L}\\p{L}{2,24}m[ae](?:si|k|niz) (?:ise yara\\p{L}{0,8}|gerek\\p{L}{0,6}|yeterli\\p{L}{0,3}|yardimci ol\\p{L}{0,6}|faydali ol\\p{L}{0,6}|iyi ol\\p{L}{0,6}|(?:sorunu )?coz\\p{L}{0,8})${R}`,
    `${L}(?:you (?:can|could|may|might|should|need to|have to|must)|please|(?:may|might|will|would) need|needs? (?:to|a|new)|should be|make sure)${R}`,
    `^\\s*(?:switch|turn|press|hold|change|replace|clean|select|set|unplug|plug|check|wait|remove|insert|put|use|open|close|try)${R}`,
    `${L}(?:\\p{L}{3,20}en sie|bitte|vous (?:pouvez|devez|pourriez)|veuillez|\\p{L}{3,20}ez|puede|podria|debe|presione|pulse|seleccione|apague|encienda|cambie|limpie|revise|нажмите|выберите|включите|выключите|замените|можете)${R}`,
    ["أطفئ", "شغل", "اضغط", "نظف", "تأكد", "يمكنك"].map((w) => fold(w)).join("|"),
  ].join("|"),
  "u",
);

/**
 * Deneme önerisi ("dener misiniz", "try") — YALNIZ misafir bir arıza bildirdiyse ya da cümle arıza / koşul taşıyorsa arıza giderme bağlamıdır
 * (Haiku 10-15 gece: "Kahve makinesinde farklı bir ayarı deneyebilirsiniz" kullanım önerisiydi, tarif isteniyordu).
 */
const TRY_STEP = new RegExp(
  `${L}(?:dener misiniz|deneyin|deneyiniz|deneyebilirsiniz|deneyebilir misiniz|deneyip|try|versuchen sie|essayez|intente|pruebe|попробуите)${R}|(?<![\\p{L}])(?:و|ف)?جرب\\p{L}{0,2}(?![\\p{L}])`,
  "u",
);

/** Deneme önerisinin cihaz eylemi bağlamı: ayar / tuş / düğme / program / mod (katlanmış; yedi dil). */
const TRY_ACTION_CONTEXT = new RegExp(
  `${L}(?:ayar\\p{L}{0,8}|tus\\p{L}{0,8}|dugme\\p{L}{0,8}|program\\p{L}{0,8}|mod\\p{L}{0,5}|setting\\p{L}{0,2}|button\\p{L}{0,2}|einstellung\\p{L}{0,2}|taste\\p{L}{0,1}|reglage\\p{L}{0,1}|bouton\\p{L}{0,1}|ajuste\\p{L}{0,1}|boton\\p{L}{0,2}|настро\\p{L}{0,4}|кнопк\\p{L}{0,2}|режим\\p{L}{0,3}|uygulama\\p{L}{0,6}|app|apps|application|anwendung)${R}`,
  "u",
);

/**
 * Kumanda adı (her cihazın kumandası olur; getirme sözlüğü onu TV kavramına bağlıyor — ölçüldü: "Kumanda çalışmazsa kapının solundaki tuş
 * takımına 5523 yazın" otopark tarifiydi, TV sayıldı). Yalnız bu kemerin cümle okumasında nötrlenir.
 */
/** Taranan en çok cevap cümlesi (doğrusal tavan; model metni uzun olabilir). */
const MAX_STEP_SENTENCES = 64;

const REMOTE_WORD = new RegExp(
  `${L}(?:kumanda\\p{L}{0,10}|remote(?: control)?s?|fernbedienung\\p{L}{0,2}|t[eé]l[eé]commande\\p{L}{0,2}|mando\\p{L}{0,2}|пульт\\p{L}{0,3})${R}`,
  "giu",
);

/**
 * Cümlenin cihaz kavramları — kumanda nötr; priz / fiş bir cihazın PARÇASIDIR ("modemin fişini prizden çekin"): tek başına geçtiğinde
 * ("Fişini çekip bir dakika bekleyin") cihaz belirsizdir (cihaz adı geçmeyen adım kuralı).
 */
function stepDevicesOf(sentence: string): string[] {
  // Ham metinde (getirme sözlüğü Türkçe harfleri okur; katlanmış metin kökleri kaçırır). Klima / ısı pompası "ısıtma / soğutma MODU" ısıtma
  // tesisatı değildir (Opus gece-2 M3: "MODE tuşuyla soğutma ya da ısıtma modunu seçin" ısıtmaya iniyordu) — mod anılan cümlede nötrlenir.
  // TV mobilyası bir YER adıdır ("Modem salondaki TV ünitesinin alt rafında" — Opus gece-3 P1-a, ölçüldü: tarifli modem adımı TV yüzünden
  // tutuluyordu, altı dilde).
  const neutral = sentence.replace(REMOTE_WORD, " ").replace(TV_FURNITURE, " ");
  const text = MODE_WORD.test(fold(neutral)) ? neutral.replace(CLIMATE_MODE_WORD, " ") : neutral;
  const devices = deviceTopicsOf(topicsWithSymptomsOf(text)).filter((t) => t !== "socket");
  // Getirme sözlüğü "açın / açıp" fiilini klimaya (AC) bağlıyor (ölçüldü 10-15 gece: "Cihazı kapatıp 30 saniye bekleyin, sonra yeniden açın"
  // klima sayılıyor, klima tarifi varsa bulaşık makinesi adımı geçiyordu) — klima ancak cümlede gerçek bir klima adı varsa sayılır.
  const real = devices.includes("ac") && !AC_EVIDENCE.test(fold(sentence)) && !/(?<![\p{L}])A\/?C(?![\p{L}])/u.test(sentence)
    ? devices.filter((t) => t !== "ac")
    : devices;
  return withoutPlaces(real);
}

/**
 * Yer kavramları başka bir cihazla birlikte anıldığında cihaz sayılmaz ("salon" getirme sözlüğünde spor salonu — "Le modem est sous le meuble
 * TV du salon" — Opus gece-3 P1-a). Yalnız yer anılmışsa ("Spor salonunu kartla açın") kalır.
 */
function withoutPlaces(devices: string[]): string[] {
  const devicesOnly = devices.filter((t) => !PLACE_TOPICS.has(t));
  return devicesOnly.length > 0 ? devicesOnly : devices;
}

/**
 * TV mobilyası / yeri ("TV ünitesi / sehpası / altı", "TV unit / stand / cabinet", "TV-Regal / -Möbel", "meuble TV", "mueble de la tele",
 * "тумба под телевизор", "طاولة التلفزيون") — cihaz değil yer tarifi. Ham metin, büyük-küçük harf duyarsız, sınırlı tekrar.
 */
const TV_FURNITURE = new RegExp(
  [
    "(?<![\\p{L}\\p{N}])(?:tv|televizyon)(?:['’]?n?[iıuü]n)?[ -]?(?:ünite|unite|sehpa|dolab|dolap|raf|alt|üst|ust|stand|unit|cabinet|shelf|console|regal|möbel|mobel|schrank|board)\\p{L}{0,8}",
    "(?<![\\p{L}\\p{N}])(?:meuble (?:de la |du )?(?:tv|télé|tele)|mueble (?:de la )?(?:tv|tele)\\p{L}{0,6}|тумб\\p{L}{0,4} под телевизор\\p{L}{0,3}|طاولة التلفزيون)",
  ].join("|"),
  "giu",
);

/** "mod / mode / Modus / режим" (katlanmış). */
const MODE_WORD = new RegExp(`${L}(?:mod\\p{L}{0,5}|режим\\p{L}{0,3})${R}`, "u");
/** Isıtma / soğutma adı (ham metin; Türkçe büyük-küçük harf iki biçimde). */
const CLIMATE_MODE_WORD =
  /(?<![\p{L}\p{N}])(?:[ıIiİ]s[ıi]tma\p{L}{0,4}|[sS][oö][gğ]utma\p{L}{0,4}|heating|cooling|heizen|heizung|kühlen|kühlung|chauffage|refroidissement|calefacción|refrigeración|обогрев\p{L}{0,2}|охлаждени\p{L}{0,2})(?![\p{L}\p{N}])/giu;

/** Klimanın adı (katlanmış; yedi dil + kar tanesi simgesi). Çıplak "ac" BİLEREK yok: Türkçe "aç" (açın / açıp) ile aynı. */
const AC_EVIDENCE = new RegExp(
  // Arapça belirli tanım ön eki ("المكيف") ve "air-conditioning" (Opus gece-2 M11).
  `${L}(?:klima\\p{L}{0,8}|kondisyoner\\p{L}{0,8}|air[- ]?con\\p{L}{0,10}|aircon|klimaanlage\\p{L}{0,2}|climatis\\p{L}{0,6}|aire acondicionado|кондиционер\\p{L}{0,3}|(?:ال)?مكيف\\p{L}{0,3}|kar tanes\\p{L}{0,6}|snowflake\\p{L}{0,2})${R}`,
  "u",
);

/** Adım fiillerinin konu sözlüğündeki yan okumaları (cümlenin kendi konusu sayılmaz — `unsupportedFixStep` arıza devralması). */
const STEP_VERB_SIDE_TOPICS: ReadonlySet<string> = new Set(["ac", "socket", "taxi", "smoking"]);

/**
 * Bilgi tabanı kaleminin KONU cihazları: başlık bir cihazı adlandırıyorsa yalnız başlığın ("Wi-Fi" kalemindeki "Modem TV ünitesinin
 * altında" TV'yi konu yapmaz — kurucunun TV vakası tam bu bilgi tabanındaydı); başlık cihazsızsa metnin cihazları.
 */
function kbSubjectTopicsOf(item: { title: string; content: string }): string[] {
  const title = deviceTopicsOf(topicsOf(item.title));
  if (title.length === 0) return deviceTopicsOf(topicsOf(item.content));
  // Başlık yalnız bir YER adlandırıyorsa ("Salon" → spor salonu, "Teras" → balkon) metnin cihazları da konudur (Opus gece-2 M8, ölçüldü:
  // "Salon: TV kumandası sehpadadır. Netflix için kumandadaki Netflix tuşuna basın" kalemi TV kullanım adımını tutuyordu).
  return title.every((t) => PLACE_TOPICS.has(t)) ? [...new Set([...title, ...deviceTopicsOf(topicsOf(item.content))])] : title;
}

/** Yer kavramları (oda / alan adı; cihaz değil). */
const PLACE_TOPICS: ReadonlySet<string> = new Set(["gym", "balcony", "pool"]);

/** Modele giden bilgi tabanının konu cihazları (kullanım adımının dayanağı). */
export function kbSubjectTopics(items: readonly { title: string; content: string }[]): Set<string> {
  const out = new Set<string>();
  for (const it of items) for (const t of kbSubjectTopicsOf(it)) out.add(t);
  return out;
}

/**
 * Cevabın bir cümlesi misafire yöneltilmiş bir ADIM (`isFixRecipeText` ya da denetim / deneme adımı) ve:
 *  · ARIZA GİDERME adımıysa (olumsuz koşul / yeniden başlatma / deneme — `TROUBLESHOOT_CONTEXT`) cihazlarının HER BİRİNİN modele giden
 *    bilgi tabanında TARİFİ (`kbRecipeTopics`) olmalı;
 *  · KULLANIM adımıysa ("MODE tuşuyla soğutmayı seçin") cihazlarından BİRİ bilgi tabanında KONU (`kbSubjectTopics`) olmalı —
 *    yoksa true. İstem bunu zaten yasaklar (KURAL-1 "kendi bilgini kullanma"; ARIZA ÇÖZÜMÜ bloğu yalnız tarifli istekte görünür); ölçülen
 * ihlal: 5.1 "Televizyonda görüntü gelmiyorsa kaynak girişinin (HDMI/AV/TV) doğru seçili olduğundan emin olur musunuz?" — bilgi tabanında
 * TV kalemi yokken (kör set 6). Kod kemeri, öğe kipinden bağımsız (anlama katmanının etiketi ne olursa olsun).
 * Cihaz adı geçmeyen arıza giderme adımı ("Fişini çekip bir dakika bekleyin") yalnız modele giden bilgi tabanında HİÇ tarif yokken tutulur —
 * tarifli bir kalemin adımı olabilir, konusu cümleden çıkarılamıyor (temkinli yön: geçer).
 * Bilinen sınır: aynı cihazın tarifi varken tarifte YAZMAYAN başka bir adım (cihaz düzeyinde okunur, adım düzeyinde değil — misafir başka
 * dilde yazınca sözcük örtüşmesi ölçülemez). Cümle bölme `sentencesOf`; doğrusal.
 */
export function unsupportedFixStep(
  reply: string,
  kb: { recipeTopics: ReadonlySet<string>; subjectTopics: ReadonlySet<string> },
  /** Misafirin mesajı (varsa): cihazı anılmayan adımın cihazı + deneme önerisinin arıza bağlamı ondan okunur. */
  guestText = "",
): boolean {
  if (!reply || !reply.trim()) return false;
  const guestDevices = guestText ? stepDevicesOf(guestText) : [];
  const guestReportsFault = guestText !== "" && FAULT_PHRASE.test(fold(guestText));
  // Misafirin ARIZA bildirdiği cihazlar (cümlecik düzeyinde — "TV çalışmıyor; Wi-Fi şifresi?" yalnız TV): o cihaza yöneltilen her adım arıza
  // giderme adımıdır, bilgi tabanında KONU olması yetmez, TARİF ister (Opus gece-2 M1, ölçüldü: TV / Wi-Fi bilgi tabanında yalnız konuyken
  // "Kumandadaki SOURCE tuşuna basıp HDMI 1'i seçin" / "Telefonunuzda ağı unutup yeniden bağlanın" kullanım adımı sayılıp GEÇİYORDU).
  const faultDevices = guestText ? faultDevicesOf(guestText) : new Set<string>();
  let carried: string[] = [];
  // Rakamla biten cümle de bölünür ("Wi-Fi şifresi Lale2025. Klimayı açmak için …" — Opus gece-2 M3: iki cümle tek okunuyordu, Wi-Fi konusu
  // klima adımını geçiriyordu). Ondalık ("2.5 bar") ve saat ("15.00") bölünmez. Tek geçiş, doğrusal.
  for (const sentence of sentencesOf(reply.replace(/(?<=\d)[.!?;](?=\s)/gu, "$&\n")).slice(0, MAX_STEP_SENTENCES)) {
    const f = fold(sentence);
    const own = stepDevicesOf(sentence);
    // Cihazı anılmayan cümle önceki cümlenin cihazını alır ("Bulaşık makinesi için: cihazı kapatıp 30 saniye bekleyin"); cevapta hiç yoksa
    // misafirin mesajındaki cihaz (Haiku 10-15 gece: başka cihazın tarifi her adsız adımı geçiriyordu).
    // Misafirin mesajında yalnız kumanda geçiyorsa ("Kumanda çalışmıyor" — kumanda nötr) arızalı cihaz kümesi devralınır (kurucu k6-24:
    // "ADAMA PİLLERİ DEĞİŞTİRİN Mİ YAZICAK").
    const devices = own.length > 0 ? own : carried.length > 0 ? carried : guestDevices.length > 0 ? guestDevices : [...faultDevices];
    const carriedBefore = carried;
    if (own.length > 0) carried = own;
    // Arızalı cihaz bu cümlenin cihazı mı. Cihazı anılmayan cümle kendi KONUSUNU taşıyorsa ("Çöpleri konteynere atabilirsiniz", "Ağı seçip
    // şifreyi girin") başka işten söz ediyordur, arızalı cihazı devralmaz (kurucunun TV + çöp vakasında çöp cevabı gider). Adım fiillerinin
    // konu sözlüğündeki YAN okumaları konu sayılmaz (ölçüldü: "takın" → taksi, "tutun" → sigara, "açın" → klima, "fişini çekin" → priz).
    const inheritsFault = own.length > 0 || topicsOf(sentence.replace(REMOTE_WORD, " ")).every((t) => STEP_VERB_SIDE_TOPICS.has(t));
    const faulty = inheritsFault ? devices.filter((t) => faultDevices.has(t)) : [];
    const restart = RESTART_STEP.test(f);
    // Deneme önerisi yalnız arıza bağlamında ya da bir ayar / tuş / programla anıldığında adımdır (Opus gece-2 M11: "Sahildeki kafede Türk
    // kahvesini mutlaka deneyin" yerel öneriydi, kahve makinesi kullanım adımı sayılıp tutuluyordu).
    const tries = TRY_STEP.test(f) && (guestReportsFault || TRY_ACTION_CONTEXT.test(f));
    const faultStep = faulty.length > 0 && FAULT_DEVICE_STEP.test(f);
    if (!restart && !tries && !faultStep && !isFixRecipeText(sentence) && !GUEST_CHECK_STEP.test(f)) continue;
    const troubleshooting =
      restart ||
      TROUBLESHOOT_CONTEXT.test(f) ||
      RECIPE_CONDITIONAL.test(f) ||
      RECIPE_FAULT_PHRASES.some((p) => f.includes(p)) ||
      (tries && guestReportsFault) ||
      faulty.length > 0;
    if (devices.length === 0) {
      if (troubleshooting && kb.recipeTopics.size === 0) return true;
      continue;
    }
    if (troubleshooting) {
      // Cihazı misafirden devralan adımda yalnız ARIZALI cihazlar tarif ister ("TV çalışmıyor; Wi-Fi şifresi?" + adsız adım).
      const need = own.length === 0 && carriedBefore.length === 0 && faulty.length > 0 ? faulty : devices;
      if (need.some((t) => !kb.recipeTopics.has(t))) return true;
      continue;
    }
    // Kullanım adımı: cümlenin KENDİ cihazı varsa yalnız ona bakılır (Opus gece-2 M3, ölçüldü: Wi-Fi şifresi hemen her bilgi tabanında konu —
    // önceki cümlede ya da misafirin mesajında Wi-Fi geçince KB'de olmayan klima kullanım adımı geçiyordu). Cihazı yoksa önceki cümlenin ya da
    // misafirin cihazından BİRİ konu olsun ("Klima kumandası çekmecede. MODE tuşuyla soğutma ya da ısıtma modunu seçin").
    const context = own.length > 0 ? own : [...carriedBefore, ...guestDevices];
    if (!context.some((t) => kb.subjectTopics.has(t) || kb.recipeTopics.has(t))) return true;
  }
  return false;
}

/** Kapı bağlamının kanıtsız adım bölümü: modele giden bilgi tabanının tarif ve konu cihazları (sıralı kimlikler; metin TAŞIMAZ). */
export interface KbFixSupport {
  recipeTopics: readonly string[];
  subjectTopics: readonly string[];
}

/**
 * Kanal / QR / Ayarlar testi / karşılaştırma kapı bağlamına eklenen alan. Anahtar KAPALIYKEN `{}` — bağlam bayt bayt bugünkü (hesap da
 * yapılmaz). Girdi: MODELE GİDEN kalemler (`kbSel.items`), kiracının bütün bilgi tabanı değil.
 */
export function fixSupportContextOf(items: readonly { title: string; content: string }[]): { kbFixSupport?: KbFixSupport } {
  if (!fixSupportGateEnabled()) return {};
  return { kbFixSupport: { recipeTopics: [...kbRecipeTopics(items)].sort(), subjectTopics: [...kbSubjectTopics(items)].sort() } };
}

/** Kapının tek çağrısı (kanal + QR AYNI yüklem): anahtar açık + bağlam verilmiş + cevapta kanıtsız adım. */
export function fixSupportHolds(
  reply: string | null | undefined,
  support: KbFixSupport | null | undefined,
  guestText = "",
): boolean {
  if (!fixSupportGateEnabled() || !support) return false;
  return unsupportedFixStep(reply ?? "", { recipeTopics: new Set(support.recipeTopics), subjectTopics: new Set(support.subjectTopics) }, guestText);
}

/** Yalnız cihaz / tesis kavramları (`DEVICE_TOPICS`). */
export function deviceTopicsOf(topics: readonly string[]): string[] {
  return topics.filter((t) => DEVICE_TOPICS.has(t));
}

/**
 * Cevap, ev sahibine BIRAKILAN bir arızanın cihazına değiniyor mu (kör set 5, 10-01 öğlen): tarifsiz arıza + başka soru içeren mesajda
 * modeller bırakılan cihaz için ya bilgi tabanında olmayan adım uydurdu ("Bulaşık makinesini kapatıp fişini 1 dakika çekin" — 5.1, GİTTİ)
 * ya da "talimatım yok" yazdı ("Je n'ai pas de consigne… micro-ondes" — Luna, GİTTİ). Bırakılan istek için istem zaten "değinme" der; bu,
 * kodun ikinci kemeri. `heldDeviceTopics` cevaplanan isteklerin konularını İÇERMEZ (plan çıkarır) — arıza tarifi kendi cihazına değinir.
 */
export function touchesHeldDevice(
  heldDeviceTopics: readonly string[],
  reply: string,
  opts: { genericRef?: boolean } = {},
): boolean {
  // Boş liste kısa yolu yalnız gereksiz `topicsOf` çağrısını önler (sonuç aynı — mutasyon turunda eşdeğer mutant, bilerek).
  if (heldDeviceTopics.length === 0 || !reply.trim()) return false;
  const held = new Set(heldDeviceTopics);
  if (topicsWithSymptomsOf(reply).some((t) => held.has(t))) return true;
  // Adı ANILMAYAN bırakılan cihaz (15 ajan A06, 10-01): "Makineyi kapatıp fişini 1 dakika çekin, sonra tekrar başlatın" — cevaplanan
  // isteklerin hiçbiri cihaz değilse (`genericRef`, plan verir) "makine / cihaz / the device / l'appareil …" yalnız bırakılan cihaz
  // olabilir; aynı cümle bir adım (tarif işareti) taşıyorsa cevap ona değinmiştir.
  if (!opts.genericRef) return false;
  return sentencesOf(reply).some((sentence) => GENERIC_DEVICE_REF.test(fold(sentence)) && isFixRecipeText(sentence));
}

/**
 * Adı verilmeyen cihaz anışı (katlanmış metin): niteleyicisiz "makine / cihaz" ("bulaşık makinesi" adlandırır, konu oradan gelir),
 * "the machine / device / appliance", "das Gerät", "l'appareil", "el aparato", "прибор / устройство", "الجهاز". Sınırlı tekrar.
 */
const GENERIC_DEVICE_REF = new RegExp(
  [
    `(?<!(?:bulasik|camasir|kahve|kurutma|dikis|tiras|espresso|filtre|cay|buz|ekmek|sac|tost) )${L}makin[ae](?:yi|nin|ye|de|da|den|dan|niz|nizi|nizin|miz|mizi)?${R}`,
    `${L}cihaz(?:i|in|a|da|dan|iniz|inizi|imiz|imizi)?${R}`,
    `${L}(?:the|this|that|your) (?:machine|device|appliance)${R}`,
    `${L}(?:das|dem|des) gerat(?:s|es)?${R}`,
    `${L}(?:die|der) maschine${R}`,
    `${L}(?:l'appareil|cet appareil|la machine)${R}`,
    `${L}(?:el aparato|la maquina|el equipo|el electrodomestico)${R}`,
    `${L}(?:прибор\\p{L}{0,3}|устройств\\p{L}{0,3})${R}`,
    `${L}(?:الجهاز|الالة)${R}`,
  ].join("|"),
  "u",
);

/**
 * Tarifle giderilebilecek CİHAZ / TESİS kavramları (getirme sözlüğü kimlikleri). Ulaşım, yer, kural, hizmet kavramı tarif konusu değildir:
 * "Kapı kilidi ve tuş takımı" başlığı sözlükte yalnız "taksi"ye iniyordu (yazım toleransı — ölçüldü) ve kilidin kendi kavramı metinden
 * gelmiyordu. Başlıkta cihaz kavramı yoksa metnin cihaz kavramları alınır.
 */
const DEVICE_TOPICS: ReadonlySet<string> = new Set([
  "wifi",
  "keys",
  "parking",
  "elevator",
  "balcony",
  "baby",
  "iron",
  "hairdryer",
  "laundry",
  "dishwasher",
  "stove",
  "fridge",
  "microwave",
  "coffee",
  "tv",
  "ac",
  "heating",
  "hot_water",
  "power",
  "socket",
  "pool",
  "gym",
]);

/**
 * Kendi konusu olmayan genel takip sorusu ("tekrar olursa ne yapmalı", "what should we do", "что делать"): anlama katmanının Türkçe ve
 * özgün dildeki sorgusunda aranır. Konu kavramı taşıyan sorgu bu yüzden bağlı SAYILMAZ (kavram önce bakılır, `ownTopic`).
 */
const GENERIC_FOLLOWUP = new RegExp(
  [
    // tr
    "ne yap",
    "ne olacak",
    "ne olur",
    "olursa",
    "kimi ara",
    "kim gel",
    "biri gel",
    "normal mi",
    // en
    "what (?:should|do|can|will) we",
    "what now",
    "what happens",
    "what will happen",
    "happens again",
    "who (?:do|should) we call",
    "is (?:this|that|it) normal",
    "can someone come",
    // de
    "was (?:sollen|machen|konnen) wir",
    "was jetzt",
    "wieder passiert",
    "ist das normal",
    // fr
    "que faire",
    "qu'est-ce qu'on fait",
    "que (?:devons|pouvons)-nous",
    "si (?:ca|cela) recommence",
    "est-ce normal",
    // es
    "que hacemos",
    "que (?:debemos|podemos) hacer",
    "que pasa",
    "si vuelve a pasar",
    "es normal",
    // ru
    "что (?:нам )?делать",
    "если повтор",
    "это нормально",
    // ar
    "ماذا نفعل",
    "ما العمل",
    "هل هذا طبيعي",
  ].join("|"),
  "u",
);

export function isGenericFollowup(...queries: readonly string[]): boolean {
  return queries.some((q) => !!q && GENERIC_FOLLOWUP.test(fold(q)));
}

/**
 * Öğenin ilişki olguları (`extract.ts` kurar; yalnız ilişki kipinde — anlama katmanı işaret verdiyse). Metin TAŞIMAZ: işaret + konu
 * kavramları + genel takip sorusu + tehlike sınıfı (isteğin sorguları ya da mesajı).
 */
/**
 * ARIZA HER YOLDA ARIZA (kurucu 10-15 inceleme notu: "Televizyon arızası — KB'de ve kullanılabilir geçmişte doğrulanmış çözüm bulunamadı —
 * Arıza açık kalsın; çözüm uydurulmasın, hosta devir / bildirim politikası uygulansın"; Sabah Kararları 27 b + 30; Opus 10-15 P1). Anahtar
 * `AI_FAULT_GUARD_ENABLED` VARSAYILAN KAPALI — kapalıyken olgular ve plan bayt bayt bugünkü.
 * Ölçülen boşluk: anlama katmanı arıza bildirimini "şikâyet" diye işaretlemezse (bağlayıcı yok) `requestDependency` isteği bağımsız sayıyor,
 * tarif / `kb:` / tehlike kuralları hiç koşmuyordu → 5.1 bilgi tabanında olmayan bir adım uydurdu ve GİTTİ; ev sahibine bildirim de yoktu.
 */
export function faultGuardEnabled(): boolean {
  return process.env.AI_FAULT_GUARD_ENABLED === "1";
}

/**
 * Arıza / belirti ifadesi (katlanmış metin; yedi dil). Koşul eki almış biçim ("çalışmazsa", "bozulursa") TAM sözcük sınırı yüzünden eşleşmez
 * (varsayım arıza bildirimi değildir — kurucu D4 ayrımı). Sabit alternatifler + sınırlı ek (doğrusal).
 */
const FAULT_PHRASE_SOURCE = [
    // tr
    `${L}(?:calismiyor(?:du)?|calismadi|calismiyo|calismaz|acilmiyor(?:du)?|acilmadi|acilmaz|bozuk|bozuldu|bozulmus|arizali|arizalandi|ariza(?:si|lari)?|isinmiyor(?:du)?|isitmiyor|sogutmuyor(?:du)?|akmiyor(?:du)?|gelmiyor(?:du)?|yanmiyor(?:du)?|kapanmiyor|baglanmiyor(?:du)?|cekmiyor|tikali|tikandi|sizdiriyor|damlatiyor|kirik|kirildi)${R}`,
    `${L}(?:goruntu|ses|sinyal)\\p{L}{0,3} (?:yok|gelmiyor|vermiyor|gitti)${R}`,
    `${L}siyah ekran${R}`,
    // Kayıtlı misafir mesajlarında kaçan biçimler (10-15 gece ölçümü): takılma / dönmeme / tepkisizlik / ses çıkmaması / hata kodu /
    // "<hizmet> yok" (internet, sıcak su, elektrik, ısıtma — cihaz kavramı yine şart).
    `${L}(?:takiliyor|takildi|takili kaldi|donmuyor|tepki vermiyor|cevap vermiyor|ses cikmiyor|calismayi durdurdu|durmadan kapaniyor|kendi kendine kapaniyor|hata veriyor|hata kodu|e ?\\d{1,3} (?:hatasi|yaziyor|veriyor))${R}`,
    // Opus gece-2 M4 yan notu: sözlük dışı arıza fiilleri (su boşaltmıyor, sürekli kopuyor)
    `${L}(?:bosaltmiyor(?:du)?|tahliye etmiyor|kopuyor|surekli kesiliyor|(?:cok |asiri )?az akiyor|cok yavas|asiri yavas)${R}`,
    `${L}(?:internet|wifi|wi-fi|sicak su|elektrik|isitma|isik)\\p{L}{0,4} (?:yok|gitti|kesildi|gelmiyor)${R}`,
    // en
    `${L}(?:not working|very slow|too slow|extremely slow|won't drain|not draining|doesn't drain|keeps dropping|keeps disconnecting|doesn't work|does not work|won't turn on|will not turn on|won't start|stopped working|broken|no picture|black screen|no sound|no signal|not heating|not cooling|leaking|clogged|won't respond|doesn't respond|does not respond|not responding|no hot water|no internet|no wifi|no power|got stuck|is stuck|only blows (?:cold|warm|hot) air|won't open|won't connect|keeps (?:beeping|turning off|shutting off))${R}`,
    // de / fr / es
    `${L}(?:funktioniert nicht|geht nicht|kaputt|kein bild|kein ton|kein signal|reagiert nicht|geht nicht an|kein warmes wasser|kein internet|ne marche pas|ne fonctionne pas|en panne|pas d'image|pas de son|ne s'allume plus|ne chauffe plus|ne repond pas|pas d'eau chaude|plus d'internet|no funciona|averiad[oa]|sin imagen|sin sonido|no arranca|no responde|no enciende|no calienta|no enfria|no hay agua caliente|no hay internet)${R}`,
    // ru / ar (katlama Latin dışını değiştirmez)
    `(?:не работает|сломал\\p{L}{0,2}|не включается|нет изображения|нет звука|не реагирует|не греет|не охлаждает|нет горячеи воды|нет интернета|لا يعمل|لا تعمل|لا يبرد|لا تبرد|معطل)`,
].join("|");
const FAULT_PHRASE = new RegExp(FAULT_PHRASE_SOURCE, "u");
/** Aynı kalıbın küresel biçimi — bir cümlecikteki BÜTÜN arıza geçişleri (ilki koşullu olsa da ikincisi okunur — Haiku 10-15 gece). */
const FAULT_PHRASE_ALL = new RegExp(FAULT_PHRASE_SOURCE, "gu");

/**
 * Arıza düzelmiş / geçmiş ("çalışmadı ama sonra düzeldi", "it works now", "arızası giderildi") — bildirim değil. Katlanmış metin, sabit
 * alternatifler. Soru ("düzeldi mi?") ve sanı ("hallettik sandık") düzelme DEĞİLDİR (`FAULT_RESOLVED_DOUBT` — Opus gece-2 M4).
 */
const FAULT_RESOLVED = new RegExp(
  `${L}(?:duzeldi|duzelmis|hallettik|hallettim|halloldu|cozuldu|cozduk|artik calisiyor|calisiyor artik|giderildi|tamir edildi|onarildi|fixed|repaired|works now|working now|it'?s working|resolved|sorted it|funktioniert (?:jetzt|wieder)|fonctionne maintenant|ca marche maintenant|ya funciona|funciona ahora|заработал\\p{L}{0,2}|تم الحل)${R}`,
  "gu",
);
/** Düzelme ifadesinin hemen ardındaki soru eki / sanı fiili ("düzeldi mi", "hallettik sandık", "fixed?" cümlecik ayracında okunur). */
const FAULT_RESOLVED_DOUBT = /^\s{0,3}(?:mi|mu|sand\p{L}{0,6}|sanm\p{L}{0,8}|zannet\p{L}{0,8})(?![\p{L}\p{N}])/u;

/**
 * Misafirin KENDİ eşyası (D4 dersi — "misafir eşyası bakım değildir"): araba / araç, bavul / valiz, "benimki / bizimki", "kendi X'imiz",
 * "our own / my car", bozuk para (bozukluk). Yalnız arızanın cümleciğinde okunur. "kendi kendine / kendi başımıza" sahiplik değildir.
 */
const FAULT_GUEST_OWNED = new RegExp(
  // "Bavul dolabı" mülkün olanağıdır (Opus gece-2 M4 yan notu); "at home" misafirin kendi evi.
  `${L}(?:araba\\p{L}{0,8}|arac(?:i|imiz|imizin|imizi|in)?|bavul(?!\\p{L}{0,8} dolab)\\p{L}{0,8}|valiz\\p{L}{0,8}|benimki|bizimki|kendi (?!kendi|basim|basimiza|basina|basiniza|basimizi)\\p{L}{2,16}|bozuk para\\p{L}{0,4}|(?:my|our) (?:own|car|luggage|suitcase)|our rental car|at home|back home)${R}`,
  "u",
);

/**
 * Arıza ifadesinin hemen ardındaki koşul yüklemi ("arıza yaparsa", "bozuk olursa", "arıza durumunda / halinde") — varsayım bildirim değildir
 * (kurucu D4 ayrımı; "durumunda / halinde" Opus gece-2 M7).
 */
const FAULT_CONDITION_TAIL =
  /^\s{1,3}(?:olursa|yaparsa|verirse|ederse|cikarsa|kalirsa|olunca|oldugunda|yapinca|giderse|olmasi halinde|durumunda|halinde)(?![\p{L}\p{N}])/u;

/** Arızanın önünde koşul bağlacı ("if the TV breaks", "wenn", "falls", "en caso de", "если"). İspanyolca / Fransızca "si" YOK: katlamada "sí" (evet) ile aynı (Haiku 10-15 gece). */
const FAULT_CONDITION_LEAD = new RegExp(`${L}(?:if|in case|wenn|falls|en caso de|если)${R}`, "u");

/**
 * Cümlecik sınırı: noktalama + karşıtlık bağlaçları (ama / fakat / ancak / but / however / aber / mais / pero / но). Büyük / küçük harf
 * duyarsız ("KLİMA ÇALIŞMIYOR AMA WİFİ DÜZELDİ" — Opus gece-2 M4). Ayraç YAKALANIR: soru işaretiyle biten düzelme ("Fixed?") düzelme değildir.
 */
const FAULT_CLAUSE_SPLIT = /([,.;!?\n]+|\s(?:ama|fakat|ancak|lak[iİı]n|but|however|aber|mais|pero|но)\s)/iu;

/**
 * İstek bir CİHAZ ARIZASI mı: isteğin KENDİ sorgusu (anlama katmanının Türkçe + özgün dil sorgusu) — mesajın bütün gövdesine BAKILMAZ ("Wi-Fi
 * şifresi?" isteği, aynı mesajdaki TV arızası yüzünden arıza sayılmasın). Opus N3 (10-15 gece, ölçüldü) yanlış alarmları üzerine cihaz ve arıza
 * ifadesi AYNI CÜMLECİKTE aranır ("Bavulumuzun tekerleği kırık, asansör var mı?" · "Telefon çekmiyor, wifi şifresi ne?"); cümleciğinde misafir
 * eşyası ("Arabamız bozuldu"), arıza ifadesinin ardında koşul yüklemi ("Klima arıza yaparsa…") ya da önünde koşul bağlacı varsa, sorgu
 * arızanın düzeldiğini söylüyorsa ("çalışmadı ama sonra düzeldi") arıza DEĞİLDİR. Kapalı küme, doğrusal (cümlecik başına tek tarama).
 */
export function faultSignal(queryTr: string, queryOriginal: string): boolean {
  return [queryTr, queryOriginal].some((t) => !!t && t.trim() !== "" && faultDevicesOf(t).size > 0);
}

/** Soru / varlık yüklemi taşıyan öbek ("Asansör var mı", "Otopark nerede") arızanın öznesi değildir. */
const NOT_A_SUBJECT = /[?]|(?:^|\s)(?:mi|mu|var|yok|nerede|nasil|hangi|kac|ne zaman|where|how|what|when|which|wo|ou|donde)(?=\s|$)/u;

/** Arıza ifadesinin hemen ardındaki soru eki ("Klima çalışmıyor mu? Nasıl açılıyor?") — soru bildirim değildir (kurucu D4; Opus gece-2 M4). */
const FAULT_QUESTION_TAIL = /^\s{1,3}(?:mi|mu)(?![\p{L}\p{N}])/u;

/** Arıza ifadesinin hemen ardındaki olumsuzlama ("bozuk değil", "not broken" ayrı okunur) — bildirim değildir (Opus gece-2 M4 yan notu). */
const FAULT_NEGATION_TAIL = /^\s{1,3}(?:degil|degildi|degilmis)(?![\p{L}\p{N}])/u;

/**
 * Arızanın öznesi olabilecek CİHAZ DIŞI eşya (misafirin telefonu / bilgisayarı): cümlecikte anılıyorsa cihazsız arıza önceki cümleciğin
 * cihazını devralmaz ("Wifi'ye bağlandık, telefon çekmiyor" — telefon Wi-Fi değildir; Opus gece-2 M4 yan notu). Zarf / parça listesiyle
 * "çıplak cümlecik" kuralı DENENDİ, kayıtlı 1.115 mesajda 10 gerçek arızayı düşürdü ("ama motor hiç çalışmıyor", "ekranda 'Sinyal yok'
 * yazıyor") — bu yüzden kara liste. Katlanmış biçim.
 */
const NON_DEVICE_SUBJECT = new RegExp(
  `${L}(?:telefon\\p{L}{0,8}|phone\\p{L}{0,2}|cep\\p{L}{0,4}|handy\\p{L}{0,2}|portable\\p{L}{0,2}|movil\\p{L}{0,2}|телефон\\p{L}{0,3}|laptop\\p{L}{0,6}|bilgisayar\\p{L}{0,8}|computer\\p{L}{0,2}|tablet\\p{L}{0,6})${R}`,
  "u",
);

/** Taranan en çok cümlecik (doğrusal tavan). */
const MAX_FAULT_CLAUSES = 64;

/**
 * Metnin bildirdiği AÇIK cihaz arızaları (cihaz kavramları). Sıra önemlidir: arızadan SONRA gelen düzelme ("çalışmadı ama sonra düzeldi")
 * yalnız KENDİ cümleciğinin cihazını ya da (cihazsızsa) son arızalı cihazı kapatır — başka cihazın düzelmesi arızayı silmez ("Klima hâlâ
 * çalışmıyor, internet ise düzeldi" — Opus gece-2 M4, ölçüldü); düzelmeden SONRA gelen arıza ("düzeldi ama şimdi yine çalışmıyor") açar.
 * "Düzeldi mi?" / "hallettik sandık" düzelme değildir. Cümleciğin BÜTÜN arıza geçişleri okunur. Doğrusal (cümlecik başına sınırlı tarama).
 */
export function faultDevicesOf(text: string): Set<string> {
  const open = new Set<string>();
  let lastFault: readonly string[] = [];
  let subject: readonly string[] = [];
  const parts = text.split(FAULT_CLAUSE_SPLIT);
  for (let i = 0; i < Math.min(parts.length, MAX_FAULT_CLAUSES * 2); i += 2) {
    const clause = parts[i];
    if (!clause || clause.trim() === "") continue;
    const delimiter = parts[i + 1] ?? "";
    const inherited = subject;
    const own = faultClauseDevices(clause);
    const f = fold(clause);
    // Cihaz taşıyan ama arıza ifadesi / soru taşımayan öbek bir sonraki cümleciğin öznesi olabilir ("Klima, çalışmıyor", "Televizyon kendi
    // kendine kapanıyor, bozuk", "Klima düzeldi ama şimdi yine çalışmıyor").
    subject = own.length > 0 && !FAULT_PHRASE.test(f) && !NOT_A_SUBJECT.test(f) ? own : [];
    if (resolvesFault(f, delimiter)) {
      for (const t of own.length > 0 ? own : lastFault) open.delete(t);
      continue;
    }
    const devices = own.length > 0 ? own : NON_DEVICE_SUBJECT.test(f) ? [] : inherited;
    if (devices.length === 0) continue;
    if (FAULT_GUEST_OWNED.test(f)) continue;
    let questioned = false;
    for (const m of f.matchAll(FAULT_PHRASE_ALL)) {
      const at = m.index ?? 0;
      const tail = f.slice(at + m[0].length, at + m[0].length + 24);
      if (FAULT_QUESTION_TAIL.test(tail)) {
        questioned = true;
        continue;
      }
      if (FAULT_CONDITION_TAIL.test(tail) || FAULT_NEGATION_TAIL.test(tail)) continue;
      if (FAULT_CONDITION_LEAD.test(f.slice(Math.max(0, at - 160), at))) continue;
      for (const t of devices) open.add(t);
      lastFault = devices;
      questioned = false;
      break;
    }
    // Soru biçimli arızanın cihazı ardındaki çıplak arıza cümleciğinin öznesidir ("Klima çalışmıyor mu yoksa kapalı mı bilmiyoruz, soğutmuyor").
    if (questioned && own.length > 0) subject = own;
  }
  return open;
}

/**
 * Arıza cümleciğinin cihazları: kumanda ve TV mobilyası başka bir cihazla birlikte anıldığında nötr ("Klima kumandası çalışmıyor" yalnız
 * klima — Opus gece-3 P2-a, ölçüldü: getirme sözlüğü kumandayı TV'ye bağlıyor, TV de arızalı sayılıyordu). Yalnız kumanda anılmışsa
 * ("Kumanda çalışmıyor") sözlüğün okuması kalır.
 */
function faultClauseDevices(clause: string): string[] {
  const neutral = withoutPlaces(deviceTopicsOf(topicsWithSymptomsOf(clause.replace(REMOTE_WORD, " ").replace(TV_FURNITURE, " "))));
  return neutral.length > 0 ? neutral : deviceTopicsOf(topicsWithSymptomsOf(clause));
}

/** Cümlecik bir düzelme söylüyor mu: soru ("düzeldi mi", "fixed?") ve sanı ("hallettik sandık") değil. */
function resolvesFault(f: string, delimiter: string): boolean {
  if (delimiter.includes("?")) return false;
  for (const m of f.matchAll(FAULT_RESOLVED)) {
    const at = (m.index ?? 0) + m[0].length;
    if (!FAULT_RESOLVED_DOUBT.test(f.slice(at, at + 24))) return true;
  }
  return false;
}

export interface ItemRelationFacts {
  relation: ItemRelation;
  topics: string[];
  generic: boolean;
  hazard: boolean;
  /** İsteğin sorgusu ücret / fiyat / ödeme soruyor (`moneyRequest`); yoksa (eski olgu) para isteği sayılmaz — cevap kemeri yine koşar. */
  money?: boolean;
}

/**
 * PARA SORUSU (kör set 7 k7-22, 10-02 gece): anlama katmanının TÜRKÇE sorgusunda ücret / fiyat / ödeme / fatura / depozito / indirim /
 * tazminat sözcüğü ya da özgün dildeki sorguda tutar / muafiyet (`hasMoneyStatement`: "200 TL", "free of charge"). Katlanmış biçim, tam
 * sözcük + sınırlı ek; "para" yalnız çekimleriyle ("parazit / paravan / paragraf" değil), "öde-" yalnız ödeme biçimleriyle ("ödev / ödünç"
 * değil). İade (`iade`) BİLEREK yok: "anahtarı iade" para değildir (iade talebi zaten kendi türü — `cancellation_refund`).
 */
const MONEY_REQUEST_TR = new RegExp(
  `${L}(?:ucret\\p{L}{0,12}|fiyat\\p{L}{0,12}|odeme\\p{L}{0,8}|oden(?:ir|di|mis|ecek|meli|medi|me)\\p{L}{0,6}|` +
    `odey\\p{L}{0,8}|oded\\p{L}{0,6}|fatura\\p{L}{0,8}|maliyet\\p{L}{0,8}|bedel\\p{L}{0,8}|depozito\\p{L}{0,8}|kap[ao]r[ao]\\p{L}{0,6}|` +
    `indirim\\p{L}{0,8}|tazminat\\p{L}{0,8}|para(?:si|yi|ya|nin|da|dan|mi|miz\\p{L}{0,4}|niz\\p{L}{0,4}|li|siz|lar\\p{L}{0,4}|yla)?)${R}`,
  "u",
);

/** İstek ücret / fiyat / ödeme soruyor mu (Türkçe anlama sorgusu + özgün dildeki tutar / muafiyet). Saf. */
export function moneyRequest(queryTr: string, queryOriginal: string): boolean {
  return MONEY_REQUEST_TR.test(fold(queryTr ?? "")) || MONEY_REQUEST_TR.test(fold(queryOriginal ?? "")) || hasMoneyStatement(queryOriginal ?? "");
}

/** Cevaplanabilir aday isteğin ilişki olguları (kod kurar; metin TAŞIMAZ — yalnız kapalı küme kodlar). */
export interface RequestFacts {
  kind: ItemKind;
  /** Anlama katmanının işareti; yoksa (anahtar kapalı) eski liste kuralı koşar — çağıran `relationMode`a bakar. */
  relation?: ItemRelation;
  /** Konu kavramları (`requestTopics`). */
  topics: readonly string[];
  /** Sorgusu kendi konusu olmayan genel takip sorusu (`isGenericFollowup`). */
  generic: boolean;
  /** Sorgusu tehlike sınıfına değiyor (`fixHazard`). */
  hazard: boolean;
  /** Sorgusu ücret / fiyat / ödeme soruyor (`moneyRequest`) — para sorusu arıza çözümü olarak sunulmaz. */
  money?: boolean;
  /**
   * İsteme giren bilgi tabanında bu isteğin konusunda bir TARİF kalemi var mı (`kbRecipeTopics`). Arıza çözümü yalnız `true` iken
   * cevaplanabilir; eksik = bilinmiyor = tarif yok (TUT). Plan her istek için yazar; kapı aynı olguyla aynı kararı verir.
   */
  recipe?: boolean;
}

/** Bu turun tutulan bağlayıcı talebi (şikâyet / iade / ev sahibi talebi). */
export interface AnchorFacts {
  kind: ItemKind;
  topics: readonly string[];
  /** Talebin mesajı tehlike sınıfına değiyor ("Sıcak su yok", "Sigorta attı"). */
  hazard: boolean;
}

export type RequestDependency = "independent" | "fix" | "dependent";

/** İstek kendine ait bir konuya sahip mi: konu kavramı ya da (genel takip sorusu değilse) "diğer" dışı tür. */
function ownTopic(req: RequestFacts): boolean {
  return req.topics.length > 0 || (req.kind !== "other" && !req.generic);
}

/**
 * KARAR (saf; plan ve kapı AYNI fonksiyonu çağırır): bağlayıcı talep yoksa bağımsız (bugünkü davranış). Varsa önce modelin işareti,
 * sonra kod koruması — yalnız sıkılaştırır.
 */
export function requestDependency(req: RequestFacts, anchors: readonly AnchorFacts[]): RequestDependency {
  if (anchors.length === 0) return "independent";
  const complaint = anchors.some((a) => a.kind === "complaint_issue");
  const anchorTopics = new Set(anchors.flatMap((a) => a.topics));
  const overlap = req.topics.some((t) => anchorTopics.has(t));
  if (req.relation === "own_topic") {
    if (!ownTopic(req) || overlap) return "dependent";
    if (complaint && req.kind === "house_rules") return "dependent";
    return "independent";
  }
  if (req.relation === "fix_request") {
    if (!complaint || !FIX_KINDS.has(req.kind) || req.hazard || anchors.some((a) => a.hazard)) return "dependent";
    // Ücret / fiyat / ödeme sorusu arıza çözümü DEĞİLDİR (kurucu 18 "a": çözüm = arızanın onaylı tarifi). Kör set 7 k7-22: "otopark ücrete
    // dahil mi" isteği çözüm sayıldı, iade talebinin yanında misafire "otopark ayrıca günlük 200 TL" gitti.
    if (req.money === true) return "dependent";
    // Kurucunun 18. maddesi ("bilgi tabanında O ARIZANIN tarifi varsa"): tarif yoksa istek şikâyetle birlikte ev sahibinde kalır
    // (karar 23 kör doğrulaması — tarifsiz arızada boş cevap / "bilgide yok" / uydurma adım).
    if (req.recipe !== true) return "dependent";
    return "fix";
  }
  return "dependent";
}

/** Aynı türden iki istek bir öğede birleşir (`core.buildItemsForMessage`): en kısıtlayıcı işaret kalır. */
const RELATION_RANK: Readonly<Record<ItemRelation, number>> = { own_topic: 0, fix_request: 1, follow_up: 2, unclear: 3 };
export function stricterRelation(a: ItemRelation | undefined, b: ItemRelation | undefined): ItemRelation | undefined {
  if (a === undefined || b === undefined) return a === undefined && b === undefined ? undefined : "unclear";
  return RELATION_RANK[a] >= RELATION_RANK[b] ? a : b;
}

/** Kapı girdisinin ilişki bölümü (öğe kipi + işaret varken; yoksa kapı eski liste kuralını koşar). */
export interface ItemsRelationGate {
  /** Cevaplanabilir isteklerin olguları, kimlikleriyle (R1…). */
  requests: readonly (RequestFacts & { ref: string })[];
  /** Bu turun tutulan bağlayıcı talepleri. */
  anchors: readonly AnchorFacts[];
}

export type RelationHoldDetail = "items_complaint_dependent" | "items_fix_unverified" | "items_fix_hazard" | "items_fix_money";
export type HeldTouchDetail = "items_held_touched";

/**
 * Kapının ikinci kemeri: plan bağlı isteği cevaplanabilir saymışsa (yanlış "bağımsız" işareti, plan dışı yol, gelecekteki değişiklik)
 * cevap GİTMEZ. Cevaplanan arıza çözümü bilgi tabanına dayanmıyorsa (`kb:` kaynağı yok) ya da cevap tehlike sınıfına değiyorsa GİTMEZ.
 */
export function relationGateHold(
  gate: ItemsRelationGate,
  reply: { text: string; answeredRefs: readonly string[]; usedSources: readonly string[] | undefined },
): RelationHoldDetail | null {
  let fixAnswered = false;
  let otherAnswered = false;
  const fixTopics = new Set<string>();
  for (const r of gate.requests) {
    const d = requestDependency(r, gate.anchors);
    if (d === "dependent") return "items_complaint_dependent";
    if (!reply.answeredRefs.includes(r.ref)) continue;
    if (d === "fix") {
      fixAnswered = true;
      for (const t of r.topics) fixTopics.add(t);
    } else otherAnswered = true;
  }
  if (!fixAnswered) return null;
  if (!(reply.usedSources ?? []).some((s) => s.startsWith("kb:"))) return "items_fix_unverified";
  if (fixHazard(reply.text)) return "items_fix_hazard";
  // Çözüm diye cevaplanan istekte tutar / muafiyet → GİTMEZ: tarif para söylemez (geçmiş koşuların 132 gerçek tarif cevabında 0). İstek
  // kemerinin (`money`) yedeği — anlama katmanı para sorusunu para sözcüğü olmadan yazsa da (kör set 7 k7-22).
  if (fixAnswerCarriesMoney(reply.text, fixTopics, otherAnswered)) return "items_fix_money";
  return null;
}

/**
 * Çözüm cevabında para var mı. Cevap YALNIZ çözüm(ler)i kapsıyorsa bütün metin; yanında bağımsız bir istek de cevaplandıysa yalnız çözümün
 * KONUSUNU anan cümleler — bağımsız sorunun ücret bilgisi ("otopark yeriniz L4, ücretsiz") çözüm cevabı değildir (kör set 8 k8-37: fırın
 * tarifi + otopark yeri, iki modelde de "ücretsiz" yüzünden tutuluyordu). Konusu olmayan cümle ("Günlük 200 TL'dir.") bir önceki cümlenin
 * konusunu alır ("Otopark ayrıca ücretli. Günlük 200 TL."). Cümle sınırı nokta / ünlem / soru / satır.
 */
function fixAnswerCarriesMoney(text: string, fixTopics: ReadonlySet<string>, otherAnswered: boolean): boolean {
  if (!hasMoneyStatement(text)) return false;
  if (!otherAnswered) return true;
  let carried: string[] = [];
  for (const sentence of text.split(/(?<!\d)[.!?]+(?!\d)|\n+/u)) {
    if (sentence.trim() === "") continue;
    const own = topicsOf(sentence);
    const topics = own.length > 0 ? own : carried;
    carried = topics;
    if (hasMoneyStatement(sentence) && topics.some((t) => fixTopics.has(t))) return true;
  }
  return false;
}
