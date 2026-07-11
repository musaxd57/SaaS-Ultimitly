import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { subMonths } from "date-fns";
import { prisma, resetDb } from "../helpers/db";
import { anonymizeOldGuestData, deleteAccountData, purgeOldLeads } from "@/lib/data-retention";

async function seedStay(opts: {
  orgName?: string;
  departedMonthsAgo: number;
  guestName: string;
  body: string;
  outboundBody?: string;
}) {
  const org = await prisma.organization.create({ data: { name: opts.orgName ?? "Org" } });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Daire 1" } });
  const reservation = await prisma.reservation.create({
    data: {
      propertyId: property.id,
      guestName: opts.guestName,
      guestPhone: "+905551112233",
      guestEmail: "guest@example.com",
      guestExternalId: "g-ext-1",
      arrivalDate: subMonths(new Date(), opts.departedMonthsAgo + 1),
      departureDate: subMonths(new Date(), opts.departedMonthsAgo),
      status: "completed",
    },
  });
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      reservationId: reservation.id,
      channel: "airbnb",
      guestIdentifier: opts.guestName,
      messages: {
        create: [
          { direction: "inbound", senderName: opts.guestName, body: opts.body },
          { direction: "outbound", senderName: "Lixus AI", body: opts.outboundBody ?? "Yardımcı olalım." },
        ],
      },
    },
  });
  return { orgId: org.id, propertyId: property.id, reservationId: reservation.id, conversationId: conversation.id };
}

async function outboundBodyOf(conversationId: string): Promise<string> {
  const m = await prisma.message.findFirst({ where: { conversationId, direction: "outbound" } });
  return m?.body ?? "";
}

describe("anonymizeOldGuestData (KVKK retention)", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is a no-op when DATA_RETENTION_MONTHS is not set", async () => {
    const { reservationId } = await seedStay({ departedMonthsAgo: 40, guestName: "John Old", body: "Eski mesaj" });
    const r = await anonymizeOldGuestData();
    expect(r.anonymized).toBe(0);
    const res = await prisma.reservation.findUnique({ where: { id: reservationId } });
    expect(res?.guestName).toBe("John Old"); // untouched while disabled
  });

  it("anonymizes long-past guest PII but leaves recent stays intact", async () => {
    vi.stubEnv("DATA_RETENTION_MONTHS", "24");
    const old = await seedStay({ departedMonthsAgo: 30, guestName: "John Old", body: "Klima bozuk, çok kötü!" });
    const recent = await seedStay({ departedMonthsAgo: 1, guestName: "Jane New", body: "Wifi şifresi nedir?" });

    const r = await anonymizeOldGuestData();
    expect(r.anonymized).toBe(1);

    // Old stay scrubbed
    const oldRes = await prisma.reservation.findUnique({ where: { id: old.reservationId } });
    expect(oldRes?.guestName).toBe("Eski misafir");
    expect(oldRes?.guestPhone).toBeNull();
    expect(oldRes?.guestEmail).toBeNull();
    expect(oldRes?.guestExternalId).toBeNull();
    const oldConv = await prisma.conversation.findUnique({
      where: { id: old.conversationId },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    expect(oldConv?.guestIdentifier).toBe("Misafir");
    const inbound = oldConv?.messages.find((m) => m.direction === "inbound");
    const outbound = oldConv?.messages.find((m) => m.direction === "outbound");
    expect(inbound?.body).not.toContain("Klima");
    expect(inbound?.senderName).toBe("Misafir");
    expect(outbound?.body).toContain("Yardımcı"); // host's own outbound left intact

    // Recent stay untouched
    const recentRes = await prisma.reservation.findUnique({ where: { id: recent.reservationId } });
    expect(recentRes?.guestName).toBe("Jane New");
    const recentConv = await prisma.conversation.findUnique({
      where: { id: recent.conversationId },
      include: { messages: true },
    });
    expect(recentConv?.guestIdentifier).toBe("Jane New");
    expect(recentConv?.messages.some((m) => m.body.includes("Wifi"))).toBe(true);
  });

  it("is idempotent — a second run does nothing (already anonymized)", async () => {
    vi.stubEnv("DATA_RETENTION_MONTHS", "24");
    await seedStay({ departedMonthsAgo: 30, guestName: "John Old", body: "Bozuk!" });
    expect((await anonymizeOldGuestData()).anonymized).toBe(1);
    expect((await anonymizeOldGuestData()).anonymized).toBe(0);
  });

  it("anonymizes ORPHANED conversations (no reservation link) by their own age", async () => {
    // Reproduces the real gap: a thread whose reservation the host deleted
    // (reservationId → null via SetNull) is unreachable through the reservation
    // sweep and would otherwise keep the guest's message body + identifier forever.
    vi.stubEnv("DATA_RETENTION_MONTHS", "24");
    const org = await prisma.organization.create({ data: { name: "Org" } });
    const property = await prisma.property.create({ data: { organizationId: org.id, name: "Daire 1" } });
    const oldOrphan = await prisma.conversation.create({
      data: {
        propertyId: property.id,
        channel: "airbnb",
        guestIdentifier: "Ahmet Yılmaz",
        lastMessageAt: subMonths(new Date(), 30),
        messages: { create: [{ direction: "inbound", senderName: "Ahmet Yılmaz", body: "Kapı kodu nedir?" }] },
      },
    });
    const recentOrphan = await prisma.conversation.create({
      data: {
        propertyId: property.id,
        channel: "airbnb",
        guestIdentifier: "Yeni Misafir",
        lastMessageAt: subMonths(new Date(), 1),
        messages: { create: [{ direction: "inbound", senderName: "Yeni Misafir", body: "Merhaba" }] },
      },
    });

    const r = await anonymizeOldGuestData();
    expect(r.anonymized).toBe(1);

    const scrubbed = await prisma.conversation.findUnique({
      where: { id: oldOrphan.id },
      include: { messages: true },
    });
    expect(scrubbed?.guestIdentifier).toBe("Misafir");
    expect(scrubbed?.messages[0].body).not.toContain("Kapı kodu");
    expect(scrubbed?.messages[0].body).toContain("saklama süresi");

    const intact = await prisma.conversation.findUnique({
      where: { id: recentOrphan.id },
      include: { messages: true },
    });
    expect(intact?.guestIdentifier).toBe("Yeni Misafir");
    expect(intact?.messages[0].body).toContain("Merhaba");
  });
});

