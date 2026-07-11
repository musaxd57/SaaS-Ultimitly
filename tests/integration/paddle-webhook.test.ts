import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { createHmac } from "node:crypto";
import { prisma, resetDb } from "../helpers/db";
import { POST } from "@/app/api/webhooks/paddle/route";

const SECRET = "pdl_ntfset_testsecret";

function sign(body: string): string {
  const ts = Math.floor(Date.now() / 1000);
  const h1 = createHmac("sha256", SECRET).update(`${ts}:${body}`, "utf8").digest("hex");
  return `ts=${ts};h1=${h1}`;
}

function req(body: string, header: string | null) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (header) headers["paddle-signature"] = header;
  return new NextRequest("http://localhost/api/webhooks/paddle", { method: "POST", headers, body });
}

let orgId = "";
let consentId = ""; // server-trusted checkout nonce for orgId (priceId pri_pro)

beforeAll(() => {
  process.env.PADDLE_WEBHOOK_SECRET = SECRET;
  process.env.PADDLE_PRICE_PRO = "pri_pro";
});
afterAll(async () => {
  delete process.env.PADDLE_WEBHOOK_SECRET;
  delete process.env.PADDLE_PRICE_PRO;
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDb();
  process.env.PADDLE_WEBHOOK_SECRET = SECRET;
  const org = await prisma.organization.create({ data: { name: "Org" } });
  orgId = org.id;
  const consent = await prisma.checkoutConsent.create({
    data: { organizationId: orgId, planCode: "pro", priceId: "pri_pro", legalVersion: "2026-06", ip: "1.2.3.4" },
    select: { id: true },
  });
  consentId = consent.id;
});

