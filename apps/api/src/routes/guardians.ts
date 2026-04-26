import { Router } from "express";
import { UserRole } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler, conflict, notFound } from "../lib/http";
import { requireAuth, requireRole } from "../middleware/auth";
import { toResponsavelDTO } from "../lib/serializers";
import { avatarUrl, hashPassword } from "../lib/security";
import { parseGuardianRelationship } from "../lib/mappers";
import { singleParam } from "../lib/route";

const router = Router();

router.use(requireAuth);
router.use(requireRole(UserRole.OWNER, UserRole.ADMIN, UserRole.STAFF));

const querySchema = z.object({
  q: z.string().trim().optional(),
  ativo: z.enum(["all", "true", "false"]).default("all"),
});

const guardianSchema = z.object({
  nome: z.string().trim().min(3),
  cpf: z.string().trim().min(8),
  whatsapp: z.string().trim().min(5),
  email: z.string().trim().email(),
  parentesco: z.string().trim(),
  foto: z.string().trim().url().optional(),
  password: z.string().trim().min(8).optional(),
  ativo: z.boolean().default(true),
  filhosIds: z.array(z.string().min(1)).default([]),
});

async function assertGuardianUserEmailAvailable(tenantId: string, email: string) {
  const existingUser = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!existingUser) return;

  if (existingUser.tenantId !== tenantId || existingUser.role !== UserRole.GUARDIAN) {
    throw conflict("E-mail ja utilizado por outra conta de usuario");
  }
}

async function syncGuardianUser(params: {
  tenantId: string;
  guardian: {
    name: string;
    email: string;
    photoUrl: string | null;
    isActive: boolean;
  };
  previousEmail?: string;
  password?: string;
}) {
  const email = params.guardian.email.toLowerCase();
  const previousEmail = params.previousEmail?.toLowerCase();
  const passwordHash = params.password ? await hashPassword(params.password) : undefined;

  const userByEmail = await prisma.user.findUnique({ where: { email } });
  if (userByEmail && userByEmail.tenantId !== params.tenantId) {
    throw conflict("E-mail ja utilizado por outra conta");
  }
  if (userByEmail && userByEmail.role !== UserRole.GUARDIAN) {
    throw conflict("E-mail ja utilizado por outra conta de usuario");
  }

  if (userByEmail) {
    await prisma.user.update({
      where: { id: userByEmail.id },
      data: {
        name: params.guardian.name,
        role: UserRole.GUARDIAN,
        avatarUrl: params.guardian.photoUrl ?? avatarUrl(params.guardian.name),
        isActive: params.guardian.isActive,
        ...(passwordHash ? { passwordHash } : {}),
      },
    });
    return;
  }

  if (previousEmail && previousEmail !== email) {
    const previousUser = await prisma.user.findUnique({ where: { email: previousEmail } });
    if (previousUser?.tenantId === params.tenantId && previousUser.role === UserRole.GUARDIAN) {
      await prisma.user.update({
        where: { id: previousUser.id },
        data: {
          name: params.guardian.name,
          email,
          role: UserRole.GUARDIAN,
          avatarUrl: params.guardian.photoUrl ?? avatarUrl(params.guardian.name),
          isActive: params.guardian.isActive,
          ...(passwordHash ? { passwordHash } : {}),
        },
      });
      return;
    }
  }

  if (!passwordHash) {
    return;
  }

  await prisma.user.create({
    data: {
      tenantId: params.tenantId,
      name: params.guardian.name,
      email,
      passwordHash,
      role: UserRole.GUARDIAN,
      avatarUrl: params.guardian.photoUrl ?? avatarUrl(params.guardian.name),
      isActive: params.guardian.isActive,
    },
  });
}

