-- Portadas: photos the user chose to represent a year, a month or the "Sin mes" group. Only
-- references are stored; a hidden, missing or re-dated photo is dropped when covers are read.
CREATE TYPE "CoverScopeKind" AS ENUM ('YEAR', 'MONTH', 'UNKNOWN_MONTH');

CREATE TABLE "PhotoCover" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "CoverScopeKind" NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL DEFAULT 0,
    "photoId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhotoCover_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PhotoCover_userId_kind_year_month_photoId_key" ON "PhotoCover"("userId", "kind", "year", "month", "photoId");
CREATE INDEX "PhotoCover_userId_year_idx" ON "PhotoCover"("userId", "year");
CREATE INDEX "PhotoCover_photoId_idx" ON "PhotoCover"("photoId");

ALTER TABLE "PhotoCover" ADD CONSTRAINT "PhotoCover_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PhotoCover" ADD CONSTRAINT "PhotoCover_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Photo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
