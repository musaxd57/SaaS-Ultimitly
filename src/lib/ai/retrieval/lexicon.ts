import type { KbCategory } from "@/lib/constants";
import { contentStems, stem } from "./text";

// ---------------------------------------------------------------------------
// ALAN SÖZLÜĞÜ — kısa dönem kiralama kavramları (RAG dilim 1+2, 09-09).
//
// İki iş görür: (1) SORGU GENİŞLETME — "araba nereye koyayım" ↔ "otopark" ↔
// "parking" aynı kavram; (2) KATEGORİ İPUCU — kavram bir KB kategorisine
// bağlıysa o kategorideki parçalar sözcük eşleşmesi olmasa da puan alır (host
// "Otopark" başlığı altında "araç" yazmış olabilir).
//
// KURALLAR (ölçek harness'ıyla ÖLÇÜLDÜ, 09-09):
// - Kavramlar DAR ve TEK AMAÇLI: "olanaklar" gibi torba kavram ("ütü" sorusuna
//   balkon/havuz/bebek genişletmesi) gürültü üretiyordu → bölündü.
// - `terms` hem TESPİT hem GENİŞLETME; `detectOnly` yalnız tespit (genel
//   sözcükler: "kural", "saat", "yeri" ve çok kelimelik kalıplar). Genel sözcüğü
//   genişletmeye sokmak ilgisiz kalemleri aday yapıyordu ("pets" → "kural").
// - `expandOnly` yalnız GENİŞLETME (kurucu onayı 09-26, dış inceleme + ölçüm): TEK BAŞINA birden çok
//   konuyu gösterebilen sözcük kavramı TETİKLEMEZ, kavram kalıpla tespit edilince yine eklenir.
//   Ölçüldü: "Daire çok sıcak" sıcak su kalemini klimanın ÖNÜNE koyuyordu ("sıcak"), "Power outage" /
//   "Elektrik kesintisi" su kesintisini, "bagajı depoya" su deposunu, "eşyalarımızı bırakabilir miyiz"
//   kayıp eşyayı, "merdivenle mi çıkılıyor" / "alarm kodu" yangın kalemini çekiyordu. Saat alanı
//   kuralının "başka konu" sezgisi bu sözcükleri YİNE görür (`matchConcepts(…, {loose})`, davranış aynı).
// - Sözlük SIRALAMA ipucudur, politika değildir: sır elemesi, onay kapısı ve
//   yetki filtresi burada değil, retrieval'ın önündedir.
// - Terimler katlanmış (ASCII) yazılır; yüklenirken kök alınır ki sorguyla aynı
//   anahtar uzayında yaşasınlar.
// ---------------------------------------------------------------------------

export interface Concept {
  id: string;
  /** Bağlı KB kategorisi (yoksa yalnız genişletme). */
  category?: KbCategory;
  /**
   * Bu kavramın SAAT ALANI (çelişki kontrolü için): aynı alanda farklı saat =
   * çelişki; farklı alanlarda farklı saat (havuz 09:00 / kahvaltı 08:00) DEĞİL.
   * Codex 09-09: kategori bazlı kontrol fazla genişti, alan bazlıya çevrildi.
   */
  timeField?: string;
  /** Tespit + genişletme (tek kelime). */
  terms: readonly string[];
  /** Yalnız tespit (genel sözcük ya da çok kelimelik kalıp). */
  detectOnly?: readonly string[];
  /** Yalnız genişletme (tek kelime): kavramı TEK BAŞINA tetiklemeyecek kadar belirsiz sözcük. */
  expandOnly?: readonly string[];
}

