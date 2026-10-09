import "server-only";

import type { OutboundCredential, OutboundProvider } from "./outbound";

// ---------------------------------------------------------------------------
// KANAL ERİŞİMİ (V0.8) — kimlik bilgisi ve bağlantı durumu ENTEGRASYON SINIRINDA.
//
// Kurucu talimatı 2026-09-07, değişmez 4 / 9 / 20: "Credentials and connection lifecycle belong to the integration
// boundary, not arbitrary business logic." V0.8'e kadar çekirdek (otomatik cevap, ev sahibi cevabı, gönderim kuyruğu,
// hayalet rezervasyon temizliği) ve panel sayfaları sağlayıcının kimlik modülünü DOĞRUDAN çağırıyordu
// (`getOrgHospitableToken`, `handleProviderAuthFailure`, `getConnectionInfo`). Artık çekirdek yalnız bu sınırı bilir;
// sağlayıcıya özgü çözücü kendi dosyasında (`hospitable-access.ts`) kaydedilir — Airbnb Direct = yeni çözücü + bir
// `registerMessagingAccess` satırı, çekirdekte değişiklik yok.
//
// Davranış BİREBİR: Hospitable çözücüsü aynı üç fonksiyona aynı argümanlarla devreder (pin:
// `tests/unit/channel-access.test.ts`).
//
// 🚨 İKİNCİ SAĞLAYICI KAPISI: bugün kayıtlı TEK mesajlaşma sağlayıcısı var ve org düzeyindeki sorular ("bu org'un giden
// kimlik bilgisi ne?") onu yanıtlar. İkinci bir sağlayıcı kaydedildiği anda org düzeyinde soru belirsizdir (hangi
// konuşma hangi bağlantıda?) → fonksiyonlar KAPALI BAŞARISIZ olur (kimlik bilgisi yok / bağlı değil) ve hata kaydı
// düşer; doğru seçim o gün hedefin sağlayıcısından (`resolveOutboundRoute`) yapılır. Sessizce yanlış sağlayıcının
// kimlik bilgisini taşımak (kiracı / sağlayıcı karışması) bundan kötüdür.
// ---------------------------------------------------------------------------

export type CredentialRejectionOutcome = "refresh_forced" | "revoked" | "noop";

export interface MessagingAccess<P extends OutboundProvider = OutboundProvider> {
  readonly provider: P;
  /**
   * Org'un bu sağlayıcıdaki giden-mesaj kimlik bilgisi (düz erişim belirteci); kullanılabilir bağlantı yoksa null.
   * null = "bağlı değil": çağıran gönderimi ATLAR, başka bir org'un kimlik bilgisine asla düşmez.
   */
  credentialFor(organizationId: string): Promise<string | null>;
  /** Sağlayıcı bu kimlik bilgisini reddetti (HTTP 401 / 403) → yaşam döngüsü kararı. Asla fırlatmaz. */
  onCredentialRejected(organizationId: string, status: 401 | 403, rejectedToken: string): Promise<CredentialRejectionOutcome>;
  /** Panel için: bağlantı kurulu mu (SAKLI veriden; sağlayıcının sağlıklı çalıştığı anlamına GELMEZ). */
  isConnected(organizationId: string): Promise<boolean>;
}

const registered = new Map<OutboundProvider, MessagingAccess>();
const overrides = new Map<OutboundProvider, MessagingAccess>();

export function registerMessagingAccess(access: MessagingAccess): void {
  registered.set(access.provider, access);
}

/** Test kancası: kayıtlı çözücünün ÜSTÜNE geçici bir sahte koy (null = kaldır). */
export function __setMessagingAccessForTest(provider: OutboundProvider, access: MessagingAccess | null): void {
  if (access) overrides.set(provider, access);
  else overrides.delete(provider);
}

function accessFor(provider: OutboundProvider): MessagingAccess | null {
  return overrides.get(provider) ?? registered.get(provider) ?? null;
}

/** Org düzeyindeki sorunun TEK cevaplayıcısı; birden fazla sağlayıcı kayıtlıysa null (↑İKİNCİ SAĞLAYICI KAPISI). */
function soleMessagingAccess(): MessagingAccess | null {
  const providers = new Set<OutboundProvider>([...registered.keys(), ...overrides.keys()]);
  if (providers.size !== 1) return null;
  const [only] = providers;
  return accessFor(only);
}

/**
 * Org'un giden-mesaj kimlik bilgisi (sağlayıcısıyla birlikte); bağlı değilse null. Sağlayıcıya çağrı yalnız çözücünün
 * kendi kuralıyla (Hospitable: süresi dolmuş OAuth belirtecinin yenilenmesi) yapılır.
 */
export async function resolveOrgChannelCredential(organizationId: string): Promise<OutboundCredential | null> {
  const access = soleMessagingAccess();
  if (!access) return null;
  const token = await access.credentialFor(organizationId);
  return token ? { provider: access.provider, token } : null;
}

/** Reddedilen kimlik bilgisini SAĞLAYICISININ çözücüsüne iletir; çözücü yoksa hiçbir şey yapmaz. */
export async function handleOutboundCredentialRejected(
  organizationId: string,
  status: 401 | 403,
  rejected: OutboundCredential,
): Promise<CredentialRejectionOutcome> {
  const access = accessFor(rejected.provider);
  if (!access || !rejected.token) return "noop";
  return access.onCredentialRejected(organizationId, status, rejected.token);
}

/** Panel: org'un mesajlaşma bağlantısı kurulu mu (saklı veriden). */
export async function hasMessagingConnection(organizationId: string): Promise<boolean> {
  const access = soleMessagingAccess();
  if (!access) return false;
  return access.isConnected(organizationId);
}
