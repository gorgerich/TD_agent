-- Preserve pinned policy history without reactivating requirements retired by correction.
ALTER TABLE "CaseDocumentRequirement" ADD COLUMN "supersededAt" TIMESTAMP(3);
