import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, unauthorized, badRequest } from "@/lib/api";
import { isSuperAdmin } from "@/lib/admin";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// KVKK / GDPR data export — SUPER-ADMIN ONLY. Returns a downloadable JSON dump
// of ONE organization's data so the operator can satisfy a host's data-access
// request. Read-only. SECRETS ARE EXCLUDED (no passwordHash, no 2FA secret, no
// encrypted Hospitable token). The export itself is audit-logged.
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  if (!isSuperAdmin(session)) return unauthorized();

  const orgId = new URL(req.url).searchParams.get("orgId") ?? "";
  if (!orgId) return badRequest({ orgId: "orgId gerekli" });

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      id: true,
      name: true,
      plan: true,
      timezone: true,
      language: true,
      alertEmail: true,
      createdAt: true,
      // Users WITHOUT secrets (no passwordHash / twoFactorSecret).
      users: { select: { id: true, name: true, email: true, role: true, createdAt: true } },
      properties: {
        select: {
          id: true,
          name: true,
          address: true,
          city: true,
          country: true,
          checkInTime: true,
          checkOutTime: true,
          notes: true,
          createdAt: true,
          reservations: true,
          conversations: {
            select: {
              id: true,
              channel: true,
              status: true,
              priority: true,
              guestIdentifier: true,
              createdAt: true,
              lastMessageAt: true,
              messages: true,
            },
          },
          tasks: true,
          knowledgeBase: true,
        },
      },
      messageTemplates: true,
    },
  });
  if (!org) return badRequest({ orgId: "İşletme bulunamadı." });

  await writeAudit({
    organizationId: orgId,
    actorUserId: session.actorUserId ?? session.userId,
    action: "data.export",
    metadata: { operatorEmail: session.actorEmail ?? session.email },
  });

  const safeName = org.name.replace(/[^a-z0-9]+/gi, "_").slice(0, 40) || "isletme";
  const filename = `lixus-export-${safeName}-${new Date().toISOString().slice(0, 10)}.json`;
  const body = JSON.stringify({ exportedAt: new Date().toISOString(), organization: org }, null, 2);

  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
