import { Router, Request, Response } from 'express';
import type { AuthenticatedServiceRequest } from '../middleware/service-auth';
import facePlatformService from '../services/FacePlatformService';

const router = Router();

function respondWithFaceError(res: Response, error: any, fallbackStatus = 500) {
  const status = Number(error?.status || error?.statusCode || error?.response?.status || fallbackStatus);
  const safeStatus = Number.isFinite(status) ? status : fallbackStatus;
  const message = error?.message || 'Erro interno do servidor';

  return res.status(safeStatus).json({
    success: false,
    error: message,
    message,
    ...(error?.details !== undefined ? { details: error.details } : {}),
    ...(error?.code ? { code: error.code } : {}),
  });
}

function hasEmbedding(payload: any) {
  return Array.isArray(payload?.embedding) && payload.embedding.length > 0;
}

router.get('/status', async (_req: Request, res: Response) => {
  try {
    return res.json(await facePlatformService.getStatus());
  } catch (error: any) {
    console.error('Erro ao carregar status do serviço facial:', error);
    return respondWithFaceError(res, error, 500);
  }
});

router.get('/dashboard', async (_req: Request, res: Response) => {
  try {
    const data = await facePlatformService.getDashboard();
    return res.json(data);
  } catch (error: any) {
    console.error('Erro ao carregar dashboard facial:', error);
    return respondWithFaceError(res, error, 500);
  }
});

router.get('/schools', async (_req: Request, res: Response) => {
  try {
    const schools = await facePlatformService.listSchools();
    return res.json(schools);
  } catch (error: any) {
    console.error('Erro ao listar escolas para segurança escolar:', error);
    return respondWithFaceError(res, error, 500);
  }
});

router.get('/schools/:schoolId/citizens', async (req: Request, res: Response) => {
  try {
    const data = await facePlatformService.listSchoolCitizens(String(req.params.schoolId));
    return res.json(data);
  } catch (error: any) {
    console.error('Erro ao listar cidadãos da unidade escolar:', error);
    return respondWithFaceError(res, error, 500);
  }
});

router.get('/devices', async (_req: Request, res: Response) => {
  try {
    const devices = await facePlatformService.listDevices();
    return res.json(devices);
  } catch (error: any) {
    console.error('Erro ao listar dispositivos faciais:', error);
    return respondWithFaceError(res, error, 500);
  }
});

router.post('/devices', async (req: Request, res: Response) => {
  try {
    const device = await facePlatformService.createDevice(req.body);
    return res.status(201).json(device);
  } catch (error: any) {
    console.error('Erro ao criar dispositivo facial:', error);
    return respondWithFaceError(res, error, 500);
  }
});

router.put('/devices/:id', async (req: Request, res: Response) => {
  try {
    const device = await facePlatformService.updateDevice(String(req.params.id), req.body);
    return res.json(device);
  } catch (error: any) {
    console.error('Erro ao atualizar dispositivo facial:', error);
    return respondWithFaceError(res, error, 500);
  }
});

router.get('/zones', async (_req: Request, res: Response) => {
  try {
    const zones = await facePlatformService.listZones();
    return res.json(zones);
  } catch (error: any) {
    console.error('Erro ao listar zonas faciais:', error);
    return respondWithFaceError(res, error, 500);
  }
});

router.post('/zones', async (req: Request, res: Response) => {
  try {
    const zone = await facePlatformService.createZone(req.body);
    return res.status(201).json(zone);
  } catch (error: any) {
    console.error('Erro ao criar zona facial:', error);
    return respondWithFaceError(res, error, 500);
  }
});

router.get('/configurations', async (_req: Request, res: Response) => {
  try {
    const configurations = await facePlatformService.listConfigurations();
    return res.json(configurations);
  } catch (error: any) {
    console.error('Erro ao listar configurações escolares:', error);
    return respondWithFaceError(res, error, 500);
  }
});

