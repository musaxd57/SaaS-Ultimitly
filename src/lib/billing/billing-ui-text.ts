// ---------------------------------------------------------------------------
// ÖDEME EKRANI METİNLERİ (kurucu K3, 10-17: "ÖDEME EKRANI hata metinlerini düzenleyelim bol bol"). Tek kaynak: ödeme kartı (paddle-plans)
// bu sabitleri ve `billingReason`ı kullanır; saf, istemci + sunucu güvenli (sır / sunucu modülü yok).
// Kurallar (CLAUDE.md "müşteriye giden metin sade"): teknik terim / sağlayıcının ham kodu yok; ne olduğu + ne yapacağı; "-in" hitabı;
// para işinde planın DEĞİŞİP DEĞİŞMEDİĞİ açıkça söylenir (müşteri "param çekildi mi?" diye düşünmesin).
// ---------------------------------------------------------------------------

export const BILLING_TEXT = {
  /** Ağ hatası (fetch düştü): sunucuya hiç ulaşılmadı. */
  network: "Bağlantı kurulamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.",
  /** Ödeme ekranı betiği (Paddle.js) indirilemedi. */
  checkoutLoadFailed: "Ödeme ekranı yüklenemedi. İnternet bağlantınızı kontrol edip sayfayı yenileyin.",
  /** Ödeme ekranı betiği indi ama başlatılamadı / açılamadı. */
  checkoutOpenFailed: "Ödeme ekranı açılamadı. Sayfayı yenileyip tekrar deneyin; sorun sürerse bize yazın.",
  /** Ön bilgilendirme onayı kaydı (ödeme öncesi yasal kanıt) sunucuda yazılamadı. */
  consentFailed: "Onayınız kaydedilemedi, ödeme başlatılmadı. Lütfen tekrar deneyin.",
  consentRequired: "Devam etmek için Ön Bilgilendirme Formu ve Mesafeli Satış Sözleşmesi’ni onaylayın.",
  portalFailed: "Abonelik yönetim sayfası açılamadı. Lütfen tekrar deneyin.",
  previewFailed: "Plan bilgisi alınamadı. Lütfen tekrar deneyin.",
  changeFailed: "Plan değişikliği yapılamadı; planınız değişmedi. Lütfen tekrar deneyin.",
  changePending: "İşleminiz alındı, onay bekleniyor. Planınız birkaç dakika içinde güncellenecek.",
  amountChanged: "Tutar değişti. Yeni tutarı kontrol edip yeniden onaylayın.",
  /** Yıllık dönem seçiliyken panelden plan değişikliği yapılamaz (sunucu da reddeder) — düğmeler neden kapalı. */
  annualChangeViaSupport: "Yıllık ödemeye geçmek için bize yazın, birlikte halledelim.",
  /** Sunucunun `priceId` alan hatası (istemci eski fiyat kimliğiyle geldi). */
  priceStale: "Plan fiyatı doğrulanamadı. Lütfen sayfayı yenileyip tekrar deneyin.",
} as const;

/** `badRequest` gövdesinin genel başlığı — tek başına sebep değildir (asıl sebep `fields` altında). */
const GENERIC_VALIDATION_TITLE = "Doğrulama hatası";

/**
 * Sunucu yanıtından müşteriye gösterilecek SEBEP. `badRequest({ error })` gövdeyi `{ error: "Doğrulama hatası", fields: { error: "…" } }`
 * diye kurar; yalnız `data.error` okunduğunda müşteri her retde "Doğrulama hatası" görüyordu (K3 envanteri C1: plan değişikliği uygulama
 * adımı, abonelik yönetimi, onay kaydı). Sıra: alan sebebi → genel başlık DEĞİLSE sunucu metni (429, 500 takip numaralı metin, 409 / 503) →
 * çağıranın yedek metni.
 */
export function billingReason(
  data: { error?: unknown; fields?: Record<string, unknown> } | null | undefined,
  fallback: string,
): string {
  const fields = data?.fields ?? {};
  const field = (k: string) => (typeof fields[k] === "string" && (fields[k] as string).trim() ? (fields[k] as string) : undefined);
  const fromField = field("error") ?? field("_") ?? field("planCode") ?? (field("priceId") ? BILLING_TEXT.priceStale : undefined);
  if (fromField) return fromField;
  const error = typeof data?.error === "string" ? data.error.trim() : "";
  if (error && error !== GENERIC_VALIDATION_TITLE) return error;
  return fallback;
}

/** Erişimi kapalı aboneliğin durum etiketi (sınırlı mod bandıyla aynı dil — `limited-mode-banner.tsx`). */
export function lapsedLabel(status: string | null | undefined): string {
  switch (status) {
    case "past_due":
      return "son ödemeniz alınamadı";
    case "paused":
      return "aboneliğiniz duraklatıldı";
    case "canceled":
      return "aboneliğiniz iptal edildi";
    default:
      return "aboneliğiniz aktif değil";
  }
}
