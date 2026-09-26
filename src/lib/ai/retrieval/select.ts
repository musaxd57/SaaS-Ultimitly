import { KB_CHAR_BUDGET, KB_ITEM_CAP, KB_RETRIEVAL_CHAR_BUDGET, KB_RETRIEVAL_MAX_CHUNKS } from "@/lib/ai/limits";
import { reportError } from "@/lib/report-error";
import type { KbChunk, KbChunkSource } from "./chunker";
import { kbRetrievalMode, type KbRetrievalMode } from "./flag";
import { fuseNormalizedScores, fuseRankings, type SourceRanking } from "./fusion";
import { expandQuery, TIME_FIELD_LABELS } from "./lexicon";
import { matchForeignConcepts } from "./lexicon-foreign";
import { getOrBuildKbIndex, type KbIndex } from "./index-cache";
import {
  dropSuperseded,
  preserveTimeConflicts,
  rerank,
  sortCandidates,
  type Candidate,
  type Supersedable,
} from "./rerank";
import { SOURCE_WEIGHTS, SEMANTIC_QUALIFY_MIN } from "./semantic";
import { NGRAM_QUALIFY_MIN } from "./sources";
import { contentStems, normalizeForRetrieval, phraseUnits } from "./text";
import { detectGuestLanguage } from "@/lib/ai/fallback";

// ---------------------------------------------------------------------------
// HİBRİT BİLGİ SEÇİCİ — TEK BOĞAZ NOKTASI (RAG dilim 1+2, 09-09).
//
// Boru hattı (bayrak AÇIKKEN):
//   girdi (yetki+mülk+onay+sır süzgeçlerinden GEÇMİŞ kalemler)
//   → sürüm kuralı (halefi kümede olan kalem düşer)
//   → küçük-KB passthrough (≤30 kalem VE ≤24k — legacy'nin kendi kümesi: tamamı gider)
//   → alt sorgular (?, satır, ; , ve/ayrıca/and/also; ≤4) + cevapsız önceki
//     misafir soruları (toplam ≤6) — `retrievalQueries` TEK KAYNAK
//   → her alt sorgu için ADAY KAYNAKLARI: BM25 (kök+sözlük+fuzzy) · karakter
//     3-gram kosinüsü (yalnız Türkçe sorguda, ölçümle) · (varsa) ALT SORGU
//     BAŞINA anlamsal puanlar (üretim yolu `kb-retrieve.ts`, anahtar
//     `KB_SEMANTIC_RETRIEVAL` VARSAYILAN KAPALI) → CombSUM (anlamsal varken
//     RRF) → yeniden sıralama (ipucu/başlık/kalıp; tazelik yalnız
//     yakın-eşitlik bozucu) → göreli eşik (mutlak "alaka yüzdesi" YOK — puan
//     sorgu içinde görelidir, ölçüm 09-23)
//   → alt sorgular arası round-robin (kalem başına ≤3 parça)
//   → çelişki koruma (aynı SAAT ALANINDA farklı saat; kategori-bağımsız)
//   → bütçe (6k / 12 parça); sığmayan çelişki AÇIKÇA bildirilir (notes)
//   → seçilen parçalar + düşen kalem sayısı + PII'siz kanıt
// Aday hiç yoksa / selamlaşmada / hatada LEGACY'NİN ALDIĞI KÜME gider (en yeni
// `KB_ITEM_CAP` kalem): hibrit legacy'den az bilgi taşımaz — 09-11 ölçümünden
// SONRA fazlasını da taşımaz (o dal 200 kalemin tamamını gönderiyordu; 60
// kalemde 1,69× · 300'de 7,57× ve gerçekçi bataryanın %72'si bu dala düşüyor).
// Bayrak KAPALIYKEN çıktı girdinin KENDİSİDİR (aynı referans).
//
// Bu modül DB'ye erişmez, kalem EKLEYEMEZ, metni DEĞİŞTİREMEZ (pinler).
// ---------------------------------------------------------------------------

export { kbRetrievalMode, kbRetrievalModeInfo, type KbRetrievalMode } from "./flag";

export type KbSelectFallback = "none" | "small_kb" | "empty_query" | "no_lexical_hits" | "error";

/** PII'siz kanıt parçası — `RiskEvent.kbEvidenceJson`'a girer (yalnız sayılar/kodlar). */
export interface KbRetrievalEvidence {
  mode: "hybrid";
  /** Deterministik alt sorgu sayısı (güncel + cevapsız önceki mesajlar; anlama katmanının sorguları `uq`da, burada DEĞİL). */
  q: number;
  fb: KbSelectFallback;
  /** Seçilen parça / indeksteki toplam parça. */
  sel: number;
  cand: number;
  ms: number;
  /** Etkin aday kaynakları. */
  srcs?: string[];
  /**
   * 🚨 ETKİN BİRLEŞİM — çağıranın İSTEDİĞİ değil, KOŞAN (inceleme turu, 09-11).
   * Anlamsal kaynak varken `sum` istemi EZİLİR ve RRF koşar (CombSUM yoğun
   * kosinüsle ezilir). Bu alan olmadan o anahtar dışarıdan GÖZLEMLENEMİYORDU:
   * anahtarı silen mutasyon HAYATTA KALIYORDU (pin vakumluydu). Kapalı küme,
   * PII yok; `RiskEvent.kbEvidenceJson` üzerinden denetlenebilir.
   */
  fus?: "sum" | "rrf";
  /** Sürüm kuralıyla düşen kalem sayısı. */
  sup?: number;
  /** Tespit edilen saat-alanı çelişkisi sayısı. */
  conf?: number;
  /** Bütçe yüzünden tüm tarafları bloğa SIĞMAYAN çelişki sayısı (istem notuyla bildirilir). */
  confDropped?: number;
  /** Cevapsız ÖNCEKİ misafir mesajlarından eklenen alt sorgu sayısı (↓`pendingGuestMessages`). */
  pq?: number;
  /**
   * Anlamsal kaynağın bu karardaki durumu (yalnız anahtar AÇIKKEN yazılır; kapalıyken alan YOK):
   * `ok` = puanlar seçiciye verildi · `cold` = parça vektörleri henüz hazır değil (arka planda
   * ısınıyor; bu karar sözcüksel) · `unavailable` = sağlayıcı/zaman aşımı (sözcüksel) ·
   * `not_needed` = küçük KB, retrieval koşmadı (çağrı YAPILMADI). PII yok, kapalı küme.
   */
  sem?: "ok" | "cold" | "unavailable" | "not_needed";
  /** Anlamsal hazırlığın süresi (ms; yalnız anahtar açıkken). */
  semMs?: number;
  /** ANLAMA KATMANININ eklediği (yeniden yazılmış) alt sorgu sayısı (yalnız katman açık + sorgu varken). */
  uq?: number;
  /** Geri çekilmede anlama katmanının isabetiyle ÖNE alınan kalem sayısı (taşınan + parça olarak eklenen). */
  uf?: number;
  /** Anlama katmanının durumu (yalnız `AI_UNDERSTANDING_ENABLED` açıkken; kapalı küme). */
  un?: "ok" | "cached" | "failed";
  /** Anlama katmanının süresi (ms). */
  unMs?: number;
  /** Anlaşılan niyetler (kapalı küme `UNDERSTANDING_INTENTS`, en fazla 5; metin YOK). */
  ui?: string[];
}

