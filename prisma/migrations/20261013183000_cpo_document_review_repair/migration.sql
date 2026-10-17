-- Additive document repair: keep immutable file/scan history and canonical authorization.
-- Compatibility: old runtimes supersede during AGENT/MANAGER upload and will fail closed
-- against this DB. Deploy with M3 writes frozen. An old-runtime rollback degrades document
-- uploads until a forward runtime fix; it is not a fully functional rollback target.
CREATE OR REPLACE FUNCTION "protect_case_document_version_history"()
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
      ARRAY['DOCUMENT_REVIEWER']
    )
    AND OLD."status" <> 'SUPERSEDED'
    AND NEW."status" = 'SUPERSEDED'
    AND EXISTS (
      SELECT 1 FROM "CaseDocumentVersion" replacement
      JOIN "OperationalAuditEvent" auth_event
        ON auth_event."actorMembershipId" = replacement."reviewedByMembershipId"
      WHERE replacement."documentId" = OLD."documentId"
        AND replacement."organizationId" = OLD."organizationId"
        AND replacement."versionNumber" > OLD."versionNumber"
        AND replacement."status" = 'VERIFIED' AND replacement."scanStatus" = 'CLEAN'
        AND (replacement."expiresAt" IS NULL OR replacement."expiresAt" > CURRENT_TIMESTAMP)
        AND (replacement.xmin::text)::bigint = txid_current()
        AND auth_event."organizationId" = NEW."organizationId"
        AND auth_event."entityType" = 'document_version' AND auth_event."entityId" = NEW."id"
        AND auth_event."action" = 'm3.lifecycle_transition_authorized.v1'
        AND auth_event."before"->>'status' = OLD."status"::text
        AND auth_event."after"->>'status' = 'SUPERSEDED'
        AND auth_event."after"->>'command' = 'supersede'
        AND (auth_event.xmin::text)::bigint = txid_current()
    )
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
    AND OLD."status" = 'UPLOADED' AND NEW."status" = 'IN_REVIEW'
    AND OLD."assignedReviewerMembershipId" IS NULL AND NEW."assignedReviewerMembershipId" IS NOT NULL
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
    AND OLD."status" = 'IN_REVIEW' AND NEW."status" IN ('VERIFIED', 'REJECTED')
    AND OLD."assignedReviewerMembershipId" IS NOT NULL
    AND NEW."assignedReviewerMembershipId" = OLD."assignedReviewerMembershipId"
    AND NEW."reviewedByMembershipId" = OLD."assignedReviewerMembershipId"
    AND NEW."reviewedAt" IS NOT NULL AND NEW."reviewChecklist" IS NOT NULL AND NEW."scanStatus" = 'CLEAN'
    AND ROW(NEW."scanStatus", NEW."scanProvider", NEW."scanResultCode")
      IS NOT DISTINCT FROM ROW(OLD."scanStatus", OLD."scanProvider", OLD."scanResultCode")
    AND (
      (NEW."status" = 'VERIFIED' AND NEW."rejectionReason" IS NULL
        AND (NEW."expiresAt" IS NULL OR NEW."expiresAt" > CURRENT_TIMESTAMP)
        AND NOT EXISTS (SELECT 1 FROM "CaseDocumentVersion" newer
          WHERE newer."documentId" = NEW."documentId" AND newer."versionNumber" > NEW."versionNumber" AND newer."status" = 'VERIFIED'))
      OR
      (NEW."status" = 'REJECTED' AND length(trim(NEW."rejectionReason")) >= 3 AND NEW."expiresAt" IS NOT DISTINCT FROM OLD."expiresAt")
    ) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'CaseDocumentVersion lifecycle transition requires canonical command';
END;
$$;

CREATE FUNCTION "cpo_guard_document_review_identity"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  uploader_user integer;
  reviewer_user integer;
  reviewer_membership text;
BEGIN
  -- Pair with the membership identity guard, including insert/claim races.
  PERFORM "id" FROM "Membership"
    WHERE "id" IN (NEW."uploaderMembershipId", NEW."assignedReviewerMembershipId", NEW."reviewedByMembershipId")
    ORDER BY "id" FOR SHARE;
  IF NEW."status" IN ('IN_REVIEW', 'VERIFIED', 'REJECTED') THEN
    SELECT "userId" INTO uploader_user FROM "Membership" WHERE "id" = NEW."uploaderMembershipId";
    FOREACH reviewer_membership IN ARRAY ARRAY[NEW."assignedReviewerMembershipId", NEW."reviewedByMembershipId"] LOOP
      IF reviewer_membership IS NULL THEN CONTINUE; END IF;
      SELECT "userId" INTO reviewer_user FROM "Membership" WHERE "id" = reviewer_membership;
      IF reviewer_user IS NULL OR uploader_user IS NULL OR reviewer_user = uploader_user THEN
        RAISE EXCEPTION 'Document reviewer must be independent of uploader user identity';
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "CaseDocumentVersion_independent_reviewer_guard"
BEFORE INSERT OR UPDATE ON "CaseDocumentVersion"
FOR EACH ROW EXECUTE FUNCTION "cpo_guard_document_review_identity"();

CREATE FUNCTION "cpo_guard_document_membership_identity"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."userId" IS DISTINCT FROM OLD."userId" AND EXISTS (
    SELECT 1 FROM "CaseDocumentVersion" WHERE "uploaderMembershipId" = OLD."id"
      OR "assignedReviewerMembershipId" = OLD."id" OR "reviewedByMembershipId" = OLD."id"
  ) THEN
    RAISE EXCEPTION 'Document-linked membership user identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Membership_document_identity_guard"
BEFORE UPDATE OF "userId" ON "Membership"
FOR EACH ROW EXECUTE FUNCTION "cpo_guard_document_membership_identity"();
