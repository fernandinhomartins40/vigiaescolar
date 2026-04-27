import {
  AttendanceStatus,
  CameraEventType,
  CameraStatus,
  CameraType,
  FaceMatchStatus,
  FaceRecognitionType,
  NotificationChannel,
  NotificationStatus,
  NotificationType,
  Prisma,
  StudentStatus,
} from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler, badRequest, notFound } from "../lib/http";
import { prisma } from "../lib/prisma";
import { decryptSecret } from "../lib/security";
import { formatTime, localDateKey } from "../lib/security";
import { requireCameraGatewayService } from "../middleware/service-auth";
import { biometricEngine } from "../services/biometrics/engine";
import { biometricStorage } from "../services/biometrics/storage";
import { refreshStudentPresence } from "../lib/presence-state";

const router = Router();

router.use(requireCameraGatewayService);

const heartbeatSchema = z.object({
  tenantId: z.string().trim().min(1),
  schoolId: z.string().trim().min(1),
  cameraId: z.string().trim().min(1),
  gatewayId: z.string().trim().optional(),
  healthStatus: z.enum(["ONLINE", "OFFLINE", "DEGRADED", "ERROR"]).default("ONLINE"),
  lastHeartbeatAt: z.string().datetime().optional(),
  lastFrameAt: z.string().datetime().optional(),
  lastError: z.string().trim().max(2000).nullable().optional(),
  measuredFps: z.coerce.number().min(0).max(240).nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const recognitionSchema = z.object({
  tenantId: z.string().trim().min(1),
  schoolId: z.string().trim().min(1),
  cameraId: z.string().trim().min(1),
  imageBase64: z.string().trim().min(1),
  capturedAt: z.string().datetime().optional(),
  direction: z.enum(["ENTRY", "EXIT", "UNKNOWN"]).default("UNKNOWN"),
  metadata: z.record(z.unknown()).optional(),
});

function safeDecryptSecret(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    return decryptSecret(value);
  } catch {
    return null;
  }
}

function parseOptionalDate(value?: string) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw badRequest("Data de heartbeat invalida");
  }

  return date;
}

