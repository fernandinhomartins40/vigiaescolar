import crypto from 'crypto';
import {
  FaceEnrollmentStatus,
  FaceEventType,
  FaceMatchStatus,
  FaceRecognitionIdentityStatus,
  GuardianNotificationStatus,
  Prisma,
  SituacaoMatricula,
} from '@prisma/client';
import prisma from '../utils/prisma';
import { syncCitizenPersonIdentity } from './person-identity.service';
import digiUrbanIntegration from '../integrations/DigiUrbanIntegration';
import faceStorageService from './face/face-storage.service';
import { cosineSimilarity, normalizeVector } from './face/vector-utils';
import faceLivenessService from './face/face-liveness.service';

const FACE_ENCRYPTION_KEY =
  process.env.FACE_PLATFORM_ENCRYPTION_KEY ||
  process.env.ENCRYPTION_MASTER_KEY ||
  'CHANGE_THIS_FACE_PLATFORM_KEY';

interface CreateDeviceInput {
  code: string;
  name: string;
  unidadeEducacaoId?: string | null;
  type?: 'CAMERA' | 'GATEWAY' | 'NVR';
  protocol?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  locationDescription?: string | null;
  streamUrl?: string | null;
  username?: string | null;
  password?: string | null;
  metadata?: Prisma.InputJsonValue;
}

interface CreateZoneInput {
  deviceId: string;
  unidadeEducacaoId?: string | null;
  name: string;
  gateName?: string | null;
  direction?: 'ENTRY' | 'EXIT' | 'BOTH';
  dedupeWindowSecs?: number;
  metadata?: Prisma.InputJsonValue;
}

interface UpsertSchoolConfigurationInput {
  unidadeEducacaoId: string;
  notifyOnEntry?: boolean;
  notifyOnExit?: boolean;
  preferredChannel?: string;
  dedupeWindowSecs?: number;
  entryMessageTemplate?: string | null;
  exitMessageTemplate?: string | null;
  activeHoursStart?: string | null;
  activeHoursEnd?: string | null;
  isActive?: boolean;
  metadata?: Prisma.InputJsonValue;
}

interface CreateEnrollmentInput {
  citizenId: string;
  sourceType?: string;
  sourceLabel?: string | null;
  imageBase64?: string | null;
  embedding?: number[] | null;
  qualityScore?: number | null;
  livenessScore?: number | null;
  metadata?: Prisma.InputJsonValue;
  approvedById?: string | null;
  modelName?: string;
  modelVersion?: string | null;
}

interface ReadBiometryInput {
  imageBase64?: string | null;
  embedding?: number[] | null;
  qualityScore?: number | null;
  livenessScore?: number | null;
  metadata?: Prisma.InputJsonValue;
  expectedCitizenId?: string | null;
  sourceType?: string;
  sourceLabel?: string | null;
  modelName?: string | null;
  modelVersion?: string | null;
}

interface DeleteCitizenBiometryInput {
  citizenId: string;
  deletedById?: string | null;
  reason?: string | null;
}

interface IngestRecognitionInput {
  deviceId: string;
  zoneId?: string | null;
  unidadeEducacaoId?: string | null;
  citizenId?: string | null;
  studentCitizenId?: string | null;
  identityId?: string | null;
  eventType?: 'DETECTION' | 'ENTRY' | 'EXIT' | 'UNMATCHED' | 'REVIEW';
  confidence?: number | null;
  imageBase64?: string | null;
  embedding?: number[] | null;
  boundingBox?: Prisma.InputJsonValue;
  metadata?: Prisma.InputJsonValue;
  provider?: string | null;
  modelName?: string | null;
  modelVersion?: string | null;
  recognizedAt?: string | Date | null;
}

export interface FaceRequestContext {
  tenantId: string;
  userId?: string | null;
}

function encryptSecret(value?: string | null) {
  if (!value) {
    return null;
  }

  const key = crypto.createHash('sha256').update(FACE_ENCRYPTION_KEY).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

function unique<T>(items: T[]) {
  return Array.from(new Set(items));
}

function normalizeEmbedding(vector: number[]) {
  return normalizeVector(vector.map((value) => Number(value) || 0));
}

function buildEventTimestamp(recognizedAt?: string | Date | null) {
  if (!recognizedAt) {
    return new Date();
  }

  return recognizedAt instanceof Date ? recognizedAt : new Date(recognizedAt);
}

function renderTemplate(template: string | null | undefined, variables: Record<string, string>) {
  if (!template) {
    return null;
  }

  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => variables[key] || '');
}

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function getAutoApproveQualityThreshold() {
  return Number(process.env.FACE_AUTO_APPROVE_QUALITY_THRESHOLD || 0.78);
}

function getAutoApproveLivenessThreshold() {
  return Number(process.env.FACE_AUTO_APPROVE_LIVENESS_THRESHOLD || 0.82);
}

function getAutoMatchThreshold() {
  return Number(process.env.FACE_AUTO_MATCH_THRESHOLD || 0.92);
}

function getReviewMatchThreshold() {
  return Number(process.env.FACE_REVIEW_MATCH_THRESHOLD || 0.82);
}

function createFacePlatformError(message: string, status = 500, details?: unknown) {
  const error = new Error(message) as Error & { status?: number; details?: unknown };
  error.status = status;
  error.details = details;
  return error;
}

function extractTenantIdFromMetadata(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== 'object') {
    return undefined;
  }

  const rawTenantId = (metadata as Record<string, unknown>).requestTenantId;
  return typeof rawTenantId === 'string' && rawTenantId.trim() ? rawTenantId.trim() : undefined;
}

