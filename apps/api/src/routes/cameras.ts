import { Router } from "express";
import net from "node:net";
import os from "node:os";
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
  // Identificadores físicos vindos do APK configurador (XM/iCSee)
  bluetoothMac: z.string().trim().optional(),
  serialNumber: z.string().trim().optional(),
  wifiSsid: z.string().trim().optional(),
});

const deviceSourceSchema = z.object({
  escolaId: z.string().trim().min(1),
});

const CAMERA_DISCOVERY_PORTS = [554, 34567, 80, 8080, 8899, 5000, 8554] as const;

type DiscoveryCandidate = {
  ip: string;
  ports: number[];
  profile: "xm-h264dvr" | "rtsp" | "ip";
  label: string;
  confidence: number;
  metadata?: Record<string, unknown>;
};

function privateIpv4Interfaces() {
  const ignoredInterfaces = /vEthernet|WSL|Docker|Loopback|Bluetooth|VMware|VirtualBox|Hyper-V/i;
  return Object.entries(os.networkInterfaces())
    .filter(([name]) => !ignoredInterfaces.test(name))
    .flatMap(([, items]) => items ?? [])
    .filter((item) => item.family === "IPv4" && !item.internal && !item.address.startsWith("169.254."))
    .filter((item) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(item.address));
}

function subnetIps(address: string) {
  const parts = address.split(".");
  if (parts.length !== 4) return [];
  const prefix = parts.slice(0, 3).join(".");
  return Array.from({ length: 254 }, (_, index) => `${prefix}.${index + 1}`).filter((ip) => ip !== address);
}

async function mapLimit<T, R>(items: T[], limit: number, iteratee: (item: T) => Promise<R>) {
  const results: R[] = [];
  let cursor = 0;

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await iteratee(items[index]);
      }
    }),
  );

  return results;
}

async function isTcpOpen(host: string, port: number, timeoutMs = 650) {
  return new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (open: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function probeH264Dvr(ip: string) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 900);
    const response = await fetch(`http://${ip}/cgi-bin/login.cgi`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ Name: "GetPreLoginInfo" }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) return null;
    const text = await response.text();
    const payload = JSON.parse(text) as Record<string, unknown>;
    return payload.Ret === 100 ? payload : null;
  } catch {
    return null;
  }
}

async function discoverNetworkCameras() {
  const localInterfaces = privateIpv4Interfaces().slice(0, 3);
  const ips = Array.from(new Set(localInterfaces.flatMap((item) => subnetIps(item.address))));
  const portChecks = ips.flatMap((ip) => CAMERA_DISCOVERY_PORTS.map((port) => ({ ip, port })));
  const openPortsByIp = new Map<string, number[]>();

  await mapLimit(portChecks, 96, async ({ ip, port }) => {
    if (await isTcpOpen(ip, port)) {
      openPortsByIp.set(ip, [...(openPortsByIp.get(ip) ?? []), port].sort((a, b) => a - b));
    }
  });

  const candidates = await mapLimit(Array.from(openPortsByIp.entries()), 12, async ([ip, ports]) => {
    const metadata = ports.includes(80) ? await probeH264Dvr(ip) : null;
    const isXm = ports.includes(34567) || metadata?.TCPPort === 34567;
    const hasRtsp = ports.includes(554) || ports.includes(8554);

    if (!isXm && !hasRtsp && !ports.includes(80)) {
      return null;
    }

    const profile = isXm ? "xm-h264dvr" : hasRtsp ? "rtsp" : "ip";
    const confidence = (isXm ? 70 : 0) + (hasRtsp ? 25 : 0) + (metadata ? 5 : 0);
    return {
      ip,
      ports,
      profile,
      label: profile === "xm-h264dvr" ? "H264DVR / XM / iCSee" : profile === "rtsp" ? "Camera RTSP" : "Camera IP",
      confidence,
      ...(metadata ? { metadata } : {}),
    } satisfies DiscoveryCandidate;
  });

  const discovered = candidates.filter(Boolean) as DiscoveryCandidate[];
  return discovered.sort((a, b) => b.confidence - a.confidence || a.ip.localeCompare(b.ip));
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
  "/discover",
  asyncHandler(async (_req, res) => {
    const cameras = await discoverNetworkCameras();
    res.json({
      cameras,
      scannedAt: new Date().toISOString(),
    });
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

    // Upsert por bluetoothMac dentro do tenant: se o APK reenviar a mesma
    // câmera, atualizamos em vez de duplicar.
    const existingByMac = body.bluetoothMac
      ? await prisma.camera.findFirst({
          where: { tenantId, bluetoothMac: body.bluetoothMac },
        })
      : null;

    const data = {
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
      bluetoothMac: body.bluetoothMac,
      serialNumber: body.serialNumber,
      wifiSsid: body.wifiSsid,
    };

    const camera = existingByMac
      ? await prisma.camera.update({ where: { id: existingByMac.id }, data })
      : await prisma.camera.create({ data });

    res.status(existingByMac ? 200 : 201).json(toCameraDTO({ ...camera, runtimeStatus: null }));
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
