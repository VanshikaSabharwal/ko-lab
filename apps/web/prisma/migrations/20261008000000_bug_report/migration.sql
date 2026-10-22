-- Bug reports, and ModifiedFiles.content becoming optional.
--
-- Both were added to schema.prisma and pushed straight to a database
-- (`prisma db push`) without a migration, so a database built from the
-- migrations alone was missing them. Every statement here creates only what
-- isn't there yet, which makes it safe on databases that already got the push.

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "BugStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'FIXED', 'WONT_FIX');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "BugSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "BugCategory" AS ENUM ('BUG', 'UI', 'PERFORMANCE', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable: drafts keep their text in object storage now, so the row's copy is optional
ALTER TABLE "ModifiedFiles" ALTER COLUMN "content" DROP NOT NULL;

-- CreateTable
CREATE TABLE IF NOT EXISTS "BugReport" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "BugCategory" NOT NULL DEFAULT 'BUG',
    "severity" "BugSeverity" NOT NULL DEFAULT 'MEDIUM',
    "status" "BugStatus" NOT NULL DEFAULT 'OPEN',
    "url" TEXT,
    "userAgent" TEXT,
    "context" JSONB,
    "screenshot" TEXT,
    "githubIssueNo" INTEGER,
    "githubIssueUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BugReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BugReport_reporterId_idx" ON "BugReport"("reporterId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BugReport_status_idx" ON "BugReport"("status");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "BugReport" ADD CONSTRAINT "BugReport_reporterId_fkey"
        FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
