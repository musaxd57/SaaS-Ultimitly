import "server-only";

import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { INTERNAL_THREAD_PREFIX, type OutboundProvider } from "./outbound";

// ---------------------------------------------------------------------------
// CHANNEL CONNECTION — bağlantı yaşam döngüsü kaydı (V0.3, migration 49)
//
// Sağlayıcı-nötr, kimlik bilgisi ŞİFRELİ BLOB olarak gelir (bu modül şifrelemez;
// çağıran `crypto-core` ile bir kez şifreler ve aynı blob'u hem org kolonlarına
// hem buraya yazar — dual-write). Kurallar (şema yorumu ile aynı):
//   · (organizationId, provider) başına TEK satır; disconnect/reconnect satırı
//     YENİDEN KULLANIR (id sabit) — kuyruktaki `connectionId` damgaları kopmaz;
//   · `generation` her kimlik-bilgisi yazımında artar → OAuth refresh yarışının
//     CAS çapası (gecikmiş refresh 0 satır eşler, atılır);
//   · status: active | disconnected | revoked; aktif olmayan satırda token yok.
//   · Tüm okumalar organizationId ile — kiracı sınırı.
// ---------------------------------------------------------------------------

export type ConnectionStatus = "active" | "disconnected" | "revoked";
export type RevokedReason = "refresh_invalid_grant" | "send_401" | "send_403";

export interface ConnectionCredentials {
  accessTokenEnc: string;
  refreshTokenEnc: string | null;
  tokenExpiresAt: Date | null;
  label?: string | null;
}

export interface ActiveConnection {
  id: string;
  organizationId: string;
  provider: OutboundProvider;
  status: ConnectionStatus;
  generation: number;
  label: string | null;
  accessTokenEnc: string | null;
  refreshTokenEnc: string | null;
  tokenExpiresAt: Date | null;
}

type Tx = Prisma.TransactionClient;

const SELECT = {
  id: true,
  organizationId: true,
  provider: true,
  status: true,
  generation: true,
  label: true,
  accessTokenEnc: true,
  refreshTokenEnc: true,
  tokenExpiresAt: true,
} as const;

function shape(row: {
  id: string;
  organizationId: string;
  provider: string;
  status: string;
  generation: number;
  label: string | null;
  accessTokenEnc: string | null;
  refreshTokenEnc: string | null;
  tokenExpiresAt: Date | null;
}): ActiveConnection {
  return { ...row, provider: row.provider as OutboundProvider, status: row.status as ConnectionStatus };
}

/** Bu org'un bağlantı satırı (her durumda), yoksa null. */
export async function getConnection(
  organizationId: string,
  provider: OutboundProvider = "hospitable",
  db: Tx | typeof prisma = prisma,
): Promise<ActiveConnection | null> {
  const row = await db.channelConnection.findUnique({
    where: { organizationId_provider: { organizationId, provider } },
    select: SELECT,
  });
  return row ? shape(row) : null;
}

/** Yalnız AKTİF bağlantı (worker/enqueue bunu sorar). */
export async function getActiveConnection(
  organizationId: string,
  provider: OutboundProvider = "hospitable",
): Promise<ActiveConnection | null> {
  const c = await getConnection(organizationId, provider);
  return c && c.status === "active" ? c : null;
}

/**
 * Bağlan / yeniden bağlan: satır yoksa oluştur, varsa AYNI satırı aktif yap.
 * Her çağrı generation'ı artırır (yeniden bağlanma da bir kimlik-bilgisi yazımıdır).
 */
export async function upsertActiveConnection(
  organizationId: string,
  provider: OutboundProvider,
  creds: ConnectionCredentials,
  db: Tx | typeof prisma = prisma,
): Promise<void> {
  const now = new Date();
  await db.channelConnection.upsert({
    where: { organizationId_provider: { organizationId, provider } },
    create: {
      organizationId,
      provider,
      status: "active",
      label: creds.label ?? null,
      accessTokenEnc: creds.accessTokenEnc,
      refreshTokenEnc: creds.refreshTokenEnc,
      tokenExpiresAt: creds.tokenExpiresAt,
      generation: 1,
      connectedAt: now,
    },
    update: {
      status: "active",
      label: creds.label ?? null,
      accessTokenEnc: creds.accessTokenEnc,
      refreshTokenEnc: creds.refreshTokenEnc,
      tokenExpiresAt: creds.tokenExpiresAt,
      generation: { increment: 1 },
      connectedAt: now,
      disconnectedAt: null,
      revokedAt: null,
      revokedReason: null,
    },
  });
}

