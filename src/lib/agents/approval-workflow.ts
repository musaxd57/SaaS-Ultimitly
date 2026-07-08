import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

export const approvalDecisionRequestSchema = z
  .object({
    tenantId: z.string(),
    approvalId: z.string(),
    decision: z.enum(["approve", "reject", "edit"]),
    reviewerId: z.string().optional(),
    editedDraft: z.string().optional(),
    reason: z.string().optional()
  })
  .superRefine((value, context) => {
    if (value.decision === "edit" && !value.editedDraft?.trim()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["editedDraft"],
        message: "editedDraft is required when decision is edit."
      });
    }
  });

export type ApprovalDecisionRequest = z.infer<typeof approvalDecisionRequestSchema>;

export type ApprovalDecisionResult = {
  approvalId: string;
  status: "APPROVED" | "REJECTED" | "EDITED";
  eventId: string;
  outbound: {
    status: "blocked";
    reason: string;
    draft: string | null;
  };
};

function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function statusForDecision(decision: ApprovalDecisionRequest["decision"]): ApprovalDecisionResult["status"] {
  if (decision === "reject") {
    return "REJECTED";
  }

  if (decision === "edit") {
    return "EDITED";
  }

  return "APPROVED";
}

export async function decideApproval(input: ApprovalDecisionRequest): Promise<ApprovalDecisionResult> {
  const request = approvalDecisionRequestSchema.parse(input);
  const approval = await prisma.approvalItem.findFirst({
    where: {
      id: request.approvalId,
      tenantId: request.tenantId
    }
  });

  if (!approval) {
    throw new Error("Approval item was not found for this tenant.");
  }

  if (approval.status !== "PENDING") {
    throw new Error(`Approval item is already ${approval.status}.`);
  }

  const nextStatus = statusForDecision(request.decision);
  const nextDraft = request.decision === "edit" ? request.editedDraft?.trim() : approval.draft;

  const updated = await prisma.approvalItem.update({
    where: { id: approval.id },
    data: {
      status: nextStatus,
      editedDraft: request.decision === "edit" ? nextDraft : undefined,
      decisionReason: request.reason,
      reviewerId: request.reviewerId,
      decidedAt: new Date()
    }
  });

  const event = await prisma.operationEvent.create({
    data: {
      tenantId: request.tenantId,
      type: "approval_decision",
      severity: updated.riskLevel,
      title: `Approval ${nextStatus.toLowerCase()}`,
      body: request.reason ?? "Human reviewed an AI-generated guest reply draft.",
      metadata: toPrismaJson({
        approvalId: updated.id,
        decision: request.decision,
        status: nextStatus,
        reviewerId: request.reviewerId,
        sourceMessageId: updated.sourceMessageId
      })
    }
  });

  return {
    approvalId: updated.id,
    status: nextStatus,
    eventId: event.id,
    outbound: {
      status: "blocked",
      reason: "Guest-facing send is intentionally disabled until the real inbox connector and send approval state machine are wired.",
      draft: nextStatus === "REJECTED" ? null : nextDraft ?? null
    }
  };
}
