-- M2 first Platform SUPER_ADMIN activation.
-- Additive only. Existing users, credentials, roles, and tenant data are unchanged.

CREATE TABLE "PlatformAccountActivation" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformAccountActivation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlatformAccountActivation_tokenHash_key"
ON "PlatformAccountActivation"("tokenHash");

CREATE INDEX "PlatformAccountActivation_userId_createdAt_idx"
ON "PlatformAccountActivation"("userId", "createdAt");

CREATE INDEX "PlatformAccountActivation_expiresAt_idx"
ON "PlatformAccountActivation"("expiresAt");

ALTER TABLE "PlatformAccountActivation"
ADD CONSTRAINT "PlatformAccountActivation_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
