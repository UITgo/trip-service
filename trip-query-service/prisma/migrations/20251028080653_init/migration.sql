-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('REQUESTED', 'DRIVER_SEARCHING', 'DRIVER_ASSIGNED', 'EN_ROUTE_TO_PICKUP', 'ARRIVED', 'IN_TRIP', 'COMPLETED', 'CANCELED', 'EXPIRED');

-- CreateTable
CREATE TABLE "Trip" (
    "id" TEXT NOT NULL,
    "passengerId" TEXT NOT NULL,
    "driverId" TEXT,
    "originLat" DOUBLE PRECISION NOT NULL,
    "originLng" DOUBLE PRECISION NOT NULL,
    "destLat" DOUBLE PRECISION NOT NULL,
    "destLng" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "status" "TripStatus" NOT NULL DEFAULT 'REQUESTED',
    "quoteDistanceKm" DOUBLE PRECISION,
    "quoteDurationMin" DOUBLE PRECISION,
    "quoteFareTotal" INTEGER,
    "actualDistanceKm" DOUBLE PRECISION,
    "actualDurationMin" DOUBLE PRECISION,
    "finalFareTotal" INTEGER,
    "canceledAt" TIMESTAMP(3),
    "cancelReasonCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripEvent" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TripEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripAssignment" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "ttlSec" INTEGER NOT NULL,

    CONSTRAINT "TripAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripRating" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "raterId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TripRating_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Trip_status_createdAt_idx" ON "Trip"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Trip_passengerId_createdAt_idx" ON "Trip"("passengerId", "createdAt");

-- CreateIndex
CREATE INDEX "Trip_driverId_status_idx" ON "Trip"("driverId", "status");

-- CreateIndex
CREATE INDEX "TripEvent_tripId_at_idx" ON "TripEvent"("tripId", "at");

-- CreateIndex
CREATE INDEX "TripAssignment_tripId_state_idx" ON "TripAssignment"("tripId", "state");

-- CreateIndex
CREATE INDEX "TripAssignment_driverId_state_idx" ON "TripAssignment"("driverId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "TripAssignment_tripId_driverId_key" ON "TripAssignment"("tripId", "driverId");

-- CreateIndex
CREATE UNIQUE INDEX "TripRating_tripId_key" ON "TripRating"("tripId");

-- AddForeignKey
ALTER TABLE "TripEvent" ADD CONSTRAINT "TripEvent_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripAssignment" ADD CONSTRAINT "TripAssignment_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripRating" ADD CONSTRAINT "TripRating_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