export const CONCEPTS: readonly Concept[] = [
  { id: "parking", category: "parking", terms: ["otopark", "arac", "araba", "garaj", "parking", "car", "vehicle", "garage"], detectOnly: ["park yeri", "araba parki", "arac parki", "park etmek", "nereye park"] },
  { id: "wifi", category: "wifi", terms: ["wifi", "internet", "kablosuz", "modem", "wireless", "router", "wlan"], detectOnly: ["kablosuz ag", "internet baglantisi"] },
  { id: "credentials", terms: ["sifre", "parola", "password", "kod", "code", "pin"] },
  { id: "trash", category: "trash", terms: ["cop", "atik", "konteyner", "trash", "garbage", "rubbish", "waste", "recycling"], detectOnly: ["geri donusum", "cop kutusu", "cop poseti"] },
  // "varis" YOK: kökü "var"a iner ve her "X var mı" sorusunu giriş kavramına bağlar (iki kez ölçüldü — geri gelmesin).
  { id: "checkin", category: "checkin", timeField: "checkin", terms: ["giris", "checkin", "arrival"], detectOnly: ["erken giris", "early checkin", "kacta girebilirim", "when can i check in", "giris saati"] },
  { id: "keys", terms: ["anahtar", "kilit", "key", "lock", "lockbox"], detectOnly: ["kapi kodu", "anahtar kutusu", "anahtari kaybettim", "lose the key", "yedek anahtar"] },
  { id: "checkout", category: "checkout", timeField: "checkout", terms: ["cikis", "checkout", "ayrilis", "ayril", "departure", "leaving", "leave"], detectOnly: ["gec cikis", "late checkout", "cikis saati", "kacta ayril", "what time is checkout"] },
  { id: "address", category: "location", terms: ["adres", "konum", "harita", "address", "location", "directions", "map"], detectOnly: ["yol tarifi", "nasil gelinir", "how to get there"] },
  { id: "transit", category: "location", terms: ["metro", "otobus", "tramvay", "bus", "tram", "subway", "durak"], detectOnly: ["toplu tasima", "public transport", "ulasim karti"] },
  { id: "airport", category: "location", terms: ["havalimani", "havaalani", "ucak", "airport", "flight", "shuttle", "transfer", "havas"], detectOnly: ["ucaga nasil", "to the airport"] },
  { id: "taxi", category: "location", terms: ["taksi", "taxi", "cab", "uber"], detectOnly: ["arac cagir", "call a taxi"] },
  { id: "rules", category: "rules", terms: [], detectOnly: ["ev kurallari", "house rules", "kurallar neler", "site kurallari"] },
  { id: "smoking", category: "rules", terms: ["sigara", "smoking", "smoke", "tutun", "cigarette"], detectOnly: ["sigara icebilir"] },
  { id: "pets", category: "rules", terms: ["evcil", "kopek", "kedi", "pet", "pets", "dog", "cat", "hayvan"], detectOnly: ["evcil hayvan", "kopegimi getir"] },
  { id: "noise", category: "rules", timeField: "quiet_hours", terms: ["gurultu", "sessiz", "sessizlik", "parti", "noise", "quiet", "party", "muzik", "music"], detectOnly: ["sessiz saat", "quiet hours", "gece saat"] },
  { id: "pool", category: "rules", timeField: "pool", terms: ["havuz", "pool", "yuzme", "swimming", "sezlong"], detectOnly: ["yuzme havuzu"] },
  { id: "gym", timeField: "gym", terms: ["spor", "fitness", "gym", "salonu"], detectOnly: ["spor salonu", "fitness salonu", "spor yapabilecegim"] },
  { id: "elevator", terms: ["asansor", "elevator", "lift"] },
  { id: "balcony", terms: ["balkon", "balcony", "teras", "terrace"] },
  { id: "baby", terms: ["bebek", "baby", "crib", "cot", "karyola", "mama"], detectOnly: ["bebek yatagi", "mama sandalyesi", "high chair"] },
  { id: "iron", terms: ["utu", "iron", "ironing", "utule"], detectOnly: ["utu masasi", "ironing board"] },
  { id: "hairdryer", terms: ["fon", "hairdryer", "dryer", "kurutma"], detectOnly: ["sac kurutma", "hair dryer", "blow dryer"] },
  { id: "towels", category: "cleaning", terms: ["havlu", "carsaf", "nevresim", "towel", "towels", "sheet", "sheets", "linen", "bedding", "yastik", "battaniye"], detectOnly: ["yedek havlu", "temiz carsaf", "extra towels"] },
  { id: "laundry", category: "cleaning", terms: ["camasir", "kiyafet", "yika", "laundry", "washing", "clothes", "deterjan", "detergent"], detectOnly: ["camasir makinesi", "washing machine", "kiyafet yika"] },
  { id: "cleaning", category: "cleaning", timeField: "cleaning", terms: ["temizlik", "temizlikci", "cleaning", "cleaner", "housekeeping"], detectOnly: ["temizlik ne zaman", "oda temizligi"] },
  { id: "dishwasher", terms: ["bulasik", "dishwasher", "dishes", "tablet"], detectOnly: ["bulasik makinesi", "bulasik yika"] },
  { id: "stove", terms: ["ocak", "firin", "stove", "oven", "hob", "induksiyon", "induction", "cooker"], detectOnly: ["yemek pisir", "how to cook"] },
  { id: "fridge", terms: ["buzdolabi", "dondurucu", "fridge", "freezer", "refrigerator"], detectOnly: [] },
  { id: "microwave", terms: ["mikrodalga", "microwave", "isit", "heat"], detectOnly: ["yemek isit", "heat up food"] },
  { id: "coffee", terms: ["kahve", "coffee", "kapsul", "capsule", "espresso", "kettle", "cay", "tea"], detectOnly: ["kahve makinesi", "coffee machine", "kahve yap"] },
  // "uydu" (09-10): eski kök sökücüde "uydu→uy" = "uymuyor→uy" idi ("Fişim uymuyor" TV genişletmesi alıyordu);
  // çarpışma KÖKTE çözüldü (-du kök 2 harfe inecekse sökülmez → "uyd"), terim KALDI (test-pinli).
  { id: "tv", terms: ["tv", "televizyon", "television", "netflix", "kumanda", "remote", "uydu", "satellite", "kanal", "channel"] },
  { id: "ac", terms: ["klima", "sogutma", "aircon", "cooling", "ac"], detectOnly: ["air conditioning", "air conditioner", "cok sicak", "serinle"] },
  { id: "heating", terms: ["isitma", "kalorifer", "radyator", "heating", "heater", "radiator", "kombi"], detectOnly: ["cok soguk", "usuyor"] },
  // "sicak" TEK BAŞINA klima da olabilir ("Daire çok sıcak") → yalnız genişletme; "suyun sıcağı" kalıbı eklendi.
  { id: "hot_water", terms: ["kombi", "boiler", "termosifon", "isinmiyor"], expandOnly: ["sicak"], detectOnly: ["sicak su", "su sicak", "hot water", "su isitici", "water heater", "dus suyu", "shower water"] },
  // "kesinti"/"outage" elektrik de olabilir, "depo" bagaj deposu da → yalnız genişletme; kalıplar su kesintisini taşır.
  // ⚠️ AÇIK (kurucu kararı bekliyor, 09-26): "no water" kalıbı durak sözcük ("no") düşünce TEK "water" köküne iniyor →
  // her "water" sorusu ("Is there hot water?") su kesintisini tetikliyor; bu yüzden "water outage" kalıbı bugün etkisiz
  // (mutasyon L11 eşdeğer). Aynı çöküş: "cok sicak"→sıcak (klima), "cok soguk"→soğuk, "when can i check in"→check,
  // "how to get there"→get, "nereye park"→park. Ölçüm + örnekler: `docs/olcum/sozluk-belirsiz-kelime-2026-09-26.md`.
  { id: "water_cut", terms: [], expandOnly: ["kesinti", "outage", "depo"], detectOnly: ["su kesintisi", "water cut", "water outage", "su deposu", "su gelmiyor", "no water"] },
  // power ↔ socket AYRILDI (09-10): torba kavram "plug adapter" sorusunu sigorta/şalter
  // kalemine, "elektrikler gitti"yi adaptör kalemine genişletiyordu (ölçüldü).
  { id: "power", terms: ["elektrik", "sigorta", "electricity", "power", "fuse", "salter"], detectOnly: ["elektrikler gitti", "power outage"] },
  { id: "socket", terms: ["priz", "socket", "outlet", "adaptor", "adapter", "fis", "plug"], detectOnly: ["fisim uymuyor"] },
  { id: "pharmacy", category: "local_tips", terms: ["eczane", "ilac", "pharmacy", "medicine", "drugstore", "nobetci"] },
  { id: "grocery", category: "local_tips", terms: ["market", "bakkal", "alisveris", "supermarket", "grocery", "groceries", "shopping", "store"] },
  // "yemek" terimlerden ÇIKTI (09-10): kökü "ye" ("Yemek ısıtabileceğim…" → 4 restoran
  // genişletmesi + local_tips ipucu, mikrodalga kalemi 12 parçanın dışında kalıyordu).
  // 🚨 `detectOnly`'ye taşımak ÇÖZÜM DEĞİL: kalıpla tespit edilen kavram yine TÜM `terms`ini
  // genişletir. "nerede yemek" kalıbı da KOYMA — "nerede" durak, kalıp ["ye"]e derlenir.
  { id: "restaurant", category: "local_tips", terms: ["restoran", "lokanta", "kafe", "kahvalti", "restaurant", "cafe", "food", "eat", "dinner", "breakfast", "lunch", "meyhane"], detectOnly: ["nerede yiyebiliriz", "where to eat", "restoran oner", "aksam yemegi"] },
  { id: "beach", category: "local_tips", terms: ["plaj", "deniz", "sahil", "beach", "sea", "seaside", "kumsal"], detectOnly: ["denize nasil", "how far is the beach"] },
  { id: "sights", category: "local_tips", terms: ["gezilecek", "tavsiye", "oneri", "muze", "recommend", "recommendation", "sights", "attractions", "museum", "yakin", "nearby"] },
  { id: "doorman", terms: ["kapici", "gorevli", "attendant", "concierge", "yonetici", "guvenlik", "security"], detectOnly: ["bina gorevlisi", "building attendant"] },
  { id: "packages", terms: ["kargo", "paket", "kurye", "siparis", "package", "delivery", "courier", "parcel", "teslimat"], detectOnly: ["yemek siparisi", "food delivery", "receive a package"] },
  // "esya" bagaj da olabilir ("eşyalarımızı erken bırakabilir miyiz") → yalnız genişletme.
  { id: "lost", terms: ["unuttum", "unutulan", "kayip", "kaybettim", "lost", "forgot", "forgotten"], expandOnly: ["esya"], detectOnly: ["esyami unuttum", "left something", "unutulan esya"] },
  // "alarm" hırsız alarmı / çalar saat, "merdiven" bina merdiveni de olabilir → yalnız genişletme; duman alarmı kalıpla.
  { id: "fire", terms: ["yangin", "fire", "sondurucu", "extinguisher"], expandOnly: ["alarm", "merdiven"], detectOnly: ["acil cikis", "fire escape", "yangin merdiveni", "emergency exit", "duman alarmi", "smoke alarm"] },
  { id: "emergency", terms: ["acil", "emergency", "ambulans", "ambulance", "polis", "police", "doktor", "doctor", "hastane", "hospital"] },
];