export class FacePlatformService {
  public async getStatus() {
    try {
      await Promise.all([
        prisma.faceRecognitionIdentity.count(),
        prisma.faceDevice.count(),
        prisma.faceZone.count(),
        prisma.faceRecognitionEvent.count(),
        prisma.schoolSecurityConfiguration.count(),
      ]);
    } catch (error: any) {
      const missingSchema =
        error?.code === 'P2021' ||
        /relation .* does not exist/i.test(error?.message || '') ||
        /table .* does not exist/i.test(error?.message || '');

      return {
        available: false,
        schemaReady: false,
        service: 'ultrazend-face-server',
        code: error?.code || null,
        message: missingSchema
          ? 'As tabelas do reconhecimento facial ainda não foram aplicadas no banco.'
          : 'O serviço facial está ativo, mas a base ainda não está pronta.',
        providers: {
          recognition: {
            configured: true,
            available: true,
            engine: 'face-api.js-vector-store',
            message: 'Motor vetorial face-api.js aguardando schema do serviço facial.',
          },
          liveness: await faceLivenessService.getStatus(),
        },
        timestamp: new Date().toISOString(),
      };
    }

    const livenessStatus = await faceLivenessService.getStatus();
    const recognitionStatus = {
      configured: true,
      available: true,
      engine: 'face-api.js-vector-store',
      message: 'Reconhecimento vetorial face-api.js ativo.',
    };

    return {
      available: true,
      schemaReady: true,
      service: 'ultrazend-face-server',
      message: 'Serviço facial disponível.',
      providers: {
        recognition: recognitionStatus,
        liveness: livenessStatus,
      },
      timestamp: new Date().toISOString(),
    };
  }

