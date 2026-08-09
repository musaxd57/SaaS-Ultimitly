import { prisma } from "@/lib/db";
import { getCalendarSourceUrl } from "@/lib/calendar-source-url";

// ---------------------------------------------------------------------------
// SINGLE-SOURCE organization data export (Codex 07-23 #5). Both KVKK data-access
// surfaces — the owner's self-serve /api/account/export AND the operator's
// /api/admin/export — MUST serialize the exact same allowlisted structure, or
// the two "data access request" answers silently diverge (the admin route used
// to ship a far narrower dump while claiming completeness). A parity test pins
// the two routes to identical key-path sets.
//
// Explicit allowlists (never `select: true` on a whole row) so a future schema
// column can't silently leak. SYSTEM SECRETS ARE ALWAYS EXCLUDED: no
// passwordHash, no 2FA secret, no e-mail-verify/password-reset hashes, no
// encrypted Hospitable tokens, no recovery-code hashes — the export tests scan
// the serialized output for these field names and seeded values.
// ---------------------------------------------------------------------------
/**
 * Replace every calendar-feed `url` with masked metadata, in place on the
 * already-selected payload.
 *
 * Done as a post-pass rather than in the `select` so the allowlist above stays
 * the single readable inventory of what the export covers — and so BOTH routes
 * (self-service + operator) get it from the one shared builder, with no way for
 * one to drift back to the raw value.
 *
 * Kept: host + last 6 chars (identical policy to the UI's maskFeedUrl) plus a
 * `hasUrl` flag, so a host reading their export can still tell which feed each
 * row is and that one is configured.
 */
function maskFeedUrls<
  T extends {
    properties?: {
      calendarSources?: { id: string; url: string; urlEnc: string | null; urlKeyFp: string | null }[];
    }[];
  },
>(org: T, organizationId: string): T {
  for (const property of org.properties ?? []) {
    for (const src of property.calendarSources ?? []) {
      // THE accessor (url-encryption phase 3): the mask is built from the value
      // a sync would actually use. Ciphertext is a secret too — neither it nor
      // its fingerprint may appear in the export, so both columns are stripped
      // unconditionally. An unreadable ciphertext yields a diagnosis string,
      // never the plaintext column (fail-closed, same policy as the sync).
      const resolved = getCalendarSourceUrl(src, organizationId);
      const raw = resolved.ok ? resolved.url : "";
      const masked = src as unknown as {
        url?: unknown;
        urlEnc?: unknown;
        urlKeyFp?: unknown;
        urlMasked: string;
        hasUrl: boolean;
      };
      delete masked.url;
      delete masked.urlEnc;
      delete masked.urlKeyFp;
      masked.hasUrl = resolved.ok ? Boolean(raw) : true;
      if (!resolved.ok) {
        masked.urlMasked = "…(çözülemedi — şifreli değer bu kayıtla uyuşmuyor)";
        continue;
      }
      try {
        const u = new URL(raw);
        masked.urlMasked = `${u.protocol}//${u.host}/…${raw.slice(-6)}`;
      } catch {
        masked.urlMasked = `…${raw.slice(-6)}`;
      }
    }
  }
  return org;
}

export async function buildOrganizationDataExport(organizationId: string) {
  const [org, subscription, invoices, auditLogs, checkoutConsents, riskEvents, messageDelivery] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: organizationId },
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
        closingReplyText: true,
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
            acceptedLegalTextHash: true,
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
            // FEED URL IS A CAPABILITY SECRET — never exported verbatim.
            // Anyone holding it can read the property's booking calendar from
            // the channel, with no authentication. The UI already refuses to
            // render it in full (calendar-sources.tsx maskFeedUrl); the export
            // used to ship it raw, which is the same secret in a downloadable
            // file. `url` is replaced by masked metadata below — enough for the
            // host to tell WHICH feed a row is, useless to a leak. urlEnc and
            // urlKeyFp are selected ONLY to feed the accessor; maskFeedUrls
            // strips both before serialization (ciphertext is a secret too).
            calendarSources: {
              select: {
                id: true, label: true, url: true, urlEnc: true, urlKeyFp: true,
                lastSyncedAt: true, lastStatus: true, lastResult: true, createdAt: true,
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
                // m48 — müşterinin KENDİ verisi, ihraçta yer ALMALI.
                // ⚠️ `aiMissingInfoJson` HAM STRING olarak veriliyor,
                // ayrıştırılmadan: ihraç yolunda bir ayrıştırma patlarsa TÜM
                // ihracı düşürür ve müşteri verisine hiç ulaşamaz. Ham değer
                // her zaman okunabilir; biçimi yorumlamak tüketicinin işi.
                aiActionSuggestion: true,
                aiMissingInfoJson: true,
                aiConfidence: true,
                aiTriageSource: true,
                aiTriagedAt: true,
                // `aiTriageTriggerMessageId` BİLİNÇLİ YOK: opak bir iç id,
                // müşteriye hiçbir şey anlatmaz ve ihracı gürültülendirir.
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
      where: { organizationId },
      select: {
        planCode: true, status: true, provider: true, providerRef: true,
        customerId: true, trialEndsAt: true, pastDueSince: true,
        lastEventAt: true, createdAt: true,
      },
    }),
    prisma.invoice.findMany({
      where: { organizationId },
      select: {
        id: true, amountMinor: true, currency: true, status: true,
        provider: true, providerRef: true, eArchiveStatus: true,
        issuedAt: true, paidAt: true,
      },
      orderBy: { issuedAt: "asc" },
    }),
    prisma.auditLog.findMany({
      where: { organizationId },
      select: { id: true, actorUserId: true, action: true, metadataJson: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.checkoutConsent.findMany({
      where: { organizationId },
      select: {
        id: true, userId: true, planCode: true, priceId: true,
        legalVersion: true, legalTextHash: true, ip: true, userAgent: true, createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.riskEvent.findMany({
      where: { organizationId },
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
      where: { organizationId },
      select: {
        id: true, conversationId: true, messageId: true, channel: true, status: true,
        attemptCount: true, lastErrorKind: true, lastErrorCode: true, sentAt: true, createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  if (!org) return null;
  return {
    organization: maskFeedUrls(org, organizationId),
    billing: { subscription, invoices },
    auditLogs,
    checkoutConsents,
    riskEvents,
    messageDelivery,
  };
}
