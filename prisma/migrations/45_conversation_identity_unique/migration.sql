-- CreateIndex
CREATE UNIQUE INDEX "Conversation_propertyId_externalReservationId_key" ON "Conversation"("propertyId", "externalReservationId");