export interface KbSelectSources {
  /**
   * Karakter 3-gram kaynağı. "auto" (VARSAYILAN, ölçümle): yalnız sorgu TÜRKÇE
   * algılanırsa — n-gram benzerliği bilgi tabanının diliyle (Türkçe) aynı dilde
   * anlamlıdır; İngilizce sorguda Türkçe metne düşen trigramlar isabeti düşürüp
   * bloğu büyütüyordu (ölçüldü: en h1 −1–3, karakter +30%; morph gürültüsü ise
   * n-gram ile yarıya iniyor). `true`/`false` ölçüm/harness içindir.
   */
  ngram?: boolean | "auto";
  /** Birleşim: "sum" (büyüklük koruyan, VARSAYILAN — ölçüldü) ya da "rrf". */
  fusion?: "sum" | "rrf";
  /**
   * Yabancı dil yüzey biçimleri (`lexicon-foreign.ts`, DE/FR/ES/RU/AR). VARSAYILAN AÇIK (09-24,
   * ölçümle). `false` yalnız ölçüm/harness içindir: "Türkçe/İngilizce seçim birebir aynı" pini
   * iki yolu bununla kıyaslar.
   */
  foreign?: boolean;
  /**
   * Anlamsal kaynak VARKEN birleşim. Varsayılan "rrf" (09-11 inceleme kararı: min-max CombSUM
   * yoğun kosinüsle sözcüksel sırayı siler). "sum" YALNIZ ölçüm içindir (E4): anlamsal puan
   * eşik altında aday şartına tabi olduğundan artık yoğun değil; hangisinin kazandığı ölçümle
   * seçilir — literatür (Bruch vd.) ayarlı ağırlıklı birleşimin RRF'yi geçebildiğini gösteriyor.
   */
  semanticFusion?: "rrf" | "sum";
}

export interface KbSelectInput<T extends KbChunkSource> {
  items: readonly T[];
  guestMessage: string;
  /**
   * `at` = yazıldığı an; seçim OKUMAZ, yalnız anlama katmanının damgasına taşınır (`kb-retrieve.ts`, F14b). `id` de seçime
   * girmez: yalnız konuşma öğelerinin [n] → mesaj eşlemesi için anlama katmanına taşınır.
   */
  history?: readonly { id?: string; direction: "inbound" | "outbound"; body: string; at?: Date }[];
  /** Bayrağı ezer (test/harness). Verilmezse env. */
  mode?: KbRetrievalMode;
  budgetChars?: number;
  maxChunks?: number;
  /**
   * KÜÇÜK KB eşiği (kalem sayısı): KB bu sayıyı ve karakter bütçesini aşmıyorsa seçim YAPILMAZ,
   * tamamı gider. Varsayılan `KB_ITEM_CAP` (legacy'nin gönderdiği küme). Test/ölçüm için ezilebilir.
   */
  fullSetMaxItems?: number;
  /** Anlamsal puanlar (parça anahtarı → 0..1), önceden hesaplanmış; yoksa kaynak yok. */
  semantic?: ReadonlyMap<string, number>;
  /**
   * ALT SORGU BAŞINA anlamsal puanlar (alt sorgu → parça anahtarı → 0..1). Verilen alt sorguda
   * `semantic`i EZER. Üretim yolu (`embeddings/semantic-retrieval.ts`) bunu kullanır: çok sorulu
   * mesajda tek bir mesaj vektörü iki konunun karışımıdır ve her alt sorguya AYNI anlamsal sırayı
   * dayatırdı ("Wi-Fi şifresi ne, otopark var mı?" → otopark parçası Wi-Fi listesinde de öne çıkar).
   * Anahtarlar `retrievalQueries(...).subquery` ile BİREBİR aynıdır (tek kaynak).
   */
  semanticBySubquery?: ReadonlyMap<string, ReadonlyMap<string, number>>;
  /**
   * ANLAMA KATMANININ yeniden yazdığı sorgular (`ai/semantic/understand.ts`; bayrak kapalıyken YOK).
   * Deterministik alt sorgulara BİRLEŞİM olarak eklenir — hiçbir alt sorgunun yerine geçmez, adayı
   * daraltmaz. Kaynak model olduğu için yalnız ARAMA sorgusudur: seçilebilecek küme yetki/onay/sır
   * süzgeçlerinden ÖNCE geçmiş `items`tır (sorgu kümeye kalem ekleyemez).
   */
  extraQueries?: readonly ExtraQuery[];
  sources?: KbSelectSources;
  now?: number;
}

export type SelectedKbItem<T> = T & { chunk?: number; chunkCount?: number };

/**
 * Anlama katmanının yeniden yazdığı sorgu. `turkish`: n-gram kaynağı YALNIZ Türkçe sorguda anlamlıdır
 * (bilgi tabanının dili) — yabancı misafirin Türkçe yeniden yazımı da n-gram almalı (inceleme 09-24).
 */
export interface ExtraQuery {
  text: string;
  turkish: boolean;
}

export interface KbSelectResult<T extends KbChunkSource> {
  mode: KbRetrievalMode;
  /** Legacy'de girdinin KENDİSİ; hibritte sıralı parçalar. */
  items: SelectedKbItem<T>[];
  /** Hiçbir parçası seçilmeyen kalem sayısı (istemdeki devir notunu besler). */
  droppedItems: number;
  /** İstemin bilgi bloğunu nasıl adlandıracağı. */
  selection: "all" | "retrieved";
  /**
   * İsteme eklenecek DÜRÜST notlar (PII yok): örn. bütçeye sığmayan saat çelişkisi
   * ("çıkış için farklı saat değerleri var; kesin saat söyleme, insana devret").
   * Legacy'de boş.
   */
  notes: string[];
  evidence: KbRetrievalEvidence | null;
}

export { HINT_BONUS, TITLE_BONUS, PHRASE_BONUS } from "./rerank";
export const CARRY_WEIGHT = 0.5;
export const RELEVANCE_FLOOR_ABS = 0.1;
export const RELEVANCE_FLOOR_REL = 0.25;
export const MAX_CHUNKS_PER_ITEM = 3;
export const MAX_SUBQUERIES = 4;
export const DEFAULT_SOURCES: Required<KbSelectSources> = { ngram: "auto", fusion: "sum", foreign: true, semanticFusion: "rrf" };
/** Sorgu bu kadar az içerik kökü taşıyorsa önceki misafir mesajları bağlam olarak eklenir. */
const THIN_QUERY_STEMS = 2;
const CARRY_HISTORY_MESSAGES = 2;
/** Sorguya katılan cevapsız önceki misafir mesajı tavanı (en yenisi önce). */
export const PENDING_QUERY_MESSAGES = 3;
/** Güncel mesaj + cevapsız mesajlardan gelen alt sorguların toplam tavanı. */
export const MAX_TOTAL_SUBQUERIES = 6;
/** Anlama katmanından eklenebilecek sorgu tavanı (deterministik tavandan AYRI). */
export const MAX_EXTRA_QUERIES = 6;
/**
 * Ek sorguların seçimdeki PAYI (inceleme 09-24): round-robin'de her sorgu eşit pay alıyordu ve 1 özgün +
 * 6 ek sorguda özgün soru 12 parçanın 2'sine düşüyordu. Ek sorgular toplam en fazla bütçenin 1/3'ünü alır;
 * özgün sorgular geri kalanı eskisi gibi paylaşır.
 */
export const EXTRA_QUERY_SHARE = 1 / 3;
/** Özgün sorgular hiç isabet almadığında (geri çekilme) ek sorguların öne alabileceği kalem sayısı. */
export const EXTRA_FALLBACK_ITEMS = 4;
/**
 * Geri çekilmede ek sorguların legacy kümesine EKLEYEBİLECEĞİ yeni içerik tavanı (karakter). Legacy'de zaten
 * olan kalem yalnız öne taşınır (içerik eklemez); olmayan kalemin yalnız eşleşen PARÇASI gelir. Böylece
 * legacy bloğunun (24k) en fazla bu kadarı yer değiştirebilir (ikinci inceleme 09-24: bütün kalem ekleniyordu,
 * tek bir 19k'lık "ev kılavuzu" legacy kümesinin 24 kalemini isteme sığmaz hâle getiriyordu).
 */
