import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";
import {
  generatePin,
  normalizePin,
  hashPin,
  setReservationPin,
  clearReservationPin,
  verifyReservationPin,
  qrPinEnabled,
  QR_PIN_MAX_ATTEMPTS,
  QR_PIN_LOCKOUT_MS,
} from "@/lib/guest-chat-pin";

// Faz 5 (#14) — per-reservation QR PIN crypto + storage + verify. Pins:
// CSPRNG format, HMAC(pepper) storage (never plaintext, reservation-bound),
// timing-safe verify, durable lockout, regeneration invalidation.

async function makeReservation(overrides?: Record<string, unknown>) {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const reservation = await prisma.reservation.create({
    data: {
      propertyId,
      guestName: "Ada",
      arrivalDate: daysFromNow(-1),
      departureDate: daysFromNow(2),
      status: "confirmed",
      channel: "airbnb",
      ...overrides,
    },
  });
  return { orgId, propertyId, reservationId: reservation.id };
}

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
});

describe("guest-chat-pin — crypto (pure)", () => {
  it("generatePin: 6 digits, zero-padded, and varied (CSPRNG)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const pin = generatePin();
      expect(pin).toMatch(/^\d{6}$/);
      seen.add(pin);
    }
    expect(seen.size).toBeGreaterThan(150); // not a constant
  });

  it("normalizePin strips non-digits", () => {
    expect(normalizePin(" 12 34-56 ")).toBe("123456");
    expect(normalizePin("abc")).toBe("");
  });

  it("hashPin: 64-hex, deterministic, RESERVATION-bound, never contains the PIN", () => {
    const h = hashPin("res-1", "123456");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(hashPin("res-1", "123456")); // deterministic
    expect(h).not.toContain("123456");
    // Same PIN, different reservation → different hash (can't replay across stays).
    expect(hashPin("res-2", "123456")).not.toBe(h);
    // Normalization applies inside the hash.
    expect(hashPin("res-1", " 12-34 56")).toBe(h);
  });
});

