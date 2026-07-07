import type { GuestMessageContext, ReportMetrics } from "./types";

export function buildMessageAnalysisPrompt(context: GuestMessageContext) {
  return [
    "Analyze this short-term rental guest message for Lixus AI.",
    "The product serves Airbnb/Booking hosts. The model must not invent facts.",
    "Extract operational tasks and risk. Return only valid JSON.",
    "",
    "Rules:",
    "- If refund, payment, cancellation, legal threat, health, safety, discrimination, damage, or angry complaint exists, requiresHumanApproval must be true.",
    "- If a task is needed, create a concise task with category, priority, assigneeType, and SLA.",
    "- If information is missing, keep guestReplyDraft cautious and do not promise compensation or free services.",
    "- Use Turkish hospitality tone unless guest language is clearly different.",
    "- riskLevel must be LOW, MEDIUM, HIGH, or CRITICAL.",
    "- category must be one of CLEANING, MAINTENANCE, CHECK_IN, CHECK_OUT, SUPPLIES, WIFI, PAYMENT, REFUND, COMPLAINT, EMERGENCY, GENERAL.",
    "- priority must be LOW, MEDIUM, HIGH, or URGENT.",
    "",
    "Expected JSON shape:",
    JSON.stringify({
      language: "tr",
      intent: "maintenance_issue",
      sentiment: "negative",
      riskLevel: "HIGH",
      riskReasons: ["Guest impact is high"],
      taskRequired: true,
      task: {
        title: "Klima arızası kontrolü",
        description: "Misafir klimanın çalışmadığını belirtti.",
        category: "MAINTENANCE",
        priority: "URGENT",
        assigneeType: "maintenance",
        slaMinutes: 60,
        locationHint: "salon"
      },
      guestReplyDraft: "Merhaba, durumu hemen ekibimize iletiyoruz.",
      requiresHumanApproval: true,
      confidence: 0.86,
      dedupeKey: "property-id:maintenance:air-conditioner",
      reportTags: ["maintenance", "guest-impact"]
    }),
    "",
    "Context:",
    JSON.stringify(context)
  ].join("\n");
}

export function buildReportPrompt(metrics: ReportMetrics) {
  return [
    "Write a concise Turkish operations insight for Lixus AI reports.",
    "Audience: short-term rental operator/manager.",
    "Do not invent metrics. Mention the top operational risk and the best next action.",
    "Return JSON only: { \"insight\": string, \"actions\": string[] }",
    "",
    "Metrics:",
    JSON.stringify(metrics)
  ].join("\n");
}
