import type { KbChunk, KbChunkSource } from "./chunker";

// ---------------------------------------------------------------------------
// YENİDEN SIRALAMA + SÜRÜM/ÇELİŞKİ KURALLARI (RAG dilim 2, 09-09).
//
// Deterministik özellik toplamı — model yok. Bileşenler harness ile ÖLÇÜLEREK
// ayarlanır (politika değildir):
//   base      : RRF birleşik puan / max (0..1)
//   hint      : kavram → kategori ipucu (0.35·güç)
//   title     : sorgu kökü başlıkta (0.15)
//   phrase    : sorgu bigramı parçada (0.10)
//   freshness : adaylar arasında göreli tazelik (0..0.05) — YALNIZ eşitlik bozucu
// Sürüm: `supersededById` halefi kümede olan kalem DÜŞER (eski sürüm modele
// gitmez). Halef kümede yoksa (pasif/silinmiş) eski kalem KORUNUR — bilgiyi
// sessizce kaybetmektense host'un görebildiği kalemi taşımak yeğdir.
// Çelişki: aynı kategoride FARKLI saat taşıyan parçalar birlikte gider (P4
// iki kaynağı görsün) — kategoriye bakılmaz, çelişkinin kendisine bakılır.
// ---------------------------------------------------------------------------

export const HINT_BONUS = 0.35;
/**
 * Parçanın TEK kanıtı kategori ipucuysa (sözcüksel/n-gram/anlamsal puanı 0) daha
 * düşük bonus: "rules" gibi geniş kategorilerde ipucu tek başına 4–5 ilgisiz
 * kalemi bloğa dolduruyordu (ölçüldü, ölçek harness'ı n=100: gürültü 4+).
 * Göreli eşik (0.25·en iyi) böylece yalnız-ipucu parçaları gerçek bir isabet
 * varken eler; isabet YOKKEN (host kategoriye bambaşka kelimelerle yazmış) tek
 * aday olarak yine geçer.
 */
export const HINT_ONLY_BONUS = 0.2;
export const TITLE_BONUS = 0.15;
/** Başlığın TAMAMI sorgu terimleriyle (kök ∪ genişletme) örtülüyorsa: "Havuz" başlığı,
 *  "havuz kaçta açılıyor" sorusunda "Havuz kuralı" başlığından öndedir (kısa çeldirici ölçüldü). */
export const TITLE_FULL_BONUS = 0.15;
/** Başlık eşleşmesi yalnız GENİŞLETME terimiyle ("lift" → "asansor") ise yarım bonus. */
export const TITLE_EXPANSION_FACTOR = 0.5;
export const PHRASE_BONUS = 0.1;
export const FRESHNESS_BONUS = 0.05;

export interface RerankContext {
  /** Sorgunun kendi kökleri (fuzzy çözümlü). */
  ownStems: ReadonlySet<string>;
  /** Sözlük genişletmesinden gelen kökler. */
  expansionStems: ReadonlySet<string>;
  bigrams: readonly (readonly [string, string])[];
  categoryHints: ReadonlyMap<string, number>;
}

export interface RerankDoc {
  stems: readonly string[];
  titleStems: ReadonlySet<string>;
}

export interface Candidate {
  idx: number;
  score: number;
}

function hasBigram(docStems: readonly string[], a: string, b: string): boolean {
  for (let i = 0; i + 1 < docStems.length; i++) {
    if (docStems[i] === a && docStems[i + 1] === b) return true;
  }
  return false;
}

/**
 * `base` (0..1) üstüne özellik bonusları. Yalnız `qualified` parçalar aday
 * olur; puan > 0 olanlar döner (sıralanmamış — seçici sıralar).
 */
