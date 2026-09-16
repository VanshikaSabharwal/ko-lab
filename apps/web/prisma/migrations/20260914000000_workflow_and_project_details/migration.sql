-- AlterTable: project details for the workspace panel
ALTER TABLE "Group" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "Group" ADD COLUMN IF NOT EXISTS "coverImage" TEXT;

-- AlterTable: persisted workflow canvas position
ALTER TABLE "PlanningTask" ADD COLUMN IF NOT EXISTS "flowX" DOUBLE PRECISION;
ALTER TABLE "PlanningTask" ADD COLUMN IF NOT EXISTS "flowY" DOUBLE PRECISION;

-- CreateTable: task dependency edges
CREATE TABLE IF NOT EXISTS "PlanningTaskDependency" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "blockerId" TEXT NOT NULL,
    "dependentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlanningTaskDependency_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PlanningTaskDependency_blockerId_dependentId_key" ON "PlanningTaskDependency"("blockerId", "dependentId");
CREATE INDEX IF NOT EXISTS "PlanningTaskDependency_groupId_idx" ON "PlanningTaskDependency"("groupId");
CREATE INDEX IF NOT EXISTS "PlanningTaskDependency_dependentId_idx" ON "PlanningTaskDependency"("dependentId");

ALTER TABLE "PlanningTaskDependency" DROP CONSTRAINT IF EXISTS "PlanningTaskDependency_blockerId_fkey";
ALTER TABLE "PlanningTaskDependency" ADD CONSTRAINT "PlanningTaskDependency_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "PlanningTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlanningTaskDependency" DROP CONSTRAINT IF EXISTS "PlanningTaskDependency_dependentId_fkey";
ALTER TABLE "PlanningTaskDependency" ADD CONSTRAINT "PlanningTaskDependency_dependentId_fkey" FOREIGN KEY ("dependentId") REFERENCES "PlanningTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
