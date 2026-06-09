import { NextResponse } from "next/server";
import { requireSession, unauthorized, tooManyRequests } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { hasOrgHospitable } from "@/lib/hospitable-credentials";
import { syncHospitable } from "@/lib/hospitable-sync";
import { withSyncLock } from "@/lib/scheduled-sync";

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

  // A manual sync is a wide Hospitable sweep — throttle per org so the button
  // can't be spammed into the channel's own rate limit.
  const limited = rateLimit(`manual-sync:${session.organizationId}`, 6, 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  if (!(await hasOrgHospitable(session.organizationId))) {
    return NextResponse.json({ ok: false, error: "Hospitable bağlı değil. Ayarlar'dan hesabınızı bağlayın." });
  }

  try {
    // A manual pull is the user explicitly asking for everything — go wide so a
    // long-ago guest who messages now is caught (the cron does this only hourly).
    // Run under the shared sync lock so a manual pull can never overlap the cron
    // and create duplicate reservation/conversation rows.
    const result = await withSyncLock(() =>
      syncHospitable(session.organizationId, {
        backDays: Number(process.env.HOSPITABLE_DEEP_BACK_DAYS) || 540,
        forwardDays: Number(process.env.HOSPITABLE_DEEP_FORWARD_DAYS) || 540,
      }),
    );
    if ("locked" in result) {
      return NextResponse.json({
        ok: false,
        error: "Senkron şu an çalışıyor, lütfen birkaç saniye sonra tekrar deneyin.",
      });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Senkronizasyon başarısız oldu.";
    return NextResponse.json({ ok: false, error: message });
  }
}
