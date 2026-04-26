import { AttendanceStatus } from "@prisma/client";
import { Router } from "express";
import { UserRole } from "@prisma/client";
import { z } from "zod";
import { asyncHandler, badRequest, notFound } from "../lib/http";
import { prisma } from "../lib/prisma";
import { singleParam } from "../lib/route";
import { toAlunoDTO } from "../lib/serializers";
import { parseAttendanceStatus } from "../lib/mappers";
import { formatTime, localDateKey } from "../lib/security";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();

router.use(requireAuth);
router.use(requireRole(UserRole.OWNER, UserRole.ADMIN, UserRole.STAFF));

const querySchema = z.object({
  date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  data: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  schoolId: z.string().trim().optional(),
  turmaId: z.string().trim().optional(),
  turma: z.string().trim().optional(),
  alunoId: z.string().trim().optional(),
});

const presenceSchema = z.object({
  presencaHoje: z.string().trim(),
  horarioEntrada: z.string().trim().regex(/^\d{2}:\d{2}$/).optional(),
  horarioSaida: z.string().trim().regex(/^\d{2}:\d{2}$/).optional(),
  schoolId: z.string().trim().optional(),
  date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  data: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

function buildDateTime(dateKey: string, time?: string) {
  if (!time) return undefined;
  return new Date(`${dateKey}T${time}:00-03:00`);
}

async function loadStudentDTO(tenantId: string, studentId: string, dateKey: string) {
  const student = await prisma.student.findFirst({
    where: { id: studentId, tenantId },
  });

  if (!student) {
    throw notFound("Aluno não encontrado");
  }

  const links = await prisma.studentGuardian.findMany({
    where: { studentId: student.id, tenantId },
    select: { guardianId: true },
    orderBy: { createdAt: "asc" },
  });

  const attendance = await prisma.attendance.findFirst({
    where: { tenantId, studentId: student.id, date: dateKey },
    orderBy: { createdAt: "desc" },
  });

  return toAlunoDTO(
    {
      ...student,
      currentPresence: attendance?.status ?? student.currentPresence,
      entryTime: attendance?.entryAt ? formatTime(attendance.entryAt) : student.entryTime,
      exitTime: attendance?.exitAt ? formatTime(attendance.exitAt) : student.exitTime,
    },
    links.map((link) => link.guardianId),
  );
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId;
    const query = querySchema.parse(req.query);
    const dateKey = query.date ?? query.data ?? localDateKey();

    const students = await prisma.student.findMany({
      where: {
        tenantId,
        ...(query.schoolId ? { schoolId: query.schoolId } : {}),
        ...(query.turmaId
          ? { classId: query.turmaId }
          : query.turma
            ? { className: query.turma }
            : {}),
        ...(query.alunoId ? { id: query.alunoId } : {}),
      },
      orderBy: { name: "asc" },
    });

    const links = await prisma.studentGuardian.findMany({
      where: { tenantId },
      select: { studentId: true, guardianId: true },
    });

    const attendance = await prisma.attendance.findMany({
      where: {
        tenantId,
        date: dateKey,
      },
    });

    const attendanceMap = new Map(attendance.map((entry) => [entry.studentId, entry]));
    const guardiansMap = new Map<string, string[]>();

    for (const link of links) {
      const current = guardiansMap.get(link.studentId) ?? [];
      current.push(link.guardianId);
      guardiansMap.set(link.studentId, current);
    }

    res.json(
      students.map((student) =>
        toAlunoDTO(
          {
            ...student,
            currentPresence: attendanceMap.get(student.id)?.status ?? student.currentPresence,
            entryTime: attendanceMap.get(student.id)?.entryAt
              ? formatTime(attendanceMap.get(student.id)!.entryAt as Date)
              : student.entryTime,
            exitTime: attendanceMap.get(student.id)?.exitAt
              ? formatTime(attendanceMap.get(student.id)!.exitAt as Date)
              : student.exitTime,
          },
          guardiansMap.get(student.id) ?? [],
        ),
      ),
    );
  }),
);

router.patch(
  "/:studentId",
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId;
    const studentId = singleParam(req.params.studentId);
    if (!studentId) {
      throw notFound("Aluno não encontrado");
    }

    const body = presenceSchema.parse(req.body);
    const dateKey = body.date ?? body.data ?? localDateKey();
    const status = parseAttendanceStatus(body.presencaHoje);

    const student = await prisma.student.findFirst({
      where: { id: studentId, tenantId },
    });

    if (!student) {
      throw notFound("Aluno não encontrado");
    }

    const schoolId = body.schoolId ?? student.schoolId;
    if (schoolId !== student.schoolId) {
      throw badRequest("O aluno não pertence à escola informada");
    }

    const attendanceBefore = await prisma.attendance.findFirst({
      where: {
        tenantId,
        studentId: student.id,
        date: dateKey,
      },
    });

    const entryAt = (() => {
      if (body.horarioEntrada) {
        return buildDateTime(dateKey, body.horarioEntrada) ?? null;
      }
      if (status === AttendanceStatus.ABSENT) {
        return null;
      }
      return attendanceBefore?.entryAt ?? new Date();
    })();

    const exitAt = (() => {
      if (body.horarioSaida) {
        return buildDateTime(dateKey, body.horarioSaida) ?? null;
      }
      if (status === AttendanceStatus.ABSENT) {
        return null;
      }
      if (status === AttendanceStatus.LEFT) {
        return attendanceBefore?.exitAt ?? new Date();
      }
      return attendanceBefore?.exitAt ?? null;
    })();

    await prisma.attendance.upsert({
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
        schoolId,
        date: dateKey,
        status,
        entryAt,
        exitAt,
        recognized: false,
        notes: `Ajuste manual por ${req.auth!.userEmail}`,
        notified: status !== AttendanceStatus.ABSENT,
      },
      update: {
        schoolId,
        status,
        entryAt,
        exitAt,
        recognized: false,
        notes: `Ajuste manual por ${req.auth!.userEmail}`,
        notified: status !== AttendanceStatus.ABSENT,
      },
    });

    if (dateKey === localDateKey()) {
      await prisma.student.update({
        where: { id: student.id },
        data: {
          currentPresence: status,
          entryTime: entryAt ? formatTime(entryAt) : null,
          exitTime: exitAt ? formatTime(exitAt) : null,
        },
      });
    }

    res.json(await loadStudentDTO(tenantId, student.id, dateKey));
  }),
);

export default router;
