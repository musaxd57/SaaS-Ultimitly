// Shared user-facing labels for internal enum values, so raw English/snake_case
// codes (AI intent, riskLevel, language, AI source) never leak into the Turkish UI.

export const INTENT_LABELS: Record<string, string> = {
  wifi: "Wi-Fi",
  parking: "Otopark",
  location: "Konum / Yol tarifi",
  checkin: "Giriş",
  checkout: "Çıkış",
  early_checkin: "Erken giriş",
  late_checkout: "Geç çıkış",
  early_departure: "Erken ayrılma",
  human_request: "İnsan desteği isteniyor",
  cleaning: "Temizlik",
  amenity: "Ekipman / Eşya",
  complaint: "Şikayet",
  refund: "İade",
  general: "Genel",
};

export function intentLabel(intent: string): string {
  return INTENT_LABELS[intent] ?? "Genel";
}

const LANG_LABELS: Record<string, string> = {
  tr: "Türkçe",
  en: "İngilizce",
  de: "Almanca",
  ru: "Rusça",
  ar: "Arapça",
  fr: "Fransızca",
  es: "İspanyolca",
  it: "İtalyanca",
  fa: "Farsça",
};

export function langLabel(code: string): string {
  return LANG_LABELS[code.toLowerCase().slice(0, 2)] ?? code.toUpperCase();
}

export function riskLabel(level: string): string {
  return level === "low"
    ? "Düşük risk"
    : level === "medium"
      ? "Orta risk"
      : level === "high"
        ? "Yüksek risk"
        : "Risk yok";
}

// The product is "Lixus AI" — never surface the backend vendor name in the UI.
export function aiSourceLabel(source: string): string {
  return source === "openai" ? "Lixus AI" : "Hazır yanıt";
}

const CHANNEL_LABELS: Record<string, string> = {
  airbnb: "Airbnb",
  booking: "Booking.com",
  manual: "Manuel",
  whatsapp: "WhatsApp",
  email: "E-posta",
  ics: "Takvim (iCal)",
};

export function channelLabel(channel: string): string {
  return CHANNEL_LABELS[channel.toLowerCase()] ?? channel;
}
