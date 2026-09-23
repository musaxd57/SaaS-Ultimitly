import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { jsonOk, tooManyRequests, parseJsonBody, payloadTooLarge, hasJsonContentType, unsupportedMediaType } from "@/lib/api";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { emailService } from "@/lib/email";
import { reportError } from "@/lib/report-error";
import {
  makeVerifyToken,
  VERIFY_TTL_MS,
  verifyEmailHtml,
  verifyUrl,
  needsEmailVerification,
} from "@/lib/auth/email-verify";
import { emailOutboxEnabled, enqueueIdentityEmail, kickEmailOutboxDrain } from "@/lib/email-outbox";
import { isValidEmailShape, normalizeEmail } from "@/lib/email-identity";

export const dynamic = "force-dynamic";

/** Aynı adrese 24 saatte gönderilebilecek en fazla doğrulama e-postası (yeniden gönderme yolu). */
const VERIFY_RESEND_DAILY_CAP = 6;

// Resend the verification e-mail. ALWAYS returns 200 (never reveals whether the
// account exists / its state). Sends only for a real, still-unverified self-serve
// account. Rate-limited per IP and per email (inbox-bomb defense).
export async function POST(req: NextRequest) {
  // 🚨 JSON KONTROLÜ IP KOVASINDAN ÖNCE (09-23; `login` rotasının F8 emsali, gerekçe
  // `hasJsonContentType`te): başka bir site ziyaretçinin tarayıcısından `text/plain`
  // POST'larla (preflight YOK) bir ofis/mobil NAT'ının kovasını yakıp orayı bu akıştan
  // dakikalarca dışarıda bırakabiliyordu. Kendi formlarımız hep `application/json` yollar.
  if (!hasJsonContentType(req)) return unsupportedMediaType();
  const ipLimit = await rateLimit(`verify-resend:${clientIp(req)}`, 8, 15 * 60_000);
  if (!ipLimit.ok) return tooManyRequests(ipLimit.retryAfter);

  const bodyResult = await parseJsonBody<{ email?: unknown }>(req);
  if (!bodyResult.ok && bodyResult.tooLarge) return payloadTooLarge();
  const data = bodyResult.ok ? bodyResult.data : null;
  const email = typeof data?.email === "string" ? normalizeEmail(data.email) : "";
  if (!email || !isValidEmailShape(email)) return jsonOk({ ok: true });

  const acctLimit = await rateLimit(`verify-resend-acct:${email}`, 4, 15 * 60_000);
  if (!acctLimit.ok) return tooManyRequests(acctLimit.retryAfter);
  // 🚨 GÜNLÜK TAVAN (09-23, güvenlik ajanı): 15 dakikalık kova tek başına günde 4×96 = 384
  // e-postaya izin veriyordu ve IP kovası IP döndürerek aşılıyor → kimliksiz bir saldırgan,
  // kurbanın adresiyle açtığı doğrulanmamış hesap üzerinden o adrese günde yüzlerce
  // `noreply@lixusai.com` e-postası yağdırabiliyordu (hem kurbanı rahatsız eder hem
  // gönderici itibarımızı yakar). Gerçek kullanıcı günde 6'dan fazla yeniden gönderme
  // istemez. Hesabın VARLIĞINA bakmadan uygulanır (numaralandırma koruması aynen).
  const dayLimit = await rateLimit(`verify-resend-day:${email}`, VERIFY_RESEND_DAILY_CAP, 24 * 60 * 60_000);
  if (!dayLimit.ok) return tooManyRequests(dayLimit.retryAfter);

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, createdAt: true, emailVerifiedAt: true },
  });
  // Only a genuinely-unverified, gated account gets a fresh link.
  if (user && needsEmailVerification(user)) {
    const { raw, hash } = makeVerifyToken();
    const expiresAt = new Date(Date.now() + VERIFY_TTL_MS);
    if (emailOutboxEnabled()) {
      // Durable outbox (Tur-4): new token hash + send-intent in ONE transaction
      // (the enqueue supersedes any still-undelivered previous link, so only
      // the newest token's e-mail goes out). No provider call on this path.
      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: user.id },
          data: { emailVerifyTokenHash: hash, emailVerifyExpiresAt: expiresAt },
        });
        await enqueueIdentityEmail(tx, {
          userId: user.id,
          kind: "verify_email",
          secret: raw,
          recipient: email,
          expiresAt,
        });
      });
      kickEmailOutboxDrain();
      return jsonOk({ ok: true });
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerifyTokenHash: hash, emailVerifyExpiresAt: expiresAt },
    });
    const sent = await emailService.sendReporting(
      email,
      "Lixus AI — E-postanızı doğrulayın",
      verifyEmailHtml(verifyUrl(raw)),
    );
    // The response is DELIBERATELY uniform (always 200 — a different shape on failure
    // would only appear for real unverified accounts → account enumeration). But a
    // genuine send failure must page ops, not vanish (redacted — no recipient/token).
    if (!sent.ok) void reportError("auth.resend_verification", new Error(sent.error ?? "email send failed"));
  }
  return jsonOk({ ok: true });
}
