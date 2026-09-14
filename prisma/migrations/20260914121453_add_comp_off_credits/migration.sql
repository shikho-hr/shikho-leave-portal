-- Compensatory Off balance: banked "additional work days" employees can
-- accumulate and later draw leave from. Every statement here is additive or
-- widening, so the currently-deployed code keeps working between this
-- migration running (in the Vercel build) and the new code going live.

-- AlterTable: a comp-off notification points at a credit, not a leave.
ALTER TABLE "Notification" ALTER COLUMN "leaveId" DROP NOT NULL;
ALTER TABLE "Notification" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'comment';
ALTER TABLE "Notification" ADD COLUMN "creditId" TEXT;

-- CreateTable
CREATE TABLE "CompOffCredit" (
    "id" TEXT NOT NULL,
    "employeeEmail" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "days" DECIMAL(2,1) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "consumedDays" DECIMAL(3,1) NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'employee',
    "reviewedBy" TEXT NOT NULL DEFAULT '',
    "reviewedOn" TEXT NOT NULL DEFAULT '',
    "reviewerComments" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompOffCredit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompOffCredit_employeeEmail_status_idx" ON "CompOffCredit"("employeeEmail", "status");

-- CreateIndex
CREATE INDEX "CompOffCredit_employeeEmail_workDate_idx" ON "CompOffCredit"("employeeEmail", "workDate");

-- AddForeignKey
ALTER TABLE "CompOffCredit" ADD CONSTRAINT "CompOffCredit_employeeEmail_fkey" FOREIGN KEY ("employeeEmail") REFERENCES "Employee"("email") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_creditId_fkey" FOREIGN KEY ("creditId") REFERENCES "CompOffCredit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
