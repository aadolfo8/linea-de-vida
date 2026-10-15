ALTER TABLE "SyncIssue"
ADD COLUMN "driveFolderId" TEXT,
ADD COLUMN "resolvedAt" TIMESTAMP(3);

CREATE INDEX "SyncIssue_driveFolderId_idx" ON "SyncIssue"("driveFolderId");
CREATE INDEX "SyncIssue_resolvedAt_syncRunId_idx" ON "SyncIssue"("resolvedAt", "syncRunId");
