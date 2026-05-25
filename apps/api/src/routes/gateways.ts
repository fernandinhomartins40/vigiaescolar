/**
 * Rotas /api/gateways/* — gateway desktop instalado na escola.
 *
 * Endpoints:
 *  - POST /pair          — gateway envia código + machineInfo, recebe token
 *  - POST /pairing-code  — admin gera código de pareamento (auth de usuário)
 *  - GET  /              — admin lista gateways do tenant
 *  - POST /heartbeat     — gateway pinga periodicamente (auth gateway)
 *  - POST /cameras/discovered — gateway envia lista de câmeras descobertas
 *  - DELETE /:id         — admin revoga um gateway
 */
import crypto from "node:crypto";
import { Router, raw, type Request } from "express";
import { z } from "zod";
import { CameraStatus, CameraType, GatewayStatus } from "@prisma/client";

import { asyncHandler } from "../lib/http";
import { prisma } from "../lib/prisma";
import { encryptSecret, decryptSecret } from "../lib/security";
import { requireAuth } from "../middleware/auth";
import { biometricEngine } from "../services/biometrics/engine";

const router = Router();

const PAIRING_TTL_MS = 10 * 60 * 1000;
const TOKEN_BYTES = 32;

function streamKey(serialNumber: string) {
  return serialNumber.replace(/[^A-Za-z0-9_-]/g, "");
}

async function resolveGatewaySchool(tenantId: string, schoolId: string | null) {
  if (schoolId) return schoolId;

  const schools = await prisma.school.findMany({
    where: { tenantId },
    select: { id: true },
    take: 2,
  });

  return schools.length === 1 ? schools[0].id : null;
}

function relayUrls(serialNumber: string, cameraId: string) {
  const key = streamKey(serialNumber);
  const scheme = process.env.MEDIA_INGEST_SCHEME?.trim() === "rtmp" ? "rtmp" : "rtmps";
  const host = process.env.MEDIA_INGEST_HOST?.trim() || "vigiaescolar.com.br";
  const port = process.env.MEDIA_INGEST_PORT?.trim() || "1936";
  const publishToken = process.env.CAMERA_PUBLISH_TOKEN?.trim() || "";

  return {
    streamKey: key,
    liveUrl: `/api/cameras/${encodeURIComponent(cameraId)}/live/index.m3u8`,
    publishUrl: publishToken
      ? `${scheme}://${host}:${port}/live/${encodeURIComponent(key)}?user=cam&pass=${encodeURIComponent(publishToken)}`
      : null,
  };
}

// ─── Geração de código (admin do painel) ────────────────────────────────────
const generateCodeSchema = z.object({
  name: z.string().trim().min(1).max(120).default("PC da escola"),
  schoolId: z.string().trim().min(1).optional(),
});

router.post(
  "/pairing-code",
  requireAuth,
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId;
    const body = generateCodeSchema.parse(req.body ?? {});

    if (body.schoolId) {
      const school = await prisma.school.findFirst({
        where: { id: body.schoolId, tenantId },
        select: { id: true },
      });
      if (!school) {
        res.status(404).json({ error: "Escola não encontrada" });
        return;
      }
    }

    // Código de 6 dígitos numéricos único (tenta 5 vezes)
    let code = "";
    for (let attempt = 0; attempt < 5; attempt++) {
      code = String(crypto.randomInt(100000, 999999));
      const exists = await prisma.gatewayPairingCode.findUnique({ where: { code } });
      if (!exists) break;
    }

    const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);

    await prisma.gatewayPairingCode.create({
      data: {
        code,
        tenantId,
        schoolId: body.schoolId,
        name: body.name,
        expiresAt,
      },
    });

    res.json({ code, expiresAt: expiresAt.toISOString() });
  }),
);

// ─── Pareamento (sem auth — gateway novo) ───────────────────────────────────
const pairSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
  machineInfo: z
    .object({
      hostname: z.string().optional(),
      platform: z.string().optional(),
      arch: z.string().optional(),
      version: z.string().optional(),
    })
    .partial()
    .default({}),
});