export const EXTRA_FALLBACK_CHARS = Math.floor(KB_RETRIEVAL_CHAR_BUDGET / 2);

/**
 * CEVAPSIZ ÖNCEKİ MİSAFİR MESAJLARI (09-23 ölçümü): son operatör/AI mesajından SONRA gelen, güncel
 * mesaj DIŞINDAKİ misafir mesajları, en yenisi önce. Misafir art arda iki soru sorunca sorgu yalnız
 * sonuncusuydu → ilk sorunun cevabı isteme %10–12 giriyordu (100/300 kalem); ikisi birlikte
 * sorgulanınca %97–99. Güvenlik kapısı aynı listeyi zaten ayrı hesaplıyor; burada yalnız RETRIEVAL
 * girdisidir. Tüm yüzeyler `history` verdiği için tek yerden (yüzeyler ayrışamaz).
 */
export function pendingGuestMessages(
  history: readonly { direction: "inbound" | "outbound"; body: string }[] | undefined,
  current: string,
): string[] {
  const h = history ?? [];
  let lastOut = -1;
  for (let i = h.length - 1; i >= 0; i--) {
    if (h[i].direction !== "inbound") {
      lastOut = i;
      break;
    }
  }
  const cur = current.trim();
  const out: string[] = [];
  for (let i = h.length - 1; i > lastOut && out.length < PENDING_QUERY_MESSAGES; i--) {
    const b = (h[i].body ?? "").trim();
    if (!b || b === cur || out.includes(b)) continue;
    out.push(b);
  }
  return out;
}

const SUBQUERY_SPLIT = /[?\n;,]+|\s+(?:ve|ayrica|ayrıca|bir de|and|also|plus)\s+/i;

/**
 * ZAYIF SORGU KÖKLERİ: tek başına bir parçayı ADAY yapmaz (BM25 puanına yine
 * girer). "Jakuzi var mı?" sorusunda "var", "vardır" içeren her parçayı
 * eşleştirir ve geri çekilmeyi (no_lexical_hits) engellerdi (ölçüldü) — oysa
 * doğru davranış tam kümeyi verip modelin dürüstçe "bilgi yok" diyebilmesidir.
 */
export const WEAK_QUERY_TERMS = new Set([
  // 🚨 GİRDİLER KÖK OLMALI — yüzey biçimi yazılırsa girdi ÖLÜDÜR (sorgu hiçbir zaman o biçimde
  // gelmez). İnceleme 09-10'da ALTI ölü girdi ölçüldü ve düzeltildi: "lazim"→`laz`, "isti"→`ist`,
  // "sorun"→`sor`, "yardim"→`yard`, "leave"→`leav`, "use"→(durak kelime, girdi KALDIRILDI).
  // Ölü girdi sessiz bir gevşemedir: kelime GÜÇLÜ sayılır ve tek başına aday yapar.
  // `kb-retrieval-morphology.test.ts` bunu mekanik olarak pinler (her girdi kendi kökü olmalı).
  "var", "yok", "laz", "gerek", "ist", "kullan", "yap", "ol", "et", "al", "ver", "bul", "gel", "git", "bak", "koy", "birak",
  "acil", "sor", "problem", "yard", "help", "need", "want", "get", "put", "leav", "find", "know", "bil",
  // KÖK UZAYI ARTEFAKTI (09-10, ölçek harness'ı): "çalışıyor" → calis → EN "s" → cali →
  // "ca" (= "çalarsa"); iki harfli nadir kök yüksek IDF ile ilgisiz kalemi öne çekiyordu
  // ("Asansörünüz çalışıyor mu?" → yangın alarmı kalemi). "ko" da adaydı ("koyabilirim",
  // "koduna", "koşu") ama kök sökücü düzeltmesiyle kaynağı kalmadı ("koy"/"kod"/"kos") —
  // "ko" artık "kodu"nun DEĞİL yalnız nadir kelimelerin kökü, listeye ALINMADI.
  "ca",
  // 🚨 LİSTE KÖK UZAYINDA TANIMLI → kök sökücü değişince BAYATLAR (inceleme 09-10). 09-10 kök
  // turunda `-dı/-du/-tı/-tu` taban-3 kuralı "aldı/oldu/etti" köklerini `al/ol/et` (ZAYIF) yerine
  // `ald/old/ett` (GÜÇLÜ) yaptı → "Kargomu kim ALDI?" sorgusunda "yönetim kararı aldı" diyen
  // ilgisiz bir duyuru kalemi TEK BAŞINA aday olabiliyordu (ölçüldü). Yüzey biçimlerinden türeyen
  // yapısal pin `kb-retrieval-morphology.test.ts`te: kök sökücü her değiştiğinde kırmızı verir.
  "ald", "old", "ett",
]);
/**
 * Zayıf kökün BM25 ağırlığı (09-10): 1.0 iken "altı→al" gibi bir zayıf terim üç
 * güçlü kökü geçebiliyordu; aday şartı zaten güçlü kök ister, puanda da aynı
 * ölçüde geri planda kalsın (ölçüldü: kapalı hit@1 +0.5–1.1 puan, isabet düşmedi).
 */
const WEAK_QUERY_WEIGHT = 0.25;

/** Misafir mesajını alt sorgulara böl (çok soru → her biri ayrı retrieval). */
export function splitQuestions(message: string): string[] {
  const norm = normalizeForRetrieval(message);
  const parts = norm
    .split(SUBQUERY_SPLIT)
    .map((p) => p.trim())
    .filter((p) => p.length >= 3 && contentStems(p).length > 0);
  if (parts.length === 0) return contentStems(norm).length > 0 ? [norm] : [];
  return parts.slice(0, MAX_SUBQUERIES);
}

/** Gömülecek sorgu metninin tavanı (misafir mesajı QR'da zaten 2.000'de kırpılı gelir). */
export const EMBED_QUERY_MAX_CHARS = 1_000;

export interface RetrievalQuery {
  /** Seçicinin sıraladığı alt sorgu (ASCII-katlanmış; `semanticBySubquery` ANAHTARI). */
  subquery: string;
  /**
   * Anlamsal kaynağa GÖMÜLECEK metinler (1–2); parçanın puanı bunların EN YÜKSEK kosinüsüdür
   * (çoklu sorgu). Birincisi alt sorgunun geçtiği HAM CÜMLE ("?", satır, ";" ile ayrılan
   * bölüm — Türkçe karakter, noktalama ve bağlam korunur). Cümle virgül/bağlaçla birden çok alt
   * sorguya bölündüyse ikincisi alt sorgunun kendisi: virgül bazen AYNI sorunun iki cümleciğidir
   * ("Gece çok üşüdük, evi ılık yapabilir miyiz?" — tek başına "gece çok üşüdük" anlamı taşımaz),
   * bazen İKİ ayrı soru ("Wi-Fi şifresi ne, otopark var mı?" — cümle vektörü iki konunun
   * karışımı). İkisini birden sormak iki durumu da karşılar; maliyet aynı çağrıda birkaç kısa metin.
   */
  embedTexts: string[];
  /** Anlama katmanından gelen ek sorgu mu (seçimde payı sınırlı; geri çekilmeyi daraltamaz). */
  extra?: true;
  /** Ek sorgu Türkçe mi (n-gram kaynağı için). */
  turkish?: boolean;
}

/** Ham mesajın SERT bölümleri (soru işareti sonrası, satır, ";") — alt sorguların ait olduğu cümle. */
const HARD_SEGMENT = /(?<=[?？])|\n+|;/;

