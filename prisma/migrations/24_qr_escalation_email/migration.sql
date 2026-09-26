-- FAZ 3 (Codex #15): QR concierge escalation e-mail — per-stay claim/dedupe
-- anchor. ADDITIVE ONLY (nullable column, no default needed): old deployments
-- ignore it, populated rows read NULL ("never e-mailed"), boot cannot fail.
-- The feature itself is env-gated (QR_ESCALATION_EMAIL_ENABLED, default OFF).
ALTER TABLE "Reservation" ADD COLUMN "qrEscalationEmailAt" TIMESTAMP(3);
