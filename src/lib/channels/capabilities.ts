import type { OutboundDestination } from "./outbound";
import type { ChannelProviderId } from "./providers";

// ---------------------------------------------------------------------------
// KANAL YETENEK SÖZLEŞMESİ (değişmez 4) — saf tipler, çalışma zamanı etkisi yok.
//
// Tek "her şeyi yapan" ChannelAdapter YOK: her sağlayıcı yeteneklerini AYRI ayrı ve
// DURUMUYLA ilan eder (`manifests.ts`). Bugünkü çalışma zamanı kapısı adaptörlerin kendi
// `capabilities` kümesidir (`dispatchOutbound` ona bakar); manifesto onun İLANIDIR ve
// iki kaynağın ayrışmaması test-pinlidir (`tests/unit/channel-manifest.test.ts`).
// 🚨 Manifestoya dispatch içinde BAKILMAZ: yanlış bir manifesto satırı canlı gönderimi
// sessizce durdurmasın — parite pini yeter.
//
// Yetenek ASLA kanal etiketinden (`Reservation.channel = "airbnb"`) çıkarılmaz (değişmez 20);
// etkin yetenek = manifesto `supported` ∧ bağlantı aktif ∧ (ileride) kapsam verilmiş.
// ---------------------------------------------------------------------------

export const CHANNEL_CAPABILITIES = [
  "connection.lifecycle",
  "properties.read",
  "reservations.read",
  "messages.read",
  "messages.send",
  "messages.reconcile",
  "webhooks.receive",
  "availability.read",
  "availability.write",
  "rates.read",
  "rates.write",
  "reviews.read",
  "reviews.respond",
] as const;
export type ChannelCapabilityId = (typeof CHANNEL_CAPABILITIES)[number];

/**
 * Lixus'un bu sağlayıcı için UYGULAMA durumu — "sağlayıcı bunu sunuyor mu" DEĞİL.
 *   supported   = çalışan kod var ve canlı yolda kullanılıyor
 *   planned     = Lixus bu yeteneği bekliyor; sözleşmesi yazılı, kodu yok
 *   unavailable = bu kaynak için yapılmayacak / yapılamaz
 */
export type CapabilityStatus = "supported" | "planned" | "unavailable";

/** Çalışan kodun NEREDE yaşadığı. `supported` ⇒ `none` olamaz. Değişmez-4 borcunu gizlemez. */
export type CapabilityBoundary = "channel_layer" | "legacy_provider_module" | "native_ingest" | "none";

export interface CapabilityDeclaration {
  readonly status: CapabilityStatus;
  readonly boundary: CapabilityBoundary;
  readonly note: string;
}

/** Değişmez 14: sağlayıcı kaynaklı veri, host/Lixus verisinden POLİTİKA düzeyinde ayrı tutulur. */
export const DATA_CLASSES = [
  "listing_content",
  "reservation_snapshot",
  "guest_contact",
  "message_body",
  "review_text",
  "derived_signal",
] as const;
export type DataClass = (typeof DATA_CLASSES)[number];

/** Sağlayıcının API şartları okunmadan karar VERİLEMEZ — canlıya alma kapısı bunu arar. */
export const REQUIRES_TERMS_REVIEW = "requires_terms_review" as const;
type TermsReview = typeof REQUIRES_TERMS_REVIEW;

export interface DataClassPolicy {
  readonly retention: "org_retention_window" | "until_disconnect" | TermsReview;
  readonly onDisconnect: "retain" | "purge" | "anonymize" | TermsReview;
  /** Intelligence/hafıza türetmesinde kullanım. */
  readonly derivation: "tenant_scoped" | "forbidden" | TermsReview;
  readonly export: "included" | "excluded" | TermsReview;
  /** Kiracılar arası kullanım: sabit, her kaynak için YASAK. */
  readonly crossTenantUse: "forbidden";
}

/** Değişmez 19: rollout sırası. */
export type RolloutStage =
  | "contract_only"
  | "sandbox"
  | "internal"
  | "pilot"
  | "shadow"
  | "cutover"
  | "live_bridge"
  | "frozen"
  | "native";

export interface ChannelManifest {
  readonly source: ChannelProviderId | "ical";
  readonly stage: RolloutStage;
  readonly capabilities: Readonly<Record<ChannelCapabilityId, CapabilityDeclaration>>;
  readonly dataPolicy: Readonly<Record<DataClass, DataClassPolicy>>;
}

// ---------------------------------------------------------------------------
// Henüz hiçbir sağlayıcının UYGULAMADIĞI yetenekler için Lixus'un KENDİ (sağlayıcı-nötr)
// giriş/çıkış şekilleri. Sağlayıcı protokolü (URL, alan adı, imza şeması) BURADA YOK
// (değişmez 18) — adaptör kendi protokolünü bu şekillere çevirir.
// ---------------------------------------------------------------------------

/** Belirsiz gönderimin (ambiguous) sonradan doğrulanması — kör yeniden gönderim YOK (değişmez 8). */
export interface ReconcileProbe {
  destination: OutboundDestination<ChannelProviderId>;
  idempotencyKey: string;
  sentAfter: Date;
  bodySha256: string;
}
export type ReconcileVerdict =
  | { found: true; providerMessageId: string }
  | { found: false; reason: "not_found" | "no_reliable_signal" };

/** Ham webhook zarfı: imza gövde AYRIŞTIRILMADAN önce ham gövde üzerinde doğrulanır. */
export interface InboundWebhookEnvelope {
  rawBody: string;
  headers: Readonly<Record<string, string>>;
  receivedAt: Date;
}
/** Webhook yalnız "şu varlık değişti" İPUCUDUR; gerçek veri aynı yazma servisinden okunur (değişmez 7). */
export interface CanonicalChangeHint {
  entity: "property" | "reservation" | "message";
  externalId: string;
  /** Sıra dışı teslimde eskiyi yeniyle ezmemek için sağlayıcı sürümü (değişmez 17); yoksa null. */
  sourceVersion: string | null;
}
export type WebhookVerdict =
  | { ok: true; accountRef: string; eventRef: string; occurredAt: Date | null; changes: CanonicalChangeHint[] }
  | { ok: false; reason: "bad_signature" | "stale_or_replayed" | "unknown_account" | "malformed" | "not_implemented" };

export type ConnectionLifecycleSignal = "credential_rejected" | "refresh_due" | "provider_revoked" | "host_disconnected";
export type ConnectionLifecycleOutcome = "refreshed" | "revoked" | "disconnected" | "unchanged";
