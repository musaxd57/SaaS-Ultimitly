import { describe, expect, it } from "vitest";
import { canAutoCreateTask, canAutoSendGuestReply, shouldRequireHumanApproval } from "@/lib/ai/guardrails";
import type { AgentAnalysis } from "@/lib/ai/types";

function makeAnalysis(overrides: Partial<AgentAnalysis> = {}): AgentAnalysis {
  return {
    language: "tr",
    intent: "general_guest_question",
    sentiment: "neutral",
    riskLevel: "LOW",
    riskReasons: [],
    taskRequired: true,
    task: {
      title: "Wi-Fi bilgisi kontrolü",
      description: "Misafir Wi-Fi bilgisini sordu.",
      category: "WIFI",
      priority: "LOW",
      assigneeType: "operations",
      slaMinutes: 120
    },
    guestReplyDraft: "Merhaba, Wi-Fi bilgilerini hemen paylaşıyoruz.",
    requiresHumanApproval: false,
    confidence: 0.9,
    reportTags: ["wifi"],
    ...overrides
  };
}

describe("agent guardrails", () => {
  it("allows high confidence low risk task suggestions", () => {
    const analysis = makeAnalysis();

    expect(canAutoCreateTask(analysis)).toBe(true);
    expect(canAutoSendGuestReply(analysis)).toBe(true);
  });

  it("blocks high risk guest replies", () => {
    const analysis = makeAnalysis({
      intent: "refund_request",
      riskLevel: "HIGH",
      requiresHumanApproval: true
    });

    expect(shouldRequireHumanApproval(analysis)).toBe(true);
    expect(canAutoSendGuestReply(analysis)).toBe(false);
  });

  it("does not create low confidence tasks automatically", () => {
    const analysis = makeAnalysis({ confidence: 0.51 });

    expect(canAutoCreateTask(analysis)).toBe(false);
  });
});
