import { prisma } from "@/lib/db";
import { kbSchema, zodFieldErrors } from "@/lib/validators";
import { badRequest, jsonOk, propertyInOrg } from "@/lib/api";
import { withAuth, withManage } from "@/lib/route-guard";

export const GET = withAuth(async (session, req) => {
  const { searchParams } = new URL(req.url);
  const propertyId = searchParams.get("propertyId") ?? undefined;

  const items = await prisma.knowledgeBaseItem.findMany({
    where: {
      property: { organizationId: session.organizationId },
      ...(propertyId ? { propertyId } : {}),
    },
    include: { property: { select: { name: true } } },
    orderBy: [{ propertyId: "asc" }, { category: "asc" }],
  });
  return jsonOk(items);
});

export const POST = withManage(async (session, req) => {
  const data = await req.json().catch(() => null);
  const parsed = kbSchema.safeParse(data);
  if (!parsed.success) return badRequest(zodFieldErrors(parsed.error));
  const d = parsed.data;

  if (!(await propertyInOrg(d.propertyId, session.organizationId))) {
    return badRequest({ propertyId: "Geçersiz mülk" });
  }

  const item = await prisma.knowledgeBaseItem.create({
    data: {
      propertyId: d.propertyId,
      category: d.category,
      title: d.title,
      content: d.content,
      language: d.language,
      isActive: d.isActive,
    },
  });
  return jsonOk(item, 201);
});