describe("POST /api/webhooks/paddle", () => {
  it("is DORMANT without PADDLE_WEBHOOK_SECRET — 200 disabled, stores nothing", async () => {
    delete process.env.PADDLE_WEBHOOK_SECRET;
    const body = JSON.stringify({ event_id: "evt_x", event_type: "subscription.activated", data: {} });
    const res = await POST(req(body, null));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ disabled: true });
    expect(await prisma.webhookEvent.count()).toBe(0);
  });

  it("rejects a bad signature with 401 and stores nothing", async () => {
    const body = JSON.stringify({ event_id: "evt_bad", event_type: "subscription.activated", data: {} });
    const res = await POST(req(body, "ts=123;h1=deadbeef"));
    expect(res.status).toBe(401);
    expect(await prisma.webhookEvent.count()).toBe(0);
  });

  it("applies subscription.activated → upserts the org's Subscription", async () => {
    const body = JSON.stringify({
      event_id: "evt_sub_1",
      event_type: "subscription.activated",
      data: {
        id: "sub_123",
        status: "active",
        customer_id: "ctm_1",
        custom_data: { consentId },
        current_billing_period: { ends_at: "2026-07-15T00:00:00.000Z" },
        items: [{ price: { id: "pri_pro" } }],
      },
    });
    const res = await POST(req(body, sign(body)));
    expect(res.status).toBe(200);

    const sub = await prisma.subscription.findUnique({ where: { organizationId: orgId } });
    expect(sub).not.toBeNull();
    expect(sub?.status).toBe("active");
    expect(sub?.provider).toBe("paddle");
    expect(sub?.providerRef).toBe("sub_123");
    expect(sub?.planCode).toBe("pro");
    expect(sub?.currentPeriodEnd?.toISOString()).toBe("2026-07-15T00:00:00.000Z");
    // KVKK erasure's authoritative anchor: the customer id is stored from an event
    // whose org was resolved via consent/providerRef — never client custom_data.
    expect(sub?.customerId).toBe("ctm_1");

    const evt = await prisma.webhookEvent.findUnique({ where: { providerEventId: "evt_sub_1" } });
    expect(evt?.status).toBe("processed");
  });

  it("resolves the org from the server-trusted consentId, IGNORING a forged custom_data.organizationId", async () => {
    // Consent row created from the paying user's OWN session (org = orgId).
    const user = await prisma.user.create({
      data: { organizationId: orgId, name: "U", email: "u@x.com", passwordHash: "x", role: "owner" },
    });
    const consent = await prisma.checkoutConsent.create({
      data: {
        organizationId: orgId,
        userId: user.id,
        planCode: "pro",
        priceId: "pri_pro",
        legalVersion: "2026-06",
        ip: "1.2.3.4",
        userAgent: "x",
      },
      select: { id: true },
    });
    // A DIFFERENT org whose id an attacker forges into custom_data.
    const victim = await prisma.organization.create({ data: { name: "Victim" } });

    const body = JSON.stringify({
      event_id: "evt_consent",
      event_type: "subscription.activated",
      data: {
        id: "sub_c",
        status: "active",
        custom_data: { organizationId: victim.id, consentId: consent.id }, // forged org + real consent
        items: [{ price: { id: "pri_pro" } }],
      },
    });
    const res = await POST(req(body, sign(body)));
    expect(res.status).toBe(200);

    // The subscription lands on the CONSENT's org, never the forged victim org.
    expect(await prisma.subscription.findUnique({ where: { organizationId: orgId } })).not.toBeNull();
    expect(await prisma.subscription.findUnique({ where: { organizationId: victim.id } })).toBeNull();
  });

  it("MISSING consentId + forged org (no existing sub) → binds NOTHING (no raw-org fallback)", async () => {
    const victim = await prisma.organization.create({ data: { name: "Victim" } });
    const body = JSON.stringify({
      event_id: "evt_noconsent",
      event_type: "subscription.activated",
      data: {
        id: "sub_x",
        status: "active",
        custom_data: { organizationId: victim.id }, // forged, no consentId
        items: [{ price: { id: "pri_pro" } }],
      },
    });
    expect((await POST(req(body, sign(body)))).status).toBe(200); // recorded only
    expect(await prisma.subscription.count()).toBe(0); // nothing applied to any org
  });

  it("INVALID consentId + forged org → binds NOTHING", async () => {
    const victim = await prisma.organization.create({ data: { name: "Victim" } });
    const body = JSON.stringify({
      event_id: "evt_badconsent",
      event_type: "subscription.activated",
      data: {
        id: "sub_y",
        status: "active",
        custom_data: { organizationId: victim.id, consentId: "cns_does_not_exist" },
        items: [{ price: { id: "pri_pro" } }],
      },
    });
    expect((await POST(req(body, sign(body)))).status).toBe(200);
    expect(await prisma.subscription.count()).toBe(0);
  });

  it("consent priceId ≠ event priceId → REJECTED (nothing applied)", async () => {
    const body = JSON.stringify({
      event_id: "evt_pricemismatch",
      event_type: "subscription.activated",
      data: {
        id: "sub_z",
        status: "active",
        custom_data: { consentId }, // consent priceId is pri_pro
        items: [{ price: { id: "pri_business" } }], // event is a different price
      },
    });
    expect((await POST(req(body, sign(body)))).status).toBe(200);
    expect(await prisma.subscription.count()).toBe(0);
  });

  it("EXPIRED consent (> TTL) → REJECTED", async () => {
    const stale = await prisma.checkoutConsent.create({
      data: {
        organizationId: orgId,
        planCode: "pro",
        priceId: "pri_pro",
        legalVersion: "2026-06",
        ip: "1.2.3.4",
        createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000), // 25h ago (> 24h TTL)
      },
      select: { id: true },
    });
    const body = JSON.stringify({
      event_id: "evt_expired",
      event_type: "subscription.activated",
      data: {
        id: "sub_e",
        status: "active",
        custom_data: { consentId: stale.id },
        items: [{ price: { id: "pri_pro" } }],
      },
    });
    expect((await POST(req(body, sign(body)))).status).toBe(200);
    expect(await prisma.subscription.count()).toBe(0);
  });

  it("LATE retry — occurred_at was fresh at payment, delivered >24h later → ACCEPTED (no lost entitlement)", async () => {
    // Consent created 48h ago; the customer actually PAID 1 min later (occurred_at),
    // but Paddle only delivered the webhook now (outage/retry). Freshness must be
    // judged by the signed occurred_at, not arrival time — else a real payment drops.
    const consent = await prisma.checkoutConsent.create({
      data: {
        organizationId: orgId,
        planCode: "pro",
        priceId: "pri_pro",
        legalVersion: "2026-06",
        ip: "1.2.3.4",
        createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
      },
      select: { id: true },
    });
    const body = JSON.stringify({
      event_id: "evt_late",
      event_type: "subscription.activated",
      occurred_at: new Date(Date.now() - 48 * 60 * 60 * 1000 + 60_000).toISOString(), // paid ~1 min after consent
      data: { id: "sub_late", status: "active", custom_data: { consentId: consent.id }, items: [{ price: { id: "pri_pro" } }] },
    });
    expect((await POST(req(body, sign(body)))).status).toBe(200);
    expect(await prisma.subscription.count({ where: { organizationId: orgId } })).toBe(1);
  });

  it("FUTURE occurred_at (beyond skew) → fail-closed REJECTED", async () => {
    // Consent is fresh (created now) but the event claims to have occurred 2h in the
    // future — anomalous (a real event can't occur later than now). Fail closed.
    const body = JSON.stringify({
      event_id: "evt_future",
      event_type: "subscription.activated",
      occurred_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      data: { id: "sub_future", status: "active", custom_data: { consentId }, items: [{ price: { id: "pri_pro" } }] },
    });
    expect((await POST(req(body, sign(body)))).status).toBe(200);
    expect(await prisma.subscription.count()).toBe(0);
  });

  it("consent genuinely STALE at payment time (occurred_at − consent > 24h) → REJECTED", async () => {
    // Consent 48h old AND the payment (occurred_at) also happened ~48h after it →
    // truly stale nonce, not a late delivery. Still rejected.
    const consent = await prisma.checkoutConsent.create({
      data: {
        organizationId: orgId,
        planCode: "pro",
        priceId: "pri_pro",
        legalVersion: "2026-06",
        ip: "1.2.3.4",
        createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
      },
      select: { id: true },
    });
    const body = JSON.stringify({
      event_id: "evt_stale",
      event_type: "subscription.activated",
      occurred_at: new Date(Date.now() - 60_000).toISOString(), // paid ~now = ~48h after consent
      data: { id: "sub_stale", status: "active", custom_data: { consentId: consent.id }, items: [{ price: { id: "pri_pro" } }] },
    });
    expect((await POST(req(body, sign(body)))).status).toBe(200);
    expect(await prisma.subscription.count()).toBe(0);
  });

  it("transaction + subscription events safely SHARE one consentId (both bind to the consent org)", async () => {
    // The consentId is echoed on BOTH events. With occurred_at-based freshness they
    // must both still resolve to the consent's org (the reason consumedAt was NOT
    // added — consuming on the first event would drop the other).
    const tx = JSON.stringify({
      event_id: "evt_share_tx",
      event_type: "transaction.completed",
      occurred_at: new Date().toISOString(),
      data: { id: "txn_share", status: "completed", custom_data: { consentId }, currency_code: "TRY", details: { totals: { grand_total: "89900" } } },
    });
    expect((await POST(req(tx, sign(tx)))).status).toBe(200);
    const sub = JSON.stringify({
      event_id: "evt_share_sub",
      event_type: "subscription.activated",
      occurred_at: new Date().toISOString(),
      data: { id: "sub_share", status: "active", custom_data: { consentId }, items: [{ price: { id: "pri_pro" } }] },
    });
    expect((await POST(req(sub, sign(sub)))).status).toBe(200);
    expect(await prisma.invoice.count({ where: { organizationId: orgId } })).toBe(1);
    expect(await prisma.subscription.count({ where: { organizationId: orgId } })).toBe(1);
  });

  it("EXISTING sub lifecycle: 30-day-old consentId but providerRef matches → canceled APPLIED (not dropped)", async () => {
    // A month-old subscription's lifecycle events still echo the ORIGINAL consentId
    // (now long stale). They must resolve via the stored providerRef, else a real
    // cancellation is dropped and the org keeps access it shouldn't.
    const staleConsent = await prisma.checkoutConsent.create({
      data: { organizationId: orgId, planCode: "pro", priceId: "pri_pro", legalVersion: "2026-06", ip: "1.2.3.4", createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      select: { id: true },
    });
    await prisma.subscription.create({
      data: { organizationId: orgId, planCode: "pro", status: "active", provider: "paddle", providerRef: "sub_known" },
    });
    const body = JSON.stringify({
      event_id: "evt_cancel_known",
      event_type: "subscription.canceled",
      occurred_at: new Date().toISOString(),
      data: { id: "sub_known", status: "canceled", custom_data: { consentId: staleConsent.id }, items: [{ price: { id: "pri_pro" } }] },
    });
    expect((await POST(req(body, sign(body)))).status).toBe(200);
    expect((await prisma.subscription.findUnique({ where: { organizationId: orgId } }))?.status).toBe("canceled");
  });

  it("EXISTING sub lifecycle: 30-day-old consentId, past_due resolves via providerRef → APPLIED", async () => {
    const staleConsent = await prisma.checkoutConsent.create({
      data: { organizationId: orgId, planCode: "pro", priceId: "pri_pro", legalVersion: "2026-06", ip: "1.2.3.4", createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      select: { id: true },
    });
    await prisma.subscription.create({
      data: { organizationId: orgId, planCode: "pro", status: "active", provider: "paddle", providerRef: "sub_pd" },
    });
    const body = JSON.stringify({
      event_id: "evt_pastdue_known",
      event_type: "subscription.past_due",
      occurred_at: new Date().toISOString(),
      data: { id: "sub_pd", status: "past_due", custom_data: { consentId: staleConsent.id }, items: [{ price: { id: "pri_pro" } }] },
    });
    expect((await POST(req(body, sign(body)))).status).toBe(200);
    expect((await prisma.subscription.findUnique({ where: { organizationId: orgId } }))?.status).toBe("past_due");
  });

  it("30-day-old consentId + UNKNOWN providerRef → REJECTED (a stale consent can't first-link)", async () => {
    const staleConsent = await prisma.checkoutConsent.create({
      data: { organizationId: orgId, planCode: "pro", priceId: "pri_pro", legalVersion: "2026-06", ip: "1.2.3.4", createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      select: { id: true },
    });
    // No local Subscription with this providerRef → no lifecycle match → stale consent → dropped.
    const body = JSON.stringify({
      event_id: "evt_unknown_ref",
      event_type: "subscription.updated",
      occurred_at: new Date().toISOString(),
      data: { id: "sub_unknown", status: "active", custom_data: { consentId: staleConsent.id }, items: [{ price: { id: "pri_pro" } }] },
    });
    expect((await POST(req(body, sign(body)))).status).toBe(200);
    expect(await prisma.subscription.count()).toBe(0);
  });

  it("forged organizationId is NEVER used (unknown providerRef, no valid consent)", async () => {
    const victim = await prisma.organization.create({ data: { name: "Victim" } });
    const body = JSON.stringify({
      event_id: "evt_forge_ref",
      event_type: "subscription.updated",
      occurred_at: new Date().toISOString(),
      data: { id: "sub_forge", status: "active", custom_data: { organizationId: victim.id }, items: [{ price: { id: "pri_pro" } }] },
    });
    expect((await POST(req(body, sign(body)))).status).toBe(200);
    expect(await prisma.subscription.count({ where: { organizationId: victim.id } })).toBe(0);
  });

  it("returns 5xx on a transient apply failure (event NOT processed), then applies idempotently on Paddle's retry", async () => {
    const body = JSON.stringify({
      event_id: "evt_retry_1",
      event_type: "subscription.activated",
      data: {
        id: "sub_r1",
        status: "active",
        custom_data: { consentId },
        items: [{ price: { id: "pri_pro" } }],
      },
    });

    // First delivery: signature valid + payload parses, but the apply throws
    // (transient DB error). Must return 5xx so Paddle re-delivers, and must NOT
    // mark the event processed or apply the mutation. Manual reassign + finally
    // restores the real method even if POST throws (a vi.spyOn().mockRestore() on
    // the shared Prisma delegate did not restore reliably and leaked to later tests).
    const origUpsert = prisma.subscription.upsert;
    prisma.subscription.upsert = (() =>
      Promise.reject(new Error("db down"))) as unknown as typeof origUpsert;
    const first = await POST(req(body, sign(body))).finally(() => {
      prisma.subscription.upsert = origUpsert;
    });
    expect(first.status).toBe(500);

    const ev1 = await prisma.webhookEvent.findUnique({ where: { providerEventId: "evt_retry_1" } });
    expect(ev1?.status).not.toBe("processed"); // stays "error" → a retry reprocesses it
    expect(await prisma.subscription.findUnique({ where: { organizationId: orgId } })).toBeNull(); // mutation not applied

    // Paddle re-delivers the SAME event → now the idempotent handler applies it
    // exactly once.
    const second = await POST(req(body, sign(body)));
    expect(second.status).toBe(200);
    const ev2 = await prisma.webhookEvent.findUnique({ where: { providerEventId: "evt_retry_1" } });
    expect(ev2?.status).toBe("processed");
    const sub = await prisma.subscription.findUnique({ where: { organizationId: orgId } });
    expect(sub?.status).toBe("active");
    expect(sub?.providerRef).toBe("sub_r1");
  });

  it("trial → paid: activation flips the existing trialing row to active and CLEARS trialEndsAt", async () => {
    // brand-new signup state: a trialing reverse-trial row already exists
    await prisma.subscription.create({
      data: {
        organizationId: orgId,
        planCode: "pro",
        status: "trialing",
        provider: "trial",
        trialEndsAt: new Date("2026-06-29T00:00:00.000Z"),
      },
    });
    const body = JSON.stringify({
      event_id: "evt_activate",
      event_type: "subscription.activated",
      data: {
        id: "sub_paid",
        status: "active",
        custom_data: { consentId },
        items: [{ price: { id: "pri_pro" } }],
      },
    });
    const res = await POST(req(body, sign(body)));
    expect(res.status).toBe(200);

    // still ONE row (upsert updated, not inserted), now active + trial marker gone
    expect(await prisma.subscription.count({ where: { organizationId: orgId } })).toBe(1);
    const sub = await prisma.subscription.findUnique({ where: { organizationId: orgId } });
    expect(sub?.status).toBe("active");
    expect(sub?.provider).toBe("paddle");
    expect(sub?.trialEndsAt).toBeNull();
  });

  it("dedupes a duplicate event_id (idempotent)", async () => {
    const body = JSON.stringify({
      event_id: "evt_dup",
      event_type: "subscription.updated",
      data: { id: "sub_1", status: "active", custom_data: { consentId }, items: [{ price: { id: "pri_pro" } }] },
    });
    await POST(req(body, sign(body)));
    const res2 = await POST(req(body, sign(body)));
    expect(await res2.json()).toEqual({ ok: true, duplicate: true });
    expect(await prisma.webhookEvent.count({ where: { providerEventId: "evt_dup" } })).toBe(1);
  });

  it("applies transaction.completed → creates a paid Invoice", async () => {
    const body = JSON.stringify({
      event_id: "evt_tx_1",
      event_type: "transaction.completed",
      data: {
        id: "txn_1",
        status: "completed",
        custom_data: { consentId },
        currency_code: "TRY",
        details: { totals: { grand_total: "89900" } },
      },
    });
    const res = await POST(req(body, sign(body)));
    expect(res.status).toBe(200);

    const inv = await prisma.invoice.findFirst({ where: { organizationId: orgId, provider: "paddle" } });
    expect(inv).not.toBeNull();
    expect(inv?.amountMinor).toBe(89900);
    expect(inv?.currency).toBe("TRY");
    expect(inv?.status).toBe("paid");
    expect(inv?.providerRef).toBe("txn_1");
  });

  it("records an event with no custom_data without creating a Subscription (no crash)", async () => {
    const body = JSON.stringify({
      event_id: "evt_nolink",
      event_type: "subscription.activated",
      data: { id: "sub_x", status: "active", items: [{ price: { id: "pri_pro" } }] },
    });
    const res = await POST(req(body, sign(body)));
    expect(res.status).toBe(200);
    expect(await prisma.webhookEvent.findUnique({ where: { providerEventId: "evt_nolink" } })).not.toBeNull();
    expect(await prisma.subscription.count()).toBe(0);
  });
});
