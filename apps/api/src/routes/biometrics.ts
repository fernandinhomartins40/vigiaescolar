import { Router } from "express";
import { FaceMatchStatus, UserRole } from "@prisma/client";
import { z } from "zod";
import { asyncHandler } from "../lib/http";
import { requireAuth, requireRole } from "../middleware/auth";
import { biometricEngine } from "../services/biometrics/engine";
import { facePlatformClient } from "../services/face-platform/client";

const router = Router();

router.use(requireAuth);
router.use(requireRole(UserRole.OWNER, UserRole.ADMIN, UserRole.STAFF));

const querySchema = z.object({
  schoolId: z.string().trim().optional(),
  cameraId: z.string().trim().optional(),
  alunoId: z.string().trim().optional(),
  data: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  matchStatus: z.nativeEnum(FaceMatchStatus).optional(),
});

router.get(
  "/status",
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId;
    const [local, facePlatform] = await Promise.all([
      biometricEngine.getStatus(tenantId),
      facePlatformClient.getStatus(tenantId, req.auth!.userId),
    ]);

    res.json({
      ...local,
      facePlatform,
    });
  }),
);

router.get(
  "/identidades",
  asyncHandler(async (req, res) => {
    const identities = await biometricEngine.listIdentities(req.auth!.tenantId);
    res.json(identities);
  }),
);

router.get(
  "/referencias",
  asyncHandler(async (req, res) => {
    const references = await biometricEngine.listRecognitionReferences(req.auth!.tenantId);
    res.json(references);
  }),
);

router.get(
  "/references",
  asyncHandler(async (req, res) => {
    const references = await biometricEngine.listRecognitionReferences(req.auth!.tenantId);
    res.json(references);
  }),
);

router.get(
  "/eventos",
  asyncHandler(async (req, res) => {
    const query = querySchema.parse(req.query);
    const events = await biometricEngine.listEvents(
      req.auth!.tenantId,
      {
        schoolId: query.schoolId,
        cameraId: query.cameraId,
        studentId: query.alunoId,
        date: query.data,
        matchStatus: query.matchStatus,
      },
    );

    res.json(events);
  }),
);

export default router;
