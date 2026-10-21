-- Soft hide: hiding keeps the row so it can be shown again immediately and so the hidden state
-- follows the photo's content to any new copy.
ALTER TABLE "Photo" ADD COLUMN "hiddenAt" TIMESTAMP(3);
CREATE INDEX "Photo_userId_status_hiddenAt_idx" ON "Photo"("userId", "status", "hiddenAt");
