import { describe, expect, it } from "vitest";
import { createFallbackAnalysis, createFallbackReport } from "@/lib/ai/fallback-analysis";

describe("fallback guest message analysis", () => {
  it("routes refund messages to human approval", () => {
    const analysis = createFallbackAnalysis({
      tenantId: "tenant-1",
      message: "İptal etmek istiyorum, paramı geri verin.",
      recentMessages: []
    });

    expect(analysis.riskLevel).toBe("HIGH");
    expect(analysis.requiresHumanApproval).toBe(true);
    expect(analysis.task?.category).toBe("REFUND");
  });

  it("extracts maintenance tasks from urgent guest messages", () => {
    const analysis = createFallbackAnalysis({
      tenantId: "tenant-1",
      message: "Klima çalışmıyor, çocuk var ev çok sıcak.",
      property: { id: "property-1", name: "Galata Loft" },
      recentMessages: []
    });

    expect(analysis.taskRequired).toBe(true);
    expect(analysis.task?.category).toBe("MAINTENANCE");
    expect(analysis.task?.priority).toBe("URGENT");
    expect(analysis.confidence).toBeGreaterThanOrEqual(0.75);
  });
});

describe("fallback report writer", () => {
  it("creates a Turkish operations summary", () => {
    const insight = createFallbackReport({
      period: "2026-07 haftası",
      totalMessages: 25,
      totalTasks: 7,
      overdueTasks: 2,
      averageCloseMinutes: 180,
      riskConversationCount: 3,
      autoResolutionRate: 0.4,
      topCategories: [{ category: "MAINTENANCE", count: 4 }],
      propertyHotspots: [{ propertyName: "Galata Loft", issueCount: 3 }]
    });

    expect(insight).toContain("2026-07 haftası");
    expect(insight).toContain("Galata Loft");
  });
});
