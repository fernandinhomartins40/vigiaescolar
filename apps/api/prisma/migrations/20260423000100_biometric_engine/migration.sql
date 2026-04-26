-- CreateEnum
CREATE TYPE "FaceMatchStatus" AS ENUM ('MATCHED', 'REVIEW_REQUIRED', 'UNMATCHED');

-- CreateEnum
CREATE TYPE "FaceRecognitionType" AS ENUM ('ENTRY', 'EXIT', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "FaceEnrollmentSource" AS ENUM ('ADMIN_UPLOAD', 'LIVE_CAPTURE', 'MIGRATION');

-- CreateTable
CREATE TABLE "FaceIdentity" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FaceIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FaceEnrollment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "identityId" TEXT NOT NULL,
    "imagePath" TEXT NOT NULL,
    "sourceType" "FaceEnrollmentSource" NOT NULL DEFAULT 'ADMIN_UPLOAD',
    "sourceLabel" TEXT,
    "metadata" JSONB,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FaceEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FaceEmbedding" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "identityId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "modelVersion" TEXT,
    "vector" JSONB NOT NULL,
    "qualityScore" DOUBLE PRECISION,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FaceEmbedding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FaceRecognitionEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "cameraId" TEXT,
    "studentId" TEXT,
    "identityId" TEXT,
    "attendanceId" TEXT,
    "type" "FaceRecognitionType" NOT NULL,
    "matchStatus" "FaceMatchStatus" NOT NULL,
    "confidence" DOUBLE PRECISION,
    "reviewReason" TEXT,
    "snapshotPath" TEXT,
    "metadata" JSONB,
    "dedupeKey" TEXT,
    "recognizedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FaceRecognitionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FaceIdentity_tenantId_schoolId_idx" ON "FaceIdentity"("tenantId", "schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "FaceIdentity_tenantId_studentId_key" ON "FaceIdentity"("tenantId", "studentId");

-- CreateIndex
CREATE INDEX "FaceEnrollment_tenantId_identityId_idx" ON "FaceEnrollment"("tenantId", "identityId");

-- CreateIndex
CREATE INDEX "FaceEmbedding_tenantId_identityId_isActive_idx" ON "FaceEmbedding"("tenantId", "identityId", "isActive");

-- CreateIndex
CREATE INDEX "FaceRecognitionEvent_tenantId_recognizedAt_idx" ON "FaceRecognitionEvent"("tenantId", "recognizedAt");

-- CreateIndex
CREATE INDEX "FaceRecognitionEvent_tenantId_schoolId_idx" ON "FaceRecognitionEvent"("tenantId", "schoolId");

-- CreateIndex
CREATE INDEX "FaceRecognitionEvent_tenantId_cameraId_idx" ON "FaceRecognitionEvent"("tenantId", "cameraId");

-- CreateIndex
CREATE INDEX "FaceRecognitionEvent_tenantId_studentId_idx" ON "FaceRecognitionEvent"("tenantId", "studentId");

-- AddForeignKey
ALTER TABLE "FaceIdentity" ADD CONSTRAINT "FaceIdentity_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaceIdentity" ADD CONSTRAINT "FaceIdentity_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaceIdentity" ADD CONSTRAINT "FaceIdentity_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaceEnrollment" ADD CONSTRAINT "FaceEnrollment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaceEnrollment" ADD CONSTRAINT "FaceEnrollment_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "FaceIdentity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaceEnrollment" ADD CONSTRAINT "FaceEnrollment_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaceEmbedding" ADD CONSTRAINT "FaceEmbedding_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaceEmbedding" ADD CONSTRAINT "FaceEmbedding_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "FaceIdentity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaceEmbedding" ADD CONSTRAINT "FaceEmbedding_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "FaceEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaceRecognitionEvent" ADD CONSTRAINT "FaceRecognitionEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaceRecognitionEvent" ADD CONSTRAINT "FaceRecognitionEvent_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaceRecognitionEvent" ADD CONSTRAINT "FaceRecognitionEvent_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "Camera"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaceRecognitionEvent" ADD CONSTRAINT "FaceRecognitionEvent_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaceRecognitionEvent" ADD CONSTRAINT "FaceRecognitionEvent_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "FaceIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaceRecognitionEvent" ADD CONSTRAINT "FaceRecognitionEvent_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "Attendance"("id") ON DELETE SET NULL ON UPDATE CASCADE;
