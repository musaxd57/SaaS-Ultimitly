import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  operationPlanSchema,
  operationPlanStepSchema,
  type OperationPlan
} from "@/lib/agents/operation-plan";

const executionModeSchema = z.enum(["dry_run", "persist"]);
const taskCategories = [
  "CLEANING",
  "MAINTENANCE",
  "CHECK_IN",
  "CHECK_OUT",
  "SUPPLIES",
  "WIFI",
  "PAYMENT",
  "REFUND",
  "COMPLAINT",
  "EMERGENCY",
  "GENERAL"
] as const;
const taskPriorities = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
const riskLevels = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

export const operationExecutionRequestSchema = z.object({
  plan: operationPlanSchema,
  mode: executionModeSchema.default("dry_run"),
  tenantId: z.string(),
  agentRunId: z.string().optional()
});

export type OperationExecutionRequest = z.infer<typeof operationExecutionRequestSchema>;

export type ToolExecutionResult = {
  tool: z.infer<typeof operationPlanStepSchema>["tool"];
  title: string;
  status: "executed" | "queued_for_human" | "skipped";
  skipped: boolean;
  skipReason?: string;
  created?: {
    taskId?: string;
    approvalId?: string;
    eventId?: string;
    reportSignalId?: string;
    toolRunId?: string;
  };
};

export type OperationExecutionResult = {
  mode: "dry_run" | "persist";
  automationMode: OperationPlan["automationMode"];
  executedCount: number;
  queuedForHumanCount: number;
  skippedCount: number;
  results: ToolExecutionResult[];
};

function getString(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "string" ? value : undefined;
}

function getNumber(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "number" ? value : undefined;
}

function getEnumValue<const T extends readonly string[]>(
  payload: Record<string, unknown>,
  key: string,
  values: T,
  fallback: T[number]
): T[number] {
  const value = getString(payload, key);
  return values.includes(value ?? "") ? (value as T[number]) : fallback;
}

function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function isSafeToExecute(step: z.infer<typeof operationPlanStepSchema>) {
  return step.status === "safe_to_automate" || step.tool === "add_report_signal";
}

function hasPersistentExecutor(step: z.infer<typeof operationPlanStepSchema>) {
  return ["create_task_suggestion", "create_approval_item", "notify_operations_team", "add_report_signal"].includes(
    step.tool
  );
}

function resultForSkipped(step: z.infer<typeof operationPlanStepSchema>, skipReason: string): ToolExecutionResult {
  return {
    tool: step.tool,
    title: step.title,
    status: step.status === "requires_human" ? "queued_for_human" : "skipped",
    skipped: true,
    skipReason
  };
}

function resultForDryRun(step: z.infer<typeof operationPlanStepSchema>): ToolExecutionResult {
  if (step.status === "pending") {
    return resultForSkipped(step, "Dry run: pending step needs a connected executor.");
  }

  if (step.tool === "draft_guest_reply") {
    return {
      tool: step.tool,
      title: step.title,
      status: "queued_for_human",
      skipped: false
    };
  }

  if (!hasPersistentExecutor(step)) {
    return resultForSkipped(step, "Dry run: this planned tool is not connected yet.");
  }

  return {
    tool: step.tool,
    title: step.title,
    status: step.status === "requires_human" ? "queued_for_human" : "executed",
    skipped: false
  };
}

async function persistToolRun(
  request: OperationExecutionRequest,
  step: z.infer<typeof operationPlanStepSchema>,
  result: ToolExecutionResult
) {
  const toolRun = await prisma.agentToolRun.create({
    data: {
      tenantId: request.tenantId,
      agentRunId: request.agentRunId,
      tool: step.tool,
      title: step.title,
      status: result.status,
      payload: toPrismaJson(step.payload),
      result: toPrismaJson(result.created ?? {}),
      skipped: result.skipped,
      skipReason: result.skipReason
    }
  });

  return {
    ...result,
    created: {
      ...result.created,
      toolRunId: toolRun.id
    }
  };
}

