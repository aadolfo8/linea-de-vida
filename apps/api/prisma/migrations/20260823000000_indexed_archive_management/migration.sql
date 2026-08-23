CREATE TYPE "IndexedFolderStatus" AS ENUM ('ACTIVE', 'MISSING');

CREATE TABLE "IndexedFolder" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "driveFolderId" TEXT NOT NULL,
  "parentId" TEXT,
  "name" TEXT NOT NULL,
  "path" TEXT[] NOT NULL,
  "status" "IndexedFolderStatus" NOT NULL DEFAULT 'ACTIVE',
  "lastSeenSyncRunId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IndexedFolder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PhotoExclusion" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "driveFileId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PhotoExclusion_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Photo" ADD COLUMN "folderId" TEXT;
ALTER TABLE "IndexedFolder" ADD CONSTRAINT "IndexedFolder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IndexedFolder" ADD CONSTRAINT "IndexedFolder_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "PhotoSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IndexedFolder" ADD CONSTRAINT "IndexedFolder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "IndexedFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PhotoExclusion" ADD CONSTRAINT "PhotoExclusion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "IndexedFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "IndexedFolder_userId_driveFolderId_key" ON "IndexedFolder"("userId", "driveFolderId");
CREATE INDEX "IndexedFolder_sourceId_status_idx" ON "IndexedFolder"("sourceId", "status");
CREATE INDEX "IndexedFolder_parentId_status_idx" ON "IndexedFolder"("parentId", "status");
CREATE INDEX "IndexedFolder_sourceId_lastSeenSyncRunId_idx" ON "IndexedFolder"("sourceId", "lastSeenSyncRunId");
CREATE UNIQUE INDEX "PhotoExclusion_userId_driveFileId_key" ON "PhotoExclusion"("userId", "driveFileId");
CREATE INDEX "PhotoExclusion_userId_createdAt_idx" ON "PhotoExclusion"("userId", "createdAt");
CREATE INDEX "Photo_folderId_status_idx" ON "Photo"("folderId", "status");

-- Existing photos intentionally keep a NULL folderId until a complete successful resync
-- observes their current Drive folder. No folder path is inferred during migration.