export function rerank(
  chunks: readonly KbChunk[],
  docs: readonly RerankDoc[],
  base: Float64Array,
  qualified: (i: number) => boolean,
  ctx: RerankContext,
  /**
   * Parçanın kategori ipucu DIŞINDA gerçek kanıtı var mı (güçlü kök isabeti /
   * n-gram eşiği / anlamsal puan)? Verilmezse `base > 0` kullanılır. Ölçüldü:
   * n-gram kosinüsü hemen her parçaya sıfırdan büyük ama anlamsız bir puan
   * verdiği için `base > 0` tek başına "yalnız-ipucu"yu ayıramıyordu.
   */
  hasEvidence: (i: number) => boolean = (i) => base[i] > 0,
): Candidate[] {
  let minT = Number.POSITIVE_INFINITY;
  let maxT = Number.NEGATIVE_INFINITY;
  chunks.forEach((c, i) => {
    if (!qualified(i)) return;
    const t = c.updatedAt.getTime();
    if (t < minT) minT = t;
    if (t > maxT) maxT = t;
  });
  const span = maxT > minT ? maxT - minT : 0;
  const out: Candidate[] = [];
  chunks.forEach((chunk, i) => {
    if (!qualified(i)) return;
    let s = base[i];
    const hint = ctx.categoryHints.get(chunk.category) ?? 0;
    if (hint > 0) s += (hasEvidence(i) ? HINT_BONUS : HINT_ONLY_BONUS) * Math.min(1, hint);
    let titleOwn = false;
    let titleExp = false;
    let titleCovered = docs[i].titleStems.size > 0;
    for (const t of docs[i].titleStems) {
      if (ctx.ownStems.has(t)) titleOwn = true;
      else if (ctx.expansionStems.has(t)) titleExp = true;
      else titleCovered = false;
    }
    if (titleOwn) s += TITLE_BONUS;
    else if (titleExp) s += TITLE_BONUS * TITLE_EXPANSION_FACTOR;
    if (titleCovered && (titleOwn || titleExp)) s += TITLE_FULL_BONUS;
    if (ctx.bigrams.some(([a, b]) => hasBigram(docs[i].stems, a, b))) s += PHRASE_BONUS;
    if (span > 0) s += FRESHNESS_BONUS * ((chunk.updatedAt.getTime() - minT) / span);
    if (s > 0) out.push({ idx: i, score: s });
  });
  return out;
}

/** Deterministik sıra: puan ↓, updatedAt ↓, id ↑, parça ↑. */
export function sortCandidates(cands: Candidate[], chunks: readonly KbChunk[]): Candidate[] {
  return cands.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const ca = chunks[a.idx];
    const cb = chunks[b.idx];
    const ta = ca.updatedAt.getTime();
    const tb = cb.updatedAt.getTime();
    if (tb !== ta) return tb - ta;
    if (ca.id !== cb.id) return ca.id < cb.id ? -1 : 1;
    return ca.chunkIndex - cb.chunkIndex;
  });
}

export interface Supersedable extends KbChunkSource {
  supersededById?: string | null;
}

/** Halefi kümede olan kalemleri düşür (sürüm kuralı). */
export function dropSuperseded<T extends Supersedable>(items: readonly T[]): { kept: T[]; dropped: number } {
  const ids = new Set(items.map((i) => i.id));
  const kept = items.filter((i) => !(i.supersededById && ids.has(i.supersededById)));
  return { kept, dropped: items.length - kept.length };
}

const HHMM_G = /\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/g;

export function timesIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(HHMM_G)) out.add(`${m[1].padStart(2, "0")}:${m[2]}`);
  return out;
}

/**
 * ÇELİŞKİ KORUMA. Seçilen sıradaki her kategori için ÇAPA = o kategoride saat
 * taşıyan ilk seçilen parça. Aynı kategoride çapadan FARKLI saat taşıyan her
 * parça (seçilmiş ama geride kalmış YA DA hiç seçilmemiş) çapanın hemen
 * arkasına TAŞINIR — böylece bütçe/tavan kesmesi çelişkinin ikinci tarafını
 * düşüremez. Aynı saati taşıyan parça çelişki değildir, yerinde kalır.
 * Ölçüldü (09-09): ikinci kaynak kategori ipucuyla aday olup listenin sonuna
 * düşünce "yalnız seçilmemişleri ekle" kuralı onu tavanda kaybediyordu.
 */
export function preserveTimeConflicts(
  chunks: readonly KbChunk[],
  picked: readonly number[],
): { order: number[]; categories: Set<string> } {
  const anchorTimes = new Map<string, Set<string>>();
  const anchorIdx = new Map<string, number>();
  for (const idx of picked) {
    const c = chunks[idx];
    if (anchorTimes.has(c.category)) continue;
    const ts = timesIn(c.text);
    if (ts.size === 0) continue;
    anchorTimes.set(c.category, ts);
    anchorIdx.set(c.category, idx);
  }
  if (anchorTimes.size === 0) return { order: [...picked], categories: new Set() };
  const conflicting = (i: number): boolean => {
    const c = chunks[i];
    const known = anchorTimes.get(c.category);
    if (!known || anchorIdx.get(c.category) === i) return false;
    for (const t of timesIn(c.text)) if (!known.has(t)) return true;
    return false;
  };
  const categories = new Set<string>();
  const movedByCat = new Map<string, number[]>();
  chunks.forEach((c, i) => {
    if (!conflicting(i)) return;
    categories.add(c.category);
    movedByCat.set(c.category, [...(movedByCat.get(c.category) ?? []), i]);
  });
  const moved = new Set([...movedByCat.values()].flat());
  const order: number[] = [];
  for (const idx of picked) {
    if (moved.has(idx)) continue;
    order.push(idx);
    const cat = chunks[idx].category;
    if (anchorIdx.get(cat) === idx) order.push(...(movedByCat.get(cat) ?? []));
  }
  return { order, categories };
}