describe("anonymizeOldGuestData — outbound body name redaction (KVKK)", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("scrubs the guest name from the host's outbound reply but keeps the host content", async () => {
    // The load-bearing case: an automated greeting uses the FIRST name ("Merhaba
    // Ahmet,") and a manual host reply may sign off with the FULL name. Both must go,
    // the operational content ("anahtar kutuda") must stay.
    vi.stubEnv("DATA_RETENTION_MONTHS", "24");
    const s = await seedStay({
      departedMonthsAgo: 30,
      guestName: "Ahmet Yılmaz",
      body: "Kapı kodu nedir?",
      outboundBody: "Merhaba Ahmet, anahtar kutuda. — Ahmet Yılmaz",
    });

    expect((await anonymizeOldGuestData()).anonymized).toBe(1);

    const body = await outboundBodyOf(s.conversationId);
    expect(body).not.toContain("Ahmet");
    expect(body).not.toContain("Yılmaz");
    expect(body).toContain("[Misafir]");
    expect(body).toContain("anahtar kutuda"); // host's own record preserved
  });

  it("leaves ultra-short names alone so real words aren't mangled", async () => {
    // "Su" (2 chars) is also the Turkish word for "water"; redacting it blindly would
    // corrupt "Su tesisatı". The full name still goes; the bare short first name is a
    // deliberate, documented residual.
    vi.stubEnv("DATA_RETENTION_MONTHS", "24");
    const s = await seedStay({
      departedMonthsAgo: 30,
      guestName: "Su Yılmaz",
      body: "Merhaba",
      outboundBody: "Su tesisatı çalışıyor. İyi günler Su Yılmaz.",
    });

    expect((await anonymizeOldGuestData()).anonymized).toBe(1);

    const body = await outboundBodyOf(s.conversationId);
    expect(body).toContain("Su tesisatı"); // real word NOT mangled
    expect(body).not.toContain("Yılmaz"); // full name redacted
    expect(body).toContain("[Misafir]");
  });

  it("is idempotent — a second sweep leaves the redacted body byte-identical", async () => {
    vi.stubEnv("DATA_RETENTION_MONTHS", "24");
    const s = await seedStay({
      departedMonthsAgo: 30,
      guestName: "Mehmet Demir",
      body: "Soru",
      outboundBody: "Merhaba Mehmet, hoş geldiniz Mehmet Demir.",
    });

    expect((await anonymizeOldGuestData()).anonymized).toBe(1);
    const first = await outboundBodyOf(s.conversationId);
    expect(first).not.toContain("Mehmet");

    expect((await anonymizeOldGuestData()).anonymized).toBe(0);
    const second = await outboundBodyOf(s.conversationId);
    expect(second).toBe(first);
  });

  it("does NOT touch outbound bodies of recent (in-window) stays", async () => {
    vi.stubEnv("DATA_RETENTION_MONTHS", "24");
    const s = await seedStay({
      departedMonthsAgo: 1,
      guestName: "Ayşe Kaya",
      body: "Merhaba",
      outboundBody: "Merhaba Ayşe, teşekkürler.",
    });

    expect((await anonymizeOldGuestData()).anonymized).toBe(0);

    const body = await outboundBodyOf(s.conversationId);
    expect(body).toContain("Ayşe"); // still in the retention window → untouched
  });

  it("redacts the name from an ORPHAN thread's outbound body (guestIdentifier is the only name source)", async () => {
    vi.stubEnv("DATA_RETENTION_MONTHS", "24");
    const org = await prisma.organization.create({ data: { name: "Org" } });
    const property = await prisma.property.create({ data: { organizationId: org.id, name: "Daire 1" } });
    const orphan = await prisma.conversation.create({
      data: {
        propertyId: property.id,
        channel: "airbnb",
        guestIdentifier: "Fatma Şahin",
        lastMessageAt: subMonths(new Date(), 30),
        messages: {
          create: [
            { direction: "inbound", senderName: "Fatma Şahin", body: "Kapı kodu nedir?" },
            { direction: "outbound", senderName: "Lixus AI", body: "Merhaba Fatma, kod 1234. — Fatma Şahin" },
          ],
        },
      },
    });

    expect((await anonymizeOldGuestData()).anonymized).toBe(1);

    const body = await outboundBodyOf(orphan.id);
    expect(body).not.toContain("Fatma");
    expect(body).not.toContain("Şahin");
    expect(body).toContain("[Misafir]");
    expect(body).toContain("kod 1234"); // host content preserved
  });
});

