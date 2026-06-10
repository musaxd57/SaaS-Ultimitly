import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, unauthorized, badRequest, jsonOk, serverError, canManage, forbidden } from "@/lib/api";

// Organization-level settings the UI can change. Booleans are the auto-reply
// switches; the hour fields define the channel auto-reply active window;
// aiReplyTone / aiSignature shape the AI's voice.
const BOOLEAN_FIELDS = ["autoReplyHospitable", "autoWelcome", "autoCheckin", "autoCheckout"] as const;
const HOUR_FIELDS = ["autoReplyStartHour", "autoReplyEndHour"] as const;
const VALID_TONES = ["formal", "warm", "short", "luxury"] as const;
const SIGNATURE_MAX = 600;

/** Update organization-level settings (auto-reply window/toggle + AI tone/signature). */
export async function PATCH(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  if (!canManage(session)) return forbidden();

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
    // Stamp *EnabledAt ONLY on a genuine OFF→ON transition, so the engine acts
    // only on bookings/messages from when automation was actually switched on
    // (never the backlog). Re-saving other settings while a toggle is already on
    // must NOT push the baseline forward — that would silently skip messages for
    // bookings already in the pipeline.
    const enabling = (["autoReplyHospitable", "autoWelcome", "autoCheckin", "autoCheckout"] as const).filter(
      (f) => update[f] === true,
    );
    if (enabling.length > 0) {
      const current = await prisma.organization.findUnique({
        where: { id: session.organizationId },
        select: {
          autoReplyHospitable: true,
          autoWelcome: true,
          autoCheckin: true,
          autoCheckout: true,
        },
      });
      const nowIso = new Date().toISOString();
      const stampOf = {
        autoReplyHospitable: "autoReplyEnabledAt",
        autoWelcome: "autoWelcomeEnabledAt",
        autoCheckin: "autoCheckinEnabledAt",
        autoCheckout: "autoCheckoutEnabledAt",
      } as const;
      for (const f of enabling) {
        if (current?.[f] !== true) update[stampOf[f]] = nowIso;
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

    if ("alertEmail" in data) {
      const raw = data.alertEmail;
      if (raw !== null && typeof raw !== "string") {
        errors.alertEmail = "Metin olmalı.";
      } else {
        const trimmed = (raw ?? "").toString().trim();
        if (trimmed && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) {
          errors.alertEmail = "Geçerli bir e-posta girin.";
        } else {
          // Empty clears it → falls back to the env ALERT_EMAIL.
          update.alertEmail = trimmed.length === 0 ? null : trimmed.toLowerCase();
        }
      }
    }

    if ("autoReplyDisclosure" in data) {
      if (typeof data.autoReplyDisclosure !== "boolean") errors.autoReplyDisclosure = "true/false olmalı.";
      else update.autoReplyDisclosure = data.autoReplyDisclosure;
    }

    if ("handoffHoldHours" in data) {
      const n = Number(data.handoffHoldHours);
      if (!Number.isInteger(n) || n < 0 || n > 72) errors.handoffHoldHours = "0-72 arası saat olmalı.";
      else update.handoffHoldHours = n;
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
  } catch (err) {
    return serverError(undefined, err);
  }
}
