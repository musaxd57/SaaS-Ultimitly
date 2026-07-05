import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { conversationReplySchema, zodFieldErrors } from "@/lib/validators";
import { sendOnChannel } from "@/lib/messaging";
import { getOrgHospitableToken } from "@/lib/hospitable-credentials";
import { badRequest, jsonOk, notFound, tooManyRequests, paymentRequired } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { rateLimit } from "@/lib/rate-limit";
import { premiumAllowed } from "@/lib/billing/subscription";
import { translateText } from "@/lib/ai/translate";

// Only owner/manager may send guest-facing replies (withManage). Staff are read +
// task updates; the inbound-message and status routes stay open for their triage.
export const POST = withManage<{ id: string }>(async (session, req, { params }) => {
  const { id } = await params;

  // Each reply sends to Hospitable (+ optional OpenAI translate). Throttle per
  // conversation so a stuck client or abuse can't spam the guest / burn quota.
  const limited = rateLimit(`reply:${id}`, 20, 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

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

  // Credit AI-assisted approvals in reports: set by the client when the host
  // clicks "Onayla ve gönder" on an AI draft (vs typing a manual reply).
  const aiAssisted = rawData?.aiAssisted === true;

  let replyBody = parsed.data.body;
  if (translateTo) {
    // Translate is a paid AI feature — gate it in the freemium tier so a lapsed
    // org can't burn OpenAI via the manual reply path. The manual send itself
    // stays free; only the optional translate add-on is premium.
    if (!(await premiumAllowed(session.organizationId))) return paymentRequired();
    replyBody = await translateText(replyBody, translateTo);
  }

  // Deliver on the guest's channel FIRST — don't persist a reply that never
  // reached the guest (Airbnb/Booking via Hospitable, or WhatsApp). Use this
  // org's own Hospitable token (multi-tenant).
  // Internal QR-concierge threads have no external channel, so they don't need
  // (and must not require) a Hospitable connection — the reply is just recorded.
  const isInternal = conversation.externalReservationId?.startsWith("qr-chat:") ?? false;
  const token = await getOrgHospitableToken(session.organizationId);
  if (!isInternal && conversation.externalReservationId && !token) {
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
        aiAssisted,
        // Store the provider's message id so the sync re-importing this reply from
        // the channel thread dedups it instead of creating a duplicate row.
        ...(outcome.providerMessageId ? { externalId: outcome.providerMessageId } : {}),
      },
    }),
    prisma.conversation.update({
      where: { id },
      data: { status: "answered", lastMessageAt: now },
    }),
  ]);

  return jsonOk(message, 201);
});
