// ---------------------------------------------------------------------------
// AIRBNB MESAJ KURALI — platform dışı iletişim (kurucu 10-22, T-d / U1: "o misafire gidecek mesajı airbnb durdurmayacağına emin olalım
// … airbnb bununla ilgili birşey yayınlamış olabilir kontrol et"). Kaynaklar, örnekler ve öğretim seti: `docs/AIRBNB-MESAJ-KURALLARI.md`
// + `evals/airbnb-message-policy.json`.
//
// Bu bir YETENEK kararı DEĞİL (değişmez 20 — gönderilebilirlik kanal etiketinden çıkmaz; `capability.ts`). Misafirin gördüğü kanalın İÇERİK
// kuralıdır: Airbnb telefon / e-posta / bağlantı / sosyal medya içeren mesajı rezervasyon ONAYINDAN önce ve çıkıştan sonraki kısa pencere
// bittikten sonra engeller (Yardım Merkezi 4155 + 147; entegre mesajlaşma için Guesty'nin aktardığı kural: çıkıştan sonra ~1 gün). Engellenen
// mesaj misafire ulaşmaz ve tekrarı hesabı riske atar → kıdemli okuyucu (`semantic/absence-judge.ts`) "platform dışı iletişim" dediğinde
// bu pencerelerde cevap otomatik GİTMEZ, ev sahibinde taslak kalır. Onaylı konaklama süresince iletişim bilgisi serbest (Airbnb de paylaşır).
// Saf; veritabanı yok.
// ---------------------------------------------------------------------------

/** Çıkıştan sonra Airbnb'nin iletişim bilgisine izin verdiği pencere (ikinci el kaynak "genelde bir gün" — dar tutulur). */
export const AIRBNB_POST_CHECKOUT_CONTACT_GRACE_MS = 24 * 60 * 60 * 1000;

export interface ContactPolicyConversation {
  channel: string | null | undefined;
  reservation?: { status?: string | null; departureDate?: Date | null } | null;
}

/**
 * Bu konuşmada "platform dışı iletişim" içeren cevap tutulur mu? Yalnız Airbnb kanalında; onaylı (ya da tamamlanmış) rezervasyon yoksa
 * (ön soru, talep, iptal) ya da çıkışın üzerinden bir günden fazla geçtiyse → evet. Çıkış tarihi bilinmiyorsa onaylı konaklama serbest.
 */
export function offPlatformContactHoldsFor(conversation: ContactPolicyConversation, now: Date = new Date()): boolean {
  if (conversation.channel !== "airbnb") return false;
  const status = conversation.reservation?.status;
  if (status !== "confirmed" && status !== "completed") return true;
  const departure = conversation.reservation?.departureDate;
  if (!departure) return false;
  return now.getTime() > departure.getTime() + AIRBNB_POST_CHECKOUT_CONTACT_GRACE_MS;
}
