// ---------------------------------------------------------------------------
// ADAY BİRLEŞTİRME — RECIPROCAL RANK FUSION (RAG dilim 2, 09-09).
//
// Farklı kaynakların puanları farklı ölçeklerdedir (BM25 0..∞, kosinüs 0..1,
// gömme 0..1); ham puan toplamak bir kaynağı ezdirir. RRF yalnız SIRAYA bakar:
//   fused(c) = Σ_s w_s / (K + rank_s(c))      (K = 60, literatür varsayılanı)
// Kaynakta yer almayan (puanı 0 ya da niteliksiz) parça o kaynaktan pay almaz.
// Sonuç seçicide max'a bölünerek [0,1]'e normalize edilir; yeniden sıralama
// bonusları (kategori ipucu, başlık, kalıp, tazelik) onun üstüne biner.
// Deterministik: eşit puanda küçük indeks önce.
// ---------------------------------------------------------------------------

export const RRF_K = 60;
export const RRF_TOP_N = 50;

export interface SourceRanking {
  /** Kanıt/teşhis etiketi ("bm25", "ngram", "semantic"). */
  source: string;
  weight: number;
  /** Parça başına puan; 0 = bu kaynakta aday değil. */
  scores: Float64Array;
}

export interface FusionResult {
  fused: Float64Array;
  /** Kaynak → parça indeksi → 1 tabanlı sıra (yalnız top-N). */
  ranks: Map<string, Map<number, number>>;
}

export function fuseRankings(rankings: readonly SourceRanking[], n: number, topN = RRF_TOP_N): FusionResult {
  const fused = new Float64Array(n);
  const ranks = new Map<string, Map<number, number>>();
  for (const r of rankings) {
    const order: number[] = [];
    for (let i = 0; i < n; i++) if (r.scores[i] > 0) order.push(i);
    order.sort((a, b) => (r.scores[b] !== r.scores[a] ? r.scores[b] - r.scores[a] : a - b));
    const rankMap = new Map<number, number>();
    order.slice(0, topN).forEach((idx, pos) => {
      const rank = pos + 1;
      rankMap.set(idx, rank);
      fused[idx] += r.weight / (RRF_K + rank);
    });
    ranks.set(r.source, rankMap);
  }
  return { fused, ranks };
}

/**
 * BÜYÜKLÜK KORUYAN BİRLEŞİM (CombSUM, min-max normalize): fused(c) = Σ_s w_s · score_s(c)/max_s.
 * RRF yalnız SIRAYA bakar ve 1. ile 2. arasındaki büyük puan farkını siler
 * (1/61 vs 1/62) — ölçüldü: iki terimli kesin isabet, tek terimli kısa
 * çeldiriciye tazelik bonusuyla kaybediyordu. Harness her iki birleşimi ölçer;
 * varsayılan ölçüme göre seçilir.
 */
export function fuseNormalizedScores(rankings: readonly SourceRanking[], n: number): Float64Array {
  const fused = new Float64Array(n);
  for (const r of rankings) {
    let max = 0;
    for (let i = 0; i < n; i++) if (r.scores[i] > max) max = r.scores[i];
    if (max <= 0) continue;
    for (let i = 0; i < n; i++) if (r.scores[i] > 0) fused[i] += (r.weight * r.scores[i]) / max;
  }
  return fused;
}
