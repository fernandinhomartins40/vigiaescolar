import express, { Router } from "express";
import { randomUUID } from "node:crypto";
import { AttendanceStatus, FaceEnrollmentSource, StudentStatus, UserRole } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler, badRequest, notFound } from "../lib/http";
import { requireAuth, requireRole } from "../middleware/auth";
import { toAlunoDTO } from "../lib/serializers";
import { avatarUrl } from "../lib/security";
import { biometricEngine } from "../services/biometrics/engine";
import { biometricStorage } from "../services/biometrics/storage";
import { parseAttendanceStatus, parseStudentShift, parseStudentStatus } from "../lib/mappers";
import { singleParam } from "../lib/route";
import {
  getUploadRoot,
  readStudentUploadPayload,
  removePathIfExists,
  removeStudentUploadDirectory,
  removeUploadedAssetByPublicUrl,
  saveStudentUploadFile,
  type UploadFile,
} from "../lib/uploads";

const router = Router();

router.use(requireAuth);
router.use(requireRole(UserRole.OWNER, UserRole.ADMIN, UserRole.STAFF));
router.use("/uploads", express.static(getUploadRoot(), { index: false }));

const querySchema = z.object({
  q: z.string().trim().optional(),
  escolaId: z.string().trim().optional(),
  ativo: z.enum(["all", "true", "false"]).default("all"),
});

const studentSchema = z.object({
  nome: z.string().trim().min(3),
  matricula: z.string().trim().min(3),
  dataNascimento: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  escolaId: z.string().trim().min(1),
  turma: z.string().trim().optional(),
  turmaId: z.string().trim().optional(),
  turno: z.string().trim(),
  foto: z.string().trim().url().optional(),
  ativo: z.boolean().default(true),
  responsaveisIds: z.array(z.string().min(1)).default([]),
  responsavelPrincipalId: z.string().trim().optional(),
  biometriaAtiva: z.boolean().default(true),
  status: z.string().trim().optional(),
  presencaHoje: z.string().trim().optional(),
  horarioEntrada: z.string().trim().optional(),
  horarioSaida: z.string().trim().optional(),
});

async function loadStudentDTO(tenantId: string, studentId: string) {
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

  return toAlunoDTO(student, links.map((link) => link.guardianId));
}

async function ensureSchool(tenantId: string, schoolId: string) {
  const school = await prisma.school.findFirst({
    where: { id: schoolId, tenantId },
  });

  if (!school) {
    throw notFound("Escola não encontrada");
  }

  return school;
}

async function ensureSchoolClass(
  tenantId: string,
  schoolId: string,
  params: { turmaId?: string; turmaNome?: string; turno?: string },
) {
  if (params.turmaId) {
    const schoolClass = await prisma.schoolClass.findFirst({
      where: {
        id: params.turmaId,
        tenantId,
        schoolId,
      },
      select: { id: true, name: true, shift: true },
    });

    if (!schoolClass) {
      throw badRequest("Cadastre a turma antes de vincular o aluno");
    }

    return schoolClass;
  }

  if (params.turmaNome) {
    const schoolClass = await prisma.schoolClass.findFirst({
      where: {
        tenantId,
        schoolId,
        name: { equals: params.turmaNome, mode: "insensitive" },
        ...(params.turno ? { shift: parseStudentShift(params.turno) } : {}),
      },
      select: { id: true, name: true, shift: true },
    });

    if (!schoolClass) {
      throw badRequest("Cadastre a turma antes de vincular o aluno");
    }

    return schoolClass;
  }

  return null;
}

async function ensureGuardians(tenantId: string, guardianIds: string[]) {
  if (guardianIds.length === 0) {
    return [];
  }

  const guardians = await prisma.guardian.findMany({
    where: {
      tenantId,
      id: { in: guardianIds },
    },
    select: { id: true },
  });

  if (guardians.length !== guardianIds.length) {
    throw badRequest("Um ou mais responsáveis são inválidos");
  }

  return guardians;
}

function coerceBoolean(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "off"].includes(normalized)) {
      return false;
    }
  }

  return value;
}

function parseIdList(value: unknown) {
  const values = Array.isArray(value) ? value : [value];
  const ids: string[] = [];

  for (const entry of values) {
    if (typeof entry !== "string") {
      continue;
    }

    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }

    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (Array.isArray(parsed)) {
          ids.push(
            ...parsed
              .map((item) => String(item).trim())
              .filter((item) => Boolean(item)),
          );
          continue;
        }
      } catch {
        // fall through and treat the raw string as a single identifier
      }
    }

    ids.push(...trimmed.split(",").map((item) => item.trim()).filter(Boolean));
  }

  return ids;
}

