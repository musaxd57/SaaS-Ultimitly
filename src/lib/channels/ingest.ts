import type { OutboundProvider } from "./outbound";
import type { ChannelProviderId } from "./providers";
import type { ChannelSenderRole } from "@/lib/message-author";

// ---------------------------------------------------------------------------
// INGEST CONTRACT — Channel Layer'ın OKUMA yönü (V0.6)
//
// Çekirdek (ingest write service, automation, AI) sağlayıcı payload'ını GÖRMEZ:
// her adaptör sağlayıcıdan okuduğunu burada tanımlı CANONICAL tiplere çevirir
// (değişmez #7: payload → doğrulama/normalizasyon → canonical). Kurallar:
//   · Adaptör DEDUPE YAPMAZ, SIRALAMAZ, çıkarım yapmaz: sağlayıcının verdiğini
//     canonical şekle çevirip aynen aktarır (tekilleştirme/sıralama/idempotency
//     çekirdeğin — write service'in — işi; outbound'daki "sağlayıcı dedupe yapmaz"
//     kuralının aynası).
//   · Hata sınıfları TİPLİ (`IngestError.kind`), metin regex'i yok; 401/403 =
//     auth_revoked (V0.3 yaşam döngüsü), 402 = blocked (sağlayıcı hesabı askıda;
//     giden yöndeki sınıfla AYNI sözcük), 429 = rate_limited, 5xx/ağ = outage,
//     404 = not_found. Kimlik bilgisi yoksa AĞA ÇIKILMAZ (no_credential).
//   · 🚨 Çağıran hatayı `instanceof HospitableError` ile OKUMAZ — adaptör sarar;
//     sarmaldan bağımsız okuma `@/lib/provider-errors` (09-23 olayı, sınıf pini
//     `tests/unit/provider-error-wrapper-pin.test.ts`).
//   · Hata metni kimlik bilgisini taşımaz.
//   · Kiracı sınırı sağlayıcıda da vardır: token hangi mülkü/rezervasyonu
//     görebiliyorsa onu döner; adaptör bunu genişletemez.
// Conformance kiti (tests/helpers/ingest-conformance.ts) fake VE gerçek adaptöre
// aynı senaryoları koşar. ⚠️ Gerçek adaptör yalnız HTTP stub'ıyla sınanır; bu,
// canlı sağlayıcı doğrulaması DEĞİLDİR.
// ---------------------------------------------------------------------------

export type IngestCapability = "properties.read" | "reservations.read" | "messages.read";

// Tip parametresi: bkz. outbound.ts — varsayılan canlı küme, mevcut kullanımlar birebir aynı.
export interface IngestCredential<P extends ChannelProviderId = OutboundProvider> {
  provider: P;
  /** Ham token; undefined = istemci env fallback'i (kurucu legacy yolu, V0.7'ye kadar). */
  token: string | undefined;
}

export interface CanonicalProperty {
  externalId: string;
  name: string | null;
}

export type CanonicalReservationStatus = "pending" | "confirmed" | "cancelled" | "completed";

export interface CanonicalGuest {
  /** Sağlayıcının kişi-sabit kimliği (Hospitable guest.id); yoksa null. */
  externalId: string | null;
  name: string | null;
  /**
   * Kanalın AYRI ad alanı (hitap adı; migration 57, K10-o 09-28) — yoksa null/undefined. Tam adın bölünmesiyle ÜRETİLMEZ.
   * Misafirin yazdığı metindir: hitap içindir, olgu / talimat değildir.
   */
  givenName?: string | null;
  email: string | null;
  phone: string | null;
}

export interface CanonicalReservation {
  externalId: string;
  code: string | null;
  /** Kanal etiketi (airbnb | booking | vrbo | direct | other | ham sağlayıcı değeri). Yetenek buradan ÇIKARILMAZ (değişmez #20). */
  channel: string;
  status: CanonicalReservationStatus;
  arrivalDate: Date | null;
  departureDate: Date | null;
  guest: CanonicalGuest;
  totalAmount: number | null;
  currency: string | null;
  conversationExternalId: string | null;
  conversationLanguage: string | null;
  /** Sağlayıcının thread'deki son mesaj zamanı (skip-check imleci); null = thread yok. */
  lastMessageAt: Date | null;
  /** "Bu konaklama bir daha yaşanmayacak" (iptal/reddedildi/bitti) — çit ve oto-yanıt kapısı. */
  terminal: boolean;
  /**
   * Sağlayıcının HAM platform adı (migration 60 B; `sourcePlatformOf` ile dar alfabeye indirilmiş). Yalnız gösterim / teşhis —
   * yetenek ASLA buradan çıkarılmaz (değişmez #20). Yoksa null.
   */
  sourcePlatform?: string | null;
}

export interface CanonicalMessage {
  /** Sağlayıcı mesaj kimliği; null = kimliksiz (dedupe edilemez, çekirdek sayar). */
  externalId: string | null;
  direction: "inbound" | "outbound";
  senderName: string | null;
  /** null/boş = gövdesiz sağlayıcı mesajı (çekirdek `unimportable` sayar, atlar). */
  body: string | null;
  createdAt: Date | null;
  /**
   * Kanalın bildirdiği gönderen rolü (L5, migration 71): guest · host (insan) · automation (kanalın kendi şablonu / zamanlanmış / yapay zekâ
   * mesajı) · unknown (alan var, değer tanınmadı). İsteğe bağlı: bildirmeyen adaptör `undefined` / null döner (bugünkü davranış). Sağlayıcı alan
   * adı çekirdeğe GİRMEZ — eşleme adaptörde; çekirdek yalnız kapalı kümeyi ve yönle tutarlılığı doğrular (`canonicalChannelSenderRole`).
   */
  senderRole?: ChannelSenderRole | null;
}

