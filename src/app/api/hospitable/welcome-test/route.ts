import { NextResponse } from "next/server";
import { paymentRequired, tooManyRequests } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { premiumAllowed } from "@/lib/billing/subscription";
import { rateLimit } from "@/lib/rate-limit";
import { previewWelcomes } from "@/lib/automation";

// ---------------------------------------------------------------------------
// Dry-run preview for the automatic welcome message.
//
// POST → for upcoming confirmed reservations, build the exact welcome text that
// would be sent (with the guest's name substituted) WITHOUT sending anything.
// Ignores the on/off toggles so the host can review every apartment's welcome
// before going live, and flags apartments still missing a welcome entry.
// ---------------------------------------------------------------------------

// withManage: owner/manager only (parity with ai/test) — surfaces upcoming
// guests' names + booking details the staff clamp is designed to withhold.
export const POST = withManage(async (session) => {
  if (!(await premiumAllowed(session.organizationId))) return paymentRequired();

  const limited = await rateLimit(`preview-welcome:${session.userId}`, 6, 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  try {
    const previews = await previewWelcomes(session.organizationId);
    return NextResponse.json({ ok: true, previews });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Önizleme başarısız oldu.";
    return NextResponse.json({ ok: false, error: message });
  }
});
