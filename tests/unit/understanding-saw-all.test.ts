import { describe, it, expect } from "vitest";
import {
  understandingSawAll,
  MAX_UNDERSTOOD_REQUESTS,
  UNDERSTANDING_MAX_UNANSWERED,
  UNDERSTANDING_MESSAGE_CAP,
  NOT_FULLY_READ_MARGIN,
  type MessageUnderstanding,
} from "@/lib/ai/semantic/understanding-schema";

// Tur 4 (11-05): tehlike bağlam kararı anlama katmanını yalnız metnin TAMAMINI gördüyse "koştu" sayar.
const u = (n: number) => ({ requests: Array.from({ length: n }, () => ({ intent: "wifi" })) }) as unknown as MessageUnderstanding;
const limit = UNDERSTANDING_MESSAGE_CAP - NOT_FULLY_READ_MARGIN;

describe("understandingSawAll", () => {
  it("katman yoksa false", () => {
    expect(understandingSawAll(null, ["Merhaba"])).toBe(false);
    expect(understandingSawAll(undefined, ["Merhaba"])).toBe(false);
  });
  it("kısa mesaj + tavan altı istek → true", () => {
    expect(understandingSawAll(u(1), ["Wifi şifresi?"])).toBe(true);
    expect(understandingSawAll(u(MAX_UNDERSTOOD_REQUESTS - 1), ["a"])).toBe(true);
  });
  it("istek tavanı doluysa (fazlası kesilmiş olabilir) false", () => {
    expect(understandingSawAll(u(MAX_UNDERSTOOD_REQUESTS), ["a"])).toBe(false);
  });
  it("mesaj tavan payına ulaştıysa false; tam sınırda true", () => {
    expect(understandingSawAll(u(1), ["x".repeat(limit)])).toBe(true);
    expect(understandingSawAll(u(1), ["x".repeat(limit + 1)])).toBe(false);
    expect(understandingSawAll(u(1), ["kısa", "x".repeat(limit + 1)])).toBe(false);
  });
  it("katmanın gördüğünden fazla cevapsız mesaj varsa false", () => {
    expect(understandingSawAll(u(1), Array.from({ length: UNDERSTANDING_MAX_UNANSWERED }, () => "a"))).toBe(true);
    expect(understandingSawAll(u(1), Array.from({ length: UNDERSTANDING_MAX_UNANSWERED + 1 }, () => "a"))).toBe(false);
  });
});
