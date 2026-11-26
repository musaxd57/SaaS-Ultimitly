import { prisma } from "@/lib/db";
import { badRequest, jsonOk, notFound, readJsonCappedOrNull } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { applyItemEvent } from "@/lib/conversation-items/store";

// Konuşma öğeleri (09-26): ev sahibi bir açık işi "tamamlandı" işaretler — açık iş YALNIZ ev sahibiyle kapanır (acil dahil).
// Misafir mesajının türevi olduğu için konuşmalar gibi yalnız sahip/yönetici. Öğe KİRACI + KONUŞMA ile aranır (başka org'un
// ya da başka konuşmanın öğesi 404). Kapanmış öğe yeniden açılmaz (`core.nextStatus`).
export const PATCH = withManage<{ id: string; itemId: string }>(async (session, req, { params }) => {
  const { id, itemId } = await params;
  const body = await readJsonCappedOrNull<{ action?: unknown }>(req);
  if (!body || body.action !== "done") return badRequest({ action: "Geçersiz işlem." });
  const item = await prisma.conversationItem.findFirst({
    where: { id: itemId, conversationId: id, organizationId: session.organizationId },
    select: { id: true },
  });
  if (!item) return notFound();
  await applyItemEvent(prisma, { organizationId: session.organizationId, ids: [item.id], event: "host_done", now: new Date() });
  const after = await prisma.conversationItem.findFirst({
    where: { id: item.id, organizationId: session.organizationId },
    select: { status: true },
  });
  return jsonOk({ status: after?.status ?? null });
});
