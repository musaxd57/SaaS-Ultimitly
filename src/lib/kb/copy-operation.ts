import { prisma } from "@/lib/db";

/** Kopyalama işlem kaydının saklama süresi (tekrar penceresi bundan uzun olamaz; Codex 10-21, migration 81). */
export const KB_COPY_OPERATION_TTL_MS = 30 * 86_400_000;

/**
 * Süresi dolan kopyalama işlem kayıtları silinir. Rota yalnız aynı işletme yeniden kopyalarken kendi eski kayıtlarını siliyordu; bir daha
 * kopyalamayan işletmenin kaydı süresiz kalıyordu (Opus 10-21 B7) → saatlik süpürge (`scheduled-sync`).
 */
export async function sweepKbCopyOperations(now: Date = new Date()): Promise<{ deleted: number }> {
  const res = await prisma.kbCopyOperation.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - KB_COPY_OPERATION_TTL_MS) } } });
  return { deleted: res.count };
}
