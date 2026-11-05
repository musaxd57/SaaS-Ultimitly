import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { orgTimezone } from "@/lib/timezone";
import { taskDueDayRangeWhere } from "@/lib/day-where";
import { todayKey } from "@/modules/availability/core";
import { checklistTouched, UNTOUCHED_AUTO_LIFECYCLE_TASK_WHERE } from "@/lib/tasks/cancelled-leftovers";

// ---------------------------------------------------------------------------
// DAİRENİN TEMİZLİKÇİSİ (kurucu 11-05 gece: "daireye temizlikçiyi bir kez belirleyince, sonraki temizlikler ayrıca kabul beklemeden onun
// iş listesine düşsün"; tasarım docs/TASARIM-2026-11-06-dogrudan-gorevlendirme-ve-whatsapp.md §2.1–2.2).
// Depo: `AutomationRule` — erken giriş kuralı ve ev kurallarıyla AYNI migration'sız kalıp (mülk + tetik başına tek satır, doğrulanmış
// JSON, mülk satırı kilidi, mülk silinince kural da silinir). Anlamca da bir otomasyon kuralıdır: "rezervasyon gelince bu dairenin
// temizliğini X'e ata".
// Kişi KULLANIM ANINDA doğrulanır (aynı işletmede mi): değilse atama yapılmaz, görev bugünkü gibi atanmamış açılır (sessiz yanlış atama yok).
// ---------------------------------------------------------------------------

export const DEFAULT_CLEANER_TRIGGER = "reservation_created_assign_cleaning";
const conditionFor = (propertyId: string) => JSON.stringify({ propertyId });

type Db = Prisma.TransactionClient | typeof prisma;

export function defaultCleanerWhere(organizationId: string, propertyId: string) {
  return { organizationId, triggerType: DEFAULT_CLEANER_TRIGGER, conditionJson: conditionFor(propertyId) };
}

/** Saklı eylem → kişi kimliği; bozuk / beklenmedik satır = kural yok. */
export function parseDefaultCleanerAction(json: string | null | undefined): string | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as unknown;
    if (!v || typeof v !== "object") return null;
    const userId = (v as { userId?: unknown }).userId;
    return typeof userId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(userId) ? userId : null;
  } catch {
    return null;
  }
}

/** Dairenin temizlikçisi (kural + kişi bu işletmede). Yoksa null. */
export async function loadDefaultCleanerUserId(db: Db, organizationId: string, propertyId: string): Promise<string | null> {
  const row = await db.automationRule.findFirst({
    where: { ...defaultCleanerWhere(organizationId, propertyId), isEnabled: true },
    orderBy: { updatedAt: "desc" },
    select: { actionJson: true },
  });
  const userId = parseDefaultCleanerAction(row?.actionJson);
  if (!userId) return null;
  const user = await db.user.findFirst({ where: { id: userId, organizationId }, select: { id: true } });
  return user?.id ?? null;
}

export type SaveDefaultCleanerResult = "saved" | "property_not_found" | "user_not_found";

/**
 * Kuralı yaz (`null` = kaldır). Mülk satırı kilitlenir (iki sekme iki satır doğurmasın; mülk silme aynı sırayla kilitler). Kişi aynı
 * işletmede olmalı. `moveOpenFrom` verilirse eski temizlikçide duran, BAŞLANMAMIŞ, sistem açmış, bugünden sonraki temizlikler yeni kişiye
 * geçer (ekrandaki açık soruya "Evet" — gizli toplu değişiklik yok). Dönüş: taşınan görev sayısı.
 */
