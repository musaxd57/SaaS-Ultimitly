import type { AgentAnalysis, GuestMessageContext, ReportMetrics } from "./types";

const urgentKeywords = [
  "kapı açılmıyor",
  "şifre çalışmıyor",
  "yangın",
  "polis",
  "güvenlik",
  "tehlike",
  "su bastı",
  "elektrik yok",
  "sıcak su yok",
  "çocuk var"
];

const refundKeywords = ["iade", "paramı", "iptal", "ücret", "para", "refund", "cancel"];
const complaintKeywords = ["şikayet", "rezalet", "pis", "kirli", "kötü", "berbat", "complaint"];
const maintenanceKeywords = ["klima", "sıcak su", "kombi", "bozuk", "çalışmıyor", "tamir", "arıza"];
const cleaningKeywords = ["temiz", "kirli", "havlu", "çarşaf", "çöp", "koku"];

function containsAny(text: string, keywords: string[]) {
  return keywords.some((keyword) => text.includes(keyword));
}

export function createFallbackAnalysis(context: GuestMessageContext): AgentAnalysis {
  const message = context.message.toLocaleLowerCase("tr-TR");
  const isRefund = containsAny(message, refundKeywords);
  const isComplaint = containsAny(message, complaintKeywords);
  const isUrgent = containsAny(message, urgentKeywords);
  const isMaintenance = containsAny(message, maintenanceKeywords);
  const isCleaning = containsAny(message, cleaningKeywords);

  const riskLevel: AgentAnalysis["riskLevel"] =
    isUrgent || isRefund ? "HIGH" : isComplaint ? "MEDIUM" : "LOW";
  const category: NonNullable<AgentAnalysis["task"]>["category"] = isRefund
    ? "REFUND"
    : isCleaning
      ? "CLEANING"
      : isMaintenance
        ? "MAINTENANCE"
        : message.includes("wifi") || message.includes("wi-fi")
          ? "WIFI"
          : "GENERAL";
  const priority: NonNullable<AgentAnalysis["task"]>["priority"] =
    riskLevel === "HIGH" ? "URGENT" : riskLevel === "MEDIUM" ? "HIGH" : "MEDIUM";
  const taskRequired = category !== "GENERAL" || isComplaint || isUrgent;
  const title =
    category === "MAINTENANCE"
      ? "Misafir bakım sorunu bildirdi"
      : category === "CLEANING"
        ? "Misafir temizlik/eksik eşya sorunu bildirdi"
        : category === "REFUND"
          ? "Misafir ödeme/iade konusu açtı"
          : "Misafir mesajı operasyon takibi";

  return {
    language: "tr",
    intent: taskRequired ? "operation_request" : "general_guest_question",
    sentiment: isComplaint || isRefund ? "negative" : "neutral",
    riskLevel,
    riskReasons: [
      ...(isUrgent ? ["Acil operasyon veya güvenlik etkisi olabilir."] : []),
      ...(isRefund ? ["Para/iade/iptal konusu insan onayı gerektirir."] : []),
      ...(isComplaint ? ["Misafir memnuniyet riski var."] : [])
    ],
    taskRequired,
    task: taskRequired
      ? {
          title,
          description: context.message,
          category,
          priority,
          assigneeType:
            category === "CLEANING" ? "cleaning" : category === "MAINTENANCE" ? "maintenance" : "manager",
          slaMinutes: priority === "URGENT" ? 60 : priority === "HIGH" ? 180 : 720
        }
      : null,
    guestReplyDraft:
      riskLevel === "HIGH"
        ? "Merhaba, durumu hemen ekibimize iletiyoruz. Kısa süre içinde sizi bilgilendireceğiz."
        : "Merhaba, mesajınızı aldık. Gerekli kontrolü sağlayıp size en kısa sürede dönüş yapacağız.",
    requiresHumanApproval: riskLevel === "HIGH" || isRefund,
    confidence: taskRequired ? 0.78 : 0.62,
    dedupeKey: `${context.property?.id ?? "property"}:${category}:${title}`.toLowerCase(),
    reportTags: [category.toLowerCase(), riskLevel.toLowerCase()]
  };
}

export function createFallbackReport(metrics: ReportMetrics) {
  const topCategory = metrics.topCategories[0]?.category ?? "genel operasyon";
  const hotspot = metrics.propertyHotspots[0]?.propertyName;
  return [
    `${metrics.period} döneminde ${metrics.totalMessages} mesaj ve ${metrics.totalTasks} görev işlendi.`,
    `En yoğun konu ${topCategory} kategorisinde görünüyor.`,
    metrics.overdueTasks > 0
      ? `${metrics.overdueTasks} görev SLA dışına taşmış; operasyon ekibinin önceliklendirmesi gerekir.`
      : "SLA ihlali görünmüyor; operasyon ritmi sağlıklı.",
    hotspot ? `${hotspot} mülkünde tekrar eden sorun sinyali var.` : "Belirgin mülk yoğunlaşması yok."
  ].join(" ");
}
