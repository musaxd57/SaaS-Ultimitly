import { NextResponse } from "next/server";
import { requireSession, unauthorized, paymentRequired, tooManyRequests } from "@/lib/api";
import { premiumAllowed } from "@/lib/billing/subscription";
import { rateLimit } from "@/lib/rate-limit";
import { previewCheckouts } from "@/lib/automation";

// Dry-run preview for the automatic check-out message — builds the exact text
// that would be sent for upcoming departures, WITHOUT sending anything.
export async function POST() {
  const session = await requireSession();
  if (!session) return unauthorized();
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
}
