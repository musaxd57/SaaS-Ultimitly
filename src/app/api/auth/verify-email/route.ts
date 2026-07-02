import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { setSessionCookie } from "@/lib/auth";
import { hashVerifyToken, baseUrlFromHost } from "@/lib/auth/email-verify";
import type { UserRole } from "@/lib/constants";

export const dynamic = "force-dynamic";

// Click target of the verification e-mail. Validates the token, marks the account
// verified, signs the user in, and redirects to the dashboard. On a bad/expired
// token it redirects to /login with a flag so the page can offer "resend".
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token")?.trim() ?? "";
  // Redirect to the PUBLIC host (from the Host header), not req.nextUrl.origin
  // which is the internal localhost:8080 behind Railway/Cloudflare.
  const base = baseUrlFromHost(req.headers.get("host"));
  const fail = (reason: string) => NextResponse.redirect(`${base}/login?verify=${reason}`);

  if (!token) return fail("missing");

  const hash = hashVerifyToken(token);
  const user = await prisma.user.findFirst({
    where: { emailVerifyTokenHash: hash, emailVerifyExpiresAt: { gt: new Date() } },
    select: { id: true, organizationId: true, role: true, email: true, name: true, sessionEpoch: true },
  });
  if (!user) return fail("expired");

  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerifiedAt: new Date(), emailVerifyTokenHash: null, emailVerifyExpiresAt: null },
  });

  await setSessionCookie({
    userId: user.id,
    organizationId: user.organizationId,
    role: user.role as UserRole,
    email: user.email,
    name: user.name,
    sessionEpoch: user.sessionEpoch,
  });

  return NextResponse.redirect(`${base}/dashboard`);
}
