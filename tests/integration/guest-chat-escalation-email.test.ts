import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";
import { generateChatToken } from "@/lib/guest-chat";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SuggestReplyResult } from "@/lib/ai/types";

// Codex #15 — QR escalation e-mail. Pins: env gate default-OFF, per-stay
// windowed dedupe, per-tenant recipient (NEVER env ALERT_EMAIL), minimal
// content (no guest text), and the failure path (chat unaffected + claim
// released + visible reportError).

vi.mock("@/lib/ai", () => ({ suggestReply: vi.fn() }));
vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) },
}));
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn(async () => {}) };
});

import { suggestReply } from "@/lib/ai";
import { emailService } from "@/lib/email";
import { reportError } from "@/lib/report-error";
import { maybeSendQrEscalationEmail, QR_ESCALATION_REARM_MS } from "@/lib/guest-chat-alerts";
import { POST } from "@/app/api/chat/[token]/route";

const mockSuggest = vi.mocked(suggestReply);
const mockSendReporting = vi.mocked(emailService.sendReporting);
const mockReportError = vi.mocked(reportError);

const ENV_KEYS = ["GUEST_CHAT_ENABLED", "QR_ESCALATION_EMAIL_ENABLED", "ALERT_EMAIL"] as const;
const ORIGINAL: Record<string, string | undefined> = {};

function aiResult(over: Partial<SuggestReplyResult> = {}): SuggestReplyResult {
  return {
    intent: "general",
    confidence: 0.9,
    reply: "Çöp salı günü toplanır.",
    risk: null,
    priority: "standard",
    source: "openai",
    actionSuggestion: null,
    riskLevel: "none",
    detectedLanguage: "tr",
    riskType: null,
    usedSources: [],
    missingInfo: [],
    statedCheckoutTime: null,
    ...over,
  };
}

