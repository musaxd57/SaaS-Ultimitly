import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db-errors";
import { conversationReplySchema, zodFieldErrors } from "@/lib/validators";
import { sendOnChannel } from "@/lib/messaging";
import { getOrgHospitableToken } from "@/lib/hospitable-credentials";
import { badRequest, jsonOk, notFound, tooManyRequests, paymentRequired } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { rateLimit } from "@/lib/rate-limit";
import { premiumAllowed } from "@/lib/billing/subscription";
import { translate } from "@/lib/ai/translate";
import { claimOutboundSend, releaseOutboundSend } from "@/lib/outbound-claim";

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
    // FAIL-CLOSED (Codex #30): a failed translation used to fall through as the
    // ORIGINAL text — the guest received an untranslated message while the host
    // believed it went out in their language. No send on translate failure; the
    // host can retry or deliberately send without translation.
    const translated = await translate(replyBody, translateTo);
    if (!translated.ok) {
      return NextResponse.json(
        { error: "Çeviri başarısız — mesaj GÖNDERİLMEDİ. Tekrar deneyin veya çeviriyi kapatıp gönderin." },
        { status: 502 },
      );
    }
    replyBody = translated.text;
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
  // Duplicate guard (claim-then-send, like auto-reply): a double-click / browser
  // retry with the SAME text must not reach the guest twice. Keyed on the RAW
  // typed body so both duplicates map to the same claim even when translate is on.
  const claimed = await claimOutboundSend(id, parsed.data.body);
  if (claimed === "duplicate") {
    return NextResponse.json(
      { error: "Bu mesaj az önce gönderildi veya hâlâ gönderiliyor." },
      { status: 409 },
    );
  }
  if (claimed === "unavailable") {
    return NextResponse.json(
      { error: "Şu anda gönderilemedi — lütfen birazdan tekrar deneyin." },
      { status: 503 },
    );
  }
  const outcome = await sendOnChannel(conversation, replyBody, token ?? undefined);
  if (!outcome.ok) {
    // DEFINITIVE provider rejection (HTTP 4xx incl. 429; not 408) → nothing was
    // delivered → release so the same text is retryable now. Anything else
    // (timeout / network / 5xx) is AMBIGUOUS — the message MAY have reached the
    // guest despite the error (Codex: this claim is dedup, not an outbox) — so
    // the claim stays held for its TTL and the user is told to CHECK the thread
    // before resending; the next sync imports the message if it did deliver.
    const definitive = /HTTP (4\d\d)/.test(outcome.error ?? "") && !/HTTP 408/.test(outcome.error ?? "");
    if (definitive) {
      await releaseOutboundSend(id, parsed.data.body);
      return NextResponse.json(
        { error: `Mesaj gönderilemedi: ${outcome.error ?? "bilinmeyen hata"}` },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { error: "Gönderim doğrulanamadı — mesaj ulaşmış olabilir. Tekrar göndermeden önce konuşmayı kontrol edin.", ambiguous: true },
      { status: 502 },
    );
  }

  const now = new Date();
  let message;
  try {
    [message] = await prisma.$transaction([
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
  } catch (err) {
    // Delivery already succeeded; a dedupe-hit on the new
    // @@unique([conversationId, externalId]) means a concurrent sync imported
    // this very reply first. Adopt the existing row and still mark answered.
    if (!isUniqueViolation(err, ["conversationId", "externalId"])) throw err;
    message = await prisma.message.findFirst({
      where: { conversationId: id, externalId: outcome.providerMessageId ?? undefined },
    });
    await prisma.conversation.update({ where: { id }, data: { status: "answered", lastMessageAt: now } });
  }

  return jsonOk(message, 201);
});
