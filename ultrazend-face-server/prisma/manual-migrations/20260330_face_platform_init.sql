BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FaceRecognitionIdentityStatus') THEN
    CREATE TYPE "FaceRecognitionIdentityStatus" AS ENUM ('PENDING', 'REVIEW', 'ACTIVE', 'SUSPENDED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FaceEnrollmentStatus') THEN
    CREATE TYPE "FaceEnrollmentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FaceDeviceType') THEN
    CREATE TYPE "FaceDeviceType" AS ENUM ('CAMERA', 'GATEWAY', 'NVR');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FaceDeviceHealthStatus') THEN
    CREATE TYPE "FaceDeviceHealthStatus" AS ENUM ('ONLINE', 'OFFLINE', 'DEGRADED', 'ERROR');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FaceZoneDirection') THEN
    CREATE TYPE "FaceZoneDirection" AS ENUM ('ENTRY', 'EXIT', 'BOTH');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FaceEventType') THEN
    CREATE TYPE "FaceEventType" AS ENUM ('DETECTION', 'ENTRY', 'EXIT', 'UNMATCHED', 'REVIEW');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FaceMatchStatus') THEN
    CREATE TYPE "FaceMatchStatus" AS ENUM ('MATCHED', 'REVIEW_REQUIRED', 'UNMATCHED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'GuardianNotificationStatus') THEN
    CREATE TYPE "GuardianNotificationStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'SENT', 'FAILED');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.face_recognition_identities (
  id TEXT PRIMARY KEY,
  "personId" TEXT NOT NULL,
  "citizenId" TEXT,
  label TEXT,
  status "FaceRecognitionIdentityStatus" NOT NULL DEFAULT 'PENDING',
  "riskFlags" JSONB,
  notes TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.face_enrollments (
  id TEXT PRIMARY KEY,
  "identityId" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceLabel" TEXT,
  "imagePath" TEXT,
  "qualityScore" DOUBLE PRECISION,
  "livenessScore" DOUBLE PRECISION,
  status "FaceEnrollmentStatus" NOT NULL DEFAULT 'PENDING',
  metadata JSONB,
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.face_embeddings (
  id TEXT PRIMARY KEY,
  "identityId" TEXT NOT NULL,
  "enrollmentId" TEXT,
  "modelName" TEXT NOT NULL,
  "modelVersion" TEXT,
  vector DOUBLE PRECISION[],
  "qualityScore" DOUBLE PRECISION,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.face_devices (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  "unidadeEducacaoId" TEXT,
  type "FaceDeviceType" NOT NULL DEFAULT 'CAMERA',
  protocol TEXT DEFAULT 'RTSP',
  manufacturer TEXT,
  model TEXT,
  "locationDescription" TEXT,
  "streamUrlEncrypted" TEXT,
  "usernameEncrypted" TEXT,
  "passwordEncrypted" TEXT,
  "healthStatus" "FaceDeviceHealthStatus" NOT NULL DEFAULT 'OFFLINE',
  "lastHeartbeatAt" TIMESTAMP(3),
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.face_zones (
  id TEXT PRIMARY KEY,
  "deviceId" TEXT NOT NULL,
  "unidadeEducacaoId" TEXT,
  name TEXT NOT NULL,
  "gateName" TEXT,
  direction "FaceZoneDirection" NOT NULL DEFAULT 'BOTH',
  "dedupeWindowSecs" INTEGER NOT NULL DEFAULT 180,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.face_recognition_events (
  id TEXT PRIMARY KEY,
  "identityId" TEXT,
  "deviceId" TEXT NOT NULL,
  "zoneId" TEXT,
  "unidadeEducacaoId" TEXT,
  "studentCitizenId" TEXT,
  "guardianCitizenId" TEXT,
  type "FaceEventType" NOT NULL,
  "matchStatus" "FaceMatchStatus" NOT NULL,
  confidence DOUBLE PRECISION,
  provider TEXT,
  "modelName" TEXT,
  "modelVersion" TEXT,
  "previewPath" TEXT,
  "boundingBox" JSONB,
  metadata JSONB,
  "dedupeKey" TEXT,
  "reviewReason" TEXT,
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "notificationStatus" "GuardianNotificationStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
  "notificationAttempts" INTEGER NOT NULL DEFAULT 0,
  "lastNotificationError" TEXT,
  "recognizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.school_security_configurations (
  id TEXT PRIMARY KEY,
  "unidadeEducacaoId" TEXT NOT NULL,
  "notifyOnEntry" BOOLEAN NOT NULL DEFAULT TRUE,
  "notifyOnExit" BOOLEAN NOT NULL DEFAULT TRUE,
  "preferredChannel" TEXT NOT NULL DEFAULT 'whatsapp',
  "dedupeWindowSecs" INTEGER NOT NULL DEFAULT 180,
  "entryMessageTemplate" TEXT,
  "exitMessageTemplate" TEXT,
  "activeHoursStart" TEXT,
  "activeHoursEnd" TEXT,
  metadata JSONB,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS face_identities_person_uidx ON public.face_recognition_identities ("personId");
CREATE UNIQUE INDEX IF NOT EXISTS face_identities_citizen_uidx ON public.face_recognition_identities ("citizenId");
CREATE INDEX IF NOT EXISTS face_identities_status_idx ON public.face_recognition_identities (status);
CREATE INDEX IF NOT EXISTS face_enrollments_identity_status_idx ON public.face_enrollments ("identityId", status);
CREATE INDEX IF NOT EXISTS face_enrollments_approved_by_idx ON public.face_enrollments ("approvedById");
CREATE INDEX IF NOT EXISTS face_embeddings_identity_active_idx ON public.face_embeddings ("identityId", "isActive");
CREATE INDEX IF NOT EXISTS face_embeddings_enrollment_idx ON public.face_embeddings ("enrollmentId");
CREATE UNIQUE INDEX IF NOT EXISTS face_devices_code_uidx ON public.face_devices (code);
CREATE INDEX IF NOT EXISTS face_devices_school_active_idx ON public.face_devices ("unidadeEducacaoId", "isActive");
CREATE INDEX IF NOT EXISTS face_devices_health_idx ON public.face_devices ("healthStatus");
CREATE INDEX IF NOT EXISTS face_zones_device_active_idx ON public.face_zones ("deviceId", "isActive");
CREATE INDEX IF NOT EXISTS face_zones_school_idx ON public.face_zones ("unidadeEducacaoId");
CREATE INDEX IF NOT EXISTS face_events_recognized_at_idx ON public.face_recognition_events ("recognizedAt");
CREATE INDEX IF NOT EXISTS face_events_type_match_idx ON public.face_recognition_events (type, "matchStatus");
CREATE INDEX IF NOT EXISTS face_events_device_recognized_idx ON public.face_recognition_events ("deviceId", "recognizedAt");
CREATE INDEX IF NOT EXISTS face_events_zone_recognized_idx ON public.face_recognition_events ("zoneId", "recognizedAt");
CREATE INDEX IF NOT EXISTS face_events_student_recognized_idx ON public.face_recognition_events ("studentCitizenId", "recognizedAt");
CREATE INDEX IF NOT EXISTS face_events_guardian_notification_idx ON public.face_recognition_events ("guardianCitizenId", "notificationStatus");
CREATE UNIQUE INDEX IF NOT EXISTS school_security_config_school_uidx ON public.school_security_configurations ("unidadeEducacaoId");
CREATE INDEX IF NOT EXISTS school_security_config_active_idx ON public.school_security_configurations ("isActive");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'face_recognition_identities_personId_fkey') THEN
    ALTER TABLE public.face_recognition_identities
      ADD CONSTRAINT "face_recognition_identities_personId_fkey"
      FOREIGN KEY ("personId") REFERENCES public.people(id) ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'face_recognition_identities_citizenId_fkey') THEN
    ALTER TABLE public.face_recognition_identities
      ADD CONSTRAINT "face_recognition_identities_citizenId_fkey"
      FOREIGN KEY ("citizenId") REFERENCES public.citizens(id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'face_enrollments_identityId_fkey') THEN
    ALTER TABLE public.face_enrollments
      ADD CONSTRAINT "face_enrollments_identityId_fkey"
      FOREIGN KEY ("identityId") REFERENCES public.face_recognition_identities(id) ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'face_enrollments_approvedById_fkey') THEN
    ALTER TABLE public.face_enrollments
      ADD CONSTRAINT "face_enrollments_approvedById_fkey"
      FOREIGN KEY ("approvedById") REFERENCES public.users(id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'face_embeddings_identityId_fkey') THEN
    ALTER TABLE public.face_embeddings
      ADD CONSTRAINT "face_embeddings_identityId_fkey"
      FOREIGN KEY ("identityId") REFERENCES public.face_recognition_identities(id) ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'face_embeddings_enrollmentId_fkey') THEN
    ALTER TABLE public.face_embeddings
      ADD CONSTRAINT "face_embeddings_enrollmentId_fkey"
      FOREIGN KEY ("enrollmentId") REFERENCES public.face_enrollments(id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'face_devices_unidadeEducacaoId_fkey') THEN
    ALTER TABLE public.face_devices
      ADD CONSTRAINT "face_devices_unidadeEducacaoId_fkey"
      FOREIGN KEY ("unidadeEducacaoId") REFERENCES public.unidades_educacao(id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'face_zones_deviceId_fkey') THEN
    ALTER TABLE public.face_zones
      ADD CONSTRAINT "face_zones_deviceId_fkey"
      FOREIGN KEY ("deviceId") REFERENCES public.face_devices(id) ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'face_zones_unidadeEducacaoId_fkey') THEN
    ALTER TABLE public.face_zones
      ADD CONSTRAINT "face_zones_unidadeEducacaoId_fkey"
      FOREIGN KEY ("unidadeEducacaoId") REFERENCES public.unidades_educacao(id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'face_recognition_events_identityId_fkey') THEN
    ALTER TABLE public.face_recognition_events
      ADD CONSTRAINT "face_recognition_events_identityId_fkey"
      FOREIGN KEY ("identityId") REFERENCES public.face_recognition_identities(id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'face_recognition_events_deviceId_fkey') THEN
    ALTER TABLE public.face_recognition_events
      ADD CONSTRAINT "face_recognition_events_deviceId_fkey"
      FOREIGN KEY ("deviceId") REFERENCES public.face_devices(id) ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'face_recognition_events_zoneId_fkey') THEN
    ALTER TABLE public.face_recognition_events
      ADD CONSTRAINT "face_recognition_events_zoneId_fkey"
      FOREIGN KEY ("zoneId") REFERENCES public.face_zones(id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'face_recognition_events_unidadeEducacaoId_fkey') THEN
    ALTER TABLE public.face_recognition_events
      ADD CONSTRAINT "face_recognition_events_unidadeEducacaoId_fkey"
      FOREIGN KEY ("unidadeEducacaoId") REFERENCES public.unidades_educacao(id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'face_recognition_events_studentCitizenId_fkey') THEN
    ALTER TABLE public.face_recognition_events
      ADD CONSTRAINT "face_recognition_events_studentCitizenId_fkey"
      FOREIGN KEY ("studentCitizenId") REFERENCES public.citizens(id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'face_recognition_events_guardianCitizenId_fkey') THEN
    ALTER TABLE public.face_recognition_events
      ADD CONSTRAINT "face_recognition_events_guardianCitizenId_fkey"
      FOREIGN KEY ("guardianCitizenId") REFERENCES public.citizens(id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'face_recognition_events_reviewedById_fkey') THEN
    ALTER TABLE public.face_recognition_events
      ADD CONSTRAINT "face_recognition_events_reviewedById_fkey"
      FOREIGN KEY ("reviewedById") REFERENCES public.users(id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'school_security_configurations_unidadeEducacaoId_fkey') THEN
    ALTER TABLE public.school_security_configurations
      ADD CONSTRAINT "school_security_configurations_unidadeEducacaoId_fkey"
      FOREIGN KEY ("unidadeEducacaoId") REFERENCES public.unidades_educacao(id) ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
