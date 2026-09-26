-- One provider subscription binds to exactly ONE org. Prod preflight verified
-- zero duplicates before this ships. NULL providerRef (trial/manual) distinct.
CREATE UNIQUE INDEX "Subscription_provider_providerRef_key" ON "Subscription"("provider", "providerRef");
