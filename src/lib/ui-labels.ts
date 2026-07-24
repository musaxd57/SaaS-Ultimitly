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

// AI-authored messages surface as the live brand "Lixus AI". The DECISION is the
// reliable authorType (senderName is a display/audit name only, never a classifier);
// the legacy "GuestOps AI" storage string is the transitional fallback for rows whose
// authorType is still NULL. Guest / host names pass through unchanged.
export function displaySenderName(senderName: string, authorType?: string | null): string {
  const isAi = authorType ? authorType === "ai" : senderName === "GuestOps AI";
  return isAi ? "Lixus AI" : senderName;
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

// Faz-B: WHY-risky label (closed set) → short host-facing Turkish.
const RISK_TYPE_LABELS: Record<string, string> = {
  complaint: "şikayet",
  money_refund: "para / iade talebi",
  cancellation: "iptal / erken ayrılma",
  human_request: "insan talebi",
  review_threat: "kötü yorum tehdidi",
  platform_policy: "platform dışı işlem",
  safety_emergency: "güvenlik / acil durum",
  discrimination: "ayrımcılık içeriği",
  rule_violation: "kural ihlali sinyali",
  access_security: "giriş / erişim sorunu",
  prompt_injection: "şüpheli talimat (injection)",
};
export function riskTypeLabel(t: string | null | undefined): string | null {
  return t ? (RISK_TYPE_LABELS[t] ?? null) : null;
}

// Faz-B evidence: "kb:wifi" → "Bilgi tabanı: Wi-Fi" etc. Unknown shapes pass through.
const KB_TR: Record<string, string> = {
  wifi: "Wi-Fi", checkin: "Giriş Talimatı", checkout: "Çıkış Mesajı", welcome: "Karşılama",
  location: "Konum", rules: "Ev Kuralları", parking: "Otopark", trash: "Çöp",
  cleaning: "Temizlik", faq: "SSS", local_tips: "Yerel Tavsiye", general: "Genel",
};
const PROP_TR: Record<string, string> = {
  checkInTime: "Giriş saati", checkOutTime: "Çıkış saati", address: "Adres",
  name: "Daire adı", city: "Şehir",
};
const RES_TR: Record<string, string> = {
  guestName: "Misafir adı", arrivalDate: "Giriş tarihi", departureDate: "Çıkış tarihi",
  status: "Rezervasyon durumu",
};
export function sourceLabel(src: string): string {
  if (src.startsWith("kb:")) return `Bilgi tabanı: ${KB_TR[src.slice(3)] ?? src.slice(3)}`;
  if (src.startsWith("property:")) return PROP_TR[src.slice(9)] ?? src;
  if (src.startsWith("reservation:")) return `Rezervasyon: ${RES_TR[src.slice(12)] ?? src.slice(12)}`;
  if (src === "history") return "Önceki yazışma";
  return src;
}

/**
 * The evidence entries worth SHOWING. The guest's name is used by practically
 * every reply (the greeting), so listing it as "context" is noise that only
 * confuses — it is dropped from display while staying intact in the data
 * (Message.aiSourcesJson / export) for audit.
 */
export function displayableSources(srcs: string[]): string[] {
  return srcs.filter((s) => s !== "reservation:guestName");
}
