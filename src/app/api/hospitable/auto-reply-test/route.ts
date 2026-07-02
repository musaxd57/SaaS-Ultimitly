import { NextResponse } from "next/server";
import { requireSession, unauthorized, paymentRequired, tooManyRequests } from "@/lib/api";
import { premiumAllowed } from "@/lib/billing/subscription";
import { rateLimit } from "@/lib/rate-limit";
import { previewChannelAutoReplies } from "@/lib/automation";

// ---------------------------------------------------------------------------
// Dry-run preview for the channel (Airbnb / Booking) AI auto-reply.
//
// POST → for every conversation awaiting a reply, compute what the AI WOULD
// auto-send — without sending or saving anything. Lets the user judge quality
// before turning the live night auto-reply on. Ignores the on/off toggle and
// the active-hours window on purpose, so it works any time of day.
// ---------------------------------------------------------------------------

export async function POST() {
  const session = await requireSession();
  if (!session) return unauthorized();
  if (!(await premiumAllowed(session.organizationId))) return paymentRequired();

  // This preview fans out one model call per awaiting conversation on the shared
  // platform key — throttle per user so it can't be POST-spammed for cost.
  const limited = rateLimit(`preview-autoreply:${session.userId}`, 6, 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  try {
    const outcomes = await previewChannelAutoReplies(session.organizationId);
    const previews = outcomes.map((o) => ({
      guestIdentifier: o.guestIdentifier ?? "Misafir",
      propertyName: o.propertyName ?? "",
      // "would send" when a draft passed the safety gate; otherwise it waits for a human.
      wouldSend: Boolean(o.draft),
      reply: o.draft?.reply ?? null,
      confidence: o.draft?.confidence ?? null,
      reason: o.draft ? null : o.skippedReason ?? null,
    }));
    return NextResponse.json({ ok: true, previews });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Önizleme başarısız oldu.";
    return NextResponse.json({ ok: false, error: message });
  }
}
