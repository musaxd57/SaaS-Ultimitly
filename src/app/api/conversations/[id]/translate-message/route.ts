import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import {
  requireSession,
  unauthorized,
  badRequest,
  jsonOk,
  notFound,
  serverError,
  tooManyRequests,
} from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { zodFieldErrors } from "@/lib/validators";
import { translateText } from "@/lib/ai/translate";

type Params = { params: Promise<{ id: string }> };

const translateSchema = z.object({
  messageId: z.string().min(1, "messageId gerekli"),
  targetLanguage: z.string().min(2, "Hedef dil gerekli"),
});

export async function POST(req: NextRequest, { params }: Params) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const { id } = await params;

  // Translation calls OpenAI ($). Throttle per user to cap spend on abuse.
  const limited = rateLimit(`translate:${session.userId}`, 30, 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  try {
    // Verify conversation belongs to org
    const conversation = await prisma.conversation.findFirst({
      where: { id, property: { organizationId: session.organizationId } },
      select: { id: true },
    });
    if (!conversation) return notFound();

    const data = await req.json().catch(() => null);
    const parsed = translateSchema.safeParse(data);
    if (!parsed.success) return badRequest(zodFieldErrors(parsed.error));

    const message = await prisma.message.findFirst({
      where: { id: parsed.data.messageId, conversationId: id },
      select: { id: true, body: true, language: true },
    });
    if (!message) return notFound("Mesaj bulunamadı");

    const sourceLanguage = message.language || undefined;
    const translation = await translateText(
      message.body,
      parsed.data.targetLanguage,
      sourceLanguage,
    );

    // Detect language using AI fallback heuristic (cheap, no OpenAI needed)
    // We rely on the stored language field; if missing fall back to detect
    const detectedLanguage = sourceLanguage ?? (
      /\b(the|is|are|can|i |you |please|hello|hi |my |for |and )\b/.test(message.body.toLowerCase()) ? "en"
      : /\b(ich |sie |bitte|danke|hallo|ist |und |für )\b/.test(message.body.toLowerCase()) ? "de"
      : "tr"
    );

    return jsonOk({ translation, detectedLanguage });
  } catch {
    return serverError();
  }
}
