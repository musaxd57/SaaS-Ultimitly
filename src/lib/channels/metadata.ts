import "server-only";

import { prisma } from "@/lib/db";
import { reportError } from "@/lib/report-error";
import type { IngestErrorKind } from "./ingest";

// ---------------------------------------------------------------------------
// KANAL METAVERİSİ YAZICILARI (migration 60 A–C, "expand → dual-write"; tasarım `docs/TASARIM-2026-10-09-migration-paketi-60.md`).
//
//   A. `ChannelListing`: köprü senkronu ilanı eşlerken `Property.hospitableId` ile BİRLİKTE (bağlantı satırı + ilan kimliği → mülk).
//   B. `Reservation.sourcePlatform`: sağlayıcının ham platform adı (gösterim / teşhis; yetenek ASLA buradan çıkarılmaz — V0.9 pini).
//   C. `ChannelConnection.lastReadOkAt / lastReadErrorAt / lastReadErrorKind`: her okuma geçişinin sonucu.
//
// Sözleşme: anahtar `CHANNEL_METADATA_WRITE` (tam "1"; VARSAYILAN KAPALI). YALNIZ YAZAR — bugün hiçbir okuyucu yok (okuma geçişi ayrı
// anahtar + ayrı onay; müsaitlik motorunun sağlık kaydını kullanması davranış değişikliğidir). Senkronu ASLA bozmaz: her arıza
// `reportError` + yut. Kiracı: bağlantı satırı ve mülk aynı org'a ait olmalı (yazmadan önce denetlenir).
// ---------------------------------------------------------------------------

export function channelMetadataWriteEnabled(): boolean {
  return process.env.CHANNEL_METADATA_WRITE === "1";
}

/**
 * A. İlan eşlemesi: (bağlantı, ilan kimliği) → mülk. Bağlantı yoksa (env fallback / legacy) YAZILMAZ — çıkarım yok. Bağlantı başka
 * org'unsa ya da mülk bu org'un değilse satır yazılmaz. Mülk değiştiyse (ilan başka mülke bağlandı) güncellenir.
 */
export async function recordChannelListings(
  organizationId: string,
  connectionId: string | null,
  pairs: readonly { externalId: string; propertyId: string }[],
): Promise<void> {
  if (!channelMetadataWriteEnabled() || !connectionId || pairs.length === 0) return;
  try {
    const conn = await prisma.channelConnection.findFirst({ where: { id: connectionId, organizationId }, select: { id: true } });
    if (!conn) return;
    const owned = new Set(
      (
        await prisma.property.findMany({
          where: { organizationId, id: { in: pairs.map((p) => p.propertyId) } },
          select: { id: true },
        })
      ).map((p) => p.id),
    );
    for (const p of pairs) {
      if (!owned.has(p.propertyId) || !p.externalId) continue;
      await prisma.channelListing.upsert({
        where: { connectionId_externalId: { connectionId, externalId: p.externalId } },
        create: { organizationId, connectionId, externalId: p.externalId, propertyId: p.propertyId },
        update: { propertyId: p.propertyId },
      });
    }
  } catch (err) {
    void reportError(`channel-listing-write org=${organizationId}`, err);
  }
}

/** C. Okuma geçişinin sonucu. Başarı yalnız `lastReadOkAt`; hata zaman + kapalı küme tür. Bağlantı yoksa yazılmaz. */
export async function recordConnectionRead(
  organizationId: string,
  connectionId: string | null,
  outcome: { ok: true } | { ok: false; kind: IngestErrorKind },
  now: Date = new Date(),
): Promise<void> {
  if (!channelMetadataWriteEnabled() || !connectionId) return;
  try {
    await prisma.channelConnection.updateMany({
      where: { id: connectionId, organizationId },
      data: outcome.ok ? { lastReadOkAt: now } : { lastReadErrorAt: now, lastReadErrorKind: outcome.kind },
    });
  } catch (err) {
    void reportError(`channel-health-write org=${organizationId}`, err);
  }
}
