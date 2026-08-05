import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, SESSION_MAX_AGE, signSession, verifySession } from "@/lib/auth/session";

/** Oturum GEREKTİRMEYEN kimlik sayfaları — çıkış yapmış ziyaretçi görebilir. */
const AUTH_PATHS = ["/login", "/register", "/sifremi-unuttum", "/e-posta-dogrula"];

/**
 * Oturum AÇIKKEN panele geri yollanan kimlik sayfaları.
 *
 * 🚨 `/sifremi-unuttum` BİLİNÇLİ OLARAK DIŞARIDA (08-02, Codex). Sıfırlama
 * e-postasındaki bağlantı bu sayfaya gelir; hesabına o tarayıcıdan girmiş bir
 * kullanıcı tıkladığında panele yönlendiriliyor ve sıfırlamayı HİÇ
 * yapamıyordu. Üstelik tarayıcı, yönlendirme hedefinde fragment yoksa
 * kaynağınkini TAŞIDIĞI için token `/dashboard#t=...` olarak adres çubuğunda
 * kalıyordu — sayfanın `history.replaceState` temizliği orada çalışmaz.
 *
 * Güvenlik kaybı YOK: sayfa zaten public, çağırdığı uç nokta
 * enumeration-safe ve oturumu olan biri aynı isteği çıkış yaparak ya da gizli
 * pencereden zaten gönderebiliyordu — yani yeni bir yetenek açılmıyor. Kapattığı
 * şey gerçek: "şifremden şüpheleniyorum, sıfırlayayım" tam olarak oturum
 * AÇIKKEN yapılan bir taleptir.
 *
 * ⚠️ `/login` ve `/register` AYNEN KALIR: oradaki yönlendirme, giriş yapmış
 * kullanıcıyı tekrar giriş formuna düşürmemek içindir ve bu değişiklik onlara
 * DOKUNMAZ (test-pinli).
 */
const SIGNED_IN_REDIRECT_PATHS = ["/login", "/register"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  const matches = (paths: string[]) =>
    paths.some((p) => pathname === p || pathname.startsWith(p + "/"));
  // İKİ AYRI SORU, tek bayrakta toplanmamalı: "bu sayfa oturumsuz görülebilir mi"
  // (↓`isPublic`) ile "oturum açıkken panele mi yollanmalı" (↓) farklı şeyler.
  // Tek `isAuthPage` bayrağı ikisini birden yönetiyordu; `/sifremi-unuttum`'u
  // ondan çıkarmak sayfayı sessizce oturum-gerektiren hâle getirirdi.
  const isAuthPage = matches(AUTH_PATHS);
  // Public pages a logged-out visitor may see: the marketing landing ("/"), the
  // legal pages, and the auth pages. Everything else requires a session.
  // "/c" = the public guest QR concierge chat (its own token auth; no session).
  // ⚠️ `/guvenlik` (VDP) BURADA OLMAK ZORUNDA: politikayı okuyacak kişi tanım
  // gereği oturumsuz bir dış araştırmacıdır. Listeden düşerse `/login`'e
  // yönlendirilir ve politika tam da hedef kitlesine kapanır — `security.txt`'in
  // `Policy` alanı da ölü bağlantıya döner. Test-pinli.
  const PUBLIC_PREFIXES = ["/gizlilik", "/kosullar", "/mesafeli-satis", "/on-bilgilendirme", "/entegrasyonlar", "/guvenlik", "/c"];
  const isPublic =
    pathname === "/" || isAuthPage || PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));

  // Not signed in → only public pages are allowed.
  if (!session && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname && pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
    return NextResponse.redirect(url);
  }

  // Signed in → keep away from auth pages (şifre sıfırlama HARİÇ, ↑gerekçe).
  if (session && matches(SIGNED_IN_REDIRECT_PATHS)) {
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
    // EXACT /tasks only: /tasks/new is a manager surface (it server-renders every
    // property + user name for the assign form) — startsWith leaked it to staff.
    const staffAllowed = pathname === "/tasks";
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
