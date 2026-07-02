import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { suggestReply } from "@/lib/ai";
import { badRequest, jsonOk, notFound, serverError, tooManyRequests } from "@/lib/api";
import { rateLimit, clientIp } from "@/lib/rate-limit";

// ---------------------------------------------------------------------------
// PUBLIC landing-page AI demo — "type a guest message, see the real answer".
//
// DORMANT unless LANDING_DEMO_ENABLED=1 (404 otherwise), because this is an
// unauthenticated surface that spends OpenAI money. When enabled it runs the
// exact same suggestReply pipeline the product uses, against a FICTIONAL
// sample apartment + knowledge base baked in below — it never reads any real
// organization's data, so nothing can leak. Nothing is written or sent.
//
// Cost gates: per-IP rate limit + a durable GLOBAL daily cap (ChatUsage row
// under a synthetic key, same mechanism as the QR concierge's per-apartment
// cap — survives restarts and replicas).
// ---------------------------------------------------------------------------

const MAX_MESSAGE = 500;
const DEMO_USAGE_KEY = "landing-demo"; // synthetic ChatUsage propertyId (no FK)

function dailyCap(): number {
  return Number(process.env.LANDING_DEMO_DAILY_CAP) || 300;
}

// Entirely fictional apartment — safe to show anyone.
const DEMO_PROPERTY = {
  name: "Örnek Daire 3",
  checkInTime: "15:00",
  checkOutTime: "11:00",
  address: "Örnek Mah. Deneme Sok. No: 5",
  city: "İstanbul",
};

const DEMO_KB = [
  { category: "wifi", title: "Wi-Fi", content: "Ağ adı: OrnekDaire, şifre: hosgeldiniz2026. Modem salonda TV ünitesinin yanındadır." },
  { category: "parking", title: "Otopark", content: "Bina önünde ücretsiz sokak parkı var; en yakın kapalı otopark 3 dk yürüme mesafesinde (günlük ~₺150)." },
  { category: "rules", title: "Ev kuralları", content: "Dairede sigara içilmez, evcil hayvan kabul edilmez. 22:00'den sonra lütfen gürültü yapmayınız." },
  { category: "trash", title: "Çöp", content: "Çöpleri binanın yan sokağındaki gri konteynere bırakabilirsiniz." },
  { category: "faq", title: "Klima", content: "Klima kumandası yatak odasındaki komodinin üzerindedir. Isıtma için güneş simgeli moda alın." },
  { category: "local_tips", title: "Kahvaltı önerisi", content: "İki sokak ötedeki Örnek Fırın'ın kahvaltısı misafirlerimizin favorisi." },
];

export async function POST(req: NextRequest) {
  // Master switch — this endpoint simply doesn't exist until the operator
  // deliberately enables the landing demo.
  if (process.env.LANDING_DEMO_ENABLED !== "1") return notFound();

  try {
    const limited = rateLimit(`demo-ai:${clientIp(req)}`, 6, 60 * 60_000); // 6 / hour / IP
    if (!limited.ok) return tooManyRequests(limited.retryAfter);

    const body = (await req.json().catch(() => null)) as { message?: unknown } | null;
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    if (!message) return badRequest({ message: "Bir mesaj yazın." });
    if (message.length > MAX_MESSAGE) {
      return badRequest({ message: `Mesaj çok uzun (en fazla ${MAX_MESSAGE} karakter).` });
    }

    // Durable global daily cap: atomic increment then check, so a burst of
    // visitors can never spend past the ceiling — even across restarts/replicas.
    const day = new Date().toISOString().slice(0, 10);
    const usage = await prisma.chatUsage.upsert({
      where: { propertyId_day: { propertyId: DEMO_USAGE_KEY, day } },
      create: { propertyId: DEMO_USAGE_KEY, day, count: 1 },
      update: { count: { increment: 1 } },
      select: { count: true },
    });
    if (usage.count > dailyCap()) {
      return NextResponse.json(
        { error: "Demo bugünlük dolu — yarın tekrar deneyebilir ya da hemen ücretsiz kaydolabilirsiniz." },
        { status: 429 },
      );
    }

    // The REAL product pipeline against the fictional apartment. A sample
    // confirmed stay is attached (like the in-app playground) so questions
    // about the stay behave realistically. Result is returned only.
    const now = new Date();
    const result = await suggestReply({
      guestMessage: message,
      property: DEMO_PROPERTY,
      reservation: {
        guestName: "Demo Misafir",
        arrivalDate: now,
        departureDate: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
        status: "confirmed",
      },
      knowledgeBase: DEMO_KB,
      history: [],
      tone: "warm",
      language: "tr",
      styleProfile: null,
    });

    return jsonOk({
      reply: result.reply,
      intent: result.intent,
      confidence: result.confidence,
      riskLevel: result.riskLevel,
      detectedLanguage: result.detectedLanguage,
      source: result.source,
    });
  } catch (err) {
    return serverError(undefined, err);
  }
}
