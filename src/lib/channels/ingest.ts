import type { OutboundProvider } from "./outbound";

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
//     auth_revoked (V0.3 yaşam döngüsü), 429 = rate_limited, 5xx/ağ = outage,
//     404 = not_found. Kimlik bilgisi yoksa AĞA ÇIKILMAZ (no_credential).
//   · Hata metni kimlik bilgisini taşımaz.
//   · Kiracı sınırı sağlayıcıda da vardır: token hangi mülkü/rezervasyonu
//     görebiliyorsa onu döner; adaptör bunu genişletemez.
// Conformance kiti (tests/helpers/ingest-conformance.ts) fake VE gerçek adaptöre
// aynı senaryoları koşar. ⚠️ Gerçek adaptör yalnız HTTP stub'ıyla sınanır; bu,
// canlı sağlayıcı doğrulaması DEĞİLDİR.
// ---------------------------------------------------------------------------

export type IngestCapability = "properties.read" | "reservations.read" | "messages.read";

export interface IngestCredential {
  provider: OutboundProvider;
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
}

export interface CanonicalMessage {
  /** Sağlayıcı mesaj kimliği; null = kimliksiz (dedupe edilemez, çekirdek sayar). */
  externalId: string | null;
  direction: "inbound" | "outbound";
  senderName: string | null;
  /** null/boş = gövdesiz sağlayıcı mesajı (çekirdek `unimportable` sayar, atlar). */
  body: string | null;
  createdAt: Date | null;
}

export interface ReservationWindow {
  propertyExternalId: string;
  /** YYYY-MM-DD */
  startDate: string;
  /** YYYY-MM-DD */
  endDate: string;
}

export type IngestErrorKind = "auth_revoked" | "rate_limited" | "outage" | "not_found" | "no_credential" | "unknown";

export class IngestError extends Error {
  readonly kind: IngestErrorKind;
  readonly status: number | undefined;
  readonly provider: OutboundProvider;
  readonly retryAfterSec: number | undefined;
  constructor(provider: OutboundProvider, kind: IngestErrorKind, message: string, status?: number, retryAfterSec?: number) {
    super(message);
    this.name = "IngestError";
    this.provider = provider;
    this.kind = kind;
    this.status = status;
    this.retryAfterSec = retryAfterSec;
  }
}

export interface IngestAdapter {
  readonly provider: OutboundProvider;
  readonly capabilities: ReadonlySet<IngestCapability>;
  listProperties(credential: IngestCredential): Promise<CanonicalProperty[]>;
  listReservations(credential: IngestCredential, window: ReservationWindow): Promise<CanonicalReservation[]>;
  listMessages(credential: IngestCredential, reservationExternalId: string): Promise<CanonicalMessage[]>;
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

export function canonicalStr(value: unknown): string | null {
  return typeof value === "string" && value.length ? value : null;
}

export function canonicalDate(value: unknown): Date | null {
  const s = canonicalStr(value);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
