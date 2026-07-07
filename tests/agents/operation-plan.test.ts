import { describe, expect, it } from "vitest";
import { createOperationPlan } from "@/lib/agents/operation-plan";
import type { AgentAnalysis, GuestMessageContext } from "@/lib/ai/types";

const context: GuestMessageContext = {
  tenantId: "tenant-1",
  conversationId: "conversation-1",
  sourceMessageId: "message-1",
  message: "Kapı şifresi çalışmıyor, dışarıda kaldık.",
  property: { id: "property-1", name: "Galata Loft" },
  reservation: { id: "reservation-1" },
  recentMessages: []
};

function analysis(overrides: Partial<AgentAnalysis> = {}): AgentAnalysis {
  return {
    language: "tr",
    intent: "check_in_issue",
    sentiment: "negative",
    riskLevel: "HIGH",
    riskReasons: ["Guest is locked outside."],
    taskRequired: true,
    task: {
      title: "Kapı şifresi acil kontrol",
      description: "Misafir kapı şifresinin çalışmadığını belirtti.",
      category: "CHECK_IN",
      priority: "URGENT",
      assigneeType: "operations",
      slaMinutes: 30
    },
    guestReplyDraft: "Merhaba, hemen yardımcı oluyoruz.",
    requiresHumanApproval: true,
    confidence: 0.88,
    dedupeKey: "property-1:check-in:door-code",
    reportTags: ["check-in", "door-code"],
    ...overrides
  };
}

describe("operation plan", () => {
  it("creates a human-only plan for high-risk messages", () => {
    const plan = createOperationPlan(context, analysis());

    expect(plan.automationMode).toBe("human_only");
    expect(plan.steps.some((step) => step.tool === "create_approval_item")).toBe(true);
    expect(plan.steps.some((step) => step.tool === "notify_operations_team")).toBe(true);
  });

  it("allows controlled automation for low-risk high-confidence tasks", () => {
    const plan = createOperationPlan(
      context,
      analysis({
        intent: "wifi_question",
        riskLevel: "LOW",
        riskReasons: [],
        requiresHumanApproval: false,
        task: {
          title: "Wi-Fi bilgisini paylaş",
          description: "Misafir Wi-Fi bilgisini sordu.",
          category: "WIFI",
          priority: "LOW",
          assigneeType: "operations",
          slaMinutes: 120
        }
      })
    );

    expect(plan.automationMode).toBe("controlled_automation");
    expect(plan.blockers).toHaveLength(0);
  });
});
