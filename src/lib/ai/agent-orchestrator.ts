import { modelAliases } from "./model-aliases";
import { litellmClient } from "./litellm-client";
import { buildMessageAnalysisPrompt, buildReportPrompt } from "./prompts";
import { createFallbackAnalysis, createFallbackReport } from "./fallback-analysis";
import {
  agentAnalysisSchema,
  guestMessageContextSchema,
  reportMetricsSchema,
  type AgentAnalysis,
  type GuestMessageContext,
  type ReportMetrics
} from "./types";

type AgentRunMeta = {
  agentName: string;
  modelAlias: string;
  durationMs: number;
  usedFallback: boolean;
};

type AnalyzeGuestMessageResult = {
  analysis: AgentAnalysis;
  run: AgentRunMeta;
};

type ReportResult = {
  insight: string;
  actions: string[];
  run: AgentRunMeta;
};

function parseJsonObject(content: string) {
  try {
    return JSON.parse(content);
  } catch {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Model response did not include a JSON object");
    }
    return JSON.parse(jsonMatch[0]);
  }
}

export class AgentOrchestrator {
  async analyzeGuestMessage(input: GuestMessageContext): Promise<AnalyzeGuestMessageResult> {
    const context = guestMessageContextSchema.parse(input);
    const startedAt = Date.now();

    try {
      const result = await litellmClient.chat({
        model: modelAliases.taskExtractor,
        temperature: 0.05,
        messages: [
          {
            role: "system",
            content: "You are Lixus AI's hospitality operations agent. Return only strict JSON."
          },
          {
            role: "user",
            content: buildMessageAnalysisPrompt(context)
          }
        ]
      });
      const analysis = agentAnalysisSchema.parse(parseJsonObject(result.content));

      return {
        analysis,
        run: {
          agentName: "guest_message_operations_agent",
          modelAlias: modelAliases.taskExtractor,
          durationMs: result.durationMs,
          usedFallback: false
        }
      };
    } catch {
      return {
        analysis: createFallbackAnalysis(context),
        run: {
          agentName: "guest_message_operations_agent",
          modelAlias: "local_fallback",
          durationMs: Date.now() - startedAt,
          usedFallback: true
        }
      };
    }
  }

  async writeReportInsight(input: ReportMetrics): Promise<ReportResult> {
    const metrics = reportMetricsSchema.parse(input);
    const startedAt = Date.now();

    try {
      const result = await litellmClient.chat({
        model: modelAliases.reportWriter,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: "You are Lixus AI's operations reporting agent. Return only strict JSON."
          },
          {
            role: "user",
            content: buildReportPrompt(metrics)
          }
        ]
      });
      const parsed = parseJsonObject(result.content) as { insight?: unknown; actions?: unknown };

      return {
        insight: typeof parsed.insight === "string" ? parsed.insight : createFallbackReport(metrics),
        actions: Array.isArray(parsed.actions) ? parsed.actions.filter((item) => typeof item === "string") : [],
        run: {
          agentName: "operations_report_agent",
          modelAlias: modelAliases.reportWriter,
          durationMs: result.durationMs,
          usedFallback: false
        }
      };
    } catch {
      return {
        insight: createFallbackReport(metrics),
        actions: [
          "Geciken görevleri yöneticinin öncelik listesine taşı.",
          "En yoğun kategori için mülk bazlı tekrar analizi yap."
        ],
        run: {
          agentName: "operations_report_agent",
          modelAlias: "local_fallback",
          durationMs: Date.now() - startedAt,
          usedFallback: true
        }
      };
    }
  }
}

export const agentOrchestrator = new AgentOrchestrator();
