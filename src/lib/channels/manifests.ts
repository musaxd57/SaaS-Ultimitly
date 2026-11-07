import {
  CHANNEL_CAPABILITIES,
  DATA_CLASSES,
  REQUIRES_TERMS_REVIEW,
  type CapabilityBoundary,
  type CapabilityDeclaration,
  type CapabilityStatus,
  type ChannelCapabilityId,
  type ChannelManifest,
  type DataClass,
  type DataClassPolicy,
} from "./capabilities";
import type { ChannelProviderId } from "./providers";

// ---------------------------------------------------------------------------
// KAYNAK MANİFESTOLARI — her veri kaynağının yeteneklerini ve veri politikasını İLAN eder.
//
// Hospitable manifestosu adaptör nesnelerinin ÜZERİNDE değil burada durur: canlı
// `hospitable-*.ts` dosyaları bu dilimde bayt-bayt aynı kalır. Adaptörün çalışma zamanı
// `capabilities` kümesi ile buradaki `supported` kümesi PARİTE pinlidir.
// Hospitable veri politikası BETİMLEYİCİDİR (bugünkü kodun yaptığı): saklama org penceresi
// (`DATA_RETENTION_MONTHS` süpürgesi), bağlantı kesilince veri KALIR (yalnız token silinir —
// `clearOrgHospitableToken`), dışa aktarmaya girer (`data-export.ts`), türetme kiracı içinde.
// Airbnb Direct politikası "şartlar okunmadan karar yok": canlıya alma kapısı (test) hiçbir
// `supported` yeteneği olan kaynakta `requires_terms_review` kalmasına izin vermez.
// ---------------------------------------------------------------------------

const d = (status: CapabilityStatus, boundary: CapabilityBoundary, note: string): CapabilityDeclaration => ({
  status,
  boundary,
  note,
});

function allCapabilities(
  fallback: CapabilityDeclaration,
  explicit: Partial<Record<ChannelCapabilityId, CapabilityDeclaration>>,
): Record<ChannelCapabilityId, CapabilityDeclaration> {
  const out = {} as Record<ChannelCapabilityId, CapabilityDeclaration>;
  for (const id of CHANNEL_CAPABILITIES) out[id] = explicit[id] ?? fallback;
  return out;
}

function allDataClasses(policy: DataClassPolicy): Record<DataClass, DataClassPolicy> {
  const out = {} as Record<DataClass, DataClassPolicy>;
  for (const c of DATA_CLASSES) out[c] = policy;
  return out;
}

const RETAINED_IN_ORG: DataClassPolicy = {
  retention: "org_retention_window",
  onDisconnect: "retain",
  derivation: "tenant_scoped",
  export: "included",
  crossTenantUse: "forbidden",
};

const TERMS_REVIEW: DataClassPolicy = {
  retention: REQUIRES_TERMS_REVIEW,
  onDisconnect: REQUIRES_TERMS_REVIEW,
  derivation: REQUIRES_TERMS_REVIEW,
  export: REQUIRES_TERMS_REVIEW,
  crossTenantUse: "forbidden",
};

export const HOSPITABLE_MANIFEST: ChannelManifest = {
  source: "hospitable",
  stage: "live_bridge",
  capabilities: allCapabilities(d("unavailable", "none", "Köprüde yapılmayacak"), {
    "connection.lifecycle": d(
      "supported",
      "legacy_provider_module",
      "hospitable-credentials.ts + hospitable-oauth.ts — kanal katmanı DIŞINDA (değişmez 4 borcu)",
    ),
    "properties.read": d("supported", "channel_layer", "hospitable-ingest.ts"),
    "reservations.read": d("supported", "channel_layer", "hospitable-ingest.ts"),
    "messages.read": d("supported", "channel_layer", "hospitable-ingest.ts"),
    "messages.send": d("supported", "channel_layer", "hospitable-outbound.ts"),
    "messages.reconcile": d("unavailable", "none", "Güvenilir sinyal yok: belirsiz gönderim insan incelemesine gider"),
    "webhooks.receive": d("unavailable", "none", "Yalnız düzenli çekme; köprüye webhook yazılmaz"),
    "rates.read": d("unavailable", "none", "financials:read kapsamı yok"),
    "reviews.read": d("unavailable", "none", "Değişmez 12: yorum tablosu kaynaksız eklenmez"),
    "reviews.respond": d("unavailable", "none", "Değişmez 12"),
  }),
  dataPolicy: allDataClasses(RETAINED_IN_ORG),
};

