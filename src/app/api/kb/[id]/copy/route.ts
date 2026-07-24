import { prisma } from "@/lib/db";
import { badRequest, jsonOk, notFound, readJsonCappedOrNull } from "@/lib/api";
import { withManage } from "@/lib/route-guard";

// Copy a knowledge-base entry to one or more OTHER apartments. Lets the host
// fill one apartment fully, then clone its info across the rest and only tweak
// the apartment-specific bits (door code, wifi, address line).
export const POST = withManage<{ id: string }>(async (session, req, { params }) => {
  const { id } = await params;

  // The source entry must belong to the caller's organization.
  const source = await prisma.knowledgeBaseItem.findFirst({
    where: { id, property: { organizationId: session.organizationId } },
    select: {
      propertyId: true,
      category: true,
      title: true,
      content: true,
      language: true,
      isActive: true,
    },
  });
  if (!source) return notFound();

  const body = await readJsonCappedOrNull(req);
  const requested: unknown = body?.targetPropertyIds;
  const ids = Array.isArray(requested)
    ? requested.filter((x): x is string => typeof x === "string")
    : [];
  if (ids.length === 0) {
    return badRequest({ targetPropertyIds: "En az bir hedef daire seçin." });
  }

  // Keep only valid targets in this org, and never copy onto the source itself.
  const targets = await prisma.property.findMany({
    where: {
      organizationId: session.organizationId,
      id: { in: ids },
      NOT: { id: source.propertyId },
    },
    select: { id: true },
  });

  let created = 0;
  for (const t of targets) {
    await prisma.knowledgeBaseItem.create({
      data: {
        propertyId: t.id,
        category: source.category,
        title: source.title,
        content: source.content,
        language: source.language,
        isActive: source.isActive,
      },
    });
    created++;
  }

  return jsonOk({ ok: true, created });
});
