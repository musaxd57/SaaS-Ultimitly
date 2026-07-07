export const modelAliases = {
  messageTriage: process.env.LIXUS_MODEL_MESSAGE_TRIAGE ?? "message_triage",
  taskExtractor: process.env.LIXUS_MODEL_TASK_EXTRACTOR ?? "task_extractor",
  guestReplyDraft: process.env.LIXUS_MODEL_GUEST_REPLY_DRAFT ?? "guest_reply_draft",
  riskReview: process.env.LIXUS_MODEL_RISK_REVIEW ?? "risk_review",
  reportWriter: process.env.LIXUS_MODEL_REPORT_WRITER ?? "report_writer"
} as const;

export type ModelAlias = (typeof modelAliases)[keyof typeof modelAliases];
