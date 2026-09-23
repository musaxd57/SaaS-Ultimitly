import type { KbCategory } from "@/lib/constants";
import { CONCEPTS, type ConceptMatch } from "./lexicon";
import { normalizeForRetrieval } from "./text";

// ---------------------------------------------------------------------------
// YABANCI DİL YÜZEY BİÇİMLERİ — DE/FR/ES/RU/AR misafir sorusunu MEVCUT kavramlara bağlar (09-24).
//
// Ölçülen boşluk (ajan ölçümü, 400 yabancı dilde sorgu, üç KB): bugün sözcüksel eşleşme bu
// dillerde YAPISAL OLARAK yok. Rusça/Arapça hep "hiç isabet yok" geri çekilmesine düşüyor (KB
// 30 kalemi aşınca cevap cümlesi isteme GİRMİYOR: 12/30); Fransızca/İspanyolca ise daha KÖTÜ —
// Türkçe kök sökücü yabancı kelimeyi rastgele bir Türkçe köke çarptırıp YANLIŞ dar seçim
// yapıyor ("partir"/"parken" → "par" = parti; "sein"/"se" → "se" = sea). Toplam: cevap cümlesi
// isteme %63 giriyordu; bu sözlükle %97 (blok ~%81 küçük). Türkçe/İngilizce ~1.030 sorguda seçim
// BİREBİR aynı (ölçüldü, test-pinli).
//
// 🚨 TÜRKÇE KÖK SÖKÜCÜDEN GEÇMEZ: yabancı biçimleri `detectOnly`ye koymak DENENDİ ve REDDEDİLDİ —
// 23 girdi 2 harfe iner (İspanyolca "salida" → "sa" = Türkçe "saati") ve "Giriş saati kaçta?"
// çıkış kavramı kazanıyordu. Burada eşleşme HAM belirteç üzerindedir (katlama yalnız aksan/harf
// biçimi), kurallar yazı sistemine göre:
//   Latin   : TAM kelime ya da kapalı çekim eki kümesi (s, es, e, en, er, n). Önek eşleşmesi
//             YALNIZ `*` ile işaretli girdide (Almanca bileşik isim, geniş çekimli kök).
//             Uzunluğa bağlı önek kuralı ölçüldü ve REDDEDİLDİ: "depart"→"department",
//             "strand"→"stranded", "hospital"→"hospitality" çarpışıyordu.
//   Kiril   : önek; girdi ≥5 harfse içerme de ("парков" ⊂ "припарковаться").
//   Arapça  : kelime olduğu gibi ve TEK baştaki bitişik ek (ال, بال, لل, و…) sökülerek; sonra
//             önek, girdi ≥4 harfse içerme de.
//   Çok kelimeli girdi ARDIŞIK belirteçlerle eşleşir.
//
// Kaldırılan girdiler (ölçülmüş çarpışma, GERİ EKLEME): RU "машина" (çamaşır/bulaşık makinesi) ·
// RU "пробки" (trafik) · FR "four" (EN four) · "chat" (EN chat) · "café" (restoran ≠ kahve
// makinesi) · FR "partir" ("à partir de 15h") · DE "laut" ("lautet") · ES "parada" (Türkçe
// "parada/paradan" = para+da/dan: "Paradan kesinti var mı?" ulaşım kavramı alıyordu) · FR tekil
// "drap" (EN "drapes" = perde, çekim eki "-es" ile havlu kavramına düşüyordu; çoğul "draps" KALDI).
//
// ⚠️ SINIR (ölçüldü): listede OLMAYAN bir konuda soran yabancı misafirin cümlesi listede olan bir
// kelime içerirse artık yanlış kaleme DARALIR (eskiden tüm KB'ye düşüyordu; 50 sorguda 13→20).
// Sonuç uydurma değil DEVİRDİR (istem "bilgi yok deme, insana devret" der). Kelime listeleri anadil
// konuşanı tarafından İNCELENMEDİ; Arapça lehçe kapsamı ince.
// Sorgu tarafında çalışır: KB metni (saat alanı çelişki kontrolü dahil) etkilenmez.
// ---------------------------------------------------------------------------

