import { type NextRequest, NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/auth";
import { jsonOk } from "@/lib/api";
import { baseUrlFromHost } from "@/lib/auth/email-verify";

export async function POST() {
  await clearSessionCookie();
  return jsonOk({ ok: true });
}

// GET variant so a stale session (e.g. the database was reset/switched, or
// sessionEpoch no longer matches after a password change) can be cleared via a
// plain redirect from a Server Component, then sent to the login page.
export async function GET(req: NextRequest) {
  await clearSessionCookie();
  // Behind Railway, req.url's origin is the INTERNAL container address
  // (localhost:xxxx), not the public domain — build from the Host header
  // instead (same fix as the Hospitable OAuth routes; see email-verify.ts).
  const base = baseUrlFromHost(req.headers.get("host"));
  return NextResponse.redirect(`${base}/login`);
}
