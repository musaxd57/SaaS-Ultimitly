import { createHash, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/db";
import { daysUntilDate } from "@/lib/utils";
import { premiumAllowed } from "@/lib/billing/subscription";
import { qrPinEnabled } from "@/lib/guest-chat-pin";

// ---------------------------------------------------------------------------
// Guest QR concierge — token resolution (FOUNDATION, no public surface yet).
//
// A guest in the apartment scans a fixed QR that carries an unguessable
// per-apartment token; this resolves that token to the apartment, its
// (secret-free) knowledge base, and the currently-staying reservation so the
// existing AI pipeline can answer general questions.
//
// SAFETY — a fixed, physically-posted QR is a BEARER credential: anyone who
// scans or photographs it (a past guest, a cleaner, a neighbour) holds it. So
// access SECRETS (door/keybox code, Wi-Fi password) are excluded from the chat
// context ENTIRELY — not merely "the model is told to decline" — so even a
// perfect prompt-injection has nothing to leak. Those secrets stay in the
// Airbnb-native check-in flow, delivered to the verified booked guest.
// ---------------------------------------------------------------------------

// KB categories whose content can carry access secrets. Excluded from the
// public QR context. (Matches the KnowledgeBaseItem category vocabulary.)
export const QR_SECRET_CATEGORIES = ["wifi", "checkin"] as const;

// CONTENT-level guard (belt to the category suspenders). The category filter
// alone "fails open" if a host files a door/keybox code or Wi-Fi password under
// faq/rules/general/etc. — so ANY KB item whose text looks like an access secret
// is dropped regardless of category. Over-redaction is the SAFE direction here:
// at worst the chat says it can't help (and escalates), never leaks a code.
// (\b avoided around Turkish letters like ş/ı — JS word boundaries are ASCII.)
const SECRET_PATTERNS: RegExp[] = [
  // door / keybox / entry / lock + code word (TR suffixes ok), e.g. "kapı kodu",
  // "anahtar kutusu kodu", "keybox code", "giriş şifresi", "door/lock code".
  /(kap[ıi]|giri[şs]|anahtar\s*kutu|key\s*?box|keybox|door|lock|entry|gate)\w*[\s:]{0,3}\w{0,6}[\s:]{0,3}(kod|şifre|sifre|parola|code|pin)/i,
  // a code/PIN/password word followed by a value, e.g. "PIN: 5678", "kodu 0000",
  // "şifre HUNTER2", "parola: abc12".
  /(pin|kod|code|şifre|sifre|parola|password|passcode)\w*\s*[:=#]?\s*([0-9]{3,}|[^\s.\n]*\d)/i,
  // Wi-Fi / wireless / internet ... password word.
  /(wi-?fi|kablosuz|internet)\w*[^.\n]{0,40}(şifre|sifre|parola|password|passcode|key)/i,
  // a password/parola label with a colon/equals, e.g. "Şifre: ...", "parola = ...".
  /(şifre|sifre|parola|password|passcode)\w*\s*[:=]/i,
  // Wi-Fi / network NAME or PASSWORD stated conversationally WITHOUT a secret
  // keyword — e.g. "İnternet ağımız 'NuveEv', bağlanmak için 12345678 girin".
  // The value is quoted or digit-bearing (SSID / password), which the keyword
  // patterns above miss. Over-redaction stays the safe side (escalate, no leak).
  /(wi-?fi|wlan|kablosuz|ssid|internet\s*a[ğg])\w*[^.\n]{0,40}(["'«][^"'»\n]{2,}["'»]|[A-Za-z0-9!@#._-]*\d[A-Za-z0-9!@#._-]{3,})/i,
];

function looksLikeSecret(text: string): boolean {
  return SECRET_PATTERNS.some((re) => re.test(text));
}

/** Unguessable per-apartment chat token — two UUIDs, ~256-bit (icalToken style). */
export function generateChatToken(): string {
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "");
}

// ---------------------------------------------------------------------------
// Per-stay device binding (fixes the fixed-physical-QR history leak).
//
// The QR is a FIXED, physically-posted bearer credential, so it cannot tell one
// person from another: a past guest / cleaner who photographed it could scan it
// during the NEXT guest's stay and read that guest's live chat history. The fix
// is first-scan device binding: the FIRST device to open the chat during a stay
// mints a per-stay secret (kept in an httpOnly cookie); only that device sees
// the history / can send. Any other device scanning the same QR that stay gets
// "mismatch" → no history, no send. Rotates automatically — each reservation
// starts unbound, so a secret captured in one stay is useless the next.
// ---------------------------------------------------------------------------

/** Fresh per-stay device secret — two UUIDs, ~256-bit (goes into the cookie). */
export function generateStaySecret(): string {
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "");
}

function hashStaySecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/** Constant-time compare of two equal-length hex digests (defence in depth). */
function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

export type StayBinding =
  | { status: "bound"; secret: string } // we just claimed this stay → caller sets the cookie
  | { status: "match" } //                 the presented secret matches the bound device
  | { status: "mismatch" } //              a DIFFERENT device already holds this stay
  | { status: "unclaimed" }; //            unbound AND claiming was withheld (PIN gate: allowClaim=false)

/**
 * Claim-or-verify a stay's chat for the calling device. Unbound → mint a secret
 * and atomically claim the stay (returns it so the route can set the cookie).
 * Already bound → "match" iff the presented cookie secret is the one that claimed
 * it, else "mismatch". The claim is a conditional updateMany (only succeeds while
 * still unbound), so two devices racing the first scan can't both win — mirrors
 * the TOTP-burn / lock-acquire pattern used elsewhere.
 */
export async function bindOrCheckStay(
  reservationId: string,
  presentedSecret: string | null | undefined,
  opts: { allowClaim?: boolean } = {},
): Promise<StayBinding> {
  const row = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: { chatBoundHash: true },
  });
  if (!row) return { status: "mismatch" };

  if (row.chatBoundHash) {
    if (presentedSecret && safeEqualHex(hashStaySecret(presentedSecret), row.chatBoundHash)) {
      return { status: "match" };
    }
    return { status: "mismatch" };
  }

  // Unbound. When claiming is WITHHELD (PIN gate, Faz 5): report "unclaimed" so
  // the caller can require a PIN before anyone binds — WITHOUT this device
  // silently winning the stay just by scanning first. Default allowClaim=true
  // preserves the original first-scan-wins behavior for every existing caller.
  if (opts.allowClaim === false) return { status: "unclaimed" };

  // Unbound → mint a FRESH secret (rotation: never reuse a previous stay's cookie
  // as this stay's binding) and claim atomically.
  const secret = generateStaySecret();
  const claimed = await prisma.reservation.updateMany({
    where: { id: reservationId, chatBoundHash: null },
    data: { chatBoundHash: hashStaySecret(secret), chatBoundAt: new Date() },
  });
  if (claimed.count === 1) return { status: "bound", secret };

  // Lost the first-scan race: another device bound between our read and write.
  // Re-check the now-set hash against whatever this device holds.
  const now = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: { chatBoundHash: true },
  });
  if (now?.chatBoundHash && presentedSecret && safeEqualHex(hashStaySecret(presentedSecret), now.chatBoundHash)) {
    return { status: "match" };
  }
  return { status: "mismatch" };
}

