import { type NextRequest, NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/auth";
import { jsonOk } from "@/lib/api";

export async function POST() {
  await clearSessionCookie();
  return jsonOk({ ok: true });
}

// GET variant so a stale session (e.g. the database was reset/switched and the
// session points to an organization that no longer exists) can be cleared via a
// plain redirect from a Server Component, then sent to the login page.
export async function GET(req: NextRequest) {
  await clearSessionCookie();
  return NextResponse.redirect(new URL("/login", req.url));
}
