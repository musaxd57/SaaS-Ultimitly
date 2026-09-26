import "server-only";

import type { OutboundProvider } from "@/lib/channels/outbound";
import type { ErasureDb } from "@/lib/erasure";

// ---------------------------------------------------------------------------
// INGEST EVENT SÖZLEŞMESİ — sağlayıcıdan BAĞIMSIZ domain event girişi (V1 ürün akışı).
//
// V0.6'da `IngestEvent` yalnız Hospitable polling yolunun (write service) çıktısıydı.
// Lixus'un KENDİ giriş yolları — iCal takvim beslemesi, elle .ics/.csv yükleme, QR
// misafir sohbeti — canonical satırı kendi yazma yollarında üretir ama event
// üretmiyordu; intelligence katmanı bu yüzden Hospitable'sız bir kiracı için hiçbir
// sinyal göremiyordu. Bu modül o kaynakları AYNI tabloya, AYNI şekle bağlar.
//
// KURALLAR:
//  · Event GERÇEK bir yazma anında, satırla AYNI TX'te yazılır (transactional outbox).
//    Geçmişe/kaynağa yapay olay üretilmez; "satır varsa event vardır, tersi de".
//  · PII'SİZ: kiracı · kaynak · bağlantı · varlık türü + BİZİM id'miz · tür · şema sürümü ·
//    değişen alan ADLARI (değer yok). Misafir metni/adı ve sağlayıcı kimliği TAŞINMAZ.
//  · `provider` = kapalı küme `INGEST_SOURCES`: dış sağlayıcı adaptörleri (`OutboundProvider`)
//    + Lixus-native girişler. Native girişlerde `connectionId` daima null (bağlantı yok).
//  · Tüketici (`modules/intelligence`) kaynağı OKUMAZ; canonical satırı id ile okur.
// ---------------------------------------------------------------------------

/** Lixus-native giriş yolları (sağlayıcı adaptörü olmayan, bağlantısız). */
export type NativeIngestSource = "ical" | "manual_file" | "qr_chat";
export type IngestSource = OutboundProvider | NativeIngestSource;

/** Kapalı küme — `satisfies` + aşağıdaki tip kontrolü yeni bir kaynağın listeden düşmesini derlemede yakalar. */
export const INGEST_SOURCES = ["hospitable", "ical", "manual_file", "qr_chat"] as const satisfies readonly IngestSource[];
type MissingSource = Exclude<IngestSource, (typeof INGEST_SOURCES)[number]>;
const _ingestSourcesExhaustive: MissingSource extends never ? true : never = true;
void _ingestSourcesExhaustive;

export interface IngestContext {
  organizationId: string;
  provider: IngestSource;
  /** Org'un aktif bağlantısı; null = damga yok (env fallback / legacy / native giriş), ingestedAt yine yazılır. */
  connectionId: string | null;
}

export type IngestEntityType = "reservation" | "conversation" | "message";

export type IngestEventKind =
  | "reservation.created"
  | "reservation.updated"
  | "reservation.cancelled"
  | "conversation.created"
  | "conversation.updated"
  /** Sağlayıcıdan senkronla ALINAN mesaj (polling/webhook). */
  | "message.imported"
  /** Doğrudan kanaldan GELEN misafir mesajı (QR sohbet). Tüketici ikisini aynı işler. */
  | "message.received";

export const INGEST_EVENT_SCHEMA_VERSION = 1;

/**
 * Tek yazıcı. Çağıran, satırı yazdığı TX istemcisini (`tx`) verir — event ile satır ya
 * birlikte commit olur ya hiç. `changedFields` yalnız `*.updated` için, ALAN ADLARI.
 */
export async function recordIngestEvent(
  db: ErasureDb,
  ctx: IngestContext,
  entityType: IngestEntityType,
  entityId: string,
  kind: IngestEventKind,
  changedFields: string[] | null = null,
): Promise<void> {
  await db.ingestEvent.create({
    data: {
      organizationId: ctx.organizationId,
      provider: ctx.provider,
      connectionId: ctx.connectionId,
      entityType,
      entityId,
      kind,
      schemaVersion: INGEST_EVENT_SCHEMA_VERSION,
      changedFieldsJson: changedFields && changedFields.length ? JSON.stringify(changedFields) : null,
    },
  });
}
