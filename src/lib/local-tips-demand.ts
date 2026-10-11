import { prisma } from "@/lib/db";

// ---------------------------------------------------------------------------
// "YEREL TAVSİYE" HATIRLATMASI (B1 parça 2, kurucu 10-11; tasarım `docs/TASARIM-2026-10-11-acil-numara-ve-yer-onerisi.md` §6).
// Mülkte hiç "Yerel Tavsiye" kalemi yokken son 30 günde kaç misafir (ayrı konuşma) çevre önerisi sordu — sayı anlama katmanının
// `local_recommendations` öğesinden (konuşma öğeleri, `AI_CONVERSATION_ITEMS_ENABLED`); metin TAŞIMAZ, yalnız sayar. Kiracı + mülk kapsamlı.
// Tavan: 100 konuşma (kart "100+" der) — sayfa açılışı sınırsız tarama yapmaz.
// ---------------------------------------------------------------------------

export const LOCAL_TIPS_DEMAND_DAYS = 30;
export const LOCAL_TIPS_DEMAND_CAP = 100;

/** Son 30 günde bu mülkte çevre önerisi soran ayrı konuşma sayısı (en çok `LOCAL_TIPS_DEMAND_CAP`). */
export async function localTipsDemand(organizationId: string, propertyId: string, now: Date = new Date()): Promise<number> {
  const since = new Date(now.getTime() - LOCAL_TIPS_DEMAND_DAYS * 86_400_000);
  const rows = await prisma.conversationItem.findMany({
    where: { organizationId, kind: "local_recommendations", createdAt: { gte: since }, conversation: { propertyId } },
    select: { conversationId: true },
    distinct: ["conversationId"],
    take: LOCAL_TIPS_DEMAND_CAP,
  });
  return rows.length;
}
