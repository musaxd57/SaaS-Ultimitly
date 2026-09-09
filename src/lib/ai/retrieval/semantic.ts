// ---------------------------------------------------------------------------
// ANLAMSAL PUANLAYICI SÖZLEŞMESİ (RAG — YALNIZ ARAYÜZ + NO-OP).
//
// Gömme (embedding) tabanlı puanlama YENİ ÜCRETLİ SERVİS + (kalıcı vektör için)
// MİGRATION ister → kurucu onayına bağlı (tasarım belgesi §5). Bu dilimde hiçbir
// dış çağrı yoktur; varsayılan puanlayıcı `null` döndürür ve seçici o zaman
// sözcüksel (BM25) + karakter n-gram kaynaklarıyla çalışır. Sözleşme bugünden
// sabitlenir ki gerçek puanlayıcı geldiğinde seçici/harness/kanıt DEĞİŞMESİN:
// puanlar `fusion.ts`e "semantic" kaynağı olarak girer (RRF, ağırlık ↓).
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

/** RRF kaynak ağırlıkları — harness ile ölçülerek ayarlanır. */
export const SOURCE_WEIGHTS = { bm25: 1, ngram: 0.7, semantic: 1 } as const;