/** Host bağlantıyı kaldırdı: token'lar silinir, satır kalır (kuyruk damgaları kopmaz). */
export async function markConnectionDisconnected(
  organizationId: string,
  provider: OutboundProvider,
  db: Tx | typeof prisma = prisma,
): Promise<number> {
  const r = await db.channelConnection.updateMany({
    where: { organizationId, provider, status: { not: "disconnected" } },
    data: {
      status: "disconnected",
      accessTokenEnc: null,
      refreshTokenEnc: null,
      tokenExpiresAt: null,
      generation: { increment: 1 },
      disconnectedAt: new Date(),
    },
  });
  return r.count;
}

/** Sağlayıcı kimlik bilgisini reddetti (refresh invalid_grant, gönderimde 401/403). */
export async function markConnectionRevoked(
  organizationId: string,
  provider: OutboundProvider,
  reason: RevokedReason,
  db: Tx | typeof prisma = prisma,
): Promise<number> {
  const r = await db.channelConnection.updateMany({
    where: { organizationId, provider, status: { not: "revoked" } },
    data: {
      status: "revoked",
      accessTokenEnc: null,
      refreshTokenEnc: null,
      tokenExpiresAt: null,
      generation: { increment: 1 },
      revokedAt: new Date(),
      revokedReason: reason,
    },
  });
  return r.count;
}

/**
 * OAuth rotasyonu — CAS: yalnız satır hâlâ AKTİF ve generation refresh BAŞLARKEN
 * okunan değerdeyse yazar. 0 satır = arada disconnect/reconnect/revoke/kazanan
 * refresh oldu → gecikmiş sonuç ATILIR.
 */
export async function casRotateConnectionTokens(
  connectionId: string,
  expectedGeneration: number,
  tokens: { accessTokenEnc: string; refreshTokenEnc: string; tokenExpiresAt: Date },
  db: Tx | typeof prisma = prisma,
): Promise<boolean> {
  const r = await db.channelConnection.updateMany({
    where: { id: connectionId, status: "active", generation: expectedGeneration },
    data: {
      accessTokenEnc: tokens.accessTokenEnc,
      refreshTokenEnc: tokens.refreshTokenEnc,
      tokenExpiresAt: tokens.tokenExpiresAt,
      generation: { increment: 1 },
      lastRefreshAt: new Date(),
    },
  });
  return r.count === 1;
}

/** 401 sonrası OAuth için: süreyi şimdiye çek → bir sonraki okuma refresh dener. */
export async function forceConnectionRefresh(
  organizationId: string,
  provider: OutboundProvider,
  db: Tx | typeof prisma = prisma,
): Promise<void> {
  await db.channelConnection.updateMany({
    where: { organizationId, provider, status: "active", refreshTokenEnc: { not: null } },
    data: { tokenExpiresAt: new Date(0) },
  });
}

/**
 * BACKFILL (idempotent): org kolonlarında kimlik bilgisi olup bağlantı satırı
 * olmayan her org için AKTİF satır oluştur — şifreli blob'lar AYNEN kopyalanır
 * (aynı anahtar; yeniden şifreleme yok). İkinci koşu sıfır yazar. Satırı OLAN
 * org'lara dokunmaz (dual-write onları zaten güncel tutuyor).
 */
export async function backfillChannelConnections(): Promise<{ created: number }> {
  const orgs = await prisma.organization.findMany({
    where: { hospitableTokenEnc: { not: null }, channelConnections: { none: { provider: "hospitable" } } },
    select: {
      id: true,
      hospitableTokenEnc: true,
      hospitableRefreshTokenEnc: true,
      hospitableTokenExpiresAt: true,
      hospitableLabel: true,
      hospitableConnectedAt: true,
    },
  });
  let created = 0;
  for (const o of orgs) {
    try {
      await prisma.channelConnection.create({
        data: {
          organizationId: o.id,
          provider: "hospitable",
          status: "active",
          label: o.hospitableLabel,
          accessTokenEnc: o.hospitableTokenEnc,
          refreshTokenEnc: o.hospitableRefreshTokenEnc,
          tokenExpiresAt: o.hospitableTokenExpiresAt,
          generation: 1,
          connectedAt: o.hospitableConnectedAt ?? new Date(),
        },
      });
      created++;
    } catch (err) {
      // Eşzamanlı ikinci backfill / aynı anda bağlanan host → unique çakışması = zaten var.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
      throw err;
    }
  }
  return { created };
}

