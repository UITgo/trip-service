-- AlterTable
ALTER TABLE "Trip" ADD COLUMN "cityCode" TEXT;

-- CreateIndex
CREATE INDEX "Trip_cityCode_status_idx" ON "Trip"("cityCode", "status");

