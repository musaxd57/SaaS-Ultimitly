import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, SESSION_MAX_AGE, signSession, verifySession } from "@/lib/auth/session";

const AUTH_PATHS = ["/login", "/register", "/sifremi-unuttum"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  const isAuthPage = AUTH_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
  // Public pages a logged-out visitor may see: the marketing landing ("/"), the
  // legal pages, and the auth pages. Everything else requires a session.
  // "/c" = the public guest QR concierge chat (its own token auth; no session).
  const PUBLIC_PREFIXES = ["/gizlilik", "/kosullar", "/mesafeli-satis", "/on-bilgilendirme", "/entegrasyonlar", "/c"];
  const isPublic =
    pathname === "/" || isAuthPage || PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));

  // Not signed in → only public pages are allowed.
  if (!session && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname && pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
    return NextResponse.redirect(url);
  }

  // Signed in → keep away from auth pages.
  if (session && isAuthPage) {
    const url = req.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Staff (cleaning crew) may only use the Tasks surface — every other in-app page
  // is owner/manager-only. Redirect them to /tasks so a staff member can't reach a
  // server-rendered page that would show guest messages, prices, tokens, KB, etc.
  // (The API routes enforce the SAME boundary DB-authoritatively; this is the page
  // layer. The JWT role is sufficient for a UX redirect — every mutation still hits
  // the fail-closed API guard.)
  if (session && session.role === "staff" && !isPublic) {
    const staffAllowed = pathname === "/tasks" || pathname.startsWith("/tasks/");
    if (!staffAllowed) {
      const url = req.nextUrl.clone();
      url.pathname = "/tasks";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  const res = NextResponse.next();

  // SLIDING SESSION: while signed in and active, re-issue the cookie with a fresh
  // SESSION_MAX_AGE (14-day) expiry so the window counts from the LAST activity,
  // not the first login. Active users therefore never get logged out; the session
  // only truly expires after 14 days of NO activity → then a full login is required.
  // All session fields (incl. impersonation actor*) are preserved on re-sign.
  if (session) {
    const fresh = await signSession(session);
    res.cookies.set(SESSION_COOKIE, fresh, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });
  }

  return res;
}

export const config = {
  // Run on everything except API routes, Next internals, and static files.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
