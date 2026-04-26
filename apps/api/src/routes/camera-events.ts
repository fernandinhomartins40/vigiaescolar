import {
  AttendanceStatus,
  CameraEventType,
  FaceMatchStatus,
  FaceRecognitionType,
  NotificationChannel,
  NotificationStatus,
  NotificationType,
  Prisma,
  StudentStatus,
  UserRole,
} from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler, badRequest, notFound } from "../lib/http";
import { refreshStudentPresence } from "../lib/presence-state";
import { prisma } from "../lib/prisma";
import { toAttendanceDTO, toEventoCameraDTO } from "../lib/serializers";
import { biometricEngine } from "../services/biometrics/engine";
import { biometricStorage, type StoredBiometricImage } from "../services/biometrics/storage";
import { formatTime, localDateKey } from "../lib/security";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();

router.use(requireAuth);
router.use(requireRole(UserRole.OWNER, UserRole.ADMIN, UserRole.STAFF));

const querySchema = z.object({
  date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  schoolId: z.string().trim().optional(),
  cameraId: z.string().trim().optional(),
});

const recognitionSchema = z.object({
  cameraId: z.string().trim().min(1),
  schoolId: z.string().trim().optional(),
  imagemBase64: z.string().trim().min(1),
  expectedStudentId: z.string().trim().optional(),
  direcao: z.enum(["ENTRY", "EXIT", "UNKNOWN"]).default("ENTRY"),
  reconhecidoEm: z.string().trim().optional(),
  metadata: z.record(z.unknown()).optional(),
});

function resolveRecognitionType(direction: "ENTRY" | "EXIT" | "UNKNOWN") {
  switch (direction) {
    case "EXIT":
      return FaceRecognitionType.EXIT;
    case "UNKNOWN":
      return FaceRecognitionType.UNKNOWN;
    default:
      return FaceRecognitionType.ENTRY;
  }
}

function resolveAttendanceStatus(recognizedAt: Date, openingTime: string, toleranceMinutes: number) {
  const [hours, minutes] = openingTime.split(":").map((value) => Number(value));
  const opening = new Date(recognizedAt);
  opening.setHours(hours, minutes, 0, 0);

  const tolerance = new Date(opening);
  tolerance.setMinutes(tolerance.getMinutes() + toleranceMinutes);

  return recognizedAt > tolerance ? AttendanceStatus.LATE : AttendanceStatus.PRESENT;
}

function buildNotificationPayload(params: {
  studentName: string;
  schoolName: string;
  recognizedAt: Date;
  attendanceStatus: AttendanceStatus;
  eventType: FaceRecognitionType;
}) {
  const time = formatTime(params.recognizedAt);

  if (params.attendanceStatus === AttendanceStatus.LATE) {
    return {
      type: NotificationType.LATE,
      message: `${params.studentName} chegou atrasado em ${params.schoolName} às ${time}.`,
    };
  }

  if (params.eventType === FaceRecognitionType.EXIT) {
    return {
      type: NotificationType.EXIT,
      message: `${params.studentName} saiu de ${params.schoolName} às ${time}.`,
    };
  }

  return {
    type: NotificationType.ENTRY,
    message: `${params.studentName} entrou em ${params.schoolName} às ${time}.`,
  };
}

async function loadCamera(tenantId: string, cameraId: string) {
  const camera = await prisma.camera.findFirst({
    where: { id: cameraId, tenantId },
  });

  if (!camera) {
    throw notFound("Câmera não encontrada");
  }

  return camera;
}

