// ---------------------------------------------------------------------------
// Ev sahibinin bağlama kodunu bize göndermesi için bağlantı (tasarım §5.4): `wa.me/<numaramız>?text=<kod>`. SAF. Numaramız
// `WHATSAPP_BUSINESS_NUMBER` (ülke koduyla, yalnız rakam; boşluk / artı / tire kabul edilir). Yoksa `null` → Ayarlar kartı gösterilmez
// (ev sahibi kodu nereye göndereceğini bilemez).
// ---------------------------------------------------------------------------

export function whatsAppBusinessNumber(env: Record<string, string | undefined> = process.env): string | null {
  const digits = (env.WHATSAPP_BUSINESS_NUMBER ?? "").trim().replace(/^\+/, "").replace(/[\s().-]/g, "");
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
}

export function waMeLink(businessNumber: string, text: string): string {
  return `https://wa.me/${businessNumber}?text=${encodeURIComponent(text)}`;
}
