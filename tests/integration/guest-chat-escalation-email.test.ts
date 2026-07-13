import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";
import { generateChatToken } from "@/lib/guest-chat";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SuggestReplyResult } from "@/lib/ai/types";

// Codex #15 + hardening round. Pins: env gate default-OFF, EVENT-identity
// dedupe (same message never re-mails, a DISTINCT later incident always
// mails), short anti-flood cooldown, tenant-bound claim, role-explicit owner
// fallback, exception-release, minimal content, failure never breaks the chat.

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
import {
  maybeSendQrEscalationEmail,
  qrEscalationEventId,
  QR_ESCALATION_COOLDOWN_MS,
  QR_ALERT_RESPONSE_BUDGET_MS,
} from "@/lib/guest-chat-alerts";
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

function call(token: string, message: string, cookie?: string) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": "203.0.113.9",
  };
  if (cookie) headers.cookie = cookie;
  const req = new Request(`http://localhost/api/chat/${token}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ message }),
  });
  return POST(req as never, { params: Promise.resolve({ token }) });
}

/** The per-stay device cookie the server set, as a "name=value" request header. */
function deviceCookie(res: Response): string | undefined {
  const sc = res.headers.get("set-cookie");
  return sc ? sc.split(";")[0] : undefined;
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

/** Shorthand: one lib call for a given event id. */
function alert(orgId: string, reservationId: string, eventId: string, propertyName = "Test Property") {
  return maybeSendQrEscalationEmail({
    organizationId: orgId,
    propertyName,
    reservationId,
    eventId,
    reason: "ai_escalated",
  });
}

/** Age the cooldown anchor so the NEXT distinct event is past the flood window. */
async function coolDown(reservationId: string) {
  await prisma.reservation.update({
    where: { id: reservationId },
    data: { qrEscalationEmailAt: new Date(Date.now() - QR_ESCALATION_COOLDOWN_MS - 60_000) },
  });
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
    const r = await alert(orgId, reservationId, "msg-1");
    expect(r.sent).toBe(false);
    expect(mockSendReporting).not.toHaveBeenCalled();
    const row = await prisma.reservation.findUnique({ where: { id: reservationId } });
    expect(row?.qrEscalationEmailAt).toBeNull();
    expect(row?.qrEscalationEmailMessageId).toBeNull();
  });

  it("EVENT IDENTITY: the SAME event never re-mails — even after the cooldown passes", async () => {
    const { orgId, reservationId } = await fixture();
    await prisma.organization.update({ where: { id: orgId }, data: { alertEmail: "host@example.com" } });
    expect((await alert(orgId, reservationId, "msg-1")).sent).toBe(true);
    expect((await alert(orgId, reservationId, "msg-1")).deduped).toBe(true); // immediate retry
    await coolDown(reservationId); // even long after…
    // …the identity (not the clock) blocks the SAME message id.
    const later = await prisma.reservation.update({
      where: { id: reservationId },
      data: {}, // no-op touch to be explicit that only time moved
    });
    expect(later.qrEscalationEmailMessageId).toBe("msg-1");
    expect((await alert(orgId, reservationId, "msg-1")).deduped).toBe(true);
    expect(mockSendReporting).toHaveBeenCalledTimes(1);
  });

  it("DISTINCT LATER EVENT always mails (Codex 1): new message id after the cooldown → send", async () => {
    const { orgId, reservationId } = await fixture();
    await prisma.organization.update({ where: { id: orgId }, data: { alertEmail: "host@example.com" } });
    expect((await alert(orgId, reservationId, "msg-complaint")).sent).toBe(true);
    await coolDown(reservationId);
    // A separate safety emergency later that day MUST alert again.
    expect((await alert(orgId, reservationId, "msg-emergency")).sent).toBe(true);
    expect(mockSendReporting).toHaveBeenCalledTimes(2);
  });

  it("ANTI-FLOOD: a different NON-critical message INSIDE the cooldown is absorbed (mail-bomb guard)", async () => {
    const { orgId, reservationId } = await fixture();
    await prisma.organization.update({ where: { id: orgId }, data: { alertEmail: "host@example.com" } });
    expect((await alert(orgId, reservationId, "msg-1")).sent).toBe(true);
    expect((await alert(orgId, reservationId, "msg-2")).deduped).toBe(true); // seconds later
    expect(mockSendReporting).toHaveBeenCalledTimes(1);
  });

  it("CRITICAL BYPASS (Codex acceptance): a safety/emergency event INSIDE the cooldown still mails", async () => {
    const { orgId, reservationId } = await fixture();
    await prisma.organization.update({ where: { id: orgId }, data: { alertEmail: "host@example.com" } });
    // Low-risk complaint mails first…
    expect((await alert(orgId, reservationId, "msg-complaint")).sent).toBe(true);
    // …then a DISTINCT safety/emergency seconds later — the clock must NOT mute it.
    const emergency = await maybeSendQrEscalationEmail({
      organizationId: orgId,
      propertyName: "Test Property",
      reservationId,
      eventId: "msg-fire",
      reason: "ai_escalated",
      critical: true,
    });
    expect(emergency.sent).toBe(true);
    expect(mockSendReporting).toHaveBeenCalledTimes(2);
  });

  it("CRITICAL is still IDENTITY-deduped: the same emergency message id never double-mails", async () => {
    const { orgId, reservationId } = await fixture();
    await prisma.organization.update({ where: { id: orgId }, data: { alertEmail: "host@example.com" } });
    const send = () =>
      maybeSendQrEscalationEmail({
        organizationId: orgId,
        propertyName: "Test Property",
        reservationId,
        eventId: "msg-fire",
        reason: "ai_escalated",
        critical: true,
      });
    expect((await send()).sent).toBe(true);
    expect((await send()).deduped).toBe(true); // retry of the SAME event
    expect(mockSendReporting).toHaveBeenCalledTimes(1);
  });

  it("TENANT BIND (Codex 4): another org's id claims nothing and sends nothing", async () => {
    const { reservationId } = await fixture();
    const other = await makeOrgWithProperty();
    await prisma.organization.update({ where: { id: other.orgId }, data: { alertEmail: "evil@example.com" } });
    const r = await alert(other.orgId, reservationId, "msg-1"); // foreign reservation
    expect(r).toEqual({ sent: false, deduped: true }); // claim matched 0 rows
    expect(mockSendReporting).not.toHaveBeenCalled();
    const row = await prisma.reservation.findUnique({ where: { id: reservationId } });
    expect(row?.qrEscalationEmailMessageId).toBeNull(); // untouched
  });

  it("OWNER-ROLE fallback (Codex 2): staff created FIRST — the owner still gets the mail", async () => {
    const { orgId, reservationId } = await fixture();
    process.env.ALERT_EMAIL = "operator@lixusai.com"; // must NOT be used
    // Staff-first fixture: oldest user is staff; a naive users[0] would pick it.
    await prisma.user.create({
      data: { organizationId: orgId, name: "Staff", email: "staff@example.com", passwordHash: "x", role: "staff" },
    });
    await prisma.user.create({
      data: { organizationId: orgId, name: "Owner", email: "owner@example.com", passwordHash: "x", role: "owner" },
    });
    const r = await alert(orgId, reservationId, "msg-1");
    expect(r.sent).toBe(true);
    expect(mockSendReporting.mock.calls[0][0]).toBe("owner@example.com");
  });

  it("no recipient at all (no alertEmail, no owner) → nothing sent, claim RELEASED", async () => {
    const { orgId, reservationId } = await fixture();
    process.env.ALERT_EMAIL = "operator@lixusai.com";
    await prisma.user.create({
      data: { organizationId: orgId, name: "Staff", email: "staff@example.com", passwordHash: "x", role: "staff" },
    });
    const r = await alert(orgId, reservationId, "msg-1");
    expect(r.sent).toBe(false);
    expect(mockSendReporting).not.toHaveBeenCalled();
    const row = await prisma.reservation.findUnique({ where: { id: reservationId } });
    expect(row?.qrEscalationEmailAt).toBeNull(); // released for a later-configured recipient
    expect(row?.qrEscalationEmailMessageId).toBeNull();
  });

  it("send FAILURE (ok:false): claim released + reportError → the same event can retry", async () => {
    const { orgId, reservationId } = await fixture();
    await prisma.organization.update({ where: { id: orgId }, data: { alertEmail: "host@example.com" } });
    mockSendReporting.mockResolvedValueOnce({ ok: false, error: "Resend HTTP 500" });
    const fail = await alert(orgId, reservationId, "msg-1");
    expect(fail.sent).toBe(false);
    expect(mockReportError).toHaveBeenCalledTimes(1);
    expect((await prisma.reservation.findUnique({ where: { id: reservationId } }))?.qrEscalationEmailMessageId).toBeNull();
    expect((await alert(orgId, reservationId, "msg-1")).sent).toBe(true); // retry works
  });

  it("UNEXPECTED post-claim exception (Codex 3): claim released under the exact guard + reported", async () => {
    const { orgId, reservationId } = await fixture();
    await prisma.organization.update({ where: { id: orgId }, data: { alertEmail: "host@example.com" } });
    mockSendReporting.mockImplementationOnce(() => {
      throw new Error("transport exploded synchronously");
    });
    const r = await alert(orgId, reservationId, "msg-1");
    expect(r.sent).toBe(false);
    expect(mockReportError).toHaveBeenCalledTimes(1);
    const row = await prisma.reservation.findUnique({ where: { id: reservationId } });
    expect(row?.qrEscalationEmailAt).toBeNull(); // NOT left consumed
    expect(row?.qrEscalationEmailMessageId).toBeNull();
    expect((await alert(orgId, reservationId, "msg-1")).sent).toBe(true); // retry works
  });

  it("FINGERPRINT identity (diff-review fix): same critical text collapses, different stays distinct", () => {
    // Non-critical → the message id IS the identity.
    expect(qrEscalationEventId("m-1", "İade istiyorum", false)).toBe("m-1");
    // Critical → normalized content fingerprint: case/punctuation/whitespace noise collapses…
    const a = qrEscalationEventId("m-1", "ACİL!! Yangın var...", true);
    const b = qrEscalationEventId("m-2", "acil yangın var", true);
    expect(a).toBe(b);
    expect(a).toMatch(/^crit:[0-9a-f]{32}$/);
    // …while a genuinely different emergency keeps a distinct identity.
    expect(qrEscalationEventId("m-3", "Gaz kokusu geliyor, acil!", true)).not.toBe(a);
  });

  it("CRITICAL MAIL-BOMB guard: repeating the same emergency text (new message rows) mails ONCE", async () => {
    const { orgId, reservationId } = await fixture();
    await prisma.organization.update({ where: { id: orgId }, data: { alertEmail: "host@example.com" } });
    const spam = (msgId: string) =>
      maybeSendQrEscalationEmail({
        organizationId: orgId,
        propertyName: "Test Property",
        reservationId,
        eventId: qrEscalationEventId(msgId, "ACİL acil ACİL!!!", true),
        reason: "ai_escalated",
        critical: true,
      });
    expect((await spam("m-1")).sent).toBe(true);
    expect((await spam("m-2")).deduped).toBe(true); // copy-paste spam, new row, SAME fingerprint
    expect((await spam("m-3")).deduped).toBe(true);
    expect(mockSendReporting).toHaveBeenCalledTimes(1);
  });

  it("CLAIM RACE: two concurrent alerts for ONE event produce exactly ONE e-mail", async () => {
    const { orgId, reservationId } = await fixture();
    await prisma.organization.update({ where: { id: orgId }, data: { alertEmail: "host@example.com" } });
    const results = await Promise.all([
      alert(orgId, reservationId, "msg-1"),
      alert(orgId, reservationId, "msg-1"),
    ]);
    expect(results.filter((r) => r.sent)).toHaveLength(1);
    expect(mockSendReporting).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/chat/[token] — escalation wires the e-mail", () => {
  it("an ESCALATED message e-mails the host: minimal content, panel link, NO guest text; the claim stores the real message id", async () => {
    const { orgId, token, reservationId } = await fixture();
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
    // privacy: the guest's words must NOT ride along
    expect(html).not.toContain("pisti");
    expect(html).not.toContain(guestText);

    // The dedupe identity is the REAL inbound message row.
    const row = await prisma.reservation.findUnique({ where: { id: reservationId } });
    const inbound = await prisma.message.findFirst({ where: { direction: "inbound" }, select: { id: true } });
    expect(row?.qrEscalationEmailMessageId).toBe(inbound?.id);
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

  it("rapid escalation BURST over the route → one e-mail (cooldown); a later distinct event mails again", async () => {
    const { orgId, token, reservationId } = await fixture();
    await prisma.organization.update({ where: { id: orgId }, data: { alertEmail: "host@example.com" } });
    // Same device throughout — carry the per-stay binding cookie (a cookieless
    // second request would be "another device" and short-circuit before the AI).
    const first = await call(token, "İade istiyorum, berbat!");
    const cookie = deviceCookie(first);
    expect(cookie).toBeTruthy();
    const second = await call(token, "Cevap verin, iade!", cookie); // seconds later, new message id, inside cooldown
    expect((await second.json()).escalated).toBe(true);
    expect(mockSendReporting).toHaveBeenCalledTimes(1);
    await coolDown(reservationId);
    // Distinct incident later (guaranteed-escalating refund wording — the
    // event identity is the message id, the content just needs to escalate).
    const third = await call(token, "Sıcak su yok, paramın iadesini istiyorum!", cookie);
    expect((await third.json()).escalated).toBe(true);
    expect(mockSendReporting).toHaveBeenCalledTimes(2);
  });

  it("ROUTE: complaint, then a SAFETY message a moment later → BOTH mail (no cooldown aging needed)", async () => {
    const { orgId, token } = await fixture();
    await prisma.organization.update({ where: { id: orgId }, data: { alertEmail: "host@example.com" } });
    const first = await call(token, "İade istiyorum, berbat!"); // low-risk complaint → mail 1
    const cookie = deviceCookie(first);
    expect(mockSendReporting).toHaveBeenCalledTimes(1);
    // Distinct EMERGENCY right after (deterministic safety_emergency words) —
    // the acceptance criterion: the emergency MUST produce the second e-mail.
    const res = await call(token, "Yangın var, duman kokusu geliyor!", cookie);
    expect((await res.json()).escalated).toBe(true);
    expect(mockSendReporting).toHaveBeenCalledTimes(2);
  });

  it("ROUTE: two DISTINCT safety messages back-to-back → two e-mails (1 dk arayla senaryosu)", async () => {
    const { orgId, token } = await fixture();
    await prisma.organization.update({ where: { id: orgId }, data: { alertEmail: "host@example.com" } });
    const first = await call(token, "Gaz kokusu var, acil yardım!");
    const cookie = deviceCookie(first);
    const res = await call(token, "Yangın çıktı, ambulans gerekebilir!", cookie);
    expect((await res.json()).escalated).toBe(true);
    expect(mockSendReporting).toHaveBeenCalledTimes(2);
  });

  it("DAILY-CAP escalation also alerts (reason daily_cap)", async () => {
    const { orgId, propertyId, token } = await fixture();
    await prisma.organization.update({ where: { id: orgId }, data: { alertEmail: "host@example.com" } });
    const day = new Date().toISOString().slice(0, 10);
    await prisma.chatUsage.create({ data: { propertyId, day, count: 200 } }); // at cap → next call is over
    const res = await call(token, "Merhaba, bir sorum var");
    expect((await res.json()).escalated).toBe(true);
    expect(mockSendReporting).toHaveBeenCalledTimes(1);
    expect(mockSendReporting.mock.calls[0][2]).toContain("limit"); // daily_cap reason text
  });

  it("RESPONSE BUDGET (diff-review fix): a HANGING e-mail transport can't hold the guest's reply", async () => {
    const { orgId, token } = await fixture();
    await prisma.organization.update({ where: { id: orgId }, data: { alertEmail: "host@example.com" } });
    // Transport never settles (worst-case outage) — the response must still
    // come back within the alert budget instead of the 12-15s transport timeout.
    mockSendReporting.mockImplementationOnce(() => new Promise(() => {}));
    const started = Date.now();
    const res = await call(token, "İade istiyorum, berbattı.");
    const elapsed = Date.now() - started;
    expect(res.status).toBe(200);
    expect((await res.json()).escalated).toBe(true);
    expect(elapsed).toBeLessThan(QR_ALERT_RESPONSE_BUDGET_MS + 2000); // budget + test slack
  }, 15_000);

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
