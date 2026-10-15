import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAuditInTx } from "@/lib/audit";
import { COMMITMENT_KIND_LABELS, type CommitmentKind } from "@/lib/guest-commitments-core";

// ---------------------------------------------------------------------------
// AÇIK TAAHHÜT HAFIZASI A (kurucu kararı 10-10; migration 62; tasarım `docs/TASARIM-2026-10-10-acik-taahhut-hafizasi-onerisi.md`).
//
// Misafire verilen söz ("havlular 18:00'e kadar") YALNIZ ev sahibinin AÇIK işaretinden doğar — yapay zekâ / metin yorumu YOK. METİN
// SAKLANMAZ: tür kapalı küme + son an. Söz oluşurken bir GÖREV açılır (aynı işlemde); görev `done` olunca söz kapanır, görev geri
// açılırsa söz de açılır, görev silinirse söz iptal olur. Açık söz "Dikkat Gerektirenler"de kalan / geçen süreyle görünür.
// Yapay zekâ cevabına girdi olarak verilmesi AYRI karar (müşteriye giden metni etkiler) — bu modül istem kurmaz.
// ---------------------------------------------------------------------------

export {
  COMMITMENT_KINDS,
  COMMITMENT_KIND_LABELS,
  COMMITMENT_STATUSES,
  commitmentDueAt,
  isCommitmentKind,
  type CommitmentKind,
  type CommitmentStatus,
} from "@/lib/guest-commitments-core";

/** Sözün açtığı görevin türü (`TASK_TYPE` kapalı kümesinden). */
const TASK_TYPE_FOR: Record<CommitmentKind, string> = {
  towels: "laundry",
  supplies: "restock",
  cleaning: "cleaning",
  maintenance: "maintenance",
};

type Tx = Prisma.TransactionClient | PrismaClient;

/** Söz ekleme kilidi ad alanı (diğerleri: 23 · 40–45). Konuşma başına. */
const COMMITMENT_LOCK_NS = 46;

/** Yalnız testler: kilitli bölgede "aynı söz var mı?" okumasından SONRA bekleme noktası (Opus 10-15 B8). */
export const __commitmentHooks: { afterSameCheck: null | (() => Promise<void>) } = { afterSameCheck: null };

/**
 * Söz + görev TEK işlemde. Konuşmanın dairesi yoksa söz verilemez (görev bir daireye bağlıdır). Görev kökeni `manual` (ev sahibinin
 * işi — rezervasyon iptalinde otomatik silinmez).
 */
