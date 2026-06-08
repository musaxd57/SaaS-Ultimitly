import "server-only";

import { prisma } from "@/lib/db";
import { encryptSecret, decryptSecret } from "@/lib/crypto";

// ---------------------------------------------------------------------------
// Per-organization Hospitable credentials (multi-tenant).
//
// Each customer organization connects its OWN Hospitable account; the Personal
// Access Token is stored ENCRYPTED on the Organization row. This is what keeps
// customers isolated — one org can never read another's Airbnb data.
//
// Backwards compatibility: the founder's original ("primary") org may fall back
// to the global HOSPITABLE_API_TOKEN env var, so the original single-tenant
// deployment keeps working without re-connecting. The primary org is the one
// named by PRIMARY_ORG_ID, or — if unset — simply the OLDEST org (which, before
// any customers are onboarded, is the founder's). New customer orgs are created
// later, are never "oldest", and so NEVER fall back to the shared token.
// ---------------------------------------------------------------------------

let primaryOrgIdCache: string | null | undefined;

/** Id of the org allowed to fall back to the global env token (see file header). */
async function primaryOrgId(): Promise<string | null> {
  if (process.env.PRIMARY_ORG_ID) return process.env.PRIMARY_ORG_ID;
  if (primaryOrgIdCache !== undefined) return primaryOrgIdCache;
  const oldest = await prisma.organization.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  primaryOrgIdCache = oldest?.id ?? null;
  return primaryOrgIdCache;
}

/** Test/maintenance hook: forget the cached primary-org id. */
export function resetPrimaryOrgCache(): void {
  primaryOrgIdCache = undefined;
}

/**
 * The Hospitable Personal Access Token to use for an organization, or null when
 * the org has no usable connection. Callers MUST treat null as "not connected"
 * and skip syncing/sending for that org (never fall back to another org's token).
 */
export async function getOrgHospitableToken(orgId: string): Promise<string | null> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { hospitableTokenEnc: true },
  });
  if (!org) return null;

  if (org.hospitableTokenEnc) {
    try {
      return decryptSecret(org.hospitableTokenEnc);
    } catch {
      return null; // corrupt/under a rotated key → treat as disconnected
    }
  }

  // Primary org only: fall back to the global env token (legacy single-tenant).
  const env = process.env.HOSPITABLE_API_TOKEN;
  if (env && (await primaryOrgId()) === orgId) return env;
  return null;
}

/** True when the org can talk to Hospitable (own token or primary env fallback). */
export async function hasOrgHospitable(orgId: string): Promise<boolean> {
  return (await getOrgHospitableToken(orgId)) !== null;
}

export interface HospitableConnectionInfo {
  connected: boolean;
  /** True when this org is connected via its OWN stored token (not env fallback). */
  ownToken: boolean;
  /** True when the global env token exists and this org may claim/use it. */
  envAvailable: boolean;
  label: string | null;
  connectedAt: Date | null;
}

/** Describe an org's Hospitable connection for the settings UI. */
export async function getConnectionInfo(orgId: string): Promise<HospitableConnectionInfo> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { hospitableTokenEnc: true, hospitableLabel: true, hospitableConnectedAt: true },
  });
  const ownToken = Boolean(org?.hospitableTokenEnc);
  const isPrimary = (await primaryOrgId()) === orgId;
  const envAvailable = Boolean(process.env.HOSPITABLE_API_TOKEN) && isPrimary;
  return {
    connected: ownToken || envAvailable,
    ownToken,
    envAvailable,
    label: org?.hospitableLabel ?? null,
    connectedAt: org?.hospitableConnectedAt ?? null,
  };
}

/** Store (encrypted) the Hospitable token an org will use from now on. */
export async function setOrgHospitableToken(
  orgId: string,
  token: string,
  label: string | null,
): Promise<void> {
  await prisma.organization.update({
    where: { id: orgId },
    data: {
      hospitableTokenEnc: encryptSecret(token),
      hospitableLabel: label,
      hospitableConnectedAt: new Date(),
    },
  });
}

/** Remove an org's stored Hospitable token (disconnect). */
export async function clearOrgHospitableToken(orgId: string): Promise<void> {
  await prisma.organization.update({
    where: { id: orgId },
    data: { hospitableTokenEnc: null, hospitableLabel: null, hospitableConnectedAt: null },
  });
}
