CREATE TYPE "ActionType" AS ENUM ('CALL', 'EMAIL', 'MEETING', 'TASK', 'OTHER');
CREATE TABLE "Action" (
 "id" SERIAL NOT NULL,
 "prospectId" INTEGER NOT NULL,
 "type" "ActionType" NOT NULL,
 "title" TEXT NOT NULL,
 "description" TEXT,
 "dueAt" TIMESTAMPTZ(3) NOT NULL,
 "completedAt" TIMESTAMPTZ(3),
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMPTZ(3) NOT NULL,
 CONSTRAINT "Action_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Action_prospectId_idx" ON "Action"("prospectId");
CREATE INDEX "Action_dueAt_idx" ON "Action"("dueAt");
ALTER TABLE "Action" ADD CONSTRAINT "Action_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
