import { prisma } from "@/lib/db";
import { badRequest, jsonOk, notFound, readJsonCappedOrNull } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { writeAudit, auditActor } from "@/lib/audit";
import { houseRulesCardEnabled } from "@/lib/house-rules/flag";
import { HOUSE_RULES_INPUT_ERROR, saveHouseRules, validateHostHouseRulesInput } from "@/lib/house-rules/store";

// ---------------------------------------------------------------------------
// MÜLKÜN EV KURALLARI (#188 dilim 2). Yalnız yönetici yazar; başka kiracının mülk kimliği 404 (varlık sızdırılmaz).
// Kart bayrağı (`HOUSE_RULES_CARD_ENABLED`) kapalıyken rota da YOK (404). Denetim kaydı konu adlarıyla, SEÇİM değeri
// olmadan (ayar değişikliği sözleşmesi). Ev sahibinin kendi seçimi onaydır (`confirmed`).
// ---------------------------------------------------------------------------

async function ownProperty(organizationId: string, id: string) {
  return prisma.property.findFirst({ where: { id, organizationId }, select: { id: true } });
}

export const PUT = withManage<{ id: string }>(async (session, req, { params }) => {
  if (!houseRulesCardEnabled()) return notFound();
  const { id } = await params;
  const property = await ownProperty(session.organizationId, id);
  if (!property) return notFound();
  const rules = validateHostHouseRulesInput(await readJsonCappedOrNull(req));
  if (!rules) return badRequest({ _: HOUSE_RULES_INPUT_ERROR });
  if (!(await saveHouseRules(session.organizationId, property.id, rules))) return notFound();
  await writeAudit({
    organizationId: session.organizationId,
    actorUserId: auditActor(session),
    action: "property.house_rules_set",
    metadata: { propertyId: property.id, fields: rules.map((r) => r.topic) },
  });
  return jsonOk({ ok: true, rules });
});
