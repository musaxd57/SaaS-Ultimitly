import { type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession, unauthorized, badRequest, notFound, jsonOk, serverError } from "@/lib/api";
import { isSuperAdmin } from "@/lib/admin";

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

  try {
    const { id } = await ctx.params;
    const parsed = patchSchema.safeParse(await req.json().catch(() => null));
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
    return jsonOk({ ok: true, lead: { id: lead.id, status: lead.status, note: lead.note, followUpAt: lead.followUpAt } });
  } catch (err) {
    return serverError(undefined, err);
  }
}