router.post(
  "/pair",
  asyncHandler(async (req, res) => {
    const body = pairSchema.parse(req.body ?? {});

    const pc = await prisma.gatewayPairingCode.findUnique({
      where: { code: body.code },
    });

    if (!pc || pc.consumedAt || pc.expiresAt < new Date()) {
      res.status(400).json({ error: "Código inválido ou expirado." });
      return;
    }

    const token = crypto.randomBytes(TOKEN_BYTES).toString("hex");
    const tokenEncrypted = encryptSecret(token);

    const school = pc.schoolId
      ? await prisma.school.findUnique({
          where: { id: pc.schoolId },
          select: { name: true },
        })
      : null;

    const gateway = await prisma.gateway.create({
      data: {
        tenantId: pc.tenantId,
        schoolId: pc.schoolId,
        name: pc.name,
        tokenEncrypted,
        hostname: body.machineInfo.hostname,
        platform: body.machineInfo.platform,
        arch: body.machineInfo.arch,
        appVersion: body.machineInfo.version,
        status: GatewayStatus.PAIRED,
      },
    });

    await prisma.gatewayPairingCode.update({
      where: { code: pc.code },
      data: {
        consumedAt: new Date(),
        consumedByGatewayId: gateway.id,
      },
    });

    res.json({
      gatewayId: gateway.id,
      gatewayToken: token,
      gatewayName: gateway.name,
      schoolId: gateway.schoolId,
      schoolName: school?.name,
    });
  }),
);

// ─── Helper: middleware Bearer pra rotas autenticadas por gateway ──────────
export async function loadGatewayFromBearer(req: Request): Promise<{ gatewayId: string; tenantId: string; schoolId: string | null } | null> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.substring(7).trim();
  if (!token) return null;
  // Não há índice por tokenEncrypted (ciphertext muda por nonce). Para perf,
  // poderíamos manter um hash adicional. Por enquanto fazemos full scan filtrado
  // por status — número de gateways por tenant é baixo.
  const candidates = await prisma.gateway.findMany({
    where: { status: { not: GatewayStatus.REVOKED } },
    select: { id: true, tokenEncrypted: true, tenantId: true, schoolId: true },
  });
  for (const c of candidates) {
    try {
      if (decryptSecret(c.tokenEncrypted) === token) {
        return { gatewayId: c.id, tenantId: c.tenantId, schoolId: c.schoolId };
      }
    } catch {
      /* token corrompido, ignora */
    }
  }
  return null;
}

router.post(
  "/heartbeat",
  asyncHandler(async (req, res) => {
    const ctx = await loadGatewayFromBearer(req);
    if (!ctx) {
      res.status(401).json({ error: "Token de gateway inválido" });
      return;
    }
    await prisma.gateway.update({
      where: { id: ctx.gatewayId },
      data: { lastSeenAt: new Date(), status: GatewayStatus.ACTIVE },
    });
    res.json({ ok: true });
  }),
);

const discoveredSchema = z.object({
  cameras: z
    .array(
      z.object({
        ip: z.string().min(1),
        serialNumber: z.string().min(1),
        deviceModel: z.string().optional().default(""),
        hardware: z.string().optional().default(""),
        mac: z.string().optional().default(""),
      }),
    )
    .max(200),
});

router.post(
  "/cameras/discovered",
  asyncHandler(async (req, res) => {
    const ctx = await loadGatewayFromBearer(req);
    if (!ctx) {
      res.status(401).json({ error: "Token de gateway inválido" });
      return;
    }
    const body = discoveredSchema.parse(req.body ?? {});
    const schoolId = await resolveGatewaySchool(ctx.tenantId, ctx.schoolId);
    if (!schoolId) {
      res.status(409).json({
        error: "Associe o gateway a uma escola antes de cadastrar cameras automaticamente.",
        code: "GATEWAY_SCHOOL_REQUIRED",
      });
      return;
    }

    const registered = [];
    for (const cam of body.cameras) {
      const key = streamKey(cam.serialNumber);
      if (!key) continue;

      const existing = await prisma.camera.findFirst({
        where: { tenantId: ctx.tenantId, serialNumber: cam.serialNumber },
        select: { id: true },
      });

      const baseData = {
        schoolId,
        name: cam.deviceModel || `Camera ${key.slice(-6)}`,
        location: `Gateway - ${cam.ip}`,
        type: CameraType.RTSP,
        resolution: "1080p",
        fps: 15,
        status: CameraStatus.ACTIVE,
        serialNumber: cam.serialNumber,
        bluetoothMac: cam.mac || undefined,
      };

      const camera = existing
        ? await prisma.camera.update({
            where: { id: existing.id },
            data: {
              ...baseData,
              streamUrl: relayUrls(cam.serialNumber, existing.id).liveUrl,
            },
          })
        : await prisma.camera.create({
            data: {
              tenantId: ctx.tenantId,
              ...baseData,
              streamUrl: "pending://live",
            },
          });

      const urls = relayUrls(cam.serialNumber, camera.id);
      if (!existing) {
        await prisma.camera.update({
          where: { id: camera.id },
          data: { streamUrl: urls.liveUrl },
        });
      }

      await prisma.cameraRuntimeStatus.upsert({
        where: { cameraId: camera.id },
        create: {
          tenantId: ctx.tenantId,
          schoolId,
          cameraId: camera.id,
          gatewayId: ctx.gatewayId,
          healthStatus: "OFFLINE",
          lastHeartbeatAt: new Date(),
          metadata: { serialNumber: cam.serialNumber, cameraIp: cam.ip, relay: "go2rtc-dvrip" },
        },
        update: {
          gatewayId: ctx.gatewayId,
          lastHeartbeatAt: new Date(),
          metadata: { serialNumber: cam.serialNumber, cameraIp: cam.ip, relay: "go2rtc-dvrip" },
        },
      });

      registered.push({
        serialNumber: cam.serialNumber,
        cameraId: camera.id,
        streamKey: urls.streamKey,
        liveUrl: urls.liveUrl,
        publishUrl: urls.publishUrl,
      });
    }

    await prisma.gateway.update({
      where: { id: ctx.gatewayId },
      data: { lastSeenAt: new Date(), status: GatewayStatus.ACTIVE },
    });

    res.json({
      ok: true,
      received: body.cameras.length,
      registered,
      relayEnabled: registered.every((camera) => !!camera.publishUrl),
    });
  }),
);

