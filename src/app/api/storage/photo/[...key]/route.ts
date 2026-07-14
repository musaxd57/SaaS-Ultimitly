import { NextResponse } from "next/server";
import { withAuth } from "@/lib/route-guard";
import { notFound } from "@/lib/api";
import { getStorageConfig } from "@/lib/storage/config";
import { isSafeObjectKey, orgIdFromKey } from "@/lib/storage/keys";
import { presignGetUrl, SIGNED_URL_DEFAULT_TTL_S } from "@/lib/storage/s3";

// ---------------------------------------------------------------------------
// The ONLY way a stored photo is ever served: an authenticated, tenant-checked
// 302 to a SHORT-LIVED signed GET URL. Objects have no public URL — the bucket
// stays private; what the DB stores (/api/storage/photo/<key>) is this
// same-origin path, so <img>/<a> rendering works unchanged and the browser
// follows the redirect.
//
//   • withAuth: any signed-in member of the OWNING org (staff included — task
//     photos are their core flow). Middleware/API boundaries stay as they are.
//   • Tenant check = the key's org segment vs the session org. A foreign or
//     malformed key is a 404 (never confirm existence cross-tenant).
//   • Works whenever the provider CREDENTIALS are configured — deliberately
//     independent of the STORAGE_ENABLED upload flag, so a flag-off rollback
//     never breaks photos that already live in the bucket.
// ---------------------------------------------------------------------------

export const GET = withAuth<{ key: string[] }>(async (session, _req, { params }) => {
  const { key: segments } = await params;
  // Next has already percent-decoded each segment — join WITHOUT re-decoding
  // (double-decode would reopen the encoded-traversal hole the validator closes).
  const key = (segments ?? []).join("/");
  if (!isSafeObjectKey(key)) return notFound();
  if (orgIdFromKey(key) !== session.organizationId) return notFound(); // cross-tenant: opaque 404

  const config = getStorageConfig();
  if (!config) return notFound(); // storage not configured → nothing to serve (fail-closed)

  const url = presignGetUrl(config, key, { expiresSeconds: SIGNED_URL_DEFAULT_TTL_S });
  return new NextResponse(null, {
    status: 302,
    // no-store: the redirect target expires in minutes — never cache the hop.
    headers: { location: url, "cache-control": "no-store" },
  });
});
