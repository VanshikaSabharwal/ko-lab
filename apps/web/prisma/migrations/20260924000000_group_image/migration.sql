-- AlterTable: an uploaded group photo. Nullable, so existing groups keep
-- rendering their gradient initial.
ALTER TABLE "Group" ADD COLUMN "image" TEXT;
