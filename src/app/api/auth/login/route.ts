import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { loginSchema, zodFieldErrors } from "@/lib/validators";
import { verifyPassword } from "@/lib/auth/password";
import { setSessionCookie } from "@/lib/auth";
import { badRequest, jsonOk, serverError } from "@/lib/api";
import type { UserRole } from "@/lib/constants";

export async function POST(req: NextRequest) {
  try {
    const data = await req.json().catch(() => null);
    const parsed = loginSchema.safeParse(data);
    if (!parsed.success) return badRequest(zodFieldErrors(parsed.error));

    const user = await prisma.user.findUnique({
      where: { email: parsed.data.email.toLowerCase() },
    });
    const ok = user ? await verifyPassword(parsed.data.password, user.passwordHash) : false;
    if (!user || !ok) {
      return NextResponse.json({ error: "E-posta veya şifre hatalı" }, { status: 401 });
    }

    await setSessionCookie({
      userId: user.id,
      organizationId: user.organizationId,
      role: user.role as UserRole,
      email: user.email,
      name: user.name,
    });
    return jsonOk({ ok: true });
  } catch {
    return serverError();
  }
}
