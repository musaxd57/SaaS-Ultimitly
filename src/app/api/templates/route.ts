import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { requireSession, unauthorized, badRequest, jsonOk, serverError, propertyInOrg, canManage, forbidden } from "@/lib/api";
import { zodFieldErrors } from "@/lib/validators";
import { DEFAULT_TEMPLATES } from "@/lib/templates";

const templateCreateSchema = z.object({
  propertyId: z.string().optional().or(z.literal("")).transform((v) => v || null),
  category: z.string().min(1, "Kategori gerekli").max(80),
  title: z.string().min(2, "Başlık gerekli").max(300),
  body: z.string().min(2, "İçerik gerekli").max(20000),
  language: z.string().max(10).default("tr"),
});

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const { searchParams } = new URL(req.url);
  const propertyId = searchParams.get("propertyId") ?? undefined;
  const includeDefaults = searchParams.get("includeDefaults") !== "false";

  const dbTemplates = await prisma.messageTemplate.findMany({
    where: {
      organizationId: session.organizationId,
      isActive: true,
      ...(propertyId ? { OR: [{ propertyId }, { propertyId: null }] } : {}),
    },
    orderBy: { createdAt: "asc" },
  });

  const result = [
    ...dbTemplates.map((t) => ({ ...t, isDefault: false })),
    ...(includeDefaults ? DEFAULT_TEMPLATES : []),
  ];

  return jsonOk(result);
}

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  if (!canManage(session)) return forbidden();

  try {
    const data = await req.json().catch(() => null);
    const parsed = templateCreateSchema.safeParse(data);
    if (!parsed.success) return badRequest(zodFieldErrors(parsed.error));
    const d = parsed.data;

    if (d.propertyId) {
      if (!(await propertyInOrg(d.propertyId, session.organizationId))) {
        return badRequest({ propertyId: "Geçersiz mülk" });
      }
    }

    const template = await prisma.messageTemplate.create({
      data: {
        organizationId: session.organizationId,
        propertyId: d.propertyId ?? null,
        category: d.category,
        title: d.title,
        body: d.body,
        language: d.language,
        isActive: true,
      },
    });

    return jsonOk(template, 201);
  } catch (err) {
    return serverError(undefined, err);
  }
}
