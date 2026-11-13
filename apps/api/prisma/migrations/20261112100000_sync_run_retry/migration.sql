-- The sync queue now lives in this table: retries are counted and scheduled here.
ALTER TABLE "SyncRun" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SyncRun" ADD COLUMN "nextAttemptAt" TIMESTAMP(3);

DROP INDEX IF EXISTS "SyncRun_status_createdAt_idx";
CREATE INDEX "SyncRun_status_nextAttemptAt_createdAt_idx" ON "SyncRun"("status", "nextAttemptAt", "createdAt");
