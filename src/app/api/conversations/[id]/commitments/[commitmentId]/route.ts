import { prisma } from "@/lib/db";
import { badRequest, jsonOk, notFound, readJsonCappedOrNull } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { writeAuditInTx } from "@/lib/audit";
import { commitmentTaskTitle, isCommitmentKind } from "@/lib/guest-commitments-core";

// ---------------------------------------------------------------------------
// Misafire verilen sözü İPTAL et (açık taahhüt hafızası A; migration 62). Yalnız açık söz iptal edilir; bağlı görev SİLİNMEZ (ev sahibi
// görevi ayrıca yönetir). Söz "tamamlandı" buradan işaretlenmez — görev `done` olunca kapanır (tek doğruluk kaynağı görev).
// "Yanlış, kaldır" (`reason: "wrong"`, kurucu 10-17 gece söz → görev otomatik): YALNIZ kendiliğinden kaydedilmiş sözde — söz kapanır
// (`closedReason = "wrong"`) ve sistemin açtığı görev kimse dokunmadıysa (yapılacak + otomatik başlık) silinir; ev sahibinin üzerinde
// çalıştığı görev kalır. Karar kaydı durduğu için aynı mesajdan söz yeniden açılmaz.
// ---------------------------------------------------------------------------

export const PATCH = withManage<{ id: string; commitmentId: string }>(async (session, req, { params }) => {
  const { id, commitmentId } = await params;
  const body = (await readJsonCappedOrNull(req)) as { status?: unknown; reason?: unknown } | null;
  if (body?.status !== "cancelled") return badRequest({ status: "Geçersiz işlem." });
  if (body.reason !== undefined && body.reason !== "wrong") return badRequest({ reason: "Geçersiz işlem." });
  const wrong = body.reason === "wrong";

  const cancelled = await prisma.$transaction(async (tx) => {
    const where = { id: commitmentId, conversationId: id, organizationId: session.organizationId, status: "open" };
    // "Yanlış" yalnız kendiliğinden kaydedilmiş sözde (elle / öneriden kaydedilen sözü ev sahibi kendisi girdi — bildiğimiz "İptal").
    const row = wrong
      ? await tx.guestCommitment.findFirst({ where: { ...where, source: "auto" }, select: { kind: true, topic: true, dayPart: true, taskId: true } })
      : null;
    if (wrong && !row) return false;
    const res = await tx.guestCommitment.updateMany({
      where: wrong ? { ...where, source: "auto" } : where,
      data: { status: "cancelled", closedAt: new Date(), ...(wrong ? { closedReason: "wrong" } : {}) },
    });
    if (res.count === 0) return false;
    let taskRemoved = false;
    if (row?.taskId && isCommitmentKind(row.kind)) {
      const del = await tx.task.deleteMany({
        where: { id: row.taskId, status: "todo", title: commitmentTaskTitle(row.kind, row.topic, row.dayPart), property: { organizationId: session.organizationId } },
      });
      taskRemoved = del.count === 1;
    }
    await writeAuditInTx(tx, {
      organizationId: session.organizationId,
      actorUserId: session.actorUserId ?? session.userId,
      action: wrong ? "commitment.removed_wrong" : "commitment.cancelled",
      metadata: wrong ? { commitmentId, taskRemoved } : { commitmentId },
    });
    return true;
  });
  if (!cancelled) return notFound();
  return jsonOk({ ok: true });
});
