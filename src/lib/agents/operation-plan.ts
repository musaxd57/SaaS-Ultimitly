import { z } from "zod";
import { canAutoCreateTask, canAutoSendGuestReply, shouldRequireHumanApproval } from "@/lib/ai/guardrails";
import type { AgentAnalysis, GuestMessageContext } from "@/lib/ai/types";

export const operationToolNames = [
  "create_task_suggestion",
  "create_approval_item",
  "draft_guest_reply",
  "notify_operations_team",
  "link_to_existing_issue",
  "add_report_signal"
] as const;

export const operationPlanStepSchema = z.object({
  tool: z.enum(operationToolNames),
  title: z.string(),
  reason: z.string(),
  status: z.enum(["pending", "requires_human", "safe_to_automate"]),
  payload: z.record(z.unknown())
});

export const operationPlanSchema = z.object({
  conversationId: z.string().optional(),
  sourceMessageId: z.string().optional(),
  riskLevel: z.string(),
  automationMode: z.enum(["copilot", "controlled_automation", "human_only"]),
  summary: z.string(),
  steps: z.array(operationPlanStepSchema),
  blockers: z.array(z.string())
});

export type OperationPlan = z.infer<typeof operationPlanSchema>;

function chooseAutomationMode(analysis: AgentAnalysis): OperationPlan["automationMode"] {
  if (analysis.riskLevel === "CRITICAL" || shouldRequireHumanApproval(analysis)) {
    return "human_only";
  }
  if (canAutoCreateTask(analysis) || canAutoSendGuestReply(analysis)) {
    return "controlled_automation";
  }
  return "copilot";
}

function buildTaskPayload(context: GuestMessageContext, analysis: AgentAnalysis) {
  if (!analysis.task) {
    return {};
  }

  return {
    tenantId: context.tenantId,
    conversationId: context.conversationId,
    sourceMessageId: context.sourceMessageId,
    propertyId: context.property?.id,
    reservationId: context.reservation?.id,
    title: analysis.task.title,
    description: analysis.task.description,
    category: analysis.task.category,
    priority: analysis.task.priority,
    assigneeType: analysis.task.assigneeType,
    slaMinutes: analysis.task.slaMinutes,
    locationHint: analysis.task.locationHint,
    confidence: analysis.confidence,
    riskLevel: analysis.riskLevel,
    dedupeKey: analysis.dedupeKey
  };
}

export function createOperationPlan(context: GuestMessageContext, analysis: AgentAnalysis): OperationPlan {
  const automationMode = chooseAutomationMode(analysis);
  const blockers: string[] = [];
  const steps: OperationPlan["steps"] = [];

  if (analysis.confidence < 0.7) {
    blockers.push("AI confidence is below the safe automation threshold.");
  }

  if (shouldRequireHumanApproval(analysis)) {
    blockers.push("Risk gate requires human approval before guest-facing action.");
  }

  if (analysis.taskRequired && analysis.task) {
    steps.push({
      tool: "create_task_suggestion",
      title: analysis.task.title,
      reason: "Guest message contains an operational issue that should be tracked.",
      status: canAutoCreateTask(analysis) ? "safe_to_automate" : "requires_human",
      payload: buildTaskPayload(context, analysis)
    });
  }

  if (analysis.dedupeKey) {
    steps.push({
      tool: "link_to_existing_issue",
      title: "Check duplicate operational issue",
      reason: "Avoid opening multiple tasks for the same guest/property problem.",
      status: "pending",
      payload: {
        dedupeKey: analysis.dedupeKey,
        propertyId: context.property?.id,
        reservationId: context.reservation?.id
      }
    });
  }

  steps.push({
    tool: "draft_guest_reply",
    title: "Prepare guest reply draft",
    reason: "The operator should have a ready-to-review reply in the inbox.",
    status: canAutoSendGuestReply(analysis) ? "safe_to_automate" : "requires_human",
    payload: {
      draft: analysis.guestReplyDraft,
      language: analysis.language,
      riskLevel: analysis.riskLevel,
      confidence: analysis.confidence
    }
  });

  if (shouldRequireHumanApproval(analysis)) {
    steps.push({
      tool: "create_approval_item",
      title: "Queue guest reply for human approval",
      reason: analysis.riskReasons.join(" | ") || "Risk gate blocked automatic guest reply.",
      status: "requires_human",
      payload: {
        tenantId: context.tenantId,
        sourceMessageId: context.sourceMessageId,
        draft: analysis.guestReplyDraft,
        riskLevel: analysis.riskLevel,
        reasons: analysis.riskReasons
      }
    });
  }

  if (analysis.riskLevel === "HIGH" || analysis.riskLevel === "CRITICAL") {
    steps.push({
      tool: "notify_operations_team",
      title: "Alert operations team",
      reason: "High-risk guest issue should not wait for normal queue processing.",
      status: "pending",
      payload: {
        tenantId: context.tenantId,
        propertyName: context.property?.name,
        guestName: context.guest?.name,
        riskLevel: analysis.riskLevel,
        message: context.message
      }
    });
  }

  steps.push({
    tool: "add_report_signal",
    title: "Add report signal",
    reason: "The issue should contribute to property and category health metrics.",
    status: "safe_to_automate",
    payload: {
      tenantId: context.tenantId,
      propertyId: context.property?.id,
      category: analysis.task?.category ?? "GENERAL",
      riskLevel: analysis.riskLevel,
      tags: analysis.reportTags
    }
  });

  return operationPlanSchema.parse({
    conversationId: context.conversationId,
    sourceMessageId: context.sourceMessageId,
    riskLevel: analysis.riskLevel,
    automationMode,
    summary:
      automationMode === "human_only"
        ? "Riskli mesaj: AI sadece öneri üretir, aksiyonlar insan onayından geçer."
        : automationMode === "controlled_automation"
          ? "Kontrollü otomasyon: düşük riskli operasyon adımları otomatik hazırlanabilir."
          : "Copilot modu: AI öneri üretir, operatör karar verir.",
    steps,
    blockers
  });
}
