// ---------------------------------------------------------------------------
// İDDİA DENETÇİSİ — SAF ÇEKİRDEK (istem, şema, alıntı doğrulama). Ağ / sunucu bağımlılığı yok: hem ölçer (`claim-audit.ts`, OpenAI) hem
// Claude çalışma paketi (`scripts/claude-work/run.ts`, ikinci hakem) aynı istemi ve aynı kod doğrulamasını kullanır.
// ---------------------------------------------------------------------------

import type { Addressed, UxKbItem } from "./understanding-e2e-scoring";

export const CLAIM_RELATIONS = [
  "time", "fee", "free", "permission", "prohibition", "obligation", "duration", "advance_notice", "location", "method_steps",
  "contact", "availability", "quantity", "other",
] as const;
export const CLAIM_SUPPORT = ["supported", "misbound", "contradicted", "unsupported", "process"] as const;
export type ClaimSupport = (typeof CLAIM_SUPPORT)[number] | "unverified";

export interface AuditedClaim {
  requestId: string;
  text: string;
  subject: string;
  relation: string;
  value: string;
  condition: string;
  support: ClaimSupport;
  kbId: string | null;
  kbQuote: string;
  explanation: string;
}
export interface AuditResult {
  requests: { id: string; addressed: Addressed; explanation: string }[];
  claims: AuditedClaim[];
}

export const AUDIT_SCHEMA = {
  name: "reply_claim_audit",
  strict: true as const,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["requests", "claims"],
    properties: {
      requests: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "addressed", "explanation"],
          properties: {
            id: { type: "string" },
            addressed: { type: "string", enum: ["answered", "deferred", "absent"] },
            explanation: { type: "string" },
          },
        },
      },
      claims: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["request_id", "text", "subject", "relation", "value", "condition", "support", "kb_id", "kb_quote", "explanation"],
          properties: {
            request_id: { type: "string" },
            text: { type: "string" },
            subject: { type: "string" },
            relation: { type: "string", enum: [...CLAIM_RELATIONS] },
            value: { type: "string" },
            condition: { type: "string" },
            support: { type: "string", enum: [...CLAIM_SUPPORT] },
            kb_id: { type: ["string", "null"] },
            kb_quote: { type: "string" },
            explanation: { type: "string" },
          },
        },
      },
    },
  },
};

export const AUDIT_SYSTEM = [
  "You audit a reply that an AI assistant sent to a short-term-rental guest. You do NOT write replies. Return ONLY the JSON schema.",
  "Inputs: the property knowledge base (KB) items with ids, the conversation, the guest's requests (id + the exact part of the guest's text), and the REPLY.",
  "",
  "1) requests: for EACH listed request decide whether the REPLY answers it with substance:",
  "- answered: the reply gives the guest the information / permission / instruction they asked for (correct or not — correctness is judged in claims).",
  "- deferred: the reply only says it will be checked, that the host will answer, asks a clarifying question, or politely declines to answer.",
  "- absent: the reply does not touch the request at all.",
  "",
  "2) claims: split the REPLY into atomic factual claims (one subject + one relation + one value). Skip greetings, thanks and pure courtesy.",
  "For each claim give subject (the facility / service / item / person the claim is about), relation (time, fee, free, permission, prohibition, obligation, duration, advance_notice, location, method_steps, contact, availability, quantity, other), value, and condition (the condition or scope stated in the reply, '' if none).",
  "support:",
  "- supported: ONE KB sentence states the SAME subject with the SAME relation, the same value and a compatible condition / scope. Combining two KB items is allowed only if both are about the same subject and relation.",
  "- misbound: the value exists in the KB but belongs to a DIFFERENT subject, condition, guest group or relation (e.g. the gym's closing time given for the pool; 'notify 2 hours in advance' turned into 'you may use it for 2 hours'; a fee for one service given for another; a conditional permission stated as unconditional or applied to a guest who does not meet the condition).",
  "- contradicted: the KB states something incompatible (different value, opposite permission, free vs paid).",
  "- unsupported: nothing in the KB states it (invented, or general advice not in the KB).",
  "- process: a statement about the conversation itself, not a fact about the property (\"the host will get back to you\", \"we have noted your request\", \"I am checking\").",
  "kb_id + kb_quote: for supported / misbound / contradicted copy the KB sentence VERBATIM (exact characters) and its item id; otherwise kb_id null and kb_quote ''.",
  "request_id: the request the claim answers, or 'none'.",
  "Judge meaning, not word overlap: a sentence that shares words with the KB can still be misbound; a paraphrase with the same meaning is supported. Keep explanations to one short sentence.",
].join("\n");

