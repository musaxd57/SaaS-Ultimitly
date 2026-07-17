import { NextResponse } from "next/server";
import { paymentRequired, tooManyRequests } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { premiumAllowed } from "@/lib/billing/subscription";
import { rateLimit } from "@/lib/rate-limit";
import { previewCheckouts } from "@/lib/automation";

// Dry-run preview for the automatic check-out message — builds the exact text
// that would be sent for upcoming departures, WITHOUT sending anything.
// withManage: owner/manager only (parity with ai/test) — surfaces departing
// guests' names + booking details the staff clamp is designed to withhold.
export const POST = withManage(async (session) => {
  if (!(await premiumAllowed(session.organizationId))) return paymentRequired();

  const limited = await rateLimit(`preview-checkout:${session.userId}`, 6, 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  try {
    const previews = await previewCheckouts(session.organizationId);
    return NextResponse.json({ ok: true, previews });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Önizleme başarısız oldu.";
    return NextResponse.json({ ok: false, error: message });
  }
});
