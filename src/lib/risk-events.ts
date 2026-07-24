import "server-only";

import { prisma } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db-errors";
import { reportError } from "@/lib/report-error";

// ---------------------------------------------------------------------------
// recordRiskEvent — the ONLY writer of RiskEvent rows (Codex #32).
//
// Contract:
//  * Called strictly AFTER the final deterministic code decision (gate verdict
//    or keyword escalation) — never from raw model output, never on dryRun.
//  * NEVER throws and never blocks/repeats delivery: a persist failure is
//    reported (reportError) and swallowed — analytics must not change
//    messaging semantics.
//  * Retry-idempotent at the DB level via @@unique([organizationId, surface,
//    triggerId, finalDecision]) — the duplicate hit is silently absorbed (targeted P2002
//    only; any other violation still gets reported).
//  * PII-FREE: CLOSED-SET clamps only — an unknown value becomes NULL, so no
//    guest text, name, phone, e-mail or prompt fragment can ever land here.
// ---------------------------------------------------------------------------

const SURFACES = new Set(["auto_reply", "alerts"]);
const DECISIONS = new Set(["auto_sent", "human_review"]);
const LEVELS = new Set(["none", "low", "medium", "high"]);
// CLOSED SETS, not sanitization: stripping separators from free text still
// leaks concatenated names/digits ("adalovelace555…"). A value either IS one
// of the known codes or it becomes NULL — guest text can never survive.
const REASONS = new Set(["escalated_to_human", "low_confidence_or_risky", "keyword_escalated", "gate_passed"]);
// Exported: the shadow layer (shadow-ai.ts) clamps the second model's riskType
// to the SAME closed set so the two columns stay directly comparable.
export const RISK_TYPES = new Set([
  "complaint", "money_refund", "cancellation", "human_request", "review_threat",
  "platform_policy", "safety_emergency", "discrimination", "rule_violation",
  "access_security", "prompt_injection",
]);

function clampTo(set: Set<string>, v: string | null | undefined): string | null {
  return v && set.has(v) ? v : null;
}

export interface RiskEventInput {
  organizationId: string;
  propertyId?: string | null;
  conversationId?: string | null;
  surface: "auto_reply" | "alerts";
  /** The inbound Message id that forced this decision. */
  triggerId: string;
  finalDecision: "auto_sent" | "human_review";
  /** null on the keyword path — there is no model verdict to report there. */
  riskLevel?: string | null;
  riskType?: string | null;
  reason?: string | null;
  confidence?: number | null;
}

export async function recordRiskEvent(e: RiskEventInput): Promise<void> {
  try {
    if (!SURFACES.has(e.surface) || !DECISIONS.has(e.finalDecision) || !e.triggerId) {
      await reportError("risk-event invalid input", new Error(`surface=${e.surface} decision=${e.finalDecision}`));
      return;
    }
    await prisma.riskEvent.create({
      data: {
        organizationId: e.organizationId,
        propertyId: e.propertyId ?? null,
        conversationId: e.conversationId ?? null,
        surface: e.surface,
        triggerId: e.triggerId,
        finalDecision: e.finalDecision,
        riskLevel: e.riskLevel && LEVELS.has(e.riskLevel) ? e.riskLevel : null,
        riskType: clampTo(RISK_TYPES, e.riskType),
        reason: clampTo(REASONS, e.reason),
        // In-range-or-NULL, never clamped: an out-of-range/NaN/Infinity value is
        // a bug signal — recording a fabricated valid-looking number would hide it.
        confidence:
          typeof e.confidence === "number" && Number.isFinite(e.confidence) && e.confidence >= 0 && e.confidence <= 1
            ? e.confidence
            : null,
      },
    });
  } catch (err) {
    if (isUniqueViolation(err, ["organizationId", "surface", "triggerId", "finalDecision"])) return; // retry dedupe (tenant-scoped)
    await reportError("risk-event persist", err).catch(() => {});
  }
}