  public async getDashboard() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      totalIdentities,
      totalDevices,
      totalZones,
      totalSchools,
      eventsToday,
      matchedToday,
      pendingReviews,
      notificationsPending,
      recentEvents,
    ] = await Promise.all([
      prisma.faceRecognitionIdentity.count(),
      prisma.faceDevice.count({ where: { isActive: true } }),
      prisma.faceZone.count({ where: { isActive: true } }),
      prisma.unidadeEducacao.count({ where: { isActive: true } }),
      prisma.faceRecognitionEvent.count({ where: { recognizedAt: { gte: today } } }),
      prisma.faceRecognitionEvent.count({
        where: {
          recognizedAt: { gte: today },
          matchStatus: FaceMatchStatus.MATCHED,
        },
      }),
      prisma.faceRecognitionEvent.count({
        where: {
          matchStatus: FaceMatchStatus.REVIEW_REQUIRED,
        },
      }),
      prisma.faceRecognitionEvent.count({
        where: {
          notificationStatus: GuardianNotificationStatus.PENDING,
        },
      }),
      prisma.faceRecognitionEvent.findMany({
        take: 10,
        orderBy: { recognizedAt: 'desc' },
        include: {
          device: true,
          zone: true,
          unidadeEducacao: true,
          studentCitizen: {
            select: { id: true, name: true },
          },
          guardianCitizen: {
            select: { id: true, name: true },
          },
        },
      }),
    ]);

    return {
      totals: {
        totalIdentities,
        totalDevices,
        totalZones,
        totalSchools,
        eventsToday,
        matchedToday,
        pendingReviews,
        notificationsPending,
      },
      recentEvents: recentEvents.map((event) => this.serializeEvent(event)),
    };
  }

  public async listSchools() {
    const schools = await prisma.unidadeEducacao.findMany({
      where: { isActive: true },
      include: {
        schoolSecurityConfiguration: true,
        _count: {
          select: {
            faceDevices: true,
            faceZones: true,
            faceEvents: true,
          },
        },
      },
      orderBy: { nome: 'asc' },
    });

    return schools.map((school) => ({
      id: school.id,
      nome: school.nome,
      tipo: school.tipo,
      telefone: school.telefone,
      email: school.email,
      hasConfiguration: Boolean(school.schoolSecurityConfiguration),
      configuracao: school.schoolSecurityConfiguration,
      totais: school._count,
    }));
  }

  public async listSchoolCitizens(unidadeEducacaoId: string) {
    const matriculas = await prisma.matricula.findMany({
      where: {
        unidadeEducacaoId,
        situacao: SituacaoMatricula.ATIVA,
      },
      orderBy: { updatedAt: 'desc' },
    });

    const citizenIds = unique(matriculas.map((item) => item.alunoId));
    const guardianIds = unique(matriculas.map((item) => item.responsavelId));

    const [citizens, guardians, identities, school] = await Promise.all([
      prisma.citizen.findMany({
        where: { id: { in: citizenIds } },
        select: { id: true, name: true, cpf: true, phone: true, personId: true },
      }),
      prisma.citizen.findMany({
        where: { id: { in: guardianIds } },
        select: { id: true, name: true, phone: true, email: true },
      }),
      prisma.faceRecognitionIdentity.findMany({
        where: {
          citizenId: { in: citizenIds },
        },
        include: {
          enrollments: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
          embeddings: {
            where: { isActive: true },
          },
        },
      }),
      prisma.unidadeEducacao.findUnique({
        where: { id: unidadeEducacaoId },
        select: { id: true, nome: true, tipo: true },
      }),
    ]);

    const citizenMap = new Map(citizens.map((citizen) => [citizen.id, citizen]));
    const guardianMap = new Map(guardians.map((guardian) => [guardian.id, guardian]));
    const identityMap = new Map(identities.map((identity) => [identity.citizenId, identity]));

    return {
      school,
      citizens: matriculas
        .map((matricula) => {
          const citizen = citizenMap.get(matricula.alunoId);
          const guardian = guardianMap.get(matricula.responsavelId);
          const identity = identityMap.get(matricula.alunoId);

          if (!citizen) {
            return null;
          }

          return {
            matriculaId: matricula.id,
            numeroMatricula: matricula.numeroMatricula,
            citizen,
            aluno: citizen,
            guardian: guardian || null,
            responsavel: guardian || null,
            faceIdentity: identity
              ? {
                  id: identity.id,
                  status: identity.status,
                  totalEmbeddings: this.countRegisteredTemplates(identity),
                  latestEnrollment: identity.enrollments[0] || null,
                }
              : null,
            };
        })
        .filter(Boolean),
    };
  }

  public async listDevices() {
    const devices = await prisma.faceDevice.findMany({
      include: {
        unidadeEducacao: {
          select: { id: true, nome: true, tipo: true },
        },
        zones: true,
      },
      orderBy: { name: 'asc' },
    });

    return devices.map((device) => this.serializeDevice(device));
  }

  public async createDevice(input: CreateDeviceInput) {
    const device = await prisma.faceDevice.create({
      data: {
        code: input.code.trim(),
        name: input.name.trim(),
        unidadeEducacaoId: input.unidadeEducacaoId || null,
        type: input.type || 'CAMERA',
        protocol: input.protocol || 'RTSP',
        manufacturer: input.manufacturer || null,
        model: input.model || null,
        locationDescription: input.locationDescription || null,
        streamUrlEncrypted: encryptSecret(input.streamUrl),
        usernameEncrypted: encryptSecret(input.username),
        passwordEncrypted: encryptSecret(input.password),
        metadata: (input.metadata || {}) as Prisma.InputJsonValue,
        isActive: true,
      },
      include: {
        unidadeEducacao: {
          select: { id: true, nome: true, tipo: true },
        },
        zones: true,
      },
    });

    return this.serializeDevice(device);
  }

  public async updateDevice(id: string, input: Partial<CreateDeviceInput>) {
    const data: Prisma.FaceDeviceUpdateInput = {
      ...(input.code ? { code: input.code.trim() } : {}),
      ...(input.name ? { name: input.name.trim() } : {}),
      ...(input.unidadeEducacaoId !== undefined ? { unidadeEducacaoId: input.unidadeEducacaoId || null } : {}),
      ...(input.type ? { type: input.type } : {}),
      ...(input.protocol !== undefined ? { protocol: input.protocol || null } : {}),
      ...(input.manufacturer !== undefined ? { manufacturer: input.manufacturer || null } : {}),
      ...(input.model !== undefined ? { model: input.model || null } : {}),
      ...(input.locationDescription !== undefined
        ? { locationDescription: input.locationDescription || null }
        : {}),
      ...(input.streamUrl !== undefined ? { streamUrlEncrypted: encryptSecret(input.streamUrl) } : {}),
      ...(input.username !== undefined ? { usernameEncrypted: encryptSecret(input.username) } : {}),
      ...(input.password !== undefined ? { passwordEncrypted: encryptSecret(input.password) } : {}),
      ...(input.metadata !== undefined ? { metadata: input.metadata as Prisma.InputJsonValue } : {}),
    };

    const device = await prisma.faceDevice.update({
      where: { id },
      data,
      include: {
        unidadeEducacao: {
          select: { id: true, nome: true, tipo: true },
        },
        zones: true,
      },
    });

    return this.serializeDevice(device);
  }

  public async listZones() {
    const zones = await prisma.faceZone.findMany({
      include: {
        device: true,
        unidadeEducacao: {
          select: { id: true, nome: true, tipo: true },
        },
      },
      orderBy: [{ unidadeEducacao: { nome: 'asc' } }, { name: 'asc' }],
    });

    return zones.map((zone) => ({
      ...zone,
      device: this.serializeDevice(zone.device),
    }));
  }

  public async createZone(input: CreateZoneInput) {
    const zone = await prisma.faceZone.create({
      data: {
        deviceId: input.deviceId,
        unidadeEducacaoId: input.unidadeEducacaoId || null,
        name: input.name.trim(),
        gateName: input.gateName || null,
        direction: input.direction || 'BOTH',
        dedupeWindowSecs: input.dedupeWindowSecs || 180,
        metadata: (input.metadata || {}) as Prisma.InputJsonValue,
      },
      include: {
        device: true,
        unidadeEducacao: {
          select: { id: true, nome: true, tipo: true },
        },
      },
    });

    return {
      ...zone,
      device: this.serializeDevice(zone.device),
    };
  }

  public async listConfigurations() {
    return prisma.schoolSecurityConfiguration.findMany({
      include: {
        unidadeEducacao: {
          select: { id: true, nome: true, tipo: true },
        },
      },
      orderBy: {
        unidadeEducacao: { nome: 'asc' },
      },
    });
  }

  public async upsertSchoolConfiguration(input: UpsertSchoolConfigurationInput) {
    return prisma.schoolSecurityConfiguration.upsert({
      where: { unidadeEducacaoId: input.unidadeEducacaoId },
      update: {
        notifyOnEntry: input.notifyOnEntry ?? true,
        notifyOnExit: input.notifyOnExit ?? true,
        preferredChannel: input.preferredChannel || 'whatsapp',
        dedupeWindowSecs: input.dedupeWindowSecs || 180,
        entryMessageTemplate: input.entryMessageTemplate || null,
        exitMessageTemplate: input.exitMessageTemplate || null,
        activeHoursStart: input.activeHoursStart || null,
        activeHoursEnd: input.activeHoursEnd || null,
        isActive: input.isActive ?? true,
        metadata: (input.metadata || {}) as Prisma.InputJsonValue,
      },
      create: {
        unidadeEducacaoId: input.unidadeEducacaoId,
        notifyOnEntry: input.notifyOnEntry ?? true,
        notifyOnExit: input.notifyOnExit ?? true,
        preferredChannel: input.preferredChannel || 'whatsapp',
        dedupeWindowSecs: input.dedupeWindowSecs || 180,
        entryMessageTemplate: input.entryMessageTemplate || null,
        exitMessageTemplate: input.exitMessageTemplate || null,
        activeHoursStart: input.activeHoursStart || null,
        activeHoursEnd: input.activeHoursEnd || null,
        isActive: input.isActive ?? true,
        metadata: (input.metadata || {}) as Prisma.InputJsonValue,
      },
      include: {
        unidadeEducacao: {
          select: { id: true, nome: true, tipo: true },
        },
      },
    });
  }

  public async listIdentities() {
    const identities = await prisma.faceRecognitionIdentity.findMany({
      include: {
        person: true,
        citizen: {
          select: { id: true, name: true, cpf: true, phone: true, personId: true },
        },
        enrollments: {
          orderBy: { createdAt: 'desc' },
          take: 3,
        },
        embeddings: {
          where: { isActive: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return identities.map((identity) => ({
      id: identity.id,
      status: identity.status,
      label: identity.label,
      person: identity.person,
      citizen: identity.citizen,
      embeddings: identity.embeddings.map((embedding) => ({
        id: embedding.id,
        modelName: embedding.modelName,
        modelVersion: embedding.modelVersion,
        vector: embedding.vector,
        qualityScore: embedding.qualityScore,
        isActive: embedding.isActive,
        createdAt: embedding.createdAt,
      })),
      totalEmbeddings: this.countRegisteredTemplates(identity),
      latestEnrollment: identity.enrollments[0] || null,
      enrollments: identity.enrollments,
    }));
  }

  public async createEnrollment(input: CreateEnrollmentInput, context?: FaceRequestContext) {
    const identity = await this.ensureIdentityForCitizen(input.citizenId);
    let imagePath: string | null = null;
    let vector: number[] | null = input.embedding?.length ? normalizeEmbedding(input.embedding) : null;

    await this.assertIdentityCanEnroll(identity.id);

    if (input.imageBase64) {
      imagePath = await faceStorageService.persistBase64Image(
        'enrollments',
        input.imageBase64,
        context?.tenantId,
      );
    }

    if (!vector?.length) {
      throw createFacePlatformError('O cadastro facial exige embedding válido do face-api.js.', 400);
    }

    const recognitionProviderMetadata = {
      provider: input.modelName || 'face-api.js',
      modelName: input.modelName || 'face-api.js',
      modelVersion: input.modelVersion || null,
      vectorLength: vector.length,
      source: 'face-api.js',
    };

    const livenessAssessment = await faceLivenessService.assess({
      imageBase64: input.imageBase64,
      hintedScore: input.livenessScore ?? null,
      metadata: input.metadata,
    });

    const autoApproved = this.shouldAutoApproveEnrollment({
      approvedById: input.approvedById,
      qualityScore: input.qualityScore,
      livenessScore: livenessAssessment.score,
      hasBiometricTemplate: Boolean(vector?.length || recognitionProviderMetadata),
    });
    const status =
      input.approvedById || autoApproved ? FaceEnrollmentStatus.APPROVED : FaceEnrollmentStatus.PENDING;
    const metadata =
      input.metadata && typeof input.metadata === 'object'
        ? { ...(input.metadata as Record<string, unknown>) }
        : {};

    const enrollment = await prisma.faceEnrollment.create({
      data: {
        identityId: identity.id,
        sourceType: input.sourceType || 'MANUAL_ADMIN',
        sourceLabel: input.sourceLabel || null,
        imagePath,
        qualityScore: input.qualityScore ?? null,
        livenessScore: livenessAssessment.score,
        status,
        metadata: {
          ...metadata,
          ...(context
            ? {
                requestTenantId: context.tenantId,
                requestUserId: context.userId || null,
              }
            : {}),
          recognitionProvider: recognitionProviderMetadata,
          livenessProvider: {
            provider: livenessAssessment.provider,
            score: livenessAssessment.score,
            passed: livenessAssessment.passed,
            mode: livenessAssessment.mode,
            details: livenessAssessment.details,
          },
          autoApproved,
          autoApprovalThresholds: {
            quality: getAutoApproveQualityThreshold(),
            liveness: getAutoApproveLivenessThreshold(),
          },
        } as Prisma.InputJsonValue,
        approvedById: input.approvedById || null,
        approvedAt: input.approvedById || autoApproved ? new Date() : null,
      },
    });

    if (vector?.length) {
      await prisma.faceEmbedding.create({
        data: {
          identityId: identity.id,
          enrollmentId: enrollment.id,
          modelName: input.modelName || 'face-api.js',
          modelVersion: input.modelVersion || null,
          vector,
          qualityScore: input.qualityScore ?? null,
          isActive: true,
        },
      });
    }

    await prisma.faceRecognitionIdentity.update({
      where: { id: identity.id },
      data: {
        status: status === FaceEnrollmentStatus.APPROVED
          ? FaceRecognitionIdentityStatus.ACTIVE
          : FaceRecognitionIdentityStatus.REVIEW,
      },
    });

    return prisma.faceRecognitionIdentity.findUnique({
      where: { id: identity.id },
      include: {
        person: true,
        citizen: {
          select: { id: true, name: true, cpf: true, phone: true },
        },
        enrollments: {
          orderBy: { createdAt: 'desc' },
        },
        embeddings: {
          where: { isActive: true },
        },
      },
    });
  }

  public async readBiometry(input: ReadBiometryInput) {
    const vector = input.embedding?.length ? normalizeEmbedding(input.embedding) : null;

    if (!vector?.length) {
      throw createFacePlatformError('A leitura biométrica ao vivo exige embedding válido do face-api.js.', 400);
    }

    const bestMatch = await this.findBestFaceApiVectorMatch(vector);

    const livenessAssessment = await faceLivenessService.assess({
      imageBase64: input.imageBase64,
      hintedScore: input.livenessScore ?? null,
      metadata: input.metadata,
    });
    const matchedIdentity = bestMatch.identity;
    const expectedCitizenId = input.expectedCitizenId || null;
    const hasExpectedCitizen = Boolean(expectedCitizenId);
    const belongsToExpectedCitizen =
      hasExpectedCitizen && matchedIdentity ? matchedIdentity.citizenId === expectedCitizenId : null;
    const mismatchedExpectedCitizen = hasExpectedCitizen && matchedIdentity && belongsToExpectedCitizen === false;
    const failedLiveness = livenessAssessment.passed === false;
    const gatedMatchStatus = mismatchedExpectedCitizen
      ? FaceMatchStatus.UNMATCHED
      : failedLiveness
        ? matchedIdentity
          ? FaceMatchStatus.REVIEW_REQUIRED
          : FaceMatchStatus.UNMATCHED
        : bestMatch.matchStatus;
    const reviewReason = mismatchedExpectedCitizen
      ? 'A biometria lida não pertence ao cidadão em atendimento.'
      : failedLiveness
        ? 'Prova de vida abaixo do limiar mínimo'
        : bestMatch.reviewReason;
    const exposedIdentity = mismatchedExpectedCitizen ? null : matchedIdentity;

    return {
      recognized: Boolean(exposedIdentity) && gatedMatchStatus === FaceMatchStatus.MATCHED,
      matchStatus: gatedMatchStatus,
      confidence: bestMatch.score,
      reviewReason,
      belongsToExpectedCitizen,
      expectedCitizenId,
      qualityScore: input.qualityScore ?? null,
      livenessScore: livenessAssessment.score,
      sourceType: input.sourceType || 'LIVE_READ',
      sourceLabel: input.sourceLabel || null,
      provider: input.modelName || 'face-api.js',
      modelName: input.modelName || 'face-api.js',
      modelVersion: input.modelVersion || null,
      liveness: {
        provider: livenessAssessment.provider,
        score: livenessAssessment.score,
        passed: livenessAssessment.passed,
        mode: livenessAssessment.mode,
      },
      identity: exposedIdentity
        ? {
            id: exposedIdentity.id,
            status: exposedIdentity.status,
            citizenId: exposedIdentity.citizenId || null,
            citizen: exposedIdentity.citizen
              ? {
                  id: exposedIdentity.citizen.id,
                  name: exposedIdentity.citizen.name,
                  cpf: exposedIdentity.citizen.cpf,
                }
              : null,
            person: exposedIdentity.person
              ? {
                  id: exposedIdentity.person.id,
                  name: exposedIdentity.person.name,
                  cpf: exposedIdentity.person.cpf,
                }
              : null,
          }
        : null,
      readAt: new Date().toISOString(),
    };
  }

  public async deleteCitizenBiometry(
    input: DeleteCitizenBiometryInput,
    _context?: FaceRequestContext,
  ) {
    const identity = await prisma.faceRecognitionIdentity.findFirst({
      where: { citizenId: input.citizenId },
      include: {
        citizen: {
          select: { id: true, name: true, cpf: true },
        },
        enrollments: {
          orderBy: { createdAt: 'desc' },
        },
        embeddings: true,
      },
    });

    if (!identity) {
      throw createFacePlatformError('Nenhuma identidade facial foi encontrada para este cidadão.', 404);
    }

    const enrollmentCount = identity.enrollments.length;
    const embeddingCount = identity.embeddings.length;
    const imagePaths = unique(
      identity.enrollments
        .map((enrollment) => enrollment.imagePath)
        .filter((imagePath): imagePath is string => Boolean(imagePath))
    );

    if (enrollmentCount === 0 && embeddingCount === 0) {
      throw createFacePlatformError('Este cidadão não possui biometria facial cadastrada para exclusão.', 404);
    }

    const resetReason =
      input.reason?.trim() || 'Biometria facial excluída administrativamente para permitir novo cadastro.';

    await prisma.$transaction(async (tx) => {
      await tx.faceEmbedding.deleteMany({
        where: { identityId: identity.id },
      });

      await tx.faceEnrollment.deleteMany({
        where: { identityId: identity.id },
      });

      await tx.faceRecognitionIdentity.update({
        where: { id: identity.id },
        data: {
          status: FaceRecognitionIdentityStatus.PENDING,
          notes: resetReason,
        },
      });
    });

    await Promise.allSettled(imagePaths.map((imagePath) => faceStorageService.deleteRelativePath(imagePath)));

    return {
      identityId: identity.id,
      citizenId: input.citizenId,
      citizen: identity.citizen,
      deletedById: input.deletedById || null,
      deletedEnrollments: enrollmentCount,
      deletedEmbeddings: embeddingCount,
      deletedImages: imagePaths.length,
      resetAt: new Date().toISOString(),
      reason: resetReason,
    };
  }

  public async listEvents(params: {
    unidadeEducacaoId?: string;
    zoneId?: string;
    matchStatus?: FaceMatchStatus;
    limit?: number;
  } = {}) {
    const events = await prisma.faceRecognitionEvent.findMany({
      where: {
        ...(params.unidadeEducacaoId ? { unidadeEducacaoId: params.unidadeEducacaoId } : {}),
        ...(params.zoneId ? { zoneId: params.zoneId } : {}),
        ...(params.matchStatus ? { matchStatus: params.matchStatus } : {}),
      },
      take: params.limit || 100,
      orderBy: { recognizedAt: 'desc' },
      include: {
        device: true,
        zone: true,
        unidadeEducacao: true,
        identity: {
          include: {
            citizen: {
              select: { id: true, name: true, cpf: true },
            },
            person: {
              select: { id: true, name: true, cpf: true },
            },
          },
        },
        studentCitizen: {
          select: { id: true, name: true, cpf: true, phone: true },
        },
        guardianCitizen: {
          select: { id: true, name: true, phone: true, email: true },
        },
        reviewedBy: {
          select: { id: true, name: true },
        },
      },
    });

    return events.map((event) => this.serializeEvent(event));
  }

  public async ingestRecognition(input: IngestRecognitionInput, context?: FaceRequestContext) {
    const [device, zone] = await Promise.all([
      prisma.faceDevice.findUnique({
        where: { id: input.deviceId },
        include: { unidadeEducacao: true },
      }),
      input.zoneId
        ? prisma.faceZone.findUnique({
            where: { id: input.zoneId },
            include: { unidadeEducacao: true },
          })
        : Promise.resolve(null),
    ]);

    if (!device) {
      throw createFacePlatformError('Dispositivo facial não encontrado', 404);
    }

    let previewPath: string | null = null;
    const vector = input.embedding?.length ? normalizeEmbedding(input.embedding) : null;

    const recognizedAt = buildEventTimestamp(input.recognizedAt);
    let identity = null as any;
    let confidence = input.confidence ?? null;
    let matchStatus: FaceMatchStatus = FaceMatchStatus.UNMATCHED;
    let reviewReason: string | null = null;
    let citizenId = input.citizenId || input.studentCitizenId || null;
    let providerUsed = input.provider || null;
    let modelNameUsed = input.modelName || null;

    if (input.imageBase64) {
      previewPath = await faceStorageService.persistBase64Image(
        'events',
        input.imageBase64,
        context?.tenantId,
      );
    }

    if (input.identityId) {
      identity = await prisma.faceRecognitionIdentity.findUnique({
        where: { id: input.identityId },
        include: {
          citizen: true,
          person: true,
        },
      });
      citizenId = citizenId || identity?.citizenId || null;
      matchStatus = identity ? FaceMatchStatus.MATCHED : FaceMatchStatus.UNMATCHED;
    } else if (citizenId) {
      identity = await this.ensureIdentityForCitizen(citizenId);
      matchStatus = FaceMatchStatus.MATCHED;
      confidence = confidence ?? 1;
    } else if (vector?.length) {
      const bestMatch = await this.findBestFaceApiVectorMatch(vector);
      identity = bestMatch.identity;
      confidence = confidence ?? bestMatch.score;
      matchStatus = bestMatch.matchStatus;
      reviewReason = bestMatch.reviewReason;
      citizenId = bestMatch.identity?.citizenId || null;
      providerUsed = providerUsed || input.modelName || 'face-api.js';
      modelNameUsed = modelNameUsed || input.modelName || 'face-api.js';
    } else if (input.imageBase64) {
      throw createFacePlatformError('A ingestão de evento facial exige embedding válido do face-api.js.', 400);
    }

    const schoolContext = await this.resolveSchoolContext(
      citizenId,
      input.unidadeEducacaoId || zone?.unidadeEducacaoId || device.unidadeEducacaoId || null
    );
    const eventType = this.resolveEventType(input.eventType, zone?.direction || null, matchStatus);
    const dedupeWindowSecs =
      zone?.dedupeWindowSecs ||
      schoolContext.configuration?.dedupeWindowSecs ||
      180;
    const dedupeKey =
      citizenId && eventType !== FaceEventType.UNMATCHED
        ? `${citizenId}:${zone?.id || device.id}:${eventType}`
        : null;

    if (dedupeKey) {
      const duplicateSince = new Date(recognizedAt.getTime() - dedupeWindowSecs * 1000);
      const existingEvent = await prisma.faceRecognitionEvent.findFirst({
        where: {
          dedupeKey,
          recognizedAt: { gte: duplicateSince },
        },
        orderBy: { recognizedAt: 'desc' },
        include: {
          device: true,
          zone: true,
          unidadeEducacao: true,
          studentCitizen: {
            select: { id: true, name: true, cpf: true, phone: true },
          },
          guardianCitizen: {
            select: { id: true, name: true, phone: true, email: true },
          },
        },
      });

      if (existingEvent) {
        return {
          duplicate: true,
          event: this.serializeEvent(existingEvent),
        };
      }
    }

    const notificationStatus =
      schoolContext.guardianCitizenId && matchStatus === FaceMatchStatus.MATCHED &&
      (eventType === FaceEventType.ENTRY || eventType === FaceEventType.EXIT)
        ? GuardianNotificationStatus.PENDING
        : GuardianNotificationStatus.NOT_REQUIRED;

    const createdEvent = await prisma.faceRecognitionEvent.create({
      data: {
        identityId: identity?.id || null,
        deviceId: device.id,
        zoneId: zone?.id || null,
        unidadeEducacaoId: schoolContext.unidadeEducacaoId,
        studentCitizenId: citizenId,
        guardianCitizenId: schoolContext.guardianCitizenId,
        type: eventType,
        matchStatus,
        confidence,
        provider: providerUsed || input.modelName || 'face-api.js',
        modelName: modelNameUsed || null,
        modelVersion: input.modelVersion || null,
        previewPath,
        boundingBox: (input.boundingBox || null) as Prisma.InputJsonValue | undefined,
        metadata: {
          ...(input.metadata && typeof input.metadata === 'object' ? input.metadata : {}),
          ...(context
            ? {
                requestTenantId: context.tenantId,
                requestUserId: context.userId || null,
              }
            : {}),
          storagePreviewPath: previewPath,
          recognitionProvider: providerUsed || input.modelName || 'face-api.js',
          recognitionModelName: modelNameUsed || null,
          recognitionModelVersion: input.modelVersion || null,
        } as Prisma.InputJsonValue,
        dedupeKey,
        reviewReason,
        notificationStatus,
        recognizedAt,
      },
      include: {
        device: true,
        zone: true,
        unidadeEducacao: true,
        identity: {
          include: {
            citizen: {
              select: { id: true, name: true, cpf: true },
            },
            person: {
              select: { id: true, name: true, cpf: true },
            },
          },
        },
        studentCitizen: {
          select: { id: true, name: true, cpf: true, phone: true },
        },
        guardianCitizen: {
          select: { id: true, name: true, phone: true, email: true },
        },
      },
    });

    if (createdEvent.notificationStatus === GuardianNotificationStatus.PENDING) {
      await this.notifyGuardianForEvent(createdEvent.id);
    }

    return {
      duplicate: false,
      event: this.serializeEvent(createdEvent),
    };
  }

  public async reviewEvent(
    eventId: string,
    reviewedById: string,
    decision: 'approve' | 'reject',
    context?: FaceRequestContext,
  ) {
    const event = await prisma.faceRecognitionEvent.findUnique({
      where: { id: eventId },
      include: {
        device: true,
        zone: true,
        unidadeEducacao: true,
        studentCitizen: true,
        guardianCitizen: true,
      },
    });

    if (!event) {
      throw createFacePlatformError('Evento não encontrado', 404);
    }

    const nextMatchStatus =
      decision === 'approve' ? FaceMatchStatus.MATCHED : FaceMatchStatus.UNMATCHED;
    const nextType =
      decision === 'approve' && event.type === FaceEventType.REVIEW
        ? FaceEventType.DETECTION
        : event.type;

    const updated = await prisma.faceRecognitionEvent.update({
      where: { id: eventId },
      data: {
        matchStatus: nextMatchStatus,
        type: nextType,
        reviewedById,
        reviewedAt: new Date(),
        metadata: {
          ...((event.metadata as Record<string, unknown> | null) || {}),
          ...(context
            ? {
                requestTenantId: context.tenantId,
                requestUserId: context.userId || null,
              }
            : {}),
        } as Prisma.InputJsonValue,
        reviewReason: decision === 'approve' ? null : 'Revisão manual rejeitou a identificação',
        notificationStatus:
          decision === 'approve' && event.guardianCitizenId
            ? GuardianNotificationStatus.PENDING
            : GuardianNotificationStatus.NOT_REQUIRED,
      },
      include: {
        device: true,
        zone: true,
        unidadeEducacao: true,
        studentCitizen: {
          select: { id: true, name: true, cpf: true, phone: true },
        },
        guardianCitizen: {
          select: { id: true, name: true, phone: true, email: true },
        },
        reviewedBy: {
          select: { id: true, name: true },
        },
      },
    });

    if (updated.notificationStatus === GuardianNotificationStatus.PENDING) {
      await this.notifyGuardianForEvent(updated.id);
    }

    return this.serializeEvent(updated);
  }

  private async findBestFaceApiVectorMatch(vector: number[]) {
    const embeddings = await prisma.faceEmbedding.findMany({
      where: {
        isActive: true,
      },
      include: {
        identity: {
          include: {
            citizen: {
              select: { id: true, name: true, cpf: true },
            },
            person: {
              select: { id: true, name: true, cpf: true },
            },
          },
        },
      },
    });

    let bestMatch: {
      identity: any | null;
      score: number;
      provider: string;
      modelName: string;
      matchStatus: FaceMatchStatus;
      reviewReason: string | null;
    } = {
      identity: null,
      score: 0,
      provider: 'face-api.js',
      modelName: 'face-api.js',
      matchStatus: FaceMatchStatus.UNMATCHED,
      reviewReason: null,
    };

    for (const embedding of embeddings) {
      if (!embedding.vector?.length) {
        continue;
      }

      const score = cosineSimilarity(vector, embedding.vector);

      if (score > bestMatch.score) {
        const decision = this.buildMatchDecision(score);

        bestMatch = {
          identity: embedding.identity,
          score,
          provider: 'face-api.js',
          modelName: embedding.modelName || 'face-api.js',
          matchStatus: decision.matchStatus,
          reviewReason: decision.reviewReason,
        };
      }
    }

    return bestMatch;
  }

  private async assertIdentityCanEnroll(identityId: string) {
    const existingIdentity = await prisma.faceRecognitionIdentity.findUnique({
      where: { id: identityId },
      include: {
        enrollments: {
          orderBy: { createdAt: 'desc' },
        },
        embeddings: {
          where: { isActive: true },
        },
      },
    });

    if (!existingIdentity) {
      throw createFacePlatformError('Identidade facial não encontrada.', 404);
    }

    if (existingIdentity.embeddings.length > 0) {
      throw createFacePlatformError('Este cidadão já possui biometria facial cadastrada e ativa.', 409);
    }

    const latestEnrollment = existingIdentity.enrollments[0];
    if (!latestEnrollment) {
      return;
    }

    if (latestEnrollment.status === FaceEnrollmentStatus.PENDING) {
      throw createFacePlatformError(
        'Este cidadão já possui biometria facial em análise e não pode cadastrar novamente.',
        409
      );
    }

    if (latestEnrollment.status === FaceEnrollmentStatus.APPROVED) {
      throw createFacePlatformError('Este cidadão já possui biometria facial cadastrada e ativa.', 409);
    }

    throw createFacePlatformError(
      'Este cidadão já possui um cadastro biométrico registrado e não pode cadastrar novamente.',
      409
    );
  }

  private buildMatchDecision(score: number) {
    if (score >= getAutoMatchThreshold()) {
      return {
        matchStatus: FaceMatchStatus.MATCHED,
        reviewReason: null,
      };
    }

    if (score >= getReviewMatchThreshold()) {
      return {
        matchStatus: FaceMatchStatus.REVIEW_REQUIRED,
        reviewReason: 'Confiança intermediária exige revisão manual',
      };
    }

    return {
      matchStatus: FaceMatchStatus.UNMATCHED,
      reviewReason: 'Nenhum resultado acima do limiar mínimo',
    };
  }

  private async loadIdentityForMatching(identityId: string) {
    return prisma.faceRecognitionIdentity.findUnique({
      where: { id: identityId },
      include: {
        citizen: {
          select: { id: true, name: true, cpf: true },
        },
        person: {
          select: { id: true, name: true, cpf: true },
        },
      },
    });
  }

  private shouldAutoApproveEnrollment(input: {
    approvedById?: string | null;
    qualityScore?: number | null;
    livenessScore?: number | null;
    hasBiometricTemplate: boolean;
  }) {
    if (input.approvedById) {
      return true;
    }

    if (!input.hasBiometricTemplate) {
      return false;
    }

    const qualityScore = input.qualityScore ?? 0;
    const livenessScore = input.livenessScore ?? 0;

    return (
      qualityScore >= getAutoApproveQualityThreshold() &&
      livenessScore >= getAutoApproveLivenessThreshold()
    );
  }

  private resolveEventType(
    explicitType: IngestRecognitionInput['eventType'],
    zoneDirection: 'ENTRY' | 'EXIT' | 'BOTH' | null,
    matchStatus: FaceMatchStatus
  ) {
    if (explicitType) {
      return explicitType as FaceEventType;
    }

    if (matchStatus === FaceMatchStatus.REVIEW_REQUIRED) {
      return FaceEventType.REVIEW;
    }

    if (matchStatus === FaceMatchStatus.UNMATCHED) {
      return FaceEventType.UNMATCHED;
    }

    if (zoneDirection === 'ENTRY') {
      return FaceEventType.ENTRY;
    }

    if (zoneDirection === 'EXIT') {
      return FaceEventType.EXIT;
    }

    return FaceEventType.DETECTION;
  }

  private async resolveSchoolContext(citizenId: string | null, unidadeEducacaoId: string | null) {
    const matricula = citizenId
      ? await prisma.matricula.findFirst({
          where: {
            alunoId: citizenId,
            situacao: SituacaoMatricula.ATIVA,
            ...(unidadeEducacaoId ? { unidadeEducacaoId } : {}),
          },
          orderBy: { updatedAt: 'desc' },
        })
      : null;

    const finalSchoolId = unidadeEducacaoId || matricula?.unidadeEducacaoId || null;

    const configuration = finalSchoolId
      ? await prisma.schoolSecurityConfiguration.findUnique({
          where: { unidadeEducacaoId: finalSchoolId },
        })
      : null;

    return {
      unidadeEducacaoId: finalSchoolId,
      guardianCitizenId: matricula?.responsavelId || null,
      configuration,
    };
  }

  private async notifyGuardianForEvent(eventId: string) {
    const event = await prisma.faceRecognitionEvent.findUnique({
      where: { id: eventId },
      include: {
        zone: true,
        device: true,
        unidadeEducacao: true,
        studentCitizen: true,
        guardianCitizen: true,
      },
    });

    if (!event || !event.guardianCitizenId || !event.guardianCitizen || !event.studentCitizen) {
      if (event) {
        await prisma.faceRecognitionEvent.update({
          where: { id: event.id },
          data: { notificationStatus: GuardianNotificationStatus.NOT_REQUIRED },
        });
      }
      return;
    }

    if (event.type !== FaceEventType.ENTRY && event.type !== FaceEventType.EXIT) {
      await prisma.faceRecognitionEvent.update({
        where: { id: event.id },
        data: { notificationStatus: GuardianNotificationStatus.NOT_REQUIRED },
      });
      return;
    }

    const configuration = event.unidadeEducacaoId
      ? await prisma.schoolSecurityConfiguration.findUnique({
          where: { unidadeEducacaoId: event.unidadeEducacaoId },
        })
      : null;

    if (configuration?.isActive === false) {
      await prisma.faceRecognitionEvent.update({
        where: { id: event.id },
        data: { notificationStatus: GuardianNotificationStatus.NOT_REQUIRED },
      });
      return;
    }

    if (event.type === FaceEventType.ENTRY && configuration && !configuration.notifyOnEntry) {
      await prisma.faceRecognitionEvent.update({
        where: { id: event.id },
        data: { notificationStatus: GuardianNotificationStatus.NOT_REQUIRED },
      });
      return;
    }

    if (event.type === FaceEventType.EXIT && configuration && !configuration.notifyOnExit) {
      await prisma.faceRecognitionEvent.update({
        where: { id: event.id },
        data: { notificationStatus: GuardianNotificationStatus.NOT_REQUIRED },
      });
      return;
    }

    const variables = {
      aluno: event.studentCitizen.name,
      escola: event.unidadeEducacao?.nome || 'Unidade escolar',
      local: event.zone?.gateName || event.zone?.name || event.device.name,
      horario: formatDateTime(event.recognizedAt),
    };

    const title =
      event.type === FaceEventType.ENTRY
        ? 'Aluno identificado na entrada'
        : 'Aluno identificado na saída';

    const fallbackMessage =
      event.type === FaceEventType.ENTRY
        ? `${variables.aluno} entrou em ${variables.escola} às ${variables.horario}. Local: ${variables.local}.`
        : `${variables.aluno} saiu de ${variables.escola} às ${variables.horario}. Local: ${variables.local}.`;

    const template =
      event.type === FaceEventType.ENTRY
        ? configuration?.entryMessageTemplate
        : configuration?.exitMessageTemplate;

    const message = renderTemplate(template, variables) || fallbackMessage;
    const preferredChannel = (configuration?.preferredChannel || 'whatsapp') as
      | 'web'
      | 'push'
      | 'email'
      | 'sms'
      | 'whatsapp';
    const channels = Array.from(
      new Set<typeof preferredChannel>([preferredChannel, 'web'])
    ).filter((channel) => ['web', 'push', 'email', 'sms', 'whatsapp'].includes(channel));

    try {
      await digiUrbanIntegration.dispatchNotification({
        recipientType: 'citizen',
        recipientId: event.guardianCitizenId,
        type: event.type === FaceEventType.ENTRY ? 'STUDENT_ENTRY' : 'STUDENT_EXIT',
        title,
        message,
        channels,
        priority: 'high',
        data: {
          eventId: event.id,
          citizenId: event.studentCitizenId,
          studentCitizenId: event.studentCitizenId,
          guardianCitizenId: event.guardianCitizenId,
          schoolId: event.unidadeEducacaoId,
          schoolName: event.unidadeEducacao?.nome || null,
          zoneId: event.zoneId,
          zoneName: event.zone?.name || null,
          eventType: event.type,
          recognizedAt: event.recognizedAt.toISOString(),
        },
      }, extractTenantIdFromMetadata(event.metadata));

      await prisma.faceRecognitionEvent.update({
        where: { id: event.id },
        data: {
          notificationStatus: GuardianNotificationStatus.SENT,
          notificationAttempts: { increment: 1 },
          lastNotificationError: null,
        },
      });
    } catch (error: any) {
      await prisma.faceRecognitionEvent.update({
        where: { id: event.id },
        data: {
          notificationStatus: GuardianNotificationStatus.FAILED,
          notificationAttempts: { increment: 1 },
          lastNotificationError: error.message || 'Falha ao enfileirar notificação',
        },
      });
      throw error;
    }
  }

  private async ensureIdentityForCitizen(citizenId: string) {
    const citizen = await prisma.citizen.findUnique({
      where: { id: citizenId },
      select: {
        id: true,
        cpf: true,
        name: true,
        email: true,
        phone: true,
        rg: true,
        birthDate: true,
        isActive: true,
        personId: true,
      },
    });

    if (!citizen) {
      throw createFacePlatformError('Cidadão não encontrado', 404);
    }

    let personId = citizen.personId;

    if (!personId) {
      const result = await syncCitizenPersonIdentity(prisma, {
        citizenId: citizen.id,
        currentPersonId: citizen.personId,
        cpf: citizen.cpf,
        name: citizen.name,
        email: citizen.email,
        phone: citizen.phone,
        rg: citizen.rg,
        birthDate: citizen.birthDate,
        isActive: citizen.isActive,
      });
      personId = result.personId;
    }

    const existing = await prisma.faceRecognitionIdentity.findFirst({
      where: {
        OR: [{ citizenId: citizen.id }, { personId }],
      },
      include: {
        citizen: true,
        person: true,
      },
    });

    if (existing) {
      if (!existing.citizenId) {
        return prisma.faceRecognitionIdentity.update({
          where: { id: existing.id },
          data: {
            citizenId: citizen.id,
          },
          include: {
            citizen: true,
            person: true,
          },
        });
      }

      return existing;
    }

    return prisma.faceRecognitionIdentity.create({
      data: {
        personId,
        citizenId: citizen.id,
        label: citizen.name,
        status: FaceRecognitionIdentityStatus.PENDING,
      },
      include: {
        citizen: true,
        person: true,
      },
    });
  }

  private countRegisteredTemplates(identity: {
    embeddings?: Array<{ isActive?: boolean; vector?: number[] | null }>;
    enrollments?: Array<{ status?: FaceEnrollmentStatus; metadata?: Prisma.JsonValue | null }>;
  }) {
    return (
      identity.embeddings?.filter((embedding) => embedding.isActive && Boolean(embedding.vector?.length)).length || 0
    );
  }

  private serializeDevice(device: any) {
    return {
      id: device.id,
      code: device.code,
      name: device.name,
      unidadeEducacaoId: device.unidadeEducacaoId,
      unidadeEducacao: device.unidadeEducacao || null,
      type: device.type,
      protocol: device.protocol,
      manufacturer: device.manufacturer,
      model: device.model,
      locationDescription: device.locationDescription,
      healthStatus: device.healthStatus,
      lastHeartbeatAt: device.lastHeartbeatAt,
      isActive: device.isActive,
      metadata: device.metadata || {},
      hasStreamConfigured: Boolean(device.streamUrlEncrypted),
      hasCredentialsConfigured: Boolean(device.usernameEncrypted || device.passwordEncrypted),
      zones:
        device.zones?.map((zone: any) => ({
          id: zone.id,
          name: zone.name,
          direction: zone.direction,
          gateName: zone.gateName,
          dedupeWindowSecs: zone.dedupeWindowSecs,
          isActive: zone.isActive,
        })) || [],
      createdAt: device.createdAt,
      updatedAt: device.updatedAt,
    };
  }

  private serializeEvent(event: any) {
    return {
      ...event,
      citizenId: event.studentCitizenId,
      citizen: event.studentCitizen || event.identity?.citizen || null,
      previewUrl: faceStorageService.buildPublicPath(event.previewPath),
    };
  }
}

export default new FacePlatformService();
