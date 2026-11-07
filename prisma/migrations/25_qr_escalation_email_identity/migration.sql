-- QR escalation e-mail hardening (Codex follow-up on #15): bind the dedupe
-- claim to the EVENT identity (triggering Message id) instead of a long
-- per-stay window, so a later, distinct safety/emergency incident always
-- produces an e-mail while the same event can never double-send. ADDITIVE
-- ONLY (nullable column): old deployments ignore it, boot cannot fail.
ALTER TABLE "Reservation" ADD COLUMN "qrEscalationEmailMessageId" TEXT;
