import { NextResponse } from "next/server";
import { executeOperationPlan, operationExecutionRequestSchema } from "@/lib/agents/operation-executor";

export async function POST(request: Request) {
  const body = await request.json();
  const input = operationExecutionRequestSchema.parse(body);
  const result = await executeOperationPlan(input);

  return NextResponse.json(result);
}
