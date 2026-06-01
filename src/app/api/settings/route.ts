import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, unauthorized, badRequest, jsonOk, serverError } from "@/lib/api";

// Organization-level settings the UI can toggle. Booleans are the auto-reply
// switches; the two hour fields define the channel auto-reply active window.
const BOOLEAN_FIELDS = ["autoReplyHospitable"] as const;
const HOUR_FIELDS = ["autoReplyStartHour", "autoReplyEndHour"] as const;

/** Update organization-level settings (auto-reply toggles + active-hours window). */
export async function PATCH(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();

  try {
    const data = await req.json().catch(() => null);
    if (!data || typeof data !== "object") {
      return badRequest({ _: "Geçerli bir gövde gerekli." });
    }

    const update: Record<string, boolean | number> = {};
    const errors: Record<string, string> = {};

    for (const field of BOOLEAN_FIELDS) {
      if (field in data) {
        if (typeof data[field] !== "boolean") errors[field] = "true/false olmalı.";
        else update[field] = data[field];
      }
    }
    for (const field of HOUR_FIELDS) {
      if (field in data) {
        const n = Number(data[field]);
        if (!Number.isInteger(n) || n < 0 || n > 23) errors[field] = "0-23 arası bir saat olmalı.";
        else update[field] = n;
      }
    }

    if (Object.keys(errors).length > 0) return badRequest(errors);
    if (Object.keys(update).length === 0) {
      return badRequest({ _: "Güncellenecek geçerli bir alan yok." });
    }

    await prisma.organization.update({
      where: { id: session.organizationId },
      data: update,
    });

    return jsonOk(update);
  } catch {
    return serverError();
  }
}
