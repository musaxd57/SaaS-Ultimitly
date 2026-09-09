// ---------------------------------------------------------------------------
// HİBRİT RETRIEVAL BAYRAĞI — TEK OKUMA NOKTASI (RAG dilim 1, 09-09).
//
// `KB_RETRIEVAL_MODE=hybrid` → soruya göre parça seçimi (`retrieval/select.ts`)
// ve daha geniş bir bilgi tabanı okuması (`ai/kb-fetch.ts`, `KB_RETRIEVAL_FETCH_CAP`).
// Başka HER değer (boş, "1", "HYBRID") → legacy. VARSAYILAN KAPALI; çağrı
// başına okunur (`vi.stubEnv` uyumu, depo idiyomu: `durableOutboxEnabled`).
// Bu dosya yaprak modüldür (import yok) — kb-fetch ve select döngüsüz paylaşır.
// ---------------------------------------------------------------------------

export type KbRetrievalMode = "legacy" | "hybrid";

export function kbRetrievalMode(): KbRetrievalMode {
  return process.env.KB_RETRIEVAL_MODE === "hybrid" ? "hybrid" : "legacy";
}
