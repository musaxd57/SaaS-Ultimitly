import { timingSafeEqual } from "node:crypto";

// ---------------------------------------------------------------------------
// WhatsApp Cloud API web kancası — yapılandırma ve abonelik el sıkışması (tasarım §5.1, §9 madde 10). SAF; rota dosyası yalnız bilinen rota
// alanlarını dışa aktarabildiği için ayrı modülde.
//  · Uç ancak uygulama gizli anahtarı (imza) VE numara kimliği (teslimatın bizim numaramıza ait olduğunun denetimi) varken çalışır; biri
//    eksikse `null` → rota uyur ve alarm verir (sessiz kayıp yok).
//  · El sıkışma: Meta `hub.mode=subscribe`, `hub.verify_token`, `hub.challenge` gönderir; belirteç sabit sürede karşılaştırılır, boş belirteç
//    hiçbir zaman eşleşmez (iki boş dize "eşit" sayılmasın). Yansıtılan `challenge` dar karakter kümesinde ve kısa.
// ---------------------------------------------------------------------------

export interface WhatsAppWebhookConfig {
  appSecret: string;
  /** Abonelik doğrulama belirteci; yoksa el sıkışma her zaman reddedilir. */
  verifyToken: string | null;
  /** Bizim numaramızın Meta kimliği — teslimattaki `phone_number_id` buna eşit olmalı. */
  phoneNumberId: string;
}

export function whatsAppWebhookConfigFromEnv(env: Record<string, string | undefined> = process.env): WhatsAppWebhookConfig | null {
  const appSecret = env.WHATSAPP_APP_SECRET?.trim();
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  if (!appSecret || !phoneNumberId || !/^\d{5,20}$/.test(phoneNumberId)) return null;
  return { appSecret, verifyToken: env.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim() || null, phoneNumberId };
}

const CHALLENGE = /^[A-Za-z0-9_-]{1,128}$/;

/** El sıkışma doğruysa yansıtılacak `challenge`, değilse `null` (çağıran 403 döner, `challenge`ı yansıtmaz). */
export function verifyWhatsAppHandshake(
  query: { mode: string | null; token: string | null; challenge: string | null },
  verifyToken: string | null,
): string | null {
  if (!verifyToken || query.mode !== "subscribe" || !query.token || !query.challenge) return null;
  if (!CHALLENGE.test(query.challenge)) return null;
  const given = Buffer.from(query.token, "utf8");
  const expected = Buffer.from(verifyToken, "utf8");
  return given.length === expected.length && timingSafeEqual(given, expected) ? query.challenge : null;
}

/**
 * İmza başlığı Meta'nınkine BENZİYOR mu (`sha256=` + 64 onaltılık). Alarm yalnız bu durumda: gerçek bir Meta teslimatı yanlış anahtarla
 * doğrulanmıyor demektir; sıradan tarayıcı gürültüsü alarm yazmaz (ödeme web kancasının deseni).
 */
export function looksLikeMetaSignature(header: string | null | undefined): boolean {
  return !!header && /^sha256=[0-9a-f]{64}$/i.test(header.trim());
}
