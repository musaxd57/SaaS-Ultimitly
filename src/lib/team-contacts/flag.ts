// EKİP KİŞİSİ anahtarı (T3). YAPRAK modül. VARSAYILAN KAPALI; yalnız "1" açar (`scripts/env-check.mjs` STRICT_ONE_FLAGS).
// Kapalıyken: ekip kişisi eklenemez, kod üretilmez, personel numarasına gelen WhatsApp mesajı işlenmez. Kapalıyken de KALAN kurallar
// (giriş yapamayan kullanıcıyı giriş / şifre sıfırlama / görev e-postasında reddetmek) çalışır — veri bir kez yazıldıysa korunur.

export function teamContactsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.TEAM_CONTACTS_ENABLED === "1";
}

/** Temizlikçilerin yazacağı ayrı WhatsApp numarasının Meta numara kimliği (K-3) — ev sahibi numarasından (`WHATSAPP_PHONE_NUMBER_ID`) farklı. */
export function teamPhoneNumberId(env: Record<string, string | undefined> = process.env): string | null {
  const v = env.TEAM_WHATSAPP_PHONE_NUMBER_ID?.trim();
  if (!v || !/^\d{5,20}$/.test(v)) return null;
  if (v === env.WHATSAPP_PHONE_NUMBER_ID?.trim()) return null; // aynı numara = yapılandırma hatası; ev sahibi akışı korunur
  return v;
}

/** `wa.me` bağlantısı için temizlikçi numarası (E.164, görünür). */
export function teamWhatsAppNumber(env: Record<string, string | undefined> = process.env): string | undefined {
  return env.TEAM_WHATSAPP_NUMBER?.trim() || undefined;
}