router.get(
  "/cameras",
  asyncHandler(async (req, res) => {
    // Gateways locais (instalados no mesmo dispositivo da câmera USB) podem
    // requisitar câmeras USB passando o header X-Gateway-Local: true.
    // Gateways remotos (VPS/cloud) recebem apenas câmeras de rede (RTSP/IP).
    const isLocal = req.headers["x-gateway-local"] === "true";

    const cameras = await prisma.camera.findMany({
      where: {
        status: CameraStatus.ACTIVE,
        type: {
          in: isLocal
            ? [CameraType.RTSP, CameraType.IP, CameraType.USB]
            : [CameraType.RTSP, CameraType.IP],
        },
      },
      include: {
        school: {
          select: {
            id: true,
            name: true,
            openingTime: true,
            closingTime: true,
            toleranceMinutes: true,
          },
        },
        runtimeStatus: true,
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    res.json({
      cameras: cameras.map((camera) => ({
        id: camera.id,
        tenantId: camera.tenantId,
        schoolId: camera.schoolId,
        name: camera.name,
        location: camera.location,
        type: camera.type,
        streamUrl: camera.streamUrl,
        resolution: camera.resolution,
        configuredFps: camera.fps,
        recognitionStartTime: camera.recognitionStartTime,
        recognitionEndTime: camera.recognitionEndTime,
        username: camera.username,
        password: safeDecryptSecret(camera.passwordEncrypted),
        school: camera.school,
        runtimeStatus: camera.runtimeStatus,
      })),
      timestamp: new Date().toISOString(),
    });
  }),
);

router.post(
  "/heartbeat",
  asyncHandler(async (req, res) => {
    const body = heartbeatSchema.parse(req.body);
    const camera = await prisma.camera.findFirst({
      where: {
        id: body.cameraId,
        tenantId: body.tenantId,
        schoolId: body.schoolId,
      },
      select: {
        id: true,
        tenantId: true,
        schoolId: true,
      },
    });

    if (!camera) {
      throw notFound("Camera nao encontrada para heartbeat");
    }

    const lastHeartbeatAt = parseOptionalDate(body.lastHeartbeatAt) ?? new Date();
    const lastFrameAt = parseOptionalDate(body.lastFrameAt);

    const runtimeStatus = await prisma.cameraRuntimeStatus.upsert({
      where: {
        cameraId: camera.id,
      },
      create: {
        tenantId: camera.tenantId,
        schoolId: camera.schoolId,
        cameraId: camera.id,
        gatewayId: body.gatewayId,
        healthStatus: body.healthStatus,
        lastHeartbeatAt,
        lastFrameAt,
        lastError: body.lastError ?? null,
        measuredFps: body.measuredFps ?? null,
        metadata: (body.metadata ?? {}) as Prisma.InputJsonValue,
      },
      update: {
        tenantId: camera.tenantId,
        schoolId: camera.schoolId,
        gatewayId: body.gatewayId,
        healthStatus: body.healthStatus,
        lastHeartbeatAt,
        ...(lastFrameAt ? { lastFrameAt } : {}),
        lastError: body.lastError ?? null,
        measuredFps: body.measuredFps ?? null,
        metadata: (body.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });

    res.json({
      ok: true,
      runtimeStatus,
    });
  }),
);

function resolveAttendanceStatus(recognizedAt: Date, openingTime: string, toleranceMinutes: number) {
  const [hours, minutes] = openingTime.split(":").map((value) => Number(value));
  const opening = new Date(recognizedAt);
  opening.setHours(hours, minutes, 0, 0);

  const tolerance = new Date(opening);
  tolerance.setMinutes(tolerance.getMinutes() + toleranceMinutes);

  return recognizedAt > tolerance ? AttendanceStatus.LATE : AttendanceStatus.PRESENT;
}

function notificationPayload(params: {
  studentName: string;
  schoolName: string;
  recognizedAt: Date;
  attendanceStatus: AttendanceStatus;
  eventType: FaceRecognitionType;
}) {
  const time = formatTime(params.recognizedAt);
  if (params.attendanceStatus === AttendanceStatus.LATE) {
    return { type: NotificationType.LATE, message: `${params.studentName} chegou atrasado em ${params.schoolName} as ${time}.` };
  }
  if (params.eventType === FaceRecognitionType.EXIT) {
    return { type: NotificationType.EXIT, message: `${params.studentName} saiu de ${params.schoolName} as ${time}.` };
  }
  return { type: NotificationType.ENTRY, message: `${params.studentName} entrou em ${params.schoolName} as ${time}.` };
}

router.post(
  "/recognition",
  asyncHandler(async (req, res) => {
    const body = recognitionSchema.parse(req.body);
    const recognizedAt = body.capturedAt ? new Date(body.capturedAt) : new Date();
    if (Number.isNaN(recognizedAt.getTime())) {
      throw badRequest("Data de captura invalida");
    }

    const camera = await prisma.camera.findFirst({
      where: {
        id: body.cameraId,
        tenantId: body.tenantId,
        schoolId: body.schoolId,
        status: CameraStatus.ACTIVE,
      },
      include: { school: true },
    });

    if (!camera) {
      throw notFound("Camera nao encontrada para reconhecimento");
    }

    const snapshot = await biometricStorage.persistBase64Image("gateway-events", body.imageBase64);
    try {
      const recognition = await biometricEngine.findBestMatch({
        tenantId: camera.tenantId,
        schoolId: camera.schoolId,
        imageBase64: body.imageBase64,
        cameraId: camera.id,
        direction:
          body.direction === "EXIT"
            ? FaceRecognitionType.EXIT
            : body.direction === "ENTRY"
              ? FaceRecognitionType.ENTRY
              : FaceRecognitionType.UNKNOWN,
        recognizedAt,
      });

      const eventType =
        recognition.matchStatus === FaceMatchStatus.MATCHED
          ? body.direction === "EXIT"
            ? FaceRecognitionType.EXIT
            : FaceRecognitionType.ENTRY
          : FaceRecognitionType.UNKNOWN;
      const matchedStudent = recognition.identity?.student ?? null;
      const dateKey = localDateKey(recognizedAt);

      const result = await prisma.$transaction(async (tx) => {
        let attendance = null;
        let cameraEvent = null;
        let notification = null;

        if (recognition.matchStatus === FaceMatchStatus.MATCHED && matchedStudent) {
          const student = await tx.student.findFirst({
            where: {
              id: matchedStudent.id,
              tenantId: camera.tenantId,
              schoolId: camera.schoolId,
              status: StudentStatus.ACTIVE,
            },
          });

          if (!student) {
            throw badRequest("Aluno reconhecido nao esta ativo nesta escola");
          }

          const attendanceStatus =
            eventType === FaceRecognitionType.EXIT
              ? AttendanceStatus.LEFT
              : resolveAttendanceStatus(recognizedAt, camera.school.openingTime, camera.school.toleranceMinutes);

          attendance = await tx.attendance.upsert({
            where: {
              tenantId_studentId_date: {
                tenantId: camera.tenantId,
                studentId: student.id,
                date: dateKey,
              },
            },
            create: {
              tenantId: camera.tenantId,
              studentId: student.id,
              schoolId: camera.schoolId,
              cameraId: camera.id,
              date: dateKey,
              status: attendanceStatus,
              entryAt: eventType === FaceRecognitionType.EXIT ? null : recognizedAt,
              exitAt: eventType === FaceRecognitionType.EXIT ? recognizedAt : null,
              recognized: true,
              confidence: recognition.confidence,
              notified: false,
              notes: recognition.reviewReason,
            },
            update: {
              schoolId: camera.schoolId,
              cameraId: camera.id,
              status: attendanceStatus,
              recognized: true,
              confidence: recognition.confidence,
              notified: false,
              notes: recognition.reviewReason,
              ...(eventType === FaceRecognitionType.EXIT
                ? { exitAt: recognizedAt }
                : { entryAt: recognizedAt, exitAt: null }),
            },
          });

          cameraEvent = await tx.cameraEvent.create({
            data: {
              tenantId: camera.tenantId,
              schoolId: camera.schoolId,
              cameraId: camera.id,
              studentId: student.id,
              attendanceId: attendance.id,
              type: eventType === FaceRecognitionType.EXIT ? CameraEventType.EXIT : CameraEventType.ENTRY,
              recognized: true,
              confidence: recognition.confidence,
              snapshotUrl: snapshot.publicPath,
              happenedAt: recognizedAt,
            },
          });

          const linkedGuardian = await tx.studentGuardian.findFirst({
            where: { tenantId: camera.tenantId, studentId: student.id },
            orderBy: { createdAt: "asc" },
            select: { guardianId: true },
          });
          const guardianId = student.primaryGuardianId ?? linkedGuardian?.guardianId ?? null;
          if (guardianId) {
            const guardian = await tx.guardian.findFirst({
              where: { id: guardianId, tenantId: camera.tenantId },
              select: { id: true, whatsapp: true },
            });
            if (guardian) {
              const payload = notificationPayload({
                studentName: student.name,
                schoolName: camera.school.name,
                recognizedAt,
                attendanceStatus,
                eventType,
              });
              notification = await tx.notification.create({
                data: {
                  tenantId: camera.tenantId,
                  schoolId: camera.schoolId,
                  studentId: student.id,
                  guardianId: guardian.id,
                  attendanceId: attendance.id,
                  type: payload.type,
                  channel: guardian.whatsapp ? NotificationChannel.WHATSAPP : NotificationChannel.PUSH,
                  status: NotificationStatus.PENDING,
                  sentAt: null,
                  message: payload.message,
                },
              });
            }
          }
        } else {
          cameraEvent = await tx.cameraEvent.create({
            data: {
              tenantId: camera.tenantId,
              schoolId: camera.schoolId,
              cameraId: camera.id,
              studentId: recognition.identity?.studentId ?? null,
              attendanceId: null,
              type: CameraEventType.UNKNOWN,
              recognized: false,
              confidence: recognition.confidence,
              snapshotUrl: snapshot.publicPath,
              happenedAt: recognizedAt,
            },
          });
        }

        const recognitionEvent = await tx.faceRecognitionEvent.create({
          data: {
            tenantId: camera.tenantId,
            schoolId: camera.schoolId,
            cameraId: camera.id,
            studentId: recognition.identity?.studentId ?? null,
            identityId: recognition.identity?.id ?? null,
            attendanceId: attendance?.id ?? null,
            type: eventType,
            matchStatus: recognition.matchStatus,
            confidence: recognition.confidence,
            reviewReason: recognition.reviewReason,
            snapshotPath: snapshot.relativePath,
            metadata: {
              ...(body.metadata ?? {}),
              source: "camera-gateway",
              cameraId: camera.id,
            } as Prisma.InputJsonValue,
            recognizedAt,
          },
        });

        return { recognitionEvent, cameraEvent, attendance, notification };
      });

      if (result.attendance) {
        await refreshStudentPresence(camera.tenantId, result.attendance.studentId);
      }

      res.status(201).json({
        ok: true,
        matchStatus: recognition.matchStatus,
        confidence: recognition.confidence,
        recognitionEventId: result.recognitionEvent.id,
        cameraEventId: result.cameraEvent?.id ?? null,
        attendanceId: result.attendance?.id ?? null,
        notificationId: result.notification?.id ?? null,
      });
    } catch (error) {
      await biometricStorage.deleteRelativePath(snapshot.relativePath).catch(() => undefined);
      throw error;
    }
  }),
);

export default router;
