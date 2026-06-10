import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { conversationCreateSchema, zodFieldErrors } from "@/lib/validators";
import {
  requireSession,
  unauthorized,
  badRequest,
  jsonOk,
  serverError,
  propertyInOrg,
  canManage,
  forbidden,
} from "@/lib/api";
import { applyInboundMessageRules } from "@/lib/automation";

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") ?? undefined;

  const conversations = await prisma.conversation.findMany({
    where: {
      property: { organizationId: session.organizationId },
      ...(status ? { status } : {}),
    },
    include: {
      property: { select: { name: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { lastMessageAt: "desc" },
  });
  return jsonOk(conversations);
}

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  // Creating a conversation is an owner/manager action; staff are read + tasks.
  if (!canManage(session)) return forbidden();
  try {
    const data = await req.json().catch(() => null);
    const parsed = conversationCreateSchema.safeParse(data);
    if (!parsed.success) return badRequest(zodFieldErrors(parsed.error));
    const d = parsed.data;

    if (!(await propertyInOrg(d.propertyId, session.organizationId))) {
      return badRequest({ propertyId: "Geçersiz mülk" });
    }

    // The reservation (if linked) must belong to the SAME org AND property — never
    // trust a client-supplied reservationId, or another tenant's guest data could
    // be shown in this org's conversation sidebar.
    if (d.reservationId) {
      const reservation = await prisma.reservation.findFirst({
        where: {
          id: d.reservationId,
          propertyId: d.propertyId,
          property: { organizationId: session.organizationId },
        },
        select: { id: true },
      });
      if (!reservation) return badRequest({ reservationId: "Geçersiz rezervasyon" });
    }

    const conversation = await prisma.conversation.create({
      data: {
        propertyId: d.propertyId,
        reservationId: d.reservationId || null,
        guestIdentifier: d.guestIdentifier,
        channel: d.channel,
        priority: d.priority,
        status: "new",
        messages: {
          create: {
            direction: "inbound",
            senderName: d.guestIdentifier,
            body: d.firstMessage,
          },
        },
      },
    });

    // Classify + escalate if needed (fixed rules).
    await applyInboundMessageRules(conversation.id, d.firstMessage);

    return jsonOk(conversation, 201);
  } catch {
    return serverError();
  }
}
