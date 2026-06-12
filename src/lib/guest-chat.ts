import { prisma } from "@/lib/db";

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
];

function looksLikeSecret(text: string): boolean {
  return SECRET_PATTERNS.some((re) => re.test(text));
}

/** Unguessable per-apartment chat token — two UUIDs, ~256-bit (icalToken style). */
export function generateChatToken(): string {
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "");
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
    },
  });
  if (!property || !property.chatEnabled) return null;

  const [activeReservation, kbRaw] = await Promise.all([
    prisma.reservation.findFirst({
      where: {
        propertyId: property.id,
        status: { in: ["confirmed", "completed"] },
        arrivalDate: { lte: now },
        departureDate: { gte: now },
      },
      orderBy: { arrivalDate: "desc" },
      select: { id: true, guestName: true, arrivalDate: true, departureDate: true, status: true },
    }),
    prisma.knowledgeBaseItem.findMany({
      where: {
        propertyId: property.id,
        isActive: true,
        category: { notIn: [...QR_SECRET_CATEGORIES] },
      },
      select: { category: true, title: true, content: true },
    }),
  ]);

  // Drop any item whose text looks like an access secret, even in an allowed
  // category — the public bearer-token surface must never have a code in context.
  const knowledgeBase = kbRaw.filter((k) => !looksLikeSecret(`${k.title}\n${k.content}`));

  return {
    property: {
      id: property.id,
      organizationId: property.organizationId,
      name: property.name,
      checkInTime: property.checkInTime,
      checkOutTime: property.checkOutTime,
      address: property.address,
      city: property.city,
    },
    activeReservation,
    knowledgeBase,
  };
}
