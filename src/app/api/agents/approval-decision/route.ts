import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { approvalDecisionRequestSchema, decideApproval } from "@/lib/agents/approval-workflow";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const input = approvalDecisionRequestSchema.parse(body);
    const result = await decideApproval(input);

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: "Invalid approval decision request.", issues: error.issues }, { status: 400 });
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Approval decision failed."
      },
      { status: 500 }
    );
  }
}
