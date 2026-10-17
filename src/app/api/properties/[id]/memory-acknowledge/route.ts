import { prisma } from "@/lib/db";
import { badRequest, jsonOk, notFound, readJsonCappedOrNull } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { writeAudit, auditActor } from "@/lib/audit";
import { acknowledgeContradiction } from "@/modules/intelligence";

// ---------------------------------------------------------------------------
// MÜLK HAFIZASI — "BİLEREK BÖYLE" (değişmez 13; kurucu 10-11: "bilerek olduğu işaretlenirse sorun yok"). Ev sahibi olası çelişki
// uyarısının ilgili bilgi tabanı hafıza kalemlerini işaretler (`humanOverrideAt`); uyarı kalkar, kalem değişirse yeniden değerlendirilir.
// Yönetici; yalnız KENDİ mülkü (başka kiracının mülk kimliği 404, varlık sızdırılmaz); başka mülkün / kaynağın kalem kimliği sessizce
// atlanır. Yapay zekâya hiçbir şey gitmez. Denetim kaydı yalnız alan adıyla.
// ---------------------------------------------------------------------------

const MAX_IDS = 50;

export const POST = withManage<{ id: string }>(async (session, req, { params }) => {
  const { id } = await params;
  const property = await prisma.property.findFirst({ where: { id, organizationId: session.organizationId }, select: { id: true } });
  if (!property) return notFound();
  const body = (await readJsonCappedOrNull(req)) as { memoryIds?: unknown } | null;
  const ids = Array.isArray(body?.memoryIds) ? body.memoryIds.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 64) : [];
  if (ids.length === 0 || ids.length > MAX_IDS) return badRequest({ _: "İşaretlenecek kalem bulunamadı." });
  const count = await acknowledgeContradiction(session.organizationId, property.id, ids, session.userId);
  await writeAudit({
    organizationId: session.organizationId,
    actorUserId: auditActor(session),
    action: "property.memory_contradiction_acknowledged",
    metadata: { propertyId: property.id, fields: ["humanOverrideAt"], count },
  });
  return jsonOk({ ok: true, count });
});