export async function createGuestCommitment(input: {
  organizationId: string;
  conversationId: string;
  propertyId: string;
  reservationId: string | null;
  kind: CommitmentKind;
  dueAt: Date;
  actorUserId: string;
}, outerTx?: Prisma.TransactionClient): Promise<{ id: string; taskId: string; reused: boolean }> {
  // Dış işlem verilirse (yapay zekâ önerisinin onayı — karar kaydıyla AYNI işlem) onun içinde; yoksa bugünkü gibi kendi işlemi.
  const run = <T,>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => (outerTx ? fn(outerTx) : prisma.$transaction(fn));
  return run(async (tx) => {
    // TEKRAR GÜVENLİĞİ (idempotency denetimi 10-15, P2): çift tıklama / bağlantı cevap anında koptu → aynı söz iki kez geliyordu (iki söz +
    // iki görev). Konuşma kilidi altında aynı tür + aynı son an için AÇIK söz varsa o döner. Farklı son an / farklı tür = bilinçli yeni söz.
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(${COMMITMENT_LOCK_NS}::int4, hashtext(${input.conversationId}))`);
    const same = await tx.guestCommitment.findFirst({
      where: {
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        kind: input.kind,
        dueAt: input.dueAt,
        status: "open",
        taskId: { not: null },
      },
      select: { id: true, taskId: true },
    });
    if (same?.taskId) return { id: same.id, taskId: same.taskId, reused: true };
    if (__commitmentHooks.afterSameCheck) await __commitmentHooks.afterSameCheck();
    const task = await tx.task.create({
      data: {
        propertyId: input.propertyId,
        reservationId: input.reservationId,
        type: TASK_TYPE_FOR[input.kind],
        origin: "manual",
        title: `Misafire söz: ${COMMITMENT_KIND_LABELS[input.kind]}`,
        dueAt: input.dueAt,
        status: "todo",
        priority: "standard",
      },
      select: { id: true },
    });
    const commitment = await tx.guestCommitment.create({
      data: {
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        taskId: task.id,
        kind: input.kind,
        dueAt: input.dueAt,
      },
      select: { id: true },
    });
    await writeAuditInTx(tx, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "commitment.created",
      metadata: { commitmentId: commitment.id, taskId: task.id, kind: input.kind },
    });
    return { id: commitment.id, taskId: task.id, reused: false };
  });
}

/**
 * Görevin durumu değişti (görev güncelleme işleminin İÇİNDE çağrılır — aynı işlem): `done`a geçti → bağlı açık sözler kapanır;
 * `done`dan çıktı → bu görevin kapattığı sözler yeniden açılır (iptal edilmiş söz açılmaz).
 */
export async function syncCommitmentsForTaskStatus(
  tx: Tx,
  scope: { organizationId: string; taskId: string },
  from: string,
  to: string,
  now: Date,
): Promise<void> {
  const { organizationId, taskId } = scope;
  if (from !== "done" && to === "done") {
    await tx.guestCommitment.updateMany({ where: { organizationId, taskId, status: "open" }, data: { status: "done", closedAt: now } });
  } else if (from === "done" && to !== "done") {
    await tx.guestCommitment.updateMany({ where: { organizationId, taskId, status: "done" }, data: { status: "open", closedAt: null } });
  }
}

/**
 * Görevin son tarihi değişti (aynı işlemde): bağlı AÇIK söz yeni saati izler (Haiku: görev saati değişince söz eski saatte kalıyor,
 * Dikkat satırı yanlış gecikme gösteriyordu). Durum gibi saatin de tek kaynağı görevdir — ev sahibi işi yeniden planladıysa sözü de
 * yeniden planlamıştır. Görev saati kaldırılırsa (boş) söz saati korunur.
 */
export async function syncCommitmentsForTaskDueAt(tx: Tx, scope: { organizationId: string; taskId: string }, dueAt: Date): Promise<void> {
  await tx.guestCommitment.updateMany({ where: { ...scope, status: "open" }, data: { dueAt } });
}

/**
 * SAKLAMA (KVKK, Haiku denetimi B3 10-10): son anı YA DA oluşturulma anı saklama sınırından (`DATA_RETENTION_MONTHS`) eski sözler silinir
 * — durumdan bağımsız (iki yıllık "açık" söz anlamsızdır). Oluşturulma anı da sayılır (10-10 gece, Haiku incelemesi): görev tarihi ileri
 * taşınınca söz de taşınır (`syncCommitmentsForTaskDueAt`) ve yalnız son ana bakan kural kaydı saklama süresinin ötesinde tutardı.
 * Kendi saatlik işi (`scheduled-sync` commitment-retention) — konuşma öğesi süpürgesinin arızası bunu durdurmaz.
 */
export async function purgeExpiredGuestCommitments(cutoff: Date): Promise<{ deleted: number }> {
  const r = await prisma.guestCommitment.deleteMany({ where: { OR: [{ dueAt: { lt: cutoff } }, { createdAt: { lt: cutoff } }] } });
  return { deleted: r.count };
}

/** Görev silinmeden ÖNCE (aynı işlemde): bağlı açık söz iptal olur (görevsiz açık söz "kimsenin işi değil" olarak kalmasın). */
export async function cancelCommitmentsForDeletedTask(tx: Tx, scope: { organizationId: string; taskId: string }, now: Date): Promise<void> {
  await tx.guestCommitment.updateMany({ where: { ...scope, status: "open" }, data: { status: "cancelled", closedAt: now } });
}
