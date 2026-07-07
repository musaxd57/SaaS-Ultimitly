import type { AgentAnalysis } from "./types";

const humanApprovalRiskLevels = new Set<AgentAnalysis["riskLevel"]>(["HIGH", "CRITICAL"]);
const blockedIntents = ["refund", "payment", "cancellation", "legal", "safety", "health", "damage"];

export function shouldRequireHumanApproval(analysis: AgentAnalysis) {
  if (analysis.requiresHumanApproval) {
    return true;
  }
  if (humanApprovalRiskLevels.has(analysis.riskLevel)) {
    return true;
  }
  const intent = analysis.intent.toLowerCase();
  return blockedIntents.some((blocked) => intent.includes(blocked));
}

export function canAutoCreateTask(analysis: AgentAnalysis) {
  return analysis.taskRequired && Boolean(analysis.task) && analysis.confidence >= 0.75;
}

export function canAutoSendGuestReply(analysis: AgentAnalysis) {
  return !shouldRequireHumanApproval(analysis) && analysis.riskLevel === "LOW" && analysis.confidence >= 0.85;
}
