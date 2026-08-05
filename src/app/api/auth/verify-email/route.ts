import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { setSessionCookie } from "@/lib/auth";
import { hashVerifyToken } from "@/lib/auth/email-verify";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { readJsonCappedOrNull } from "@/lib/api";
import type { UserRole } from "@/lib/constants";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// E-posta doğrulama token'ının TÜKETİMİ. Token'ı doğrular, hesabı doğrulanmış
// işaretler ve oturum basar.
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
export async function POST(req: NextRequest) {
  // Throttle by IP: this endpoint issues a login session on a token match and
  // scans an unindexed column, so an unauthenticated flood could brute-force
  // tokens and hammer the DB. A legit user clicks the emailed link once or twice.
  const limited = await rateLimit(`verify-email:${clientIp(req)}`, 20, 60 * 60 * 1000);
  if (!limited.ok) {
    return NextResponse.json(
      { reason: "error" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } },
    );
  }

  const body = await readJsonCappedOrNull<{ token?: unknown }>(req);
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  // ⚠️ Sebep KODU döner, serbest metin değil: istemci metni kendisi yazar
  // (`verify-email-form.tsx`), böylece sunucu yanıtı token durumu hakkında
  // ayrıntı sızdırmaz ve iki taraf ayrışmaz.
  const fail = (reason: "missing" | "expired") => NextResponse.json({ reason }, { status: 400 });

  if (!token) return fail("missing");

  const hash = hashVerifyToken(token);
  const user = await prisma.user.findFirst({
    where: { emailVerifyTokenHash: hash, emailVerifyExpiresAt: { gt: new Date() } },
    select: { id: true, organizationId: true, role: true, email: true, name: true, sessionEpoch: true },
  });
  if (!user) return fail("expired");

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

  await setSessionCookie({
    userId: user.id,
    organizationId: user.organizationId,
    role: user.role as UserRole,
    email: user.email,
    name: user.name,
    sessionEpoch: user.sessionEpoch,
    // ⚠️ İKİNCİ FAKTÖR SUNULMADI — bu oturum yalnız e-posta token'ıyla açıldı.
    // `admin.ts isSuperAdmin` bu iddiayı istediği için, bu yolla basılan bir
    // oturum operatör yetkisi ALAMAZ. Kasıtlı: aksi hâlde e-posta doğrulama
    // bağlantısı MFA kapısını komple delerdi.
    mfa: false,
  });

  return NextResponse.json({ ok: true });
}
