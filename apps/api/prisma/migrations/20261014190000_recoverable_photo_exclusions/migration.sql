ALTER TABLE "PhotoExclusion"
ADD COLUMN "sourceId" TEXT,
ADD COLUMN "sourceName" TEXT,
ADD COLUMN "folderPath" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "fileName" TEXT,
ADD COLUMN "mimeType" TEXT,
ADD COLUMN "manualDateValue" DATE,
ADD COLUMN "manualDatePrecision" "DatePrecision",
ADD COLUMN "manualDateReason" TEXT,
ADD COLUMN "restoredAt" TIMESTAMP(3);