interface CompiledConcept {
  concept: Concept;
  /** Tek kelimelik terimlerin kökleri (tespit + genişletme). */
  single: Set<string>;
  /** Yalnız tespit: kök dizileri (tek ya da çok kelime). */
  detect: string[][];
  /** Yalnız genişletme: tek kelimelik belirsiz sözcüklerin kökleri. */
  expandOnly: Set<string>;
}

function stemsOf(term: string): string[] {
  const s = contentStems(term);
  if (s.length > 0) return s;
  const raw = stem(term);
  return raw.length >= 2 ? [raw] : [];
}

const COMPILED: readonly CompiledConcept[] = CONCEPTS.map((concept) => {
  const single = new Set<string>();
  const detect: string[][] = [];
  for (const term of concept.terms) {
    const stems = stemsOf(term);
    if (stems.length === 1) single.add(stems[0]);
    else if (stems.length > 1) detect.push(stems);
  }
  for (const term of concept.detectOnly ?? []) {
    const stems = stemsOf(term);
    if (stems.length > 0) detect.push(stems);
  }
  const expandOnly = new Set<string>();
  for (const term of concept.expandOnly ?? []) {
    const stems = stemsOf(term);
    if (stems.length === 1) expandOnly.add(stems[0]);
  }
  return { concept, single, detect, expandOnly };
});

