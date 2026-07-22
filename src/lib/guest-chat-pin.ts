import "server-only";

import { createHmac, randomInt, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/db";

// ---------------------------------------------------------------------------
// Per-reservation QR concierge PIN (Faz 5, #14).
//
// The QR sticker in an apartment is FIXED and per-property — a bearer credential
// anyone who photographs it holds. Per-stay device binding stops a past guest
// from READING the current guest's chat, but "first scan wins" still lets a
// cleaner / neighbour / early-scanner CLAIM the stay before the real guest.
// The PIN adds a KNOWLEDGE factor: the host gives the booked guest a PIN, and
// only someone with it can claim the chat. Once claimed, the device cookie
// takes over and the PIN is never asked again.
//
// SECURITY:
//   * The PIN is stored ONLY as an HMAC-SHA256 keyed by a SERVER PEPPER
//     (QR_PIN_PEPPER, else AUTH_SECRET) — never the plaintext. A DB read alone
//     can't recover it, and can't offline-brute-force a low-entropy 6-digit PIN
//     without the pepper (which is not in the DB). The HMAC message binds the
//     reservationId, so a stored hash can never validate against another stay.
//   * Verification is TIMING-SAFE and rate-limited by a DURABLE per-reservation
//     counter + lockout. The cap gates the COMPARE via an ATOMIC slot reservation
//     (a conditional `chatPinFailedCount < MAX` increment that serializes on the
//     row lock), so even a concurrent / multi-replica burst can test at most MAX
//     guesses per window — the route's per-IP limiter is only a first, per-
//     instance line of defence on top of this authoritative cross-replica cap.
//   * The plaintext exists only in the generation response (shown once to the
//     owner/manager). It never enters logs, Sentry, export or audit metadata.
//   * ENV-GATED (QR_PIN_ENABLED, default OFF) — deploy is a no-op until enabled.
// ---------------------------------------------------------------------------

const PIN_DIGITS = 6;
/** Wrong tries against ONE reservation before it locks (durable, cross-replica). */
export const QR_PIN_MAX_ATTEMPTS = 10;
/** How long the reservation's PIN entry stays locked after too many wrong tries. */
export const QR_PIN_LOCKOUT_MS = 15 * 60_000;

/** Global master switch. Default OFF → the entire PIN feature is dormant. */
export function qrPinEnabled(): boolean {
  return process.env.QR_PIN_ENABLED === "1";
}

function pinPepper(): string {
  const s = process.env.QR_PIN_PEPPER || process.env.AUTH_SECRET;
  if (!s) throw new Error("QR PIN pepper yok (QR_PIN_PEPPER / AUTH_SECRET tanımlı değil).");
  return s;
}

/** Digits only — tolerant of spaces/dashes the guest may type. */
export function normalizePin(input: string): string {
  return (input ?? "").replace(/\D/g, "");
}

/** A cryptographically-random 6-digit PIN, uniform over 000000–999999. */
export function generatePin(): string {
  return String(randomInt(0, 10 ** PIN_DIGITS)).padStart(PIN_DIGITS, "0");
}

/** HMAC(pepper, "qr-pin:v1:<reservationId>:<normalizedPin>") — reservation-bound,
 *  so a hash from one stay can never authenticate against another. */
export function hashPin(reservationId: string, pin: string): string {
  return createHmac("sha256", pinPepper())
    .update(`qr-pin:v1:${reservationId}:${normalizePin(pin)}`)
    .digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

/**
 * Generate + store a fresh PIN for a reservation. Returns the PLAINTEXT once
 * (the only time it exists outside the caller's response). Resets the lockout
 * counter; overwriting the hash instantly invalidates the previous PIN.
 */
export async function setReservationPin(reservationId: string, now: Date = new Date()): Promise<string> {
  const pin = generatePin();
  await prisma.reservation.update({
    where: { id: reservationId },
    data: {
      chatPinHash: hashPin(reservationId, pin),
      chatPinSetAt: now,
      chatPinFailedCount: 0,
      chatPinLockedUntil: null,
    },
  });
  return pin;
}

/** Remove a reservation's PIN (host disables it, or before regenerating). */
export async function clearReservationPin(reservationId: string): Promise<void> {
  await prisma.reservation.update({
    where: { id: reservationId },
    data: { chatPinHash: null, chatPinSetAt: null, chatPinFailedCount: 0, chatPinLockedUntil: null },
  });
}

/**
 * Reservations the host may need to set a PIN for = ACTIVE + UPCOMING stays
 * (departed within the last day, or not yet departed). Ordered soonest-arrival
 * first. This deliberately replaces the property page's old "last 5 by arrival
 * DESC" list (Codex 3): on a fully-booked apartment that list pushed the
 * currently-staying guest out behind future bookings, so the host couldn't
 * reach it to generate a PIN — locking that guest out under strict mode.
 */
export async function listReservationsForPinManagement(propertyId: string, now: Date = new Date()) {
  return prisma.reservation.findMany({
    where: { propertyId, departureDate: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
    orderBy: { arrivalDate: "asc" },
    take: 25,
    select: {
      id: true, guestName: true, arrivalDate: true, departureDate: true, status: true, chatPinHash: true,
      // Needed so the property page can decide the KVKK erasure state over THIS
      // exact list (source_reference tombstone match), not the separate last-5.
      sourceReference: true,
    },
  });
}

export type PinVerifyResult =
  | { status: "ok" }
  | { status: "invalid" }
  | { status: "no_pin" }
  | { status: "locked"; retryAfterSec: number };

/**
 * Timing-safe verify with a DURABLE per-reservation lockout. A well-formed but
 * wrong PIN increments the counter and locks the reservation after
 * QR_PIN_MAX_ATTEMPTS; a malformed entry (not 6 digits) is rejected WITHOUT
 * burning an attempt (fair to a fat-fingering guest; a brute-forcer must still
 * send well-formed guesses, which do count).
 */
export async function verifyReservationPin(
  reservationId: string,
  pin: string,
  now: Date = new Date(),
): Promise<PinVerifyResult> {
  const row = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: { chatPinHash: true, chatPinLockedUntil: true },
  });
  if (!row || !row.chatPinHash) return { status: "no_pin" };
  if (row.chatPinLockedUntil && row.chatPinLockedUntil > now) {
    return {
      status: "locked",
      retryAfterSec: Math.max(1, Math.ceil((row.chatPinLockedUntil.getTime() - now.getTime()) / 1000)),
    };
  }
  // Format guard: don't consume a lockout attempt (or hit the DB) on obviously
  // malformed input. A brute-forcer's well-formed guesses still count below.
  if (normalizePin(pin).length !== PIN_DIGITS) return { status: "invalid" };

  // ATOMIC SLOT RESERVATION *before* comparing (diff-review fix). The lockout must
  // gate the COMPARE itself, not just the counter: otherwise a concurrent / multi-
  // replica burst that all read "not locked" would each run an HMAC compare and
  // collectively test far more than QR_PIN_MAX_ATTEMPTS guesses in one window —
  // covering a 6-digit space fast. This conditional increment serializes on the
  // row lock (`chatPinFailedCount < MAX` is re-checked under the lock), so at most
  // MAX callers per window are granted a slot; the rest are refused WITHOUT ever
  // comparing. A correct guess also spends a slot but resets the counter below, so
  // a legitimate guest is never starved (they succeed within the budget), while a
  // pure attacker (all wrong) depletes it exactly and gets locked.
  const slot = await prisma.reservation.updateMany({
    where: {
      id: reservationId,
      chatPinHash: { not: null },
      OR: [{ chatPinLockedUntil: null }, { chatPinLockedUntil: { lt: now } }],
      chatPinFailedCount: { lt: QR_PIN_MAX_ATTEMPTS },
    },
    data: { chatPinFailedCount: { increment: 1 } },
  });
  if (slot.count === 0) {
    // Budget spent (or a race locked it first) → ensure the lock is set, refuse.
    const cur = await prisma.reservation.findUnique({
      where: { id: reservationId },
      select: { chatPinLockedUntil: true },
    });
    let until = cur?.chatPinLockedUntil ?? null;
    if (!until || until <= now) {
      until = new Date(now.getTime() + QR_PIN_LOCKOUT_MS);
      await prisma.reservation
        .updateMany({
          where: { id: reservationId, OR: [{ chatPinLockedUntil: null }, { chatPinLockedUntil: { lt: now } }] },
          data: { chatPinLockedUntil: until, chatPinFailedCount: 0 },
        })
        .catch(() => {});
    }
    return { status: "locked", retryAfterSec: Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 1000)) };
  }

  // We hold a slot → now it's safe to compare (timing-safe).
  if (safeEqualHex(hashPin(reservationId, pin), row.chatPinHash)) {
    // Success → reset the counter. Scope the write to the SAME hash so a PIN
    // regenerated in between doesn't get its fresh counter wiped by a stale success.
    await prisma.reservation
      .updateMany({
        where: { id: reservationId, chatPinHash: row.chatPinHash },
        data: { chatPinFailedCount: 0, chatPinLockedUntil: null },
      })
      .catch(() => {});
    return { status: "ok" };
  }

  // Wrong PIN — the slot (increment) is already consumed. If that pushed the count
  // to the cap, lock now (best-effort; a concurrent double-cross just sets the same
  // lock twice — harmless).
  try {
    const post = await prisma.reservation.findUnique({
      where: { id: reservationId },
      select: { chatPinFailedCount: true },
    });
    if ((post?.chatPinFailedCount ?? 0) >= QR_PIN_MAX_ATTEMPTS) {
      await prisma.reservation.updateMany({
        where: { id: reservationId },
        data: { chatPinLockedUntil: new Date(now.getTime() + QR_PIN_LOCKOUT_MS), chatPinFailedCount: 0 },
      });
    }
  } catch {
    // Row vanished (cancellation) or a transient error — the guess still fails.
  }
  return { status: "invalid" };
}
