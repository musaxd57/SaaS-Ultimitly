import { prisma } from "@/lib/db";
import { kbSchema, zodFieldErrors } from "@/lib/validators";
import { badRequest, jsonOk, propertyInOrg, readJsonCappedOrNull } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { limitsForOrg } from "@/lib/billing/plan-limits";

export const GET = withManage(async (session, req) => {
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
  const data = await readJsonCappedOrNull(req);
  const parsed = kbSchema.safeParse(data);
  if (!parsed.success) return badRequest(zodFieldErrors(parsed.error));
  const d = parsed.data;

  if (!(await propertyInOrg(d.propertyId, session.organizationId))) {
    return badRequest({ propertyId: "Geçersiz mülk" });
  }

  // PLAN SINIRLARI (billing/plan-limits.ts). İki ayrı kapı, ikisi de gerekli:
  //  · ADET — paketleri ayrıştıran ölçü (Başlangıç 15 / Pro 30 / İşletme 60).
  //  · KARAKTER — adet sınırının kaçış yolunu kapatır: yoksa host her şeyi TEK
  //    kayda doldurup sınırı anlamsız kılar ("giriş mesajına hepsini yazarım").
  const limits = await limitsForOrg(session.organizationId);
  if (d.content.length > limits.kbCharsPerItem) {
    return badRequest({
      content: `Tek bir bilgi kaydı en fazla ${limits.kbCharsPerItem.toLocaleString("tr-TR")} karakter olabilir. Uzun bilgileri birkaç kayda bölün — AI hepsini okur.`,
    });
  }
  const activeCount = await prisma.knowledgeBaseItem.count({
    where: { propertyId: d.propertyId, isActive: true },
  });
  if (d.isActive && activeCount >= limits.kbItemsPerProperty) {
    return badRequest({
      _: `Planınızın izin verdiği bilgi tabanı sınırına ulaştınız (daire başına ${limits.kbItemsPerProperty} kayıt). Kullanmadığınız kayıtları pasife alabilir veya planınızı yükseltebilirsiniz.`,
    });
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
