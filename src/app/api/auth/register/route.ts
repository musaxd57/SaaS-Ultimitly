import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { registerSchema, zodFieldErrors } from "@/lib/validators";
import { hashPassword } from "@/lib/auth/password";
import { setSessionCookie } from "@/lib/auth";
import { badRequest, jsonOk, serverError } from "@/lib/api";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  try {
    // Throttle sign-ups per IP: 5 / hour (anti-spam / abuse).
    const limited = rateLimit(`register:${clientIp(req)}`, 5, 60 * 60 * 1000);
    if (!limited.ok) {
      return NextResponse.json(
        { error: "Çok fazla deneme. Lütfen biraz sonra tekrar deneyin." },
        { status: 429, headers: { "Retry-After": String(limited.retryAfter) } },
      );
    }

    const data = await req.json().catch(() => null);
    const parsed = registerSchema.safeParse(data);
    if (!parsed.success) return badRequest(zodFieldErrors(parsed.error));

    const email = parsed.data.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return badRequest({ email: "Bu e-posta adresi zaten kayıtlı" });

    const passwordHash = await hashPassword(parsed.data.password);
    const { org, user } = await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: { name: parsed.data.organizationName },
      });
      const user = await tx.user.create({
        data: {
          organizationId: org.id,
          name: parsed.data.name,
          email,
          passwordHash,
          role: "owner",
        },
      });
      return { org, user };
    });

    await setSessionCookie({
      userId: user.id,
      organizationId: org.id,
      role: "owner",
      email: user.email,
      name: user.name,
    });
    return jsonOk({ ok: true }, 201);
  } catch {
    return serverError();
  }
}
