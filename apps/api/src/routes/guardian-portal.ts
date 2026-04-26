import { CameraEventType, UserRole } from "@prisma/client";
import { Router } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler, forbidden, notFound } from "../lib/http";
import { requireAuth } from "../middleware/auth";
import { formatTime, localDateKey, startOfLocalDay } from "../lib/security";
import { toGuardianPortalDTO } from "../lib/serializers";
import type { GuardianPortalChildDTO } from "../domain";

const router = Router();

router.use(requireAuth);

function ensureGuardianRole(role: UserRole) {
  if (role !== UserRole.GUARDIAN) {
    throw forbidden("Use uma conta de responsavel para acessar este portal");
  }
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId;
    ensureGuardianRole(req.auth!.role);

    const guardian = await prisma.guardian.findFirst({
      where: {
        tenantId,
        email: req.auth!.userEmail.toLowerCase(),
        isActive: true,
      },
    });

    if (!guardian) {
      throw notFound("Responsavel nao vinculado a esta conta");
    }

    const links = await prisma.studentGuardian.findMany({
      where: { tenantId, guardianId: guardian.id },
      include: {
        student: {
          include: {
            school: true,
            guardianLinks: {
              select: {
                guardianId: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    const studentIds = links.map((link) => link.studentId);
    const today = localDateKey();
    const todayStart = startOfLocalDay();

    const [attendance, todayEvents, recentEvents, notifications] = await Promise.all([
      prisma.attendance.findMany({
        where: {
          tenantId,
          studentId: { in: studentIds },
          date: today,
        },
      }),
      prisma.cameraEvent.findMany({
        where: {
          tenantId,
          studentId: { in: studentIds },
          type: { in: [CameraEventType.ENTRY, CameraEventType.EXIT] },
          happenedAt: { gte: todayStart },
        },
        orderBy: { happenedAt: "asc" },
        take: 100,
      }),
      prisma.cameraEvent.findMany({
        where: {
          tenantId,
          studentId: { in: studentIds },
          type: { in: [CameraEventType.ENTRY, CameraEventType.EXIT] },
        },
        orderBy: { happenedAt: "desc" },
        take: 20,
      }),
      prisma.notification.findMany({
        where: {
          tenantId,
          guardianId: guardian.id,
        },
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
    ]);

    const attendanceByStudent = new Map(attendance.map((item) => [item.studentId, item]));
    const eventsByStudent = new Map<string, typeof todayEvents>();
    for (const event of todayEvents) {
      if (!event.studentId) continue;
      const current = eventsByStudent.get(event.studentId) ?? [];
      current.push(event);
      eventsByStudent.set(event.studentId, current);
    }

    const children = links.map((link) => {
      const studentEvents = eventsByStudent.get(link.studentId) ?? [];
      const studentAttendance = attendanceByStudent.get(link.studentId);
      const timeline: GuardianPortalChildDTO["timeline"] = studentEvents.map((event) => ({
        horario: formatTime(event.happenedAt),
        tipo: event.type === CameraEventType.ENTRY ? "Entrou" : "Saiu",
        descricao:
          event.type === CameraEventType.ENTRY
            ? `${link.student.name} entrou na escola`
            : `${link.student.name} saiu da escola`,
      }));

      if (timeline.length === 0) {
        if (studentAttendance?.entryAt) {
          timeline.push({
            horario: formatTime(studentAttendance.entryAt),
            tipo: "Entrou",
            descricao: `${link.student.name} entrou na escola`,
          });
        }

        if (studentAttendance?.exitAt) {
          timeline.push({
            horario: formatTime(studentAttendance.exitAt),
            tipo: "Saiu",
            descricao: `${link.student.name} saiu da escola`,
          });
        }
      }

      if (timeline.length === 0) {
        timeline.push({
          horario: "--:--",
          tipo: "Sem registro",
          descricao: "Sem registros de entrada ou saida hoje",
        });
      }

      return {
        student: link.student,
        school: link.student.school,
        responsaveisIds: link.student.guardianLinks.map((studentLink) => studentLink.guardianId),
        timeline,
      };
    });

    const latestEvent = recentEvents.find(
      (event) => event.type === CameraEventType.ENTRY || event.type === CameraEventType.EXIT,
    );

    res.json(
      toGuardianPortalDTO({
        guardian,
        children,
        recentNotifications: notifications,
        latestEvent,
      }),
    );
  }),
);

export default router;
