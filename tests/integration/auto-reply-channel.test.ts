import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// Force the AI + transport to be deterministic mocks.
vi.mock("@/lib/ai", () => ({ suggestReply: vi.fn(), classifyMessage: vi.fn() }));
vi.mock("@/lib/messaging", () => ({ sendOnChannel: vi.fn() }));

import { suggestReply } from "@/lib/ai";
import { sendOnChannel } from "@/lib/messaging";
import {
  applyChannelAutoReply,
  runDueChannelAutoReplies,
  previewChannelAutoReplies,
  sendDueWelcomes,
  sendDueCheckouts,
  previewWelcomes,
  isWithinActiveHours,
  currentHourInTimeZone,
} from "@/lib/automation";

const mockSuggest = vi.mocked(suggestReply);
const mockSend = vi.mocked(sendOnChannel);

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
            body: "What time is check-in?",
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

  it("dry-run returns the draft without sending or persisting", async () => {
    const { conversationId } = await seed();
    const out = await applyChannelAutoReply(conversationId, { dryRun: true });

    expect(out.sent).toBe(false);
    expect(out.draft?.reply).toBe(SAFE_REPLY.reply);
    expect(mockSend).not.toHaveBeenCalled();
    expect(await prisma.message.count({ where: { conversationId, direction: "outbound" } })).toBe(0);
  });

  it("appends the host signature to the reply when one is configured", async () => {
    const { conversationId } = await seed({ aiSignature: "Sevgiler,\nİsa Çınar" });
    const out = await applyChannelAutoReply(conversationId, { dryRun: true });

    expect(out.draft?.reply).toBe(`${SAFE_REPLY.reply}\n\nSevgiler,\nİsa Çınar`);

    // And when actually sending, the guest receives the signed reply.
    const sent = await applyChannelAutoReply(conversationId);
    expect(sent.sent).toBe(true);
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ externalReservationId: "res-1" }),
      `${SAFE_REPLY.reply}\n\nSevgiler,\nİsa Çınar`,
    );
  });

  it("sends via the channel transport and persists when enabled and in-window", async () => {
    const { conversationId } = await seed();
    const out = await applyChannelAutoReply(conversationId);

    expect(out.sent).toBe(true);
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ externalReservationId: "res-1", channel: "airbnb" }),
      SAFE_REPLY.reply,
    );
    const conv = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { messages: true },
    });
    expect(conv?.status).toBe("answered");
    expect(conv?.messages.some((m) => m.direction === "outbound" && m.body === SAFE_REPLY.reply)).toBe(true);
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
      data: { name: "Org", autoWelcome: opts.autoWelcome ?? true, aiSignature: "Sevgiler,\nİsa" },
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

  it("only sends on the check-in day — not for future reservations", async () => {
    const inFiveDays = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const { orgId } = await seedWelcome({ arrival: inFiveDays });
    expect((await sendDueWelcomes(orgId)).sent).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
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
    opts: { autoCheckout?: boolean; withEntry?: boolean; departure: Date },
  ) {
    const org = await prisma.organization.create({
      data: { name: "Org", autoCheckout: opts.autoCheckout ?? true, timezone: "Europe/Istanbul" },
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
    await prisma.reservation.create({
      data: {
        propertyId: property.id,
        guestName: "Ronda Smith",
        arrivalDate: opts.departure,
        departureDate: opts.departure,
        channel: "airbnb",
        status: "confirmed",
        sourceReference: "res-co-1",
      },
    });
    return { orgId: org.id };
  }

  it("sends the check-out message on the departure day after 08:00, personalised", async () => {
    vi.setSystemTime(new Date("2026-06-15T08:00:00Z")); // 11:00 Istanbul
    const { orgId } = await seedCheckout({ departure: new Date("2026-06-15T00:00:00Z") });
    const out = await sendDueCheckouts(orgId);
    expect(out.sent).toBe(1);
    const [, body] = mockSend.mock.calls[0];
    expect(body).toBe("Hi Ronda, safe travels — İsa");
  });

  it("does not send before 08:00", async () => {
    vi.setSystemTime(new Date("2026-06-15T03:00:00Z")); // 06:00 Istanbul
    const { orgId } = await seedCheckout({ departure: new Date("2026-06-15T00:00:00Z") });
    expect((await sendDueCheckouts(orgId)).sent).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("does not send when it is not the departure day", async () => {
    vi.setSystemTime(new Date("2026-06-15T09:00:00Z")); // 12:00 Istanbul
    const { orgId } = await seedCheckout({ departure: new Date("2026-06-20T00:00:00Z") });
    expect((await sendDueCheckouts(orgId)).sent).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("does nothing when autoCheckout is off", async () => {
    vi.setSystemTime(new Date("2026-06-15T09:00:00Z"));
    const { orgId } = await seedCheckout({
      autoCheckout: false,
      departure: new Date("2026-06-15T00:00:00Z"),
    });
    expect((await sendDueCheckouts(orgId)).sent).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });
});
