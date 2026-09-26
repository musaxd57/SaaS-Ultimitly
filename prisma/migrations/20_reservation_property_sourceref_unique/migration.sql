-- One feed/provider reference = one reservation row per property. Prod was
-- cleaned first (114 pairs merged: children re-pointed, fields coalesced,
-- verified 0 remaining). Replaces the plain composite index.
DROP INDEX "Reservation_propertyId_sourceReference_idx";
CREATE UNIQUE INDEX "Reservation_propertyId_sourceReference_key" ON "Reservation"("propertyId", "sourceReference");
