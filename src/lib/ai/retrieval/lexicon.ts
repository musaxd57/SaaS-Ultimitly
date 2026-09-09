import type { KbCategory } from "@/lib/constants";
import { contentStems, stem } from "./text";

// ---------------------------------------------------------------------------
// ALAN SÖZLÜĞÜ — kısa dönem kiralama kavramları (RAG dilim 1, 09-09).
//
// İki iş görür: (1) SORGU GENİŞLETME — "araba nereye koyayım" ↔ "otopark" ↔
// "parking" aynı kavram; (2) KATEGORİ İPUCU — kavram bir KB kategorisine
// bağlıysa o kategorideki parçalar sözcük eşleşmesi olmasa da puan alır (host
// "Otopark" başlığı altında "araç" yazmış olabilir).
//
// KURALLAR:
// - Tek kelimelik terimler hem TESPİT hem GENİŞLETME kaynağıdır; çok kelimelik
//   terimler ("park yeri", "sıcak su") YALNIZ tespit içindir — genel sözcükleri
//   ("yeri", "su") tek başına genişletmeye sokmak gürültü üretirdi.
// - Genel/çok anlamlı sözcükler ("kutu", "misafir", "erken") kavramlara KONMAZ.
// - Sözlük SIRALAMA ipucudur, politika değildir: sır elemesi, onay kapısı ve
//   yetki filtresi burada değil, retrieval'ın önündedir.
// - Terimler katlanmış (ASCII) yazılır; yüklenirken kök alınır ki sorguyla aynı
//   anahtar uzayında yaşasınlar.
// ---------------------------------------------------------------------------

export interface Concept {
  id: string;
  /** Bağlı KB kategorisi (yoksa yalnız genişletme). */
  category?: KbCategory;
  terms: readonly string[];
}

export const CONCEPTS: readonly Concept[] = [
  {
    id: "parking",
    category: "parking",
    terms: ["otopark", "park", "arac", "araba", "garaj", "parking", "car", "vehicle", "garage", "park yeri", "araba parki", "arac parki"],
  },
  {
    id: "wifi",
    category: "wifi",
    terms: ["wifi", "internet", "kablosuz", "modem", "wireless", "router", "baglanti", "wlan"],
  },
  {
    id: "credentials",
    terms: ["sifre", "parola", "password", "kod", "code", "pin", "sifresi"],
  },
  {
    id: "trash",
    category: "trash",
    terms: ["cop", "atik", "konteyner", "trash", "garbage", "rubbish", "waste", "recycling", "geri donusum", "cop kutusu", "cop poseti"],
  },
  {
    id: "checkin",
    category: "checkin",
    // "varis" YOK: kökü "var"a iner ve her "X var mı" sorusunu giriş kavramına bağlardı (ölçüldü).
    terms: ["giris", "checkin", "anahtar", "kilit", "key", "lock", "lockbox", "arrival", "kapi kodu", "anahtar kutusu", "erken giris", "early checkin"],
  },
  {
    id: "checkout",
    category: "checkout",
    terms: ["cikis", "checkout", "ayrilis", "departure", "leaving", "gec cikis", "late checkout", "cikis saati"],
  },
  {
    id: "location",
    category: "location",
    terms: ["adres", "konum", "ulasim", "harita", "address", "location", "directions", "map", "metro", "otobus", "taksi", "havalimani", "airport", "bus", "taxi", "transfer", "yol tarifi", "nasil gelinir"],
  },
  {
    id: "rules",
    category: "rules",
    terms: ["kural", "sigara", "evcil", "kopek", "kedi", "gurultu", "parti", "ziyaretci", "rules", "smoking", "smoke", "pet", "dog", "cat", "noise", "party", "visitor", "ev kurallari", "house rules"],
  },
  {
    id: "cleaning",
    category: "cleaning",
    terms: ["temizlik", "temizlikci", "havlu", "carsaf", "nevresim", "camasir", "deterjan", "cleaning", "towel", "towels", "sheet", "sheets", "linen", "laundry", "washing", "camasir makinesi", "washing machine"],
  },
  {
    id: "local_tips",
    category: "local_tips",
    terms: ["restoran", "kafe", "market", "bakkal", "eczane", "alisveris", "plaj", "deniz", "gezilecek", "tavsiye", "oneri", "restaurant", "cafe", "supermarket", "pharmacy", "shopping", "beach", "sea", "recommend", "recommendation", "nearby", "yakin", "yakinlarda"],
  },
  {
    id: "climate",
    terms: ["klima", "sogutma", "isitma", "kombi", "kalorifer", "radyator", "heating", "heater", "aircon", "ac", "air conditioning", "air conditioner", "soguk", "sicak", "cold", "hot"],
  },
  {
    id: "hot_water",
    terms: ["kombi", "boiler", "termosifon", "sicak su", "hot water", "su isitici", "water heater", "dus"],
  },
  {
    id: "power",
    terms: ["elektrik", "sigorta", "priz", "electricity", "power", "fuse", "socket", "outlet", "elektrikler gitti", "power outage"],
  },
  {
    id: "appliances",
    terms: ["bulasik", "firin", "ocak", "buzdolabi", "mikrodalga", "kettle", "dishwasher", "oven", "stove", "fridge", "refrigerator", "microwave", "kahve makinesi", "coffee machine", "bulasik makinesi"],
  },
  {
    id: "tv",
    terms: ["tv", "televizyon", "television", "netflix", "kumanda", "remote", "uydu", "satellite"],
  },
  {
    id: "amenities",
    terms: ["asansor", "elevator", "lift", "havuz", "pool", "balkon", "balcony", "bebek", "baby", "crib", "bebek yatagi", "utu", "iron", "sac kurutma", "hair dryer"],
  },
];

