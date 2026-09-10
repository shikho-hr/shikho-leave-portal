-- CreateTable
CREATE TABLE "EmployeeBalanceCache" (
    "id" TEXT NOT NULL DEFAULT 'admin',
    "data" JSONB NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeBalanceCache_pkey" PRIMARY KEY ("id")
);