router.put('/configurations/:schoolId', async (req: Request, res: Response) => {
  try {
    const configuration = await facePlatformService.upsertSchoolConfiguration({
      ...req.body,
      unidadeEducacaoId: String(req.params.schoolId),
    });
    return res.json(configuration);
  } catch (error: any) {
    console.error('Erro ao salvar configuração escolar:', error);
    return respondWithFaceError(res, error, 500);
  }
});

router.get('/identities', async (_req: Request, res: Response) => {
  try {
    const identities = await facePlatformService.listIdentities();
    return res.json(identities);
  } catch (error: any) {
    console.error('Erro ao listar identidades faciais:', error);
    return respondWithFaceError(res, error, 500);
  }
});

router.post('/identities/enrollments', async (req: AuthenticatedServiceRequest, res: Response) => {
  try {
    if (!hasEmbedding(req.body)) {
      return res.status(400).json({
        success: false,
        error: 'O cadastro facial exige embedding válido do face-api.js.',
        message: 'O cadastro facial exige embedding válido do face-api.js.',
      });
    }

    const identity = await facePlatformService.createEnrollment({
      ...req.body,
      approvedById: req.serviceAuth?.userId || req.body?.approvedById || null,
    }, req.serviceAuth);
    return res.status(201).json(identity);
  } catch (error: any) {
    console.error('Erro ao registrar enrollment facial:', error);
    return respondWithFaceError(res, error, 500);
  }
});

router.delete('/identities/citizens/:citizenId/biometry', async (req: AuthenticatedServiceRequest, res: Response) => {
  try {
    const result = await facePlatformService.deleteCitizenBiometry({
      citizenId: String(req.params.citizenId),
      deletedById: req.body?.deletedById || null,
      reason: req.body?.reason || null,
    }, req.serviceAuth);
    return res.json(result);
  } catch (error: any) {
    console.error('Erro ao excluir biometria facial do cidadão:', error);
    return respondWithFaceError(res, error, 500);
  }
});

router.post('/recognition/read', async (req: Request, res: Response) => {
  try {
    if (!hasEmbedding(req.body)) {
      return res.status(400).json({
        success: false,
        error: 'A leitura biométrica ao vivo exige embedding válido do face-api.js.',
        message: 'A leitura biométrica ao vivo exige embedding válido do face-api.js.',
      });
    }

    const result = await facePlatformService.readBiometry(req.body);
    return res.json(result);
  } catch (error: any) {
    console.error('Erro ao ler biometria facial ao vivo:', error);
    return respondWithFaceError(res, error, 500);
  }
});

router.get('/events', async (req: Request, res: Response) => {
  try {
    const events = await facePlatformService.listEvents({
      unidadeEducacaoId: req.query.unidadeEducacaoId as string | undefined,
      zoneId: req.query.zoneId as string | undefined,
      matchStatus: req.query.matchStatus as any,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    return res.json(events);
  } catch (error: any) {
    console.error('Erro ao listar eventos faciais:', error);
    return respondWithFaceError(res, error, 500);
  }
});

router.post('/events/ingest', async (req: AuthenticatedServiceRequest, res: Response) => {
  try {
    if (!hasEmbedding(req.body)) {
      return res.status(400).json({
        success: false,
        error: 'A ingestão de evento facial exige embedding válido do face-api.js.',
        message: 'A ingestão de evento facial exige embedding válido do face-api.js.',
      });
    }

    const event = await facePlatformService.ingestRecognition(req.body, req.serviceAuth);
    return res.status(201).json(event);
  } catch (error: any) {
    console.error('Erro ao ingerir evento facial:', error);
    return respondWithFaceError(res, error, 500);
  }
});

router.post('/events/:id/review', async (req: AuthenticatedServiceRequest, res: Response) => {
  try {
    const event = await facePlatformService.reviewEvent(
      String(req.params.id),
      req.body.reviewedById,
      req.body.decision,
      req.serviceAuth
    );
    return res.json(event);
  } catch (error: any) {
    console.error('Erro ao revisar evento facial:', error);
    return respondWithFaceError(res, error, 500);
  }
});

export default router;
