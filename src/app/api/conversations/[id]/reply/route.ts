import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { conversationReplySchema, zodFieldErrors } from "@/lib/validators";
import { sendOnChannel } from "@/lib/messaging";
import { getOrgHospitableToken } from "@/lib/hospitable-credentials";
import {
  requireSession,
  unauthorized,
  badRequest,
  jsonOk,
  notFound,
  serverError,
  tooManyRequests,
  canManage,
  forbidden,
} from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { translateText } from "@/lib/ai/translate";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const session = await requireSession();
  if (!session) return unauthorized();
  // Only owner/manager may send guest-facing replies. Staff are read + task
  // updates; the inbound-message and status routes stay open for their triage.
  if (!canManage(session)) return forbidden();
  const { id } = await params;

  // Each reply sends to Hospitable (+ optional OpenAI translate). Throttle per
  // conversation so a stuck client or abuse can't spam the guest / burn quota.
  const limited = rateLimit(`reply:${id}`, 20, 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  try {
    const conversation = await prisma.conversation.findFirst({
      where: { id, property: { organizationId: session.organizationId } },
      select: {
        id: true,
        channel: true,
        guestIdentifier: true,
        externalReservationId: true,
      },
    });
    if (!conversation) return notFound();

    const rawData = await req.json().catch(() => null);
    const parsed = conversationReplySchema.safeParse(rawData);
    if (!parsed.success) return badRequest(zodFieldErrors(parsed.error));

    // Optional: translate the reply before sending/saving. Cap the length — this
    // value is forwarded to a paid translate call, so never accept an unbounded
    // string (a valid language name/code is short).
    const translateRaw = typeof rawData?.translateTo === "string" ? rawData.translateTo.trim() : "";
    const translateTo: string | undefined =
      translateRaw && translateRaw.length <= 20 ? translateRaw : undefined;

    let replyBody = parsed.data.body;
    if (translateTo) {
      replyBody = await translateText(replyBody, translateTo);
    }

    // Deliver on the guest's channel FIRST — don't persist a reply that never
    // reached the guest (Airbnb/Booking via Hospitable, or WhatsApp). Use this
    // org's own Hospitable token (multi-tenant).
    const token = await getOrgHospitableToken(session.organizationId);
    if (conversation.externalReservationId && !token) {
      return NextResponse.json(
        { error: "Hospitable bağlı değil — mesaj gönderilemiyor. Ayarlar'dan bağlayın." },
        { status: 502 },
      );
    }
    const outcome = await sendOnChannel(conversation, replyBody, token ?? undefined);
    if (!outcome.ok) {
      return NextResponse.json(
        { error: `Mesaj gönderilemedi: ${outcome.error ?? "bilinmeyen hata"}` },
        { status: 502 },
      );
    }

    const now = new Date();
    const [message] = await prisma.$transaction([
      prisma.message.create({
        data: {
          conversationId: id,
          direction: "outbound",
          senderName: parsed.data.senderName || session.name,
          body: replyBody,
        },
      }),
      prisma.conversation.update({
        where: { id },
        data: { status: "answered", lastMessageAt: now },
      }),
    ]);

    return jsonOk(message, 201);
  } catch {
    return serverError();
  }
}
