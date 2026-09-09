// ---------------------------------------------------------------------------
// ANLAMSAL PUANLAYICI SÖZLEŞMESİ (RAG dilim 1 — YALNIZ ARAYÜZ + NO-OP).
//
// Gömme (embedding) tabanlı puanlama YENİ ÜCRETLİ SERVİS + (kalıcı vektör için)
// MİGRATION ister → kurucu onayına bağlı (tasarım belgesi §5). Bu dilimde hiçbir
// dış çağrı yoktur; varsayılan puanlayıcı `null` döndürür ve hibrit seçici o
// zaman yalnız sözcüksel puanla çalışır. Sözleşme bugünden sabitlenir ki gerçek
// puanlayıcı geldiğinde seçici/harness/kanıt DEĞİŞMESİN.
//
// Sözleşme kuralları:
// - `score` her parça için [0,1] aralığında sayı ya da bütün olarak `null`
//   (ölçülmedi). Kısmi liste YOK: uzunluk `texts.length` ile aynı olmalı.
// - Puanlayıcı METNİ DEĞİŞTİREMEZ ve seçiciye yeni parça EKLEYEMEZ; yalnız
//   verilen adayları yeniden sıralar (yetki/onay/sır filtreleri retrieval'ın
//   önündedir, puanlayıcı onları göremez).
// - Hata fırlatmaz; ölçemiyorsa `null` döndürür (fail-open sözcüksel yola).
// ---------------------------------------------------------------------------

export interface SemanticScorer {
  readonly name: string;
  score(query: string, texts: readonly string[]): Promise<number[] | null>;
}

export const noopSemanticScorer: SemanticScorer = {
  name: "noop",
  async score() {
    return null;
  },
};

/** Sözcüksel (0..~1.6) ve anlamsal (0..1) puanı karıştırma ağırlığı. */
export const SEMANTIC_BLEND = 0.4;

/** Anlamsal puan varsa harmanla; yoksa sözcüksel puan olduğu gibi kalır. */
export function blendScores(lexical: number, semantic: number | undefined): number {
  if (semantic === undefined || !Number.isFinite(semantic)) return lexical;
  const s = Math.min(1, Math.max(0, semantic));
  return (1 - SEMANTIC_BLEND) * lexical + SEMANTIC_BLEND * s;
}
