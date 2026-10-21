CREATE TABLE "StaffAccountRecovery" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "issuedByUserId" INTEGER NOT NULL,
    "membershipId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "issuedSessionVersion" INTEGER NOT NULL,
    "issuedRole" "MembershipRole" NOT NULL,
    "resetMfa" BOOLEAN NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "mfaSecretEncrypted" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StaffAccountRecovery_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "StaffAccountRecovery_version_check" CHECK ("issuedSessionVersion" >= 0),
    CONSTRAINT "StaffAccountRecovery_digest_check" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "StaffAccountRecovery_ttl_check" CHECK ("expiresAt" > "createdAt" AND "expiresAt" <= "createdAt" + INTERVAL '15 minutes'),
    CONSTRAINT "StaffAccountRecovery_terminal_check" CHECK (NOT ("consumedAt" IS NOT NULL AND "revokedAt" IS NOT NULL))
);
CREATE UNIQUE INDEX "StaffAccountRecovery_tokenHash_key" ON "StaffAccountRecovery"("tokenHash");
CREATE INDEX "StaffAccountRecovery_userId_createdAt_idx" ON "StaffAccountRecovery"("userId", "createdAt");
CREATE INDEX "StaffAccountRecovery_membershipId_createdAt_idx" ON "StaffAccountRecovery"("membershipId", "createdAt");
CREATE INDEX "StaffAccountRecovery_expiresAt_idx" ON "StaffAccountRecovery"("expiresAt");
ALTER TABLE "StaffAccountRecovery" ADD CONSTRAINT "StaffAccountRecovery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StaffAccountRecovery" ADD CONSTRAINT "StaffAccountRecovery_issuedByUserId_fkey" FOREIGN KEY ("issuedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StaffAccountRecovery" ADD CONSTRAINT "StaffAccountRecovery_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StaffAccountRecovery" ADD CONSTRAINT "StaffAccountRecovery_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
