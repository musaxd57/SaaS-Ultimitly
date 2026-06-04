import { NextResponse } from "next/server";
import { requireSession, unauthorized } from "@/lib/api";
import { previewCheckins } from "@/lib/automation";

// ---------------------------------------------------------------------------
// Dry-run preview for the automatic check-in info message.
//
// POST → for upcoming confirmed reservations, build the exact check-in text
// that would be sent (with the guest's name substituted) WITHOUT sending
// anything. Ignores the on/off toggle so the host can review every apartment's
// "Giriş Talimatı" entry before going live, and flags apartments missing it.
// ---------------------------------------------------------------------------

export async function POST() {
  const session = await requireSession();
  if (!session) return unauthorized();

  try {
    const previews = await previewCheckins(session.organizationId);
    return NextResponse.json({ ok: true, previews });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Önizleme başarısız oldu.";
    return NextResponse.json({ ok: false, error: message });
  }
}
