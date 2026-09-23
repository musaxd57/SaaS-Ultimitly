import { KB_ITEM_CAP, KB_RETRIEVAL_CHAR_BUDGET, KB_RETRIEVAL_MAX_CHUNKS } from "@/lib/ai/limits";
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
import { contentStems, normalizeForRetrieval } from "./text";
import { detectGuestLanguage } from "@/lib/ai/fallback";

// ---------------------------------------------------------------------------
// HİBRİT BİLGİ SEÇİCİ — TEK BOĞAZ NOKTASI (RAG dilim 1+2, 09-09).
//
// Boru hattı (bayrak AÇIKKEN):
//   girdi (yetki+mülk+onay+sır süzgeçlerinden GEÇMİŞ kalemler)
//   → sürüm kuralı (halefi kümede olan kalem düşer)
//   → küçük-KB passthrough (≤12 kalem ve ≤6k: tamamı gider)
//   → alt sorgular (?, satır, ; , ve/ayrıca/and/also; ≤4)
//   → her alt sorgu için ADAY KAYNAKLARI: BM25 (kök+sözlük+fuzzy) · karakter
//     3-gram kosinüsü (yalnız Türkçe sorguda, ölçümle) · (varsa) anlamsal
//     puanlar — ÜRETİMDE ANLAMSAL KAYNAK YOK, yalnız sözleşme → CombSUM
//     birleşimi → yeniden sıralama (ipucu/başlık/kalıp; tazelik yalnız
//     yakın-eşitlik bozucu) → eşik
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
  /** Alt sorgu sayısı. */
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
}

export interface KbSelectInput<T extends KbChunkSource> {
  items: readonly T[];
  guestMessage: string;
  history?: readonly { direction: "inbound" | "outbound"; body: string }[];
  /** Bayrağı ezer (test/harness). Verilmezse env. */
  mode?: KbRetrievalMode;
  budgetChars?: number;
  maxChunks?: number;
  /** Anlamsal puanlar (parça anahtarı → 0..1), önceden hesaplanmış; yoksa kaynak yok. */
  semantic?: ReadonlyMap<string, number>;
  sources?: KbSelectSources;
  now?: number;
}

export type SelectedKbItem<T> = T & { chunk?: number; chunkCount?: number };

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
export const DEFAULT_SOURCES: Required<KbSelectSources> = { ngram: "auto", fusion: "sum", foreign: true };
/** Sorgu bu kadar az içerik kökü taşıyorsa önceki misafir mesajları bağlam olarak eklenir. */
const THIN_QUERY_STEMS = 2;
const CARRY_HISTORY_MESSAGES = 2;

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
  const { expansion, categoryHints } = expandQuery([...own, ...carried], opt.sources.foreign ? matchForeignConcepts(subquery) : []);
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
  const useRrf = opt.sources.fusion === "rrf" || semanticScores !== undefined;
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
  const cands = rerank(index.chunks, index.bm25.docs, base, qualified, { ownStems: ownSet, expansionStems, bigrams, categoryHints }, hasEvidence);
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

export function selectKbForPrompt<T extends KbChunkSource>(input: KbSelectInput<T>): KbSelectResult<T> {
  const mode = input.mode ?? kbRetrievalMode();
  if (mode !== "hybrid") return legacyResult(input.items, "legacy", null);
  const started = performance.now();
  const evidence = (
    fb: KbSelectFallback,
    q: number,
    sel: number,
    cand: number,
    extra: Pick<KbRetrievalEvidence, "srcs" | "sup" | "conf" | "confDropped" | "fus"> = {},
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
    if (items.length <= maxChunks && renderedCharsAll(items) <= budget) {
      return legacyResult(sup > 0 ? items : input.items, "hybrid", evidence("small_kb", 0, items.length, items.length, { sup }));
    }
    const subqueries = splitQuestions(input.guestMessage);
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
    const rankedAll = subqueries.map((q) => rankForSubquery(index, q, { carryStems, semantic: input.semantic, sources, queryIsTurkish }));
    const ranked = rankedAll.map((r) => r.cands);
    const srcs = rankedAll[0]?.sources ?? [];
    const fus = rankedAll[0]?.fusion;
    if (ranked.every((r) => r.length === 0)) {
      const cap = cappedForFallback(sup > 0 ? items : input.items);
      return legacyResult(
        cap.items,
        "hybrid",
        evidence("no_lexical_hits", subqueries.length, 0, index.chunks.length, { srcs, fus, sup }),
        cap.dropped,
      );
    }

    // Alt sorgular arasında sırayla (round-robin) → çok sorulu mesajda her
    // sorunun en iyi parçası bütçeden pay alır; tek konu bütçeyi yutamaz.
    const picked: number[] = [];
    const pickedSet = new Set<number>();
    const perItem = new Map<string, number>();
    const cursors = ranked.map(() => 0);
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (let qi = 0; qi < ranked.length; qi++) {
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
          progressed = true;
          break;
        }
      }
    }

    // ÇELİŞKİ KORUMA (alan bazlı): aynı SAAT ALANINDA çapadan farklı saat taşıyan
    // parçalar çapanın hemen arkasına taşınır (P4 iki kaynağı görsün).
    const { order, conflicts } = preserveTimeConflicts(index.chunks, picked, index.fieldTimes);

    // Bütçe: en az bir parça her zaman gider (isabet varken boş blok gitmez).
    const chosen: KbChunk[] = [];
    let used = 0;
    for (const idx of order) {
      const c = index.chunks[idx];
      const cost = renderedChars({ category: c.category, title: c.title, text: c.text });
      if (chosen.length > 0 && (used + cost > budget || chosen.length >= maxChunks)) break;
      chosen.push(c);
      used += cost;
    }

    const byId = new Map<string, T>();
    for (const it of items) byId.set(it.id, it);
    const selected: SelectedKbItem<T>[] = chosen.map((c) => {
      const src = byId.get(c.id) as T;
      const title = c.chunkCount > 1 ? `${c.title} (${c.chunkIndex + 1}/${c.chunkCount})` : c.title;
      return { ...src, title, content: c.text, chunk: c.chunkIndex, chunkCount: c.chunkCount };
    });
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
      evidence: evidence("none", subqueries.length, selected.length, index.chunks.length, {
        srcs,
        fus,
        sup,
        conf: conflicts.length,
        confDropped,
      }),
    };
  } catch (err) {
    // Retrieval hatası ürünü BOZMAZ: legacy küme gider, hata raporlanır.
    void reportError("kb-retrieval-select", err);
    const cap = cappedForFallback(input.items);
    return legacyResult(cap.items, "hybrid", evidence("error", 0, 0, 0), cap.dropped);
  }
}
