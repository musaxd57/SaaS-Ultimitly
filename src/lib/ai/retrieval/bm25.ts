import { contentStems, tokenize } from "./text";

// ---------------------------------------------------------------------------
// BM25 (Okapi, k1=1.2 b=0.75) — parça düzeyinde, kütüphanesiz (RAG dilim 1).
//
// Başlık belirteçleri iki kez sayılır (BM25F'in ucuz hâli): host'un "Otopark"
// başlığı içerikten daha güçlü bir sinyaldir. IDF `ln(1 + (N-df+0.5)/(df+0.5))`
// (BM25+ tabanı) — küçük derlemlerde (5 parça) negatif IDF üretmez.
//
// Yazım hatası toleransı: derlemde HİÇ geçmeyen bir sorgu kökü, sözlükteki en
// yakın köke (Damerau/OSA düzenleme uzaklığı: 5–7 harfte ≤1, 8+ harfte ≤2;
// "otopakr" → "otopark" bir yer değiştirmedir) 0.8 ağırlıkla bağlanır. Sözlük
// parça başına küçüktür (bir mülkün KB'si), tarama ucuzdur ve ölçülür.
// ---------------------------------------------------------------------------

export const BM25_K1 = 1.2;
export const BM25_B = 0.75;
export const FUZZY_MIN_LEN = 5;
export const FUZZY_WEIGHT = 0.8;

/** Damerau–Levenshtein (optimal string alignment) — yer değiştirme tek adım. */
export function osaDistance(a: string, b: string): number {
  const n = a.length;
  const m = b.length;
  const d: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 0; i <= n; i++) d[i][0] = i;
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[n][m];
}

export function fuzzyAllowance(len: number): number {
  if (len < FUZZY_MIN_LEN) return 0;
  return len >= 8 ? 2 : 1;
}
export const TITLE_WEIGHT = 2;

export interface Bm25DocInput {
  key: string;
  title: string;
  text: string;
}

export interface Bm25Doc {
  key: string;
  tf: Map<string, number>;
  len: number;
  /** Ham (kök alınmamış) belirteçler — teşhis için. */
  tokens: string[];
  /** Başlık + gövde içerik kökleri, SIRALI — bigram/kalıp bonusu için. */
  stems: string[];
  titleStems: Set<string>;
}

export class Bm25Index {
  readonly docs: Bm25Doc[];
  readonly df = new Map<string, number>();
  readonly avgdl: number;
  readonly N: number;
  private readonly vocab: string[];

  constructor(inputs: readonly Bm25DocInput[]) {
    this.docs = inputs.map((d) => {
      const bodyStems = contentStems(d.text);
      const titleStemsArr = contentStems(d.title);
      const tf = new Map<string, number>();
      for (const s of bodyStems) tf.set(s, (tf.get(s) ?? 0) + 1);
      for (const s of titleStemsArr) tf.set(s, (tf.get(s) ?? 0) + TITLE_WEIGHT);
      return {
        key: d.key,
        tf,
        len: bodyStems.length + titleStemsArr.length * TITLE_WEIGHT,
        tokens: tokenize(`${d.title} ${d.text}`),
        stems: [...titleStemsArr, ...bodyStems],
        titleStems: new Set(titleStemsArr),
      };
    });
    this.N = this.docs.length;
    let total = 0;
    for (const d of this.docs) {
      total += d.len;
      for (const t of d.tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    }
    this.avgdl = this.N > 0 ? total / this.N : 0;
    this.vocab = [...this.df.keys()];
  }

  idf(term: string): number {
    const df = this.df.get(term) ?? 0;
    return Math.log(1 + (this.N - df + 0.5) / (df + 0.5));
  }

  /** Derlemde geçmeyen kök için en yakın sözlük kökü (yoksa null). Deterministik: eşitlikte alfabetik ilk. */
  fuzzy(term: string): string | null {
    const allow = fuzzyAllowance(term.length);
    if (allow === 0 || /\d/.test(term)) return null;
    let best: string | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const v of this.vocab) {
      if (Math.abs(v.length - term.length) > allow || v.length < FUZZY_MIN_LEN) continue;
      const dist = osaDistance(term, v);
      if (dist < bestDist || (dist === bestDist && best !== null && v < best)) {
        bestDist = dist;
        best = v;
      }
    }
    return bestDist <= allow ? best : null;
  }

  /**
   * Ağırlıklı sorgu → belge puanları. Derlemde olmayan kökler fuzzy eşle
   * (ağırlık × FUZZY_WEIGHT). `resolved` çağırana hangi kökün neye bağlandığını
   * söyler (kanıt/teşhis; misafir metni değil, kök).
   */
  scores(query: ReadonlyMap<string, number>): { scores: Float64Array; resolved: Map<string, string> } {
    const scores = new Float64Array(this.N);
    const resolved = new Map<string, string>();
    const effective = new Map<string, number>();
    for (const [term, w] of query) {
      if (this.df.has(term)) {
        effective.set(term, Math.max(effective.get(term) ?? 0, w));
        continue;
      }
      const near = this.fuzzy(term);
      if (near) {
        resolved.set(term, near);
        effective.set(near, Math.max(effective.get(near) ?? 0, w * FUZZY_WEIGHT));
      }
    }
    if (this.N === 0 || effective.size === 0) return { scores, resolved };
    this.docs.forEach((d, i) => {
      let s = 0;
      const norm = BM25_K1 * (1 - BM25_B + (BM25_B * d.len) / (this.avgdl || 1));
      for (const [term, w] of effective) {
        const tf = d.tf.get(term);
        if (!tf) continue;
        s += w * this.idf(term) * ((tf * (BM25_K1 + 1)) / (tf + norm));
      }
      scores[i] = s;
    });
    return { scores, resolved };
  }
}
