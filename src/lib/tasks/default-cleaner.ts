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
 * işletmede olmalı. `moveOpen` verilirse ESKİ temizlikçide (kilit ALTINDA okunur — Opus 11-06 N8: kilit dışı okuma iki yöneticinin aynı anki
 * değişikliğinde işleri yanlış kişide bırakıyordu) duran, BAŞLANMAMIŞ ya da "Yapılamıyor", sistem açmış, bugünden sonraki temizlikler yeni
 * kişiye geçer (ekrandaki açık soruya "Evet" — gizli toplu değişiklik yok). `moveTaskIds` verilirse YALNIZ seçilenler (kurucu / Codex 11-06
 * K-1: "tek bir toplu onayla her şey taşınmamalı" — ev sahibi listeden seçer); aday kümesinde olmayan kimlik (başlanmış, başka daire, başka
 * kişi, arada değişmiş) TAŞINMAZ ve `skippedIds`te döner. Dönüş: taşınan görevler + eski temizlikçi (bildirim için).
 */
export async function saveDefaultCleaner(
  organizationId: string,
  propertyId: string,
  userId: string | null,
  opts: { moveOpen?: boolean; moveTaskIds?: readonly string[]; now?: Date; resetByUserId?: string | null } = {},
): Promise<{ result: SaveDefaultCleanerResult; moved: number; movedIds: string[]; skippedIds: string[]; previousUserId: string | null }> {
  const where = defaultCleanerWhere(organizationId, propertyId);
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<unknown[]>`SELECT 1 FROM "Property" WHERE "id" = ${propertyId} AND "organizationId" = ${organizationId} FOR UPDATE`;
    const none = { moved: 0, movedIds: [] as string[], skippedIds: [...(opts.moveTaskIds ?? [])], previousUserId: null };
    if (locked.length === 0) return { result: "property_not_found" as const, ...none };
    if (userId) {
      const user = await tx.user.findFirst({ where: { id: userId, organizationId }, select: { id: true } });
      if (!user) return { result: "user_not_found" as const, ...none };
    }
    const rows = await tx.automationRule.findMany({ where, orderBy: { updatedAt: "desc" }, select: { id: true, actionJson: true, isEnabled: true } });
    // Eski temizlikçi: kuralın kilit altındaki ETKİN değeri (kişi hâlâ bu işletmede olmalı — `loadDefaultCleanerUserId` ile aynı kural).
    const previousId = parseDefaultCleanerAction(rows.find((r) => r.isEnabled)?.actionJson);
    const previous = previousId ? ((await tx.user.findFirst({ where: { id: previousId, organizationId }, select: { id: true } }))?.id ?? null) : null;
    if (!userId) {
      await tx.automationRule.deleteMany({ where });
      return { result: "saved" as const, ...none, previousUserId: previous };
    }
    const data = { actionJson: JSON.stringify({ userId }), isEnabled: true, name: "Dairenin temizlikçisi" };
    if (rows.length === 0) await tx.automationRule.create({ data: { ...where, ...data } });
    else {
      await tx.automationRule.update({ where: { id: rows[0].id }, data });
      if (rows.length > 1) await tx.automationRule.deleteMany({ where: { id: { in: rows.slice(1).map((r) => r.id) } } });
    }
    const movedIds: string[] = [];
    const wantsMove = opts.moveTaskIds !== undefined ? opts.moveTaskIds.length > 0 : opts.moveOpen === true;
    if (wantsMove && previous && previous !== userId) {
      const from = previous;
      const candidates = await openFutureCleaningIds(tx, organizationId, propertyId, from, opts.now ?? new Date());
      // Seçim verildiyse YALNIZ adaylarla kesişimi (sunucu adayı yeniden hesaplar — istemcinin listesi güvenilmez).
      const ids = opts.moveTaskIds !== undefined ? candidates.filter((id) => opts.moveTaskIds!.includes(id)) : candidates;
      if (__defaultCleanerHooks.afterCandidates) await __defaultCleanerHooks.afterCandidates(ids);
      if (ids.length > 0) {
        // Satırlar KİLİTLENİR; durum ve kontrol listesi işareti kilit altında okunur (iptal onarımıyla aynı — işaret `TaskUpdate` yazmaz; Haiku 11-06).
        const locked = await tx.$queryRaw<{ id: string; status: string; checklistJson: string | null }[]>(
          Prisma.sql`SELECT "id", "status", "checklistJson" FROM "Task" WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`,
        );
        const untouched = locked.filter((t) => t.status !== "blocked" && !checklistTouched(t.checklistJson)).map((t) => t.id);
        if (untouched.length > 0) {
          await tx.task.updateMany({
            // Aday okuması kilitsizdi: arada kişi işe başladıysa / not yazdıysa tanım KİLİT altında yeniden uygulanır.
            where: { id: { in: untouched }, assignedToId: from, ...UNTOUCHED_AUTO_LIFECYCLE_TASK_WHERE },
            data: { assignedToId: userId },
          });
        }
        // "Yapılamıyor" (eski kişi işi bıraktı — gerçek uygulama ekranı 11-06: en çok yeni kişiye gitmesi gereken iş buydu, "dokunulmuş"
        // sayılıp kalıyordu). Yeni kişiye geçer ve "Yapılacak"a döner; zaman çizelgesine kim / ne zaman — panodaki yeniden atamayla aynı.
        const blocked = locked.filter((t) => t.status === "blocked").map((t) => t.id);
        if (blocked.length > 0) {
          await tx.task.updateMany({
            where: { id: { in: blocked }, assignedToId: from, status: "blocked", type: "cleaning", origin: "system" },
            data: { assignedToId: userId, status: "todo" },
          });
        }
        const done = await tx.task.findMany({ where: { id: { in: ids }, assignedToId: userId }, select: { id: true, status: true } });
        movedIds.push(...done.map((t) => t.id));
        const reset = done.filter((t) => blocked.includes(t.id)).map((t) => t.id);
        if (reset.length > 0) {
          await tx.taskUpdate.createMany({ data: reset.map((taskId) => ({ taskId, userId: opts.resetByUserId ?? null, status: "todo", note: null, photoUrl: null })) });
        }
      }
    }
    const skippedIds = (opts.moveTaskIds ?? []).filter((id) => !movedIds.includes(id));
    return { result: "saved" as const, moved: movedIds.length, movedIds, skippedIds, previousUserId: previous };
  });
}

