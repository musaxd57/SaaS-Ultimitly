import { type NextRequest, NextResponse } from "next/server";
import { requireSession, unauthorized, serverError, tooManyRequests } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { verifyToken, HospitableError } from "@/lib/hospitable";
import { isSuperAdmin } from "@/lib/admin";
import {
  setOrgHospitableToken,
  clearOrgHospitableToken,
  getConnectionInfo,
  isPrimaryOrg,
} from "@/lib/hospitable-credentials";
import { writeAudit } from "@/lib/audit";

// Each account's channel token is managed by that account's OWNER (self-service)
// or by the operator/super-admin on their behalf (incl. while impersonating). The
// token is write-only: it is stored encrypted and never returned to the browser.

// ---------------------------------------------------------------------------
// Connect / disconnect THIS organization's own Hospitable account (multi-tenant).
//
//   POST { token }   → validate the Personal Access Token (lists properties) and
//                      store it ENCRYPTED on the org. From now on this org syncs
//                      and sends with its OWN account, fully isolated.
//   POST { claimEnv: true } → copy the global env token onto this org (one-click
//                      migration for the founder's original org off the env fallback).
//   DELETE           → forget the stored token (disconnect).
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  // The account's OWNER may manage their own connection; the operator (super-admin,
  // incl. while impersonating) may also do it for them. Others cannot.
  if (!(session.role === "owner" || isSuperAdmin(session))) return unauthorized();

  // Each verify hits Hospitable (outbound) on user input — throttle to stop
  // quota burn / token probing. Generous for a human connecting their account.
  const limited = await rateLimit(`hosp-connect:${session.actorUserId ?? session.userId}`, 8, 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  try {
    const data = await req.json().catch(() => null);

    // Claim the deployment's env token onto this org (primary-org migration).
    if (data?.claimEnv === true) {
      // SECURITY: only the PRIMARY org may claim the shared env token. Without
      // this, any customer org could POST {claimEnv:true} and steal the founder's
      // Hospitable credentials (cross-tenant leak). The UI hides the button for
      // non-primary orgs, but the API must enforce it too.
      if (!(await isPrimaryOrg(session.organizationId))) {
        return NextResponse.json(
          { ok: false, error: "Bu işlem yalnızca ana hesap için geçerli." },
          { status: 403 },
        );
      }
      const envToken = process.env.HOSPITABLE_API_TOKEN;
      if (!envToken) {
        return NextResponse.json({ ok: false, error: "Ortamda Hospitable token yok." }, { status: 400 });
      }
      const info = await verifyToken(envToken);
      await setOrgHospitableToken(session.organizationId, envToken, `${info.properties} mülk`);
      await writeAudit({
        organizationId: session.organizationId,
        actorUserId: session.actorUserId ?? session.userId,
        action: "hospitable.connect",
        metadata: { via: "env", properties: info.properties },
      });
      return NextResponse.json({ ok: true, properties: info.properties });
    }

    const token = typeof data?.token === "string" ? data.token.trim() : "";
    if (token.length < 10) {
      return NextResponse.json({ ok: false, error: "Geçerli bir Hospitable token girin." }, { status: 400 });
    }

    // Prove the token works (and learn the property count) BEFORE storing it.
    let info: { properties: number };
    try {
      info = await verifyToken(token);
    } catch (err) {
      // 402/403 = the token is FINE but the Hospitable plan doesn't include API
      // access (Essentials tier). Say so honestly — otherwise the host is told
      // "token invalid" and blames their (correct) token. This is the #1
      // onboarding barrier, so the message must be actionable, not misleading.
      const status = err instanceof HospitableError ? err.status : undefined;
      const msg =
        status === 402 || status === 403
          ? "Token doğru ama Hospitable planınız API erişimi içermiyor (ör. Essentials). Rezervasyon ve mesajları çekebilmek için Hospitable'da API erişimli bir plana (Starter ve üzeri) geçmeniz gerekir."
          : err instanceof HospitableError
            ? "Token geçersiz ya da Hospitable'a ulaşılamadı."
            : err instanceof Error
              ? err.message
              : "Doğrulama başarısız.";
      return NextResponse.json({ ok: false, error: msg }, { status: 400 });
    }

    await setOrgHospitableToken(session.organizationId, token, `${info.properties} mülk`);
    await writeAudit({
      organizationId: session.organizationId,
      actorUserId: session.actorUserId ?? session.userId,
      action: "hospitable.connect",
      metadata: { properties: info.properties },
    });
    return NextResponse.json({ ok: true, properties: info.properties });
  } catch (err) {
    return serverError(undefined, err);
  }
}

export async function DELETE() {
  const session = await requireSession();
  if (!session) return unauthorized();
  // The account's OWNER may manage their own connection; the operator (super-admin,
  // incl. while impersonating) may also do it for them. Others cannot.
  if (!(session.role === "owner" || isSuperAdmin(session))) return unauthorized();
  try {
    await clearOrgHospitableToken(session.organizationId);
    await writeAudit({
      organizationId: session.organizationId,
      actorUserId: session.actorUserId ?? session.userId,
      action: "hospitable.disconnect",
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return serverError(undefined, err);
  }
}

export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();
  // The account's OWNER may manage their own connection; the operator (super-admin,
  // incl. while impersonating) may also do it for them. Others cannot.
  if (!(session.role === "owner" || isSuperAdmin(session))) return unauthorized();
  return NextResponse.json(await getConnectionInfo(session.organizationId));
}
