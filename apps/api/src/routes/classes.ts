import { Router } from "express";
import { UserRole } from "@prisma/client";
import { z } from "zod";
import { StudentShift } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { asyncHandler, badRequest, notFound } from "../lib/http";
import { requireAuth, requireRole } from "../middleware/auth";
import { buildTurmaDTOs } from "../lib/serializers";
import { parseStudentShift } from "../lib/mappers";
import { singleParam } from "../lib/route";

const router = Router();

router.use(requireAuth);
router.use(requireRole(UserRole.OWNER, UserRole.ADMIN, UserRole.STAFF));

const querySchema = z.object({
  q: z.string().trim().optional(),
  escolaId: z.string().trim().optional(),
  turno: z.enum(["all", "Manhã", "Tarde", "Integral"]).default("all"),
  ativa: z.enum(["all", "true", "false"]).default("all"),
});

const turmaSchema = z.object({
  nome: z.string().trim().min(2),
  escolaId: z.string().trim().min(1),
  turno: z.string().trim().min(1),
  ativa: z.boolean().default(true),
});

const shiftOrder: Record<StudentShift, number> = {
  MORNING: 0,
  AFTERNOON: 1,
  FULL_DAY: 2,
};

async function ensureSchool(tenantId: string, schoolId: string) {
  const school = await prisma.school.findFirst({
    where: { id: schoolId, tenantId },
    select: { id: true, name: true },
  });

  if (!school) {
    throw notFound("Escola não encontrada");
  }

  return school;
}

async function ensureUniqueClass(params: {
  tenantId: string;
  schoolId: string;
  name: string;
  shift: StudentShift;
  excludeId?: string;
}) {
  const existing = await prisma.schoolClass.findFirst({
    where: {
      tenantId: params.tenantId,
      schoolId: params.schoolId,
      name: params.name,
      shift: params.shift,
      ...(params.excludeId ? { id: { not: params.excludeId } } : {}),
    },
    select: { id: true },
  });

  if (existing) {
    throw badRequest("Já existe uma turma com esse nome e turno para essa escola");
  }
}

async function loadSchoolClass(tenantId: string, classId: string) {
  const schoolClass = await prisma.schoolClass.findFirst({
    where: { id: classId, tenantId },
    include: {
      school: {
        select: { name: true },
      },
    },
  });

  if (!schoolClass) {
    throw notFound("Turma não encontrada");
  }

  return schoolClass;
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId;
    const query = querySchema.parse(req.query);

    const classes = await prisma.schoolClass.findMany({
      where: {
        tenantId,
        ...(query.escolaId ? { schoolId: query.escolaId } : {}),
        ...(query.q
          ? {
              OR: [
                { name: { contains: query.q, mode: "insensitive" } },
                { school: { name: { contains: query.q, mode: "insensitive" } } },
              ],
            }
          : {}),
        ...(query.ativa === "true"
          ? { isActive: true }
          : query.ativa === "false"
            ? { isActive: false }
            : {}),
        ...(query.turno !== "all" ? { shift: parseStudentShift(query.turno) } : {}),
      },
      include: {
        school: {
          select: { name: true },
        },
      },
      orderBy: [{ name: "asc" }],
    });

    const dtos = await buildTurmaDTOs(tenantId, classes);
    dtos.sort((left, right) => {
      const schoolCompare = left.escolaNome.localeCompare(right.escolaNome, "pt-BR", { numeric: true, sensitivity: "base" });
      if (schoolCompare !== 0) return schoolCompare;

      const shiftCompare = shiftOrder[parseStudentShift(left.turno)] - shiftOrder[parseStudentShift(right.turno)];
      if (shiftCompare !== 0) return shiftCompare;

      return left.nome.localeCompare(right.nome, "pt-BR", { numeric: true, sensitivity: "base" });
    });

    res.json(dtos);
  }),
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId;
    const classId = singleParam(req.params.id);
    if (!classId) {
      throw notFound("Turma não encontrada");
    }

    const schoolClass = await loadSchoolClass(tenantId, classId);
    const [dto] = await buildTurmaDTOs(tenantId, [schoolClass]);
    res.json(dto);
  }),
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId;
    const body = turmaSchema.parse(req.body);
    const school = await ensureSchool(tenantId, body.escolaId);
    const shift = parseStudentShift(body.turno);

    await ensureUniqueClass({
      tenantId,
      schoolId: school.id,
      name: body.nome,
      shift,
    });

    const schoolClass = await prisma.schoolClass.create({
      data: {
        tenantId,
        schoolId: school.id,
        name: body.nome,
        shift,
        isActive: body.ativa,
      },
      include: {
        school: {
          select: { name: true },
        },
      },
    });

    const [dto] = await buildTurmaDTOs(tenantId, [schoolClass]);
    res.status(201).json(dto);
  }),
);

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId;
    const classId = singleParam(req.params.id);
    if (!classId) {
      throw notFound("Turma não encontrada");
    }

    const body = turmaSchema.partial().parse(req.body);
    const current = await loadSchoolClass(tenantId, classId);

    const nextSchoolId = body.escolaId ?? current.schoolId;
    if (body.escolaId && body.escolaId !== current.schoolId) {
      const linkedStudents = await prisma.student.count({
        where: { tenantId, classId: current.id },
      });

      if (linkedStudents > 0) {
        throw badRequest("Não é possível mover uma turma com alunos vinculados");
      }

      await ensureSchool(tenantId, body.escolaId);
    }

    const nextName = body.nome ?? current.name;
    const nextShift = body.turno ? parseStudentShift(body.turno) : current.shift;
    const nextActive = body.ativa ?? current.isActive;

    await ensureUniqueClass({
      tenantId,
      schoolId: nextSchoolId,
      name: nextName,
      shift: nextShift,
      excludeId: current.id,
    });

    const schoolClass = await prisma.$transaction(async (tx) => {
      const updated = await tx.schoolClass.update({
        where: { id: current.id },
        data: {
          schoolId: nextSchoolId,
          name: nextName,
          shift: nextShift,
          isActive: nextActive,
        },
        include: {
          school: {
            select: { name: true },
          },
        },
      });

      if (body.nome || body.turno) {
        await tx.student.updateMany({
          where: {
            tenantId,
            classId: current.id,
          },
          data: {
            className: nextName,
            shift: nextShift,
          },
        });
      }

      return updated;
    });

    const [dto] = await buildTurmaDTOs(tenantId, [schoolClass]);
    res.json(dto);
  }),
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId;
    const classId = singleParam(req.params.id);
    if (!classId) {
      throw notFound("Turma não encontrada");
    }

    const current = await loadSchoolClass(tenantId, classId);
    const linkedStudents = await prisma.student.count({
      where: { tenantId, classId: current.id },
    });

    if (linkedStudents > 0) {
      throw badRequest("Remova ou transfira os alunos antes de excluir a turma");
    }

    await prisma.schoolClass.delete({
      where: { id: current.id },
    });

    res.status(204).send();
  }),
);

export default router;
