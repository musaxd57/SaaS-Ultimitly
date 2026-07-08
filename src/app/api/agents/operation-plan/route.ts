import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { agentOrchestrator } from "@/lib/ai/agent-orchestrator";
import { guestMessageContextSchema } from "@/lib/ai/types";
import { createOperationPlan } from "@/lib/agents/operation-plan";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const context = guestMessageContextSchema.parse(body);
    const { analysis, run } = await agentOrchestrator.analyzeGuestMessage(context);
    const plan = createOperationPlan(context, analysis);

    return NextResponse.json({
      analysis,
      plan,
      run
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: "Invalid operation planning request.", issues: error.issues }, { status: 400 });
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Operation planning failed."
      },
      { status: 500 }
    );
  }
}
