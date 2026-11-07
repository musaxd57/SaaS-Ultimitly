-- verify-email looks a user up by token hash on every emailed-link click;
-- plain (non-unique) index — uniqueness is not the contract, speed is.
CREATE INDEX "User_emailVerifyTokenHash_idx" ON "User"("emailVerifyTokenHash");
