import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { aiSuggestSchema } from "@/lib/validators";
import { suggestReply } from "@/lib/ai";
import { getAdjacency } from "@/lib/turnover";
import {
  requireSession,
  unauthorized,
  badRequest,
  jsonOk,
  notFound,
  serverError,
  tooManyRequests,
  paymentRequired,
} from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { premiumAllowed } from "@/lib/billing/subscription";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const { id } = await params;

  // Paid AI feature: blocked once the trial lapses (dormant-safe until enforced).
  if (!(await premiumAllowed(session.organizationId))) return paymentRequired();

  // Each suggestion calls OpenAI ($). Throttle per user to cap spend on abuse.
  const limited = rateLimit(`ai-suggest:${session.userId}`, 20, 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  try {
    const conversation = await prisma.conversation.findFirst({
      where: { id, property: { organizationId: session.organizationId } },
      include: {
        property: true,
        reservation: true,
        messages: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!conversation) return notFound();

    const parsed = aiSuggestSchema.safeParse((await req.json().catch(() => ({}))) ?? {});
    const tone = parsed.success ? parsed.data.tone : "warm";

    const lastInbound = [...conversation.messages]
      .reverse()
      .find((m) => m.direction === "inbound");
    if (!lastInbound) {
      return badRequest({ _: "Öneri üretmek için bir misafir mesajı gerekli" });
    }

    const kbRaw = await prisma.knowledgeBaseItem.findMany({
      where: { propertyId: conversation.propertyId, isActive: true },
      select: { category: true, title: true, content: true },
    });
    // Resolve any {isim} placeholder (e.g. in the welcome template) to the
    // guest's name so a literal "{isim}" can never appear in the suggestion.
    const firstWord = conversation.guestIdentifier?.trim().split(/\s+/)[0] ?? "";
    const guestFirst =
      !firstWord || firstWord === "Rezervasyon" || firstWord === "Misafir"
        ? "misafirimiz"
        : firstWord;
    // Resolve {daire}/{apartment} to the apartment number (e.g. "nuve 3" → "3").
    const aptNumber = conversation.property.name.match(/\d+/g)?.pop() ?? conversation.property.name;
    const kb = kbRaw.map((k) => ({
      ...k,
      content: k.content
        .replace(/\{\s*(isim|ad|name)\s*\}/gi, guestFirst)
        .replace(/\{\s*(daire|apartment|apt)\s*\}/gi, aptNumber),
    }));

    // Same learned style profile the auto-reply pass uses, for consistent voice.
    const org = await prisma.organization.findUnique({
      where: { id: session.organizationId },
      select: { aiStyleProfile: true },
    });

    // Turnover context (neighbouring bookings) for early-checkin/late-checkout.
    const adjacency = conversation.reservation
      ? await getAdjacency(
          conversation.propertyId,
          conversation.reservation.arrivalDate,
          conversation.reservation.departureDate,
        )
      : null;

    const result = await suggestReply({
      guestMessage: lastInbound.body,
      property: {
        name: conversation.property.name,
        checkInTime: conversation.property.checkInTime,
        checkOutTime: conversation.property.checkOutTime,
        address: conversation.property.address,
        city: conversation.property.city,
      },
      reservation: conversation.reservation
        ? {
            guestName: conversation.reservation.guestName,
            arrivalDate: conversation.reservation.arrivalDate,
            departureDate: conversation.reservation.departureDate,
            status: conversation.reservation.status,
            guestCheckoutTime: conversation.reservation.guestCheckoutTime,
          }
        : null,
      knowledgeBase: kb,
      history: conversation.messages.map((m) => ({
        direction: m.direction as "inbound" | "outbound",
        body: m.body,
      })),
      tone,
      language: lastInbound.language || "tr",
      styleProfile: org?.aiStyleProfile,
      adjacency,
    });

    await prisma.message.update({
      where: { id: lastInbound.id },
      data: {
        aiSuggestedReply: result.reply,
        aiConfidence: result.confidence,
        aiIntent: result.intent,
      },
    });

    return jsonOk(result);
  } catch {
    return serverError();
  }
}
