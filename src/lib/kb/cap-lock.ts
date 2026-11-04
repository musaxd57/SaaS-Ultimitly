import "server-only";
import { Prisma } from "@prisma/client";

// ---------------------------------------------------------------------------
// BİLGİ TABANI PLAN SINIRI — ortak kilit (Codex 11-04 P2). Etkin kalem sayısını ARTIRAN her yazıcı (ekle, etkinleştir, kopyala, WhatsApp'tan
// kaydet, geçmişten öğren onayı) sayımı ve yazmayı AYNI işlemde, mülk başına AYNI danışma kilidi altında yapar. Eskiden sayım kilitsizdi:
// N−1 etkin kalemde iki FARKLI istek ikisi de N−1 sayıp geçiyor, mülk N+1'e çıkıyordu (istek kimliği yalnız AYNI işlemin tekrarını çözer).
// Ad alanı 48 (diğerleri: 23, 40–47).
// ---------------------------------------------------------------------------

const KB_CAP_LOCK_NS = 48;

/**
 * Yalnız testler: kilitli bölgede sayımdan SONRA, yazmadan ÖNCE bekleme / araya girme noktası (eşzamanlılık testi şansa kalmasın). Yazma
 * işlem istemcisinden yapıldığı için genel Prisma temsilcisine kurulan casus onu görmez — yarış / çökme testleri buradan kurulur.
 */
export const __kbCapHooks: { afterCount: null | ((propertyId: string) => Promise<void>) } = { afterCount: null };

/** Mülkün kilidini alır (işlem sonuna kadar) ve etkin kalem sayısını döner. Çağıran yazmayı AYNI işlemde yapar. */
export async function lockedActiveKbCount(tx: Prisma.TransactionClient, propertyId: string): Promise<number> {
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(${KB_CAP_LOCK_NS}::int4, hashtext(${propertyId}))`);
  const n = await tx.knowledgeBaseItem.count({ where: { propertyId, isActive: true } });
  if (__kbCapHooks.afterCount) await __kbCapHooks.afterCount(propertyId);
  return n;
}
