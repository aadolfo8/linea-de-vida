ALTER TYPE "DateSource" ADD VALUE IF NOT EXISTS 'FOLDER_RULE';
ALTER TYPE "DateSource" ADD VALUE IF NOT EXISTS 'MANUAL';

CREATE TYPE "FolderDateRuleScope" AS ENUM ('FALLBACK_DESCENDANTS', 'ALL_DESCENDANTS', 'DIRECT_ONLY');

ALTER TABLE "Photo" ADD COLUMN "effectiveDateSource" "DateSource" NOT NULL DEFAULT 'NONE';

CREATE TABLE "FolderDateRule" (
  "id" TEXT NOT NULL,
  "folderId" TEXT NOT NULL,
  "dateValue" DATE NOT NULL,
  "precision" "DatePrecision" NOT NULL,
  "scope" "FolderDateRuleScope" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FolderDateRule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FolderDateRule_folderId_key" ON "FolderDateRule"("folderId");

ALTER TABLE "FolderDateRule"
  ADD CONSTRAINT "FolderDateRule_folderId_fkey"
  FOREIGN KEY ("folderId") REFERENCES "IndexedFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
