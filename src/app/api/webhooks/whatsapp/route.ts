import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { extractInboundMessages, type WaWebhookPayload } from "@/lib/whatsapp";
import { applyInboundMessageRules, applyWhatsappAutoReply } from "@/lib/automation";

// ---------------------------------------------------------------------------
// WhatsApp Business Cloud API webhook
//
// GET  → hub.challenge verification (Meta sends this when you register the webhook)
// POST → incoming messages & delivery receipts from Meta
//
// Required env var:
//   WHATSAPP_VERIFY_TOKEN — a secret string you choose and set in Meta's dashboard
//   WHATSAPP_PHONE_NUMBER_ID — the numeric phone number ID (to scope org lookup)
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === (process.env.WHATSAPP_VERIFY_TOKEN ?? "")) {
    // Verification successful — echo the challenge back to Meta.
    return new NextResponse(challenge, { status: 200 });
  }

  return new NextResponse("Forbidden", { status: 403 });
}

export async function POST(req: NextRequest) {
  // Always acknowledge immediately — Meta retries if we don't return 200 fast.
  let body: WaWebhookPayload;
  try {
    body = (await req.json()) as WaWebhookPayload;
  } catch {
    return new NextResponse("Bad Request", { status: 400 });
  }

  if (body.object !== "whatsapp_business_account") {
    return new NextResponse("OK", { status: 200 });
  }

  const messages = extractInboundMessages(body);

  // Process each inbound message asynchronously after we've returned 200.
  // We use void — if processing fails it's logged but Meta won't re-deliver.
  void processMessages(messages);

  return new NextResponse("OK", { status: 200 });
}

// ---------------------------------------------------------------------------
// Async message processing — find or create conversation, store message,
// run automation rules.
// ---------------------------------------------------------------------------
async function processMessages(
  messages: Awaited<ReturnType<typeof extractInboundMessages>>,
): Promise<void> {
  for (const msg of messages) {
    try {
      await handleOneMessage(msg);
    } catch (err) {
      console.error("[WhatsApp webhook] Failed to process message", msg.id, err);
    }
  }
}

async function handleOneMessage(
  msg: Awaited<ReturnType<typeof extractInboundMessages>>[number],
): Promise<void> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const messageBody = msg.text?.body ?? "";
  if (!messageBody) return;

  // ------------------------------------------------------------------
  // Find the property associated with this WhatsApp number.
  // Businesses link a phone number to exactly one property via the KB
  // or we fall back to the first property of the org that owns this WA account.
  // For MVP: look up by WHATSAPP_PHONE_NUMBER_ID env var → find any org property.
  // In V2, each property could have its own phone number ID.
  // ------------------------------------------------------------------
  let propertyId: string | null = null;

  if (phoneNumberId) {
    // Find the first property in any org that has a KB item with the phone number id.
    const kbMatch = await prisma.knowledgeBaseItem.findFirst({
      where: { content: { contains: phoneNumberId }, category: "general" },
      select: { propertyId: true },
    });
    if (kbMatch) {
      propertyId = kbMatch.propertyId;
    }
  }

  // Fallback: use the first property in the database (single-tenant dev).
  if (!propertyId) {
    const firstProp = await prisma.property.findFirst({ select: { id: true } });
    propertyId = firstProp?.id ?? null;
  }

  if (!propertyId) {
    console.warn("[WhatsApp webhook] No property found — cannot store message.");
    return;
  }

  const senderName = msg.profileName ?? msg.from;

  // Find or create conversation for this phone number.
  let conversation = await prisma.conversation.findFirst({
    where: { propertyId, channel: "whatsapp", guestIdentifier: msg.from },
    orderBy: { createdAt: "desc" },
  });

  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        propertyId,
        channel: "whatsapp",
        guestIdentifier: msg.from,
        status: "new",
        priority: "standard",
        lastMessageAt: new Date(),
      },
    });
  } else {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date() },
    });
  }

  // Store the inbound message.
  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: "inbound",
      senderName,
      body: messageBody,
      language: "tr", // language detection happens in AI layer
    },
  });

  // Run automation rules (classification, complaint escalation, etc.).
  await applyInboundMessageRules(conversation.id, messageBody);

  // If the org enabled it, auto-answer safe, high-confidence messages.
  // Complaints/risky/uncertain messages are skipped and wait for a human.
  await applyWhatsappAutoReply(conversation.id);
}