export interface ReservationWindow {
  propertyExternalId: string;
  /** YYYY-MM-DD */
  startDate: string;
  /** YYYY-MM-DD */
  endDate: string;
}

/**
 * `blocked` = sağlayıcı hesabı API erişimine yetkili DEĞİL (Hospitable 402
 * "Subscription not active"): KALICI, org'un kendi faturasına bağlı, Lixus
 * arızası değil. 09-23'e kadar bu sınıf YOKTU ve 402 `unknown`a düşüyordu →
 * çağıranın "beklenen durum" dalı ölüydü, her senkron geçişi alarm e-postası.
 */
export type IngestErrorKind =
  | "auth_revoked"
  | "blocked"
  | "rate_limited"
  | "outage"
  | "not_found"
  | "no_credential"
  /** Yetenek bu sağlayıcı için uygulanmadı (sözleşme aşaması) ya da bağlantıya verilmedi —
   *  AĞA HİÇ ÇIKILMADI. `no_credential`den ayrı: bağlantı olsa da sonuç değişmez. */
  | "unsupported"
  | "unknown";

export class IngestError extends Error {
  readonly kind: IngestErrorKind;
  readonly status: number | undefined;
  readonly provider: ChannelProviderId;
  readonly retryAfterSec: number | undefined;
  constructor(provider: ChannelProviderId, kind: IngestErrorKind, message: string, status?: number, retryAfterSec?: number) {
    super(message);
    this.name = "IngestError";
    this.provider = provider;
    this.kind = kind;
    this.status = status;
    this.retryAfterSec = retryAfterSec;
  }
}

export interface IngestAdapter<P extends ChannelProviderId = OutboundProvider> {
  readonly provider: P;
  readonly capabilities: ReadonlySet<IngestCapability>;
  listProperties(credential: IngestCredential<P>): Promise<CanonicalProperty[]>;
  listReservations(credential: IngestCredential<P>, window: ReservationWindow): Promise<CanonicalReservation[]>;
  listMessages(credential: IngestCredential<P>, reservationExternalId: string): Promise<CanonicalMessage[]>;
}

const registry = new Map<OutboundProvider, IngestAdapter>();
const testOverrides = new Map<OutboundProvider, IngestAdapter>();

export function registerIngestAdapter(adapter: IngestAdapter): void {
  registry.set(adapter.provider, adapter);
}

export function getIngestAdapter(provider: OutboundProvider): IngestAdapter | undefined {
  return testOverrides.get(provider) ?? registry.get(provider);
}

/** TEST-ONLY: sağlayıcıyı fake ile değiştir (null = geri al). */
export function __setIngestAdapterForTest(provider: OutboundProvider, adapter: IngestAdapter | null): void {
  if (adapter) testOverrides.set(provider, adapter);
  else testOverrides.delete(provider);
}

// ---- Canonical normalizasyon yardımcıları (sağlayıcı-nötr; adaptörler kullanır) ----

/**
 * Sağlayıcı dizesinin tek girişi. NUL (U+0000) silinir (09-28): PostgreSQL `text` onu saklayamaz — NUL taşıyan ad / mesaj gövdesi
 * o rezervasyonun yazmasını HER senkronda düşürüyordu. Başka hiçbir karaktere dokunulmaz.
 */
export function canonicalStr(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.includes("\u0000") ? value.replaceAll("\u0000", "") : value;
  return v.length ? v : null;
}

/**
 * Sağlayıcı tarihi. 🚨 Y6 (Codex 10-07): yalnız ISO 8601 biçimi ("2026-10-10", "2026-10-10T15:00:00Z", "…+03:00") ve TAKVİMDE OLAN
 * gün — eskiden çıplak `new Date()` "2026-02-30"u 2 Mart'a, "1"i 2001'e çeviriyordu (uydurma konaklama). Biçimin geri kalanı (saat,
 * kesir, dilim) eskisi gibi `Date`e bırakılır: canlı sağlayıcının gönderdiği geçerli biçimler değişmez.
 */
export function canonicalDate(value: unknown): Date | null {
  const s = canonicalStr(value);
  if (!s) return null;
  const head = /^(\d{4})-(\d{2})-(\d{2})(?=$|[Tt ])/.exec(s);
  if (!head) return null;
  const [y, m, d] = [Number(head[1]), Number(head[2]), Number(head[3])];
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (m < 1 || m > 12 || probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  const at = new Date(s);
  return Number.isNaN(at.getTime()) ? null : at;
}

const SOURCE_PLATFORM_RE = /^[a-z0-9][a-z0-9._-]{0,39}$/;

/** Ham platform dizesi → saklanabilir etiket (küçük harf, dar alfabe, ≤ 40). Uymayan → null (uydurma yok). Saf. */
export function sourcePlatformOf(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase().replace(/\s+/g, "_");
  return SOURCE_PLATFORM_RE.test(v) ? v : null;
}