export interface TransferTask {
  id: string;
  title: string;
  dueAt: Date | null;
  status: string;
  /** Durum "Yapılacak" ama kişi not / fotoğraf / kontrol listesi işareti eklemiş (başlanmış sayılır, aktarılmaz). */
  touched: boolean;
}

/** Aktarma listesinin üst sınırı (rotadaki `moveTaskIds` sınırıyla aynı). */
export const TRANSFER_LIST_LIMIT = 200;

/**
 * Temizlikçi değişince ekrandaki aktarma listesi (kurucu / Codex 11-06 K-1): `movable` = aktarılabilir (başlanmamış ya da "Yapılamıyor",
 * sistemin açtığı, bugün ve sonrası — `saveDefaultCleaner`ın kilit altında taşıyacağı küme: `openFutureCleaningIds` + kontrol listesi
 * işaretsiz) · `started` = bu kişide duran, bugün ve sonrası, bitmemiş ama AKTARILMAYAN (başlanmış / not, fotoğraf ya da işaret almış)
 * temizlikler — ev sahibi ayrıca değerlendirir. Tamamlananlar listelenmez (geçmiş kayıt ve eski çalışan korunur).
 */
export async function transferCandidates(
  db: Db,
  organizationId: string,
  propertyId: string,
  userId: string,
  now: Date,
): Promise<{ movable: TransferTask[]; started: TransferTask[] }> {
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
  const tz = orgTimezone(org?.timezone);
  const movableIds = new Set(await openFutureCleaningIds(db, organizationId, propertyId, userId, now));
  const rows = await db.task.findMany({
    where: {
      propertyId,
      property: { organizationId },
      type: "cleaning",
      origin: "system",
      assignedToId: userId,
      status: { not: "done" },
      AND: [taskDueDayRangeWhere({ from: todayKey(now, tz), to: null }, tz)],
    },
    select: { id: true, title: true, dueAt: true, status: true, checklistJson: true },
    orderBy: [{ dueAt: "asc" }, { id: "asc" }],
    take: TRANSFER_LIST_LIMIT,
  });
  // Kilit altındaki taşımayla AYNI karar: "Yapılamıyor" her zaman geçer; diğerlerinde kontrol listesi işareti (sorgunun kaba elemesini
  // aşan biçimler dahil — `checklistTouched`) işi "başlanmış" yapar. Ekranda "aktarılabilir" görünüp sunucuda atlanan iş kalmasın.
  const isMovable = (r: (typeof rows)[number]) => movableIds.has(r.id) && (r.status === "blocked" || !checklistTouched(r.checklistJson));
  const shape = (r: (typeof rows)[number]): TransferTask => ({
    id: r.id,
    title: r.title,
    dueAt: r.dueAt,
    status: r.status,
    touched: r.status === "todo",
  });
  return {
    movable: rows.filter(isMovable).map((r) => ({ ...shape(r), touched: false })),
    started: rows.filter((r) => !isMovable(r)).map(shape),
  };
}

/** Yalnız test: "Evet" taşımasında aday okuması ile kilit arasında bekleme noktası (yarış koruması sınansın — mutasyon Q11). */
export const __defaultCleanerHooks: { afterCandidates?: (ids: string[]) => Promise<void> | void } = {};

/**
 * Bu kişide duran, bu dairenin "Yapılamıyor" dediği ya da DOKUNULMAMIŞ (projenin tek tanımı `UNTOUCHED_AUTO_LIFECYCLE_TASK_WHERE`: durum "Yapılacak", kişinin yazdığı
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
      type: "cleaning",
      assignedToId: userId,
      AND: [
        taskDueDayRangeWhere({ from: todayKey(now, tz), to: null }, tz),
        { OR: [UNTOUCHED_AUTO_LIFECYCLE_TASK_WHERE, { status: "blocked", origin: "system" }] },
      ],
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}
