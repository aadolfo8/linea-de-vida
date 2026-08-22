-- Repair databases where the initial migration was recorded without creating OAuthState.
CREATE TABLE IF NOT EXISTS "OAuthState" (
  "id" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "userId" TEXT,
  "codeVerifier" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OAuthState_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "OAuthState_expiresAt_idx" ON "OAuthState"("expiresAt");
