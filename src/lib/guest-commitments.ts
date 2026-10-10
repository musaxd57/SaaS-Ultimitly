import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
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
}): Promise<{ id: string; taskId: string }> {
  return prisma.$transaction(async (tx) => {
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
      metadata: { kind: input.kind },
    });
    return { id: commitment.id, taskId: task.id };
  });
}

/**
 * Görevin durumu değişti (görev güncelleme işleminin İÇİNDE çağrılır — aynı işlem): `done`a geçti → bağlı açık sözler kapanır;
 * `done`dan çıktı → bu görevin kapattığı sözler yeniden açılır (iptal edilmiş söz açılmaz).
 */
export async function syncCommitmentsForTaskStatus(tx: Tx, taskId: string, from: string, to: string, now: Date): Promise<void> {
  if (from !== "done" && to === "done") {
    await tx.guestCommitment.updateMany({ where: { taskId, status: "open" }, data: { status: "done", closedAt: now } });
  } else if (from === "done" && to !== "done") {
    await tx.guestCommitment.updateMany({ where: { taskId, status: "done" }, data: { status: "open", closedAt: null } });
  }
}

/** Görev silinmeden ÖNCE (aynı işlemde): bağlı açık söz iptal olur (görevsiz açık söz "kimsenin işi değil" olarak kalmasın). */
export async function cancelCommitmentsForDeletedTask(tx: Tx, taskId: string, now: Date): Promise<void> {
  await tx.guestCommitment.updateMany({ where: { taskId, status: "open" }, data: { status: "cancelled", closedAt: now } });
}