/** Kavram kimliği → yüzey biçimleri (doğal yazımla; `*` = Latin önek eşleşmesine izin). */
export const FOREIGN_SURFACE_FORMS: Readonly<Record<string, readonly string[]>> = {
  wifi: ["wlan", "reseau wifi", "red wifi", "вайфа", "вай фай", "wi fi", "интернет", "роутер", "واي فاي", "وايفاي", "انترنت", "الواي", "راوتر"],
  credentials: ["passwort", "kennwort", "zugangscode", "mot de passe", "mdp", "contraseña*", "clave", "пароль", "код", "كلمة السر", "كلمة المرور", "باسورد", "الرقم السري", "رمز"],
  parking: ["parkplatz*", "parkplätze", "parken", "parkhaus", "tiefgarage", "stellplatz", "garer", "stationnement", "stationner", "aparcamiento", "aparcar", "estacionamiento", "estacionar", "parqueo", "парковк", "парков", "стоянк", "موقف", "مواقف", "باركنج", "باركينج", "سياره", "السيارات", "اركن", "أركن"],
  checkin: ["einchecken*", "anreise", "anreisen", "ankunft", "arrivée*", "enregistrement", "llegada", "entrada", "registro", "заселен", "заселит", "заселиться", "заезд", "заехать", "заедем", "чек ин", "تسجيل الدخول", "الدخول", "الوصول", "تشيك ان"],
  checkout: ["auschecken*", "abreise", "abreisen", "départ", "libérer", "quitter", "salida", "dejar el apartamento", "выезд", "выехать", "выселен", "освободить", "تسجيل الخروج", "الخروج", "مغادرة", "غادر", "تسليم الشقة"],
  towels: ["handtuch*", "handtücher", "badetuch*", "badetücher", "bettwäsche*", "laken", "serviette*", "draps", "linge de lit", "toalla*", "sábana*", "ropa de cama", "полотенц", "полотенец", "простын", "постельн", "бельё", "منشفة", "مناشف", "فوطة", "فوط", "شراشف", "ملايات", "بشكير", "بشاكير"],
  trash: ["müll*", "mülltonne", "abfall*", "abfälle", "poubelle*", "ordure*", "déchet*", "basura*", "residuo*", "reciclaje", "мусор", "отход", "قمامة", "القمامة", "زبالة", "الزبالة", "نفايات", "حاوية"],
  ac: ["klimaanlage", "klimaanl*", "climatisation", "climatiseur", "clim", "aire acondicionado", "acondicionado", "climatización", "aire", "кондиционер", "кондицион", "кондер", "مكيف", "تكييف"],
  tv: ["fernbedienung*", "fernseher", "télécommande*", "télé", "mando", "control remoto", "televisión", "tele", "пульт", "телевизор", "ريموت", "جهاز التحكم", "تلفزيون", "التلفاز"],
  pool: ["schwimmbad", "schwimmen", "piscine", "piscina", "alberca", "бассейн", "مسبح", "المسبح", "حمام السباحة", "سباحة"],
  noise: ["nachtruhe", "ruhezeit*", "ruhezeiten", "lärm", "bruit", "silence", "fête", "ruido", "silencio", "fiesta", "тишин", "шум", "вечеринк", "тихие часы", "الهدوء", "هدوء", "إزعاج", "ازعاج", "ضجيج", "حفلة", "حفلات"],
  taxi: ["такси", "тачка", "تاكسي", "تكسي", "أوبر", "اوبر"],
  airport: ["flughafen", "aéroport", "aeropuerto", "аэропорт", "مطار", "المطار"],
  keys: ["schlüssel*", "schlüsselkasten", "clé", "clés", "clef", "boîte à clés", "llave", "llaves", "ключ", "ключниц", "مفتاح", "مفاتيح"],
  hot_water: ["warmwasser", "warmes wasser", "heißes wasser", "eau chaude", "agua caliente", "горячей воды", "горячая вода", "горяч", "ماء ساخن", "مياه ساخنة", "ساخن"],
  heating: ["heizung", "chauffage", "calefacción", "отоплен", "обогревател", "تدفئة", "التدفئة", "دفاية", "الدفاية"],
  address: ["adresse", "dirección", "ubicación", "адрес", "عنوان", "الموقع", "لوكيشن"],
  pharmacy: ["apotheke", "pharmacie*", "farmacia*", "аптек", "صيدلي"],
  grocery: ["supermarkt*", "lebensmittel*", "supermarché*", "épicerie", "supermercado*", "tienda", "супермаркет", "магазин", "продукт", "سوبرماركت", "بقالة", "بقاله", "ماركت"],
  restaurant: ["restaurants", "essen gehen", "frühstück", "restaurante*", "déjeuner", "dîner", "desayuno*", "cena", "ресторан", "кафе", "поесть", "завтрак", "مطعم", "مطاعم", "فطور", "عشاء", "كافيه"],
  beach: ["strand", "plage", "playa", "пляж", "море", "شاطئ", "الشاطئ", "بحر", "البحر"],
  transit: ["bushaltestelle", "u bahn", "straßenbahn", "métro", "arrêt de bus", "autobus", "метро", "автобус", "остановк", "трамва", "مترو", "باص", "حافلة", "الحافله", "موقف الباص"],
  laundry: ["waschmaschine*", "wäsche", "machine à laver", "lessive", "lavadora*", "lavar la ropa", "стиральн", "стирк", "постират", "غسالة", "الغسالة", "غسيل"],
  dishwasher: ["spülmaschine*", "geschirrspüler*", "lave vaisselle", "lavavajillas", "посудомо", "غسالة الصحون", "جلاية"],
  elevator: ["aufzug", "fahrstuhl", "ascenseur*", "ascensor*", "лифт", "مصعد", "اسانسير"],
  pets: ["haustier*", "hund", "katze", "animaux", "animal", "chien", "mascota*", "perro", "gato", "животн", "собак", "кошк", "حيوان", "حيوانات", "كلب", "قطة"],
  baby: ["babybett*", "kinderbett*", "hochstuhl", "lit bébé", "berceau", "chaise haute", "cuna", "trona", "детская кроватк", "кроватк", "стульчик", "سرير اطفال", "سرير أطفال", "سرير طفل", "كرسي اطفال"],
  smoking: ["rauchen", "raucher", "fumer", "fumar", "курить", "курени", "сигарет", "تدخين", "التدخين", "سجائر", "ادخن", "أدخن"],
  balcony: ["balcon", "terrasse", "terraza", "балкон", "терраса", "بلكونة", "البلكونة", "شرفة", "الشرفة", "بلكونه"],
  iron: ["bügeleisen", "fer à repasser", "plancha", "утюг", "مكواة", "مكوى"],
  hairdryer: ["föhn", "haartrockner", "sèche cheveux", "secador", "фен", "سشوار", "مجفف الشعر", "استشوار"],
  stove: ["herd", "backofen", "kochfeld", "plaque", "cuisinière", "cocina", "horno", "плита", "плиту", "духовк", "فرن", "موقد", "بوتاجاز", "غاز الطبخ"],
  fridge: ["kühlschrank*", "réfrigérateur", "frigo", "nevera", "frigorífico", "холодильник", "ثلاجة", "الثلاجة", "براد"],
  microwave: ["mikrowelle", "micro ondes", "microondas*", "микроволнов", "ميكروويف"],
  coffee: ["kaffee", "kaffeemaschine", "wasserkocher", "cafetière", "bouilloire", "cafetera", "hervidor", "кофе", "кофемашин", "чайник", "قهوة", "القهوة", "غلاية", "كاتل"],
  cleaning: ["reinigung", "putzen", "ménage", "nettoyage", "limpieza", "уборк", "убрат", "تنظيف", "التنظيف"],
  gym: ["fitnessstudio*", "salle de sport", "gimnasio", "спортзал", "фитнес", "тренажер", "جيم", "نادي رياضي", "صالة رياضية"],
  power: ["strom", "sicherung", "électricité", "disjoncteur", "electricidad", "luz", "электричеств", "свет", "كهرباء", "الكهرباء", "فيوز"],
  socket: ["steckdose*", "adapter", "prise", "adaptateur", "enchufe", "adaptador", "розетк", "переходник", "адаптер", "فيش", "بريزة", "محول", "مقبس"],
  water_cut: ["kein wasser", "pas d'eau", "no hay agua", "нет воды", "отключили воду", "لا يوجد ماء", "انقطاع الماء", "الماء مقطوع"],
  emergency: ["notfall", "arzt", "krankenhaus", "urgence", "médecin", "hôpital", "urgencia", "médico", "hospital", "скорая", "врач", "больниц", "طوارئ", "طبيب", "مستشفى", "اسعاف", "إسعاف"],
  fire: ["feuerlöscher*", "notausgang", "extincteur", "sortie de secours", "extintor", "salida de emergencia", "огнетушител", "пожар", "طفاية", "حريق", "مخرج الطوارئ"],
  doorman: ["hausmeister*", "concierge", "gardien", "conserje", "portero", "консьерж", "охран", "بواب", "حارس", "البواب"],
  packages: ["paket", "lieferung", "colis", "livraison", "paquete", "entrega", "посылк", "доставк", "курьер", "طرد", "توصيل", "شحنة"],
  lost: ["vergessen", "verloren", "oublié", "perdu", "olvidado", "perdido", "забыл", "потерял", "نسيت", "فقدت", "ضاع"],
  sights: ["sehenswürdigkeit*", "museum", "musée", "visiter", "museo", "visitar", "достопримечательн", "музей", "معالم", "متحف", "اماكن سياحية"],
};