async function createGuestReplyApproval(
  request: OperationExecutionRequest,
  step: z.infer<typeof operationPlanStepSchema>,
  reason: string
): Promise<ToolExecutionResult> {
  const payload = step.payload;
  const approval = await prisma.approvalItem.create({
    data: {
      tenantId: request.tenantId,
      sourceMessageId: getString(payload, "sourceMessageId") ?? request.plan.sourceMessageId,
      type: "guest_reply",
      riskLevel: getEnumValue(payload, "riskLevel", riskLevels, request.plan.riskLevel === "CRITICAL" ? "CRITICAL" : "HIGH"),
      draft: getString(payload, "draft") ?? "",
      reason
    }
  });

  return {
    tool: step.tool,
    title: step.title,
    status: "queued_for_human",
    skipped: false,
    created: { approvalId: approval.id }
  };
}

async function executePersistedStep(
  request: OperationExecutionRequest,
  step: z.infer<typeof operationPlanStepSchema>
): Promise<ToolExecutionResult> {
  const payload = step.payload;

  if (step.status === "requires_human") {
    return createGuestReplyApproval(
      request,
      step,
      Array.isArray(payload.reasons)
        ? payload.reasons.filter((item) => typeof item === "string").join(" | ")
        : "Agent operation plan requires human approval"
    );
  }

  if (!isSafeToExecute(step)) {
    return resultForSkipped(step, "Step is pending and has no safe automatic executor yet.");
  }

  if (step.tool === "draft_guest_reply") {
    return createGuestReplyApproval(
      request,
      step,
      "Guest reply draft is queued until outbound inbox sending is connected."
    );
  }

  if (step.tool === "create_task_suggestion") {
    const task = await prisma.task.create({
      data: {
        tenantId: request.tenantId,
        propertyId: getString(payload, "propertyId"),
        reservationId: getString(payload, "reservationId"),
        sourceMessageId: getString(payload, "sourceMessageId"),
        title: getString(payload, "title") ?? step.title,
        description: getString(payload, "description") ?? step.reason,
        category: getEnumValue(payload, "category", taskCategories, "GENERAL"),
        priority: getEnumValue(payload, "priority", taskPriorities, "MEDIUM"),
        riskLevel: getEnumValue(payload, "riskLevel", riskLevels, "LOW"),
        assigneeType: getString(payload, "assigneeType"),
        slaMinutes: getNumber(payload, "slaMinutes"),
        confidence: getNumber(payload, "confidence"),
        aiReason: step.reason,
        status: "SUGGESTED"
      }
    });

    return {
      tool: step.tool,
      title: step.title,
      status: "executed",
      skipped: false,
      created: { taskId: task.id }
    };
  }

  if (step.tool === "notify_operations_team") {
    const event = await prisma.operationEvent.create({
      data: {
        tenantId: request.tenantId,
        type: "operations_alert",
        severity: getEnumValue(payload, "riskLevel", riskLevels, "HIGH"),
        title: step.title,
        body: getString(payload, "message") ?? step.reason,
        metadata: toPrismaJson(payload)
      }
    });

    return {
      tool: step.tool,
      title: step.title,
      status: "executed",
      skipped: false,
      created: { eventId: event.id }
    };
  }

  if (step.tool === "add_report_signal") {
    const signal = await prisma.reportSignal.create({
      data: {
        tenantId: request.tenantId,
        propertyId: getString(payload, "propertyId"),
        category: getString(payload, "category") ?? "GENERAL",
        riskLevel: getEnumValue(payload, "riskLevel", riskLevels, "LOW"),
        tags: toPrismaJson(Array.isArray(payload.tags) ? payload.tags : []),
        source: "operation_plan"
      }
    });

    return {
      tool: step.tool,
      title: step.title,
      status: "executed",
      skipped: false,
      created: { reportSignalId: signal.id }
    };
  }

  return resultForSkipped(step, "This tool is planned but not connected to a persistent executor yet.");
}

export async function executeOperationPlan(input: OperationExecutionRequest): Promise<OperationExecutionResult> {
  const request = operationExecutionRequestSchema.parse(input);
  const results: ToolExecutionResult[] = [];

  for (const step of request.plan.steps) {
    const result = request.mode === "dry_run" ? resultForDryRun(step) : await executePersistedStep(request, step);

    results.push(request.mode === "persist" ? await persistToolRun(request, step, result) : result);
  }

  return {
    mode: request.mode,
    automationMode: request.plan.automationMode,
    executedCount: results.filter((result) => result.status === "executed" && !result.skipped).length,
    queuedForHumanCount: results.filter((result) => result.status === "queued_for_human").length,
    skippedCount: results.filter((result) => result.skipped).length,
    results
  };
}
