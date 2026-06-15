import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { addDays, startOfDay } from "date-fns";
import { prisma, resetDb } from "../helpers/db";

// Force the AI + transport to be deterministic mocks.
vi.mock("@/lib/ai", () => ({ suggestReply: vi.fn(), classifyMessage: vi.fn() }));
vi.mock("@/lib/messaging", () => ({ sendOnChannel: vi.fn() }));
// The org is "connected" — return a fixed token so auto-reply delivery proceeds.
vi.mock("@/lib/hospitable-credentials", () => ({
  getOrgHospitableToken: vi.fn().mockResolvedValue("test-token"),
}));

import { suggestReply } from "@/lib/ai";
import { sendOnChannel } from "@/lib/messaging";
import {
  applyChannelAutoReply,
  runDueChannelAutoReplies,
  previewChannelAutoReplies,
  sendDueWelcomes,
  sendDueCheckins,
  sendDueCheckouts,
  previewWelcomes,
  previewCheckins,
  isWithinActiveHours,
  currentHourInTimeZone,
} from "@/lib/automation";

const mockSuggest = vi.mocked(suggestReply);
const mockSend = vi.mocked(sendOnChannel);

// The machine-prepared note appended to AUTO-sent replies (Turkish, since the
// SAFE_REPLY fixture detects "tr"). The draft/preview stays clean — only the
// guest-facing send carries it.
const AUTO_NOTE_TR =
  "(Bu yanıt otomatik asistanımızca hazırlandı; bir hata olursa ekibimiz hemen düzeltir.)";

const SAFE_REPLY = {
  intent: "checkin",
  confidence: 0.9,
  reply: "Check-in saat 15:00, hoş geldiniz!",
  risk: null,
  priority: "standard" as const,
  source: "openai" as const,
  actionSuggestion: null,
  riskLevel: "none" as const,
  detectedLanguage: "tr",
  statedCheckoutTime: null,
};

/** Seed an org + property + one channel conversation whose guest spoke last. */
async function seed(opts: {
  autoReplyHospitable?: boolean;
  startHour?: number;
  endHour?: number;
  status?: string;
  externalReservationId?: string | null;
  lastDirection?: "inbound" | "outbound";
  aiSignature?: string;
  guestMessage?: string;
} = {}) {
  const org = await prisma.organization.create({
    data: {
      name: "Test Org",
      autoReplyHospitable: opts.autoReplyHospitable ?? true,
      autoReplyStartHour: opts.startHour ?? 0,
      autoReplyEndHour: opts.endHour ?? 0, // start === end → always within window
      timezone: "Europe/Istanbul",
      ...(opts.aiSignature ? { aiSignature: opts.aiSignature } : {}),
    },
  });
  const property = await prisma.property.create({
    data: { organizationId: org.id, name: "Deniz Daire" },
  });
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      channel: "airbnb",
      guestIdentifier: "Alex",
      status: opts.status ?? "new",
      externalReservationId:
        opts.externalReservationId === undefined ? "res-1" : opts.externalReservationId,
      messages: {
        create: [
          {
            direction: "inbound",
            senderName: "Alex",
            body: opts.guestMessage ?? "What time is check-in?",
            createdAt: new Date(Date.now() - 60_000),
          },
          ...(opts.lastDirection === "outbound"
            ? [{ direction: "outbound", senderName: "Host", body: "Hi!", createdAt: new Date() }]
            : []),
        ],
      },
    },
    select: { id: true },
  });
  return { orgId: org.id, conversationId: conversation.id };
}

describe("isWithinActiveHours", () => {
  it("handles same-day, wrap-around, and all-day windows", () => {
    expect(isWithinActiveHours(0, 9, 3)).toBe(true); // 00:00–09:00 includes 03:00
    expect(isWithinActiveHours(0, 9, 9)).toBe(false); // end is exclusive
    expect(isWithinActiveHours(0, 9, 14)).toBe(false);
    expect(isWithinActiveHours(22, 6, 23)).toBe(true); // wraps midnight
    expect(isWithinActiveHours(22, 6, 5)).toBe(true);
    expect(isWithinActiveHours(22, 6, 12)).toBe(false);
    expect(isWithinActiveHours(0, 0, 17)).toBe(true); // start === end → all day
  });
});

