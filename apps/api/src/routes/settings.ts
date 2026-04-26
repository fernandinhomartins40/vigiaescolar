import { Router } from "express";
import { UserRole } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/http";
import { requireAuth, requireRole } from "../middleware/auth";
import { toTenantSettingsDTO } from "../lib/serializers";

const router = Router();

router.use(requireAuth);
router.use(requireRole(UserRole.OWNER, UserRole.ADMIN));

const settingsGroupSchema = z.object({
  notifications: z
    .object({
      notifyEntry: z.boolean(),
      notifyExit: z.boolean(),
      notifyLate: z.boolean(),
      notifyAbsence: z.boolean(),
      entradaAluno: z.boolean(),
      saidaAluno: z.boolean(),
      atraso: z.boolean(),
      ausencia: z.boolean(),
      whatsapp: z.boolean(),
      push: z.boolean(),
    })
    .partial()
    .passthrough(),
  recognition: z
    .object({
      confidenceThreshold: z.coerce.number().int().min(0).max(100),
      framesPerSecond: z.coerce.number().int().min(1).max(60),
      analysisFps: z.coerce.number().int().min(1).max(60),
      saveFrames: z.boolean(),
      detectMasks: z.boolean(),
    })
    .partial()
    .passthrough(),
  security: z
    .object({
      twoFactor: z.boolean(),
      auditLog: z.boolean(),
    })
    .partial(),
  retention: z
    .object({
      recordingsDays: z.coerce.number().int().min(1).max(3650),
      logsDays: z.coerce.number().int().min(1).max(3650),
    })
    .partial(),
  dataRetentionDays: z.coerce.number().int().min(1).max(3650).optional(),
  logRetentionDays: z.coerce.number().int().min(1).max(3650).optional(),
}).passthrough();

const createDefaultSettings = async (tenantId: string) =>
  prisma.tenantSettings.create({
    data: {
      tenantId,
    },
  });

async function ensureSettings(tenantId: string) {
  const settings = await prisma.tenantSettings.findUnique({
    where: { tenantId },
  });

  if (settings) {
    return settings;
  }

  return createDefaultSettings(tenantId);
}

function mapSettingsInput(
  body: z.infer<typeof settingsGroupSchema>,
  current: Awaited<ReturnType<typeof ensureSettings>>,
) {
  return {
    notifyEntry: body.notifications?.notifyEntry ?? body.notifications?.entradaAluno ?? current.notifyEntry,
    notifyExit: body.notifications?.notifyExit ?? body.notifications?.saidaAluno ?? current.notifyExit,
    notifyLate: body.notifications?.notifyLate ?? body.notifications?.atraso ?? current.notifyLate,
    notifyAbsence: body.notifications?.notifyAbsence ?? body.notifications?.ausencia ?? current.notifyAbsence,
    whatsappEnabled: body.notifications?.whatsapp ?? current.whatsappEnabled,
    pushEnabled: body.notifications?.push ?? current.pushEnabled,
    confidenceThreshold: body.recognition?.confidenceThreshold ?? current.confidenceThreshold,
    framesPerSecond: body.recognition?.framesPerSecond ?? body.recognition?.analysisFps ?? current.framesPerSecond,
    saveFrames: body.recognition?.saveFrames ?? current.saveFrames,
    detectMasks: body.recognition?.detectMasks ?? current.detectMasks,
    twoFactorEnabled: body.security?.twoFactor ?? current.twoFactorEnabled,
    auditLogEnabled: body.security?.auditLog ?? current.auditLogEnabled,
    recordingsRetentionDays: body.retention?.recordingsDays ?? body.dataRetentionDays ?? current.recordingsRetentionDays,
    logsRetentionDays: body.retention?.logsDays ?? body.logRetentionDays ?? current.logsRetentionDays,
  };
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const settings = await ensureSettings(req.auth!.tenantId);
    res.json(toTenantSettingsDTO(settings));
  }),
);

router.put(
  "/",
  requireRole(UserRole.OWNER, UserRole.ADMIN),
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId;
    const body = settingsGroupSchema.parse(req.body);
    const current = await ensureSettings(tenantId);

    const settings = await prisma.tenantSettings.update({
      where: { tenantId },
      data: mapSettingsInput(body, current),
    });

    res.json(toTenantSettingsDTO(settings));
  }),
);

router.patch(
  "/",
  requireRole(UserRole.OWNER, UserRole.ADMIN),
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId;
    const body = settingsGroupSchema.partial().parse(req.body);
    const current = await ensureSettings(tenantId);

    const settings = await prisma.tenantSettings.update({
      where: { tenantId },
      data: mapSettingsInput(body as z.infer<typeof settingsGroupSchema>, current),
    });

    res.json(toTenantSettingsDTO(settings));
  }),
);

router.delete(
  "/",
  requireRole(UserRole.OWNER, UserRole.ADMIN),
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId;
    await prisma.tenantSettings.delete({
      where: { tenantId },
    });
    res.status(204).send();
  }),
);

export default router;
