import { prisma } from "@/lib/db";
import { badRequest, jsonOk, notFound, readJsonCappedOrNull } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { writeAudit, auditActor } from "@/lib/audit";
import { setNightlyRate, validateNightlyRateInput } from "@/modules/intelligence/money/rates";

// ---------------------------------------------------------------------------
// MÜLKÜN TİPİK GECELİK FİYAT ARALIĞI (V2 para etkisi, 09-24). İsteğe bağlı host verisi: yalnız "Dikkat
// Gerektirenler"de çift rezervasyonun risk altındaki tutarını ARALIK olarak tahmin etmek için. Yapay zekâya
// gitmez (mekanik pin). Org kapsamı: yönetici yalnız KENDİ dairesinin aralığını yazar; başka kiracının mülk
// kimliği 404 (varlık sızdırılmaz). Denetim kaydı alan adıyla, değer olmadan (ayar değişikliği sözleşmesi).
// ---------------------------------------------------------------------------

async function ownProperty(organizationId: string, id: string) {
  return prisma.property.findFirst({ where: { id, organizationId }, select: { id: true } });
}

export const PUT = withManage<{ id: string }>(async (session, req, { params }) => {
  const { id } = await params;
  const property = await ownProperty(session.organizationId, id);
  if (!property) return notFound();
  const input = validateNightlyRateInput(await readJsonCappedOrNull(req));
  if (!input) return badRequest({ _: "En düşük ve en yüksek gecelik fiyatı tam sayı olarak girin; en yüksek, en düşükten büyük olmalı." });
  const saved = await setNightlyRate(session.organizationId, property.id, session.userId, input);
  await writeAudit({
    organizationId: session.organizationId,
    actorUserId: auditActor(session),
    action: "property.nightly_rate_set",
    metadata: { propertyId: property.id, fields: ["nightlyRateRange"] },
  });
  return jsonOk({ ok: true, rate: saved ? { low: saved.low, high: saved.high, currency: saved.currency } : null });
});

export const DELETE = withManage<{ id: string }>(async (session, _req, { params }) => {
  const { id } = await params;
  const property = await ownProperty(session.organizationId, id);
  if (!property) return notFound();
  await setNightlyRate(session.organizationId, property.id, session.userId, null);
  await writeAudit({
    organizationId: session.organizationId,
    actorUserId: auditActor(session),
    action: "property.nightly_rate_cleared",
    metadata: { propertyId: property.id, fields: ["nightlyRateRange"] },
  });
  return jsonOk({ ok: true, rate: null });
});
