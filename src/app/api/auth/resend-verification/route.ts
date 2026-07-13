import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { jsonOk, tooManyRequests } from "@/lib/api";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { emailService } from "@/lib/email";
import {
  makeVerifyToken,
  VERIFY_TTL_MS,
  verifyEmailHtml,
  verifyUrl,
  needsEmailVerification,
} from "@/lib/auth/email-verify";

export const dynamic = "force-dynamic";

// Resend the verification e-mail. ALWAYS returns 200 (never reveals whether the
// account exists / its state). Sends only for a real, still-unverified self-serve
// account. Rate-limited per IP and per email (inbox-bomb defense).
export async function POST(req: NextRequest) {
  const ipLimit = rateLimit(`verify-resend:${clientIp(req)}`, 8, 15 * 60_000);
  if (!ipLimit.ok) return tooManyRequests(ipLimit.retryAfter);

  const data = (await req.json().catch(() => null)) as { email?: unknown } | null;
  const email = typeof data?.email === "string" ? data.email.trim().toLowerCase() : "";
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return jsonOk({ ok: true });

  const acctLimit = rateLimit(`verify-resend-acct:${email}`, 4, 15 * 60_000);
  if (!acctLimit.ok) return tooManyRequests(acctLimit.retryAfter);

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, createdAt: true, emailVerifiedAt: true },
  });
  // Only a genuinely-unverified, gated account gets a fresh link.
  if (user && needsEmailVerification(user)) {
    const { raw, hash } = makeVerifyToken();
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerifyTokenHash: hash, emailVerifyExpiresAt: new Date(Date.now() + VERIFY_TTL_MS) },
    });
    await emailService.send(
      email,
      "Lixus AI — E-postanı doğrula",
      verifyEmailHtml(user.name, verifyUrl(raw)),
    );
  }
  return jsonOk({ ok: true });
}
