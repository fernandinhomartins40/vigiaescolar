import { Router } from "express";
import { UserRole } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler, notFound } from "../lib/http";
import { requireAuth, requireRole } from "../middleware/auth";
import { toCameraDTO, toEventoCameraDTO } from "../lib/serializers";
import { encryptSecret } from "../lib/security";
import { parseCameraStatus, parseCameraType } from "../lib/mappers";
import { singleParam } from "../lib/route";

const router = Router();

router.use(requireAuth);
router.use(requireRole(UserRole.OWNER, UserRole.ADMIN, UserRole.STAFF));

const querySchema = z.object({
  q: z.string().trim().optional(),
  escolaId: z.string().trim().optional(),
});

const cameraSchema = z.object({
  nome: z.string().trim().min(3),
  escolaId: z.string().trim().min(1),
  localizacao: z.string().trim().min(3),
  tipo: z.string().trim(),
  url: z.string().trim().min(3),
  resolucao: z.enum(["720p", "1080p", "4K"]),
  fps: z.coerce.number().int().min(1).max(120).default(30),
  status: z.string().trim().default("Ativa"),
  porta: z.coerce.number().int().positive().optional(),
  usuario: z.string().trim().optional(),
  senha: z.string().trim().optional(),
  inicioReconhecimento: z.string().trim().regex(/^\d{2}:\d{2}$/).optional(),
  fimReconhecimento: z.string().trim().regex(/^\d{2}:\d{2}$/).optional(),
});

const deviceSourceSchema = z.object({
  escolaId: z.string().trim().min(1),
});

async function ensureSchool(tenantId: string, schoolId: string) {
  const school = await prisma.school.findFirst({
    where: { id: schoolId, tenantId },
  });

  if (!school) {
    throw notFound("Escola não encontrada");
  }

  return school;
}

async function loadCamera(tenantId: string, cameraId: string) {
  const camera = await prisma.camera.findFirst({
    where: { id: cameraId, tenantId },
    include: { runtimeStatus: true },
  });

  if (!camera) {
    throw notFound("Câmera não encontrada");
  }

  return camera;
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId;
    const query: z.infer<typeof querySchema> = querySchema.parse(req.query);

    const cameras = await prisma.camera.findMany({
      where: {
        tenantId,
        ...(query.escolaId ? { schoolId: query.escolaId } : {}),
        ...(query.q
          ? {
              OR: [
                { name: { contains: query.q, mode: "insensitive" } },
                { location: { contains: query.q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      include: { runtimeStatus: true },
      orderBy: { name: "asc" },
    });

    res.json(cameras.map(toCameraDTO));
  }),
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const cameraId = singleParam(req.params.id);
    if (!cameraId) {
      throw notFound("Câmera não encontrada");
    }

    res.json(toCameraDTO(await loadCamera(req.auth!.tenantId, cameraId)));
  }),
);

router.get(
  "/:id/eventos",
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId;
    const cameraId = singleParam(req.params.id);
    if (!cameraId) {
      throw notFound("Câmera não encontrada");
    }

    const camera = await loadCamera(tenantId, cameraId);

    const events = await prisma.cameraEvent.findMany({
      where: {
        tenantId,
        cameraId: camera.id,
      },
      orderBy: { happenedAt: "desc" },
      take: 50,
    });

    res.json(events.map(toEventoCameraDTO));
  }),
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId;
    const body = cameraSchema.parse(req.body);

    await ensureSchool(tenantId, body.escolaId);

    const camera = await prisma.camera.create({
      data: {
        tenantId,
        schoolId: body.escolaId,
        name: body.nome,
        location: body.localizacao,
        type: parseCameraType(body.tipo),
        streamUrl: body.url,
        resolution: body.resolucao,
        fps: body.fps,
        status: parseCameraStatus(body.status),
        port: body.porta,
        username: body.usuario,
        passwordEncrypted: body.senha ? encryptSecret(body.senha) : undefined,
        recognitionStartTime: body.inicioReconhecimento,
        recognitionEndTime: body.fimReconhecimento,
      },
    });

    res.status(201).json(toCameraDTO({ ...camera, runtimeStatus: null }));
  }),
);

router.post(
  "/device-source",
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId;
    const body = deviceSourceSchema.parse(req.body);

    await ensureSchool(tenantId, body.escolaId);

    const existing = await prisma.camera.findFirst({
      where: {
        tenantId,
        schoolId: body.escolaId,
        streamUrl: "device://live",
      },
      orderBy: { createdAt: "asc" },
    });

    if (existing) {
      const camera = await prisma.camera.update({
        where: { id: existing.id },
        data: {
          status: "ACTIVE",
          type: "USB",
          location: "Dispositivo local",
          name: "Câmera do dispositivo",
          resolution: existing.resolution || "1080p",
          fps: existing.fps || 30,
        },
      });

      res.json(toCameraDTO({ ...camera, runtimeStatus: null }));
      return;
    }

    const camera = await prisma.camera.create({
      data: {
        tenantId,
        schoolId: body.escolaId,
        name: "Câmera do dispositivo",
        location: "Dispositivo local",
        type: "USB",
        streamUrl: "device://live",
        resolution: "1080p",
        fps: 30,
        status: "ACTIVE",
      },
    });

    res.status(201).json(toCameraDTO({ ...camera, runtimeStatus: null }));
  }),
);

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId;
    const body = cameraSchema.partial().parse(req.body);
    const cameraId = singleParam(req.params.id);
    if (!cameraId) {
      throw notFound("Câmera não encontrada");
    }

    const current = await loadCamera(tenantId, cameraId);

    if (body.escolaId) {
      await ensureSchool(tenantId, body.escolaId);
    }

    const camera = await prisma.camera.update({
      where: { id: current.id },
      data: {
        name: body.nome ?? current.name,
        schoolId: body.escolaId ?? current.schoolId,
        location: body.localizacao ?? current.location,
        type: body.tipo ? parseCameraType(body.tipo) : current.type,
        streamUrl: body.url ?? current.streamUrl,
        resolution: body.resolucao ?? current.resolution,
        fps: body.fps ?? current.fps,
        status: body.status ? parseCameraStatus(body.status) : current.status,
        port: body.porta ?? current.port,
        username: body.usuario ?? current.username,
        passwordEncrypted: body.senha ? encryptSecret(body.senha) : current.passwordEncrypted,
        recognitionStartTime: body.inicioReconhecimento ?? current.recognitionStartTime,
        recognitionEndTime: body.fimReconhecimento ?? current.recognitionEndTime,
      },
    });

    const runtimeStatus = await prisma.cameraRuntimeStatus.findUnique({ where: { cameraId: camera.id } });
    res.json(toCameraDTO({ ...camera, runtimeStatus }));
  }),
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId;
    const cameraId = singleParam(req.params.id);
    if (!cameraId) {
      throw notFound("Câmera não encontrada");
    }

    const camera = await loadCamera(tenantId, cameraId);

    await prisma.camera.delete({
      where: { id: camera.id },
    });

    res.status(204).send();
  }),
);

export default router;
