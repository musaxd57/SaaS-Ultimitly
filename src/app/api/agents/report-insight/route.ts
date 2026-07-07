import { NextResponse } from "next/server";
import { agentOrchestrator } from "@/lib/ai/agent-orchestrator";
import { reportMetricsSchema } from "@/lib/ai/types";

export async function POST(request: Request) {
  const body = await request.json();
  const metrics = reportMetricsSchema.parse(body);
  const result = await agentOrchestrator.writeReportInsight(metrics);

  return NextResponse.json(result);
}