const ARABIC = /[\u0600-\u06FF]/u;
const CYRILLIC = /[\u0400-\u04FF]/u;
/** Baştaki bitişik ekler — uzun olan önce denenir; en az 2 harf kalmalı. */
const ARABIC_CLITICS = ["وال", "بال", "فال", "كال", "ولل", "لل", "ال", "و", "ب", "ل", "ف", "ك"];
/** Latin tam eşleşmeye izin verilen çekim ekleri (kapalı küme). */
const LATIN_INFLECTIONS: ReadonlySet<string> = new Set(["", "s", "es", "e", "en", "er", "n"]);
const PREFIX_MARK = "*";

/**
 * Aksan/harf biçimi katlaması: `normalizeForRetrieval` (NFKC + görünmez + Türkçe katlama) →
 * NFD + birleşik işaretler silinir → ß→ss → Arapça elif/ye/te-merbuta/tatvil birleştirilir.
 * Kök ALMAZ.
 */
export function foreignFold(s: string): string {
  return normalizeForRetrieval(s)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/ß/g, "ss")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ـ/g, "");
}

export function foreignTokens(s: string): string[] {
  return foreignFold(s).match(/[\p{L}\p{N}]+/gu) ?? [];
}

type Script = "latin" | "cyrillic" | "arabic";

