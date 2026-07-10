import { prisma } from "@/lib/db";
import { conversationCreateSchema, zodFieldErrors } from "@/lib/validators";
import { badRequest, jsonOk, propertyInOrg } from "@/lib/api";
import { withAuth, withManage } from "@/lib/route-guard";
import { applyInboundMessageRules } from "@/lib/automation";

export const GET = withAuth(async (session, req) => {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") ?? undefined;

  const conversations = await prisma.conversation.findMany({
    where: {
      property: { organizationId: session.organizationId },
      channel: { not: "chat" }, // QR guest chats live in their own "Misafir Sohbetleri" tab
      ...(status ? { status } : {}),
    },
    include: {
      property: { select: { name: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { lastMessageAt: "desc" },
    take: 500, // bound the payload — full thread rows, no pagination yet
  });
  return jsonOk(conversations);
});

// Creating a conversation is an owner/manager action; staff are read + tasks.
export const POST = withManage(async (session, req) => {
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
});