async function loadSchool(tenantId: string, schoolId: string) {
  const school = await prisma.school.findFirst({
    where: { id: schoolId, tenantId },
  });

  if (!school) {
    throw notFound("Escola não encontrada");
  }

  return school;
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId;
    const query = querySchema.parse(req.query);
    const dateKey = query.date ?? localDateKey();

    const events = await prisma.cameraEvent.findMany({
      where: {
        tenantId,
        type: {
          in: [CameraEventType.ENTRY, CameraEventType.EXIT],
        },
        ...(query.schoolId ? { schoolId: query.schoolId } : {}),
        ...(query.cameraId ? { cameraId: query.cameraId } : {}),
        happenedAt: {
          gte: new Date(`${dateKey}T00:00:00-03:00`),
          lte: new Date(`${dateKey}T23:59:59.999-03:00`),
        },
      },
      orderBy: { happenedAt: "desc" },
    });

    res.json(events.map(toEventoCameraDTO));
  }),
);

router.post(
  "/reconhecer",
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId;
    const body = recognitionSchema.parse(req.body);
    const recognizedAt = body.reconhecidoEm ? new Date(body.reconhecidoEm) : new Date();

    if (Number.isNaN(recognizedAt.getTime())) {
      throw badRequest("Data de reconhecimento inválida");
    }

    const camera = await loadCamera(tenantId, body.cameraId);
    const school = await loadSchool(tenantId, body.schoolId ?? camera.schoolId);

    if (camera.schoolId !== school.id) {
      throw badRequest("A câmera não pertence à escola informada");
    }

    let snapshot: StoredBiometricImage | null = null;

    try {
      snapshot = await biometricStorage.persistBase64Image("events", body.imagemBase64);
      const recognition = await biometricEngine.findBestMatch({
        tenantId,
        schoolId: school.id,
        imageBase64: body.imagemBase64,
        expectedStudentId: body.expectedStudentId ?? null,
      });

      const dateKey = localDateKey(recognizedAt);
      const eventType =
        recognition.matchStatus === FaceMatchStatus.MATCHED
          ? resolveRecognitionType(body.direcao)
          : FaceRecognitionType.UNKNOWN;
      const matchedStudent = recognition.identity?.student ?? null;
      const duplicateWindow = new Date(recognizedAt.getTime() - 180_000);

      if (recognition.matchStatus === FaceMatchStatus.MATCHED && matchedStudent) {
        const duplicate = await prisma.faceRecognitionEvent.findFirst({
          where: {
            tenantId,
            cameraId: camera.id,
            studentId: matchedStudent.id,
            type: eventType,
            recognizedAt: {
              gte: duplicateWindow,
              lte: recognizedAt,
            },
          },
        });

        if (duplicate) {
          await biometricStorage.deleteRelativePath(snapshot.relativePath);
          res.json({
            duplicate: true,
            recognition: {
              ...duplicate,
              snapshotUrl: snapshot.publicPath,
            },
            cameraEvent: null,
            attendance: null,
          });
          return;
        }
      }

      const result = await prisma.$transaction(async (tx) => {
        let attendance = null;
        let cameraEvent = null;
        let notification = null;

        if (recognition.matchStatus === FaceMatchStatus.MATCHED && matchedStudent) {
          const student = await tx.student.findFirst({
            where: {
              id: matchedStudent.id,
              tenantId,
              schoolId: school.id,
              status: StudentStatus.ACTIVE,
            },
          });

          if (!student) {
            throw badRequest("Aluno biométrico não está disponível para reconhecimento");
          }

          const attendanceStatus =
            eventType === FaceRecognitionType.EXIT
              ? AttendanceStatus.LEFT
              : resolveAttendanceStatus(recognizedAt, school.openingTime, school.toleranceMinutes);

          attendance = await tx.attendance.upsert({
            where: {
              tenantId_studentId_date: {
                tenantId,
                studentId: student.id,
                date: dateKey,
              },
            },
            create: {
              tenantId,
              studentId: student.id,
              schoolId: school.id,
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
              schoolId: school.id,
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
              tenantId,
              schoolId: school.id,
              cameraId: camera.id,
              studentId: student.id,
              attendanceId: attendance.id,
              type: eventType === FaceRecognitionType.EXIT ? CameraEventType.EXIT : CameraEventType.ENTRY,
              recognized: true,
              confidence: recognition.confidence,
              snapshotUrl: snapshot!.publicPath,
              happenedAt: recognizedAt,
            },
          });

          const linkedGuardian = await tx.studentGuardian.findFirst({
            where: {
              tenantId,
              studentId: student.id,
            },
            orderBy: { createdAt: "asc" },
            select: { guardianId: true },
          });

          const primaryGuardianId = student.primaryGuardianId ?? linkedGuardian?.guardianId ?? null;

          if (primaryGuardianId) {
            const guardian = await tx.guardian.findFirst({
              where: {
                id: primaryGuardianId,
                tenantId,
              },
              select: {
                id: true,
                whatsapp: true,
              },
            });

            if (guardian) {
              const notificationPayload = buildNotificationPayload({
                studentName: student.name,
                schoolName: school.name,
                recognizedAt,
                attendanceStatus,
                eventType,
              });

              notification = await tx.notification.create({
                data: {
                  tenantId,
                  schoolId: school.id,
                  studentId: student.id,
                  guardianId: guardian.id,
                  attendanceId: attendance.id,
                  type: notificationPayload.type,
                  channel: guardian.whatsapp ? NotificationChannel.WHATSAPP : NotificationChannel.PUSH,
                  status: NotificationStatus.PENDING,
                  sentAt: null,
                  message: notificationPayload.message,
                },
              });

              attendance = await tx.attendance.update({
                where: { id: attendance.id },
                data: {
                  notified: true,
                },
              });
            }
          }
        } else {
          cameraEvent = await tx.cameraEvent.create({
            data: {
              tenantId,
              schoolId: school.id,
              cameraId: camera.id,
              studentId: recognition.identity?.studentId ?? null,
              attendanceId: null,
              type: CameraEventType.UNKNOWN,
              recognized: false,
              confidence: recognition.confidence,
              snapshotUrl: snapshot!.publicPath,
              happenedAt: recognizedAt,
            },
          });
        }

        const recognitionEvent = await tx.faceRecognitionEvent.create({
          data: {
            tenantId,
            schoolId: school.id,
            cameraId: camera.id,
            studentId: recognition.identity?.studentId ?? null,
            identityId: recognition.identity?.id ?? null,
            attendanceId: attendance?.id ?? null,
            type: eventType,
            matchStatus: recognition.matchStatus,
            confidence: recognition.confidence,
            reviewReason: recognition.reviewReason,
            snapshotPath: snapshot!.relativePath,
            metadata: {
              ...(body.metadata ?? {}),
              cameraId: camera.id,
              schoolId: school.id,
              expectedStudentId: body.expectedStudentId ?? null,
              confidenceThreshold: recognition.thresholds.matchThreshold,
              reviewThreshold: recognition.thresholds.reviewThreshold,
            } as Prisma.InputJsonValue,
            dedupeKey:
              recognition.matchStatus === FaceMatchStatus.MATCHED && matchedStudent
                ? `${tenantId}:${camera.id}:${matchedStudent.id}:${eventType}:${dateKey}`
                : null,
            recognizedAt,
          },
        });

        return {
          recognitionEvent,
          cameraEvent,
          attendance,
          notification,
        };
      });

      if (result.attendance) {
        await refreshStudentPresence(tenantId, result.attendance.studentId);
      }

      res.status(201).json({
        duplicate: false,
        recognition: {
          ...result.recognitionEvent,
          snapshotUrl: snapshot.publicPath,
        },
        cameraEvent: result.cameraEvent ? toEventoCameraDTO(result.cameraEvent) : null,
        attendance: result.attendance ? toAttendanceDTO(result.attendance) : null,
        notification: result.notification ?? null,
        matchStatus: recognition.matchStatus,
        confidence: recognition.confidence,
        student: recognition.identity?.student ?? null,
        school,
        camera,
      });
    } catch (error) {
      if (snapshot) {
        await biometricStorage.deleteRelativePath(snapshot.relativePath).catch(() => undefined);
      }

      throw error;
    }
  }),
);

export default router;
