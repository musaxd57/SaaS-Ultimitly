import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { setSessionCookie } from "@/lib/auth";
import { verifySession, SESSION_COOKIE } from "@/lib/auth/session";
import { hashVerifyToken, baseUrlFromHost } from "@/lib/auth/email-verify";
import { verifyPassword, PasswordHashBusyError } from "@/lib/auth/password";
import { rateLimit, rateLimitClientKey } from "@/lib/rate-limit";
import { readJsonCappedOrNull, passwordHashBusy, hasJsonContentType, unsupportedMediaType } from "@/lib/api";
import type { UserRole } from "@/lib/constants";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// E-posta doğrulama token'ının TÜKETİMİ. Token'ı VE PAROLAYI birlikte doğrular,
// hesabı doğrulanmış işaretler ve (2FA kapalıysa) oturum basar.
//
// 🚨 GET DEĞİL POST — VE TOKEN GÖVDEDE, QUERY'DE DEĞİL (08-05).
// Eskiden `GET /api/auth/verify-email?token=…` idi ve e-postadaki bağlantı
// doğrudan buraya geliyordu. İki sorun birden vardı:
//   1. Token HTTP istek satırındaydı → Railway edge log'u, Next istek log'u,
//      araya giren vekiller ve e-posta güvenlik tarayıcılarının ön-ısıtma
//      istekleri onu görüyordu. Bu katmanların token'ı saklamadığını
//      KANITLAYAMAYIZ (üçüncü taraf platform, dokümantasyon 403).
//   2. Bu token TEK BAŞINA OTURUM BASIYOR. m47'de aynı sınıfı şifre
//      sıfırlamada kapatmıştık; oradaki token'ın yanında ikinci bir faktör
//      (8 haneli kod) VAR, buradakinin YOK — yani bahis daha yüksekti.
// Artık bağlantı `/e-posta-dogrula#t=<token>` sayfasına gidiyor; fragment
// sunucuya HİÇ ulaşmıyor ve istemci onu okuyup buraya POST ediyor.
//
// ⚠️ GET'i geri getirme. Bir yan etkiyi (oturum basma) GET'e bağlamak, ayrıca
// e-posta tarayıcılarının ön-ısıtma isteğinin TEK KULLANIMLIK token'ı
// tüketmesine ve kullanıcının kendi tıklamasının "süresi dolmuş" almasına yol
// açar.
// ---------------------------------------------------------------------------
/**
 * ESKİ BAĞLANTILARI KURTARAN, YAN ETKİSİZ YÖNLENDİRME (08-09).
 *
 * Sorun: 08-05'ten önce gönderilmiş her doğrulama e-postası
 * `GET /api/auth/verify-email?token=…` adresine işaret ediyor ve o gün rota
 * POST-only yapıldığı için bugün tarayıcıda ÇIPLAK "HTTP ERROR 405 — Bu sayfa
 * çalışmıyor" görünüyordu. Kullanıcının gelen kutusundaki eski maili biz geri
 * çağıramayız; kırık olan uç noktadır.
 *
 * 🚨 "GET'İ GERİ GETİRME" KURALIYLA ÇELİŞMEZ — o kural YAN ETKİYİ yasaklıyor.
 * Buradaki GET token'ı OKUMAZ, DOĞRULAMAZ, TÜKETMEZ ve oturum BASMAZ; tek
 * yaptığı `/e-posta-dogrula` sayfasına yönlendirmek. Dolayısıyla e-posta
 * güvenlik tarayıcılarının ön-ısıtma isteği hâlâ hiçbir şeyi tüketemez —
 * kuralın koruduğu değişmez aynen ayakta.
 *
 * ⚠️ Token FRAGMENT'e taşınır (`#t=`), query'de BIRAKILMAZ: fragment sunucuya
 * hiç gitmez, yani kullanıcı yönlendirmeyi izlediği anda token istek satırından
 * ÇIKAR. Zaten sızmış olan (tıklanan eski URL) için yapabileceğimiz bir şey yok,
 * ama bundan sonrasını temiz tutar. Token yoksa fragmentsiz yönlendirilir ve
 * sayfa kendi "bağlantı geçersiz" durumunu gösterir.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token")?.trim() ?? "";
  const base = baseUrlFromHost(req.headers.get("host"));
  const target = `${base}/e-posta-dogrula${token ? `#t=${encodeURIComponent(token)}` : ""}`;
  return NextResponse.redirect(target, 302);
}

export async function POST(req: NextRequest) {
  // 🚨 JSON KONTROLÜ IP KOVASINDAN ÖNCE (09-23 saldırgan turu — dört kardeş kimlik rotasının
  // emsali, gerekçe `hasJsonContentType`te): başka bir site `text/plain` POST'larla (preflight
  // YOK) bir ağın `verify-email` kovasını yakıp oradaki yeni kullanıcıların hesap doğrulamasını
  // bir saat engelleyebiliyordu. Kendi formumuz (`verify-email-form.tsx`) hep JSON yollar.
  if (!hasJsonContentType(req)) return unsupportedMediaType();
  // Throttle by IP: this endpoint issues a login session on a token match and
  // scans an unindexed column, so an unauthenticated flood could brute-force
  // tokens and hammer the DB. A legit user clicks the emailed link once or twice.
  const limited = await rateLimit(`verify-email:${rateLimitClientKey(req)}`, 20, 60 * 60 * 1000);
  if (!limited.ok) {
    return NextResponse.json(
      { reason: "error" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } },
    );
  }

  const body = await readJsonCappedOrNull<{ token?: unknown; password?: unknown }>(req);
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  // ⚠️ Sebep KODU döner, serbest metin değil: istemci metni kendisi yazar
  // (`verify-email-form.tsx`), böylece sunucu yanıtı token durumu hakkında
  // ayrıntı sızdırmaz ve iki taraf ayrışmaz.
  const fail = (reason: "missing" | "expired" | "password" | "session_mismatch") =>
    NextResponse.json({ reason }, { status: 400 });

  if (!token) return fail("missing");

  const hash = hashVerifyToken(token);
  const user = await prisma.user.findFirst({
    where: { emailVerifyTokenHash: hash, emailVerifyExpiresAt: { gt: new Date() } },
    select: {
      id: true,
      organizationId: true,
      role: true,
      email: true,
      name: true,
      sessionEpoch: true,
      passwordHash: true,
      twoFactorEnabledAt: true,
    },
  });
  if (!user) return fail("expired");

  // ⚠️ BOŞ PAROLA KONTROLÜ TOKEN ARAMASINDAN SONRA — SIRAYI DEĞİŞTİRME.
  // `tests/e2e/security-controls.spec.ts` tarayıcı-botnet Content-Type kapısını
  // BU ROTA üzerinden ölçüyor ve tüm ayrımı sebep kodlarına dayandırıyor: gövde
  // okundu → `expired`, gövde düşürüldü → `missing`. Parola kontrolü aramanın
  // ÖNÜNE alınırsa geçersiz token da `password` döner, iki dal ayrışamaz ve o
  // kapının TEK davranışsal pini sessizce anlamsızlaşır. Yeni sebep kodu
  // EKLEMEK serbest; `missing`/`expired`'ın anlamını DEĞİŞTİRMEK değil.
  if (!password) return fail("password");

  // 🔁 BAŞKA BİR HESABIN OTURUMU AÇIKKEN DOĞRULAMA YAPILMAZ.
  // `/e-posta-dogrula` `AUTH_PATHS`'te (oturumsuz görülebilir) ama bilinçli
  // olarak `SIGNED_IN_REDIRECT_PATHS`'te DEĞİL — yani oturumu açık bir kullanıcı
  // da sayfaya ulaşır. `setSessionCookie` mevcut çerezi KOŞULSUZ ezdiği için,
  // buraya yabancı bir token'la gelinmesi kullanıcıyı sessizce BAŞKA bir org'a
  // taşırdı (klasik login-CSRF). Parola şartı bunu zaten büyük ölçüde kapatıyor
  // — ama oturum sahibi operatörse aktif impersonation bağlamı da sessizce
  // düşerdi, o yüzden ayrıca ve açıkça reddediyoruz.
  //
  // ⚠️ Bu kontrol FAIL-OPEN: çerez okunamazsa "oturum yok" sayılır. Asıl kapı
  // yukarıdaki paroladır; bu katman yalnız kafa karıştırıcı hesap değişimini
  // engeller. Fail-closed yapmak, çerez/JWT tarafında geçici bir arıza olduğunda
  // MEŞRU doğrulamayı bloklardı — kazancından büyük bir bedel.
  // ⚠️ Çerez `req`'ten okunur, `next/headers`'tan DEĞİL: rota handler'ında ikisi
  // de aynı isteği görür, ama `req` açık bir girdidir — testte kurulabilir ve
  // ortam sızıntısına bağlı değildir. (İlk yazımda `getSession()` kullanmıştım;
  // pin testi sessizce 200 alıp geçti çünkü harness `next/headers`'ı bağlamıyor
  // — koruma üretimde çalışsa da SINANAMAZ olurdu.)
  const current = await verifySession(req.cookies.get(SESSION_COOKIE)?.value).catch(() => null);
  if (current && current.userId !== user.id) return fail("session_mismatch");

  // 🚨 PAROLA ŞART — HESAP ÖN-ELE-GEÇİRME KAPISI (08-06). GEVŞETME.
  // Saldırgan KURBANIN adresiyle kaydolabiliyor (register mevcut e-postada
  // enumeration'a karşı sessiz 201 döner) ve `resend-verification` KİMLİKSİZ
  // olduğu için kurbanın kutusuna istediği an taze token yollatabiliyor. Kurban
  // bağlantıya tıkladığında hesap doğrulanırsa, `login/route.ts`'teki
  // `needsEmailVerification` kapısı AÇILIR ve saldırgan KENDİ parolasıyla
  // kurbanın hesabına girer — hesabı bu arada kurban gerçek verisiyle doldurmuş
  // olur (Hospitable token'ı, KB'deki kapı kodları, misafir PII'si).
  //
  // Kapatma noktası BURASI: doğrulama artık İKİ sır birden ister ve saldırıda o
  // iki sır İKİ FARKLI KİŞİDE bulunur — token kurbanın kutusunda, parola
  // saldırganın kafasında. Tek başına ikisi de `emailVerifiedAt`'i yazamaz.
  //
  // ⚠️ Yanlış parola token'ı TÜKETMEZ (tüketim aşağıda, bu kontrolden SONRA):
  // bir yazım hatası bağlantıyı yakmamalı. Kullanıcı aynı bağlantıyla tekrar
  // dener.
  //
  // ⚠️ Sebep kodu `password` ile `expired` BİLEREK AYRI. Buraya ulaşmak GEÇERLİ
  // bir token gerektirir, o da yalnız posta kutusunun sahibinde olur — yani
  // "parolan yanlış" demek ön-ele-geçirme saldırganına HİÇBİR ŞEY vermez (o
  // token'ı hiç görmez). Birleştirmek ise meşru kullanıcıyı "bağlantı geçersiz"
  // deyip tekrar tıklamaya iten bir döngüye sokardı.
  // Parola kapısı doygunsa 503 (bu rotada genel hata sarmalı yok; aksi hâlde istisna
  // çıplak 500 olurdu). Token TÜKETİLMEZ — kullanıcı aynı bağlantıyla yeniden dener.
  let passwordOk: boolean;
  try {
    passwordOk = await verifyPassword(password, user.passwordHash);
  } catch (err) {
    if (err instanceof PasswordHashBusyError) return passwordHashBusy();
    throw err;
  }
  if (!passwordOk) return fail("password");

  // ATOMIC single-use consume (same burn pattern as TOTP): the update is
  // conditioned on the token hash STILL being set, so of N concurrent clicks on
  // the same link exactly one matches and mints a session — a plain
  // findFirst→update let every racer through. Losers fall to "expired"; the
  // account is verified by then, so a normal login succeeds.
  const consumed = await prisma.user.updateMany({
    where: { id: user.id, emailVerifyTokenHash: hash, emailVerifyExpiresAt: { gt: new Date() } },
    data: { emailVerifiedAt: new Date(), emailVerifyTokenHash: null, emailVerifyExpiresAt: null },
  });
  if (consumed.count !== 1) return fail("expired");

  // 🔐 2FA açık bir hesapta bu rota oturum BASMAZ — kullanıcı normal girişten
  // geçip TOTP kodunu verir. Bugün bu dala ULAŞILAMAZ ve bu bir tesadüf değil,
  // bir DEĞİŞMEZ: 2FA kurulumu oturum ister (`account/2fa/route.ts:53`
  // `requireSession`), oturum girişten gelir, giriş doğrulama ister — yani
  // doğrulanmamış bir hesap 2FA kuramaz; doğrulandıktan sonra da yeni token
  // alamaz (`resend-verification` yalnız `emailVerifiedAt == null` olana verir).
  // Guard, ileride o değişmezi bozacak bir değişikliğe karşı (ör. "e-posta
  // adresini değiştirince yeniden doğrula") buranın SESSİZCE bir 2FA atlatma
  // kapısına dönüşmesini engeller.
  if (user.twoFactorEnabledAt) return NextResponse.json({ ok: true, requiresLogin: true });

  await setSessionCookie({
    userId: user.id,
    organizationId: user.organizationId,
    role: user.role as UserRole,
    email: user.email,
    name: user.name,
    sessionEpoch: user.sessionEpoch,
    // ⚠️ İKİNCİ FAKTÖR SUNULMADI — bu oturum e-posta token'ı + PAROLA ile
    // açıldı, TOTP ile değil. `admin.ts isSuperAdmin` bu iddiayı istediği için,
    // bu yolla basılan bir oturum operatör yetkisi ALAMAZ. Kasıtlı: aksi hâlde
    // e-posta doğrulama bağlantısı MFA kapısını komple delerdi.
    mfa: false,
  });

  return NextResponse.json({ ok: true });
}