describe("applyChannelAutoReply", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    // The global master kill-switch must be ON for the sending tests below.
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    mockSuggest.mockResolvedValue(SAFE_REPLY);
    mockSend.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("never sends when the global kill-switch (AUTO_REPLY_ENABLED) is off", async () => {
    vi.stubEnv("AUTO_REPLY_ENABLED", ""); // not "1" → globally disabled
    const { conversationId } = await seed();
    const out = await applyChannelAutoReply(conversationId);

    expect(out.sent).toBe(false);
    expect(out.skippedReason).toBe("globally_disabled");
    expect(mockSend).not.toHaveBeenCalled();
    expect(await prisma.message.count({ where: { conversationId, direction: "outbound" } })).toBe(0);
  });

  it("vetoes the auto-send when the guest's words signal a complaint, even if the model labels it benign", async () => {
    // The model MISCLASSIFIES an angry message as a calm, low-risk "checkin"
    // (SAFE_REPLY). The keyword cross-check in the safety gate must still block
    // the auto-send so a real complaint never gets a canned reply.
    const { conversationId } = await seed({
      guestMessage: "The heater is broken and the room is dirty, this is unacceptable!",
    });
    const out = await applyChannelAutoReply(conversationId);

    expect(out.sent).toBe(false);
    expect(out.skippedReason).toBe("low_confidence_or_risky");
    expect(mockSend).not.toHaveBeenCalled();
    expect(await prisma.message.count({ where: { conversationId, direction: "outbound" } })).toBe(0);
  });

  it("vetoes the auto-send when the guest signals early departure / cancellation", async () => {
    const { conversationId } = await seed({
      guestMessage: "We need to leave early and cancel the last two nights.",
    });
    const out = await applyChannelAutoReply(conversationId);

    expect(out.sent).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("dry-run returns the draft without sending or persisting", async () => {
    const { conversationId } = await seed();
    const out = await applyChannelAutoReply(conversationId, { dryRun: true });

    expect(out.sent).toBe(false);
    expect(out.draft?.reply).toBe(SAFE_REPLY.reply);
    expect(mockSend).not.toHaveBeenCalled();
    expect(await prisma.message.count({ where: { conversationId, direction: "outbound" } })).toBe(0);
  });

  it("a dry-run preview is side-effect-free: never writes the guest's stated checkout time", async () => {
    mockSuggest.mockResolvedValue({ ...SAFE_REPLY, statedCheckoutTime: "11:30" });
    const { conversationId } = await seed();
    await linkReservation(conversationId, {
      status: "confirmed",
      arrivalDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      departureDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
    });

    // Preview must NOT mutate the reservation.
    await applyChannelAutoReply(conversationId, { dryRun: true });
    let res = await prisma.reservation.findFirst({
      where: { sourceReference: "res-1" },
      select: { guestCheckoutTime: true },
    });
    expect(res?.guestCheckoutTime).toBeNull();

    // A real (non-dry-run) run DOES record it.
    await applyChannelAutoReply(conversationId);
    res = await prisma.reservation.findFirst({
      where: { sourceReference: "res-1" },
      select: { guestCheckoutTime: true },
    });
    expect(res?.guestCheckoutTime).toBe("11:30");
  });

  it("appends the host signature to the reply when one is configured", async () => {
    const { conversationId } = await seed({ aiSignature: "Sevgiler,\nİsa Çınar" });
    const out = await applyChannelAutoReply(conversationId, { dryRun: true });

    expect(out.draft?.reply).toBe(`${SAFE_REPLY.reply}\n\nSevgiler,\nİsa Çınar`);

    // And when actually sending, the guest receives reply → note → signature
    // (the disclosure sits ABOVE the host's personal sign-off, which closes it).
    const sent = await applyChannelAutoReply(conversationId);
    expect(sent.sent).toBe(true);
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ externalReservationId: "res-1" }),
      `${SAFE_REPLY.reply}\n\n${AUTO_NOTE_TR}\n\nSevgiler,\nİsa Çınar`,
      "test-token",
    );
  });

  it("sends via the channel transport and persists when enabled and in-window", async () => {
    const { conversationId } = await seed();
    const out = await applyChannelAutoReply(conversationId);

    expect(out.sent).toBe(true);
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ externalReservationId: "res-1", channel: "airbnb" }),
      `${SAFE_REPLY.reply}\n\n${AUTO_NOTE_TR}`,
      "test-token",
    );
    const conv = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { messages: true },
    });
    expect(conv?.status).toBe("answered");
    expect(
      conv?.messages.some(
        (m) => m.direction === "outbound" && m.body === `${SAFE_REPLY.reply}\n\n${AUTO_NOTE_TR}`,
      ),
    ).toBe(true);
  });

  it("marks the auto-sent body as machine-prepared, but keeps the draft clean", async () => {
    const { conversationId } = await seed();
    // Draft (preview) stays clean — no disclosure.
    const preview = await applyChannelAutoReply(conversationId, { dryRun: true });
    expect(preview.draft?.reply).toBe(SAFE_REPLY.reply);
    expect(preview.draft?.reply).not.toContain("otomatik");

    // The actual guest-facing send carries the note (in the guest's language).
    await applyChannelAutoReply(conversationId);
    const body = mockSend.mock.calls.at(-1)?.[1] as string;
    expect(body).toContain(AUTO_NOTE_TR);
  });

  it("does NOT persist a reply when delivery fails (send-first safety)", async () => {
    mockSend.mockResolvedValue({ ok: false, error: "429" });
    const { conversationId } = await seed();
    const out = await applyChannelAutoReply(conversationId);

    expect(out.sent).toBe(false);
    expect(out.skippedReason).toContain("send_failed");
    const conv = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { messages: true },
    });
    expect(conv?.status).toBe("new"); // unchanged
    expect(conv?.messages.every((m) => m.direction === "inbound")).toBe(true);
  });

  it("skips when the org toggle is off (and never calls the AI)", async () => {
    const { conversationId } = await seed({ autoReplyHospitable: false });
    const out = await applyChannelAutoReply(conversationId);

    expect(out.sent).toBe(false);
    expect(out.skippedReason).toBe("disabled");
    expect(mockSuggest).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("skips outside the active-hours window", async () => {
    const h = currentHourInTimeZone("Europe/Istanbul");
    // A one-hour window that does not include the current hour.
    const { conversationId } = await seed({ startHour: (h + 1) % 24, endHour: (h + 2) % 24 });
    const out = await applyChannelAutoReply(conversationId);

    expect(out.sent).toBe(false);
    expect(out.skippedReason).toBe("outside_hours");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("leaves low-confidence or risky messages for a human", async () => {
    mockSuggest.mockResolvedValue({ ...SAFE_REPLY, confidence: 0.5 });
    const { conversationId } = await seed();
    const out = await applyChannelAutoReply(conversationId);

    expect(out.sent).toBe(false);
    expect(out.skippedReason).toBe("low_confidence_or_risky");
    expect(mockSend).not.toHaveBeenCalled();

    mockSuggest.mockResolvedValue({ ...SAFE_REPLY, riskLevel: "high" });
    const out2 = await applyChannelAutoReply(conversationId);
    expect(out2.sent).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("NEVER auto-sends money/cancellation intents even if rated low-risk", async () => {
    // Hard guarantee: refund / cancellation / complaint always wait for a human,
    // even when the model under-rates the risk as "low" with high confidence.
    for (const intent of ["early_departure", "refund", "complaint"]) {
      mockSend.mockClear();
      mockSuggest.mockResolvedValue({
        ...SAFE_REPLY,
        intent,
        riskLevel: "low",
        confidence: 0.95,
      });
      const { conversationId } = await seed();
      const out = await applyChannelAutoReply(conversationId);
      expect(out.sent).toBe(false);
      expect(mockSend).not.toHaveBeenCalled();
    }
  });

  it("sends a holding reply and pauses the AI when the guest asks for a human", async () => {
    mockSuggest.mockResolvedValue({
      ...SAFE_REPLY,
      intent: "human_request",
      reply: "Talebinizi ev sahibimize ilettim; en kısa sürede kendisi sizinle iletişime geçecektir.",
      riskLevel: "low",
      confidence: 0.9,
    });
    const { conversationId } = await seed();

    const out = await applyChannelAutoReply(conversationId);

    expect(out.sent).toBe(true); // the one holding reply goes out
    const conv = await prisma.conversation.findUnique({ where: { id: conversationId } });
    expect(conv?.autoReplyHoldUntil).toBeInstanceOf(Date);
    expect(conv!.autoReplyHoldUntil!.getTime()).toBeGreaterThan(Date.now());
  });

  it("stays silent while a human-handoff hold is active", async () => {
    const { conversationId } = await seed();
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { autoReplyHoldUntil: new Date(Date.now() + 60 * 60 * 1000) },
    });

    const out = await applyChannelAutoReply(conversationId);

    expect(out.sent).toBe(false);
    expect(out.skippedReason).toBe("human_hold");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("skips complaints and conversations we already answered", async () => {
    const complaint = await seed({ status: "problem" });
    expect((await applyChannelAutoReply(complaint.conversationId)).skippedReason).toBe("complaint");

    const answered = await seed({ lastDirection: "outbound" });
    expect((await applyChannelAutoReply(answered.conversationId)).skippedReason).toBe("already_answered");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("skips manual conversations with no channel target", async () => {
    const { conversationId } = await seed({ externalReservationId: null });
    expect((await applyChannelAutoReply(conversationId)).skippedReason).toBe("no_external_target");
  });

  // The reservation-link gate: a synced conversation now carries its booking, so
  // the AI must refuse to reply to a finished/cancelled stay (link is read-only
  // context — it can only make auto-reply MORE conservative, never send more).
  async function linkReservation(
    conversationId: string,
    data: { status: string; arrivalDate: Date; departureDate: Date },
  ) {
    const conv = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { propertyId: true },
    });
    const reservation = await prisma.reservation.create({
      data: {
        propertyId: conv!.propertyId,
        guestName: "Alex",
        channel: "airbnb",
        sourceReference: "res-1",
        ...data,
      },
      select: { id: true },
    });
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { reservationId: reservation.id },
    });
  }

  it("skips when the linked reservation is cancelled", async () => {
    const { conversationId } = await seed();
    await linkReservation(conversationId, {
      status: "cancelled",
      arrivalDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      departureDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // future, but cancelled
    });
    const out = await applyChannelAutoReply(conversationId);
    expect(out.sent).toBe(false);
    expect(out.skippedReason).toBe("reservation_ended");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("skips when the linked reservation already departed", async () => {
    const { conversationId } = await seed();
    await linkReservation(conversationId, {
      status: "completed",
      arrivalDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      departureDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // left 2 days ago
    });
    const out = await applyChannelAutoReply(conversationId);
    expect(out.sent).toBe(false);
    expect(out.skippedReason).toBe("reservation_ended");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("still answers on the checkout day itself (departure == start of today)", async () => {
    const { conversationId } = await seed();
    await linkReservation(conversationId, {
      status: "confirmed",
      arrivalDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      // Departure == start of TODAY: the exact boundary. The gate uses strict `<`
      // (departureDate < startOfDay(now)), so a checkout TODAY is still answered.
      // This pins the `<` vs `<=` off-by-one — `<=` here would wrongly skip.
      departureDate: startOfDay(new Date()),
    });
    const out = await applyChannelAutoReply(conversationId);
    expect(out.sent).toBe(true);
    expect(mockSend).toHaveBeenCalled();
  });

  it("still answers on checkout-day morning when departure is at Istanbul midnight", async () => {
    // Regression: a departure stored at Istanbul midnight (21:00Z prev UTC day) was
    // wrongly read as departed by the old UTC startOfDay gate during the 00:00-03:00
    // Istanbul window. The org-tz gate keeps answering until the day actually ends.
    const istToday = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Istanbul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const { conversationId } = await seed();
    await linkReservation(conversationId, {
      status: "confirmed",
      arrivalDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      departureDate: new Date(`${istToday}T00:00:00+03:00`), // Istanbul midnight today
    });
    const out = await applyChannelAutoReply(conversationId);
    expect(out.sent).toBe(true);
    expect(mockSend).toHaveBeenCalled();
  });

  it("runDueChannelAutoReplies answers a fresh 'new' chat", async () => {
    const { orgId } = await seed(); // lastMessageAt defaults to now
    const out = await runDueChannelAutoReplies(orgId);
    expect(out.sent).toBe(1);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("runDueChannelAutoReplies ignores a days-old backlog (only fresh < 48h)", async () => {
    const { orgId, conversationId } = await seed();
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) },
    });
    const out = await runDueChannelAutoReplies(orgId);
    expect(out.considered).toBe(0); // old chat isn't even a candidate
    expect(out.sent).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe("previewChannelAutoReplies", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    mockSuggest.mockResolvedValue(SAFE_REPLY);
    mockSend.mockResolvedValue({ ok: true });
  });

  it("returns drafts for awaiting conversations without sending (even when toggle off)", async () => {
    const { orgId } = await seed({ autoReplyHospitable: false });
    const previews = await previewChannelAutoReplies(orgId);

    expect(previews).toHaveLength(1);
    expect(previews[0].draft?.reply).toBe(SAFE_REPLY.reply);
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe("sendDueWelcomes", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    mockSend.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function seedWelcome(
    opts: { autoWelcome?: boolean; withEntry?: boolean; arrival?: Date; content?: string } = {},
  ) {
    const org = await prisma.organization.create({
      data: {
        name: "Org",
        autoWelcome: opts.autoWelcome ?? true,
        autoWelcomeEnabledAt: new Date(0), // enabled long ago → fresh bookings qualify
        aiSignature: "Sevgiler,\nİsa",
      },
    });
    const property = await prisma.property.create({
      data: { organizationId: org.id, name: "nuve 3" },
    });
    if (opts.withEntry !== false) {
      await prisma.knowledgeBaseItem.create({
        data: {
          propertyId: property.id,
          category: "welcome",
          title: "Karşılama",
          content: opts.content ?? "Daire 3 — Wifi: NUVE/1234",
        },
      });
    }
    // Default arrival = TODAY (org timezone) at noon UTC, so the check-in-day
    // welcome fires deterministically.
    const istToday = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Istanbul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const arrival = opts.arrival ?? new Date(`${istToday}T12:00:00Z`);
    const reservation = await prisma.reservation.create({
      data: {
        propertyId: property.id,
        guestName: "Bircan Yılmaz",
        arrivalDate: arrival,
        departureDate: new Date(arrival.getTime() + 2 * 24 * 60 * 60 * 1000),
        channel: "airbnb",
        status: "confirmed",
        sourceReference: "res-w-1",
      },
    });
    return { orgId: org.id, reservationId: reservation.id };
  }

  it("sends a personalised welcome once and marks it sent", async () => {
    const { orgId, reservationId } = await seedWelcome();
    const out = await sendDueWelcomes(orgId);

    expect(out.sent).toBe(1);
    expect(mockSend).toHaveBeenCalledTimes(1);
    const [target, body] = mockSend.mock.calls[0];
    expect(target).toMatchObject({ externalReservationId: "res-w-1", channel: "airbnb" });
    expect(body).toContain("Merhaba Bircan,");
    expect(body).toContain("Daire 3 — Wifi: NUVE/1234");
    expect(body).toContain("Sevgiler,\nİsa");

    const res = await prisma.reservation.findUnique({ where: { id: reservationId } });
    expect(res?.welcomeSentAt).toBeTruthy();

    // Idempotent: a second run does not re-send.
    mockSend.mockClear();
    const again = await sendDueWelcomes(orgId);
    expect(again.sent).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("substitutes the {isim} placeholder and sends the template as written", async () => {
    const { orgId } = await seedWelcome({
      content: "Merhaba {isim}👋\n\nDaire 4 — Wifi: NUVEBUTİK\n\nSevgiler,\nİsa Çınar",
    });
    const out = await sendDueWelcomes(orgId);

    expect(out.sent).toBe(1);
    const [, body] = mockSend.mock.calls[0];
    expect(body).toBe("Merhaba Bircan👋\n\nDaire 4 — Wifi: NUVEBUTİK\n\nSevgiler,\nİsa Çınar");
    // No auto greeting/signature was added on top of the host's own template.
    expect(body).not.toContain("Merhaba Bircan,");
  });

  it("substitutes the {daire} placeholder with the apartment number", async () => {
    const { orgId } = await seedWelcome({
      content: "Merhaba {isim}, Apartment {daire} sizi bekliyor.",
    });
    const out = await sendDueWelcomes(orgId);

    expect(out.sent).toBe(1);
    const [, body] = mockSend.mock.calls[0];
    // Property is named "nuve 3" → {daire} resolves to just "3".
    expect(body).toBe("Merhaba Bircan, Apartment 3 sizi bekliyor.");
  });

  it("does nothing when autoWelcome is off", async () => {
    const { orgId } = await seedWelcome({ autoWelcome: false });
    expect((await sendDueWelcomes(orgId)).sent).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("does nothing when the global kill-switch is off", async () => {
    vi.stubEnv("AUTO_REPLY_ENABLED", "");
    const { orgId } = await seedWelcome();
    expect((await sendDueWelcomes(orgId)).sent).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("skips apartments that have no welcome entry", async () => {
    const { orgId } = await seedWelcome({ withEntry: false });
    expect((await sendDueWelcomes(orgId)).sent).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("never messages past reservations", async () => {
    const past = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const { orgId } = await seedWelcome({ arrival: past });
    expect((await sendDueWelcomes(orgId)).sent).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("sends right after booking, even for a future arrival", async () => {
    // A freshly-made booking (createdAt ~now) arriving in 5 days is welcomed
    // immediately — the welcome no longer waits for the check-in day.
    const inFiveDays = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const { orgId } = await seedWelcome({ arrival: inFiveDays });
    expect((await sendDueWelcomes(orgId)).sent).toBe(1);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("welcomes even a far-future booking right away (no lead cap)", async () => {
    // The welcome is a booking thank-you, so it goes immediately regardless of
    // how far ahead the stay is (access details are a separate check-in message).
    const inThirtyDays = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const { orgId } = await seedWelcome({ arrival: inThirtyDays });
    expect((await sendDueWelcomes(orgId)).sent).toBe(1);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("does not welcome bookings made before welcome was switched on", async () => {
    const inFiveDays = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const { orgId, reservationId } = await seedWelcome({ arrival: inFiveDays });
    // The booking existed BEFORE the feature was enabled: createdAt is one day
    // earlier than the baseline → it must be left alone (no backlog blast).
    await prisma.reservation.update({
      where: { id: reservationId },
      data: { createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });
    await prisma.organization.update({
      where: { id: orgId },
      data: { autoWelcomeEnabledAt: new Date() },
    });
    expect((await sendDueWelcomes(orgId)).sent).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("welcomes an arrival stored at Istanbul midnight of today (org-tz gate)", async () => {
    // Regression: an arrival stored at Istanbul midnight (21:00Z the previous UTC
    // day) was excluded by the old UTC startOfDay gate. The Istanbul-zoned gate
    // must include today's arrival.
    const istToday = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Istanbul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const istanbulMidnightToday = new Date(`${istToday}T00:00:00+03:00`);
    const { orgId } = await seedWelcome({ arrival: istanbulMidnightToday });
    expect((await sendDueWelcomes(orgId)).sent).toBe(1);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("rolls back the claim when the send fails, so it retries next run", async () => {
    const { orgId, reservationId } = await seedWelcome();
    mockSend.mockResolvedValueOnce({ ok: false, error: "429" });
    expect((await sendDueWelcomes(orgId)).sent).toBe(0);
    // Claim rolled back → not marked sent, so the next run can retry.
    const after = await prisma.reservation.findUnique({ where: { id: reservationId } });
    expect(after?.welcomeSentAt).toBeNull();

    mockSend.mockResolvedValue({ ok: true });
    expect((await sendDueWelcomes(orgId)).sent).toBe(1);
  });

  it("previewWelcomes builds the text without sending, regardless of toggles", async () => {
    // autoWelcome off + no kill-switch → preview still works, sends nothing.
    vi.stubEnv("AUTO_REPLY_ENABLED", "");
    const { orgId } = await seedWelcome({
      autoWelcome: false,
      content: "Merhaba {isim}👋\n\nDaire 4",
    });
    const previews = await previewWelcomes(orgId);

    expect(previews).toHaveLength(1);
    expect(previews[0]).toMatchObject({ guest: "Bircan Yılmaz", hasEntry: true, alreadySent: false });
    expect(previews[0].body).toBe("Merhaba Bircan👋\n\nDaire 4");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("previewWelcomes flags apartments missing a welcome entry", async () => {
    const { orgId } = await seedWelcome({ withEntry: false });
    const previews = await previewWelcomes(orgId);
    expect(previews).toHaveLength(1);
    expect(previews[0].hasEntry).toBe(false);
    expect(previews[0].body).toBeNull();
  });
});

describe("sendDueCheckins", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    mockSend.mockResolvedValue({ ok: true });
  });
  afterEach(() => vi.unstubAllEnvs());

  async function seedCheckin(
    opts: { autoCheckin?: boolean; withEntry?: boolean; arrival: Date } = { arrival: new Date() },
  ) {
    const org = await prisma.organization.create({
      data: {
        name: "Org",
        autoCheckin: opts.autoCheckin ?? true,
        autoCheckinEnabledAt: new Date(0), // enabled long ago → bookings qualify
        aiSignature: "İsa",
      },
    });
    const property = await prisma.property.create({
      data: { organizationId: org.id, name: "nuve 3" },
    });
    if (opts.withEntry !== false) {
      await prisma.knowledgeBaseItem.create({
        data: {
          propertyId: property.id,
          category: "checkin",
          title: "Giriş Talimatı",
          content: "Merhaba {isim}, kapı kodu **2022, Wi-Fi: NUVE/1234 — Daire {daire}",
        },
      });
    }
    const reservation = await prisma.reservation.create({
      data: {
        propertyId: property.id,
        guestName: "Bircan Yılmaz",
        arrivalDate: opts.arrival,
        departureDate: new Date(opts.arrival.getTime() + 2 * 24 * 60 * 60 * 1000),
        channel: "airbnb",
        status: "confirmed",
        sourceReference: "res-ci-1",
      },
    });
    return { orgId: org.id, reservationId: reservation.id };
  }

  it("sends the check-in info within the lead window and marks it once", async () => {
    const inThreeDays = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const { orgId } = await seedCheckin({ arrival: inThreeDays });
    const out = await sendDueCheckins(orgId);
    expect(out.sent).toBe(1);
    const [, body] = mockSend.mock.calls[0];
    expect(body).toBe("Merhaba Bircan, kapı kodu **2022, Wi-Fi: NUVE/1234 — Daire 3");
    // Idempotent — a second pass sends nothing.
    expect((await sendDueCheckins(orgId)).sent).toBe(0);
  });

  it("waits while arrival is still beyond the lead window", async () => {
    const inTenDays = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    const { orgId } = await seedCheckin({ arrival: inTenDays });
    expect((await sendDueCheckins(orgId)).sent).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("does nothing when autoCheckin is off", async () => {
    const inThreeDays = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const { orgId } = await seedCheckin({ arrival: inThreeDays, autoCheckin: false });
    expect((await sendDueCheckins(orgId)).sent).toBe(0);
  });

  it("skips apartments with no check-in entry", async () => {
    const inThreeDays = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const { orgId } = await seedCheckin({ arrival: inThreeDays, withEntry: false });
    expect((await sendDueCheckins(orgId)).sent).toBe(0);
  });

  it("does not message bookings made before check-in info was switched on", async () => {
    const inThreeDays = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const { orgId, reservationId } = await seedCheckin({ arrival: inThreeDays });
    await prisma.reservation.update({
      where: { id: reservationId },
      data: { createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });
    await prisma.organization.update({
      where: { id: orgId },
      data: { autoCheckinEnabledAt: new Date() },
    });
    expect((await sendDueCheckins(orgId)).sent).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("previewCheckins builds the text without sending, regardless of toggle", async () => {
    const inThreeDays = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const { orgId } = await seedCheckin({ arrival: inThreeDays, autoCheckin: false });
    const previews = await previewCheckins(orgId);
    expect(previews).toHaveLength(1);
    expect(previews[0]).toMatchObject({ guest: "Bircan Yılmaz", hasEntry: true, alreadySent: false });
    expect(previews[0].body).toBe("Merhaba Bircan, kapı kodu **2022, Wi-Fi: NUVE/1234 — Daire 3");
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe("sendDueCheckouts", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.useFakeTimers({ toFake: ["Date"] });
    mockSend.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  async function seedCheckout(
    opts: { autoCheckout?: boolean; withEntry?: boolean; arrival?: Date; departure: Date },
  ) {
    const org = await prisma.organization.create({
      data: {
        name: "Org",
        autoCheckout: opts.autoCheckout ?? true,
        autoCheckoutEnabledAt: new Date(0), // enabled long ago → bookings qualify
        timezone: "Europe/Istanbul",
      },
    });
    const property = await prisma.property.create({
      data: { organizationId: org.id, name: "nuve 3" },
    });
    if (opts.withEntry !== false) {
      await prisma.knowledgeBaseItem.create({
        data: {
          propertyId: property.id,
          category: "checkout",
          title: "Çıkış",
          content: "Hi {isim}, safe travels — İsa",
        },
      });
    }
    // Default to a multi-night stay (arrival 3 days before departure) so the
    // single-night skip doesn't apply unless a test opts into it.
    const arrival = opts.arrival ?? addDays(opts.departure, -3);
    await prisma.reservation.create({
      data: {
        propertyId: property.id,
        guestName: "Ronda Smith",
        arrivalDate: arrival,
        departureDate: opts.departure,
        channel: "airbnb",
        status: "confirmed",
        sourceReference: "res-co-1",
      },
    });
    return { orgId: org.id };
  }

  it("sends the check-out message the evening before (after 18:00), personalised", async () => {
    vi.setSystemTime(new Date("2026-06-14T15:00:00Z")); // 18:00 Istanbul, day before
    const { orgId } = await seedCheckout({ departure: new Date("2026-06-15T00:00:00Z") });
    const out = await sendDueCheckouts(orgId);
    expect(out.sent).toBe(1);
    const [, body] = mockSend.mock.calls[0];
    expect(body).toBe("Hi Ronda, safe travels — İsa");
  });

  it("sends for a checkout stored at Istanbul midnight (org-tz day-key fix)", async () => {
    // Load-bearing regression: departure stored at Istanbul midnight (21:00Z the
    // previous UTC day). The old UTC day-key read it as the previous day so the
    // message never sent; the org-tz key matches "tomorrow" correctly.
    vi.setSystemTime(new Date("2026-06-14T15:00:00Z")); // 18:00 Istanbul, eve of Jun 15
    const { orgId } = await seedCheckout({
      departure: new Date("2026-06-14T21:00:00Z"), // Istanbul midnight of Jun 15
    });
    expect((await sendDueCheckouts(orgId)).sent).toBe(1);
  });

  it("does not message bookings made before checkout was switched on", async () => {
    vi.setSystemTime(new Date("2026-06-14T15:00:00Z")); // 18:00 Istanbul, day before
    const { orgId } = await seedCheckout({ departure: new Date("2026-06-15T00:00:00Z") });
    // Pin both timestamps to FIXED instants so the gate (reservation.createdAt >=
    // autoCheckoutEnabledAt) is deterministic regardless of the real wall clock:
    // the booking was created (Jun 10) BEFORE the feature was switched on (Jun 12).
    // (Previously baseline used `new Date()` while createdAt defaulted to the real
    // DB clock — a time bomb that flipped once the real date passed Jun 14.)
    await prisma.reservation.updateMany({
      where: { property: { organizationId: orgId } },
      data: { createdAt: new Date("2026-06-10T00:00:00Z") },
    });
    await prisma.organization.update({
      where: { id: orgId },
      data: { autoCheckoutEnabledAt: new Date("2026-06-12T00:00:00Z") },
    });
    expect((await sendDueCheckouts(orgId)).sent).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("does not send before 18:00", async () => {
    vi.setSystemTime(new Date("2026-06-14T12:00:00Z")); // 15:00 Istanbul
    const { orgId } = await seedCheckout({ departure: new Date("2026-06-15T00:00:00Z") });
    expect((await sendDueCheckouts(orgId)).sent).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("does not send on the departure day itself (it already went the night before)", async () => {
    vi.setSystemTime(new Date("2026-06-15T15:00:00Z")); // 18:00 Istanbul, departure day
    const { orgId } = await seedCheckout({ departure: new Date("2026-06-15T00:00:00Z") });
    expect((await sendDueCheckouts(orgId)).sent).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("does not send when check-out is not tomorrow", async () => {
    vi.setSystemTime(new Date("2026-06-14T18:00:00Z")); // 21:00 Istanbul
    const { orgId } = await seedCheckout({ departure: new Date("2026-06-20T00:00:00Z") });
    expect((await sendDueCheckouts(orgId)).sent).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("does not send to single-night reservations", async () => {
    vi.setSystemTime(new Date("2026-06-14T15:00:00Z")); // 18:00 Istanbul, eve of check-out
    const { orgId } = await seedCheckout({
      arrival: new Date("2026-06-14T00:00:00Z"),
      departure: new Date("2026-06-15T00:00:00Z"), // 1 night
    });
    expect((await sendDueCheckouts(orgId)).sent).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("does nothing when autoCheckout is off", async () => {
    vi.setSystemTime(new Date("2026-06-14T15:00:00Z"));
    const { orgId } = await seedCheckout({
      autoCheckout: false,
      departure: new Date("2026-06-15T00:00:00Z"),
    });
    expect((await sendDueCheckouts(orgId)).sent).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });
});
