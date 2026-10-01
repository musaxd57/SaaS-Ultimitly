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

/** Metnin konu kavramları (getirme sözlüğü; Türkçe kök + yabancı yüzey biçimi). Genel kavramlar düşer. */
export function topicsOf(text: string): string[] {
  if (!text || !text.trim()) return [];
  const { matched } = expandQuery(contentStems(text), matchForeignConcepts(text), phraseUnits(text), {
    possessive: true,
    tokens: tokenize(text),
  });
  return [...new Set(matched.map((m) => m.concept.id))].filter((id) => !GENERIC_TOPICS.has(id)).sort();
}

/** İsteğin konuları: Türkçe + özgün dildeki sorgu + türün kendi konusu. */
export function requestTopics(queryTr: string, queryOriginal: string, kind: ItemKind): string[] {
  return [...new Set([...topicsOf(queryTr), ...topicsOf(queryOriginal), ...(KIND_TOPICS[kind] ?? [])])].sort();
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
  "fi-schalter",
  "fi schalter",
  "tableau electrique",
  "chauffe eau",
  "ballon d'eau chaude",
  "coupure de courant",
  "robinet de gaz",
  "cuadro electrico",
  "llave de gas",
  "لوحة الكهرباء",
  "انقطاع الكهرباء",
];

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
const RECIPE_WORDS = wordRe([
  // tr
  "basin",
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
  // en
  "press",
  "pressing",
  "hold",
  "holding",
  "restart",
  "reboot",
  "reset",
  "unplug",
  "replug",
  "select",
  // de
  "drucken",
  "neustart",
  "neustarten",
  "zurucksetzen",
  "ausschalten",
  "einschalten",
  "warten",
  "wahlen",
  // fr
  "appuyez",
  "appuyer",
  "maintenez",
  "redemarrez",
  "redemarrer",
  "eteignez",
  "rallumez",
  "debranchez",
  "rebranchez",
  "attendez",
  "selectionnez",
  // es
  "pulse",
  "presione",
  "mantenga",
  "reinicie",
  "reiniciar",
  "apague",
  "encienda",
  "desenchufe",
  "espere",
  "seleccione",
  // ru (katlanmış: й → и)
  "нажмите",
  "нажать",
  "удерживаите",
  "перезагрузите",
  "выключите",
  "включите",
  "отключите",
  "подождите",
  "выберите",
  // ar
  "اضغط",
  "اضغطوا",
  "اضغطي",
  "انتظر",
  "انتظروا",
  "اختر",
  "اختاروا",
]);
/**
 * Kök + çekim (tr): sıfırla. Çıplak "tuş / düğme / button / Taste / bouton / botón / кнопка / زر" BİLEREK yok: "Kapıda tuşlu kilit var"
 * bilgi kalemidir, tarif değil — tarif "basın / press / drücken / appuyez / pulse / нажмите / اضغط" fiilini taşır. Süre sözcüğü
 * ("saniye / seconds / Sekunden…") da tek başına tarif DEĞİL ("Plaj 30 saniye yürüme mesafesinde", "Asansör kapısı 10 saniye sonra kapanır");
 * tarifte süreyle birlikte "bekleyin / basılı tutun / wait…" fiili zaten bulunur.
 */
const RECIPE_STEMS = stemRe(["sifirla"]);
/** Olumsuz koşul ("çalışmıyorsa", "açılmıyorsa", "bağlanamıyorsanız") — sorun giderme başlığı. Sınırlı tekrar (karesel iş yok). */
const RECIPE_CONDITIONAL = new RegExp(`${L}\\p{L}{2,24}m[iu]yorsa(?:niz)?${R}`, "u");
const RECIPE_PHRASES: readonly string[] = [
  "yeniden baslat",
  "tekrar baslat",
  "switch it off",
  "switch off",
  "turn it off",
  "turn it back on",
  "turn off and on",
  "power cycle",
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
  "اعادة تشغيل",
  "اعد تشغيل",
  "لا يعمل",
];

/** Bilgi tabanı kalemi bir sorun giderme TARİFİ taşıyor mu (başlık + metin). Saf, doğrusal. */
export function isFixRecipeText(text: string): boolean {
  if (!text || !text.trim()) return false;
  const f = fold(text);
  return RECIPE_WORDS.test(f) || RECIPE_STEMS.test(f) || RECIPE_CONDITIONAL.test(f) || RECIPE_PHRASES.some((p) => f.includes(p));
}

/**
 * İsteme giren bilgi tabanı kalemlerinden TARİF taşıyanların konu kavramları: arıza çözümü isteği ancak konusu bu kümedeyse cevap
 * modeline sunulur (`requestDependency`, `recipe`). Konu kavramı bulunmayan cihaz ("jakuzi") tarifle eşlenemez → ev sahibinde kalır.
 * Konu ÖNCE BAŞLIKTAN ("Klima", "Çamaşır makinesi", "Otopark kapısı açılmıyorsa"): metnin tamamı tarifin geçtiği yeri / fiilini de
 * kavrama çeviriyor (modem tarifindeki "yeniden açın" → klima, "TV ünitesinin rafında" → televizyon, şifredeki "Deniz" → plaj — ölçüldü);
 * başlık konu taşımıyorsa ("Sık sorulanlar") metnin tamamı.
 */
export function kbRecipeTopics(items: readonly { title: string; content: string }[]): Set<string> {
  const out = new Set<string>();
  for (const it of items) {
    const text = `${it.title}\n${it.content}`;
    if (!isFixRecipeText(text)) continue;
    const fromTitle = topicsOf(it.title);
    for (const t of fromTitle.length > 0 ? fromTitle : topicsOf(text)) out.add(t);
  }
  return out;
}

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
export interface ItemRelationFacts {
  relation: ItemRelation;
  topics: string[];
  generic: boolean;
  hazard: boolean;
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

export type RelationHoldDetail = "items_complaint_dependent" | "items_fix_unverified" | "items_fix_hazard";

/**
 * Kapının ikinci kemeri: plan bağlı isteği cevaplanabilir saymışsa (yanlış "bağımsız" işareti, plan dışı yol, gelecekteki değişiklik)
 * cevap GİTMEZ. Cevaplanan arıza çözümü bilgi tabanına dayanmıyorsa (`kb:` kaynağı yok) ya da cevap tehlike sınıfına değiyorsa GİTMEZ.
 */
export function relationGateHold(
  gate: ItemsRelationGate,
  reply: { text: string; answeredRefs: readonly string[]; usedSources: readonly string[] | undefined },
): RelationHoldDetail | null {
  let fixAnswered = false;
  for (const r of gate.requests) {
    const d = requestDependency(r, gate.anchors);
    if (d === "dependent") return "items_complaint_dependent";
    if (d === "fix" && reply.answeredRefs.includes(r.ref)) fixAnswered = true;
  }
  if (!fixAnswered) return null;
  if (!(reply.usedSources ?? []).some((s) => s.startsWith("kb:"))) return "items_fix_unverified";
  if (fixHazard(reply.text)) return "items_fix_hazard";
  return null;
}
