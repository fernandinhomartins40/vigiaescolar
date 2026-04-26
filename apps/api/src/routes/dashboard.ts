import { Router } from "express";
import { UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/http";
import { requireAuth, requireRole } from "../middleware/auth";
import {
  buildDashboardDTO,
  buildSchoolDTOs,
  toAlunoDTO,
  toCameraDTO,
  toEventoCameraDTO,
  toNotificacaoDTO,
} from "../lib/serializers";
import { localDateKey, startOfLocalDay, endOfLocalDay } from "../lib/security";

const router = Router();

router.use(requireAuth);
router.use(requireRole(UserRole.OWNER, UserRole.ADMIN, UserRole.STAFF));

function roundToBucket(date: Date) {
  const value = new Date(date);
  const minutes = value.getMinutes();
  const rounded = minutes < 30 ? 0 : 30;
  value.setMinutes(rounded, 0, 0);
  return value.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Sao_Paulo",
  });
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId;
    const todayKey = localDateKey();
    const start = startOfLocalDay();
    const end = endOfLocalDay();

    const [
      schools,
      students,
      cameras,
      notifications,
      attendance,
      events,
    ] = await Promise.all([
      prisma.school.findMany({
        where: { tenantId },
        orderBy: { name: "asc" },
      }),
      prisma.student.findMany({
        where: { tenantId },
        orderBy: { name: "asc" },
      }),
      prisma.camera.findMany({
        where: { tenantId },
        include: { runtimeStatus: true },
        orderBy: { name: "asc" },
      }),
      prisma.notification.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: 12,
      }),
      prisma.attendance.findMany({
        where: { tenantId, date: todayKey },
      }),
      prisma.cameraEvent.findMany({
        where: {
          tenantId,
          happenedAt: {
            gte: start,
            lte: end,
          },
        },
        orderBy: { happenedAt: "desc" },
        take: 20,
      }),
    ]);

    const attendanceMap = new Map(attendance.map((entry) => [entry.studentId, entry]));
    const studentLinks = await prisma.studentGuardian.findMany({
      where: { tenantId },
      select: { studentId: true, guardianId: true },
    });

    const guardianMap = new Map<string, string[]>();
    for (const link of studentLinks) {
      const current = guardianMap.get(link.studentId) ?? [];
      current.push(link.guardianId);
      guardianMap.set(link.studentId, current);
    }

    const schoolDtos = await buildSchoolDTOs(tenantId, schools);
    const studentDtos = students.map((student) => {
      const attendanceRow = attendanceMap.get(student.id);
      return toAlunoDTO(
        {
          ...student,
          currentPresence: attendanceRow?.status ?? student.currentPresence,
          entryTime: attendanceRow?.entryAt
            ? attendanceRow.entryAt.toLocaleTimeString("pt-BR", {
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
                timeZone: "America/Sao_Paulo",
              })
            : student.entryTime,
          exitTime: attendanceRow?.exitAt
            ? attendanceRow.exitAt.toLocaleTimeString("pt-BR", {
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
                timeZone: "America/Sao_Paulo",
              })
            : student.exitTime,
        },
        guardianMap.get(student.id) ?? [],
      );
    });

    const eventDtos = events.map(toEventoCameraDTO);

    const attendanceSeriesMap = new Map<string, number>();
    for (const event of events) {
      if (event.type !== "ENTRY") continue;
      const bucket = roundToBucket(event.happenedAt);
      attendanceSeriesMap.set(bucket, (attendanceSeriesMap.get(bucket) ?? 0) + 1);
    }

    const series = [];
    for (let hour = 6; hour <= 18; hour += 1) {
      for (const minute of [0, 30]) {
        const label = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
        series.push({
          hora: label,
          entradas: attendanceSeriesMap.get(label) ?? 0,
        });
      }
    }

    const classAttendanceMap = new Map<
      string,
      {
        escola: string;
        turma: string;
        total: number;
        presentes: number;
      }
    >();

    for (const student of studentDtos) {
      const school = schoolDtos.find((item) => item.id === student.escolaId);
      if (!school) continue;

      const key = `${student.escolaId}::${student.turma}`;
      const current = classAttendanceMap.get(key) ?? {
        escola: school.nome,
        turma: student.turma,
        total: 0,
        presentes: 0,
      };

      current.total += 1;
      if (student.presencaHoje !== "ausente") {
        current.presentes += 1;
      }

      classAttendanceMap.set(key, current);
    }

    const classAttendance = Array.from(classAttendanceMap.values()).map((entry) => ({
      ...entry,
      pct: entry.total === 0 ? 0 : Math.round((entry.presentes / entry.total) * 100),
    }));

    const resumo = {
      escolas: schoolDtos.length,
      alunos: studentDtos.length,
      presentesHoje: studentDtos.filter((student) => student.presencaHoje !== "ausente").length,
      ausentesHoje: studentDtos.filter((student) => student.presencaHoje === "ausente").length,
      camerasAtivas: cameras.filter((camera) => camera.runtimeStatus?.healthStatus === "ONLINE").length,
      notificacoesPendentes: notifications.filter((notification) => notification.status === "PENDING").length,
    };

    res.json(
      buildDashboardDTO({
        resumo,
        schools: schoolDtos,
        students: studentDtos,
        events: eventDtos,
        attendanceSeries: series,
        cameras: cameras.map(toCameraDTO),
        notifications: notifications.map(toNotificacaoDTO),
        classAttendance,
      }),
    );
  }),
);

export default router;