interface CompiledConcept {
  concept: Concept;
  /** Tek kelimelik terimlerin kökleri (tespit + genişletme). */
  single: Set<string>;
  /** Çok kelimelik terimlerin kök dizileri (yalnız tespit). */
  phrases: string[][];
}

const COMPILED: readonly CompiledConcept[] = CONCEPTS.map((concept) => {
  const single = new Set<string>();
  const phrases: string[][] = [];
  for (const term of concept.terms) {
    const stems = contentStems(term);
    if (stems.length === 0) {
      // Durak kelimeye düşen tek kelimelik terim ("ac" gibi çok kısa olanlar)
      // ham kökle yine de tanınsın.
      const raw = stem(term);
      if (raw.length >= 2) single.add(raw);
      continue;
    }
    if (stems.length === 1) single.add(stems[0]);
    else phrases.push(stems);
  }
  return { concept, single, phrases };
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

/** Sorgu köklerinde geçen kavramlar (tekil, sözlük sırasıyla). */
export function matchConcepts(stems: string[]): ConceptMatch[] {
  const out: ConceptMatch[] = [];
  const set = new Set(stems);
  for (const c of COMPILED) {
    let via: string | null = null;
    for (const s of set) {
      if (c.single.has(s)) {
        via = s;
        break;
      }
    }
    if (!via) {
      for (const p of c.phrases) {
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

export function expandQuery(stems: string[]): QueryExpansion {
  const matched = matchConcepts(stems);
  const own = new Set(stems);
  const expansion = new Map<string, number>();
  const categoryHints = new Map<KbCategory, number>();
  for (const m of matched) {
    const compiled = COMPILED.find((c) => c.concept.id === m.concept.id);
    if (!compiled) continue;
    for (const s of compiled.single) {
      if (!own.has(s)) expansion.set(s, Math.max(expansion.get(s) ?? 0, EXPANSION_WEIGHT));
    }
    if (m.concept.category) {
      categoryHints.set(m.concept.category, Math.min(1, (categoryHints.get(m.concept.category) ?? 0) + 1));
    }
  }
  return { expansion, categoryHints, matched };
}
