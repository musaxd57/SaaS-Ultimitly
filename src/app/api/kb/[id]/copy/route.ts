import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  requireSession,
  unauthorized,
  badRequest,
  jsonOk,
  notFound,
  serverError,
  canManage,
  forbidden,
} from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

// Copy a knowledge-base entry to one or more OTHER apartments. Lets the host
// fill one apartment fully, then clone its info across the rest and only tweak
// the apartment-specific bits (door code, wifi, address line).
export async function POST(req: NextRequest, { params }: Params) {
  const session = await requireSession();
  if (!session) return unauthorized();
  if (!canManage(session)) return forbidden();
  const { id } = await params;

  try {
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

    const body = await req.json().catch(() => null);
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
  } catch {
    return serverError();
  }
}
