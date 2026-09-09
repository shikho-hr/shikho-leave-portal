-- CreateTable
CREATE TABLE "Employee" (
    "email" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "joiningDate" DATE NOT NULL,
    "designation" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "employeeType" TEXT NOT NULL,
    "managerEmail" TEXT,
    "probationEndDate" DATE,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "fullTimeEffectiveDate" DATE,
    "gender" TEXT,
    "contractType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("email")
);

-- CreateTable
CREATE TABLE "Leave" (
    "id" TEXT NOT NULL,
    "employeeEmail" TEXT NOT NULL,
    "employeeName" TEXT NOT NULL,
    "leaveType" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "days" DECIMAL(5,1) NOT NULL,
    "daysByYear" JSONB NOT NULL DEFAULT '{}',
    "halfDayPeriod" TEXT,
    "extraWorkStartDate" DATE,
    "extraWorkEndDate" DATE,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "appliedOn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedBy" TEXT NOT NULL DEFAULT '',
    "reviewedOn" TEXT NOT NULL DEFAULT '',
    "reviewerComments" TEXT NOT NULL DEFAULT '',
    "rejectedByRole" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Leave_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveComment" (
    "id" TEXT NOT NULL,
    "leaveId" TEXT NOT NULL,
    "authorEmail" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "comment" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalNote" (
    "id" TEXT NOT NULL,
    "leaveId" TEXT NOT NULL,
    "authorEmail" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "comment" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InternalNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holiday" (
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("date")
);

-- CreateTable
CREATE TABLE "OpeningBalance" (
    "email" TEXT NOT NULL,
    "sick" DECIMAL(5,1),
    "casual" DECIMAL(5,1),
    "annual" DECIMAL(5,1),
    "marriage" DECIMAL(5,1),
    "maternity" DECIMAL(5,1),
    "paternity" DECIMAL(5,1),
    "ladiesWfh" DECIMAL(5,1),
    "compassionate" DECIMAL(5,1),
    "compensatory" DECIMAL(5,1),
    "wfh" DECIMAL(5,1),
    "unpaid" DECIMAL(5,1),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpeningBalance_pkey" PRIMARY KEY ("email")
);

-- CreateTable
CREATE TABLE "BalanceSnapshot" (
    "email" TEXT NOT NULL,
    "casualEntitled" DECIMAL(5,1),
    "casualTaken" DECIMAL(5,1),
    "casualBalance" DECIMAL(5,1),
    "sickEntitled" DECIMAL(5,1),
    "sickTaken" DECIMAL(5,1),
    "sickBalance" DECIMAL(5,1),
    "annualEntitled" DECIMAL(5,1),
    "annualTaken" DECIMAL(5,1),
    "annualBalance" DECIMAL(5,1),
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BalanceSnapshot_pkey" PRIMARY KEY ("email")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "leaveId" TEXT NOT NULL,
    "leaveType" TEXT NOT NULL,
    "employeeName" TEXT NOT NULL,
    "commentAuthorName" TEXT NOT NULL,
    "commentPreview" TEXT NOT NULL,
    "isInternalNote" BOOLEAN NOT NULL DEFAULT false,
    "isSubmission" BOOLEAN NOT NULL DEFAULT false,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Employee_id_key" ON "Employee"("id");

-- CreateIndex
CREATE INDEX "Employee_managerEmail_idx" ON "Employee"("managerEmail");

-- CreateIndex
CREATE INDEX "Employee_status_idx" ON "Employee"("status");

-- CreateIndex
CREATE INDEX "Employee_role_idx" ON "Employee"("role");

-- CreateIndex
CREATE INDEX "Leave_employeeEmail_appliedOn_idx" ON "Leave"("employeeEmail", "appliedOn" DESC);

-- CreateIndex
CREATE INDEX "Leave_status_appliedOn_idx" ON "Leave"("status", "appliedOn" DESC);

-- CreateIndex
CREATE INDEX "Leave_status_endDate_startDate_idx" ON "Leave"("status", "endDate", "startDate");

-- CreateIndex
CREATE INDEX "Leave_employeeEmail_status_idx" ON "Leave"("employeeEmail", "status");

-- CreateIndex
CREATE INDEX "LeaveComment_leaveId_createdAt_idx" ON "LeaveComment"("leaveId", "createdAt" ASC);

-- CreateIndex
CREATE INDEX "InternalNote_leaveId_createdAt_idx" ON "InternalNote"("leaveId", "createdAt" ASC);

-- CreateIndex
CREATE INDEX "Notification_recipientEmail_createdAt_idx" ON "Notification"("recipientEmail", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_managerEmail_fkey" FOREIGN KEY ("managerEmail") REFERENCES "Employee"("email") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Leave" ADD CONSTRAINT "Leave_employeeEmail_fkey" FOREIGN KEY ("employeeEmail") REFERENCES "Employee"("email") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveComment" ADD CONSTRAINT "LeaveComment_leaveId_fkey" FOREIGN KEY ("leaveId") REFERENCES "Leave"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalNote" ADD CONSTRAINT "InternalNote_leaveId_fkey" FOREIGN KEY ("leaveId") REFERENCES "Leave"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpeningBalance" ADD CONSTRAINT "OpeningBalance_email_fkey" FOREIGN KEY ("email") REFERENCES "Employee"("email") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BalanceSnapshot" ADD CONSTRAINT "BalanceSnapshot_email_fkey" FOREIGN KEY ("email") REFERENCES "Employee"("email") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientEmail_fkey" FOREIGN KEY ("recipientEmail") REFERENCES "Employee"("email") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_leaveId_fkey" FOREIGN KEY ("leaveId") REFERENCES "Leave"("id") ON DELETE CASCADE ON UPDATE CASCADE;
