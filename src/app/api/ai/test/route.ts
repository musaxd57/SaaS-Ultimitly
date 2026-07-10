import { prisma } from "@/lib/db";
import { suggestReply } from "@/lib/ai";
import { badRequest, jsonOk, tooManyRequests, paymentRequired } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { rateLimit } from "@/lib/rate-limit";
import { premiumAllowed } from "@/lib/billing/subscription";

// ---------------------------------------------------------------------------
// AI reply PLAYGROUND — safe dry-run.
//
// POST { message, propertyId? } → runs the exact same suggestReply pipeline the
// inbox uses (real prompt + live model), against a typed test message and a
// chosen apartment's knowledge base. NOTHING is sent, NO conversation is
// created, NOTHING is written to the database. Pure read-only preview so the
// host can sanity-check the AI's behaviour without touching a real guest.
// ---------------------------------------------------------------------------

const TONES = ["warm", "formal", "short", "luxury"] as const;
type Tone = (typeof TONES)[number];

export const POST = withManage(async (session, req) => {
  // Paid AI feature: blocked once the trial lapses (dormant-safe until enforced).
  if (!(await premiumAllowed(session.organizationId))) return paymentRequired();

  // Playground calls OpenAI ($). Throttle per user to cap spend on abuse.
  const limited = rateLimit(`ai-test:${session.userId}`, 15, 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  const body = (await req.json().catch(() => null)) as
    | { message?: unknown; propertyId?: unknown; tone?: unknown }
    | null;
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) return badRequest({ message: "Bir test mesajı yazın." });
  if (message.length > 4000) return badRequest({ message: "Mesaj çok uzun (en fazla 4000 karakter)." });

  const tone: Tone = TONES.includes(body?.tone as Tone) ? (body?.tone as Tone) : "warm";

  // Pick the requested apartment (must belong to the org) or fall back to the
  // org's first apartment, so the knowledge base is realistic.
  const property = await prisma.property.findFirst({
    where: {
      organizationId: session.organizationId,
      ...(typeof body?.propertyId === "string" && body.propertyId ? { id: body.propertyId } : {}),
    },
    orderBy: { createdAt: "asc" },
  });
  if (!property) return badRequest({ _: "Önce en az bir daire ekleyin." });

  const kbRaw = await prisma.knowledgeBaseItem.findMany({
    where: { propertyId: property.id, isActive: true },
    select: { category: true, title: true, content: true },
  });
  const aptNumber = property.name.match(/\d+/g)?.pop() ?? property.name;
  const kb = kbRaw.map((k) => ({
    ...k,
    content: k.content
      .replace(/\{\s*(isim|ad|name)\s*\}/gi, "misafirimiz")
      .replace(/\{\s*(daire|apartment|apt)\s*\}/gi, aptNumber),
  }));

  const org = await prisma.organization.findUnique({
    where: { id: session.organizationId },
    select: { aiStyleProfile: true },
  });

  // Same pipeline as the inbox. We attach a SAMPLE reservation (today's
  // check-in at the chosen apartment) so reservation-aware questions ("which
  // apartment am I in?", "when is my check-out?") test realistically — exactly
  // as a real inbox conversation, which is always tied to a booking. The
  // result is only returned, never sent and never persisted.
  const now = new Date();
  const result = await suggestReply({
    guestMessage: message,
    property: {
      name: property.name,
      checkInTime: property.checkInTime,
      checkOutTime: property.checkOutTime,
      address: property.address,
      city: property.city,
    },
    reservation: {
      guestName: "Test Misafir",
      arrivalDate: now,
      departureDate: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
      status: "confirmed",
    },
    knowledgeBase: kb,
    history: [],
    tone,
    language: "tr",
    styleProfile: org?.aiStyleProfile,
  });

  return jsonOk({ ...result, property: property.name });
});
