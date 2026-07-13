import { describe, it, expect } from "vitest";
import { computeResponseEpisodes } from "@/lib/response-episodes";

// Codex #33 — episode semantics. The OLD metric measured ONE pair per
// conversation (first inbound EVER → first outbound after it); these cases pin
// the per-episode replacement.

const T0 = new Date("2026-07-01T10:00:00Z");
const min = (n: number) => new Date(T0.getTime() + n * 60_000);
const WINDOW = new Date("2026-06-20T00:00:00Z");
const inb = (at: Date) => ({ direction: "inbound", createdAt: at });
const out = (at: Date) => ({ direction: "outbound", createdAt: at });

describe("computeResponseEpisodes", () => {
  it("counts EVERY episode in a thread, not just the first pair", () => {
    // ep1 answered in 30m; ep2 (guest writes again) answered in 25h (too slow);
    // ep3 unanswered. Old metric: 1 answerable, 1 within. New: 3 / 1.
    const msgs = [
      inb(min(0)), out(min(30)),
      inb(min(100)), out(min(100 + 25 * 60)),
      inb(min(3000)),
    ];
    expect(computeResponseEpisodes(msgs, WINDOW)).toEqual({ answerable: 3, answeredWithin24h: 1 });
  });

  it("a run of consecutive guest messages is ONE episode anchored at the FIRST message", () => {
    // Guest sends 3 messages over 23.5h, reply lands 1h after the last one =
    // 24.5h after the FIRST → the guest waited >24h; anchoring at the last
    // message would wrongly score it as fast.
    const msgs = [inb(min(0)), inb(min(60)), inb(min(23.5 * 60)), out(min(24.5 * 60))];
    expect(computeResponseEpisodes(msgs, WINDOW)).toEqual({ answerable: 1, answeredWithin24h: 0 });
  });

  it("episodes are attributed by START: pre-window episode ignored, in-window one counted", () => {
    const old = new Date("2026-05-01T10:00:00Z"); // long before WINDOW
    const msgs = [
      inb(old), out(new Date(old.getTime() + 60_000)), // pre-window episode → ignored
      inb(min(0)), out(min(10)), // in-window → counted
    ];
    expect(computeResponseEpisodes(msgs, WINDOW)).toEqual({ answerable: 1, answeredWithin24h: 1 });
  });

  it("boundary: exactly 24h counts as within; outbound-first is a no-op; empty thread is zero", () => {
    expect(computeResponseEpisodes([inb(min(0)), out(min(24 * 60))], WINDOW)).toEqual({
      answerable: 1,
      answeredWithin24h: 1,
    });
    expect(computeResponseEpisodes([out(min(0))], WINDOW)).toEqual({ answerable: 0, answeredWithin24h: 0 });
    expect(computeResponseEpisodes([], WINDOW)).toEqual({ answerable: 0, answeredWithin24h: 0 });
  });
});
