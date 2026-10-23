CREATE TABLE "PlatformOrganizationInvite" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "emailNormalized" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL DEFAULT 'ADMIN',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdByUserId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlatformOrganizationInvite_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PlatformOrganizationInvite_role_check" CHECK ("role" = 'ADMIN'),
    CONSTRAINT "PlatformOrganizationInvite_digest_check" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "PlatformOrganizationInvite_tokenHash_key" ON "PlatformOrganizationInvite"("tokenHash");
CREATE INDEX "PlatformOrganizationInvite_organizationId_expiresAt_idx" ON "PlatformOrganizationInvite"("organizationId", "expiresAt");
ALTER TABLE "PlatformOrganizationInvite" ADD CONSTRAINT "PlatformOrganizationInvite_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlatformOrganizationInvite" ADD CONSTRAINT "PlatformOrganizationInvite_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
