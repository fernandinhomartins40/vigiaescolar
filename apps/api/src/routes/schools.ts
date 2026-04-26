import { Router } from "express";
import { UserRole } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler, notFound } from "../lib/http";
import { requireAuth, requireRole } from "../middleware/auth";
import { buildSchoolDTOs, toEscolaDTO } from "../lib/serializers";
import { logoUrl } from "../lib/security";
import { singleParam } from "../lib/route";

const router = Router();

router.use(requireAuth);
router.use(requireRole(UserRole.OWNER, UserRole.ADMIN, UserRole.STAFF));

const querySchema = z.object({
  q: z.string().trim().optional(),
  ativa: z.enum(["all", "true", "false"]).default("all"),
});

const schoolSchema = z.object({
  nome: z.string().trim().min(3),
  cnpj: z.string().trim().min(8),
  endereco: z.string().trim().min(3),
  cidade: z.string().trim().min(2),
  estado: z.string().trim().length(2),
  telefone: z.string().trim().min(5),
  email: z.string().trim().email(),
  logo: z.string().trim().url().optional(),
  horarioEntrada: z.string().trim().regex(/^\d{2}:\d{2}$/),
  horarioSaida: z.string().trim().regex(/^\d{2}:\d{2}$/),
  toleranciaMin: z.coerce.number().int().min(0).max(120).default(15),
  ativa: z.boolean().default(true),
});

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId;
    const query: z.infer<typeof querySchema> = querySchema.parse(req.query);

    const schools = await prisma.school.findMany({
      where: {
        tenantId,
        ...(query.q
          ? {
              OR: [
                { name: { contains: query.q, mode: "insensitive" } },
                { city: { contains: query.q, mode: "insensitive" } },
              ],
            }
          : {}),
        ...(query.ativa === "true"
          ? { isActive: true }
          : query.ativa === "false"
            ? { isActive: false }
            : {}),
      },
      orderBy: { name: "asc" },
    });

    res.json(await buildSchoolDTOs(tenantId, schools));
  }),
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId;
    const schoolId = singleParam(req.params.id);
    if (!schoolId) {
      throw notFound("Escola não encontrada");
    }

    const school = await prisma.school.findFirst({
      where: { id: schoolId, tenantId },
    });

    if (!school) {
      throw notFound("Escola não encontrada");
    }

    const [dto] = await buildSchoolDTOs(tenantId, [school]);
    res.json(dto);
  }),
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId;
    const body = schoolSchema.parse(req.body);

    const school = await prisma.school.create({
      data: {
        tenantId,
        name: body.nome,
        cnpj: body.cnpj,
        address: body.endereco,
        city: body.cidade,
        state: body.estado.toUpperCase(),
        phone: body.telefone,
        email: body.email.toLowerCase(),
        logoUrl: body.logo ?? logoUrl(body.nome),
        openingTime: body.horarioEntrada,
        closingTime: body.horarioSaida,
        toleranceMinutes: body.toleranciaMin,
        isActive: body.ativa,
      },
    });

    const [dto] = await buildSchoolDTOs(tenantId, [school]);
    res.status(201).json(dto);
  }),
);

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId;
    const body = schoolSchema.partial().parse(req.body);
    const schoolId = singleParam(req.params.id);
    if (!schoolId) {
      throw notFound("Escola não encontrada");
    }

    const current = await prisma.school.findFirst({
      where: { id: schoolId, tenantId },
    });

    if (!current) {
      throw notFound("Escola não encontrada");
    }

    const school = await prisma.school.update({
      where: { id: current.id },
      data: {
        name: body.nome ?? current.name,
        cnpj: body.cnpj ?? current.cnpj,
        address: body.endereco ?? current.address,
        city: body.cidade ?? current.city,
        state: body.estado?.toUpperCase() ?? current.state,
        phone: body.telefone ?? current.phone,
        email: body.email?.toLowerCase() ?? current.email,
        logoUrl: body.logo ?? current.logoUrl,
        openingTime: body.horarioEntrada ?? current.openingTime,
        closingTime: body.horarioSaida ?? current.closingTime,
        toleranceMinutes: body.toleranciaMin ?? current.toleranceMinutes,
        isActive: body.ativa ?? current.isActive,
      },
    });

    const [dto] = await buildSchoolDTOs(tenantId, [school]);
    res.json(dto);
  }),
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId;
    const schoolId = singleParam(req.params.id);
    if (!schoolId) {
      throw notFound("Escola não encontrada");
    }

    const school = await prisma.school.findFirst({
      where: { id: schoolId, tenantId },
    });

    if (!school) {
      throw notFound("Escola não encontrada");
    }

    await prisma.school.delete({
      where: { id: school.id },
    });

    res.status(204).send();
  }),
);

export default router;
