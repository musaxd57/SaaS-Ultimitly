import { prisma } from "@/lib/db";
import { badRequest, jsonOk, notFound, readJsonCappedOrNull } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { writeAudit, auditActor } from "@/lib/audit";
import { saveDefaultCleaner } from "@/lib/tasks/default-cleaner";
import { notifyAssignmentRemoved, notifyTaskAssigned } from "@/lib/tasks/notify";
import { reportError } from "@/lib/report-error";

// ---------------------------------------------------------------------------
// DAİRENİN TEMİZLİKÇİSİ (kurucu 11-05 gece; tasarım docs/TASARIM-2026-11-06-dogrudan-gorevlendirme-ve-whatsapp.md §2.1). Yalnız yönetici
// yazar; başka kiracının mülkü 404 (varlık sızdırılmaz), başka kiracının kişisi 400. `moveTaskIds` (kurucu / Codex 11-06 K-1) → ev sahibinin
// listeden SEÇTİĞİ, eski temizlikçide duran başlanmamış gelecekteki sistem temizlikleri yeni kişiye geçer; aday olmayan kimlik (başlanmış,
// başka daire, arada değişmiş) taşınmaz ve `skipped` sayılır. `moveOpen: true` (eski istemci: hepsi) geriye uyum için durur. Denetim kaydı
// alan adlarıyla, değer olmadan (ayar değişikliği sözleşmesi).
// ---------------------------------------------------------------------------

export const PUT = withManage<{ id: string }>(async (session, req, { params }) => {
  const { id } = await params;
  const property = await prisma.property.findFirst({ where: { id, organizationId: session.organizationId }, select: { id: true } });
  if (!property) return notFound();
  const input = (await readJsonCappedOrNull(req)) as { userId?: unknown; moveOpen?: unknown; moveTaskIds?: unknown } | null;
  const userId = input?.userId;
  if (!input || !(userId === null || (typeof userId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(userId)))) {
    return badRequest({ userId: "Geçersiz kişi." });
  }
  const moveOpen = input.moveOpen === true;
  // Ev sahibinin SEÇTİĞİ görevler (kurucu / Codex 11-06 K-1). Kimlik biçimi + üst sınır; kümeye uyan ama aday olmayan kimlik sunucuda elenir.
  const rawIds = input.moveTaskIds;
  if (rawIds !== undefined && !(Array.isArray(rawIds) && rawIds.length <= 200 && rawIds.every((v) => typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v)))) {
    return badRequest({ moveTaskIds: "Geçersiz görev listesi." });
  }
  const moveTaskIds = rawIds === undefined ? undefined : [...new Set(rawIds as string[])];
  const saved = await saveDefaultCleaner(session.organizationId, property.id, userId, { moveOpen, moveTaskIds, resetByUserId: session.userId });
  if (saved.result === "property_not_found") return notFound();
  if (saved.result === "user_not_found") return badRequest({ userId: "Bu kişi işletmenizde değil." });
  await writeAudit({
    organizationId: session.organizationId,
    actorUserId: auditActor(session),
    action: userId ? "property.default_cleaner_set" : "property.default_cleaner_cleared",
    metadata: { propertyId: property.id, fields: ["defaultCleaner"], moved: saved.moved, skipped: saved.skippedIds.length },
  });
  // Taşınan işler yeni kişinin "yeni görev"idir: bildirim otomatik atamayla AYNI yoldan (anahtar `STAFF_NOTIFY_ENABLED`, görev / kişi tavanı).
  for (const taskId of saved.movedIds) {
    void notifyTaskAssigned(session.organizationId, taskId).catch((err) => void reportError("task-assign-mail", err));
  }
  // Eski kişiye "Görevlendirmeniz değişti" (iş teklifi değil — kurucu / Codex 11-06): hangi daire, hangi gün listesinden çıktı.
  if (saved.previousUserId && saved.movedIds.length > 0) {
    void notifyAssignmentRemoved(session.organizationId, saved.previousUserId, saved.movedIds).catch((err) => void reportError("task-unassign-mail", err));
  }
  return jsonOk({ ok: true, userId, moved: saved.moved, skipped: saved.skippedIds.length });
});
