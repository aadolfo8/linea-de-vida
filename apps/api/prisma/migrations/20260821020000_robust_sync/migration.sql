CREATE TYPE "SyncPhase" AS ENUM ('SCANNING', 'PROCESSING');

ALTER TABLE "SyncRun"
  ADD COLUMN "checkpoint" JSONB,
  ADD COLUMN "phase" "SyncPhase" NOT NULL DEFAULT 'SCANNING',
  ADD COLUMN "foundCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "processedCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Photo" ADD COLUMN "lastSeenSyncRunId" TEXT;
CREATE INDEX "Photo_sourceId_lastSeenSyncRunId_idx" ON "Photo" ("sourceId", "lastSeenSyncRunId");

CREATE UNIQUE INDEX "SyncRun_one_active_per_source"
  ON "SyncRun" ("photoSourceId")
  WHERE "status" IN ('QUEUED', 'RUNNING');