function parseBiometricMetadata(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Formato inválido");
    }

    return parsed as Record<string, unknown>;
  } catch {
    throw badRequest("Metadados biométricos inválidos");
  }
}

function normalizeStudentInput(input: Record<string, unknown>) {
  const normalized: Record<string, unknown> = { ...input };

  if ("ativo" in normalized) {
    normalized.ativo = coerceBoolean(normalized.ativo);
  }

  if ("biometriaAtiva" in normalized) {
    normalized.biometriaAtiva = coerceBoolean(normalized.biometriaAtiva);
  }

  if ("responsaveisIds" in normalized) {
    normalized.responsaveisIds = parseIdList(normalized.responsaveisIds);
  }

  if ("responsavelPrincipalId" in normalized && typeof normalized.responsavelPrincipalId === "string") {
    const value = normalized.responsavelPrincipalId.trim();
    if (value) {
      normalized.responsavelPrincipalId = value;
    } else {
      delete normalized.responsavelPrincipalId;
    }
  }

  for (const key of ["foto", "status", "presencaHoje", "horarioEntrada", "horarioSaida"] as const) {
    const value = normalized[key];
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) {
        normalized[key] = trimmed;
      } else {
        delete normalized[key];
      }
    }
  }

  return normalized;
}

async function storeStudentUploads(params: {
  req: Parameters<typeof saveStudentUploadFile>[0]["req"];
  tenantId: string;
  studentId: string;
  photoFile?: UploadFile;
  biometricFiles: UploadFile[];
}) {
  const savedPaths: string[] = [];
  let photoUrl: string | undefined;

  try {
    if (params.photoFile) {
      const uploadedPhoto = await saveStudentUploadFile({
        req: params.req,
        tenantId: params.tenantId,
        studentId: params.studentId,
        kind: "photo",
        file: params.photoFile,
      });
      savedPaths.push(uploadedPhoto.absolutePath);
      photoUrl = uploadedPhoto.publicUrl;
    }

    for (const file of params.biometricFiles) {
      const uploadedBiometric = await saveStudentUploadFile({
        req: params.req,
        tenantId: params.tenantId,
        studentId: params.studentId,
        kind: "biometric",
        file,
      });
      savedPaths.push(uploadedBiometric.absolutePath);
    }

    return { photoUrl, savedPaths };
  } catch (error) {
    await Promise.all(savedPaths.map((filePath) => removePathIfExists(filePath)));
    throw error;
  }
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId;
    const query: z.infer<typeof querySchema> = querySchema.parse(req.query);

    const students = await prisma.student.findMany({
      where: {
        tenantId,
        ...(query.q
          ? {
              name: { contains: query.q, mode: "insensitive" },
            }
          : {}),
        ...(query.escolaId ? { schoolId: query.escolaId } : {}),
        ...(query.ativo === "true"
          ? { status: "ACTIVE" }
          : query.ativo === "false"
            ? { status: { in: ["TRANSFERRED", "INACTIVE"] } }
            : {}),
      },
      orderBy: { name: "asc" },
    });

    const links = await prisma.studentGuardian.findMany({
      where: { tenantId },
      select: { studentId: true, guardianId: true },
    });

    const map = new Map<string, string[]>();
    for (const link of links) {
      const current = map.get(link.studentId) ?? [];
      current.push(link.guardianId);
      map.set(link.studentId, current);
    }

    res.json(students.map((student) => toAlunoDTO(student, map.get(student.id) ?? [])));
  }),
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const studentId = singleParam(req.params.id);
    if (!studentId) {
      throw notFound("Aluno não encontrado");
    }

    res.json(await loadStudentDTO(req.auth!.tenantId, studentId));
  }),
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId;
    const studentId = randomUUID();
    const uploadPayload = await readStudentUploadPayload(req);
    const body = studentSchema.parse(normalizeStudentInput(uploadPayload.fields));
    const biometricMetadata = parseBiometricMetadata(uploadPayload.fields.biometriaMeta);

    await ensureSchool(tenantId, body.escolaId);
    const schoolClass = await ensureSchoolClass(tenantId, body.escolaId, {
      turmaId: body.turmaId,
      turmaNome: body.turma,
      turno: body.turno,
    });

    if (!schoolClass) {
      throw badRequest("Cadastre a turma antes de cadastrar o aluno");
    }

    const guardianIds = Array.from(new Set(body.responsaveisIds));
    if (body.responsavelPrincipalId) {
      guardianIds.push(body.responsavelPrincipalId);
    }
    const uniqueGuardianIds = Array.from(new Set(guardianIds));
    await ensureGuardians(tenantId, uniqueGuardianIds);

    const primaryGuardianId = body.responsavelPrincipalId ?? uniqueGuardianIds[0] ?? null;
    const biometricEnabled = uploadPayload.biometricFiles.length > 0 ? true : body.biometriaAtiva;
    const { photoUrl: uploadedPhotoUrl, savedPaths } = await storeStudentUploads({
      req,
      tenantId,
      studentId,
      photoFile: uploadPayload.photoFile,
      biometricFiles: uploadPayload.biometricFiles,
    });

    const photoUrl = uploadedPhotoUrl ?? body.foto ?? avatarUrl(body.nome);

    try {
      await prisma.$transaction(async (tx) => {
        await tx.student.create({
          data: {
            id: studentId,
            tenantId,
            schoolId: body.escolaId,
            classId: schoolClass.id,
            name: body.nome,
            registrationNumber: body.matricula,
            birthDate: new Date(`${body.dataNascimento}T00:00:00.000Z`),
            className: schoolClass.name,
            shift: schoolClass.shift,
            photoUrl,
            status: body.status
              ? parseStudentStatus(body.status)
              : body.ativo
                ? StudentStatus.ACTIVE
                : StudentStatus.INACTIVE,
            biometricEnabled,
            currentPresence: body.presencaHoje ? parseAttendanceStatus(body.presencaHoje) : AttendanceStatus.ABSENT,
            entryTime: body.horarioEntrada,
            exitTime: body.horarioSaida,
            primaryGuardianId,
          },
        });

        if (uniqueGuardianIds.length > 0) {
          await tx.studentGuardian.createMany({
            data: uniqueGuardianIds.map((guardianId) => ({
              tenantId,
              studentId,
              guardianId,
              isPrimary: guardianId === primaryGuardianId,
            })),
            skipDuplicates: true,
          });
        }

        if (uploadPayload.biometricFiles.length > 0) {
          await biometricEngine.enrollStudent(
            {
              tenantId,
              studentId,
              schoolId: body.escolaId,
              studentName: body.nome,
              files: uploadPayload.biometricFiles,
              approvedByUserId: req.auth!.userId,
              sourceLabel: "Cadastro do aluno",
              sourceType: FaceEnrollmentSource.LIVE_CAPTURE,
              metadata: biometricMetadata ?? {},
            },
            tx,
          );
        }
      });
    } catch (error) {
      await Promise.all(savedPaths.map((filePath) => removePathIfExists(filePath)));
      await removeStudentUploadDirectory(tenantId, studentId);
      throw error;
    }

    res.status(201).json(await loadStudentDTO(tenantId, studentId));
  }),
);

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId;
    const uploadPayload = await readStudentUploadPayload(req);
    const body = studentSchema.partial().parse(normalizeStudentInput(uploadPayload.fields));
    const biometricMetadata = parseBiometricMetadata(uploadPayload.fields.biometriaMeta);
    const studentId = singleParam(req.params.id);
    if (!studentId) {
      throw notFound("Aluno não encontrado");
    }

    const existing = await prisma.student.findFirst({
      where: { id: studentId, tenantId },
    });

    if (!existing) {
      throw notFound("Aluno não encontrado");
    }

    const nextSchoolId = body.escolaId ?? existing.schoolId;
    if (body.escolaId) {
      await ensureSchool(tenantId, body.escolaId);
    }

    const schoolClass = await ensureSchoolClass(tenantId, nextSchoolId, {
      turmaId: body.turmaId ?? existing.classId ?? undefined,
      turmaNome: body.turma ?? existing.className,
      turno:
        body.turno ??
        (existing.shift === "AFTERNOON" ? "Tarde" : existing.shift === "FULL_DAY" ? "Integral" : "Manhã"),
    });

    if (!schoolClass) {
      throw badRequest("Cadastre a turma antes de atualizar o aluno");
    }

    const guardianIds = Array.from(
      new Set([
        ...(body.responsaveisIds ?? []),
        ...(body.responsavelPrincipalId ? [body.responsavelPrincipalId] : []),
      ]),
    );
    if (guardianIds.length > 0) {
      await ensureGuardians(tenantId, guardianIds);
    }

    const finalGuardianIds = Array.from(
      new Set([
        ...(body.responsaveisIds ?? []),
        ...(body.responsavelPrincipalId ? [body.responsavelPrincipalId] : []),
      ]),
    );
    const resolvedPrimaryGuardianId =
      body.responsavelPrincipalId ?? existing.primaryGuardianId ?? finalGuardianIds[0] ?? null;
    const nextBiometricEnabled =
      uploadPayload.biometricFiles.length > 0
        ? true
        : body.biometriaAtiva ?? existing.biometricEnabled;

    if (
      resolvedPrimaryGuardianId &&
      finalGuardianIds.length > 0 &&
      !finalGuardianIds.includes(resolvedPrimaryGuardianId)
    ) {
      throw badRequest("Responsável principal precisa estar vinculado ao aluno");
    }

    const { photoUrl: uploadedPhotoUrl, savedPaths } = await storeStudentUploads({
      req,
      tenantId,
      studentId,
      photoFile: uploadPayload.photoFile,
      biometricFiles: uploadPayload.biometricFiles,
    });

    const nextPhotoUrl = uploadedPhotoUrl ?? body.foto ?? existing.photoUrl;

    try {
      await prisma.$transaction(async (tx) => {
        await tx.student.update({
          where: { id: existing.id },
          data: {
            name: body.nome ?? existing.name,
            registrationNumber: body.matricula ?? existing.registrationNumber,
            birthDate: body.dataNascimento ? new Date(`${body.dataNascimento}T00:00:00.000Z`) : existing.birthDate,
            schoolId: nextSchoolId,
            classId: schoolClass.id,
            className: schoolClass.name,
            shift: schoolClass.shift,
            photoUrl: nextPhotoUrl,
            status: body.status
              ? parseStudentStatus(body.status)
              : body.ativo === false
                ? StudentStatus.INACTIVE
                : body.ativo === true
                  ? StudentStatus.ACTIVE
                  : existing.status,
            biometricEnabled: nextBiometricEnabled,
            currentPresence: body.presencaHoje ? parseAttendanceStatus(body.presencaHoje) : existing.currentPresence,
            entryTime: body.horarioEntrada ?? existing.entryTime,
            exitTime: body.horarioSaida ?? existing.exitTime,
            primaryGuardianId: resolvedPrimaryGuardianId,
          },
        });

        if (body.responsaveisIds || body.responsavelPrincipalId) {
          await tx.studentGuardian.deleteMany({
            where: {
              tenantId,
              studentId: existing.id,
            },
          });

          if (finalGuardianIds.length > 0) {
            await tx.studentGuardian.createMany({
              data: finalGuardianIds.map((guardianId) => ({
                tenantId,
                studentId: existing.id,
                guardianId,
                isPrimary: guardianId === resolvedPrimaryGuardianId,
              })),
              skipDuplicates: true,
            });
          }

        }

        if (uploadPayload.biometricFiles.length > 0) {
          await biometricEngine.enrollStudent(
            {
              tenantId,
              studentId: existing.id,
              schoolId: nextSchoolId,
              studentName: body.nome ?? existing.name,
              files: uploadPayload.biometricFiles,
              approvedByUserId: req.auth!.userId,
              sourceLabel: "Atualização do aluno",
              sourceType: FaceEnrollmentSource.LIVE_CAPTURE,
              metadata: biometricMetadata ?? {},
            },
            tx,
          );
        } else if (body.biometriaAtiva !== undefined && body.biometriaAtiva !== existing.biometricEnabled) {
          await biometricEngine.setStudentBiometricStatus(
            {
              tenantId,
              studentId: existing.id,
              schoolId: nextSchoolId,
              studentName: body.nome ?? existing.name,
              isActive: nextBiometricEnabled,
            },
            tx,
          );
        }
      });
    } catch (error) {
      await Promise.all(savedPaths.map((filePath) => removePathIfExists(filePath)));
      throw error;
    }

    if (nextPhotoUrl !== existing.photoUrl) {
      await removeUploadedAssetByPublicUrl(existing.photoUrl ?? "").catch(() => undefined);
    }

    res.json(await loadStudentDTO(tenantId, studentId));
  }),
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId;
    const studentId = singleParam(req.params.id);
    if (!studentId) {
      throw notFound("Aluno não encontrado");
    }

    const student = await prisma.student.findFirst({
      where: { id: studentId, tenantId },
    });

    if (!student) {
      throw notFound("Aluno não encontrado");
    }

    const biometricAssets = await biometricEngine.collectStudentBiometryAssets(tenantId, student.id);

    await prisma.student.delete({
      where: { id: student.id },
    });

    await Promise.all(
      biometricAssets.imagePaths.map((filePath) => biometricStorage.deleteRelativePath(filePath).catch(() => undefined)),
    );

    await removeStudentUploadDirectory(tenantId, student.id).catch(() => undefined);

    res.status(204).send();
  }),
);

export default router;