function scriptOf(token: string): Script {
  if (ARABIC.test(token)) return "arabic";
  if (CYRILLIC.test(token)) return "cyrillic";
  return "latin";
}

interface EntryToken {
  text: string;
  script: Script;
  prefix: boolean;
}

interface CompiledEntry {
  conceptId: string;
  tokens: EntryToken[];
  via: string;
}

function tokenMatches(t: string, e: EntryToken): boolean {
  if (e.script === "arabic") {
    const candidates = [t];
    for (const c of ARABIC_CLITICS) if (t.startsWith(c) && t.length - c.length >= 2) candidates.push(t.slice(c.length));
    return candidates.some((x) => x.startsWith(e.text) || (e.text.length >= 4 && x.includes(e.text)));
  }
  if (e.script === "cyrillic") return t.startsWith(e.text) || (e.text.length >= 5 && t.includes(e.text));
  if (e.prefix) return t.startsWith(e.text);
  return t.startsWith(e.text) && LATIN_INFLECTIONS.has(t.slice(e.text.length));
}

function compile(): CompiledEntry[] {
  const out: CompiledEntry[] = [];
  // Sözlük (CONCEPTS) sırası korunur: aynı sorguda birden çok kavram eşleşirse sıra deterministik.
  for (const concept of CONCEPTS) {
    for (const raw of FOREIGN_SURFACE_FORMS[concept.id] ?? []) {
      const prefix = raw.endsWith(PREFIX_MARK);
      const texts = foreignTokens(prefix ? raw.slice(0, -1) : raw);
      if (texts.length === 0) continue;
      out.push({
        conceptId: concept.id,
        tokens: texts.map((text) => ({ text, script: scriptOf(text), prefix })),
        via: texts.join(" "),
      });
    }
  }
  return out;
}

const COMPILED: readonly CompiledEntry[] = compile();
const CONCEPT_BY_ID = new Map(CONCEPTS.map((c) => [c.id, c]));

/**
 * Yabancı yüzey biçimleriyle eşleşen kavramlar (kavram başına tek, sözlük sırasıyla).
 * Dönüş `expandQuery`nin `extra` girdisidir; kategori ipucu ve genişletme orada aynı kuralla kurulur.
 */
export function matchForeignConcepts(text: string): ConceptMatch[] {
  const toks = foreignTokens(text);
  if (toks.length === 0) return [];
  const out: ConceptMatch[] = [];
  const seen = new Set<string>();
  for (const entry of COMPILED) {
    if (seen.has(entry.conceptId)) continue;
    outer: for (let i = 0; i + entry.tokens.length <= toks.length; i++) {
      for (let j = 0; j < entry.tokens.length; j++) if (!tokenMatches(toks[i + j], entry.tokens[j])) continue outer;
      const concept = CONCEPT_BY_ID.get(entry.conceptId);
      if (concept) out.push({ concept, via: entry.via });
      seen.add(entry.conceptId);
      break;
    }
  }
  return out;
}

/** Test/teşhis: bir kavramın bağlı olduğu KB kategorisi (yabancı eşleşme ipucu üretir mi?). */
export function foreignConceptCategory(conceptId: string): KbCategory | undefined {
  return CONCEPT_BY_ID.get(conceptId)?.category;
}
