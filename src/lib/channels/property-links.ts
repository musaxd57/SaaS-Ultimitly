import "server-only";

import { prisma } from "@/lib/db";

// ---------------------------------------------------------------------------
// MÜLK ↔ KANAL BAĞLANTISI (salt-okuma) — sağlayıcıya özgü alanı OKUYAN tek yer burası.
//
// Çekirdek modüller (müsaitlik motoru dahil) `hospitable*` alanlarını okumaz (değişmez 1/20);
// "bu mülkün rezervasyonlarını bir kanal bağlantısı da besliyor mu" sorusunu buradan sorar.
// Bugün tek kanıt `Property.hospitableId` (köprüye bağlı ilan). Tazelik KAYDEDİLMİYOR: köprünün
// son BAŞARILI okuması hiçbir yerde tutulmuyor (402 alarmı temizler, mülk başına hata sessizce
// geçilir) → `lastSuccessAt: null` DÜRÜST değerdir; motor bu yüzden o mülkte "boş" demez.
// Doğrudan kanal (Airbnb Direct) gelince bağlantı + tazelik ChannelConnection'dan okunur.
// ---------------------------------------------------------------------------

export interface PropertyChannelLink {
  propertyId: string;
  /** Kararlı kimlik; sağlayıcı kimliği TAŞIMAZ. */
  id: string;
  label: string;
  lastSuccessAt: Date | null;
}

export async function listPropertyChannelLinks(organizationId: string, propertyIds: readonly string[]): Promise<PropertyChannelLink[]> {
  if (propertyIds.length === 0) return [];
  const rows = await prisma.property.findMany({
    where: { organizationId, id: { in: [...propertyIds] }, hospitableId: { not: null } },
    select: { id: true },
  });
  return rows.map((r) => ({ propertyId: r.id, id: `channel-link:${r.id}`, label: "Kanal bağlantısı", lastSuccessAt: null }));
}