/**
 * Upload de frame JPEG capturado pelo gateway.
 *
 * Request:
 *  - method: POST
 *  - path: /api/gateways/frame
 *  - headers: Authorization: Bearer <gatewayToken>, Content-Type: image/jpeg
 *  - query: serialNumber, cameraIp, capturedAt (ms), elapsedMs
 *  - body: JPEG bruto (até 5 MB)
 *
 * Behavior:
 *  1. Resolve gateway pelo Bearer token
 *  2. Encontra câmera no tenant pelo SerialNumber recebido
 *  3. Atualiza lastSeenAt do gateway
 *  4. Dispara biometricEngine.findBestMatch (assíncrono — não bloqueia o response)
 *  5. Responde 202 Accepted imediatamente
 */
router.post(
  "/frame",
  raw({ type: "image/jpeg", limit: "5mb" }),
  asyncHandler(async (req, res) => {
    const ctx = await loadGatewayFromBearer(req);
    if (!ctx) {
      res.status(401).json({ error: "Token de gateway inválido" });
      return;
    }

    const serialNumber = String(req.query.serialNumber ?? "").trim();
    const cameraIp = String(req.query.cameraIp ?? "").trim();
    const capturedAtMs = Number(req.query.capturedAt) || Date.now();

    if (!serialNumber) {
      res.status(400).json({ error: "serialNumber é obrigatório" });
      return;
    }

    const buf = req.body as Buffer | undefined;
    if (!buf || !Buffer.isBuffer(buf) || buf.length < 100) {
      res.status(400).json({ error: "Body deve ser JPEG válido" });
      return;
    }

    // Encontra câmera no tenant pelo SN
    const camera = await prisma.camera.findFirst({
      where: {
        tenantId: ctx.tenantId,
        serialNumber,
        status: CameraStatus.ACTIVE,
      },
      select: { id: true, schoolId: true },
    });

    // Atualiza heartbeat do gateway
    await prisma.gateway.update({
      where: { id: ctx.gatewayId },
      data: { lastSeenAt: new Date(), status: GatewayStatus.ACTIVE },
    });

    if (!camera) {
      // Frame chegou de câmera ainda não cadastrada — descarta mas responde OK
      // pra gateway não ficar retentando.
      res.status(202).json({ ok: true, recognized: false, reason: "camera_not_registered" });
      return;
    }

    // Reconhecimento em background — não bloqueia o gateway
    const imageBase64 = buf.toString("base64");
    biometricEngine
      .findBestMatch({
        tenantId: ctx.tenantId,
        schoolId: camera.schoolId,
        imageBase64,
        cameraId: camera.id,
        recognizedAt: new Date(capturedAtMs),
      })
      .catch((err) => {
        console.warn(
          `[gateways/frame] reconhecimento falhou (tenant=${ctx.tenantId} cam=${camera.id}):`,
          err?.message ?? err,
        );
      });

    res.status(202).json({ ok: true, cameraId: camera.id, accepted: true });
  }),
);

// ─── Admin: listar gateways do tenant ───────────────────────────────────────
router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId;
    const gateways = await prisma.gateway.findMany({
      where: { tenantId },
      select: {
        id: true,
        name: true,
        schoolId: true,
        hostname: true,
        platform: true,
        appVersion: true,
        status: true,
        lastSeenAt: true,
        createdAt: true,
        school: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json({ gateways });
  }),
);

router.delete(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId;
    const id = String(req.params.id);
    const gateway = await prisma.gateway.findFirst({
      where: { id, tenantId },
    });
    if (!gateway) {
      res.status(404).json({ error: "Gateway não encontrado" });
      return;
    }
    await prisma.gateway.update({
      where: { id },
      data: { status: GatewayStatus.REVOKED },
    });
    res.json({ ok: true });
  }),
);

export const gatewayRoutes = router;
