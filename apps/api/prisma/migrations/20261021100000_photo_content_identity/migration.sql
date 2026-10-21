-- Content identity: one Photo can have several Drive copies (PhotoFile).
CREATE TYPE "PhotoFileStatus" AS ENUM ('ACTIVE', 'MISSING');

CREATE TABLE "PhotoFile" (
  "id" TEXT NOT NULL,
  "photoId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "driveFileId" TEXT NOT NULL,
  "folderId" TEXT,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "md5Checksum" TEXT,
  "sizeBytes" BIGINT,
  "status" "PhotoFileStatus" NOT NULL DEFAULT 'ACTIVE',
  "lastSeenSyncRunId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PhotoFile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PhotoFile_userId_driveFileId_key" ON "PhotoFile"("userId", "driveFileId");
CREATE INDEX "PhotoFile_photoId_status_idx" ON "PhotoFile"("photoId", "status");
CREATE INDEX "PhotoFile_sourceId_status_idx" ON "PhotoFile"("sourceId", "status");
CREATE INDEX "PhotoFile_sourceId_lastSeenSyncRunId_idx" ON "PhotoFile"("sourceId", "lastSeenSyncRunId");
CREATE INDEX "PhotoFile_folderId_idx" ON "PhotoFile"("folderId");

ALTER TABLE "PhotoFile" ADD CONSTRAINT "PhotoFile_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Photo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PhotoFile" ADD CONSTRAINT "PhotoFile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PhotoFile" ADD CONSTRAINT "PhotoFile_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "PhotoSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PhotoFile" ADD CONSTRAINT "PhotoFile_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "IndexedFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: every existing photo gets one copy row from its current Drive file, and a provisional
-- content key derived from that file. The next sync of the source learns md5Checksum/size and
-- upgrades the key (merging photos that turn out to be the same content).
ALTER TABLE "Photo" ADD COLUMN "contentKey" TEXT;
UPDATE "Photo" SET "contentKey" = 'drive:' || "driveFileId";
ALTER TABLE "Photo" ALTER COLUMN "contentKey" SET NOT NULL;

INSERT INTO "PhotoFile" (
  "id", "photoId", "userId", "sourceId", "driveFileId", "folderId", "fileName", "mimeType",
  "status", "lastSeenSyncRunId", "createdAt", "updatedAt"
)
SELECT
  'pf_' || "id", "id", "userId", "sourceId", "driveFileId", "folderId", "fileName", "mimeType",
  CASE WHEN "status" = 'ACTIVE' THEN 'ACTIVE'::"PhotoFileStatus" ELSE 'MISSING'::"PhotoFileStatus" END,
  "lastSeenSyncRunId", "createdAt", CURRENT_TIMESTAMP
FROM "Photo";

CREATE UNIQUE INDEX "Photo_userId_contentKey_key" ON "Photo"("userId", "contentKey");
-- A Drive file id now identifies a copy, not a photo.
ALTER TABLE "Photo" DROP CONSTRAINT IF EXISTS "Photo_userId_driveFileId_key";
DROP INDEX IF EXISTS "Photo_userId_driveFileId_key";
CREATE INDEX "Photo_userId_driveFileId_idx" ON "Photo"("userId", "driveFileId");

-- Exclusions also match by content, so a removed photo does not return through a new copy.
ALTER TABLE "PhotoExclusion" ADD COLUMN "contentKey" TEXT;
CREATE INDEX "PhotoExclusion_userId_contentKey_idx" ON "PhotoExclusion"("userId", "contentKey");
