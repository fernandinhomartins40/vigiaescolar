import { Router } from "express";
import { UserRole } from "@prisma/client";
import { z } from "zod";
import { AttendanceStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { asyncHandler, badRequest, notFound } from "../lib/http";
import { requireAuth, requireRole } from "../middleware/auth";
import { toAlunoDTO, toAttendanceDTO, toEventoCameraDTO } from "../lib/serializers";
import { parseAttendanceStatus } from "../lib/mappers";
import { formatTime, localDateKey } from "../lib/security";
import { refreshStudentPresence } from "../lib/presence-state";
import { singleParam } from "../lib/route";

const router = Router();

router.use(requireAuth);
router.use(requireRole(UserRole.OWNER, UserRole.ADMIN, UserRole.STAFF));

const querySchema = z.object({
  data: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  escolaId: z.string().trim().optional(),
  turmaId: z.string().trim().optional(),
  turma: z.string().trim().optional(),
  alunoId: z.string().trim().optional(),
});

const attendanceSchema = z.object({
  alunoId: z.string().trim().min(1),
  escolaId: z.string().trim().min(1),
  data: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.string().trim(),
  horarioEntrada: z.string().trim().regex(/^\d{2}:\d{2}$/).optional(),
  horarioSaida: z.string().trim().regex(/^\d{2}:\d{2}$/).optional(),
  cameraId: z.string().trim().optional(),
  reconhecido: z.boolean().default(false),
  confianca: z.coerce.number().min(0).max(1).optional(),
  notificado: z.boolean().default(false),
  notes: z.string().trim().optional(),
});

function buildDateTime(dateKey: string, time?: string) {
  if (!time) return undefined;
  return new Date(`${dateKey}T${time}:00-03:00`);
}

async function ensureStudentAndSchool(tenantId: string, alunoId: string, escolaId: string) {
  const [student, school] = await Promise.all([
    prisma.student.findFirst({ where: { id: alunoId, tenantId } }),
    prisma.school.findFirst({ where: { id: escolaId, tenantId } }),
  ]);

  if (!student) {
    throw badRequest("Aluno inválido");
  }

  if (!school) {
    throw badRequest("Escola inválida");
  }

  if (student.schoolId !== school.id) {
    throw badRequest("O aluno não pertence à escola informada");
  }

  return { student, school };
}

async function loadAttendance(tenantId: string, attendanceId: string) {
  const attendance = await prisma.attendance.findFirst({
    where: { id: attendanceId, tenantId },
  });

  if (!attendance) {
    throw notFound("Registro de presença não encontrado");
  }

  return attendance;
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId;
    const query: z.infer<typeof querySchema> = querySchema.parse(req.query);
    const dateKey = query.data ?? localDateKey();

    const students = await prisma.student.findMany({
      where: {
        tenantId,
        ...(query.escolaId ? { schoolId: query.escolaId } : {}),
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
      students.map((student) => {
        const record = attendanceMap.get(student.id);
        const dto = toAlunoDTO(
          {
            ...student,
            currentPresence: record?.status ?? student.currentPresence,
            entryTime: record?.entryAt ? formatTime(record.entryAt) : student.entryTime,
            exitTime: record?.exitAt ? formatTime(record.exitAt) : student.exitTime,
          },
          guardiansMap.get(student.id) ?? [],
        );

        return dto;
      }),
    );
  }),
);

router.get(
  "/registros",
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId;
    const query = querySchema.parse(req.query);
    const records = await prisma.attendance.findMany({
      where: {
        tenantId,
        ...(query.data ? { date: query.data } : {}),
        ...(query.escolaId ? { schoolId: query.escolaId } : {}),
        ...(query.alunoId ? { studentId: query.alunoId } : {}),
      },
      orderBy: { createdAt: "desc" },
    });

    res.json(records.map(toAttendanceDTO));
  }),
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const attendanceId = singleParam(req.params.id);
    if (!attendanceId) {
      throw notFound("Registro de presença não encontrado");
    }

    res.json(toAttendanceDTO(await loadAttendance(req.auth!.tenantId, attendanceId)));
  }),
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId;
    const body = attendanceSchema.parse(req.body);
    const dateKey = body.data ?? localDateKey();
    const { student, school } = await ensureStudentAndSchool(tenantId, body.alunoId, body.escolaId);
    const status = parseAttendanceStatus(body.status);
    const entryAt = buildDateTime(dateKey, body.horarioEntrada);
    const exitAt = buildDateTime(dateKey, body.horarioSaida);
    const cameraId = body.cameraId
      ? (
          await prisma.camera.findFirst({
            where: { id: body.cameraId, tenantId },
          })
        )?.id
      : undefined;

    if (body.cameraId && !cameraId) {
      throw badRequest("Câmera inválida");
    }

    const attendance = await prisma.attendance.upsert({
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
        cameraId,
        date: dateKey,
        status,
        entryAt,
        exitAt,
        recognized: body.reconhecido,
        confidence: body.confianca,
        notified: body.notificado,
        notes: body.notes,
      },
      update: {
        schoolId: school.id,
        cameraId,
        status,
        entryAt,
        exitAt,
        recognized: body.reconhecido,
        confidence: body.confianca,
        notified: body.notificado,
        notes: body.notes,
      },
    });

    if (cameraId && status !== AttendanceStatus.ABSENT) {
      await prisma.cameraEvent.create({
        data: {
          tenantId,
          schoolId: school.id,
          cameraId,
          studentId: student.id,
          attendanceId: attendance.id,
          type: status === "LEFT" ? "EXIT" : "ENTRY",
          recognized: body.reconhecido,
          confidence: body.confianca,
          happenedAt: entryAt ?? exitAt ?? new Date(),
        },
      });
    }

    await refreshStudentPresence(tenantId, student.id);

    res.status(201).json(toAttendanceDTO(attendance));
  }),
);

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId;
    const body = attendanceSchema.partial().parse(req.body);
    const attendanceId = singleParam(req.params.id);
    if (!attendanceId) {
      throw notFound("Registro de presença não encontrado");
    }

    const current = await loadAttendance(tenantId, attendanceId);

    if (body.alunoId || body.escolaId) {
      await ensureStudentAndSchool(
        tenantId,
        body.alunoId ?? current.studentId,
        body.escolaId ?? current.schoolId,
      );
    }

    const attendance = await prisma.attendance.update({
      where: { id: current.id },
      data: {
        studentId: body.alunoId ?? current.studentId,
        schoolId: body.escolaId ?? current.schoolId,
        cameraId: body.cameraId ?? current.cameraId,
        status: body.status ? parseAttendanceStatus(body.status) : current.status,
        entryAt: body.horarioEntrada ? buildDateTime(current.date, body.horarioEntrada) : current.entryAt,
        exitAt: body.horarioSaida ? buildDateTime(current.date, body.horarioSaida) : current.exitAt,
        recognized: body.reconhecido ?? current.recognized,
        confidence: body.confianca ?? current.confidence,
        notified: body.notificado ?? current.notified,
        notes: body.notes ?? current.notes,
      },
    });

    await refreshStudentPresence(tenantId, attendance.studentId);

    res.json(toAttendanceDTO(attendance));
  }),
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId;
    const attendanceId = singleParam(req.params.id);
    if (!attendanceId) {
      throw notFound("Registro de presença não encontrado");
    }

    const attendance = await loadAttendance(tenantId, attendanceId);

    await prisma.attendance.delete({
      where: { id: attendance.id },
    });

    await refreshStudentPresence(tenantId, attendance.studentId);

    res.status(204).send();
  }),
);

export default router;
