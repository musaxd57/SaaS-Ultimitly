import { NextResponse } from "next/server";
import { requireSession, unauthorized } from "@/lib/api";
import { isHospitableConfigured } from "@/lib/hospitable";
import { syncHospitable } from "@/lib/hospitable-sync";

// ---------------------------------------------------------------------------
// Pull guest conversations from Hospitable into the inbox.
//
// POST → runs a full sync for the caller's organization. STRICTLY read-only:
// it only pulls properties / conversations / messages in. It never sends a
// message and never triggers the auto-reply pass (that is the scheduled cron's
// job, and is itself gated by AUTO_REPLY_ENABLED). Returns 200 with
// { ok: false } for expected failures so the UI can show a friendly message.
// ---------------------------------------------------------------------------

export async function POST() {
  const session = await requireSession();
  if (!session) return unauthorized();

  if (!isHospitableConfigured()) {
    return NextResponse.json({ ok: false, error: "HOSPITABLE_API_TOKEN .env dosyasında tanımlı değil." });
  }

  try {
    // A manual pull is the user explicitly asking for everything — go wide so a
    // long-ago guest who messages now is caught (the cron does this only hourly).
    const result = await syncHospitable(session.organizationId, {
      backDays: Number(process.env.HOSPITABLE_DEEP_BACK_DAYS) || 540,
      forwardDays: Number(process.env.HOSPITABLE_DEEP_FORWARD_DAYS) || 540,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Senkronizasyon başarısız oldu.";
    return NextResponse.json({ ok: false, error: message });
  }
}
