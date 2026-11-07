import type { BadgeTone } from "@/lib/constants";

// Sunum etiketleri (V1 okuma yüzeyi — mülk sayfası). Saf; server-only DEĞİL (birim testlenir).
// Kategori kümesi `signals/derive.ts` ile paralel: kelime ağı intent'leri + cancellation/date_change.

const CATEGORY_LABELS: Record<string, string> = {
  complaint: "Şikayet",
  refund: "İade talebi",
  early_departure: "Erken ayrılma",
  human_request: "İnsan desteği isteği",
  early_checkin: "Erken giriş isteği",
  late_checkout: "Geç çıkış isteği",
  checkin: "Giriş",
  checkout: "Çıkış",
  wifi: "Wi-Fi",
  parking: "Otopark",
  location: "Konum",
  cleaning: "Temizlik",
  amenity: "Olanak",
  cancellation: "İptal",
  date_change: "Tarih değişikliği",
};

export function signalCategoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

/** Sinyalin geldiği kaynağın görünen adı (kind'dan; sağlayıcı adı YOK — kanal bağımsız). */
export function signalKindLabel(kind: string): string {
  if (kind === "message.intent") return "Misafir mesajı";
  if (kind === "reservation.cancelled" || kind === "reservation.dates_changed") return "Rezervasyon";
  return kind;
}

export function sentimentTone(sentiment: string | null | undefined): BadgeTone {
  if (sentiment === "negative") return "destructive";
  if (sentiment === "positive") return "success";
  return "muted";
}
