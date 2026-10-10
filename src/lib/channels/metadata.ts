import { channelListingIdentityKey, recordTrialIdentities, type TrialIdentityKey } from "@/lib/billing/trial-identity";
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
// Sözleşme: anahtar `CHANNEL_METADATA_WRITE` (tam "1"; VARSAYILAN KAPALI). Yazıcılar burada; tek OKUYUCU ilan eşlemesi (A) — ayrı anahtar
// `CHANNEL_LISTING_READ` arkasında, VARSAYILAN KAPALI (açmak ayrı onay; müsaitlik motorunun sağlık kaydını kullanması da ayrı davranış değişikliği). Senkronu ASLA bozmaz: her arıza
// `reportError` + yut. Kiracı: bağlantı satırı ve mülk aynı org'a ait olmalı (yazmadan önce denetlenir).
// ---------------------------------------------------------------------------

export function channelMetadataWriteEnabled(): boolean {
  return process.env.CHANNEL_METADATA_WRITE === "1";
}

/**
 * OKUMA GEÇİŞİ (değişmez 3; migration 60 tasarımı §A "expand → dual-write → okuma anahtarı → contract"): anahtar `CHANNEL_LISTING_READ`
 * (tam "1"; VARSAYILAN KAPALI). AÇMAK = kurucu onayı + çift yazımın canlıda yeterince koşmuş olması (operatör planı). Kapalıyken hiçbir sorgu
 * yapılmaz — bugünkü davranış (`Property.hospitableId`).
 */
export function channelListingReadEnabled(): boolean {
  return process.env.CHANNEL_LISTING_READ === "1";
}

/**
 * (bağlantı, ilan kimliği) → BU org'un mülkü, ilan satırından. Satır yoksa / anahtar kapalıysa / bağlantı yoksa null → çağıran bugünkü
 * yola (`Property.hospitableId`) DÜŞER (tasarım: satırı olmayan mülkte okuma eski kolona düşer, yoksa geçişte ilan görünmezdi). Kiracı:
 * satırın org'u VE mülkün org'u çağıranın org'u olmalı (bozuk / başka org'a işaret eden satır yok sayılır). Asla fırlatmaz.
 *
 * 🚨 GEÇİŞ BOYUNCA PARİTE ŞARTI (Haiku incelemesi 10-10): satır yalnız mülkün eski kolonu BOŞSA ya da AYNI ilanı gösteriyorsa kabul
 * edilir. Kolon BAŞKA bir ilanı gösteriyorsa (ilan kimliği kaybolup aynı adla yenisi geldi, sonra eskisi geri döndü) bayat satır bugünkü
 * yolun "canlı başka ilana bağlı mülkü asla ele geçirme" korumasını atlatır ve iki canlı ilanın rezervasyonları TEK mülkte toplanırdı →
 * satır yok sayılır, bugünkü yol karar verir (çift yazım satırı düzeltir) ve uyuşmazlık bildirilir (geçişin "çift yazım tutarlı mı"
 * gözlemi). Kolon DROP edildiğinde (contract) bu şart kalkar. Yazma anahtarı kapalıyken satırlar donar → okuma da yapılmaz.
 */
export async function propertyForChannelListing(
  organizationId: string,
  connectionId: string | null,
  externalId: string,
): Promise<string | null> {
  if (!channelListingReadEnabled() || !channelMetadataWriteEnabled() || !connectionId || !externalId) return null;
  try {
    const row = await prisma.channelListing.findFirst({
      where: { connectionId, externalId, organizationId, property: { organizationId } },
      select: { propertyId: true, property: { select: { hospitableId: true } } },
    });
    if (!row) return null;
    const column = row.property.hospitableId;
    if (column !== null && column !== externalId) {
      void reportError(
        `channel-listing-parity org=${organizationId}`,
        new Error("İlan satırı ile mülkün eski kolonu farklı ilanı gösteriyor — satır yok sayıldı, bugünkü yol karar verdi."),
      );
      return null;
    }
    return row.propertyId;
  } catch (err) {
    void reportError(`channel-listing-read org=${organizationId}`, err);
    return null;
  }
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
    const conn = await prisma.channelConnection.findFirst({ where: { id: connectionId, organizationId }, select: { id: true, provider: true } });
    if (!conn) return;
    const owned = new Set(
      (
        await prisma.property.findMany({
          where: { organizationId, id: { in: pairs.map((p) => p.propertyId) } },
          select: { id: true },
        })
      ).map((p) => p.id),
    );
    const current = new Map(
      (
        await prisma.channelListing.findMany({
          where: { connectionId, externalId: { in: pairs.map((p) => p.externalId) } },
          select: { externalId: true, propertyId: true },
        })
      ).map((l) => [l.externalId, l.propertyId]),
    );
    const newIdentities: (TrialIdentityKey | null)[] = [];
    for (const p of pairs) {
      if (!owned.has(p.propertyId) || !p.externalId) continue;
      if (current.get(p.externalId) === p.propertyId) continue; // değişmeyen eşleme yeniden yazılmaz
      // Bir ilanın arızası kalanları atlatmaz (çift yazım en iyi çaba; senkronun asıl yazımı `Property.hospitableId`).
      try {
        await prisma.channelListing.upsert({
          where: { connectionId_externalId: { connectionId, externalId: p.externalId } },
          create: { organizationId, connectionId, externalId: p.externalId, propertyId: p.propertyId },
          update: { propertyId: p.propertyId },
        });
        // Yalnız İLK eşleme kimlik sayılır (aynı ilanın mülkler arası yeniden eşlenmesi yeni bir kullanım değildir).
        if (!current.has(p.externalId)) newIdentities.push(channelListingIdentityKey(conn.provider, p.externalId));
      } catch (err) {
        void reportError(`channel-listing-write org=${organizationId}`, err);
      }
    }
    // Deneme kimliği (kurucu onayı 10-10; anahtar KAPALIYKEN yazmaz): ilan daha önce başka hesapta görüldüyse bu hesabın denemesi biter.
    if (newIdentities.length > 0) await recordTrialIdentities(organizationId, newIdentities);
  } catch (err) {
    void reportError(`channel-listing-write org=${organizationId}`, err);
  }
}

/**
 * C. Okuma geçişinin sonucu. Başarı yalnız `lastReadOkAt`; hata zaman + kapalı küme tür. Bağlantı yoksa yazılmaz. Başarı hata alanlarını
 * SİLMEZ (geçmiş kalır) — okuyucu iki zamanı karşılaştırır (`lastReadOkAt > lastReadErrorAt` = son geçiş iyi).
 */
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
