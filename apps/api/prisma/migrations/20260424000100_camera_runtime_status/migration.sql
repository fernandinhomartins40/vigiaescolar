-- CreateTable
CREATE TABLE "CameraRuntimeStatus" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "cameraId" TEXT NOT NULL,
    "gatewayId" TEXT,
    "healthStatus" TEXT NOT NULL DEFAULT 'OFFLINE',
    "lastHeartbeatAt" TIMESTAMP(3),
    "lastFrameAt" TIMESTAMP(3),
    "lastError" TEXT,
    "measuredFps" DOUBLE PRECISION,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CameraRuntimeStatus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CameraRuntimeStatus_cameraId_key" ON "CameraRuntimeStatus"("cameraId");

-- CreateIndex
CREATE INDEX "CameraRuntimeStatus_tenantId_schoolId_idx" ON "CameraRuntimeStatus"("tenantId", "schoolId");

-- CreateIndex
CREATE INDEX "CameraRuntimeStatus_healthStatus_idx" ON "CameraRuntimeStatus"("healthStatus");

-- CreateIndex
CREATE INDEX "CameraRuntimeStatus_lastHeartbeatAt_idx" ON "CameraRuntimeStatus"("lastHeartbeatAt");

-- AddForeignKey
ALTER TABLE "CameraRuntimeStatus" ADD CONSTRAINT "CameraRuntimeStatus_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "Camera"("id") ON DELETE CASCADE ON UPDATE CASCADE;
