-- Assistant write actions: proposals awaiting the user's confirmation, kept
-- afterwards as the audit trail of what the assistant changed.

-- CreateEnum
CREATE TYPE "AssistantActionStatus" AS ENUM ('PENDING', 'EXECUTED', 'CANCELLED', 'FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "AssistantAction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT,
    "tool" TEXT NOT NULL,
    "args" JSONB NOT NULL,
    "preview" JSONB NOT NULL,
    "status" "AssistantActionStatus" NOT NULL DEFAULT 'PENDING',
    "result" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "AssistantAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssistantAction_userId_status_idx" ON "AssistantAction"("userId", "status");

-- AddForeignKey
ALTER TABLE "AssistantAction" ADD CONSTRAINT "AssistantAction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
