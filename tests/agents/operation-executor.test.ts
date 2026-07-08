import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeOperationPlan } from "@/lib/agents/operation-executor";
import type { OperationPlan } from "@/lib/agents/operation-plan";

const db = vi.hoisted(() => ({
  approvalItemCreate: vi.fn(),
  agentToolRunCreate: vi.fn(),
  operationEventCreate: vi.fn(),
  reportSignalCreate: vi.fn(),
  taskCreate: vi.fn()
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    approvalItem: { create: db.approvalItemCreate },
    agentToolRun: { create: db.agentToolRunCreate },
    operationEvent: { create: db.operationEventCreate },
    reportSignal: { create: db.reportSignalCreate },
    task: { create: db.taskCreate }
  }
}));

function plan(overrides: Partial<OperationPlan> = {}): OperationPlan {
  return {
    sourceMessageId: "message-1",
    riskLevel: "HIGH",
    automationMode: "human_only",
    summary: "High-risk guest issue needs controlled execution.",
    blockers: ["Risk gate requires human approval before guest-facing action."],
    steps: [
      {
        tool: "create_task_suggestion",
        title: "Door code urgent check",
        reason: "Guest is locked outside.",
        status: "safe_to_automate",
        payload: {
          sourceMessageId: "message-1",
          propertyId: "property-1",
          reservationId: "reservation-1",
          title: "Door code urgent check",
          description: "Guest cannot enter the property.",
          category: "CHECK_IN",
          priority: "URGENT",
          riskLevel: "HIGH",
          confidence: 0.91
        }
      },
      {
        tool: "create_approval_item",
        title: "Queue guest reply for approval",
        reason: "Guest-facing reply needs review.",
        status: "requires_human",
        payload: {
          sourceMessageId: "message-1",
          draft: "We are checking this immediately.",
          riskLevel: "HIGH",
          reasons: ["Guest is locked outside."]
        }
      },
      {
        tool: "notify_operations_team",
        title: "Alert operations team",
        reason: "High-risk guest issue should be visible immediately.",
        status: "safe_to_automate",
        payload: {
          riskLevel: "HIGH",
          message: "Guest is locked outside."
        }
      },
      {
        tool: "add_report_signal",
        title: "Add report signal",
        reason: "Track recurring check-in issues.",
        status: "safe_to_automate",
        payload: {
          propertyId: "property-1",
          category: "CHECK_IN",
          riskLevel: "HIGH",
          tags: ["check-in", "door-code"]
        }
      }
    ],
    ...overrides
  };
}

describe("operation executor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.taskCreate.mockResolvedValue({ id: "task-1" });
    db.approvalItemCreate.mockResolvedValue({ id: "approval-1" });
    db.operationEventCreate.mockResolvedValue({ id: "event-1" });
    db.reportSignalCreate.mockResolvedValue({ id: "signal-1" });
    db.agentToolRunCreate
      .mockResolvedValueOnce({ id: "tool-run-1" })
      .mockResolvedValueOnce({ id: "tool-run-2" })
      .mockResolvedValueOnce({ id: "tool-run-3" })
      .mockResolvedValueOnce({ id: "tool-run-4" });
  });

  it("dry-runs a plan without creating database records", async () => {
    const result = await executeOperationPlan({
      tenantId: "tenant-1",
      mode: "dry_run",
      plan: plan()
    });

    expect(result.executedCount).toBe(3);
    expect(result.queuedForHumanCount).toBe(1);
    expect(db.taskCreate).not.toHaveBeenCalled();
    expect(db.agentToolRunCreate).not.toHaveBeenCalled();
  });

  it("persists safe internal actions and queues human approvals", async () => {
    const result = await executeOperationPlan({
      tenantId: "tenant-1",
      agentRunId: "run-1",
      mode: "persist",
      plan: plan()
    });

    expect(result.executedCount).toBe(3);
    expect(result.queuedForHumanCount).toBe(1);
    expect(db.taskCreate).toHaveBeenCalledOnce();
    expect(db.approvalItemCreate).toHaveBeenCalledOnce();
    expect(db.operationEventCreate).toHaveBeenCalledOnce();
    expect(db.reportSignalCreate).toHaveBeenCalledOnce();
    expect(db.agentToolRunCreate).toHaveBeenCalledTimes(4);
    expect(db.taskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          category: "CHECK_IN",
          priority: "URGENT",
          riskLevel: "HIGH"
        })
      })
    );
  });

  it("queues safe guest reply drafts instead of sending them without an inbox connector", async () => {
    db.agentToolRunCreate.mockReset();
    db.agentToolRunCreate.mockResolvedValueOnce({ id: "tool-run-guest-reply" });

    const result = await executeOperationPlan({
      tenantId: "tenant-1",
      mode: "persist",
      plan: plan({
        automationMode: "controlled_automation",
        riskLevel: "LOW",
        blockers: [],
        steps: [
          {
            tool: "draft_guest_reply",
            title: "Prepare low-risk guest reply",
            reason: "Guest only needs operational acknowledgement.",
            status: "safe_to_automate",
            payload: {
              sourceMessageId: "message-1",
              draft: "We received your message and are checking this.",
              riskLevel: "LOW"
            }
          }
        ]
      })
    });

    expect(result.executedCount).toBe(0);
    expect(result.queuedForHumanCount).toBe(1);
    expect(db.approvalItemCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "guest_reply",
          riskLevel: "LOW",
          draft: "We received your message and are checking this."
        })
      })
    );
  });
});