async function loadGuardianDTO(tenantId: string, guardianId: string) {
  const guardian = await prisma.guardian.findFirst({
    where: { id: guardianId, tenantId },
  });

  if (!guardian) {
    throw notFound("Responsável não encontrado");
  }

  const links = await prisma.studentGuardian.findMany({
    where: { guardianId: guardian.id, tenantId },
    select: { studentId: true },
    orderBy: { createdAt: "asc" },
  });

  return toResponsavelDTO(guardian, links.map((link) => link.studentId));
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId;
    const query: z.infer<typeof querySchema> = querySchema.parse(req.query);

    const guardians = await prisma.guardian.findMany({
      where: {
        tenantId,
        ...(query.q
          ? {
              name: { contains: query.q, mode: "insensitive" },
            }
          : {}),
        ...(query.ativo === "true"
          ? { isActive: true }
          : query.ativo === "false"
            ? { isActive: false }
            : {}),
      },
      orderBy: { name: "asc" },
    });

    const links = await prisma.studentGuardian.findMany({
      where: { tenantId },
      select: { guardianId: true, studentId: true },
    });

    const map = new Map<string, string[]>();
    for (const link of links) {
      const current = map.get(link.guardianId) ?? [];
      current.push(link.studentId);
      map.set(link.guardianId, current);
    }

    res.json(guardians.map((guardian) => toResponsavelDTO(guardian, map.get(guardian.id) ?? [])));
  }),
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const guardianId = singleParam(req.params.id);
    if (!guardianId) {
      throw notFound("Responsável não encontrado");
    }

    res.json(await loadGuardianDTO(req.auth!.tenantId, guardianId));
  }),
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId;
    const body = guardianSchema.parse(req.body);
    await assertGuardianUserEmailAvailable(tenantId, body.email);

    const guardian = await prisma.guardian.create({
      data: {
        tenantId,
        name: body.nome,
        cpf: body.cpf,
        whatsapp: body.whatsapp,
        email: body.email.toLowerCase(),
        relationship: parseGuardianRelationship(body.parentesco),
        photoUrl: body.foto ?? avatarUrl(body.nome),
        isActive: body.ativo,
      },
    });

    await syncGuardianUser({
      tenantId,
      guardian,
      password: body.password,
    });

    if (body.filhosIds.length > 0) {
      await prisma.studentGuardian.createMany({
        data: body.filhosIds.map((studentId) => ({
          tenantId,
          studentId,
          guardianId: guardian.id,
          isPrimary: false,
        })),
        skipDuplicates: true,
      });
    }

    res.status(201).json(await loadGuardianDTO(tenantId, guardian.id));
  }),
);

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId;
    const body = guardianSchema.partial().parse(req.body);
    const guardianId = singleParam(req.params.id);
    if (!guardianId) {
      throw notFound("Responsável não encontrado");
    }

    const existing = await prisma.guardian.findFirst({
      where: { id: guardianId, tenantId },
    });

    if (!existing) {
      throw notFound("Responsável não encontrado");
    }

    if (body.email && body.email.toLowerCase() !== existing.email.toLowerCase()) {
      await assertGuardianUserEmailAvailable(tenantId, body.email);
    }

    const guardian = await prisma.guardian.update({
      where: { id: existing.id },
      data: {
        name: body.nome ?? existing.name,
        cpf: body.cpf ?? existing.cpf,
        whatsapp: body.whatsapp ?? existing.whatsapp,
        email: body.email?.toLowerCase() ?? existing.email,
        relationship: body.parentesco ? parseGuardianRelationship(body.parentesco) : existing.relationship,
        photoUrl: body.foto ?? existing.photoUrl,
        isActive: body.ativo ?? existing.isActive,
      },
    });

    await syncGuardianUser({
      tenantId,
      guardian,
      previousEmail: existing.email,
      password: body.password,
    });

    if (body.filhosIds) {
      await prisma.studentGuardian.deleteMany({
        where: {
          tenantId,
          guardianId: guardian.id,
        },
      });

      if (body.filhosIds.length > 0) {
        await prisma.studentGuardian.createMany({
          data: body.filhosIds.map((studentId) => ({
            tenantId,
            studentId,
            guardianId: guardian.id,
            isPrimary: false,
          })),
          skipDuplicates: true,
        });
      }
    }

    res.json(await loadGuardianDTO(tenantId, guardian.id));
  }),
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId;
    const guardianId = singleParam(req.params.id);
    if (!guardianId) {
      throw notFound("Responsável não encontrado");
    }

    const guardian = await prisma.guardian.findFirst({
      where: { id: guardianId, tenantId },
    });

    if (!guardian) {
      throw notFound("Responsável não encontrado");
    }

    await prisma.student.updateMany({
      where: { primaryGuardianId: guardian.id, tenantId },
      data: { primaryGuardianId: null },
    });

    await prisma.guardian.delete({
      where: { id: guardian.id },
    });

    res.status(204).send();
  }),
);

export default router;
