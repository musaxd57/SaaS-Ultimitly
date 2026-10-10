import { prisma } from "@/lib/db";
import { badRequest, jsonOk, notFound, readJsonCappedOrNull } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { writeAuditInTx } from "@/lib/audit";

// ---------------------------------------------------------------------------
// Misafire verilen sözü İPTAL et (açık taahhüt hafızası A; migration 62). Yalnız açık söz iptal edilir; bağlı görev SİLİNMEZ (ev sahibi
// görevi ayrıca yönetir). Söz "tamamlandı" buradan işaretlenmez — görev `done` olunca kapanır (tek doğruluk kaynağı görev).
// ---------------------------------------------------------------------------

export const PATCH = withManage<{ id: string; commitmentId: string }>(async (session, req, { params }) => {
  const { id, commitmentId } = await params;
  const body = (await readJsonCappedOrNull(req)) as { status?: unknown } | null;
  if (body?.status !== "cancelled") return badRequest({ status: "Geçersiz işlem." });

  const cancelled = await prisma.$transaction(async (tx) => {
    const res = await tx.guestCommitment.updateMany({
      where: { id: commitmentId, conversationId: id, organizationId: session.organizationId, status: "open" },
      data: { status: "cancelled", closedAt: new Date() },
    });
    if (res.count === 0) return false;
    await writeAuditInTx(tx, {
      organizationId: session.organizationId,
      actorUserId: session.actorUserId ?? session.userId,
      action: "commitment.cancelled",
    });
    return true;
  });
  if (!cancelled) return notFound();
  return jsonOk({ ok: true });
});
