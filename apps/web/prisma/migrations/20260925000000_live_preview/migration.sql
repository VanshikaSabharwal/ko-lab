-- CreateTable: temporary hosted static-site previews ("Make it live").
CREATE TABLE "LivePreview" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "rootDir" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "shareToken" TEXT,
    "shareExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LivePreview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LivePreview_token_key" ON "LivePreview"("token");
CREATE UNIQUE INDEX "LivePreview_shareToken_key" ON "LivePreview"("shareToken");
CREATE UNIQUE INDEX "LivePreview_groupId_userId_key" ON "LivePreview"("groupId", "userId");
CREATE INDEX "LivePreview_expiresAt_idx" ON "LivePreview"("expiresAt");
