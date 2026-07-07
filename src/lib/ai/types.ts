import { z } from "zod";

export const riskLevels = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export const taskCategories = [
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
export const taskPriorities = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

export const guestMessageContextSchema = z.object({
  tenantId: z.string(),
  conversationId: z.string().optional(),
  sourceMessageId: z.string().optional(),
  message: z.string().min(1),
  channel: z.string().optional(),
  guest: z
    .object({
      name: z.string().optional(),
      language: z.string().optional()
    })
    .optional(),
  property: z
    .object({
      id: z.string().optional(),
      name: z.string().optional(),
      city: z.string().optional(),
      houseRules: z.string().optional(),
      checkInGuide: z.string().optional(),
      wifiName: z.string().optional()
    })
    .optional(),
  reservation: z
    .object({
      id: z.string().optional(),
      checkIn: z.string().optional(),
      checkOut: z.string().optional(),
      status: z.string().optional()
    })
    .optional(),
  recentMessages: z
    .array(
      z.object({
        author: z.string(),
        body: z.string()
      })
    )
    .default([])
});

export type GuestMessageContext = z.infer<typeof guestMessageContextSchema>;

export const agentAnalysisSchema = z.object({
  language: z.string().default("tr"),
  intent: z.string(),
  sentiment: z.enum(["positive", "neutral", "negative", "angry"]).default("neutral"),
  riskLevel: z.enum(riskLevels),
  riskReasons: z.array(z.string()).default([]),
  taskRequired: z.boolean(),
  task: z
    .object({
      title: z.string(),
      description: z.string(),
      category: z.enum(taskCategories),
      priority: z.enum(taskPriorities),
      assigneeType: z.string().optional(),
      slaMinutes: z.number().int().positive().optional(),
      locationHint: z.string().optional()
    })
    .nullable(),
  guestReplyDraft: z.string(),
  requiresHumanApproval: z.boolean(),
  confidence: z.number().min(0).max(1),
  dedupeKey: z.string().optional(),
  reportTags: z.array(z.string()).default([])
});

export type AgentAnalysis = z.infer<typeof agentAnalysisSchema>;

export const reportMetricsSchema = z.object({
  period: z.string(),
  totalMessages: z.number().int().nonnegative(),
  totalTasks: z.number().int().nonnegative(),
  overdueTasks: z.number().int().nonnegative(),
  averageCloseMinutes: z.number().nonnegative().nullable(),
  riskConversationCount: z.number().int().nonnegative(),
  autoResolutionRate: z.number().min(0).max(1),
  topCategories: z.array(z.object({ category: z.string(), count: z.number().int().nonnegative() })),
  propertyHotspots: z.array(z.object({ propertyName: z.string(), issueCount: z.number().int().nonnegative() }))
});

export type ReportMetrics = z.infer<typeof reportMetricsSchema>;