export async function saveDefaultCleaner(
  organizationId: string,
  propertyId: string,
  userId: string | null,
  opts: { moveOpenFrom?: string | null; now?: Date } = {},
): Promise<{ result: SaveDefaultCleanerResult; moved: number }> {
  const where = defaultCleanerWhere(organizationId, propertyId);
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<unknown[]>`SELECT 1 FROM "Property" WHERE "id" = ${propertyId} AND "organizationId" = ${organizationId} FOR UPDATE`;
    if (locked.length === 0) return { result: "property_not_found" as const, moved: 0 };
    if (userId) {
      const user = await tx.user.findFirst({ where: { id: userId, organizationId }, select: { id: true } });
      if (!user) return { result: "user_not_found" as const, moved: 0 };
    }
    const rows = await tx.automationRule.findMany({ where, orderBy: { updatedAt: "desc" }, select: { id: true } });
    if (!userId) {
      await tx.automationRule.deleteMany({ where });
      return { result: "saved" as const, moved: 0 };
    }
    const data = { actionJson: JSON.stringify({ userId }), isEnabled: true, name: "Dairenin temizlikçisi" };
    if (rows.length === 0) await tx.automationRule.create({ data: { ...where, ...data } });
    else {
      await tx.automationRule.update({ where: { id: rows[0].id }, data });
      if (rows.length > 1) await tx.automationRule.deleteMany({ where: { id: { in: rows.slice(1).map((r) => r.id) } } });
    }
    let moved = 0;
    if (opts.moveOpenFrom && opts.moveOpenFrom !== userId) {
      const ids = await openFutureCleaningIds(tx, organizationId, propertyId, opts.moveOpenFrom, opts.now ?? new Date());
      if (__defaultCleanerHooks.afterCandidates) await __defaultCleanerHooks.afterCandidates(ids);
      if (ids.length > 0) {
        // Satırlar KİLİTLENİR ve kontrol listesi işareti kilit altında okunur (iptal onarımıyla aynı — işaret `TaskUpdate` yazmaz; Haiku 11-06).
        const locked = await tx.$queryRaw<{ id: string; checklistJson: string | null }[]>(
          Prisma.sql`SELECT "id", "checklistJson" FROM "Task" WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`,
        );
        const untouched = locked.filter((t) => !checklistTouched(t.checklistJson)).map((t) => t.id);
        if (untouched.length > 0) {
          moved = (
            await tx.task.updateMany({
              // Aday okuması kilitsizdi: arada kişi işe başladıysa / not yazdıysa tanım KİLİT altında yeniden uygulanır.
              where: { id: { in: untouched }, assignedToId: opts.moveOpenFrom, ...UNTOUCHED_AUTO_LIFECYCLE_TASK_WHERE },
              data: { assignedToId: userId },
            })
          ).count;
        }
      }
    }
    return { result: "saved" as const, moved };
  });
}

/** Yalnız test: "Evet" taşımasında aday okuması ile kilit arasında bekleme noktası (yarış koruması sınansın — mutasyon Q11). */
export const __defaultCleanerHooks: { afterCandidates?: (ids: string[]) => Promise<void> | void } = {};

/**
 * Bu kişide duran, bu dairenin DOKUNULMAMIŞ (projenin tek tanımı `UNTOUCHED_AUTO_LIFECYCLE_TASK_WHERE`: durum "Yapılacak", kişinin yazdığı
 * güncelleme / fotoğraf yok, kontrol listesi işaretsiz — Haiku 11-06: not / fotoğraf / işaret almış iş başlanmış sayılır), sistemin açtığı,
 * bugün ya da sonrası vadeli temizlik görevleri (gün tek tarih kuralının sorgu ikiziyle, işletme diliminde).
 */
export async function openFutureCleaningIds(db: Db, organizationId: string, propertyId: string, userId: string, now: Date): Promise<string[]> {
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
  const tz = orgTimezone(org?.timezone);
  const rows = await db.task.findMany({
    where: {
      propertyId,
      property: { organizationId },
      ...UNTOUCHED_AUTO_LIFECYCLE_TASK_WHERE,
      type: "cleaning",
      assignedToId: userId,
      AND: [taskDueDayRangeWhere({ from: todayKey(now, tz), to: null }, tz)],
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}
