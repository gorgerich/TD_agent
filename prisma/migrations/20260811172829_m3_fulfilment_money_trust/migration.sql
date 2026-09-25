-- CreateEnum
CREATE TYPE "CasePartyRole" AS ENUM ('APPLICANT', 'DECISION_MAKER', 'PAYER', 'RESPONSIBLE_FOR_BURIAL', 'ADDITIONAL_CONTACT');

-- CreateEnum
CREATE TYPE "M3CommunicationChannel" AS ENUM ('PHONE', 'EMAIL', 'MESSENGER', 'IN_PERSON', 'NONE');

-- CreateEnum
CREATE TYPE "M3ConsentStatus" AS ENUM ('UNKNOWN', 'NOT_REQUESTED', 'GRANTED', 'WITHDRAWN', 'RESTRICTED');

-- CreateEnum
CREATE TYPE "M3PartyVisibility" AS ENUM ('CASE_TEAM', 'FINANCE_LIMITED', 'REVIEWER_REDACTED');

-- CreateEnum
CREATE TYPE "M3PolicyStatus" AS ENUM ('DRAFT_POLICY', 'APPROVED', 'RETIRED');

-- CreateEnum
CREATE TYPE "M3RequirementKind" AS ENUM ('REQUIRED', 'CONDITIONAL');