function embedTextsByQuery(message: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const seg of message.split(HARD_SEGMENT)) {
    const raw = seg.trim().slice(0, EMBED_QUERY_MAX_CHARS);
    if (!raw) continue;
    const subs = splitQuestions(seg);
    for (const sq of subs) if (!out.has(sq)) out.set(sq, subs.length === 1 ? [raw] : [raw, sq.slice(0, EMBED_QUERY_MAX_CHARS)]);
  }
  return out;
}

/**
 * SEÇİCİNİN SIRALAYACAĞI SORGULAR — TEK KAYNAK. Güncel mesajın alt sorguları + son operatör
 * mesajından sonraki cevapsız misafir mesajlarının alt sorguları (tekrarsız, toplam
 * `MAX_TOTAL_SUBQUERIES`). Anlamsal hazırlık (`embeddings/semantic-retrieval.ts`) AYNI listeyi
 * gömer; iki yerde ayrı hesaplansaydı anahtarlar ayrışır ve puan sessizce hiçbir alt sorguya
 * ulaşmazdı.
 */
export function retrievalQueries(
  guestMessage: string,
  history?: readonly { direction: "inbound" | "outbound"; body: string }[],
  /**
   * `embedTexts: true` yalnız ANLAMSAL yol içindir; seçici kendisi yalnız `subquery` okur ve gömme
   * metinlerini hesaplamaz (09-23 inceleme: anahtar kapalıyken bölme işi iki katına çıkıyordu).
   */
  opts: { embedTexts?: boolean; extraQueries?: readonly ExtraQuery[] } = {},
): { queries: RetrievalQuery[]; pending: number; extra: number } {
  // Alt sorgu ham cümlesiyle eşleşmezse (normalizasyon bölüm sınırını aşan nadir dönüşüm) alt
  // sorgunun kendisi gömülür — puan asla SESSİZCE başka bir alt sorguya gitmez.
  const textsFor = (byQuery: Map<string, string[]> | null, sq: string): string[] =>
    byQuery ? (byQuery.get(sq) ?? [sq.slice(0, EMBED_QUERY_MAX_CHARS)]) : [];
  const textsOf = (message: string) => (opts.embedTexts ? embedTextsByQuery(message) : null);
  // Güncel mesajın alt sorguları OLDUĞU GİBİ (kendi tavanı `MAX_SUBQUERIES`; 09-23 öncesi davranış).
  const currentTexts = textsOf(guestMessage);
  const queries: RetrievalQuery[] = splitQuestions(guestMessage).map((sq) => ({ subquery: sq, embedTexts: textsFor(currentTexts, sq) }));
  let pending = 0;
  for (const msg of pendingGuestMessages(history, guestMessage)) {
    const texts = textsOf(msg);
    for (const sq of splitQuestions(msg)) {
      if (queries.length >= MAX_TOTAL_SUBQUERIES) break;
      if (queries.some((q) => q.subquery === sq)) continue;
      queries.push({ subquery: sq, embedTexts: textsFor(texts, sq) });
      pending += 1;
    }
  }
  // ANLAMA KATMANI sorguları EN SONA (deterministik sıra ve tavanlar BİREBİR korunur). Her biri tek
  // alt sorgudur (model zaten tek konuya indirdi); gömme metni sorgunun kendisi.
  let extra = 0;
  for (const eq of opts.extraQueries ?? []) {
    if (extra >= MAX_EXTRA_QUERIES) break;
    const raw = eq?.text;
    if (typeof raw !== "string") continue;
    const sq = normalizeForRetrieval(raw).trim();
    if (sq.length < 3 || contentStems(sq).length === 0 || queries.some((q) => q.subquery === sq)) continue;
    queries.push({ subquery: sq, embedTexts: opts.embedTexts ? [raw.slice(0, EMBED_QUERY_MAX_CHARS)] : [], extra: true, turkish: eq.turkish === true });
    extra += 1;
  }
  return { queries, pending, extra };
}

/**
 * Bu küme için sıralama (retrieval) KOŞACAK MI? Küçük KB (tamamı legacy bütçesine sığan) tamamen
 * gider; anlamsal hazırlık bu durumda ağa ÇIKMAZ (boşuna ödeme/gecikme yok). Seçicinin kendi
 * kararıyla AYNI fonksiyon (↓ `selectKbForPrompt`), iki yerde ayrışamaz.
 */
export function retrievalNeeded<T extends KbChunkSource>(items: readonly T[], fullSetMaxItems: number = KB_ITEM_CAP): boolean {
  if (items.length === 0) return false;
  const { kept } = dropSuperseded(items as readonly (T & Supersedable)[]);
  return !(kept.length <= fullSetMaxItems && renderedCharsAll(kept) <= KB_CHAR_BUDGET);
}

function renderedChars(c: { category: string; title: string; text: string }): number {
  return c.category.length + c.title.length + c.text.length + 6;
}

function renderedCharsAll(items: readonly KbChunkSource[]): number {
  let n = 0;
  for (const i of items) n += renderedChars({ category: i.category, title: i.title, text: i.content });
  return n;
}

interface RankOptions {
  carryStems: readonly string[];
  semantic: ReadonlyMap<string, number> | undefined;
  sources: Required<KbSelectSources>;
  /** Dil, HAM misafir mesajından algılanır (alt sorgular ASCII-katlanmıştır; oradan algılanamaz). */
  queryIsTurkish: boolean;
}

