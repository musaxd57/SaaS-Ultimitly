import { type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession, unauthorized, badRequest, notFound, jsonOk, serverError, readJsonCappedOrNull, forbidden } from "@/lib/api";
import { isSuperAdmin } from "@/lib/admin";
import { isImpersonating, OPERATOR_SUPPORT_VIEW_MESSAGE } from "@/lib/auth/impersonation";
import { logEvent } from "@/lib/event-log";

// ---------------------------------------------------------------------------
// Operator panel: mini sales pipeline on landing-page leads. SUPER-ADMIN ONLY
// (leads are marketing data with no organization — org-scoping doesn't apply,
// so the operator gate is the whole authorization story here).
// ---------------------------------------------------------------------------

const LEAD_STATUSES = ["new", "contacted", "demo", "won", "lost"] as const;

const patchSchema = z
  .object({
    status: z.enum(LEAD_STATUSES).optional(),
    note: z.string().trim().max(2000).nullable().optional(),
    // ISO date string (or null to clear). Coerced+validated below so a bad
    // date can never be written.
    followUpAt: z.string().trim().max(40).nullable().optional(),
  })
  .strict();

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!session) return unauthorized();
  if (!isSuperAdmin(session)) return unauthorized();
  // Destek görünümünde operatör yazması YOK — önce çıkış (kurucu kararı 10-11; `OPERATOR_SUPPORT_VIEW_MESSAGE`).
  if (isImpersonating(session)) return forbidden(OPERATOR_SUPPORT_VIEW_MESSAGE);

  try {
    const { id } = await ctx.params;
    const parsed = patchSchema.safeParse(await readJsonCappedOrNull(req));
    if (!parsed.success) return badRequest({ form: "Geçersiz istek" });
    const { status, note, followUpAt } = parsed.data;

    let followUpDate: Date | null | undefined;
    if (followUpAt !== undefined) {
      if (followUpAt === null || followUpAt === "") {
        followUpDate = null;
      } else {
        const d = new Date(followUpAt);
        if (Number.isNaN(d.getTime())) return badRequest({ followUpAt: "Geçersiz tarih" });
        followUpDate = d;
      }
    }

    const existing = await prisma.lead.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return notFound();

    const lead = await prisma.lead.update({
      where: { id },
      data: {
        ...(status !== undefined ? { status, handled: status !== "new" } : {}),
        ...(note !== undefined ? { note: note || null } : {}),
        ...(followUpDate !== undefined ? { followUpAt: followUpDate } : {}),
      },
    });
    // İz (güvenlik 2. tur 10-22): operatörün tek izsiz yazmasıydı. Alan ADLARI + yeni durum; not / tarih değeri günlüğe girmez.
    const fields = [status !== undefined && "status", note !== undefined && "note", followUpDate !== undefined && "followUpAt"].filter(Boolean);
    await logEvent(
      "operator.lead.updated",
      { leadId: lead.id, actorUserId: session.actorUserId ?? session.userId, context: fields.join(".") || "none", status: lead.status },
      { organizationId: null },
    );
    return jsonOk({ ok: true, lead: { id: lead.id, status: lead.status, note: lead.note, followUpAt: lead.followUpAt } });
  } catch (err) {
    return serverError(undefined, err);
  }
}
