-- CreateTable
CREATE TABLE "RosterCache" (
    "id" TEXT NOT NULL DEFAULT 'admin',
    "data" JSONB NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RosterCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvailableLeaveTypesCache" (
    "id" TEXT NOT NULL DEFAULT 'admin',
    "data" JSONB NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AvailableLeaveTypesCache_pkey" PRIMARY KEY ("id")
);
