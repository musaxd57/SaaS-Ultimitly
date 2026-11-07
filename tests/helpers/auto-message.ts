import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isAutoMessageKind } from "@/lib/auto-messages/render";

// ---------------------------------------------------------------------------
// KURUCU T4 (migration 80, 10-21): karşılama / giriş / çıkış metni artık bilgi tabanından DEĞİL dairenin "Otomatik mesajlar" kaydından
// (`AutoMessageTemplate`) gelir. Eski yaşam döngüsü testleri kurulumda bu kategorilerde bilgi tabanı kalemi yazıyordu; bu yardımcı kalemi
// AYNEN yazar ve — geçişin yaptığı gibi — misafire gidebilen (aktif + legacy/approved) bir karşılama / giriş / çıkış kalemiyse dairenin
// otomatik mesajını da aynı metinle kurar (aynı tür ikinci kez yazılırsa en son yazılan kazanır — göndericinin eski "en yeni kalem" kuralı).
// Testlerin sınadığı davranış değişmez; kaynak değişir.
// ---------------------------------------------------------------------------

export async function createKbWithAutoMessage(args: { data: Prisma.KnowledgeBaseItemUncheckedCreateInput }) {
  const kb = await prisma.knowledgeBaseItem.create(args);
  const { data } = args;
  const deliverable = data.isActive !== false && (data.reviewState === undefined || data.reviewState === "legacy" || data.reviewState === "approved");
  if (isAutoMessageKind(data.category) && deliverable) await seedAutoMessage(data.propertyId, data.category, data.content);
  return kb;
}

/** Dairenin otomatik mesajını doğrudan kurar / değiştirir (her kayıtta sürüm +1 — ürünün kaydet yolu gibi). */
export async function seedAutoMessage(propertyId: string, kind: "welcome" | "checkin" | "checkout", body: string) {
  const property = await prisma.property.findUniqueOrThrow({ where: { id: propertyId }, select: { organizationId: true } });
  return prisma.autoMessageTemplate.upsert({
    where: { propertyId_kind: { propertyId, kind } },
    create: { organizationId: property.organizationId, propertyId, kind, body },
    update: { body, revision: { increment: 1 } },
  });
}
