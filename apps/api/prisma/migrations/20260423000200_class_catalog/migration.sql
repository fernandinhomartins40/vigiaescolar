-- CreateTable
CREATE TABLE "SchoolClass" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shift" "StudentShift" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolClass_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Student" ADD COLUMN "classId" TEXT;

-- CreateIndex
CREATE INDEX "SchoolClass_tenantId_schoolId_idx" ON "SchoolClass"("tenantId", "schoolId");

-- CreateIndex
CREATE INDEX "SchoolClass_tenantId_schoolId_shift_idx" ON "SchoolClass"("tenantId", "schoolId", "shift");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolClass_tenantId_schoolId_name_shift_key" ON "SchoolClass"("tenantId", "schoolId", "name", "shift");

-- Backfill existing classes from student records
INSERT INTO "SchoolClass" ("id", "tenantId", "schoolId", "name", "shift", "isActive", "createdAt", "updatedAt")
SELECT DISTINCT
    'class-' || md5("tenantId" || '|' || "schoolId" || '|' || TRIM("className") || '|' || ("shift")::text) AS "id",
    "tenantId",
    "schoolId",
    TRIM("className") AS "name",
    "shift",
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Student"
WHERE COALESCE(TRIM("className"), '') <> '';

UPDATE "Student" s
SET "classId" = c."id"
FROM "SchoolClass" c
WHERE s."tenantId" = c."tenantId"
  AND s."schoolId" = c."schoolId"
  AND TRIM(s."className") = c."name"
  AND s."shift" = c."shift";

-- CreateIndex
CREATE INDEX "Student_tenantId_classId_idx" ON "Student"("tenantId", "classId");

-- AddForeignKey
ALTER TABLE "SchoolClass" ADD CONSTRAINT "SchoolClass_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolClass" ADD CONSTRAINT "SchoolClass_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE SET NULL ON UPDATE CASCADE;
