// ---------------------------------------------------------------------------
// PROVENANCE SINIFLARI (V0.4, migration 50) — iki kolonun birlikte okunuşu.
//
// `connectionId` yalnız KANITLA yazılır: ya ingest anında (satırı yaratan ingress
// aktif bağlantı altındaydı) ya da NULL iken sonraki bir senkron satırı O
// bağlantıdan gerçekten GÖZLEMLEYİNCE (NULL→X). Çıkarım backfill'i YOK: legacy
// satıra org/provider tekilliğinden damga basılmaz; "mevcut bağlantıyı aktar"
// tarihsel kanıt değildir. `ingestedAt` = İLK ALINMA (yalnız create), freshness
// DEĞİL. Dolayısıyla iki kolonun dört bileşimi dört farklı, dürüst anlam taşır:
//   ingest     : bağlantı + ilk alınma birlikte yazıldı — tam kanıt.
//   observed   : legacy satır (ilk alınma bilinmiyor) sonradan bu bağlantıdan
//                gözlemlendi — bağlantı kanıtlı, alınma zamanı bilinmiyor.
//   unbound    : ingress yazdı ama o an bağlantı yoktu (env fallback, iCal, QR,
//                dosya) — alınma zamanı kanıtlı, bağlantı yok/bilinmiyor.
//   legacy     : migration öncesi, henüz gözlemlenmemiş — hiçbir şey bilinmiyor.
// Tüketen kod (V0.6 event'leri, Property Memory) sınıfı tahmin etmez, buradan okur.
// ---------------------------------------------------------------------------

export type ProvenanceClass = "ingest" | "observed" | "unbound" | "legacy";

export interface ProvenanceColumns {
  connectionId: string | null;
  ingestedAt: Date | null;
}

export function describeProvenance(row: ProvenanceColumns): ProvenanceClass {
  if (row.connectionId) return row.ingestedAt ? "ingest" : "observed";
  return row.ingestedAt ? "unbound" : "legacy";
}

/** "Bu satırın kaynağı belli bir bağlantıya KANITLA bağlanabiliyor mu?" — çıkarım yok. */
export function hasProvenConnection(row: ProvenanceColumns): boolean {
  return row.connectionId !== null;
}
