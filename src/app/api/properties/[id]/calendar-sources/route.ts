import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, unauthorized, badRequest, jsonOk, serverError, canManage, forbidden } from "@/lib/api";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!session) return unauthorized();
  if (!canManage(session)) return forbidden();

  try {
    const { id: propertyId } = await params;

    const property = await prisma.property.findFirst({
      where: { id: propertyId, organizationId: session.organizationId },
      select: { id: true },
    });
    if (!property) return badRequest({ propertyId: "Geçersiz mülk" });

    const data = await req.json().catch(() => null);
    const label = String(data?.label ?? "").trim();
    const url = String(data?.url ?? "").trim();

    if (label.length < 2) return badRequest({ label: "Kaynak adı gerekli (örn. Airbnb)" });
    if (label.length > 120) return badRequest({ label: "Kaynak adı çok uzun (en fazla 120 karakter)" });
    if (!/^https?:\/\/.+/i.test(url)) {
      return badRequest({ url: "Geçerli bir http(s) iCal bağlantısı girin" });
    }
    if (url.length > 2000) return badRequest({ url: "Bağlantı çok uzun (en fazla 2000 karakter)" });

    const source = await prisma.calendarSource.create({
      data: { propertyId, label, url },
    });
    return jsonOk(source, 201);
  } catch (err) {
    return serverError(undefined, err);
  }
}