/** Bir alt sorgu için aday listesi (sıralı, eşiklenmiş). */
function rankForSubquery(
  index: KbIndex,
  subquery: string,
  opt: RankOptions,
): { cands: Candidate[]; sources: string[]; fusion: "sum" | "rrf" } {
  const own = contentStems(subquery);
  // İNCE SORGU ("Ücretli mi?"): önceki MİSAFİR mesajlarının kökleri hem ağırlığa
  // (0.5) hem kavram genişletmesine girer — tek adım, tek karar noktası.
  const carried = own.length < THIN_QUERY_STEMS ? opt.carryStems : [];
  const weights = new Map<string, number>();
  for (const s of own) weights.set(s, WEAK_QUERY_TERMS.has(s) ? WEAK_QUERY_WEIGHT : 1);
  // ⚠️ ZAYIF KÖK TAŞINDIĞINDA DA ZAYIF (inceleme 09-10): `own` zayıf 0.25'e çekilince, aynı kök
  // GEÇMİŞTEN taşındığında 0.5 kalıyordu — yani misafirin ŞU AN yazdığı kelime, eski mesajından
  // taşınandan HAFİF oluyordu (ilişki tersine dönmüştü; ölçüldü: 772 ince-sorgu senaryosunun
  // 106'sında seçim değişiyor, yön kuyruk gürültüsü). Taşınan zayıf kök ikisinin küçüğünü alır.
  // ⚠️ BİLİNEN SINIR: 0.25 ↔ 0.5 farkı FİKSTÜR ÖLÇEĞİNDE AYIRT EDİLEMİYOR (üç fikstür, birebir aynı
  // sıralama); test yalnız "sıfır değil"i pinler. Değişikliğin gerekçesi ölçülen kazanç değil,
  // TERSİNE DÖNMÜŞ İLİŞKİNİN düzeltilmesidir — bu satır o dürüstlükle duruyor.
  for (const s of carried) {
    if (!weights.has(s)) weights.set(s, WEAK_QUERY_TERMS.has(s) ? Math.min(CARRY_WEIGHT, WEAK_QUERY_WEIGHT) : CARRY_WEIGHT);
  }
  // Yabancı dil yüzey biçimleri HAM alt sorgudan (Türkçe kök sökücüden GEÇMEDEN) — lexicon-foreign.ts.
  // Birebir kalıplar ALT SORGUNUN kendi birimlerinden (durak sözcükler korunur: "çok sıcak", "no water" — `phraseUnits`).
  const { expansion, categoryHints } = expandQuery(
    [...own, ...carried],
    opt.sources.foreign ? matchForeignConcepts(subquery) : [],
    phraseUnits(subquery),
  );
  for (const [s, w] of expansion) if (!weights.has(s)) weights.set(s, w);

  // --- Kaynak 1: BM25 (kök + sözlük genişletmesi + fuzzy) -------------------
  const { scores: bm25, resolved } = index.bm25.scores(weights);
  const strong = new Set<string>();
  for (const t of weights.keys()) if (!WEAK_QUERY_TERMS.has(t)) strong.add(resolved.get(t) ?? t);
  const strongHit = (i: number): boolean => {
    const tf = index.bm25.docs[i].tf;
    for (const t of strong) if (tf.has(t)) return true;
    return false;
  };

  // --- Kaynak 2: karakter 3-gram kosinüsü (kökten bağımsız) ----------------
  const n = index.chunks.length;
  const rankings: SourceRanking[] = [{ source: "bm25", weight: SOURCE_WEIGHTS.bm25, scores: bm25 }];
  const sources = ["bm25"];
  let ngram: Float64Array | null = null;
  const useNgram = opt.sources.ngram === "auto" ? opt.queryIsTurkish : opt.sources.ngram;
  if (useNgram) {
    // Durak kelimeler gram üretmez (`gramsOf`); zayıf kökler ("var") için ayrı
    // süzgeç YOK — aday şartı n-gram için `NGRAM_QUALIFY_MIN` eşiğidir ve
    // "Jakuzi var mı?"nın "vardır"lı parçayı aday yapmadığı test-pinli. Eşik altı
    // kosinüs birleşime girer ama TEK BAŞINA kanıt sayılmaz (`hasEvidence`).
    ngram = index.ngram.query(carried.length > 0 ? `${subquery} ${carried.join(" ")}` : subquery);
    rankings.push({ source: "ngram", weight: SOURCE_WEIGHTS.ngram, scores: ngram });
    sources.push("ngram");
  }
  // --- Kaynak 3: anlamsal (varsa; sözleşme semantic.ts) --------------------
  if (opt.semantic && opt.semantic.size > 0) {
    const sem = new Float64Array(n);
    index.chunks.forEach((c, i) => {
      const v = opt.semantic!.get(`${c.id}#${c.chunkIndex}`);
      if (typeof v === "number" && Number.isFinite(v) && v > 0) sem[i] = Math.min(1, v);
    });
    rankings.push({ source: "semantic", weight: SOURCE_WEIGHTS.semantic, scores: sem });
    sources.push("semantic");
  }

  // ADAY ŞARTI: güçlü kök isabeti YA DA kategori ipucu YA DA n-gram eşiği YA DA
  // anlamsal puan. Zayıf kökler ("var") tek başına aday yapmaz.
  // 🚨 ANLAMSAL EŞİK n-gram EMSALİYLE AYNI (inceleme turu, 09-11). Burası
  // `semanticScores[i] > 0` idi; kosinüs pratikte HER parçada > 0 olduğu için
  // gerçek embedding bağlandığı an HER parça `hasEvidence` olur ve
  // `no_lexical_hits` geri çekilmesi bir daha ASLA tetiklenmezdi (dürüstlük
  // dalı sessizce ölürdü). Bugün etkisi YOK — üretimde `semantic` verilmiyor.
  const semanticScores = rankings.find((r) => r.source === "semantic")?.scores;
  const hasEvidence = (i: number): boolean =>
    strongHit(i) ||
    (ngram !== null && ngram[i] >= NGRAM_QUALIFY_MIN) ||
    (semanticScores !== undefined && semanticScores[i] >= SEMANTIC_QUALIFY_MIN);
  const qualified = (i: number): boolean => hasEvidence(i) || (categoryHints.get(index.chunks[i].category as never) ?? 0) > 0;

  // Niteliksiz parçalar birleşime girmez (kaynak sıralarını şişirmesin).
  for (const r of rankings) {
    for (let i = 0; i < n; i++) if (!qualified(i)) r.scores[i] = 0;
  }
  // 🚨 ANLAMSAL KAYNAK VARSA BİRLEŞİM RRF (inceleme turu, 09-11).
  // CombSUM (`fuseNormalizedScores`) min-max normalize edilmiş PUANLARI toplar.
  // BM25 skorları SEYREKTİR (çoğu parçada 0), kosinüs ise YOĞUNDUR — normalize
  // edilince neredeyse her parça 0,6–1,0 katkı alır ve sözcüksel sıra SİLİNİR.
  // RRF yalnız SIRAYA baktığı için bu sorunu yaşamaz. Çağıran açıkça `rrf`
  // dediyse zaten RRF; anlamsal kaynak geldiğinde de RRF'e geçilir.
  // ⚠️ Bugün etkisi YOK (üretimde `semantic` verilmiyor) — bu bir HAZIRLIKTIR.
  const useRrf = opt.sources.fusion === "rrf" || (semanticScores !== undefined && opt.sources.semanticFusion === "rrf");
  const fused = useRrf ? fuseRankings(rankings, n).fused : fuseNormalizedScores(rankings, n);
  let max = 0;
  for (const v of fused) if (v > max) max = v;
  const base = new Float64Array(n);
  if (max > 0) for (let i = 0; i < n; i++) base[i] = fused[i] / max;

  // Başlık/bigram bonusu FUZZY çözümlü köklerle çalışır ("otopakr" → "otopark"):
  // aksi hâlde yazım hatalı sorguda gerçek başlık bonusu alamaz, kısa çeldirici öne geçer (ölçüldü).
  const ownResolved = own.map((s) => resolved.get(s) ?? s);
  const ownSet = new Set(ownResolved);
  const bigrams: [string, string][] = [];
  for (let i = 0; i + 1 < ownResolved.length; i++) bigrams.push([ownResolved[i], ownResolved[i + 1]]);
  const expansionStems = new Set(expansion.keys());
  const cands = rerank(
    index.chunks,
    index.bm25.docs,
    base,
    qualified,
    { ownStems: ownSet, expansionStems, bigrams, categoryHints },
    hasEvidence,
    semanticScores ? { scores: semanticScores, qualifyMin: SEMANTIC_QUALIFY_MIN } : undefined,
  );
  const best = cands.reduce((m, c) => Math.max(m, c.score), 0);
  const floor = Math.max(RELEVANCE_FLOOR_ABS, best * RELEVANCE_FLOOR_REL);
  return { cands: sortCandidates(cands.filter((c) => c.score >= floor), index.chunks), sources, fusion: useRrf ? ("rrf" as const) : ("sum" as const) };
}

/**
 * @param droppedItems 🚨 GERİ ÇEKİLME KIRPMASINDA DÜŞEN kalem sayısı (§C, 09-12).
 *   Eskiden burada SABİT `0` vardı ve bu ÖLÇÜLMÜŞ BİR YALANDI: hibritte
 *   `kb-fetch` 200 kalem çeker, `cappedForFallback` 30'a indirir, karar kaydı
 *   "hiç kalem düşmedi" derdi. O sayı `RiskEvent.kbDropped`a ve oradan
 *   `classifyGrounding`e gidiyor — `dropped === 0` dalı etiketi `ungrounded`
 *   ("kalem vardı, model kullanmadı") yapıyordu, oysa gerçek `capacity`
 *   ("kalem isteme sığmadı"). Yani host'a YANLIŞ teşhis gösteriliyordu.
 *
 *   ⚠️ A2 sözleşmesi "NULL = ölçülmedi, 0 DEĞİL" der; ölçülmüş-ama-YANLIŞ bir
 *   sıfır NULL'dan kötüdür, çünkü sahte kesinlik üretir.
 *
 *   🚨 Varsayılan 0 KASITLI: legacy modda kırpmayı `kb-fetch` yapar ve düşeni
 *   KENDİ raporlar (`fetchKnowledgeBaseForPrompt.dropped`) — burada ikinci kez
 *   saymak ÇİFT SAYIM olurdu (test-pinli).
 */
