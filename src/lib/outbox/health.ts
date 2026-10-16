import "server-only";
import { prisma } from "@/lib/db";

// ---------------------------------------------------------------------------
// KUYRUK SAĞLIĞI (yalnız operatör, sistem geneli; 10-16 kurucu: "görseldeki sistem tarzında bir sistemimiz var mı" — transactional outbox +
// yoklayıcı yayıncı). İki kalıcı kuyruk var: misafir mesajı kuyruğu (`MessageOutbox`, `DURABLE_OUTBOX_ENABLED`) ve kimlik e-postası kuyruğu
// (`EmailOutbox`, `EMAIL_OUTBOX_ENABLED`). Yoklayıcı durursa (senkron kilidi takılı, süreç ayakta değil) satırlar sessizce birikir — bu okuma
// birikmeyi GÖRÜNÜR yapar. Salt okuma; kimlik / metin / alıcı / sağlayıcı kimliği TAŞIMAZ (yalnız sayılar ve en eski bekleme süresi).
// ---------------------------------------------------------------------------

export interface QueueHealth {
  queue: "message" | "email";
  /** Durum başına satır sayısı (kapalı küme; kuyruğun kendi durumları). */
  byStatus: Record<string, number>;
  /** Vadesi gelmiş ama hâlâ `pending` duran en eski satırın bekleme süresi (ms); yoksa null. */
  oldestDueMs: number | null;
  /** Son 24 saatte terminal başarısızlığa (`failed`) düşen satır sayısı. */
  failed24h: number;
}

/** Bu süreden uzun bekleyen vadesi gelmiş satır = yoklayıcı geride / durmuş (ekranda uyarı). Yoklayıcı en geç 2 dk'da bir geçer. */
export const QUEUE_LAG_WARN_MS = 10 * 60_000;

const DAY_MS = 24 * 60 * 60_000;

export async function queueHealth(now: Date = new Date()): Promise<QueueHealth[]> {
  const since = new Date(now.getTime() - DAY_MS);
  const [mGroups, mOldest, mFailed, eGroups, eOldest, eFailed] = await Promise.all([
    prisma.messageOutbox.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.messageOutbox.findFirst({
      where: { status: "pending", availableAt: { lte: now } },
      orderBy: { availableAt: "asc" },
      select: { availableAt: true },
    }),
    prisma.messageOutbox.count({ where: { status: "failed", updatedAt: { gte: since } } }),
    prisma.emailOutbox.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.emailOutbox.findFirst({
      where: { status: "pending", nextAttemptAt: { lte: now } },
      orderBy: { nextAttemptAt: "asc" },
      select: { nextAttemptAt: true },
    }),
    prisma.emailOutbox.count({ where: { status: "failed", updatedAt: { gte: since } } }),
  ]);
  const counts = (groups: readonly { status: string; _count: { _all: number } }[]) =>
    Object.fromEntries(groups.map((g) => [g.status, g._count._all]));
  const lag = (at: Date | null | undefined) => (at ? Math.max(0, now.getTime() - at.getTime()) : null);
  return [
    { queue: "message", byStatus: counts(mGroups), oldestDueMs: lag(mOldest?.availableAt), failed24h: mFailed },
    { queue: "email", byStatus: counts(eGroups), oldestDueMs: lag(eOldest?.nextAttemptAt), failed24h: eFailed },
  ];
}
