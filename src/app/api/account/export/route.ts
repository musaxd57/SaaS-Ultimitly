import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { forbidden } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// KVKK m.11 SELF-SERVE data access — the HOST exports THEIR OWN organization's
// data (no operator needed). Scoped strictly to session.organizationId and
// gated to owner/manager (canManage). COMPLETE export (Codex #34): reservations
// (incl. money + automation stamps), conversations + messages (incl. AI
// metadata), tasks + task updates (photo LINKS — binaries are files, not JSON),
// knowledge base, templates, calendar sources (the feed URL is the USER'S OWN
// credential — included for portability), supply requests, org settings,
// billing (subscription + invoices), audit log, checkout consents and the AI
// risk decision history.
//
// SYSTEM SECRETS ARE ALWAYS EXCLUDED: no passwordHash, no 2FA secret, no
// e-mail-verify/password-reset hashes, no encrypted Hospitable tokens. A pin
// test scans the serialized output for these field names.
// ---------------------------------------------------------------------------
export const GET = withManage(async (session) => {
  // OWNER-ONLY (Codex): the export carries the org's calendar-feed URLs
  // (bearer-like credentials), invoices and consent evidence — manager-level
  // access is not enough for a full-account data handover. withManage already
  // 403s staff; this narrows the remaining manager case.
  if (session.role !== "owner") return forbidden();
  const orgId = session.organizationId;
  const [org, subscription, invoices, auditLogs, checkoutConsents, riskEvents, messageDelivery] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        id: true,
        name: true,
        plan: true,
        timezone: true,
        language: true,
        alertEmail: true,
        createdAt: true,
        // Settings the host configured (their data) — never the encrypted
        // Hospitable token/refresh-token fields.
        autoReplyHospitable: true,
        autoReplyStartHour: true,
        autoReplyEndHour: true,
        aiReplyTone: true,
        aiSignature: true,
        autoReplyDisclosure: true,
        autoHoldingReplyEnabled: true,
        autoClosingReplyEnabled: true,
        autoTaskFromMessageEnabled: true,
        autoSupplyRequestEnabled: true,
        autoWelcome: true,
        autoCheckin: true,
        autoCheckout: true,
        icalShowGuestName: true,
        handoffHoldHours: true,
        supplyStockJson: true,
        users: {
          select: {
            id: true, name: true, email: true, role: true, createdAt: true,
            // Consent evidence belongs to the user — part of their data.
            acceptedTermsAt: true, privacyAcceptedAt: true, acceptedLegalVersion: true,
            twoFactorEnabledAt: true,
          },
        },
        properties: {
          select: {
            id: true,
            name: true,
            address: true,
            city: true,
            country: true,
            checkInTime: true,
            checkOutTime: true,
            notes: true,
            createdAt: true,
            calendarSources: {
              select: {
                id: true, label: true, url: true, lastSyncedAt: true,
                lastStatus: true, lastResult: true, createdAt: true,
              },
            },
            supplyRequests: {
              select: {
                id: true, itemKey: true, qty: true, reservationId: true,
                sourceMessageId: true, createdAt: true,
              },
            },
            reservations: {
              select: {
                id: true, guestName: true, guestPhone: true, guestEmail: true,
                guestExternalId: true, arrivalDate: true, departureDate: true,
                channel: true, status: true, sourceReference: true, calendarSourceId: true,
                totalAmount: true, totalAmountDec: true, currency: true, notes: true,
                guestCheckoutTime: true, welcomeSentAt: true, checkinSentAt: true,
                checkoutSentAt: true, createdAt: true,
              },
            },
            conversations: {
              select: {
                id: true,
                channel: true,
                status: true,
                priority: true,
                guestIdentifier: true,
                skippedReason: true,
                lastRiskLevel: true,
                lastRiskType: true,
                createdAt: true,
                lastMessageAt: true,
                messages: {
                  select: {
                    id: true, direction: true, senderName: true, body: true,
                    language: true, externalId: true, aiIntent: true,
                    aiConfidence: true, aiAssisted: true, aiSourcesJson: true,
                    createdAt: true,
                  },
                },
              },
            },
            tasks: {
              select: {
                id: true, type: true, origin: true, title: true, description: true,
                status: true, priority: true, dueAt: true, assignedToId: true,
                checklistJson: true, sourceMessageId: true, dedupeKey: true, createdAt: true,
                updates: {
                  select: { id: true, userId: true, status: true, note: true, photoUrl: true, createdAt: true },
                },
              },
            },
            knowledgeBase: {
              select: {
                id: true, category: true, title: true, content: true,
                language: true, isActive: true, createdAt: true,
              },
            },
          },
        },
        messageTemplates: {
          select: {
            id: true, category: true, title: true, body: true,
            language: true, isActive: true, createdAt: true,
          },
        },
      },
    }),
    prisma.subscription.findUnique({
      where: { organizationId: orgId },
      select: {
        planCode: true, status: true, provider: true, providerRef: true,
        customerId: true, trialEndsAt: true, pastDueSince: true,
        lastEventAt: true, createdAt: true,
      },
    }),
    prisma.invoice.findMany({
      where: { organizationId: orgId },
      select: {
        id: true, amountMinor: true, currency: true, status: true,
        provider: true, providerRef: true, eArchiveStatus: true,
        issuedAt: true, paidAt: true,
      },
      orderBy: { issuedAt: "asc" },
    }),
    prisma.auditLog.findMany({
      where: { organizationId: orgId },
      select: { id: true, actorUserId: true, action: true, metadataJson: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.checkoutConsent.findMany({
      where: { organizationId: orgId },
      select: {
        id: true, userId: true, planCode: true, priceId: true,
        legalVersion: true, ip: true, userAgent: true, createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.riskEvent.findMany({
      where: { organizationId: orgId },
      select: {
        id: true, surface: true, triggerId: true, finalDecision: true,
        riskLevel: true, riskType: true, reason: true, confidence: true,
        propertyId: true, conversationId: true, occurredAt: true,
      },
      orderBy: { occurredAt: "asc" },
    }),
    // Durable-outbox delivery audit: the per-message send outcome, so a draft that was
    // never delivered (status "canceled" = a send-time veto superseded it; "review"/"failed"
    // = stuck; "blocked" = Hospitable subscription not active) is DISTINGUISHABLE from a
    // delivered reply. No body here — it lives on the linked Message (join by messageId);
    // this is the delivery ledger only.
    prisma.messageOutbox.findMany({
      where: { organizationId: orgId },
      select: {
        id: true, conversationId: true, messageId: true, channel: true, status: true,
        attemptCount: true, lastErrorKind: true, lastErrorCode: true, sentAt: true, createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  if (!org) return forbidden();

  await writeAudit({
    organizationId: orgId,
    actorUserId: session.actorUserId ?? session.userId,
    action: "data.export_self",
    metadata: { email: session.email },
  });

  const safeName = org.name.replace(/[^a-z0-9]+/gi, "_").slice(0, 40) || "isletme";
  const filename = `lixus-verilerim-${safeName}-${new Date().toISOString().slice(0, 10)}.json`;
  const body = JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      organization: org,
      billing: { subscription, invoices },
      auditLogs,
      checkoutConsents,
      riskEvents,
      messageDelivery,
    },
    null,
    2,
  );

  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // Never let a proxy/browser cache a file full of credentials + PII.
      "Cache-Control": "no-store",
    },
  });
});
