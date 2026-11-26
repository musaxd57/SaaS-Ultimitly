// ---------------------------------------------------------------------------
// Kalite konsolu KAPALI KÜMELERİ — yaprak modül (sunucu / istemci ortak; hiçbir şey import etmez).
// ---------------------------------------------------------------------------

/** İnceleme amacı — serbest metin YOK (kayıt müşterinin KVKK ihracına girer; kurucu kararı 09-30 emsali). */
export const AI_QUALITY_PURPOSES = {
  quality_review: "Kalite incelemesi",
  incident_review: "Olay incelemesi",
  complaint_review: "Şikâyet incelemesi",
} as const;
export type AiQualityPurpose = keyof typeof AI_QUALITY_PURPOSES;

/** Kurucu etiketleri (talimat 09-07 listesi). */
export const AI_REVIEW_LABELS = [
  "correct",
  "hallucinated_fact",
  "missed_context",
  "repeated_greeting",
  "wrong_tone",
  "temporal_error",
  "stale_knowledge",
  "retrieval_failure",
  "tool_should_have_been_used",
  "unsafe_auto_send",
  "escalation_failure",
] as const;
export type AiReviewLabelCode = (typeof AI_REVIEW_LABELS)[number];

/** Etiketlerin Türkçe adları (konsol). */
export const AI_REVIEW_LABEL_NAMES: Record<AiReviewLabelCode, string> = {
  correct: "Doğru",
  hallucinated_fact: "Uydurma bilgi",
  missed_context: "Bağlam kaçırıldı",
  repeated_greeting: "Tekrarlanan selam",
  wrong_tone: "Yanlış üslup",
  temporal_error: "Zaman hatası",
  stale_knowledge: "Bayat bilgi",
  retrieval_failure: "Bilgi getirilemedi",
  tool_should_have_been_used: "Araç kullanılmalıydı",
  unsafe_auto_send: "Güvensiz otomatik gönderim",
  escalation_failure: "Devir hatası",
};