export interface ProvenanceBackfillResult {
  /** İşareti bu koşuda basılan bağlantı sayısı. */
  connections: number;
  reservations: number;
  conversations: number;
  messages: number;
}

/**
 * PROVENANCE BACKFILL (V0.4, migration 50) — migration ÖNCESİ Hospitable satırlarını
 * org'un (org, provider) başına TEK bağlantısına damgalar; bağlantı başına TAM BİR KEZ
 * (`provenanceBackfilledAt` işareti). Kurallar (test-pinli, `provenance-backfill.test.ts`):
 *   · Reservation: `calendarSourceId` NULL + `channel` notIn [ics, manual] + `sourceReference`
 *     dolu — mevcut yaşam-döngüsü işaretçisi + sağlayıcı kimliği. iCal (calendarSourceId),
 *     elle dosya (ics/manual) ve referanssız elle giriş DOKUNULMAZ.
 *     ⚠️ BİLİNEN SINIR: elle UI'dan girilmiş, kanalı "airbnb" ve referansı da yazılmış bir
 *     legacy satır Hospitable satırından AYIRT EDİLEMEZ (aynı belirsizlik yaşam-döngüsü
 *     kapısında da var; V0.5 capability ile kapatır). Migration sonrası satırlar için sorun
 *     yok: elle giriş NULL/NULL doğar, Hospitable satırı damgalı doğar.
 *   · Conversation: `externalReservationId` dolu ve `qr-chat:` öneksiz.
 *   · Message: yalnız o konuşmalarda ve yalnız `externalId` dolu satırlar (sağlayıcı kimliği =
 *     bağlantıdan geçti); kimliksiz yerel gönderim NULL kalır (dürüst).
 *   · `ingestedAt` UYDURULMAZ; yalnız `connectionId` NULL olan satırlar seçilir (ingest yolunun
 *     bastığı damga ezilmez); kiracı-kapsamlı (property.organizationId); bağlantı DURUMU önemsiz
 *     (disconnected satır da tarihsel sahiptir).
 *   · TX YOK, bilerek: büyük tabloda tek TX Prisma zaman aşımına takılır ve her geçişte baştan
 *     başlardı; NULL-only filtre yazımları idempotent kılar, yarım kalan iş sonraki geçişte
 *     tamamlanır, işaret yalnız üç yazma da bitince basılır.
 */
export async function backfillProvenance(): Promise<ProvenanceBackfillResult> {
  const pending = await prisma.channelConnection.findMany({
    where: { provider: "hospitable", provenanceBackfilledAt: null },
    select: { id: true, organizationId: true },
  });
  const out: ProvenanceBackfillResult = { connections: 0, reservations: 0, conversations: 0, messages: 0 };
  for (const c of pending) {
    const tenant = { organizationId: c.organizationId };
    const providerThread = {
      externalReservationId: { not: null },
      NOT: { externalReservationId: { startsWith: INTERNAL_THREAD_PREFIX } },
    };
    const r = await prisma.reservation.updateMany({
      where: {
        connectionId: null,
        calendarSourceId: null,
        channel: { notIn: ["ics", "manual"] },
        sourceReference: { not: null },
        property: tenant,
      },
      data: { connectionId: c.id },
    });
    const v = await prisma.conversation.updateMany({
      where: { connectionId: null, ...providerThread, property: tenant },
      data: { connectionId: c.id },
    });
    const m = await prisma.message.updateMany({
      where: { connectionId: null, externalId: { not: null }, conversation: { ...providerThread, property: tenant } },
      data: { connectionId: c.id },
    });
    const marked = await prisma.channelConnection.updateMany({
      where: { id: c.id, provenanceBackfilledAt: null },
      data: { provenanceBackfilledAt: new Date() },
    });
    out.reservations += r.count;
    out.conversations += v.count;
    out.messages += m.count;
    out.connections += marked.count;
  }
  return out;
}
