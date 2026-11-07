import { isStopword, tokenize } from "./text";

// ---------------------------------------------------------------------------
// İKİNCİ ADAY KAYNAĞI — KARAKTER 3-GRAM TF-IDF KOSİNÜSÜ (RAG dilim 2, 09-09).
//
// Neden: BM25 kök sökücüye bağımlıdır; Türkçe eklerin kural dışı hâlleri
// ("otoparkının", "şifremizi") ve OSA toleransının dışına taşan yazım hataları
// kaçabilir. Karakter n-gram'ları kökten BAĞIMSIZ bir ikinci aday üreticidir
// ve sözcüksel+"vektör" adaylarını birleştiren RRF yolunu (fusion.ts) BUGÜN,
// ücretli bir gömme servisi olmadan gerçek veriyle çalıştırır. Bu ANLAMSAL
// benzerlik DEĞİLDİR (yazım benzerliğidir) — adı öyle konmadı.
//
// Gömme tabanlı kaynak geldiğinde aynı `SourceRanking` sözleşmesine üçüncü
// kaynak olarak girer; seçici/kanıt/harness değişmez.
// ---------------------------------------------------------------------------

export const NGRAM_N = 3;
/** Bu kosinüsün altındaki n-gram benzerliği tek başına ADAY yapmaz (gürültü). */
export const NGRAM_QUALIFY_MIN = 0.3;

export interface NgramVector {
  weights: Map<string, number>;
  norm: number;
}

function gramsOf(text: string): string[] {
  const out: string[] = [];
  for (const tok of tokenize(text)) {
    if (tok.length < 2 || isStopword(tok)) continue;
    const padded = `#${tok}#`;
    if (padded.length <= NGRAM_N) {
      out.push(padded);
      continue;
    }
    for (let i = 0; i + NGRAM_N <= padded.length; i++) out.push(padded.slice(i, i + NGRAM_N));
  }
  return out;
}

export class NgramIndex {
  readonly vectors: NgramVector[];
  readonly df = new Map<string, number>();
  readonly N: number;

  constructor(texts: readonly string[]) {
    const counts = texts.map((t) => {
      const m = new Map<string, number>();
      for (const g of gramsOf(t)) m.set(g, (m.get(g) ?? 0) + 1);
      return m;
    });
    this.N = texts.length;
    for (const m of counts) for (const g of m.keys()) this.df.set(g, (this.df.get(g) ?? 0) + 1);
    this.vectors = counts.map((m) => this.vectorize(m));
  }

  private idf(gram: string): number {
    return Math.log(1 + this.N / ((this.df.get(gram) ?? 0) + 1));
  }

  private vectorize(counts: Map<string, number>): NgramVector {
    const weights = new Map<string, number>();
    let sq = 0;
    for (const [g, c] of counts) {
      const w = (1 + Math.log(c)) * this.idf(g);
      weights.set(g, w);
      sq += w * w;
    }
    return { weights, norm: Math.sqrt(sq) };
  }

  /** Her parça için kosinüs benzerliği (0..1). */
  query(text: string): Float64Array {
    const counts = new Map<string, number>();
    for (const g of gramsOf(text)) counts.set(g, (counts.get(g) ?? 0) + 1);
    const q = this.vectorize(counts);
    const out = new Float64Array(this.N);
    if (q.norm === 0) return out;
    this.vectors.forEach((v, i) => {
      if (v.norm === 0) return;
      let dot = 0;
      for (const [g, w] of q.weights) {
        const vw = v.weights.get(g);
        if (vw) dot += w * vw;
      }
      out[i] = dot / (q.norm * v.norm);
    });
    return out;
  }
}
