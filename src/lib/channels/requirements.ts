import type { SendResultKind } from "@/lib/outbox/state";
import type { CanonicalMessage, CanonicalReservation, IngestErrorKind } from "./ingest";

// ---------------------------------------------------------------------------
// LIXUS'UN DOĞRUDAN KANALDAN BEKLEDİKLERİ — Lixus'un KENDİ terimleriyle (değişmez 18).
//
// Burada uç nokta, alan adı, kimlik doğrulama akışı ya da imza şeması YOK: bunlar yalnız
// sağlayıcının sandbox'ı ve resmî dokümanından okunur. Bu dosya "adaptör neyi SAĞLAMALI"yı
// söyler; alan adları kanonik tiplere `satisfies` ile bağlı → kanonik bir alan yeniden
// adlandırılırsa sözleşme DERLENMEZ, yeni bir hata sınıfı eklenirse eşlemesi yazılmadan
// DERLENMEZ. İnsan-okur özeti: docs/AIRBNB-DIRECT-SOZLESMESI.md.
// ---------------------------------------------------------------------------

export const LIXUS_DIRECT_CHANNEL_REQUIREMENTS = {
  identity: {
    /** Değişmez 3: dış kimlik global/mülk-içi eşsiz SAYILMAZ; idempotency bağlantıyı içerir. */
    externalIdScope: ["connectionId", "entityType", "externalId"] as const,
    /** Webhook yönlendirme + kimlik kapsamı için bağlantı başına hesap referansı (bugün kolonu yok → canlı öncesi migration). */
    accountRefPerConnection: "required",
    /** Org başına birden çok hesap: `ChannelConnection @@unique([organizationId, provider])` bugün engelliyor. */
    multiAccountPerOrg: "required_before_pilot",
    /** Bugün bağlantı içermeyen, doğrudan kanal öncesi daraltılması gereken eşsizlikler. */
    knownUnscopedUniques: [
      "Property.hospitableId @unique",
      "Reservation (propertyId, sourceReference)",
      "Conversation (propertyId, externalReservationId)",
    ] as const,
    /** Değişmez 6: aynı ilanı iki kaynak beslerse tahminî birleştirme YOK — sahiplik/öncelik. */
    duplicateListingPolicy: "ownership_or_declared_priority_never_fuzzy_merge",
  },
  reservations: {
    required: ["externalId", "status", "arrivalDate", "departureDate", "terminal"] satisfies (keyof CanonicalReservation)[],
    /** Yoksa null kalır, asla uydurulmaz. */
    nullableNeverFabricated: ["guest", "totalAmount", "currency", "code"] satisfies (keyof CanonicalReservation)[],
    statusClosedSet: ["pending", "confirmed", "cancelled", "completed"] as const satisfies readonly CanonicalReservation["status"][],
    dateSemantics: "listing_local_calendar_date",
    /** Değişmez 20: kanal etiketi yalnız gösterimdir, yetenek ondan çıkarılmaz. */
    channelLabel: "display_only_never_capability",
    /** Değişmez 17: sıra dışı teslim için sağlayıcı sürümü gerekir; kanonik tipte bugün YOK. */
    ordering: "source_version_required_for_push",
    /** Webhook ipucundan sonra tek varlığı yeniden okuyabilmek; bugün yalnız pencere listesi var. */
    singleEntityRefetch: "required_for_webhook_hints",
  },
  messages: {
    required: ["externalId", "direction", "createdAt", "body"] satisfies (keyof CanonicalMessage)[],
    /** Sistem olayları bağlamdan dışlanabilmeli; kanonik tipte bugün yalnız `direction` var. */
    authorRole: "guest_host_system_needed",
    missingIdOrBody: "counted_unimportable_never_invented",
  },
  send: {
    attemptPolicy: "single_shot_no_adapter_retry",
    /** Hedef, satırın DAMGALI bağlantısından çözülür — kanal etiketinden asla. */
    target: "resolved_from_row_connection_never_channel_label",
    /** `connectionId` NULL eski satırlar köprüde kalır. */
    legacyNullConnection: "routes_to_live_bridge",
    success: "provider_message_id_expected",
    /** Değişmez 8: belirsizde uzlaştırma ya da insan incelemesi; kör yeniden gönderim YOK. */
    ambiguous: "reconcile_or_review_never_blind_resend",
    providerIdempotencyKey: "desired_enables_reconcile",
  },
  errors: {
    outbound: {
      definitive_success: "Teslim edildi; sağlayıcı mesaj kimliği beklenir",
      definitive_failure: "Kesin ret (4xx, 408 hariç): hiçbir şey gönderilmedi",
      ambiguous: "5xx / 408 / zaman aşımı: teslim edilmiş olabilir → uzlaştırma ya da inceleme",
      rate_limited: "Retry-After iletilir, deneme hakkı tüketilmez",
      blocked: "Hesap API erişimine yetkili değil: kalıcı, org'un kendi durumu",
      auth_revoked: "Bağlantı yaşam döngüsü: satır bekletilir, bağlantı yenilenir ya da iptal edilir",
    } satisfies Record<SendResultKind, string>,
    ingest: {
      auth_revoked: "Kimlik bilgisi reddedildi → yaşam döngüsü",
      blocked: "Hesap erişime yetkili değil (kalıcı)",
      rate_limited: "Bekle, Retry-After'a uy",
      outage: "Geçici erişim sorunu → sonraki geçişte yeniden dene",
      not_found: "Varlık yok ya da bu bağlantıya görünmüyor",
      no_credential: "Bağlantı yok: ağa çıkılmaz",
      unsupported: "Yetenek uygulanmadı ya da verilmedi: ağa çıkılmaz",
      unknown: "Sınıflandırılamayan: tipli değil, alarm ile görünür",
    } satisfies Record<IngestErrorKind, string>,
    errorTextNeverCarriesCredential: true,
  },
  rateLimit: {
    reads: "idempotent_retry_within_total_budget",
    writes: "single_shot",
    retryAfter: "seconds_propagated",
    perConnectionThrottle: "required",
  },
  webhooks: {
    verify: "signature_over_raw_body_before_parse",
    replay: "timestamp_or_nonce_window",
    eventIdempotency: ["connectionId", "eventRef"] as const,
    /** Kiracı, DOĞRULANMIŞ hesap referansından çözülür — gövdedeki org alanından asla. */
    tenant: "verified_account_ref_to_connection_never_payload_org",
    unknownAccount: "drop_and_count_never_create",
    /** Değişmez 7: çekme ile webhook AYNI yazma servisinden geçer. */
    processing: "ack_fast_then_same_write_service_as_polling",
  },
  lifecycle: {
    states: ["active", "disconnected", "revoked"] as const,
    neededStates: ["expired", "reauth_required", "degraded"] as const,
    /** Değişmez 9: kimlik bilgisi yalnız ChannelConnection üzerinde şifreli. */
    credential: "encrypted_blob_on_channel_connection_only",
    refresh: "cas_on_generation",
    /** Kapsamları sağlayıcı belirler; etkin yetenek = manifesto ∧ bağlantı aktif ∧ kapsam verilmiş. */
    grantedScopes: "stored_and_intersected_with_manifest",
  },
  /** Değişmez 14: veri sınıfı başına politika manifestoda; şartlar okunmadan hepsi `requires_terms_review`. */
  dataPolicy: "see_AIRBNB_DIRECT_MANIFEST_dataPolicy",
} as const;
