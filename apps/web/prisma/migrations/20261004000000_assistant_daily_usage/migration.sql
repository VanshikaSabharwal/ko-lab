-- CreateTable: assistant messages a user has sent on one UTC day.
CREATE TABLE "AssistantDailyUsage" (
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AssistantDailyUsage_pkey" PRIMARY KEY ("userId","day")
);

-- AddForeignKey
ALTER TABLE "AssistantDailyUsage" ADD CONSTRAINT "AssistantDailyUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