function call(token: string, message: string) {
  const req = new Request(`http://localhost/api/chat/${token}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
    body: JSON.stringify({ message }),
  });
  return POST(req as never, { params: Promise.resolve({ token }) });
}

/** Org + chat-enabled property + active stay; returns ids + token. */
async function fixture() {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const token = generateChatToken();
  await prisma.property.update({
    where: { id: propertyId },
    data: { chatToken: token, chatEnabled: true },
  });
  const reservation = await prisma.reservation.create({
    data: {
      propertyId,
      guestName: "Misafir",
      arrivalDate: daysFromNow(-1),
      departureDate: daysFromNow(2),
      status: "confirmed",
      channel: "airbnb",
    },
  });
  return { orgId, propertyId, token, reservationId: reservation.id };
}

beforeEach(async () => {
  await resetDb();
  __resetRateLimit();
  vi.clearAllMocks();
  mockSuggest.mockResolvedValue(aiResult());
  mockSendReporting.mockResolvedValue({ ok: true });
  for (const k of ENV_KEYS) ORIGINAL[k] = process.env[k];
  process.env.GUEST_CHAT_ENABLED = "1";
  process.env.QR_ESCALATION_EMAIL_ENABLED = "1";
  delete process.env.ALERT_EMAIL;
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (ORIGINAL[k] === undefined) delete process.env[k];
    else process.env[k] = ORIGINAL[k];
  }
});

describe("maybeSendQrEscalationEmail (lib)", () => {
  it("GATE default OFF: without the env, nothing is sent and no claim is written", async () => {
    const { orgId, reservationId } = await fixture();
    delete process.env.QR_ESCALATION_EMAIL_ENABLED;
    const r = await maybeSendQrEscalationEmail({
      organizationId: orgId, propertyName: "Test Property", reservationId, reason: "ai_escalated",
    });
    expect(r.sent).toBe(false);
    expect(mockSendReporting).not.toHaveBeenCalled();
    const row = await prisma.reservation.findUnique({ where: { id: reservationId } });
    expect(row?.qrEscalationEmailAt).toBeNull();
  });

  it("sends to the org's alertEmail; a second escalation in the window is DEDUPED", async () => {
    const { orgId, reservationId } = await fixture();
    await prisma.organization.update({ where: { id: orgId }, data: { alertEmail: "host@example.com" } });
    const first = await maybeSendQrEscalationEmail({
      organizationId: orgId, propertyName: "Test Property", reservationId, reason: "ai_escalated",
    });
    const second = await maybeSendQrEscalationEmail({
      organizationId: orgId, propertyName: "Test Property", reservationId, reason: "ai_escalated",
    });
    expect(first.sent).toBe(true);
    expect(second).toEqual({ sent: false, deduped: true });
    expect(mockSendReporting).toHaveBeenCalledTimes(1);
    expect(mockSendReporting.mock.calls[0][0]).toBe("host@example.com");
  });

  it("falls back to the OWNER's (oldest user's) e-mail — never the env ALERT_EMAIL", async () => {
    const { orgId, reservationId } = await fixture();
    process.env.ALERT_EMAIL = "operator@lixusai.com"; // must NOT be used
    await prisma.user.create({
      data: { organizationId: orgId, name: "Owner", email: "owner@example.com", passwordHash: "x" },
    });
    await prisma.user.create({
      data: { organizationId: orgId, name: "Staff", email: "staff@example.com", passwordHash: "x", role: "staff" },
    });
    const r = await maybeSendQrEscalationEmail({
      organizationId: orgId, propertyName: "Test Property", reservationId, reason: "ai_escalated",
    });
    expect(r.sent).toBe(true);
    expect(mockSendReporting.mock.calls[0][0]).toBe("owner@example.com");
  });

  it("no recipient at all → nothing sent, claim RELEASED, operator address untouched", async () => {
    const { orgId, reservationId } = await fixture();
    process.env.ALERT_EMAIL = "operator@lixusai.com";
    const r = await maybeSendQrEscalationEmail({
      organizationId: orgId, propertyName: "Test Property", reservationId, reason: "ai_escalated",
    });
    expect(r.sent).toBe(false);
    expect(mockSendReporting).not.toHaveBeenCalled();
    const row = await prisma.reservation.findUnique({ where: { id: reservationId } });
    expect(row?.qrEscalationEmailAt).toBeNull(); // released for a later-configured recipient
  });

  it("send FAILURE: claim released + reportError (visible) → next escalation retries", async () => {
    const { orgId, reservationId } = await fixture();
    await prisma.organization.update({ where: { id: orgId }, data: { alertEmail: "host@example.com" } });
    mockSendReporting.mockResolvedValueOnce({ ok: false, error: "Resend HTTP 500" });
    const fail = await maybeSendQrEscalationEmail({
      organizationId: orgId, propertyName: "Test Property", reservationId, reason: "ai_escalated",
    });
    expect(fail.sent).toBe(false);
    expect(mockReportError).toHaveBeenCalledTimes(1);
    expect((await prisma.reservation.findUnique({ where: { id: reservationId } }))?.qrEscalationEmailAt).toBeNull();
    // retry works
    const retry = await maybeSendQrEscalationEmail({
      organizationId: orgId, propertyName: "Test Property", reservationId, reason: "ai_escalated",
    });
    expect(retry.sent).toBe(true);
  });

  it("re-arms after the window: an OLD claim doesn't suppress a genuinely new incident", async () => {
    const { orgId, reservationId } = await fixture();
    await prisma.organization.update({ where: { id: orgId }, data: { alertEmail: "host@example.com" } });
    await prisma.reservation.update({
      where: { id: reservationId },
      data: { qrEscalationEmailAt: new Date(Date.now() - QR_ESCALATION_REARM_MS - 60_000) },
    });
    const r = await maybeSendQrEscalationEmail({
      organizationId: orgId, propertyName: "Test Property", reservationId, reason: "ai_escalated",
    });
    expect(r.sent).toBe(true);
  });

  it("CLAIM RACE: two concurrent escalations produce exactly ONE e-mail", async () => {
    const { orgId, reservationId } = await fixture();
    await prisma.organization.update({ where: { id: orgId }, data: { alertEmail: "host@example.com" } });
    const results = await Promise.all([
      maybeSendQrEscalationEmail({ organizationId: orgId, propertyName: "P", reservationId, reason: "ai_escalated" }),
      maybeSendQrEscalationEmail({ organizationId: orgId, propertyName: "P", reservationId, reason: "ai_escalated" }),
    ]);
    expect(results.filter((r) => r.sent)).toHaveLength(1);
    expect(mockSendReporting).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/chat/[token] — escalation wires the e-mail", () => {
  it("an ESCALATED message e-mails the host: minimal content, panel link, NO guest text", async () => {
    const { orgId, token } = await fixture();
    await prisma.organization.update({ where: { id: orgId }, data: { alertEmail: "host@example.com" } });
    const guestText = "Daire çok pisti, paramı geri istiyorum!";
    const res = await call(token, guestText); // complaint → mustEscalate (fallback cross-check)
    expect(res.status).toBe(200);
    expect((await res.json()).escalated).toBe(true);

    expect(mockSendReporting).toHaveBeenCalledTimes(1);
    const [to, subject, html] = mockSendReporting.mock.calls[0];
    expect(to).toBe("host@example.com");
    expect(subject).toContain("Test Property");
    expect(html).toContain("/guest-chats"); // safe panel link (appBaseUrl-based)
    expect(html).toContain("Test Property");
    // privacy: the guest's words, name and any code-like value must NOT ride along
    expect(html).not.toContain("pisti");
    expect(html).not.toContain(guestText);
    expect(subject).not.toContain("Misafir!"); // no guest identifier in subject
  });

  it("a NON-escalated answer sends no e-mail", async () => {
    const { token } = await fixture();
    const res = await call(token, "Çöp ne zaman toplanıyor?");
    expect((await res.json()).escalated).toBe(false);
    expect(mockSendReporting).not.toHaveBeenCalled();
  });

  it("gate OFF: escalation still works, just no e-mail (existing behavior unchanged)", async () => {
    const { orgId, token } = await fixture();
    delete process.env.QR_ESCALATION_EMAIL_ENABLED;
    await prisma.organization.update({ where: { id: orgId }, data: { alertEmail: "host@example.com" } });
    const res = await call(token, "Paramı iade edin, rezaletti.");
    expect((await res.json()).escalated).toBe(true);
    expect(mockSendReporting).not.toHaveBeenCalled();
  });

  it("DAILY-CAP escalation also alerts (reason daily_cap), deduped with the same claim", async () => {
    const { orgId, propertyId, token } = await fixture();
    await prisma.organization.update({ where: { id: orgId }, data: { alertEmail: "host@example.com" } });
    const day = new Date().toISOString().slice(0, 10);
    await prisma.chatUsage.create({ data: { propertyId, day, count: 200 } }); // at cap → next call is over
    const res = await call(token, "Merhaba, bir sorum var");
    expect((await res.json()).escalated).toBe(true);
    expect(mockSendReporting).toHaveBeenCalledTimes(1);
    expect(mockSendReporting.mock.calls[0][2]).toContain("limit"); // daily_cap reason text
  });

  it("e-mail failure NEVER breaks the guest's chat response", async () => {
    const { orgId, token } = await fixture();
    await prisma.organization.update({ where: { id: orgId }, data: { alertEmail: "host@example.com" } });
    mockSendReporting.mockResolvedValueOnce({ ok: false, error: "boom" });
    const res = await call(token, "İade istiyorum, berbattı.");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.escalated).toBe(true);
    expect(json.reply).toContain("ilettim"); // guest still gets the canned handoff
    expect(mockReportError).toHaveBeenCalled();
  });
});