export function buildAuditUser(input: {
  kb: readonly UxKbItem[];
  history: readonly { direction: "inbound" | "outbound"; body: string }[];
  message: string;
  requests: readonly { id: string; span: string }[];
  reply: string;
}): string {
  const kb = input.kb.map((k) => `[${k.id}] ${k.title}\n${k.content}`).join("\n\n");
  const conv = [...input.history.map((m) => `${m.direction === "inbound" ? "GUEST" : "HOST"}: ${m.body}`), `GUEST (latest): ${input.message}`].join("\n");
  const reqs = input.requests.map((r) => `- ${r.id}: "${r.span}"`).join("\n");
  return `KB ITEMS:\n${kb}\n\nCONVERSATION:\n${conv}\n\nREQUESTS:\n${reqs}\n\nREPLY:\n<<<\n${input.reply}\n>>>`;
}

/** Alıntı karşılaştırması: büyük/küçük harf, boşluk dizisi, tipografik tırnak / kesme farkı yok sayılır — başka hiçbir fark değil. */
export function normalizeQuote(s: string): string {
  return s
    .normalize("NFKC")
    .toLocaleLowerCase("tr")
    .replace(/[’‘`´]/g, "'")
    .replace(/[“”«»„]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?;:,]+$/u, "");
}

/** Alıntı gerçekten o kalemde mi (başlık + içerik). Boş alıntı hiçbir şeyi desteklemez. */
export function quoteInItem(kb: readonly UxKbItem[], id: string | null, quote: string): boolean {
  const q = normalizeQuote(quote);
  if (!id || q.length < 4) return false;
  const item = kb.find((k) => k.id === id);
  if (!item) return false;
  return normalizeQuote(`${item.title}\n${item.content}`).includes(q);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Model çıktısını doğrular; "supported" / "misbound" / "contradicted" iddianın alıntısı kalemde yoksa "unverified". */
export function parseAudit(raw: unknown, kb: readonly UxKbItem[], requestIds: readonly string[]): AuditResult | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as { requests?: unknown; claims?: unknown };
  if (!Array.isArray(o.requests) || !Array.isArray(o.claims)) return null;
  const requests = o.requests
    .map((r) => r as Record<string, unknown>)
    .filter((r) => requestIds.includes(str(r.id)) && ["answered", "deferred", "absent"].includes(str(r.addressed)))
    .map((r) => ({ id: str(r.id), addressed: str(r.addressed) as Addressed, explanation: str(r.explanation) }));
  const claims: AuditedClaim[] = o.claims.map((c0) => {
    const c = c0 as Record<string, unknown>;
    const support0 = (CLAIM_SUPPORT as readonly string[]).includes(str(c.support)) ? (str(c.support) as ClaimSupport) : "unsupported";
    const kbId = typeof c.kb_id === "string" ? c.kb_id : null;
    const quote = str(c.kb_quote);
    const needsQuote = support0 === "supported" || support0 === "misbound" || support0 === "contradicted";
    const support: ClaimSupport = needsQuote && !quoteInItem(kb, kbId, quote) ? (support0 === "supported" ? "unverified" : support0) : support0;
    return {
      requestId: str(c.request_id) || "none",
      text: str(c.text),
      subject: str(c.subject),
      relation: str(c.relation),
      value: str(c.value),
      condition: str(c.condition),
      support,
      kbId,
      kbQuote: quote,
      explanation: str(c.explanation),
    };
  });
  return { requests, claims };
}

/** Anlam hatası sayılan destek türleri (doğrulanmamış alıntı ayrı raporlanır, hata sayılmaz). */
export const MEANING_ERRORS: ReadonlySet<ClaimSupport> = new Set(["misbound", "contradicted", "unsupported"]);

