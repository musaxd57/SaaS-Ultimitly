import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, unauthorized, notFound, jsonOk, serverError } from "@/lib/api";
import { syncCalendarSource } from "@/lib/import/sync";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!session) return unauthorized();

  try {
    const { id } = await params;
    const source = await prisma.calendarSource.findFirst({
      where: { id, property: { organizationId: session.organizationId } },
      select: { id: true },
    });
    if (!source) return notFound();

    const result = await syncCalendarSource(id);
    return jsonOk(result);
  } catch {
    return serverError();
  }
}
