import { beforeEach, describe, expect, it, vi } from "vitest";
import { decideApproval } from "@/lib/agents/approval-workflow";

const db = vi.hoisted(() => ({
  approvalItemFindFirst: vi.fn(),
  approvalItemUpdate: vi.fn(),
  operationEventCreate: vi.fn()
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    approvalItem: {
      findFirst: db.approvalItemFindFirst,
      update: db.approvalItemUpdate
    },
    operationEvent: {
      create: db.operationEventCreate
    }
  }
}));

describe("approval workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.approvalItemFindFirst.mockResolvedValue({
      id: "approval-1",
      tenantId: "tenant-1",
      sourceMessageId: "message-1",
      status: "PENDING",
      riskLevel: "HIGH",
      draft: "We are checking this immediately."
    });
    db.approvalItemUpdate.mockResolvedValue({
      id: "approval-1",
      sourceMessageId: "message-1",
      status: "EDITED",
      riskLevel: "HIGH",
      draft: "We are checking this immediately.",
      editedDraft: "We are checking this now and will update you shortly."
    });
    db.operationEventCreate.mockResolvedValue({ id: "event-1" });
  });

  it("records an edited approval but keeps outbound guest send blocked", async () => {
    const result = await decideApproval({
      tenantId: "tenant-1",
      approvalId: "approval-1",
      decision: "edit",
      reviewerId: "manager-1",
      editedDraft: "We are checking this now and will update you shortly.",
      reason: "Tone adjusted before guest reply."
    });

    expect(result.status).toBe("EDITED");
    expect(result.outbound.status).toBe("blocked");
    expect(result.outbound.draft).toBe("We are checking this now and will update you shortly.");
    expect(db.approvalItemUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "approval-1" },
        data: expect.objectContaining({
          status: "EDITED",
          editedDraft: "We are checking this now and will update you shortly.",
          reviewerId: "manager-1"
        })
      })
    );
    expect(db.operationEventCreate).toHaveBeenCalledOnce();
  });

  it("rejects non-pending approvals", async () => {
    db.approvalItemFindFirst.mockResolvedValueOnce({
      id: "approval-1",
      tenantId: "tenant-1",
      status: "APPROVED",
      riskLevel: "LOW",
      draft: "Already handled."
    });

    await expect(
      decideApproval({
        tenantId: "tenant-1",
        approvalId: "approval-1",
        decision: "approve"
      })
    ).rejects.toThrow("Approval item is already APPROVED.");
  });
});
