import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, unauthorized, badRequest, jsonOk, serverError } from "@/lib/api";

/** Update organization-level settings (currently: WhatsApp auto-reply toggle). */
export async function PATCH(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();

  try {
    const data = await req.json().catch(() => null);
    if (!data || typeof data.autoReplyWhatsapp !== "boolean") {
      return badRequest({ autoReplyWhatsapp: "Geçerli bir değer gerekli." });
    }

    await prisma.organization.update({
      where: { id: session.organizationId },
      data: { autoReplyWhatsapp: data.autoReplyWhatsapp },
    });

    return jsonOk({ autoReplyWhatsapp: data.autoReplyWhatsapp });
  } catch {
    return serverError();
  }
}
