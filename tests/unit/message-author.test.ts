import { describe, it, expect } from "vitest";
import { deriveMessageAuthor, guestChatDisplayRole, resolveMessageAuthor } from "@/lib/message-author";

describe("deriveMessageAuthor (legacy signal → canonical author)", () => {
  it("inbound → guest", () => {
    expect(deriveMessageAuthor({ direction: "inbound", senderName: "Ayşe" })).toEqual({
      authorType: "guest",
      systemEventType: null,
    });
  });
  it("outbound 'GuestOps AI' / 'Lixus AI' → ai", () => {
    expect(deriveMessageAuthor({ direction: "outbound", senderName: "GuestOps AI" }).authorType).toBe("ai");
    expect(deriveMessageAuthor({ direction: "outbound", senderName: "Lixus AI" }).authorType).toBe("ai");
  });
  it("outbound resume sentinel → system + guest_chat_ai_resumed", () => {
    expect(deriveMessageAuthor({ direction: "outbound", senderName: "__lixus_ai_resumed__" })).toEqual({
      authorType: "system",
      systemEventType: "guest_chat_ai_resumed",
    });
  });
  it("any other outbound → host", () => {
    expect(deriveMessageAuthor({ direction: "outbound", senderName: "Mehmet" }).authorType).toBe("host");
  });
});

describe("resolveMessageAuthor prefers authorType over the host-controlled senderName", () => {
  it("uses authorType when present, ignoring a colliding senderName", () => {
    expect(
      resolveMessageAuthor({ direction: "outbound", senderName: "__lixus_ai_resumed__", authorType: "host" }).authorType,
    ).toBe("host");
    expect(resolveMessageAuthor({ direction: "outbound", senderName: "Lixus AI", authorType: "host" }).authorType).toBe(
      "host",
    );
  });
  it("falls back to the legacy derivation when authorType is absent", () => {
    expect(resolveMessageAuthor({ direction: "inbound", senderName: "x" }).authorType).toBe("guest");
  });
});

describe("guestChatDisplayRole", () => {
  it("maps guest / ai / host / system-resume", () => {
    expect(guestChatDisplayRole({ direction: "inbound", senderName: "x", authorType: "guest" })).toBe("guest");
    expect(guestChatDisplayRole({ direction: "outbound", senderName: "x", authorType: "ai" })).toBe("ai");
    expect(guestChatDisplayRole({ direction: "outbound", senderName: "x", authorType: "host" })).toBe("host");
    expect(
      guestChatDisplayRole({ direction: "outbound", senderName: "x", authorType: "system", systemEventType: "guest_chat_ai_resumed" }),
    ).toBe("resume");
  });
  it("a host with a bot/resume-looking NAME still renders as host (never a system line)", () => {
    expect(guestChatDisplayRole({ direction: "outbound", senderName: "__lixus_ai_resumed__", authorType: "host" })).toBe("host");
    expect(guestChatDisplayRole({ direction: "outbound", senderName: "Lixus AI", authorType: "host" })).toBe("host");
  });
  it("legacy rows (no authorType) fall back to the senderName derivation", () => {
    expect(guestChatDisplayRole({ direction: "outbound", senderName: "__lixus_ai_resumed__" })).toBe("resume");
    expect(guestChatDisplayRole({ direction: "outbound", senderName: "Mehmet" })).toBe("host");
    expect(guestChatDisplayRole({ direction: "inbound", senderName: "Ayşe" })).toBe("guest");
  });
});

describe("systemEventType is honoured ONLY when authorType=system, and only for the closed set", () => {
  it("ignores systemEventType on a non-system row (a host row is still host)", () => {
    expect(
      guestChatDisplayRole({ direction: "outbound", senderName: "x", authorType: "host", systemEventType: "guest_chat_ai_resumed" }),
    ).toBe("host");
  });
  it("an OUT-OF-SET systemEventType does not produce the resume display behaviour", () => {
    expect(
      guestChatDisplayRole({ direction: "outbound", senderName: "x", authorType: "system", systemEventType: "totally_unknown" }),
    ).not.toBe("resume");
  });
});
