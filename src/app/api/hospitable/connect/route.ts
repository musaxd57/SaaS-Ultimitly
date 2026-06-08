import { type NextRequest, NextResponse } from "next/server";
import { requireSession, unauthorized, serverError } from "@/lib/api";
import { verifyToken, HospitableError } from "@/lib/hospitable";
import {
  setOrgHospitableToken,
  clearOrgHospitableToken,
  getConnectionInfo,
} from "@/lib/hospitable-credentials";

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
  try {
    const data = await req.json().catch(() => null);

    // Claim the deployment's env token onto this org (primary-org migration).
    if (data?.claimEnv === true) {
      const envToken = process.env.HOSPITABLE_API_TOKEN;
      if (!envToken) {
        return NextResponse.json({ ok: false, error: "Ortamda Hospitable token yok." }, { status: 400 });
      }
      const info = await verifyToken(envToken);
      await setOrgHospitableToken(session.organizationId, envToken, `${info.properties} mülk`);
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
      const msg =
        err instanceof HospitableError
          ? "Token geçersiz ya da Hospitable'a ulaşılamadı."
          : err instanceof Error
            ? err.message
            : "Doğrulama başarısız.";
      return NextResponse.json({ ok: false, error: msg }, { status: 400 });
    }

    await setOrgHospitableToken(session.organizationId, token, `${info.properties} mülk`);
    return NextResponse.json({ ok: true, properties: info.properties });
  } catch {
    return serverError();
  }
}

export async function DELETE() {
  const session = await requireSession();
  if (!session) return unauthorized();
  try {
    await clearOrgHospitableToken(session.organizationId);
    return NextResponse.json({ ok: true });
  } catch {
    return serverError();
  }
}

export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();
  return NextResponse.json(await getConnectionInfo(session.organizationId));
}