-- CreateEnum
CREATE TYPE "M3RequirementSatisfaction" AS ENUM ('NOT_SATISFIED', 'SATISFIED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "DocumentLifecycleStatus" AS ENUM ('REQUIRED', 'UPLOADED', 'QUARANTINED', 'IN_REVIEW', 'VERIFIED', 'REJECTED', 'EXPIRED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "DocumentScanStatus" AS ENUM ('PENDING', 'CLEAN', 'INFECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "DocumentAccessAction" AS ENUM ('VIEW', 'DOWNLOAD');

-- CreateEnum
CREATE TYPE "ContractLifecycleStatus" AS ENUM ('DRAFT', 'ISSUED', 'SIGNED', 'CANCELLED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "PaymentLedgerEntryType" AS ENUM ('OBLIGATION', 'PAYMENT', 'REFUND', 'CORRECTION', 'REVERSAL');

-- CreateEnum
CREATE TYPE "LedgerDirection" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "LedgerApprovalDecision" AS ENUM ('APPROVED', 'REJECTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MembershipRole" ADD VALUE 'DOCUMENT_REVIEWER';
ALTER TYPE "MembershipRole" ADD VALUE 'FINANCE';

-- CreateTable
CREATE TABLE "CaseParty" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "nameEncrypted" TEXT NOT NULL,
    "phoneEncrypted" TEXT,
    "emailEncrypted" TEXT,
    "preferredChannel" "M3CommunicationChannel" NOT NULL DEFAULT 'NONE',
    "consentStatus" "M3ConsentStatus" NOT NULL DEFAULT 'UNKNOWN',
    "consentSource" TEXT,
    "consentAt" TIMESTAMP(3),
    "visibilityPolicy" "M3PartyVisibility" NOT NULL DEFAULT 'CASE_TEAM',
    "createdByMembershipId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaseParty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CasePartyRoleAssignment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "casePartyId" TEXT NOT NULL,
    "role" "CasePartyRole" NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "createdByMembershipId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CasePartyRoleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentTypeDefinition" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "allowedMimeTypes" JSONB NOT NULL,
    "maxBytes" INTEGER NOT NULL,
    "status" "M3PolicyStatus" NOT NULL DEFAULT 'DRAFT_POLICY',
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentTypeDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentRequirementPolicy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scenario" "CaseScenario" NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "M3PolicyStatus" NOT NULL DEFAULT 'DRAFT_POLICY',
    "source" TEXT NOT NULL,
    "approvedByUserId" INTEGER,
    "approvedAt" TIMESTAMP(3),
    "effectiveFrom" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentRequirementPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentRequirementRule" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "stableKey" TEXT NOT NULL,
    "kind" "M3RequirementKind" NOT NULL,
    "conditionKey" TEXT,
    "conditionExplanation" TEXT,
    "dueOffsetHours" INTEGER,
    "ownerRole" "MembershipRole" NOT NULL,
    "blockingStage" "CaseStage" NOT NULL,
    "acceptedDocumentTypeCodes" JSONB NOT NULL,
    "acceptedDocumentTypeVersionIds" JSONB NOT NULL,
    "reviewChecklist" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentRequirementRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseDocumentRequirement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "policyVersion" INTEGER NOT NULL,
    "stableKey" TEXT NOT NULL,
    "kind" "M3RequirementKind" NOT NULL,
    "conditionExplanation" TEXT,
    "dueAt" TIMESTAMP(3),
    "ownerMembershipId" TEXT,
    "ownerRole" "MembershipRole" NOT NULL,
    "blockingStage" "CaseStage" NOT NULL,
    "acceptedDocumentTypeCodes" JSONB NOT NULL,
    "acceptedDocumentTypeVersionIds" JSONB NOT NULL,
    "reviewChecklist" JSONB NOT NULL,
    "isApplicable" BOOLEAN NOT NULL DEFAULT true,
    "applicabilityEvaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "satisfactionStatus" "M3RequirementSatisfaction" NOT NULL DEFAULT 'NOT_SATISFIED',
    "satisfiedByVersionId" TEXT,
    "sourceRule" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaseDocumentRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "requirementId" TEXT,
    "documentTypeId" TEXT NOT NULL,
    "status" "DocumentLifecycleStatus" NOT NULL DEFAULT 'REQUIRED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaseDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseDocumentVersion" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "organizationId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "requirementId" TEXT,
    "fileChecksum" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "storageEtag" TEXT NOT NULL,
    "originalFilenameEncrypted" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploaderMembershipId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" "DocumentLifecycleStatus" NOT NULL DEFAULT 'QUARANTINED',
    "scanStatus" "DocumentScanStatus" NOT NULL DEFAULT 'PENDING',
    "scanProvider" TEXT,
    "scanResultCode" TEXT,
    "assignedReviewerMembershipId" TEXT,
    "reviewedByMembershipId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewChecklist" JSONB,
    "rejectionReason" TEXT,
    "expiresAt" TIMESTAMP(3),
    "supersedesVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseDocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentAccessEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "documentVersionId" TEXT NOT NULL,
    "actorMembershipId" TEXT NOT NULL,
    "action" "DocumentAccessAction" NOT NULL,
    "purpose" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentAccessEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractSigningPolicy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "status" "M3PolicyStatus" NOT NULL DEFAULT 'DRAFT_POLICY',
    "allowedEvidenceTypes" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "approvedByUserId" INTEGER,
    "approvedAt" TIMESTAMP(3),
    "effectiveFrom" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractSigningPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "createdByMembershipId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractVersion" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "quoteVersionId" INTEGER NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" "ContractLifecycleStatus" NOT NULL DEFAULT 'DRAFT',
    "partiesSnapshot" JSONB NOT NULL,
    "payerPartyId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "totalObligationKopecks" INTEGER NOT NULL,
    "paymentTerms" JSONB NOT NULL,
    "issuedByMembershipId" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3),
    "signedByMembershipId" TEXT,
    "signedAt" TIMESTAMP(3),
    "signatureEvidence" JSONB,
    "signaturePolicyId" TEXT,
    "signaturePolicyVersion" TEXT,
    "checksum" TEXT NOT NULL,
    "validUntil" TIMESTAMP(3),
    "supersedesVersionId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentObligation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "contractVersionId" TEXT NOT NULL,
    "payerPartyId" TEXT,
    "amountKopecks" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "createdByMembershipId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentObligation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentLedgerEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "obligationId" TEXT NOT NULL,
    "payerPartyId" TEXT,
    "type" "PaymentLedgerEntryType" NOT NULL,
    "direction" "LedgerDirection" NOT NULL,
    "amountKopecks" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "method" "PaymentMethod",
    "source" TEXT NOT NULL,
    "externalTransactionId" TEXT,
    "evidenceReference" TEXT NOT NULL,
    "actorMembershipId" TEXT,
    "actorType" TEXT NOT NULL DEFAULT 'member',
    "idempotencyKey" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "approvalRequired" BOOLEAN NOT NULL DEFAULT false,
    "relatedEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentLedgerApproval" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ledgerEntryId" TEXT NOT NULL,
    "requestedByMembershipId" TEXT NOT NULL,
    "decidedByMembershipId" TEXT,
    "decision" "LedgerApprovalDecision",
    "decidedAt" TIMESTAMP(3),
    "policyVersion" INTEGER NOT NULL,
    "requestReason" TEXT NOT NULL,
    "decisionReason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentLedgerApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialControlPolicy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "M3PolicyStatus" NOT NULL DEFAULT 'DRAFT_POLICY',
    "correctionThresholdKopecks" INTEGER,
    "source" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancialControlPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentWebhookReceipt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "eventVersion" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "signatureVerified" BOOLEAN NOT NULL,
    "rejectedReason" TEXT,
    "ledgerEntryId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentWebhookReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CaseParty_organizationId_caseId_idx" ON "CaseParty"("organizationId", "caseId");

-- CreateIndex
CREATE INDEX "CaseParty_caseId_consentStatus_idx" ON "CaseParty"("caseId", "consentStatus");

-- CreateIndex
CREATE INDEX "CasePartyRoleAssignment_organizationId_role_validUntil_idx" ON "CasePartyRoleAssignment"("organizationId", "role", "validUntil");

-- CreateIndex
CREATE UNIQUE INDEX "CasePartyRoleAssignment_casePartyId_role_validFrom_key" ON "CasePartyRoleAssignment"("casePartyId", "role", "validFrom");

-- CreateIndex
CREATE INDEX "DocumentTypeDefinition_organizationId_status_code_idx" ON "DocumentTypeDefinition"("organizationId", "status", "code");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentTypeDefinition_organizationId_code_version_key" ON "DocumentTypeDefinition"("organizationId", "code", "version");

-- CreateIndex
CREATE INDEX "DocumentRequirementPolicy_organizationId_scenario_status_ef_idx" ON "DocumentRequirementPolicy"("organizationId", "scenario", "status", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentRequirementPolicy_organizationId_scenario_version_key" ON "DocumentRequirementPolicy"("organizationId", "scenario", "version");

-- CreateIndex
CREATE INDEX "DocumentRequirementRule_policyId_blockingStage_idx" ON "DocumentRequirementRule"("policyId", "blockingStage");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentRequirementRule_policyId_stableKey_key" ON "DocumentRequirementRule"("policyId", "stableKey");

-- CreateIndex
CREATE UNIQUE INDEX "CaseDocumentRequirement_satisfiedByVersionId_key" ON "CaseDocumentRequirement"("satisfiedByVersionId");

-- CreateIndex
CREATE INDEX "CaseDocumentRequirement_organizationId_satisfactionStatus_d_idx" ON "CaseDocumentRequirement"("organizationId", "satisfactionStatus", "dueAt");

-- CreateIndex
CREATE INDEX "CaseDocumentRequirement_caseId_blockingStage_isApplicable_idx" ON "CaseDocumentRequirement"("caseId", "blockingStage", "isApplicable");

-- CreateIndex
CREATE UNIQUE INDEX "CaseDocumentRequirement_caseId_ruleId_key" ON "CaseDocumentRequirement"("caseId", "ruleId");

-- CreateIndex
CREATE UNIQUE INDEX "CaseDocumentRequirement_caseId_stableKey_policyVersion_key" ON "CaseDocumentRequirement"("caseId", "stableKey", "policyVersion");

-- CreateIndex
CREATE UNIQUE INDEX "CaseDocument_requirementId_key" ON "CaseDocument"("requirementId");

-- CreateIndex
CREATE INDEX "CaseDocument_organizationId_caseId_status_idx" ON "CaseDocument"("organizationId", "caseId", "status");

-- CreateIndex
CREATE INDEX "CaseDocument_documentTypeId_idx" ON "CaseDocument"("documentTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "CaseDocumentVersion_storageKey_key" ON "CaseDocumentVersion"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "CaseDocumentVersion_supersedesVersionId_key" ON "CaseDocumentVersion"("supersedesVersionId");

-- CreateIndex
CREATE INDEX "CaseDocumentVersion_organizationId_status_createdAt_idx" ON "CaseDocumentVersion"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "CaseDocumentVersion_caseId_requirementId_idx" ON "CaseDocumentVersion"("caseId", "requirementId");

-- CreateIndex
CREATE INDEX "CaseDocumentVersion_reviewedByMembershipId_status_idx" ON "CaseDocumentVersion"("reviewedByMembershipId", "status");

-- CreateIndex
CREATE INDEX "CaseDocumentVersion_assignedReviewerMembershipId_status_idx" ON "CaseDocumentVersion"("assignedReviewerMembershipId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CaseDocumentVersion_documentId_versionNumber_key" ON "CaseDocumentVersion"("documentId", "versionNumber");

-- CreateIndex
CREATE INDEX "DocumentAccessEvent_organizationId_caseId_createdAt_idx" ON "DocumentAccessEvent"("organizationId", "caseId", "createdAt");

-- CreateIndex
CREATE INDEX "DocumentAccessEvent_documentVersionId_createdAt_idx" ON "DocumentAccessEvent"("documentVersionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentAccessEvent_organizationId_correlationId_key" ON "DocumentAccessEvent"("organizationId", "correlationId");

-- CreateIndex
CREATE UNIQUE INDEX "ContractSigningPolicy_organizationId_version_key" ON "ContractSigningPolicy"("organizationId", "version");

-- CreateIndex
CREATE INDEX "ContractSigningPolicy_organizationId_status_effectiveFrom_idx" ON "ContractSigningPolicy"("organizationId", "status", "effectiveFrom");

-- Only one non-retired signing policy may create legal-proof claims at a time.
CREATE UNIQUE INDEX "ContractSigningPolicy_one_approved"
ON "ContractSigningPolicy" ("organizationId")
WHERE "status" = 'APPROVED' AND "retiredAt" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Contract_caseId_key" ON "Contract"("caseId");

-- CreateIndex
CREATE INDEX "Contract_organizationId_createdAt_idx" ON "Contract"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ContractVersion_supersedesVersionId_key" ON "ContractVersion"("supersedesVersionId");

-- CreateIndex
CREATE INDEX "ContractVersion_organizationId_caseId_status_idx" ON "ContractVersion"("organizationId", "caseId", "status");

-- CreateIndex
CREATE INDEX "ContractVersion_quoteVersionId_idx" ON "ContractVersion"("quoteVersionId");

-- CreateIndex
CREATE INDEX "ContractVersion_signaturePolicyId_idx" ON "ContractVersion"("signaturePolicyId");

-- CreateIndex
CREATE UNIQUE INDEX "ContractVersion_contractId_versionNumber_key" ON "ContractVersion"("contractId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ContractVersion_contractId_quoteVersionId_key" ON "ContractVersion"("contractId", "quoteVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "ContractVersion_organizationId_idempotencyKey_key" ON "ContractVersion"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentObligation_contractVersionId_key" ON "PaymentObligation"("contractVersionId");

-- CreateIndex
CREATE INDEX "PaymentObligation_organizationId_caseId_idx" ON "PaymentObligation"("organizationId", "caseId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentObligation_organizationId_idempotencyKey_key" ON "PaymentObligation"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "PaymentLedgerEntry_organizationId_caseId_createdAt_idx" ON "PaymentLedgerEntry"("organizationId", "caseId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentLedgerEntry_obligationId_createdAt_idx" ON "PaymentLedgerEntry"("obligationId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentLedgerEntry_relatedEntryId_idx" ON "PaymentLedgerEntry"("relatedEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentLedgerEntry_organizationId_idempotencyKey_key" ON "PaymentLedgerEntry"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentLedgerEntry_organizationId_source_externalTransactio_key" ON "PaymentLedgerEntry"("organizationId", "source", "externalTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentLedgerApproval_ledgerEntryId_key" ON "PaymentLedgerApproval"("ledgerEntryId");

-- CreateIndex
CREATE INDEX "PaymentLedgerApproval_organizationId_decision_createdAt_idx" ON "PaymentLedgerApproval"("organizationId", "decision", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentLedgerApproval_organizationId_idempotencyKey_key" ON "PaymentLedgerApproval"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "FinancialControlPolicy_organizationId_status_idx" ON "FinancialControlPolicy"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialControlPolicy_organizationId_version_key" ON "FinancialControlPolicy"("organizationId", "version");

-- Only one active approved ruleset may define truth for a scenario or tenant.
CREATE UNIQUE INDEX "DocumentRequirementPolicy_one_approved_per_scenario"
ON "DocumentRequirementPolicy"("organizationId", "scenario")
WHERE "status" = 'APPROVED' AND "retiredAt" IS NULL;

CREATE UNIQUE INDEX "FinancialControlPolicy_one_approved_per_org"
ON "FinancialControlPolicy"("organizationId")
WHERE "status" = 'APPROVED';

-- CreateIndex
CREATE UNIQUE INDEX "PaymentWebhookReceipt_ledgerEntryId_key" ON "PaymentWebhookReceipt"("ledgerEntryId");

-- CreateIndex
CREATE INDEX "PaymentWebhookReceipt_organizationId_caseId_receivedAt_idx" ON "PaymentWebhookReceipt"("organizationId", "caseId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentWebhookReceipt_organizationId_provider_externalEvent_key" ON "PaymentWebhookReceipt"("organizationId", "provider", "externalEventId");

-- AddForeignKey
ALTER TABLE "CaseParty" ADD CONSTRAINT "CaseParty_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseParty" ADD CONSTRAINT "CaseParty_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseParty" ADD CONSTRAINT "CaseParty_createdByMembershipId_fkey" FOREIGN KEY ("createdByMembershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CasePartyRoleAssignment" ADD CONSTRAINT "CasePartyRoleAssignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CasePartyRoleAssignment" ADD CONSTRAINT "CasePartyRoleAssignment_casePartyId_fkey" FOREIGN KEY ("casePartyId") REFERENCES "CaseParty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CasePartyRoleAssignment" ADD CONSTRAINT "CasePartyRoleAssignment_createdByMembershipId_fkey" FOREIGN KEY ("createdByMembershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentTypeDefinition" ADD CONSTRAINT "DocumentTypeDefinition_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRequirementPolicy" ADD CONSTRAINT "DocumentRequirementPolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRequirementPolicy" ADD CONSTRAINT "DocumentRequirementPolicy_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRequirementRule" ADD CONSTRAINT "DocumentRequirementRule_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "DocumentRequirementPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseDocumentRequirement" ADD CONSTRAINT "CaseDocumentRequirement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseDocumentRequirement" ADD CONSTRAINT "CaseDocumentRequirement_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseDocumentRequirement" ADD CONSTRAINT "CaseDocumentRequirement_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "DocumentRequirementPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseDocumentRequirement" ADD CONSTRAINT "CaseDocumentRequirement_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "DocumentRequirementRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseDocumentRequirement" ADD CONSTRAINT "CaseDocumentRequirement_ownerMembershipId_fkey" FOREIGN KEY ("ownerMembershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseDocumentRequirement" ADD CONSTRAINT "CaseDocumentRequirement_satisfiedByVersionId_fkey" FOREIGN KEY ("satisfiedByVersionId") REFERENCES "CaseDocumentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseDocument" ADD CONSTRAINT "CaseDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseDocument" ADD CONSTRAINT "CaseDocument_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseDocument" ADD CONSTRAINT "CaseDocument_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "CaseDocumentRequirement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseDocument" ADD CONSTRAINT "CaseDocument_documentTypeId_fkey" FOREIGN KEY ("documentTypeId") REFERENCES "DocumentTypeDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseDocumentVersion" ADD CONSTRAINT "CaseDocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "CaseDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseDocumentVersion" ADD CONSTRAINT "CaseDocumentVersion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseDocumentVersion" ADD CONSTRAINT "CaseDocumentVersion_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseDocumentVersion" ADD CONSTRAINT "CaseDocumentVersion_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "CaseDocumentRequirement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseDocumentVersion" ADD CONSTRAINT "CaseDocumentVersion_uploaderMembershipId_fkey" FOREIGN KEY ("uploaderMembershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseDocumentVersion" ADD CONSTRAINT "CaseDocumentVersion_assignedReviewerMembershipId_fkey" FOREIGN KEY ("assignedReviewerMembershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseDocumentVersion" ADD CONSTRAINT "CaseDocumentVersion_reviewedByMembershipId_fkey" FOREIGN KEY ("reviewedByMembershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseDocumentVersion" ADD CONSTRAINT "CaseDocumentVersion_supersedesVersionId_fkey" FOREIGN KEY ("supersedesVersionId") REFERENCES "CaseDocumentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentAccessEvent" ADD CONSTRAINT "DocumentAccessEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentAccessEvent" ADD CONSTRAINT "DocumentAccessEvent_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentAccessEvent" ADD CONSTRAINT "DocumentAccessEvent_documentVersionId_fkey" FOREIGN KEY ("documentVersionId") REFERENCES "CaseDocumentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentAccessEvent" ADD CONSTRAINT "DocumentAccessEvent_actorMembershipId_fkey" FOREIGN KEY ("actorMembershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractSigningPolicy" ADD CONSTRAINT "ContractSigningPolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractSigningPolicy" ADD CONSTRAINT "ContractSigningPolicy_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_createdByMembershipId_fkey" FOREIGN KEY ("createdByMembershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractVersion" ADD CONSTRAINT "ContractVersion_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractVersion" ADD CONSTRAINT "ContractVersion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractVersion" ADD CONSTRAINT "ContractVersion_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractVersion" ADD CONSTRAINT "ContractVersion_quoteVersionId_fkey" FOREIGN KEY ("quoteVersionId") REFERENCES "QuoteVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractVersion" ADD CONSTRAINT "ContractVersion_payerPartyId_fkey" FOREIGN KEY ("payerPartyId") REFERENCES "CaseParty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractVersion" ADD CONSTRAINT "ContractVersion_issuedByMembershipId_fkey" FOREIGN KEY ("issuedByMembershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractVersion" ADD CONSTRAINT "ContractVersion_signedByMembershipId_fkey" FOREIGN KEY ("signedByMembershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractVersion" ADD CONSTRAINT "ContractVersion_signaturePolicyId_fkey" FOREIGN KEY ("signaturePolicyId") REFERENCES "ContractSigningPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractVersion" ADD CONSTRAINT "ContractVersion_supersedesVersionId_fkey" FOREIGN KEY ("supersedesVersionId") REFERENCES "ContractVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentObligation" ADD CONSTRAINT "PaymentObligation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentObligation" ADD CONSTRAINT "PaymentObligation_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentObligation" ADD CONSTRAINT "PaymentObligation_contractVersionId_fkey" FOREIGN KEY ("contractVersionId") REFERENCES "ContractVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentObligation" ADD CONSTRAINT "PaymentObligation_payerPartyId_fkey" FOREIGN KEY ("payerPartyId") REFERENCES "CaseParty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentObligation" ADD CONSTRAINT "PaymentObligation_createdByMembershipId_fkey" FOREIGN KEY ("createdByMembershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentLedgerEntry" ADD CONSTRAINT "PaymentLedgerEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentLedgerEntry" ADD CONSTRAINT "PaymentLedgerEntry_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentLedgerEntry" ADD CONSTRAINT "PaymentLedgerEntry_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "PaymentObligation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentLedgerEntry" ADD CONSTRAINT "PaymentLedgerEntry_payerPartyId_fkey" FOREIGN KEY ("payerPartyId") REFERENCES "CaseParty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentLedgerEntry" ADD CONSTRAINT "PaymentLedgerEntry_actorMembershipId_fkey" FOREIGN KEY ("actorMembershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentLedgerEntry" ADD CONSTRAINT "PaymentLedgerEntry_relatedEntryId_fkey" FOREIGN KEY ("relatedEntryId") REFERENCES "PaymentLedgerEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentLedgerApproval" ADD CONSTRAINT "PaymentLedgerApproval_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentLedgerApproval" ADD CONSTRAINT "PaymentLedgerApproval_ledgerEntryId_fkey" FOREIGN KEY ("ledgerEntryId") REFERENCES "PaymentLedgerEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentLedgerApproval" ADD CONSTRAINT "PaymentLedgerApproval_requestedByMembershipId_fkey" FOREIGN KEY ("requestedByMembershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentLedgerApproval" ADD CONSTRAINT "PaymentLedgerApproval_decidedByMembershipId_fkey" FOREIGN KEY ("decidedByMembershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialControlPolicy" ADD CONSTRAINT "FinancialControlPolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentWebhookReceipt" ADD CONSTRAINT "PaymentWebhookReceipt_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentWebhookReceipt" ADD CONSTRAINT "PaymentWebhookReceipt_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentWebhookReceipt" ADD CONSTRAINT "PaymentWebhookReceipt_ledgerEntryId_fkey" FOREIGN KEY ("ledgerEntryId") REFERENCES "PaymentLedgerEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domain checks prevent silent coercion and malformed immutable history even if a
-- future caller bypasses the application service.
ALTER TABLE "CasePartyRoleAssignment"
  ADD CONSTRAINT "CasePartyRoleAssignment_valid_period_check"
  CHECK ("validUntil" IS NULL OR "validUntil" > "validFrom");

ALTER TABLE "DocumentTypeDefinition"
  ADD CONSTRAINT "DocumentTypeDefinition_positive_values_check"
  CHECK ("version" > 0 AND "maxBytes" > 0);

ALTER TABLE "DocumentRequirementPolicy"
  ADD CONSTRAINT "DocumentRequirementPolicy_version_approval_check"
  CHECK (
    "version" > 0
    AND ("status" <> 'APPROVED' OR ("approvedByUserId" IS NOT NULL AND "approvedAt" IS NOT NULL AND "effectiveFrom" IS NOT NULL))
  );

ALTER TABLE "DocumentRequirementRule"
  ADD CONSTRAINT "DocumentRequirementRule_due_offset_check"
  CHECK ("dueOffsetHours" IS NULL OR "dueOffsetHours" >= 0);

ALTER TABLE "CaseDocumentRequirement"
  ADD CONSTRAINT "CaseDocumentRequirement_satisfaction_check"
  CHECK (
    "policyVersion" > 0
    AND (("satisfactionStatus" = 'SATISFIED' AND "satisfiedByVersionId" IS NOT NULL)
      OR ("satisfactionStatus" <> 'SATISFIED' AND "satisfiedByVersionId" IS NULL))
  );

ALTER TABLE "CaseDocumentVersion"
  ADD CONSTRAINT "CaseDocumentVersion_integrity_check"
  CHECK (
    "versionNumber" > 0
    AND "size" > 0
    AND length("fileChecksum") = 64
    AND length(trim("storageEtag")) > 0
    AND ("status" NOT IN ('IN_REVIEW', 'VERIFIED', 'REJECTED') OR "assignedReviewerMembershipId" IS NOT NULL)
    AND ("status" <> 'VERIFIED' OR ("scanStatus" = 'CLEAN' AND "reviewedByMembershipId" IS NOT NULL AND "reviewedAt" IS NOT NULL))
    AND ("status" <> 'REJECTED' OR ("reviewedByMembershipId" IS NOT NULL AND "reviewedAt" IS NOT NULL AND "rejectionReason" IS NOT NULL))
    AND ("reviewedByMembershipId" IS NULL OR "assignedReviewerMembershipId" = "reviewedByMembershipId")
  );

ALTER TABLE "ContractSigningPolicy"
  ADD CONSTRAINT "ContractSigningPolicy_approval_check"
  CHECK (
    length(trim("version")) > 0
    AND jsonb_typeof("allowedEvidenceTypes") = 'array'
    AND ("status" <> 'APPROVED' OR (
      "approvedByUserId" IS NOT NULL
      AND "approvedAt" IS NOT NULL
      AND "effectiveFrom" IS NOT NULL
    ))
  );

ALTER TABLE "ContractVersion"
  ADD CONSTRAINT "ContractVersion_integrity_check"
  CHECK (
    "versionNumber" > 0
    AND "totalObligationKopecks" > 0
    AND ("status" <> 'SIGNED' OR (
      "signedAt" IS NOT NULL
      AND "signedByMembershipId" IS NOT NULL
      AND "signatureEvidence" IS NOT NULL
      AND "signaturePolicyId" IS NOT NULL
      AND "signaturePolicyVersion" IS NOT NULL
    ))
  );

ALTER TABLE "PaymentObligation"
  ADD CONSTRAINT "PaymentObligation_positive_amount_check"
  CHECK ("amountKopecks" > 0);

ALTER TABLE "PaymentLedgerEntry"
  ADD CONSTRAINT "PaymentLedgerEntry_integrity_check"
  CHECK (
    "amountKopecks" > 0
    AND ("type" <> 'OBLIGATION' OR "direction" = 'DEBIT')
    AND ("type" <> 'PAYMENT' OR "direction" = 'CREDIT')
    AND ("type" <> 'REFUND' OR ("direction" = 'DEBIT' AND "relatedEntryId" IS NOT NULL))
    AND ("type" IN ('OBLIGATION', 'PAYMENT') OR "relatedEntryId" IS NOT NULL)
  );

ALTER TABLE "PaymentLedgerApproval"
  ADD CONSTRAINT "PaymentLedgerApproval_four_eyes_check"
  CHECK (
    "policyVersion" >= 0
    AND (
      ("decidedByMembershipId" IS NULL AND "decision" IS NULL AND "decidedAt" IS NULL)
      OR (
        "decidedByMembershipId" IS NOT NULL
        AND "decision" IS NOT NULL
        AND "decidedAt" IS NOT NULL
        AND "requestedByMembershipId" <> "decidedByMembershipId"
      )
    )
  );

ALTER TABLE "FinancialControlPolicy"
  ADD CONSTRAINT "FinancialControlPolicy_threshold_check"
  CHECK ("version" > 0 AND ("correctionThresholdKopecks" IS NULL OR "correctionThresholdKopecks" > 0));

CREATE FUNCTION "protect_payment_ledger_approval_history"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'PaymentLedgerApproval history cannot be deleted';
  END IF;
  IF ROW(
    NEW."organizationId", NEW."ledgerEntryId", NEW."requestedByMembershipId", NEW."policyVersion",
    NEW."requestReason", NEW."idempotencyKey", NEW."correlationId", NEW."createdAt"
  ) IS DISTINCT FROM ROW(
    OLD."organizationId", OLD."ledgerEntryId", OLD."requestedByMembershipId", OLD."policyVersion",
    OLD."requestReason", OLD."idempotencyKey", OLD."correlationId", OLD."createdAt"
  ) THEN
    RAISE EXCEPTION 'PaymentLedgerApproval request identity is immutable';
  END IF;
  IF OLD."decision" IS NOT NULL THEN
    RAISE EXCEPTION 'PaymentLedgerApproval terminal decision is immutable';
  END IF;
  IF NEW."decision" IS NULL
    OR NEW."decidedByMembershipId" IS NULL
    OR NEW."decidedAt" IS NULL
    OR NEW."decisionReason" IS NULL THEN
    RAISE EXCEPTION 'PaymentLedgerApproval may update only through one terminal decision';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "PaymentLedgerApproval_history_guard"
BEFORE UPDATE OR DELETE ON "PaymentLedgerApproval"
FOR EACH ROW EXECUTE FUNCTION "protect_payment_ledger_approval_history"();

-- Ledger truth is append-only. Test/restore teardown may bypass triggers only
-- through PostgreSQL's explicitly privileged session_replication_role.
CREATE FUNCTION "prevent_payment_ledger_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'PaymentLedgerEntry is append-only; use correction or reversal';
END;
$$;

CREATE TRIGGER "PaymentLedgerEntry_append_only"
BEFORE UPDATE OR DELETE ON "PaymentLedgerEntry"
FOR EACH ROW EXECUTE FUNCTION "prevent_payment_ledger_mutation"();

CREATE FUNCTION "validate_payment_ledger_insert"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  obligation_record "PaymentObligation"%ROWTYPE;
  required_roles text[];
BEGIN
  SELECT * INTO obligation_record
  FROM "PaymentObligation"
  WHERE "id" = NEW."obligationId"
  FOR SHARE;
  IF NOT FOUND
    OR obligation_record."organizationId" <> NEW."organizationId"
    OR obligation_record."caseId" <> NEW."caseId"
    OR obligation_record."currency" <> NEW."currency"
    OR obligation_record."payerPartyId" IS DISTINCT FROM NEW."payerPartyId" THEN
    RAISE EXCEPTION 'Ledger entry must match its tenant-scoped obligation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "Case"
    WHERE "id" = NEW."caseId" AND "tenantId" = NEW."organizationId"
  ) THEN
    RAISE EXCEPTION 'Ledger case tenant mismatch';
  END IF;
  IF NEW."payerPartyId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "CaseParty"
    WHERE "id" = NEW."payerPartyId"
      AND "organizationId" = NEW."organizationId"
      AND "caseId" = NEW."caseId"
  ) THEN
    RAISE EXCEPTION 'Ledger payer tenant mismatch';
  END IF;
  IF NEW."relatedEntryId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "PaymentLedgerEntry"
    WHERE "id" = NEW."relatedEntryId"
      AND "organizationId" = NEW."organizationId"
      AND "caseId" = NEW."caseId"
      AND "obligationId" = NEW."obligationId"
      AND "currency" = NEW."currency"
  ) THEN
    RAISE EXCEPTION 'Ledger relation crosses obligation or tenant boundary';
  END IF;

  IF NEW."source" = 'signed-contract' THEN
    required_roles := ARRAY['AGENT', 'MANAGER'];
    IF NEW."type" <> 'OBLIGATION' OR NOT EXISTS (
      SELECT 1 FROM "ContractVersion"
      WHERE "id" = obligation_record."contractVersionId"
        AND "organizationId" = NEW."organizationId"
        AND "caseId" = NEW."caseId"
        AND "status" = 'SIGNED'
    ) THEN
      RAISE EXCEPTION 'Obligation ledger source requires a signed contract';
    END IF;
  ELSIF NEW."source" LIKE 'manual-finance%' THEN
    required_roles := ARRAY['FINANCE'];
  ELSIF NEW."source" LIKE 'webhook:%' THEN
    IF NEW."actorMembershipId" IS NOT NULL
      OR NEW."actorType" <> 'payment-provider'
      OR NEW."type" <> 'PAYMENT'
      OR NEW."externalTransactionId" IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM "PaymentWebhookReceipt" receipt
        WHERE receipt."organizationId" = NEW."organizationId"
          AND receipt."caseId" = NEW."caseId"
          AND receipt."provider" = substring(NEW."source" from 9)
          AND receipt."signatureVerified" = true
          AND receipt."ledgerEntryId" IS NULL
          AND (receipt.xmin::text)::bigint = txid_current()
      ) THEN
      RAISE EXCEPTION 'Webhook ledger source lacks same-transaction verified receipt';
    END IF;
    required_roles := NULL;
  ELSE
    RAISE EXCEPTION 'Unapproved ledger source';
  END IF;

  IF required_roles IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "Membership" membership
    JOIN "Organization" organization ON organization."id" = membership."organizationId"
    LEFT JOIN "Agent" agent ON agent."id" = membership."agentId"
    WHERE membership."id" = NEW."actorMembershipId"
      AND membership."organizationId" = NEW."organizationId"
      AND membership."status" = 'ACTIVE'
      AND membership."role"::text = ANY(required_roles)
      AND organization."status" = 'ACTIVE'
      AND (membership."agentId" IS NULL OR agent."status" = 'ACTIVE')
  ) THEN
    RAISE EXCEPTION 'Ledger actor lacks required tenant role';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "OperationalAuditEvent" audit
    WHERE audit."organizationId" = NEW."organizationId"
      AND audit."actorMembershipId" IS NOT DISTINCT FROM NEW."actorMembershipId"
      AND audit."actorType" = NEW."actorType"
      AND audit."entityType" = 'payment_obligation'
      AND audit."entityId" = NEW."obligationId"
      AND audit."action" = 'm3.ledger_insert_authorized.v1'
      AND audit."after"->>'organizationId' = NEW."organizationId"
      AND audit."after"->>'caseId' = NEW."caseId"
      AND audit."after"->>'obligationId' = NEW."obligationId"
      AND audit."after"->>'payerPartyId' IS NOT DISTINCT FROM NEW."payerPartyId"
      AND audit."after"->>'type' = NEW."type"::text
      AND audit."after"->>'direction' = NEW."direction"::text
      AND (audit."after"->>'amountKopecks')::integer = NEW."amountKopecks"
      AND audit."after"->>'currency' = NEW."currency"
      AND audit."after"->>'source' = NEW."source"
      AND audit."after"->>'relatedEntryId' IS NOT DISTINCT FROM NEW."relatedEntryId"
      AND audit."after"->>'externalTransactionId' IS NOT DISTINCT FROM NEW."externalTransactionId"
      AND audit."after"->>'idempotencyKey' = NEW."idempotencyKey"
      AND (audit.xmin::text)::bigint = txid_current()
  ) THEN
    RAISE EXCEPTION 'Ledger insert requires same-transaction canonical authorization evidence';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "PaymentLedgerEntry_insert_guard"
BEFORE INSERT ON "PaymentLedgerEntry"
FOR EACH ROW EXECUTE FUNCTION "validate_payment_ledger_insert"();

CREATE FUNCTION "protect_payment_webhook_receipt_history"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'PaymentWebhookReceipt history cannot be deleted';
  END IF;
  IF OLD."ledgerEntryId" IS NOT NULL
    OR NEW."ledgerEntryId" IS NULL
    OR ROW(
      NEW."organizationId", NEW."caseId", NEW."provider", NEW."externalEventId", NEW."eventVersion",
      NEW."payloadHash", NEW."signatureVerified", NEW."rejectedReason", NEW."receivedAt"
    ) IS DISTINCT FROM ROW(
      OLD."organizationId", OLD."caseId", OLD."provider", OLD."externalEventId", OLD."eventVersion",
      OLD."payloadHash", OLD."signatureVerified", OLD."rejectedReason", OLD."receivedAt"
    )
    OR NOT EXISTS (
      SELECT 1 FROM "PaymentLedgerEntry" entry
      WHERE entry."id" = NEW."ledgerEntryId"
        AND entry."organizationId" = NEW."organizationId"
        AND entry."caseId" = NEW."caseId"
        AND entry."source" = 'webhook:' || NEW."provider"
        AND (entry.xmin::text)::bigint = txid_current()
    ) THEN
    RAISE EXCEPTION 'PaymentWebhookReceipt allows only same-transaction ledger linkage';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "PaymentWebhookReceipt_history_guard"
BEFORE UPDATE OR DELETE ON "PaymentWebhookReceipt"
FOR EACH ROW EXECUTE FUNCTION "protect_payment_webhook_receipt_history"();

CREATE FUNCTION "prevent_operational_audit_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'OperationalAuditEvent is append-only';
END;
$$;

CREATE TRIGGER "OperationalAuditEvent_append_only"
BEFORE UPDATE OR DELETE ON "OperationalAuditEvent"
FOR EACH ROW EXECUTE FUNCTION "prevent_operational_audit_mutation"();

CREATE FUNCTION "prevent_platform_audit_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'PlatformAuditEvent is append-only';
END;
$$;

CREATE TRIGGER "PlatformAuditEvent_append_only"
BEFORE UPDATE OR DELETE ON "PlatformAuditEvent"
FOR EACH ROW EXECUTE FUNCTION "prevent_platform_audit_mutation"();

-- Canonical lifecycle transitions carry an immutable authorization event that
-- was written by the same transaction. A caller-settable session GUC is not an
-- authorization boundary.
CREATE FUNCTION "m3_has_lifecycle_authorization"(
  tenant_id text,
  target_type text,
  target_id text,
  transition_command text,
  from_status text,
  to_status text,
  allowed_roles text[]
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "OperationalAuditEvent" audit
    JOIN "Membership" membership ON membership."id" = audit."actorMembershipId"
    JOIN "Organization" organization ON organization."id" = membership."organizationId"
    LEFT JOIN "Agent" agent ON agent."id" = membership."agentId"
    WHERE audit."organizationId" = tenant_id
      AND audit."entityType" = target_type
      AND audit."entityId" = target_id
      AND audit."action" = 'm3.lifecycle_transition_authorized.v1'
      AND audit."before"->>'status' = from_status
      AND audit."after"->>'status' = to_status
      AND audit."after"->>'command' = transition_command
      AND (audit.xmin::text)::bigint = txid_current()
      AND membership."organizationId" = tenant_id
      AND membership."status" = 'ACTIVE'
      AND membership."role"::text = ANY(allowed_roles)
      AND organization."status" = 'ACTIVE'
      AND (membership."agentId" IS NULL OR agent."status" = 'ACTIVE')
  );
$$;

CREATE FUNCTION "protect_case_document_version_history"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'CaseDocumentVersion history cannot be deleted';
  END IF;
  IF ROW(
    NEW."documentId", NEW."versionNumber", NEW."organizationId", NEW."caseId", NEW."requirementId",
    NEW."fileChecksum", NEW."storageKey", NEW."storageEtag", NEW."originalFilenameEncrypted", NEW."mimeType", NEW."size",
    NEW."uploaderMembershipId", NEW."source", NEW."supersedesVersionId", NEW."createdAt"
  ) IS DISTINCT FROM ROW(
    OLD."documentId", OLD."versionNumber", OLD."organizationId", OLD."caseId", OLD."requirementId",
    OLD."fileChecksum", OLD."storageKey", OLD."storageEtag", OLD."originalFilenameEncrypted", OLD."mimeType", OLD."size",
    OLD."uploaderMembershipId", OLD."source", OLD."supersedesVersionId", OLD."createdAt"
  ) THEN
    RAISE EXCEPTION 'CaseDocumentVersion file identity is immutable';
  END IF;
  IF "m3_has_lifecycle_authorization"(
      NEW."organizationId", 'document_version', NEW."id", 'supersede', OLD."status"::text, 'SUPERSEDED',
      ARRAY['AGENT', 'MANAGER']
    )
    AND OLD."status" <> 'SUPERSEDED'
    AND NEW."status" = 'SUPERSEDED'
    AND ROW(
      NEW."scanStatus", NEW."scanProvider", NEW."scanResultCode", NEW."assignedReviewerMembershipId",
      NEW."reviewedByMembershipId", NEW."reviewedAt", NEW."reviewChecklist", NEW."rejectionReason", NEW."expiresAt"
    ) IS NOT DISTINCT FROM ROW(
      OLD."scanStatus", OLD."scanProvider", OLD."scanResultCode", OLD."assignedReviewerMembershipId",
      OLD."reviewedByMembershipId", OLD."reviewedAt", OLD."reviewChecklist", OLD."rejectionReason", OLD."expiresAt"
    ) THEN
    RETURN NEW;
  END IF;
  IF "m3_has_lifecycle_authorization"(
      NEW."organizationId", 'document_version', NEW."id", 'begin-review', 'UPLOADED', 'IN_REVIEW',
      ARRAY['DOCUMENT_REVIEWER']
    )
    AND OLD."status" = 'UPLOADED'
    AND NEW."status" = 'IN_REVIEW'
    AND OLD."assignedReviewerMembershipId" IS NULL
    AND NEW."assignedReviewerMembershipId" IS NOT NULL
    AND NEW."scanStatus" = 'CLEAN'
    AND ROW(
      NEW."scanStatus", NEW."scanProvider", NEW."scanResultCode", NEW."reviewedByMembershipId",
      NEW."reviewedAt", NEW."reviewChecklist", NEW."rejectionReason", NEW."expiresAt"
    ) IS NOT DISTINCT FROM ROW(
      OLD."scanStatus", OLD."scanProvider", OLD."scanResultCode", OLD."reviewedByMembershipId",
      OLD."reviewedAt", OLD."reviewChecklist", OLD."rejectionReason", OLD."expiresAt"
    ) THEN
    RETURN NEW;
  END IF;
  IF "m3_has_lifecycle_authorization"(
      NEW."organizationId", 'document_version', NEW."id", 'review-decision', 'IN_REVIEW', NEW."status"::text,
      ARRAY['DOCUMENT_REVIEWER']
    )
    AND OLD."status" = 'IN_REVIEW'
    AND NEW."status" IN ('VERIFIED', 'REJECTED')
    AND OLD."assignedReviewerMembershipId" IS NOT NULL
    AND NEW."assignedReviewerMembershipId" = OLD."assignedReviewerMembershipId"
    AND NEW."reviewedByMembershipId" = OLD."assignedReviewerMembershipId"
    AND NEW."reviewedAt" IS NOT NULL
    AND NEW."reviewChecklist" IS NOT NULL
    AND NEW."scanStatus" = 'CLEAN'
    AND ROW(NEW."scanStatus", NEW."scanProvider", NEW."scanResultCode")
      IS NOT DISTINCT FROM ROW(OLD."scanStatus", OLD."scanProvider", OLD."scanResultCode")
    AND (
      (NEW."status" = 'VERIFIED' AND NEW."rejectionReason" IS NULL)
      OR
      (NEW."status" = 'REJECTED' AND length(trim(NEW."rejectionReason")) >= 3 AND NEW."expiresAt" IS NOT DISTINCT FROM OLD."expiresAt")
    ) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'CaseDocumentVersion lifecycle transition requires canonical command';
END;
$$;

CREATE TRIGGER "CaseDocumentVersion_history_guard"
BEFORE UPDATE OR DELETE ON "CaseDocumentVersion"
FOR EACH ROW EXECUTE FUNCTION "protect_case_document_version_history"();

CREATE FUNCTION "protect_contract_version_history"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ContractVersion history cannot be deleted';
  END IF;
  IF ROW(
    NEW."contractId", NEW."organizationId", NEW."caseId", NEW."quoteVersionId", NEW."versionNumber",
    NEW."partiesSnapshot", NEW."payerPartyId", NEW."currency", NEW."totalObligationKopecks",
    NEW."paymentTerms", NEW."issuedByMembershipId", NEW."checksum", NEW."validUntil",
    NEW."supersedesVersionId", NEW."idempotencyKey", NEW."correlationId", NEW."createdAt"
  ) IS DISTINCT FROM ROW(
    OLD."contractId", OLD."organizationId", OLD."caseId", OLD."quoteVersionId", OLD."versionNumber",
    OLD."partiesSnapshot", OLD."payerPartyId", OLD."currency", OLD."totalObligationKopecks",
    OLD."paymentTerms", OLD."issuedByMembershipId", OLD."checksum", OLD."validUntil",
    OLD."supersedesVersionId", OLD."idempotencyKey", OLD."correlationId", OLD."createdAt"
  ) THEN
    RAISE EXCEPTION 'ContractVersion snapshot is immutable';
  END IF;
  IF OLD."status" IN ('SIGNED', 'SUPERSEDED') AND ROW(
    NEW."issuedAt", NEW."signedByMembershipId", NEW."signedAt", NEW."signatureEvidence",
    NEW."signaturePolicyId", NEW."signaturePolicyVersion"
  ) IS DISTINCT FROM ROW(
    OLD."issuedAt", OLD."signedByMembershipId", OLD."signedAt", OLD."signatureEvidence",
    OLD."signaturePolicyId", OLD."signaturePolicyVersion"
  ) THEN
    RAISE EXCEPTION 'ContractVersion signed proof is immutable';
  END IF;
  IF "m3_has_lifecycle_authorization"(
      NEW."organizationId", 'contract_version', NEW."id", 'issue', 'DRAFT', 'ISSUED',
      ARRAY['AGENT', 'MANAGER']
    )
    AND OLD."status" = 'DRAFT'
    AND NEW."status" = 'ISSUED'
    AND OLD."issuedAt" IS NULL
    AND NEW."issuedAt" IS NOT NULL
    AND ROW(
      NEW."signedByMembershipId", NEW."signedAt", NEW."signatureEvidence", NEW."signaturePolicyId", NEW."signaturePolicyVersion"
    ) IS NOT DISTINCT FROM ROW(
      OLD."signedByMembershipId", OLD."signedAt", OLD."signatureEvidence", OLD."signaturePolicyId", OLD."signaturePolicyVersion"
    ) THEN
    RETURN NEW;
  END IF;
  IF "m3_has_lifecycle_authorization"(
      NEW."organizationId", 'contract_version', NEW."id", 'supersede', 'SIGNED', 'SUPERSEDED',
      ARRAY['AGENT', 'MANAGER']
    )
    AND OLD."status" = 'SIGNED'
    AND NEW."status" = 'SUPERSEDED'
    AND ROW(
      NEW."issuedAt", NEW."signedByMembershipId", NEW."signedAt", NEW."signatureEvidence", NEW."signaturePolicyId", NEW."signaturePolicyVersion"
    ) IS NOT DISTINCT FROM ROW(
      OLD."issuedAt", OLD."signedByMembershipId", OLD."signedAt", OLD."signatureEvidence", OLD."signaturePolicyId", OLD."signaturePolicyVersion"
    ) THEN
    RETURN NEW;
  END IF;
  IF NOT (
    "m3_has_lifecycle_authorization"(
      NEW."organizationId", 'contract_version', NEW."id", 'sign', 'ISSUED', 'SIGNED',
      ARRAY['AGENT', 'MANAGER']
    )
    AND OLD."status" = 'ISSUED'
    AND NEW."status" = 'SIGNED'
    AND NEW."issuedAt" IS NOT NULL
    AND NEW."issuedAt" IS NOT DISTINCT FROM OLD."issuedAt"
    AND OLD."signedByMembershipId" IS NULL
    AND OLD."signedAt" IS NULL
    AND OLD."signatureEvidence" IS NULL
    AND OLD."signaturePolicyId" IS NULL
    AND OLD."signaturePolicyVersion" IS NULL
    AND NEW."signedByMembershipId" IS NOT NULL
    AND NEW."signedAt" IS NOT NULL
    AND NEW."signatureEvidence" IS NOT NULL
    AND NEW."signaturePolicyId" IS NOT NULL
    AND NEW."signaturePolicyVersion" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'ContractVersion lifecycle transition requires canonical command';
  END IF;
  IF NEW."status" = 'SIGNED' AND OLD."status" IS DISTINCT FROM 'SIGNED' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW."contractId", 0));
    IF EXISTS (
      SELECT 1 FROM "ContractVersion"
      WHERE "contractId" = NEW."contractId"
        AND "id" <> NEW."id"
        AND "status" = 'SIGNED'
    ) THEN
      RAISE EXCEPTION 'Contract may have only one active SIGNED version';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ContractVersion_history_guard"
BEFORE UPDATE OR DELETE ON "ContractVersion"
FOR EACH ROW EXECUTE FUNCTION "protect_contract_version_history"();

CREATE FUNCTION "prevent_payment_obligation_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'PaymentObligation is immutable; append ledger entries instead';
END;
$$;

CREATE TRIGGER "PaymentObligation_immutable"
BEFORE UPDATE OR DELETE ON "PaymentObligation"
FOR EACH ROW EXECUTE FUNCTION "prevent_payment_obligation_mutation"();

-- Approved policy content and materialized rule snapshots are immutable.
-- Retirement changes only policy lifecycle fields and cannot rewrite existing cases.
CREATE FUNCTION "protect_document_policy_content"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DocumentRequirementPolicy history cannot be deleted';
  END IF;
  IF NEW."status" NOT IN ('APPROVED', 'RETIRED') THEN
    RAISE EXCEPTION 'Approved DocumentRequirementPolicy can only be retired';
  END IF;
  IF NEW."status" = 'RETIRED' AND NEW."retiredAt" IS NULL THEN
    RAISE EXCEPTION 'Retired DocumentRequirementPolicy requires retiredAt';
  END IF;
  IF ROW(NEW."organizationId", NEW."scenario", NEW."version", NEW."source", NEW."approvedByUserId", NEW."approvedAt", NEW."effectiveFrom", NEW."createdAt")
    IS DISTINCT FROM
     ROW(OLD."organizationId", OLD."scenario", OLD."version", OLD."source", OLD."approvedByUserId", OLD."approvedAt", OLD."effectiveFrom", OLD."createdAt") THEN
    RAISE EXCEPTION 'DocumentRequirementPolicy approved content is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "DocumentRequirementPolicy_content_guard"
BEFORE UPDATE OR DELETE ON "DocumentRequirementPolicy"
FOR EACH ROW WHEN (OLD."status" = 'APPROVED')
EXECUTE FUNCTION "protect_document_policy_content"();

CREATE FUNCTION "prevent_document_rule_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' OR NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'DocumentRequirementRule is immutable; create a new policy version';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "DocumentRequirementRule_immutable"
BEFORE UPDATE OR DELETE ON "DocumentRequirementRule"
FOR EACH ROW EXECUTE FUNCTION "prevent_document_rule_mutation"();

CREATE FUNCTION "protect_approved_policy_record"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Approved policy history cannot be deleted';
  END IF;
  IF OLD."status" = 'APPROVED' THEN
    IF NEW."status" NOT IN ('APPROVED', 'RETIRED') THEN
      RAISE EXCEPTION 'Approved policy can only be retired';
    END IF;
    IF (to_jsonb(NEW) - 'status' - 'retiredAt')
      IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'retiredAt') THEN
      RAISE EXCEPTION 'Approved policy content is immutable; create a new version';
    END IF;
    IF NEW."status" = 'RETIRED'
      AND to_jsonb(NEW) ? 'retiredAt'
      AND (to_jsonb(NEW)->>'retiredAt') IS NULL THEN
      RAISE EXCEPTION 'Retired policy requires retiredAt';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ContractSigningPolicy_approved_guard"
BEFORE UPDATE OR DELETE ON "ContractSigningPolicy"
FOR EACH ROW EXECUTE FUNCTION "protect_approved_policy_record"();

CREATE TRIGGER "FinancialControlPolicy_approved_guard"
BEFORE UPDATE OR DELETE ON "FinancialControlPolicy"
FOR EACH ROW EXECUTE FUNCTION "protect_approved_policy_record"();

CREATE TRIGGER "DocumentTypeDefinition_approved_guard"
BEFORE UPDATE OR DELETE ON "DocumentTypeDefinition"
FOR EACH ROW EXECUTE FUNCTION "protect_approved_policy_record"();
