// ---------------------------------------------------------------------------
// PROVENANCE SINIFLARI (V0.4, migration 50) — üç kolonun birlikte okunuşu.
//
// `connectionId` yalnız KANITLA yazılır ve `connectionEvidence` o kanıtın TÜRÜNÜ
// satırda açıkça taşır:
//   ingest   : satırı yaratan ingress bu bağlantı altındaydı (ilk alınma = bu bağlantı).
//   observed : satır NULL iken sonraki bir senkron onu bu bağlantıdan gerçekten çekti.
//              İlk alınmanın bu bağlantıdan yapıldığı İDDİA EDİLMEZ — `ingestedAt` dolu
//              olsa bile (env fallback ile alınıp sonradan gözlemlenen satır). Bu ayrım
//              iki kolondan (connectionId + ingestedAt) ÇIKARILAMAZ; o yüzden kolon var.
//   outbound : giden Message, outbox'ta bu bağlantı altında kuyruklandı (gözlem değil).
// Çıkarım backfill'i YOK; "mevcut bağlantıyı aktar" tarihsel kanıt değildir.
// `ingestedAt` = İLK ALINMA (yalnız create), freshness DEĞİL.
// Tüketen kod (V0.6 event'leri, Property Memory) sınıfı tahmin etmez, buradan okur.
// ---------------------------------------------------------------------------

export const CONNECTION_EVIDENCE = ["ingest", "observed", "outbound"] as const;
export type ConnectionEvidence = (typeof CONNECTION_EVIDENCE)[number];

export type ProvenanceClass = ConnectionEvidence | "unbound" | "legacy";

export interface ProvenanceColumns {
  connectionId: string | null;
  connectionEvidence: string | null;
  ingestedAt: Date | null;
}

export function describeProvenance(row: ProvenanceColumns): ProvenanceClass {
  if (row.connectionId) {
    // Kanıt türü satırdan okunur, tahmin edilmez. Türü yok/bilinmeyen dolu damga (olmaması
    // gereken durum) EN AZ İDDİALI sınıfa düşer: bağlantı kanıtlı, ilk alınma kaynağı iddia edilmez.
    if (row.connectionEvidence === "ingest" || row.connectionEvidence === "outbound") return row.connectionEvidence;
    return "observed";
  }
  return row.ingestedAt ? "unbound" : "legacy";
}

/** "Bu satırın kaynağı belli bir bağlantıya KANITLA bağlanabiliyor mu?" — çıkarım yok. */
export function hasProvenConnection(row: ProvenanceColumns): boolean {
  return row.connectionId !== null;
}
