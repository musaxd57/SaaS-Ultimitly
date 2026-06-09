import { type NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { jsonOk, unauthorized } from "@/lib/api";
import { reportError } from "@/lib/report-error";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Iyzico payment webhook (Faz 2). DORMANT until IYZICO_WEBHOOK_SECRET is set —
// returns 200 {disabled:true} and stores nothing, so it cannot be abused before
// billing goes live. When configured it checks a shared secret, stores the event
// idempotently (providerEventId), and (later) updates the matching Subscription.
//
// NOTE: the shared-secret guard is a placeholder. Iyzico's real signature
// verification replaces it once we test against sandbox keys.
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const secret = process.env.IYZICO_WEBHOOK_SECRET?.trim();
  if (!secret) return NextResponse.json({ disabled: true }, { status: 200 });

  // Header only — never accept the secret via ?secret= (it would leak into proxy
  // access logs). Compare in constant time to avoid a timing oracle.
  const provided = req.headers.get("x-iyzi-webhook-secret") ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return unauthorized();

  let payload: unknown = null;
  try {
    payload = await req.json();
  } catch {
    payload = null;
  }

  try {
    const p = (payload ?? {}) as Record<string, unknown>;
    const providerEventId =
      typeof p.iyziEventId === "string" ? p.iyziEventId
      : typeof p.token === "string" ? p.token
      : null;
    const eventType = typeof p.iyziEventType === "string" ? p.iyziEventType : null;

    // Idempotency: skip an event we have already recorded.
    if (providerEventId) {
      const existing = await prisma.webhookEvent.findUnique({ where: { providerEventId } });
      if (existing) return jsonOk({ ok: true, duplicate: true });
    }

    await prisma.webhookEvent.create({
      data: {
        provider: "iyzico",
        eventType,
        providerEventId,
        payloadJson: JSON.stringify(payload ?? null),
        status: "received",
      },
    });
  } catch (err) {
    await reportError("iyzico-webhook", err);
    // Still answer 200 so the provider doesn't retry-storm on a storage hiccup.
  }

  return jsonOk({ ok: true });
}
