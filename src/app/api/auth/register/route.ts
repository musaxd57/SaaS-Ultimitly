import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { registerSchema, zodFieldErrors } from "@/lib/validators";
import { hashPassword } from "@/lib/auth/password";
import { badRequest, jsonOk, serverError } from "@/lib/api";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { emailService } from "@/lib/email";
import { makeVerifyToken, VERIFY_TTL_MS, verifyEmailHtml, verifyUrl } from "@/lib/auth/email-verify";
import { newTrialSubscriptionData } from "@/lib/billing/subscription";
import { LEGAL_VERSION } from "@/lib/legal-entity";

export async function POST(req: NextRequest) {
  try {
    // SECURITY: public sign-up is CLOSED by default. While the app shares a single
    // Hospitable token, a new org would sync the owner's Airbnb data — so no one
    // else may create an account until per-org channel connections exist. Flip
    // REGISTRATION_OPEN=1 only when the product is truly multi-tenant.
    if (process.env.REGISTRATION_OPEN !== "1") {
      return NextResponse.json({ error: "Kayıt şu an kapalı." }, { status: 403 });
    }

    // Capture the request context ONCE — reused both for the per-IP throttle and
    // for the KVKK consent-evidence record persisted below. clientIp() reads the
    // rightmost X-Forwarded-For hop (the value Railway's proxy observed, not a
    // client-spoofable one); the User-Agent is attacker-controlled free text, so
    // it's length-capped and stored only as an informational record.
    const ip = clientIp(req);
    const userAgent = req.headers.get("user-agent")?.slice(0, 512) ?? null;

    // Throttle sign-ups per IP: 5 / hour (anti-spam / abuse).
    const limited = await rateLimit(`register:${ip}`, 5, 60 * 60 * 1000);
    if (!limited.ok) {
      return NextResponse.json(
        { error: "Çok fazla deneme. Lütfen biraz sonra tekrar deneyin." },
        { status: 429, headers: { "Retry-After": String(limited.retryAfter) } },
      );
    }

    const data = await req.json().catch(() => null);
    const parsed = registerSchema.safeParse(data);
    if (!parsed.success) return badRequest(zodFieldErrors(parsed.error));

    // KVKK: explicit, informed consent to the Terms + Privacy Policy is required
    // to register (backs the "kaydolarak kabul edersiniz" claim with a real
    // record). The client disables submit until checked; enforce it server-side.
    if (data?.consent !== true) {
      return badRequest({
        consent: "Devam etmek için Kullanım Koşulları ve Gizlilik Politikası'nı onaylamalısınız.",
      });
    }

    const email = parsed.data.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return badRequest({ email: "Bu e-posta adresi zaten kayıtlı" });

    const passwordHash = await hashPassword(parsed.data.password);
    const { raw, hash } = makeVerifyToken();
    const { user } = await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: { name: parsed.data.organizationName },
      });
      // One checkbox covers Terms + Privacy, so both acceptances share the same
      // instant. Version + IP + UA make the consent record defensible against a
      // later "I never accepted" dispute (which text, when, from where).
      const acceptedAt = new Date();
      const user = await tx.user.create({
        data: {
          organizationId: org.id,
          name: parsed.data.name,
          email,
          passwordHash,
          role: "owner",
          acceptedTermsAt: acceptedAt,
          privacyAcceptedAt: acceptedAt,
          acceptedLegalVersion: LEGAL_VERSION,
          acceptedIp: ip,
          acceptedUserAgent: userAgent,
          emailVerifyTokenHash: hash,
          emailVerifyExpiresAt: new Date(Date.now() + VERIFY_TTL_MS),
        },
      });
      // Start the reverse-trial: full Pro free for 14 days (no card). Harmless
      // while billing is dormant — counts as active until BILLING_ENFORCED is on.
      await tx.subscription.create({
        data: { organizationId: org.id, ...newTrialSubscriptionData() },
      });
      return { org, user };
    });

    // No auto-login: the account stays inert until the inbox is confirmed
    // (anti-bot). Clicking the e-mailed link sets emailVerifiedAt + the session.
    await emailService.send(
      email,
      "Lixus AI — E-postanı doğrula",
      verifyEmailHtml(user.name, verifyUrl(raw)),
    );
    return jsonOk({ ok: true, verifyEmail: true }, 201);
  } catch (err) {
    return serverError(undefined, err);
  }
}