const APP_TZ = "Europe/Istanbul";

/** "HH:MM" → minutes since midnight (tolerant of a single-digit hour). */
function hhmmToMinutes(s: string): number {
  const m = /(\d{1,2}):(\d{2})/.exec(s ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

/** Current wall-clock time in the app timezone as minutes since midnight. */
function nowMinutesInTz(now: Date): number {
  const hhmm = new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  return hhmmToMinutes(hhmm);
}

export interface GuestChatContext {
  property: {
    id: string;
    organizationId: string;
    name: string;
    checkInTime: string;
    checkOutTime: string;
    address: string | null;
    city: string | null;
  };
  /** True only during an active stay (arrival day → checkOutTime on departure day,
   *  Istanbul). When false the chat is closed (vacant / before check-in / after
   *  checkout) and answers nothing. */
  open: boolean;
  /** The guest currently in residence, if any. */
  activeReservation: {
    id: string;
    guestName: string;
    arrivalDate: Date;
    departureDate: Date;
    status: string;
  } | null;
  /** Active KB items with secret-bearing categories removed. */
  knowledgeBase: { category: string; title: string; content: string }[];
  /** True when this stay must present a PIN before it can be claimed on a device
   *  (Faz 5). Derived: QR_PIN_ENABLED env on AND (this reservation has a PIN OR the
   *  org runs strict mode). NEVER exposes the hash — only the boolean gate. */
  pinRequired: boolean;
}

/**
 * Resolve a public chat token to its apartment + secret-free knowledge base +
 * the currently-staying reservation. Returns null when the token is missing,
 * too short, unknown, or the apartment's chat is disabled — so an invalid or
 * switched-off token is indistinguishable from a 404.
 *
 * The token is globally unique, so it resolves to exactly one apartment in one
 * organization; there is no cross-tenant path.
 */
export async function resolveGuestChat(
  token: string,
  now: Date = new Date(),
): Promise<GuestChatContext | null> {
  if (!token || token.length < 16) return null;

  const property = await prisma.property.findFirst({
    where: { chatToken: token },
    select: {
      id: true,
      organizationId: true,
      name: true,
      checkInTime: true,
      checkOutTime: true,
      address: true,
      city: true,
      chatEnabled: true,
      // Org strict-mode toggle (Faz 5): when on, EVERY not-yet-claimed stay needs
      // a PIN. Read here so the PIN gate is computed in one place.
      organization: { select: { qrChatPinRequired: true } },
    },
  });
  if (!property || !property.chatEnabled) return null;

  // Tie the QR concierge to premium access, using the SAME gate as every other
  // paid AI surface (inbox reply / ai-suggest / test / translate / hazirlik) so
  // the feature can't be stricter than the rest. When billing is enforced and the
  // org's subscription has lapsed/canceled, the QR stops working (resolves to 404,
  // exactly like a disabled chat). Grandfathered (no subscription — existing
  // customers / founder) and active/trialing orgs are unaffected. DORMANT-SAFE:
  // premiumAllowed is always true while BILLING_ENFORCED is off, so flipping that
  // kill-switch restores the QR alongside everything else (getEntitlement().active
  // would have kept blocking a canceled org even while dormant — the outlier this
  // fixes).
  if (!(await premiumAllowed(property.organizationId))) return null;

  const propertyPublic = {
    id: property.id,
    organizationId: property.organizationId,
    name: property.name,
    checkInTime: property.checkInTime,
    checkOutTime: property.checkOutTime,
    address: property.address,
    city: property.city,
  };

  // OPEN only during an active stay: from the arrival day through the property's
  // checkOutTime on the departure day (Istanbul). Before check-in, after checkout,
  // or while vacant → CLOSED. So a past guest who kept the QR can't keep using it,
  // and it resets for the next guest automatically.
  const candidates = await prisma.reservation.findMany({
    where: {
      propertyId: property.id,
      status: { in: ["confirmed", "completed"] },
      // Wide net; the precise open/closed decision is the Istanbul day/time check.
      arrivalDate: { lte: new Date(now.getTime() + 12 * 60 * 60 * 1000) },
      departureDate: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
    },
    // Ascending (earliest arrival first): on a back-to-back turnover day the
    // INCUMBENT stay wins until it checks out, then the next one takes over.
    orderBy: { arrivalDate: "asc" },
    // chatPinHash is selected ONLY to derive the pinRequired boolean below — it is
    // stripped from the returned activeReservation (the hash never leaves this fn).
    select: { id: true, guestName: true, arrivalDate: true, departureDate: true, status: true, chatPinHash: true },
  });

  // Evaluate EVERY candidate, not just one row: the 12h look-ahead pulls the NEXT
  // guest's reservation into the set before they arrive, so a bare findFirst(desc)
  // would return that not-yet-started row and (a) CLOSE the chat for the guest
  // currently on-site the afternoon before turnover, and (b) on turnover morning
  // serve the on-site guest's thread under the next guest's id (cross-guest PII).
  const isOpenNow = (r: { arrivalDate: Date; departureDate: Date }): boolean => {
    const arrDiff = daysUntilDate(r.arrivalDate, now); // 0 = today, >0 future, <0 past
    const depDiff = daysUntilDate(r.departureDate, now);
    // Symmetric HARD gate (Istanbul): on the arrival day the chat only opens once the
    // property's check-in time is reached — not from the day-start. This closes the
    // turnover window (prev guest checked out, next guest not yet checked in) so a
    // cleaner / past guest can't scan the fixed QR and claim the INCOMING stay's chat
    // before the real guest arrives. Trade-off (documented): a host-approved EARLY
    // check-in can't use the QR chat until the official check-in time.
    const afterCheckin =
      arrDiff < 0 ||
      (arrDiff === 0 && nowMinutesInTz(now) >= hhmmToMinutes(property.checkInTime));
    const beforeCheckout =
      depDiff > 0 ||
      (depDiff === 0 && nowMinutesInTz(now) < hhmmToMinutes(property.checkOutTime));
    return afterCheckin && beforeCheckout;
  };
  const activeRow = candidates.find(isOpenNow) ?? null;
  const open = activeRow !== null;
  // PIN gate (Faz 5): env master switch AND (this stay has a PIN OR org strict mode).
  // Computed from the hash PRESENCE only; the hash itself is never returned.
  const pinRequired =
    open && qrPinEnabled() && (Boolean(activeRow.chatPinHash) || property.organization.qrChatPinRequired);
  // Strip chatPinHash from the exposed shape.
  const activeReservation: GuestChatContext["activeReservation"] = activeRow
    ? {
        id: activeRow.id,
        guestName: activeRow.guestName,
        arrivalDate: activeRow.arrivalDate,
        departureDate: activeRow.departureDate,
        status: activeRow.status,
      }
    : null;

  // Closed → return the property (so the page can show a branded "no active stay"
  // screen) but no reservation and an empty knowledge base (nothing to answer).
  if (!open) {
    return { property: propertyPublic, open: false, activeReservation: null, knowledgeBase: [], pinRequired: false };
  }

  const kbRaw = await prisma.knowledgeBaseItem.findMany({
    where: {
      propertyId: property.id,
      isActive: true,
      category: { notIn: [...QR_SECRET_CATEGORIES] },
    },
    select: { category: true, title: true, content: true },
  });
  // Drop any item whose text looks like an access secret, even in an allowed
  // category — the public bearer-token surface must never have a code in context.
  const knowledgeBase = kbRaw.filter((k) => !looksLikeSecret(`${k.title}\n${k.content}`));

  return { property: propertyPublic, open: true, activeReservation, knowledgeBase, pinRequired };
}
