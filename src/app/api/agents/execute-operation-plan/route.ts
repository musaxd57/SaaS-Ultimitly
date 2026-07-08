import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { executeOperationPlan, operationExecutionRequestSchema } from "@/lib/agents/operation-executor";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const input = operationExecutionRequestSchema.parse(body);
    const result = await executeOperationPlan(input);

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: "Invalid operation execution request.", issues: error.issues }, { status: 400 });
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Operation execution failed."
      },
      { status: 500 }
    );
  }
}