describe("guest-chat-pin — storage + verify (DB)", () => {
  it("setReservationPin stores a HASH (never the plaintext) and returns the PIN once", async () => {
    const { reservationId } = await makeReservation();
    const pin = await setReservationPin(reservationId);
    expect(pin).toMatch(/^\d{6}$/);
    const row = await prisma.reservation.findUnique({ where: { id: reservationId } });
    expect(row?.chatPinHash).toBe(hashPin(reservationId, pin));
    expect(row?.chatPinHash).not.toContain(pin); // no plaintext at rest
    expect(row?.chatPinSetAt).toBeTruthy();
    expect(row?.chatPinFailedCount).toBe(0);
    expect(row?.chatPinLockedUntil).toBeNull();
  });

  it("verify: correct PIN → ok; wrong → invalid; no PIN set → no_pin", async () => {
    const { reservationId } = await makeReservation();
    expect((await verifyReservationPin(reservationId, "000000")).status).toBe("no_pin");
    const pin = await setReservationPin(reservationId);
    expect((await verifyReservationPin(reservationId, pin)).status).toBe("ok");
    const wrong = pin === "000000" ? "111111" : "000000";
    expect((await verifyReservationPin(reservationId, wrong)).status).toBe("invalid");
  });

  it("malformed input (not 6 digits) is invalid WITHOUT burning an attempt", async () => {
    const { reservationId } = await makeReservation();
    await setReservationPin(reservationId);
    expect((await verifyReservationPin(reservationId, "12")).status).toBe("invalid");
    expect((await verifyReservationPin(reservationId, "abcdef")).status).toBe("invalid");
    const row = await prisma.reservation.findUnique({ where: { id: reservationId } });
    expect(row?.chatPinFailedCount).toBe(0); // format errors don't count toward lockout
  });

  it("RESERVATION-bound: reservation A's PIN never verifies against reservation B", async () => {
    const a = await makeReservation();
    const b = await makeReservation();
    const pinA = await setReservationPin(a.reservationId);
    await setReservationPin(b.reservationId);
    expect((await verifyReservationPin(b.reservationId, pinA)).status).toBe("invalid");
  });

  it("REGENERATION invalidates the previous PIN immediately", async () => {
    const { reservationId } = await makeReservation();
    const oldPin = await setReservationPin(reservationId);
    const newPin = await setReservationPin(reservationId);
    expect(newPin).not.toBe(oldPin);
    expect((await verifyReservationPin(reservationId, oldPin)).status).toBe("invalid");
    expect((await verifyReservationPin(reservationId, newPin)).status).toBe("ok");
  });

  it("LOCKOUT: after QR_PIN_MAX_ATTEMPTS wrong tries → locked with retryAfter", async () => {
    const { reservationId } = await makeReservation();
    const pin = await setReservationPin(reservationId);
    const wrong = pin === "000000" ? "111111" : "000000";
    for (let i = 0; i < QR_PIN_MAX_ATTEMPTS; i++) {
      expect((await verifyReservationPin(reservationId, wrong)).status).toBe("invalid");
    }
    // Next attempt (even the CORRECT PIN) is locked out.
    const locked = await verifyReservationPin(reservationId, pin);
    expect(locked.status).toBe("locked");
    if (locked.status === "locked") {
      expect(locked.retryAfterSec).toBeGreaterThan(0);
      expect(locked.retryAfterSec).toBeLessThanOrEqual(Math.ceil(QR_PIN_LOCKOUT_MS / 1000));
    }
  });

  it("LOCKOUT clears after the window; correct PIN then works", async () => {
    const { reservationId } = await makeReservation();
    const pin = await setReservationPin(reservationId);
    const wrong = pin === "000000" ? "111111" : "000000";
    for (let i = 0; i < QR_PIN_MAX_ATTEMPTS; i++) await verifyReservationPin(reservationId, wrong);
    const future = new Date(Date.now() + QR_PIN_LOCKOUT_MS + 60_000);
    expect((await verifyReservationPin(reservationId, pin, future)).status).toBe("ok");
  });

  it("CONCURRENCY CAP: a burst of wrong guesses can't run more than MAX compares (diff-review)", async () => {
    // The durable lockout must gate the COMPARE, not just the increment: a
    // distributed/multi-replica burst that all read "not locked" at once must NOT
    // all get to test a PIN. At most QR_PIN_MAX_ATTEMPTS guesses may be evaluated
    // ("invalid") per window; the rest are refused ("locked") without comparing.
    const { reservationId } = await makeReservation();
    const pin = await setReservationPin(reservationId);
    const wrong = pin === "000000" ? "111111" : "000000";
    const results = await Promise.all(
      Array.from({ length: 40 }, () => verifyReservationPin(reservationId, wrong)),
    );
    const invalid = results.filter((r) => r.status === "invalid").length;
    const locked = results.filter((r) => r.status === "locked").length;
    expect(invalid).toBeLessThanOrEqual(QR_PIN_MAX_ATTEMPTS);
    expect(locked).toBeGreaterThan(0);
    // And the reservation ends up locked (budget spent).
    expect((await verifyReservationPin(reservationId, pin)).status).toBe("locked");
  });

  it("a SUCCESSFUL verify resets the failed-attempt counter", async () => {
    const { reservationId } = await makeReservation();
    const pin = await setReservationPin(reservationId);
    const wrong = pin === "000000" ? "111111" : "000000";
    await verifyReservationPin(reservationId, wrong);
    await verifyReservationPin(reservationId, wrong);
    expect((await verifyReservationPin(reservationId, pin)).status).toBe("ok");
    const row = await prisma.reservation.findUnique({ where: { id: reservationId } });
    expect(row?.chatPinFailedCount).toBe(0);
  });

  it("clearReservationPin wipes hash + counters (regeneration/disable path)", async () => {
    const { reservationId } = await makeReservation();
    await setReservationPin(reservationId);
    await clearReservationPin(reservationId);
    const row = await prisma.reservation.findUnique({ where: { id: reservationId } });
    expect(row?.chatPinHash).toBeNull();
    expect(row?.chatPinSetAt).toBeNull();
    expect(row?.chatPinLockedUntil).toBeNull();
    expect((await verifyReservationPin(reservationId, "000000")).status).toBe("no_pin");
  });
});

describe("guest-chat-pin — env gate", () => {
  const orig = process.env.QR_PIN_ENABLED;
  afterEach(() => {
    if (orig === undefined) delete process.env.QR_PIN_ENABLED;
    else process.env.QR_PIN_ENABLED = orig;
  });
  it("qrPinEnabled reflects the env switch (default OFF)", () => {
    delete process.env.QR_PIN_ENABLED;
    expect(qrPinEnabled()).toBe(false);
    process.env.QR_PIN_ENABLED = "1";
    expect(qrPinEnabled()).toBe(true);
    process.env.QR_PIN_ENABLED = "0";
    expect(qrPinEnabled()).toBe(false);
  });
});
