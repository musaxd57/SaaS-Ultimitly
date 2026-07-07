import { prisma } from "@/lib/db/prisma";
import { agentOrchestrator } from "@/lib/ai/agent-orchestrator";
import { canAutoCreateTask, shouldRequireHumanApproval } from "@/lib/ai/guardrails";
import type { AgentAnalysis, GuestMessageContext } from "@/lib/ai/types";

type PipelineOptions = {
  persist?: boolean;
};

type PipelineResult = {
  analysis: AgentAnalysis;
  decisions: {
    canAutoCreateTask: boolean;
    requiresHumanApproval: boolean;
  };
  created: {
    taskId?: string;
    approvalId?: string;
    agentRunId?: string;
  };
};

function mapTaskCategory(category: NonNullable<AgentAnalysis["task"]>["category"]) {
  return category;
}

function mapTaskPriority(priority: NonNullable<AgentAnalysis["task"]>["priority"]) {
  return priority;
}

export async function runGuestMessagePipeline(
  context: GuestMessageContext,
  options: PipelineOptions = {}
): Promise<PipelineResult> {
  const result = await agentOrchestrator.analyzeGuestMessage(context);
  const canCreateTask = canAutoCreateTask(result.analysis);
  const requiresApproval = shouldRequireHumanApproval(result.analysis);
  const created: PipelineResult["created"] = {};

  if (options.persist) {
    const agentRun = await prisma.agentRun.create({
      data: {
        tenantId: context.tenantId,
        sourceMessageId: context.sourceMessageId,
        agentName: result.run.agentName,
        modelAlias: result.run.modelAlias,
        input: context,
        output: result.analysis,
        durationMs: result.run.durationMs,
        success: true
      }
    });
    created.agentRunId = agentRun.id;

    if (canCreateTask && result.analysis.task) {
      const task = await prisma.task.create({
        data: {
          tenantId: context.tenantId,
          propertyId: context.property?.id,
          reservationId: context.reservation?.id,
          sourceMessageId: context.sourceMessageId,
          title: result.analysis.task.title,
          description: result.analysis.task.description,
          category: mapTaskCategory(result.analysis.task.category),
          priority: mapTaskPriority(result.analysis.task.priority),
          riskLevel: result.analysis.riskLevel,
          assigneeType: result.analysis.task.assigneeType,
          slaMinutes: result.analysis.task.slaMinutes,
          confidence: result.analysis.confidence,
          aiReason: result.analysis.riskReasons.join(" | "),
          status: "SUGGESTED"
        }
      });
      created.taskId = task.id;
    }

    if (requiresApproval) {
      const approval = await prisma.approvalItem.create({
        data: {
          tenantId: context.tenantId,
          sourceMessageId: context.sourceMessageId,
          type: "guest_reply",
          riskLevel: result.analysis.riskLevel,
          draft: result.analysis.guestReplyDraft,
          reason: result.analysis.riskReasons.join(" | ") || "Agent risk gate requires human approval"
        }
      });
      created.approvalId = approval.id;
    }
  }

  return {
    analysis: result.analysis,
    decisions: {
      canAutoCreateTask: canCreateTask,
      requiresHumanApproval: requiresApproval
    },
    created
  };
}
