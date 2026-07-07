import { NextResponse } from "next/server";
import { runGuestMessagePipeline } from "@/lib/agents/message-pipeline";
import { canAutoSendGuestReply } from "@/lib/ai/guardrails";
import { guestMessageContextSchema } from "@/lib/ai/types";

export async function POST(request: Request) {
  const body = await request.json();
  const context = guestMessageContextSchema.parse(body);
  const result = await runGuestMessagePipeline(context, { persist: body.persist === true });

  return NextResponse.json({
    ...result,
    decisions: {
      ...result.decisions,
      canAutoSendGuestReply: canAutoSendGuestReply(result.analysis),
    }
  });
}
