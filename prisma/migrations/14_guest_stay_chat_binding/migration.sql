-- Per-stay QR concierge device binding (fixes the fixed-physical-QR history leak).
--   • Reservation.chatBoundHash — TEXT NULL. sha256(hex) of the httpOnly per-stay
--     secret held by the FIRST device to open the chat this stay. Any other device
--     scanning the same fixed physical QR gets no history, so a past guest / cleaner
--     with the QR photo can't read the current guest's chat. Rotates per stay
--     (each reservation starts NULL → rebinds fresh).
--   • Reservation.chatBoundAt — TIMESTAMP NULL. When the stay's chat was first claimed.
-- Both are nullable ADD COLUMN on the populated Reservation table (no default) →
-- metadata-only, safe. Not PII (a hash + a timestamp), so the retention sweep
-- leaves them untouched.

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "chatBoundAt" TIMESTAMP(3),
ADD COLUMN     "chatBoundHash" TEXT;
