import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, unauthorized, badRequest, jsonOk, serverError } from "@/lib/api";

// Organization-level settings the UI can change. Booleans are the auto-reply
// switches; the hour fields define the channel auto-reply active window;
// aiReplyTone / aiSignature shape the AI's voice.
const BOOLEAN_FIELDS = ["autoReplyHospitable"] as const;
const HOUR_FIELDS = ["autoReplyStartHour", "autoReplyEndHour"] as const;
const VALID_TONES = ["formal", "warm", "short", "luxury"] as const;
const SIGNATURE_MAX = 600;

/** Update organization-level settings (auto-reply window/toggle + AI tone/signature). */
export async function PATCH(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();

  try {
    const data = await req.json().catch(() => null);
    if (!data || typeof data !== "object") {
      return badRequest({ _: "Geçerli bir gövde gerekli." });
    }

    const update: Record<string, boolean | number | string | null> = {};
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

    if ("aiReplyTone" in data) {
      if (!VALID_TONES.includes(data.aiReplyTone)) {
        errors.aiReplyTone = "Geçersiz ton.";
      } else {
        update.aiReplyTone = data.aiReplyTone;
      }
    }

    if ("aiSignature" in data) {
      const raw = data.aiSignature;
      if (raw !== null && typeof raw !== "string") {
        errors.aiSignature = "Metin olmalı.";
      } else {
        const trimmed = (raw ?? "").toString().trim();
        if (trimmed.length > SIGNATURE_MAX) {
          errors.aiSignature = `En fazla ${SIGNATURE_MAX} karakter.`;
        } else {
          // Empty string clears the signature.
          update.aiSignature = trimmed.length === 0 ? null : trimmed;
        }
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
