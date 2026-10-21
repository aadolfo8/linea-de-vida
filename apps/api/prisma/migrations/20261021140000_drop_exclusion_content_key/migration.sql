-- Tombstones are legacy: new hides use Photo."hiddenAt" (which follows the content key), and an
-- existing tombstone is matched by Drive file id and converted on sight. The column was never written.
DROP INDEX IF EXISTS "PhotoExclusion_userId_contentKey_idx";
ALTER TABLE "PhotoExclusion" DROP COLUMN IF EXISTS "contentKey";
