-- AlterTable: an invite is now identified by a phone OR an email, so phone
-- becomes nullable and email joins it.
ALTER TABLE "Invite" ALTER COLUMN "phone" DROP NOT NULL;
ALTER TABLE "Invite" ADD COLUMN "email" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Invite_email_groupId_key" ON "Invite"("email", "groupId");
