import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { forbidden } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// KVKK m.11 SELF-SERVE data access — the HOST exports THEIR OWN organization's
// data (no operator needed). Scoped strictly to session.organizationId and
// gated to owner/manager (canManage). Mirrors the operator export's allowlist:
// SECRETS ARE EXCLUDED (no passwordHash, no 2FA secret, no encrypted token).
// Audit-logged.
// ---------------------------------------------------------------------------
export const GET = withManage(async (session) => {
  const org = await prisma.organization.findUnique({
    where: { id: session.organizationId },
    select: {
      id: true,
      name: true,
      plan: true,
      timezone: true,
      language: true,
      alertEmail: true,
      createdAt: true,
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
          reservations: {
            select: {
              id: true, guestName: true, guestPhone: true, guestEmail: true,
              arrivalDate: true, departureDate: true, channel: true, status: true,
              totalAmount: true, totalAmountDec: true, currency: true, notes: true, guestCheckoutTime: true,
              createdAt: true,
            },
          },
          conversations: {
            select: {
              id: true,
              channel: true,
              status: true,
              priority: true,
              guestIdentifier: true,
              createdAt: true,
              lastMessageAt: true,
              messages: {
                select: {
                  id: true, direction: true, senderName: true, body: true,
                  language: true, createdAt: true,
                },
              },
            },
          },
          tasks: {
            select: {
              id: true, type: true, title: true, description: true, status: true,
              priority: true, dueAt: true, createdAt: true,
            },
          },
          knowledgeBase: {
            select: {
              id: true, category: true, title: true, content: true,
              language: true, isActive: true, createdAt: true,
            },
          },
        },
      },
      messageTemplates: {
        select: {
          id: true, category: true, title: true, body: true,
          language: true, isActive: true, createdAt: true,
        },
      },
    },
  });
  if (!org) return forbidden();

  await writeAudit({
    organizationId: session.organizationId,
    actorUserId: session.actorUserId ?? session.userId,
    action: "data.export_self",
    metadata: { email: session.email },
  });

  const safeName = org.name.replace(/[^a-z0-9]+/gi, "_").slice(0, 40) || "isletme";
  const filename = `lixus-verilerim-${safeName}-${new Date().toISOString().slice(0, 10)}.json`;
  const body = JSON.stringify({ exportedAt: new Date().toISOString(), organization: org }, null, 2);

  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});
