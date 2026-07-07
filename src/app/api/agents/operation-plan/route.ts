import { NextResponse } from "next/server";
import { agentOrchestrator } from "@/lib/ai/agent-orchestrator";
import { guestMessageContextSchema } from "@/lib/ai/types";
import { createOperationPlan } from "@/lib/agents/operation-plan";

export async function POST(request: Request) {
  const body = await request.json();
  const context = guestMessageContextSchema.parse(body);
  const { analysis, run } = await agentOrchestrator.analyzeGuestMessage(context);
  const plan = createOperationPlan(context, analysis);

  return NextResponse.json({
    analysis,
    plan,
    run
  });
}
