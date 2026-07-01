import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { registerSchema, zodFieldErrors } from "@/lib/validators";
import { hashPassword } from "@/lib/auth/password";
import { requireSession, unauthorized, badRequest, jsonOk, serverError, tooManyRequests } from "@/lib/api";
import { isSuperAdmin } from "@/lib/admin";
import { rateLimit } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";

// ---------------------------------------------------------------------------
// Operator panel: create a new CUSTOMER organization + its owner login.
// SUPER-ADMIN ONLY. This is the agency onboarding path — it intentionally
// bypasses the closed public registration (REGISTRATION_OPEN) because the
// operator, not the public, is creating the account. The customer's Airbnb data
// only starts flowing once their OWN Hospitable token is connected (Settings).
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  if (!isSuperAdmin(session)) return unauthorized();

  const limited = rateLimit(`admin-create:${session.actorUserId ?? session.userId}`, 20, 60 * 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  try {
    const data = await req.json().catch(() => null);
    const parsed = registerSchema.safeParse(data);
    if (!parsed.success) return badRequest(zodFieldErrors(parsed.error));

    const email = parsed.data.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return badRequest({ email: "Bu e-posta adresi zaten kayıtlı" });

    const passwordHash = await hashPassword(parsed.data.password);
    const { org } = await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({ data: { name: parsed.data.organizationName } });
      await tx.user.create({
        data: {
          organizationId: org.id,
          name: parsed.data.name,
          email,
          passwordHash,
          role: "owner",
        },
      });
      return { org };
    });

    // Trace: an operator created a new customer org + owner login (forensic/KVKK).
    await writeAudit({
      organizationId: org.id,
      actorUserId: session.actorUserId ?? session.userId,
      action: "customer.create",
      metadata: {
        operatorEmail: session.actorEmail ?? session.email,
        ownerEmail: email,
        orgName: parsed.data.organizationName,
      },
    });

    return jsonOk({ ok: true, organizationId: org.id }, 201);
  } catch {
    return serverError();
  }
}
