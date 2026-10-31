import { prisma } from "@/lib/db";
import { jsonOk, badRequest, forbidden, readJsonCappedOrNull } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { generateChatToken } from "@/lib/guest-chat";
import { writeAudit, auditActor } from "@/lib/audit";

// Enable/disable the public guest QR concierge for ONE apartment. Owner/manager
// only (withManage), strictly org-scoped. Enabling lazily mints an unguessable
// token; the token is kept on disable so re-enabling reuses the same (already-
// printed) QR.
export const POST = withManage<{ id: string }>(async (session, req, { params }) => {
  const { id } = await params;
  const body = (await readJsonCappedOrNull(req)) as { enabled?: unknown } | null;
  if (typeof body?.enabled !== "boolean") {
    return badRequest({ enabled: "enabled alanı boolean olmalı." });
  }

  // Org scope: a manager can only ever touch their OWN organization's apartment.
  const property = await prisma.property.findFirst({
    where: { id, organizationId: session.organizationId },
    select: { id: true, chatToken: true },
  });
  if (!property) return forbidden();

  // Jeton YALNIZ hâlâ boşsa yazılır (idempotency denetimi 10-15, P2): aynı anda iki "aç" (çift tık / iki sekme) ikisi de boş jeton okuyup
  // iki farklı jeton üretiyordu → ilk cevabın gösterdiği QR (basılıp daireye yapıştırılan) sonradan yazılanla ezilip ölü kalıyordu.
  // Koşullu yazma: kaybeden hiçbir şey yazmaz, ikisi de veritabanındaki TEK jetonu döndürür (aşağıdaki güncelleme okur).
  if (body.enabled && !property.chatToken) {
    await prisma.property.updateMany({ where: { id: property.id, chatToken: null }, data: { chatToken: generateChatToken() } });
  }

  const updated = await prisma.property.update({
    where: { id: property.id },
    data: { chatEnabled: body.enabled },
    select: { chatEnabled: true, chatToken: true },
  });

  await writeAudit({
    organizationId: session.organizationId,
    actorUserId: auditActor(session),
    action: body.enabled ? "guest_chat.enable" : "guest_chat.disable",
    metadata: { propertyId: property.id },
  }).catch(() => {});

  return jsonOk(updated);
});
