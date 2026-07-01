import { NextResponse } from "next/server";
import { requireSession, unauthorized, paymentRequired } from "@/lib/api";
import { premiumAllowed } from "@/lib/billing/subscription";
import { previewCheckouts } from "@/lib/automation";

// Dry-run preview for the automatic check-out message — builds the exact text
// that would be sent for upcoming departures, WITHOUT sending anything.
export async function POST() {
  const session = await requireSession();
  if (!session) return unauthorized();
  if (!(await premiumAllowed(session.organizationId))) return paymentRequired();

  try {
    const previews = await previewCheckouts(session.organizationId);
    return NextResponse.json({ ok: true, previews });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Önizleme başarısız oldu.";
    return NextResponse.json({ ok: false, error: message });
  }
}