/**
 * Lixus'un Airbnb'den BEKLEDİĞİ yetenekler — hepsi `planned`, hiçbiri bağlı değil.
 * Sandbox, resmî doküman ve kimlik bilgisi olmadan uç nokta/yük/protokol YAZILMAZ (değişmez 18);
 * beklentinin kanonik ayrıntısı `requirements.ts`te.
 */
export const AIRBNB_DIRECT_MANIFEST: ChannelManifest = {
  source: "airbnb_direct",
  stage: "contract_only",
  capabilities: allCapabilities(d("planned", "none", "Sözleşme aşaması — bkz. requirements.ts"), {
    "connection.lifecycle": d("planned", "none", "Host yetkilendirmesi, yenileme, iptal, yeniden bağlanma — ChannelConnection üzerinde"),
    "properties.read": d("planned", "none", "İlan listesi → CanonicalProperty"),
    "reservations.read": d("planned", "none", "Rezervasyonlar → CanonicalReservation (bağlantı kapsamlı kimlik)"),
    "messages.read": d("planned", "none", "Misafir mesajları → CanonicalMessage"),
    "messages.send": d("planned", "none", "Tek atış, sağlayıcı idempotency anahtarı beklenir"),
    "messages.reconcile": d("planned", "none", "Belirsiz gönderim sonradan doğrulanır, körlemesine yeniden gönderilmez"),
    "webhooks.receive": d("planned", "none", "İmzalı, tekrar-korumalı; yalnız değişiklik ipucu, veri aynı yazma servisinden"),
    "availability.read": d("planned", "none", "Müsaitlik motoruna kanal kaynağı"),
    "availability.write": d("planned", "none", "Müsaitlik motorundan kanala (ayrı onay)"),
    "rates.read": d("planned", "none", "Gelir fazı (V7)"),
    "rates.write": d("planned", "none", "Gelir fazı (V7) — ayrı onay"),
    "reviews.read": d("planned", "none", "Yorum fazı (V6) — kaynak olmadan tablo yok"),
    "reviews.respond": d("planned", "none", "Yorum fazı (V6) — ayrı onay"),
  }),
  dataPolicy: allDataClasses(TERMS_REVIEW),
};

/** iCal yalnız rezervasyon (tarih bloğu) taşır (değişmez 5); mesaj/webhook/yazma YOK. */
export const ICAL_MANIFEST: ChannelManifest = {
  source: "ical",
  stage: "native",
  capabilities: allCapabilities(d("unavailable", "none", "iCal yalnız rezervasyon bloğu taşır (değişmez 5)"), {
    "reservations.read": d("supported", "native_ingest", "import/sync.ts (takvim bağlantısı) + elle .ics/.csv içe aktarma"),
  }),
  // Kaynak silinince satırlar KALIR (öksüz → "manual", calendar-sources/[id] DELETE).
  dataPolicy: allDataClasses(RETAINED_IN_ORG),
};

export const CHANNEL_MANIFESTS: Readonly<Record<ChannelProviderId, ChannelManifest>> = {
  hospitable: HOSPITABLE_MANIFEST,
  airbnb_direct: AIRBNB_DIRECT_MANIFEST,
};

export function capabilitiesWithStatus(manifest: ChannelManifest, status: CapabilityStatus): ChannelCapabilityId[] {
  return CHANNEL_CAPABILITIES.filter((id) => manifest.capabilities[id].status === status);
}
