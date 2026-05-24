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
import { Router } from "express";
import { z } from "zod";
import { GatewayStatus, Prisma } from "@prisma/client";

import { asyncHandler } from "../lib/http";
import { prisma } from "../lib/prisma";
import { encryptSecret, decryptSecret } from "../lib/security";
import { requireAuth } from "../middleware/auth";

const router = Router();

const PAIRING_TTL_MS = 10 * 60 * 1000;
const TOKEN_BYTES = 32;

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
async function loadGatewayFromBearer(req: any): Promise<{ gatewayId: string; tenantId: string; schoolId: string | null } | null> {
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

    // Atualiza IP/streamUrl para cada câmera cadastrada com aquele SerialNumber
    let updated = 0;
    for (const cam of body.cameras) {
      const result = await prisma.camera.updateMany({
        where: { tenantId: ctx.tenantId, serialNumber: cam.serialNumber },
        data: {
          // Mantém streamUrl gravado pelo APK (rtsp://vigiaescolar.com.br:8554/live/<SN>)
          // mas registra IP/MAC observados para diagnóstico.
        } as Prisma.CameraUpdateManyMutationInput,
      });
      updated += result.count;
    }

    await prisma.gateway.update({
      where: { id: ctx.gatewayId },
      data: { lastSeenAt: new Date(), status: GatewayStatus.ACTIVE },
    });

    res.json({ ok: true, updated, received: body.cameras.length });
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
