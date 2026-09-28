-- CreateTable
CREATE TABLE "HolidaysCache" (
    "id" TEXT NOT NULL DEFAULT 'admin',
    "data" JSONB NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HolidaysCache_pkey" PRIMARY KEY ("id")
);
