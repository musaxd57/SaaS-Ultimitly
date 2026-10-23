import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { orgTimezone } from "@/lib/timezone";
import { detectOperationalTask, buildOperationalTaskData } from "./detect";

export type CreateOperationalTaskResult =
  | { status: "created"; taskId: string; type: string }
  | { status: "duplicate" }
  | { status: "none" };

/** Mesajdan görev kilidi ad alanı (diğerleri: 23 · 40–44 — `automation.ts` RESERVATION_TASKS_LOCK_NS yanında). */
const TASK_DEDUPE_LOCK_NS = 45;

/**
 * From an inbound guest message, create ONE operational task (maintenance /
 * restock / cleaning) if the message warrants it — deduped so repeated messages
 * about the same issue at the same property on the same day don't pile up.
 *
 * Best-effort by design: the caller's escalation (mark "problem" + email the
 * host) must never depend on this. Callers should still guard with .catch, but
 * the dedupe read + create are the only DB touches and both are cheap.
 */

export async function createOperationalTaskFromMessage(ctx: {
  propertyId: string;
  message: string;
  sourceMessageId?: string | null;
  reservationId?: string | null;
  ai?: { intent?: string | null; riskType?: string | null };
  now?: Date;
  /** İşlem içinden çağıran (yapay zekâ önerisinin onayı — karar kaydıyla AYNI işlem). Verilmezse bugünkü gibi genel istemci. */
  db?: Prisma.TransactionClient;
}): Promise<CreateOperationalTaskResult> {
  const db = ctx.db ?? prisma;
  const detected = detectOperationalTask(ctx.message, ctx.ai ?? {});
  if (!detected) return { status: "none" };

  // Dedupe day-bucket in the HOST'S calendar day (org.timezone), not a fixed one.
  const property = await db.property.findUnique({
    where: { id: ctx.propertyId },
    select: { organization: { select: { timezone: true } } },
  });

  const data = buildOperationalTaskData(detected, {
    propertyId: ctx.propertyId,
    message: ctx.message,
    now: ctx.now,
    timezone: orgTimezone(property?.organization?.timezone),
  });

  // Intra-day dedupe: skip if an OPEN task with the same key already exists.
  // TEKRAR GÜVENLİĞİ (idempotency denetimi 10-15, P3): okuma + yazma anahtar başına işlem kilidi altında. Eskiden kilitsizdi ("nadir
  // çift görev kabul edilebilir"); aynı mesaj kanal oto-yanıtı ile bekleyen-mesaj uyarı yolunda aynı anda işlenince iki görev açılıyordu.
  // Çağıran işlem verdiyse (`ctx.db`, öneri onayı) kilit o işlemde alınır; yoksa kısa bir işlem açılır.
  const run = async (tx: Prisma.TransactionClient): Promise<CreateOperationalTaskResult> => {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(${TASK_DEDUPE_LOCK_NS}::int4, hashtext(${data.dedupeKey}))`);
    // AYNI MESAJIN YENİDEN İŞLENMESİ (kurucu 10-15): bir mesaj en çok bir görev açar — günü ya da görevin durumu ne olursa olsun. Gün kovası
    // işleme anından hesaplandığı için aynı mesaj ertesi gün yeniden işlenince (senkron tekrarı, yeniden deneme) ikinci görev açılıyordu.
    // Başka gün gelen YENİ bildirim (başka mesaj) yine ayrı görevdir.
    if (ctx.sourceMessageId) {
      const fromSameMessage = await tx.task.findFirst({
        where: { propertyId: ctx.propertyId, sourceMessageId: ctx.sourceMessageId },
        select: { id: true },
      });
      if (fromSameMessage) return { status: "duplicate" };
    }
    const existing = await tx.task.findFirst({
      where: { dedupeKey: data.dedupeKey, status: { not: "done" } },
      select: { id: true },
    });
    if (existing) return { status: "duplicate" };
    if (__taskDedupeHooks.afterExistingRead) await __taskDedupeHooks.afterExistingRead();

    const task = await tx.task.create({
      data: {
        propertyId: ctx.propertyId,
        reservationId: ctx.reservationId ?? null,
        type: data.type,
        origin: "ai",
        title: data.title,
        description: data.description,
        dueAt: data.dueAt,
        priority: data.priority,
        status: "todo",
        dedupeKey: data.dedupeKey,
        sourceMessageId: ctx.sourceMessageId ?? null,
      },
    });
    return { status: "created", taskId: task.id, type: data.type };
  };
  // Süreler kardeş kilitli yollarla aynı (Opus 10-15 B10): varsayılan 2 sn havuz beklemesi senkron + içe aktarma baskısında şikâyet görevini
  // sessizce düşürürdü (çağıranlar hatayı yutar — en iyi çaba).
  return ctx.db ? run(ctx.db) : prisma.$transaction(run, { maxWait: 15_000, timeout: 30_000 });
}

/** Yalnız testler: kilitli bölgede "var mı?" okumasından SONRA bekleme noktası (eşzamanlılık testi şansa kalmasın — Opus B8). */
export const __taskDedupeHooks: { afterExistingRead: null | (() => Promise<void>) } = { afterExistingRead: null };
