CREATE TABLE "MaintenanceJobState" (
    "key" TEXT NOT NULL,
    "activeRunId" TEXT NOT NULL,
    "lastAttemptAt" TIMESTAMP(3) NOT NULL,
    "lastCompletedAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "lastOutcome" TEXT NOT NULL,
    "lastDeleted" INTEGER,
    "budgetExhausted" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "MaintenanceJobState_pkey" PRIMARY KEY ("key")
);
