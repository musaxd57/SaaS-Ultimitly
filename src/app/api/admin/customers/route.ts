import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { registerSchema, zodFieldErrors } from "@/lib/validators";
import { hashPassword } from "@/lib/auth/password";
import { requireSession, unauthorized, badRequest, jsonOk, serverError, tooManyRequests, readJsonCappedOrNull } from "@/lib/api";
import { isSuperAdmin } from "@/lib/admin";
import { rateLimit } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";
import { newTrialSubscriptionData } from "@/lib/billing/subscription";

// Billing lifecycle the operator chooses for a new customer. ALWAYS creates a
// Subscription row so an operator-created org can never silently fall into
// "grandfathered = unlimited" by simply MISSING a row.
const BILLING_MODES = ["trial", "manual", "free"] as const;
type BillingMode = (typeof BILLING_MODES)[number];

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

  const limited = await rateLimit(`admin-create:${session.actorUserId ?? session.userId}`, 20, 60 * 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  try {
    const data = await readJsonCappedOrNull(req);
    const parsed = registerSchema.safeParse(data);
    if (!parsed.success) return badRequest(zodFieldErrors(parsed.error));

    const email = parsed.data.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return badRequest({ email: "Bu e-posta adresi zaten kayıtlı" });

    // Operator's chosen billing lifecycle (default: same reverse-trial as a
    // public signup, so nothing is gifted premium by accident).
    const rawMode = (data as { billingMode?: unknown } | null)?.billingMode;
    const billingMode: BillingMode = BILLING_MODES.includes(rawMode as BillingMode)
      ? (rawMode as BillingMode)
      : "trial";

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
          // The operator vouches for this account (agency onboarding), so mark it
          // verified. Otherwise the customer's FIRST login is blocked citing a
          // verification email this path never sends — the login route already
          // documents operator-created customers as exempt from that gate.
          emailVerifiedAt: new Date(),
        },
      });
      // Always create a Subscription row (never leave the org row-less):
      //   trial  → 14-day Pro reverse-trial, then normal billing (public-signup parity)
      //   manual → active + provider "manual": premium ON, no trial clock; the
      //            operator collects payment offline (bank transfer etc.)
      //   free   → grandfathered: unlimited, enforcement-exempt internal account
      //            (an EXPLICIT marker, not the accidental missing-row default)
      const subData =
        billingMode === "manual"
          ? { organizationId: org.id, planCode: "pro", status: "active", provider: "manual" }
          : billingMode === "free"
            ? { organizationId: org.id, planCode: "grandfathered", status: "grandfathered", provider: "manual" }
            : { organizationId: org.id, ...newTrialSubscriptionData() };
      await tx.subscription.create({ data: subData });
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
        billingMode,
      },
    });

    return jsonOk({ ok: true, organizationId: org.id }, 201);
  } catch (err) {
    return serverError(undefined, err);
  }
}
