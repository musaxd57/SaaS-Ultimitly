import { prisma } from "@/lib/db";
import { badRequest, jsonOk, notFound, readJsonCappedOrNull } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { writeAudit, auditActor } from "@/lib/audit";
import { loadDefaultCleanerUserId, saveDefaultCleaner } from "@/lib/tasks/default-cleaner";

// ---------------------------------------------------------------------------
// DAİRENİN TEMİZLİKÇİSİ (kurucu 11-05 gece; tasarım docs/TASARIM-2026-11-06-dogrudan-gorevlendirme-ve-whatsapp.md §2.1). Yalnız yönetici
// yazar; başka kiracının mülkü 404 (varlık sızdırılmaz), başka kiracının kişisi 400. `moveOpen: true` → eski temizlikçide duran
// başlanmamış gelecekteki sistem temizlikleri yeni kişiye geçer (ekrandaki açık sorunun "Evet"i). Denetim kaydı alan adlarıyla, değer
// olmadan (ayar değişikliği sözleşmesi).
// ---------------------------------------------------------------------------

export const PUT = withManage<{ id: string }>(async (session, req, { params }) => {
  const { id } = await params;
  const property = await prisma.property.findFirst({ where: { id, organizationId: session.organizationId }, select: { id: true } });
  if (!property) return notFound();
  const input = (await readJsonCappedOrNull(req)) as { userId?: unknown; moveOpen?: unknown } | null;
  const userId = input?.userId;
  if (!input || !(userId === null || (typeof userId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(userId)))) {
    return badRequest({ userId: "Geçersiz kişi." });
  }
  const moveOpen = input.moveOpen === true;
  const previous = moveOpen ? await loadDefaultCleanerUserId(prisma, session.organizationId, property.id) : null;
  const saved = await saveDefaultCleaner(session.organizationId, property.id, userId, { moveOpenFrom: previous });
  if (saved.result === "property_not_found") return notFound();
  if (saved.result === "user_not_found") return badRequest({ userId: "Bu kişi işletmenizde değil." });
  await writeAudit({
    organizationId: session.organizationId,
    actorUserId: auditActor(session),
    action: userId ? "property.default_cleaner_set" : "property.default_cleaner_cleared",
    metadata: { propertyId: property.id, fields: ["defaultCleaner"], moved: saved.moved },
  });
  return jsonOk({ ok: true, userId, moved: saved.moved });
});
