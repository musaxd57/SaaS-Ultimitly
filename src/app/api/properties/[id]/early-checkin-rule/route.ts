import { prisma } from "@/lib/db";
import { badRequest, jsonOk, notFound, readJsonCappedOrNull } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { writeAudit, auditActor } from "@/lib/audit";
import { EARLY_CHECKIN_RULE_ERROR, saveEarlyCheckinRule, validateEarlyCheckinRuleInput } from "@/lib/early-checkin/rules";

// ---------------------------------------------------------------------------
// MÜLKÜN ERKEN GİRİŞ KURALI (09-24, doğrulanmış erken giriş akışı — `lib/early-checkin`). Yalnız yönetici yazar
// (temizlik rolü ücreti ne görür ne değiştirir); başka kiracının mülk kimliği 404 (varlık sızdırılmaz). Denetim
// kaydı alan adlarıyla, DEĞER olmadan (ayar değişikliği sözleşmesi). Kural yoksa akış kapalıdır (insan).
// ---------------------------------------------------------------------------

async function ownProperty(organizationId: string, id: string) {
  return prisma.property.findFirst({ where: { id, organizationId }, select: { id: true } });
}

export const PUT = withManage<{ id: string }>(async (session, req, { params }) => {
  const { id } = await params;
  const property = await ownProperty(session.organizationId, id);
  if (!property) return notFound();
  const rule = validateEarlyCheckinRuleInput(await readJsonCappedOrNull(req));
  if (!rule) return badRequest({ _: EARLY_CHECKIN_RULE_ERROR });
  await saveEarlyCheckinRule(session.organizationId, property.id, rule);
  await writeAudit({
    organizationId: session.organizationId,
    actorUserId: auditActor(session),
    action: "property.early_checkin_rule_set",
    metadata: { propertyId: property.id, fields: ["mode", "earliest", "fee", "note", "readyBeforeCheckout"] },
  });
  return jsonOk({ ok: true, rule });
});

export const DELETE = withManage<{ id: string }>(async (session, _req, { params }) => {
  const { id } = await params;
  const property = await ownProperty(session.organizationId, id);
  if (!property) return notFound();
  await saveEarlyCheckinRule(session.organizationId, property.id, null);
  await writeAudit({
    organizationId: session.organizationId,
    actorUserId: auditActor(session),
    action: "property.early_checkin_rule_cleared",
    metadata: { propertyId: property.id, fields: ["earlyCheckinRule"] },
  });
  return jsonOk({ ok: true, rule: null });
});