export interface ConceptMatch {
  concept: Concept;
  /** Eşleşmeyi tetikleyen terim kökü ya da kalıp. */
  via: string;
}

function hasPhrase(stems: string[], phrase: string[]): boolean {
  if (phrase.length > stems.length) return false;
  outer: for (let i = 0; i + phrase.length <= stems.length; i++) {
    for (let j = 0; j < phrase.length; j++) {
      if (stems[i + j] !== phrase[j]) continue outer;
    }
    return true;
  }
  return false;
}

/**
 * Sorgu köklerinde geçen kavramlar (tekil, sözlük sırasıyla). `loose`: yalnız-genişletme sözcükleri de kavramı
 * tetikler — YALNIZ saat alanı kuralının "cümlecik başka bir konudan söz ediyor" sezgisi içindir (`time-fields.ts`):
 * o kural bu sözcükleri ayrım öncesinde de görüyordu, davranışı değişmesin. Retrieval katı eşleşmeyi kullanır.
 */
export function matchConcepts(stems: string[], opts: { loose?: boolean } = {}): ConceptMatch[] {
  const out: ConceptMatch[] = [];
  const set = new Set(stems);
  for (const c of COMPILED) {
    let via: string | null = null;
    for (const s of set) {
      if (c.single.has(s) || (opts.loose && c.expandOnly.has(s))) {
        via = s;
        break;
      }
    }
    if (!via) {
      for (const p of c.detect) {
        if (hasPhrase(stems, p)) {
          via = p.join(" ");
          break;
        }
      }
    }
    if (via) out.push({ concept: c.concept, via });
  }
  return out;
}