describe("purgeOldLeads (KVKK lead retention)", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is a no-op when LEAD_RETENTION_MONTHS is not set (never silently purges sales pipeline)", async () => {
    await prisma.lead.create({ data: { name: "Old", email: "a@b.com", createdAt: subMonths(new Date(), 40) } });
    expect((await purgeOldLeads()).purged).toBe(0);
    expect(await prisma.lead.count()).toBe(1);
  });

  it("deletes leads past the window and keeps recent ones", async () => {
    vi.stubEnv("LEAD_RETENTION_MONTHS", "24");
    const oldLead = await prisma.lead.create({ data: { name: "Old", email: "old@x.com", createdAt: subMonths(new Date(), 30) } });
    const recentLead = await prisma.lead.create({ data: { name: "New", email: "new@x.com", createdAt: subMonths(new Date(), 2) } });
    expect((await purgeOldLeads()).purged).toBe(1);
    expect(await prisma.lead.findUnique({ where: { id: oldLead.id } })).toBeNull();
    expect(await prisma.lead.findUnique({ where: { id: recentLead.id } })).not.toBeNull();
  });
});

describe("deleteAccountData (KVKK erasure)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("permanently deletes the org + all its data and leaves other orgs intact", async () => {
    const a = await seedStay({ orgName: "Org A", departedMonthsAgo: 2, guestName: "A Guest", body: "msg A" });
    const b = await seedStay({ orgName: "Org B", departedMonthsAgo: 2, guestName: "B Guest", body: "msg B" });
    // ChatUsage has no FK relation → must be cleared explicitly by deleteAccountData.
    await prisma.chatUsage.create({ data: { propertyId: a.propertyId, day: "2026-01-01", count: 5 } });

    await deleteAccountData(a.orgId);

    expect(await prisma.organization.findUnique({ where: { id: a.orgId } })).toBeNull();
    expect(await prisma.property.findUnique({ where: { id: a.propertyId } })).toBeNull();
    expect(await prisma.reservation.findUnique({ where: { id: a.reservationId } })).toBeNull();
    expect(await prisma.conversation.findUnique({ where: { id: a.conversationId } })).toBeNull();
    expect(await prisma.message.count({ where: { conversationId: a.conversationId } })).toBe(0);
    expect(await prisma.chatUsage.findFirst({ where: { propertyId: a.propertyId } })).toBeNull();

    // Org B fully intact.
    expect(await prisma.organization.findUnique({ where: { id: b.orgId } })).not.toBeNull();
    expect(await prisma.reservation.findUnique({ where: { id: b.reservationId } })).not.toBeNull();
    expect(await prisma.message.count({ where: { conversationId: b.conversationId } })).toBe(2);
  });

  it("minimizes Paddle webhook PII on erasure but keeps the financial skeleton", async () => {
    const a = await seedStay({ orgName: "Org A", departedMonthsAgo: 2, guestName: "A Guest", body: "msg A" });
    const b = await seedStay({ orgName: "Org B", departedMonthsAgo: 2, guestName: "B Guest", body: "msg B" });

    const payloadA = JSON.stringify({
      event_id: "evt_1",
      event_type: "transaction.completed",
      occurred_at: "2026-06-01T10:00:00Z",
      data: {
        id: "txn_1", status: "completed", customer_id: "ctm_1", subscription_id: "sub_1", currency_code: "TRY",
        customer: { email: "owner@a.com", name: "Ada Owner", address: { city: "İstanbul", postal_code: "34000" } },
        details: { totals: { grand_total: "44900" } },
        custom_data: { organizationId: a.orgId },
      },
    });
    const evtA = await prisma.webhookEvent.create({
      data: { provider: "paddle", eventType: "transaction.completed", providerEventId: "evt_1", payloadJson: payloadA, status: "processed" },
    });
    const payloadB = JSON.stringify({ event_id: "evt_2", data: { id: "txn_2", customer: { email: "owner@b.com" }, custom_data: { organizationId: b.orgId } } });
    const evtB = await prisma.webhookEvent.create({
      data: { provider: "paddle", eventType: "transaction.completed", providerEventId: "evt_2", payloadJson: payloadB, status: "processed" },
    });

    await deleteAccountData(a.orgId);

    // Org A's webhook SURVIVES (financial trail — Invoice/Subscription cascaded away) but PII is stripped.
    const redacted = await prisma.webhookEvent.findUnique({ where: { id: evtA.id } });
    expect(redacted).not.toBeNull();
    expect(redacted!.payloadJson).not.toContain("owner@a.com");
    expect(redacted!.payloadJson).not.toContain("Ada Owner");
    expect(redacted!.payloadJson).not.toContain("34000");
    // ...reconciliation skeleton kept.
    expect(redacted!.payloadJson).toContain("evt_1");
    expect(redacted!.payloadJson).toContain("txn_1");
    expect(redacted!.payloadJson).toContain("44900");
    expect(redacted!.payloadJson).toContain(a.orgId);
    expect(redacted!.payloadJson).toContain("kvkk-erasure");

    // A DIFFERENT org's webhook is byte-identical (untouched).
    const other = await prisma.webhookEvent.findUnique({ where: { id: evtB.id } });
    expect(other!.payloadJson).toBe(payloadB);
  });

  it("also redacts customer.* events (no custom_data) via the customer_id learned from the org's own rows", async () => {
    const a = await seedStay({ orgName: "Org A", departedMonthsAgo: 2, guestName: "A Guest", body: "msg A" });
    const b = await seedStay({ orgName: "Org B", departedMonthsAgo: 2, guestName: "B Guest", body: "msg B" });

    // A checkout-originating row FOR org A: carries custom_data.organizationId AND
    // the Paddle customer id — this is where the erasure LEARNS ctm_a.
    await prisma.webhookEvent.create({
      data: {
        provider: "paddle",
        eventType: "subscription.activated",
        providerEventId: "evt_link_a",
        status: "processed",
        payloadJson: JSON.stringify({
          event_id: "evt_link_a",
          event_type: "subscription.activated",
          data: { id: "sub_a", status: "active", customer_id: "ctm_a", custom_data: { organizationId: a.orgId } },
        }),
      },
    });
    // A Paddle-generated customer.updated FOR org A: NO custom_data (Paddle doesn't
    // stamp it), the customer entity itself is the payload → carries email/name.
    const custA = await prisma.webhookEvent.create({
      data: {
        provider: "paddle",
        eventType: "customer.updated",
        providerEventId: "evt_cust_a",
        status: "processed",
        payloadJson: JSON.stringify({
          event_id: "evt_cust_a",
          event_type: "customer.updated",
          data: { id: "ctm_a", status: "active", email: "owner@a.com", name: "Ada Owner" },
        }),
      },
    });
    // Org B's customer.updated with a DIFFERENT customer id: must stay untouched.
    const payloadCustB = JSON.stringify({
      event_id: "evt_cust_b",
      event_type: "customer.updated",
      data: { id: "ctm_b", email: "owner@b.com", name: "Bora Owner" },
    });
    const custB = await prisma.webhookEvent.create({
      data: { provider: "paddle", eventType: "customer.updated", providerEventId: "evt_cust_b", status: "processed", payloadJson: payloadCustB },
    });
    void b;

    await deleteAccountData(a.orgId);

    // The customer.updated row for A is now redacted even though it never carried
    // the org id: matched through ctm_a learned from A's own subscription row.
    const redacted = await prisma.webhookEvent.findUnique({ where: { id: custA.id } });
    expect(redacted!.payloadJson).not.toContain("owner@a.com");
    expect(redacted!.payloadJson).not.toContain("Ada Owner");
    expect(redacted!.payloadJson).toContain("ctm_a"); // provider id skeleton kept
    expect(redacted!.payloadJson).toContain("kvkk-erasure");

    // B's customer row is byte-identical.
    const otherCust = await prisma.webhookEvent.findUnique({ where: { id: custB.id } });
    expect(otherCust!.payloadJson).toBe(payloadCustB);
  });
});
