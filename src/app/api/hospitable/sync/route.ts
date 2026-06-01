import { NextResponse } from "next/server";
import { requireSession, unauthorized } from "@/lib/api";
import { isHospitableConfigured } from "@/lib/hospitable";
import { syncHospitable } from "@/lib/hospitable-sync";
import { runDueChannelAutoReplies } from "@/lib/automation";

// ---------------------------------------------------------------------------
// Pull guest conversations from Hospitable into the inbox.
//
// POST → runs a full sync for the caller's organization. Read-only against
// Hospitable (nothing is sent). Returns 200 with { ok: false } for expected
// failures so the UI can show a friendly message.
// ---------------------------------------------------------------------------

export async function POST() {
  const session = await requireSession();
  if (!session) return unauthorized();

  if (!isHospitableConfigured()) {
    return NextResponse.json({ ok: false, error: "HOSPITABLE_API_TOKEN .env dosyasında tanımlı değil." });
  }

  try {
    const result = await syncHospitable(session.organizationId);
    // After pulling new messages, run the night auto-reply pass. This is a no-op
    // unless auto-reply is enabled AND we are inside the active-hours window.
    const auto = await runDueChannelAutoReplies(session.organizationId);
    return NextResponse.json({ ok: true, ...result, autoReplies: auto.sent });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Senkronizasyon başarısız oldu.";
    return NextResponse.json({ ok: false, error: message });
  }
}
