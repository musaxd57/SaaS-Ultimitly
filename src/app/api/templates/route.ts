import { prisma } from "@/lib/db";
import { z } from "zod";
import { badRequest, jsonOk, propertyInOrg, readJsonCappedOrNull } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { zodFieldErrors } from "@/lib/validators";
import { DEFAULT_TEMPLATES } from "@/lib/templates";

const templateCreateSchema = z.object({
  // "Tüm mülkler" (org-wide template) arrives as null from the form — nullish
  // accepts null/undefined/string; ""/null both normalize to null. The old
  // string-only shape REJECTED null, so creating an org-wide template 400'd
  // with a bare "Doğrulama hatası" (user-reported bug).
  propertyId: z.string().max(50).nullish().transform((v) => v || null),
  category: z.string().min(1, "Kategori gerekli").max(80),
  title: z.string().min(2, "Başlık gerekli").max(300),
  body: z.string().min(2, "İçerik gerekli").max(20000),
  language: z.string().max(10).default("tr"),
});

export const GET = withManage(async (session, req) => {
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
});

export const POST = withManage(async (session, req) => {
  const data = await readJsonCappedOrNull(req);
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
});
