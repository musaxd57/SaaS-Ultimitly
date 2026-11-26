-- Task.origin: manual (host) | system (reservation lifecycle) | ai (message-driven).
-- Cancellation cleanup will delete ONLY origin='system'. DB default 'manual' is
-- the FAIL-SAFE direction: an unclassifiable row is protected from auto-deletion
-- (mislabeling system→manual leaves a stale task behind; manual→system would
-- DELETE a host's own work — asymmetric costs, so unknown ⇒ manual).
ALTER TABLE "Task" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'manual';

-- Backfill by RELIABLE signals only (order matters: strongest signal first,
-- later updates never overwrite an earlier classification).
-- 1) Message-driven smart tasks carry sourceMessageId/dedupeKey — certain.
UPDATE "Task" SET "origin" = 'ai'
WHERE "sourceMessageId" IS NOT NULL OR "dedupeKey" IS NOT NULL;

-- 2) Legacy complaint tasks: fixed generated shape from the alert path.
UPDATE "Task" SET "origin" = 'ai'
WHERE "origin" = 'manual' AND "type" = 'maintenance' AND "title" LIKE 'Şikayet: %';

-- 3) Reservation-lifecycle tasks: generated titles have a fixed pattern
--    (guest name varies, suffix/prefix does not — survives anonymization).
UPDATE "Task" SET "origin" = 'system'
WHERE "origin" = 'manual' AND "reservationId" IS NOT NULL
  AND "type" IN ('checkin_prep','cleaning')
  AND ("title" LIKE '% girişi için hazırlık' OR "title" LIKE 'Çıkış temizliği - %');