function legacyResult<T extends KbChunkSource>(
  items: readonly T[],
  mode: KbRetrievalMode,
  evidence: KbRetrievalEvidence | null,
  droppedItems = 0,
): KbSelectResult<T> {
  return { mode, items: items as SelectedKbItem<T>[], droppedItems, selection: "all", notes: [], evidence };
}

/**
 * 🚨 GERİ ÇEKİLME DALI LEGACY TAVANINI AŞAMAZ (ölçüm turu, 09-11 —
 * `docs/olcum/hibrit-yan-etki-2026-09-11.md`).
 *
 * Hibrit açıkken `kb-fetch` 30 yerine 200 kalem çeker. Seçici "hepsini gönder"e
 * düştüğünde (selamlaşma · sözcüksel isabet yok · hata) O 200'ÜN TAMAMI isteme
 * giriyordu. ÖLÇÜLDÜ — legacy bloğuna göre: 30 kalemde 1,04× · 60'ta (plan
 * tavanı) **1,69×** · 100'de **3,00×** · 300'de **7,57×**. Ve dal nadir DEĞİL:
 * 25 mesajlık gerçekçi kısa-mesaj bataryasının **18'i (%72)** buraya düşüyor.
 *
 * İki sonuç, ikisi de istenmeyen: (a) hibritin legacy'den DAHA ÇOK gönderdiği
 * ölçülen TEK yer; (b) legacy'nin "en yeni 30" penceresinin kalıcı olarak
 * erişilmez tuttuğu bayat/kötü niyetli kalem, tek bir "Merhaba" ile HEPSİ
 * BİRDEN modele gidiyordu (60 kalemde 37, 300'de 170 yeni erişilebilir kalem).
 *
 * Girdi `kb-fetch`ten `updatedAt desc` gelir → ilk `KB_ITEM_CAP` kalem
 * legacy'nin aldığı kümenin TA KENDİSİDİR. Yani bu kırpma "hibrit legacy'den AZ
 * bilgi taşımaz" değişmezini KORUR (eşit taşır), yalnız FAZLASINI keser.
 *
 * ⚠️ Yalnız tavanın ÜSTÜNDEKİ kümede yeni dizi üretilir: `small_kb` dalı zaten
 * tavanın altındadır ve oradaki "aynı dizi referansı" sözleşmesi bozulmamalı.
 */
function cappedForFallback<T extends KbChunkSource>(
  items: readonly T[],
): { items: readonly T[]; dropped: number } {
  // 🚨 KIRPMA ile SAYAÇ tek yerde üretilir (§C). İkisi ayrı yerde hesaplansaydı
  // ayrışırlardı — bu dosyanın kendi tarihçesi tam olarak o sınıftan
  // (kırpma eklendi, sayaç güncellenmedi, kayıt iki yıl "0" dedi).
  if (items.length <= KB_ITEM_CAP) return { items, dropped: 0 };
  return { items: items.slice(0, KB_ITEM_CAP), dropped: items.length - KB_ITEM_CAP };
}

/** Seçilen parçanın isteme giden kalem biçimi (tek kaynak: seçim dalı + geri çekilme ön-eklemesi). */
function chunkAsItem<T extends KbChunkSource>(src: T, c: KbChunk): SelectedKbItem<T> {
  const title = c.chunkCount > 1 ? `${c.title} (${c.chunkIndex + 1}/${c.chunkCount})` : c.title;
  return { ...src, title, content: c.text, chunk: c.chunkIndex, chunkCount: c.chunkCount };
}

/**
 * GERİ ÇEKİLMEDE ANLAMA KATMANININ KATKISI (ikinci inceleme 09-24). Legacy kümesi (`legacy`, en yeni ≤30
 * kalem) AYNEN kalır — kırpılmaz, sırası yalnız öne alınanlar kadar değişir. Ek sorguların adayları
 * round-robin dolaşılır, en fazla `EXTRA_FALLBACK_ITEMS` kalem:
 *  · kalem legacy kümesindeyse ve BÜTÜN kalem tavana sığıyorsa → ÖNE TAŞINIR (yeni içerik yok);
 *  · sığmıyorsa ya da legacy dışındaysa → yalnız eşleşen PARÇASI öne eklenir (bütün kalem değil: 20k'lık bir
 *    kalem legacy bloğunu isteme sığmaz hâle getiriyordu). Legacy kalemi yerinde KALIR (kırpılmaz).
 *  · 🚨 TAŞIMA DA tavana sayılır (son denetim 09-24): istem bloğu açgözlü doldurulur (`packKnowledgeBase`,
 *    24k) — 19k'lık bir kılavuzu öne taşımak legacy'nin sığdırdığı onlarca kalemi DIŞARI itiyordu. Ön ekin
 *    toplamı (taşınan + eklenen) `EXTRA_FALLBACK_CHARS`ı aşmaz → yerinden edilen legacy içeriği bununla sınırlı.
 *  · bu dal çelişki korumasından GEÇMEZ → saat alanı dizindeki başka bir parçayla ÇELİŞEN parça eklenmez
 *    (pencere dışından bayat bir "Çıkış 12:00" kalemi öne gelmesin).
 * `added` yalnız legacy DIŞINDAN gelen parçaları sayar (düşen sayısından çıkarılan: temsil edilmeye başlayanlar).
 */
function fallbackFront<T extends KbChunkSource>(
  index: KbIndex,
  ranked: readonly (readonly Candidate[])[],
  isExtra: readonly boolean[],
  pool: readonly T[],
  legacy: readonly T[],
): { items: SelectedKbItem<T>[]; count: number; added: number } {
  const inLegacy = new Set(legacy.map((i) => i.id));
  const byId = new Map(pool.map((i) => [i.id, i] as const));
  const extraLists = ranked.filter((_, qi) => isExtra[qi]);
  const front: ({ kind: "move"; id: string } | { kind: "add"; chunk: KbChunk; outside: boolean })[] = [];
  const taken = new Set<string>();
  let frontChars = 0;
  for (let round = 0; front.length < EXTRA_FALLBACK_ITEMS; round++) {
    let any = false;
    for (const list of extraLists) {
      if (front.length >= EXTRA_FALLBACK_ITEMS) break;
      const cand = list[round];
      if (!cand) continue;
      any = true;
      const chunk = index.chunks[cand.idx];
      if (taken.has(chunk.id) || !byId.has(chunk.id)) continue;
      const outside = !inLegacy.has(chunk.id);
      if (!outside) {
        const item = byId.get(chunk.id) as T;
        const whole = renderedChars({ category: item.category, title: item.title, text: item.content });
        if (frontChars + whole <= EXTRA_FALLBACK_CHARS) {
          taken.add(chunk.id);
          frontChars += whole;
          front.push({ kind: "move", id: chunk.id });
          continue;
        }
      }
      const cost = renderedChars({ category: chunk.category, title: chunk.title, text: chunk.text });
      if (frontChars + cost > EXTRA_FALLBACK_CHARS) continue;
      if (preserveTimeConflicts(index.chunks, [cand.idx], index.fieldTimes).conflicts.length > 0) continue;
      taken.add(chunk.id);
      frontChars += cost;
      front.push({ kind: "add", chunk, outside });
    }
    if (!any) break;
  }
  const moved = new Set(front.filter((f) => f.kind === "move").map((f) => (f as { id: string }).id));
  const frontItems = front.map((f) =>
    f.kind === "move" ? (byId.get(f.id) as SelectedKbItem<T>) : chunkAsItem(byId.get(f.chunk.id) as T, f.chunk),
  );
  const rest = legacy.filter((i) => !moved.has(i.id)) as SelectedKbItem<T>[];
  const added = front.filter((f) => f.kind === "add" && f.outside).length;
  return { items: [...frontItems, ...rest], count: front.length, added };
}