export interface QueryExpansion {
  /** Eklenen kökler → ağırlık (sorgunun kendi kökleri ağırlık 1'dir). */
  expansion: Map<string, number>;
  /** Kategori ipuçları → güç (0..1). */
  categoryHints: Map<KbCategory, number>;
  matched: ConceptMatch[];
}

export const EXPANSION_WEIGHT = 0.5;

/**
 * `extra`: kökten BAĞIMSIZ bulunmuş kavramlar (yabancı dil yüzey biçimleri, `lexicon-foreign.ts`).
 * Kavram kimliğine göre birleşir — aynı kavram iki yoldan gelirse genişletme ve ipucu BİR kez.
 */
export function expandQuery(stems: string[], extra: readonly ConceptMatch[] = []): QueryExpansion {
  const matched = matchConcepts(stems);
  for (const e of extra) if (!matched.some((m) => m.concept.id === e.concept.id)) matched.push(e);
  const own = new Set(stems);
  const expansion = new Map<string, number>();
  const categoryHints = new Map<KbCategory, number>();
  for (const m of matched) {
    const compiled = COMPILED.find((c) => c.concept.id === m.concept.id);
    if (!compiled) continue;
    for (const s of [...compiled.single, ...compiled.expandOnly]) {
      if (!own.has(s)) expansion.set(s, Math.max(expansion.get(s) ?? 0, EXPANSION_WEIGHT));
    }
    if (m.concept.category) {
      categoryHints.set(m.concept.category, Math.min(1, (categoryHints.get(m.concept.category) ?? 0) + 1));
    }
  }
  return { expansion, categoryHints, matched };
}

/** Saat alanının insan-okur etiketi (istem notu için; kapalı küme). */
export const TIME_FIELD_LABELS: Record<string, string> = {
  checkin: "giriş",
  checkout: "çıkış",
  quiet_hours: "sessiz saat",
  pool: "havuz",
  gym: "spor salonu",
  cleaning: "temizlik",
  // `time-fields.ts` ayrı alanları: erken/geç giriş-çıkış mülk saatiyle KIYASLANMAZ.
  early_checkin: "erken giriş",
  late_checkin: "geç giriş",
  early_checkout: "erken çıkış",
  late_checkout: "geç çıkış",
};

/** Bir parça metninin köklerinde geçen SAAT ALANLARI (tekil, sözlük sırasıyla). */
export function timeFieldsIn(stems: string[]): string[] {
  const out: string[] = [];
  for (const m of matchConcepts(stems)) {
    const f = m.concept.timeField;
    if (f && !out.includes(f)) out.push(f);
  }
  return out;
}