/** Konu kapsanmış mı: ek sorgunun EN İYİ adayı, özgün bir sorgunun ilk bu kadar adayından BİRİNİN KENDİSİYSE. */
const REDUNDANT_EXTRA_TOP = 3;

/**
 * Özgün sorguların zaten kapsadığı konuyu tekrar eden ek sorgular (seçimde pay almaz). Kıyas PARÇA düzeyinde
 * (son denetim 09-24): kalem kimliğiyle kıyas, çok parçalı bir kılavuzun wifi bölümü özgün soruda çıkınca AYNI
 * kılavuzun evcil hayvan bölümünü soran ek sorguyu da "tekrar" sayıp düşürüyordu.
 */
function redundantExtraQueries(ranked: readonly (readonly Candidate[])[], isExtra: readonly boolean[]): Set<number> {
  const ownTop = new Set<number>();
  ranked.forEach((list, qi) => {
    if (isExtra[qi]) return;
    for (const c of list.slice(0, REDUNDANT_EXTRA_TOP)) ownTop.add(c.idx);
  });
  const out = new Set<number>();
  ranked.forEach((list, qi) => {
    if (isExtra[qi] && list.length > 0 && ownTop.has(list[0].idx)) out.add(qi);
  });
  return out;
}

export function selectKbForPrompt<T extends KbChunkSource>(input: KbSelectInput<T>): KbSelectResult<T> {
  const mode = input.mode ?? kbRetrievalMode();
  if (mode !== "hybrid") return legacyResult(input.items, "legacy", null);
  const started = performance.now();
  const evidence = (
    fb: KbSelectFallback,
    q: number,
    sel: number,
    cand: number,
    extra: Pick<KbRetrievalEvidence, "srcs" | "sup" | "conf" | "confDropped" | "fus" | "pq" | "uq" | "uf"> = {},
  ): KbRetrievalEvidence => ({
    mode: "hybrid",
    q,
    fb,
    sel,
    cand,
    ms: Math.round((performance.now() - started) * 10) / 10,
    ...extra,
  });
  try {
    const budget = input.budgetChars ?? KB_RETRIEVAL_CHAR_BUDGET;
    const maxChunks = input.maxChunks ?? KB_RETRIEVAL_MAX_CHUNKS;
    const sources: Required<KbSelectSources> = { ...DEFAULT_SOURCES, ...(input.sources ?? {}) };
    if (input.items.length === 0) return legacyResult(input.items, "hybrid", evidence("small_kb", 0, 0, 0));
    // SÜRÜM KURALI: halefi kümede olan kalem (A5 `supersededById`) düşer.
    const { kept: items, dropped: sup } = dropSuperseded(input.items as readonly (T & Supersedable)[]);
    // KÜÇÜK KB → SEÇİM YOK: tamamı bütçeye sığıyorsa retrieval'ın katkısı yok,
    // riski var (kaçırılan parça = gereksiz devir). Retrieval yalnız gerektiğinde.
    // 🚨 KALEM EŞİĞİ `maxChunks` (12) DEĞİL, legacy tavanı (09-23 ölçümü): 12 SEÇİMİN çıktı
    // tavanıdır, "küçük KB"nin tanımı değil. Eski şartla 13–30 kalemlik (tipik host) KB, tamamı
    // 6k'ya sığdığı hâlde daraltılıyordu; kelime paylaşmayan (parafraz) Türkçe soruda cevap
    // cümlesi isteme %33–36 giriyordu, legacy'de %91–100 — "hibrit legacy'den AZ bilgi taşımaz"
    // değişmezinin ihlali. `docs/olcum/kb-retrieval-parafraz-2026-09-23.md`.
    // 🚨 KARAKTER EŞİĞİ de legacy'nin KENDİ bütçesi (`KB_CHAR_BUDGET` 24k), seçim çıktısı bütçesi
    // (6k) DEĞİL (ajan ölçümü 09-23): 21–30 kalem / 7,6–10k karakterlik KB'de 6k eşiğiyle parafraz
    // cevabı isteme TR %35–41 · EN %53–61 giriyordu, legacy'de %100. Kural artık tanım gereği:
    // legacy'nin HİÇBİR ŞEY düşürmeyeceği KB'de seçim yapılmaz; retrieval yalnız legacy'nin bilgi
    // KAYBEDECEĞİ yerde (>30 kalem ya da >24k) devreye girer — orada hibrit legacy'yi geçer.
    if (!retrievalNeeded(input.items, input.fullSetMaxItems ?? KB_ITEM_CAP)) {
      return legacyResult(sup > 0 ? items : input.items, "hybrid", evidence("small_kb", 0, items.length, items.length, { sup }));
    }
    const { queries, pending: pq, extra: uq } = retrievalQueries(input.guestMessage, input.history, { extraQueries: input.extraQueries });
    const subqueries = queries.map((q) => q.subquery);
    const index = getOrBuildKbIndex(items, input.now);
    if (subqueries.length === 0) {
      const cap = cappedForFallback(sup > 0 ? items : input.items);
      return legacyResult(cap.items, "hybrid", evidence("empty_query", 0, 0, index.chunks.length, { sup }), cap.dropped);
    }
    const carryStems = (input.history ?? [])
      .filter((m) => m.direction === "inbound")
      .slice(-CARRY_HISTORY_MESSAGES)
      .flatMap((m) => contentStems(m.body));

    const queryIsTurkish = detectGuestLanguage(input.guestMessage) === "tr";
    const rankedAll = queries.map((q) =>
      rankForSubquery(index, q.subquery, {
        // Ek sorgunun (anlama katmanı) bağlamı ZATEN çözülmüştür: önceki misafir mesajlarının kökleri ona
        // TAŞINMAZ (ikinci inceleme 09-24: kısa "sauna" sorgusuna eski "wifi" kökleri ekleniyor, geri
        // çekilmede wifi kalemleri öne alınıyordu).
        carryStems: q.extra ? [] : carryStems,
        semantic: input.semanticBySubquery?.get(q.subquery) ?? input.semantic,
        sources,
        queryIsTurkish: q.extra ? q.turkish === true : queryIsTurkish,
      }),
    );
    const ranked = rankedAll.map((r) => r.cands);
    const isExtra = queries.map((q) => q.extra === true);
    // Kanıttaki `q` yalnız DETERMİNİSTİK alt sorgulardır; ek sorgular `uq`da (ikinci inceleme: `q` ikisini karıştırıyordu).
    const ownQ = isExtra.filter((x) => !x).length;
    const srcs = rankedAll[0]?.sources ?? [];
    const fus = rankedAll[0]?.fusion;
    const ownHits = ranked.some((r, qi) => !isExtra[qi] && r.length > 0);
    if (!ownHits) {
      // ÖZGÜN sorgular isabet almadı → geri çekilme kümesi (legacy tavanı) AYNEN korunur; anlama katmanı onu
      // DARALTAMAZ, yalnız sınırlı biçimde ÖNE ekler (`fallbackFront`).
      const pool = sup > 0 ? items : input.items;
      const fb: KbSelectFallback = ownQ > 0 ? "no_lexical_hits" : "empty_query";
      const cap = cappedForFallback(pool);
      const front = uq > 0 ? fallbackFront(index, ranked, isExtra, pool, cap.items) : null;
      const ev = evidence(
        fb,
        ownQ,
        0,
        index.chunks.length,
        ownQ > 0
          ? { srcs, fus, sup, ...(pq ? { pq } : {}), ...(uq ? { uq } : {}), ...(front && front.count ? { uf: front.count } : {}) }
          : { sup, ...(uq ? { uq } : {}), ...(front && front.count ? { uf: front.count } : {}) },
      );
      if (!front || front.count === 0) return legacyResult(cap.items, "hybrid", ev, cap.dropped);
      // Parça olarak eklenen kalem artık TEMSİL EDİLİYOR: düşen sayısından çıkar (kbDropped dürüst kalsın).
      return legacyResult(front.items, "hybrid", ev, cap.dropped - front.added);
    }

    // Alt sorgular arasında sırayla (round-robin) → çok sorulu mesajda her
    // sorunun en iyi parçası bütçeden pay alır; tek konu bütçeyi yutamaz.
    const picked: number[] = [];
    const pickedSet = new Set<number>();
    const perItem = new Map<string, number>();
    const cursors = ranked.map(() => 0);
    // Parçanın KÖKENİ (yalnız ek sorgu varken tutulur): ek sorguların payı bütçe döngüsünde köken bazında
    // uygulanır. Ek sorgu yoksa bu harita boş kalır ve davranış BİREBİR eskisidir.
    const origin = new Map<number, "own" | "extra">();
    // Ek sorguların payı sınırlı (↑EXTRA_QUERY_SHARE); ek sorgu yoksa sınır hiç devreye girmez (birebir eski).
    const extraQuota = Math.floor(maxChunks * EXTRA_QUERY_SHARE);
    // AYNI KONUYU TEKRAR EDEN ek sorgu payı yemez (ikinci inceleme 09-24): en iyi adayı, özgün bir sorgunun ilk
    // adaylarından birinin KALEMİYSE konu zaten kapsanmıştır ("Wifi?" + "wifi şifresi" + "WLAN Passwort" üçü
    // de wifi kalemlerini seçip evcil hayvan sorusunu dışarıda bırakıyordu).
    const skipExtra = uq > 0 ? redundantExtraQueries(ranked, isExtra) : new Set<number>();
    let extraPicked = 0;
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (let qi = 0; qi < ranked.length; qi++) {
        if (isExtra[qi] && (extraPicked >= extraQuota || skipExtra.has(qi))) continue;
        const list = ranked[qi];
        while (cursors[qi] < list.length) {
          const cand = list[cursors[qi]++];
          if (pickedSet.has(cand.idx)) continue;
          const chunk = index.chunks[cand.idx];
          const cnt = perItem.get(chunk.id) ?? 0;
          if (cnt >= MAX_CHUNKS_PER_ITEM) continue;
          picked.push(cand.idx);
          pickedSet.add(cand.idx);
          perItem.set(chunk.id, cnt + 1);
          if (isExtra[qi]) {
            extraPicked += 1;
            origin.set(cand.idx, "extra");
          } else if (uq > 0) origin.set(cand.idx, "own");
          progressed = true;
          break;
        }
      }
    }

    // ÇELİŞKİ KORUMA (alan bazlı): aynı SAAT ALANINDA çapadan farklı saat taşıyan
    // parçalar çapanın hemen arkasına taşınır (P4 iki kaynağı görsün).
    const { order, conflicts } = preserveTimeConflicts(index.chunks, picked, index.fieldTimes);
    // Çelişki partneri, onu ÇEKEN çapanın kökenine yazılır (ikinci inceleme 09-24: ek sorgu "çıkış saati"
    // 8 çelişen çıkış kalemini içeri çekip özgün sorunun parçalarını 12'den 4'e indiriyordu). Özgün sorunun
    // çelişkisini tamamlayan partner ÖZGÜN sayılır (kendi sorusunun iki kaynağı paya takılmasın).
    if (uq > 0) {
      for (const c of conflicts) {
        const anchor = origin.get(c.anchorIdx) ?? "own";
        for (const p of c.partnerIdx) {
          if (anchor === "own") origin.set(p, "own");
          else if (!origin.has(p)) origin.set(p, "extra");
        }
      }
    }

    // Bütçe: en az bir parça her zaman gider (isabet varken boş blok gitmez). Ek sorgu kökenli parçalar
    // (partnerleri dahil) KARAKTER ve PARÇA olarak bütçenin en fazla `EXTRA_QUERY_SHARE`ını alır — pay parça
    // sayısıyla değil gerçekten isteme girenle ölçülür (ikinci inceleme: ~850 karakterlik parçalarda 6k bütçenin
    // yarısını 1 ek sorgu alıyordu).
    const extraCharCap = Math.floor(budget * EXTRA_QUERY_SHARE);
    const extraChunkCap = Math.floor(maxChunks * EXTRA_QUERY_SHARE);
    let extraChars = 0;
    let extraChunks = 0;
    const chosen: KbChunk[] = [];
    let used = 0;
    for (const idx of order) {
      const c = index.chunks[idx];
      const cost = renderedChars({ category: c.category, title: c.title, text: c.text });
      // Paya sığmayan ek-sorgu parçası ATLANIR ve bütçe kesmesini TETİKLEMEZ (son denetim 09-24: önce bütçe
      // kontrolü gelince zaten atlanacak bir ek parça döngüyü bitirip sığacak özgün parçaları dışarıda bırakıyordu).
      const extra = origin.get(idx) === "extra";
      if (extra && (extraChunks >= extraChunkCap || extraChars + cost > extraCharCap)) continue;
      if (chosen.length > 0 && (used + cost > budget || chosen.length >= maxChunks)) break;
      if (extra) {
        extraChunks += 1;
        extraChars += cost;
      }
      chosen.push(c);
      used += cost;
    }

    const byId = new Map<string, T>();
    for (const it of items) byId.set(it.id, it);
    const selected: SelectedKbItem<T>[] = chosen.map((c) => chunkAsItem(byId.get(c.id) as T, c));
    const representedIds = new Set(chosen.map((c) => c.id));
    const droppedItems = byId.size - representedIds.size;
    // BÜTÇE ÇELİŞKİYİ YUTAMAZ: bir çelişkinin tüm tarafları bloğa sığmadıysa
    // model bunu bilmeli — kesin saat söylememeli, insana devretmeli.
    const chosenIdx = new Set(order.filter((idx) => chosen.includes(index.chunks[idx])));
    const notes: string[] = [];
    let confDropped = 0;
    for (const c of conflicts) {
      const complete = chosenIdx.has(c.anchorIdx) && c.partnerIdx.every((i) => chosenIdx.has(i));
      if (complete) continue;
      confDropped += 1;
      notes.push(
        `Kaynaklarda ${TIME_FIELD_LABELS[c.field] ?? c.field} saati için farklı değerler var (${c.values.join(" / ")}); ` +
          "tamamı bu yanıta sığmadı. Kesin saat SÖYLEME — konuyu insana devret.",
      );
    }
    return {
      mode: "hybrid",
      items: selected,
      droppedItems,
      selection: "retrieved",
      notes,
      evidence: evidence("none", ownQ, selected.length, index.chunks.length, {
        srcs,
        fus,
        sup,
        conf: conflicts.length,
        confDropped,
        ...(pq ? { pq } : {}),
        ...(uq ? { uq } : {}),
      }),
    };
  } catch (err) {
    // Retrieval hatası ürünü BOZMAZ: legacy küme gider, hata raporlanır.
    void reportError("kb-retrieval-select", err);
    const cap = cappedForFallback(input.items);
    return legacyResult(cap.items, "hybrid", evidence("error", 0, 0, 0), cap.dropped);
  }
}
