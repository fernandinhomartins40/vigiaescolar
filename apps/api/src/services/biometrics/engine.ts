import {
  FaceEnrollmentSource,
  FaceMatchStatus,
  FaceRecognitionType,
  Prisma,
  StudentStatus,
} from "@prisma/client";
import { badRequest, notFound } from "../../lib/http";
import { prisma } from "../../lib/prisma";
import { endOfLocalDay, localDateKey, startOfLocalDay } from "../../lib/security";
import { biometricDescriptor, cosineSimilarity, normalizeVector } from "./descriptor";
import { biometricStorage, type BiometricUploadFile } from "./storage";

type DbClient = Prisma.TransactionClient | typeof prisma;

type IdentityWithSamples = Prisma.FaceIdentityGetPayload<{
  include: {
    student: true;
    school: true;
    enrollments: {
      orderBy: {
        createdAt: "desc";
      };
      take: 1;
    };
    embeddings: {
      where: {
        isActive: true;
      };
    };
  };
}>;

type MatchThresholds = {
  matchThreshold: number;
  reviewThreshold: number;
};

export type BiometricEnrollInput = {
  tenantId: string;
  studentId: string;
  schoolId: string;
  studentName: string;
  files: BiometricUploadFile[];
  approvedByUserId?: string | null;
  sourceLabel?: string | null;
  sourceType?: FaceEnrollmentSource;
  modelName?: string;
  modelVersion?: string | null;
  metadata?: Record<string, unknown>;
};

export type BiometricRecognizeInput = {
  tenantId: string;
  schoolId: string;
  imageBase64: string;
  expectedStudentId?: string | null;
  cameraId?: string | null;
  direction?: FaceRecognitionType;
  recognizedAt?: Date | string;
};

export type BiometricRecognitionReference = {
  id: string;
  tenantId: string;
  studentId: string;
  schoolId: string;
  label: string;
  isActive: boolean;
  student: {
    id: string;
    nome: string;
    escolaId: string;
    foto: string;
    ativo: boolean;
    biometriaAtiva: boolean;
  } | null;
  school: {
    id: string;
    nome: string;
  } | null;
  embeddings: Array<{
    id: string;
    modelName: string;
    modelVersion: string | null;
    vector: number[];
    qualityScore: number | null;
    isActive: boolean;
    createdAt: string;
  }>;
  totalEmbeddings: number;
  createdAt: string;
  updatedAt: string;
};

function createBiometricError(message: string, status = 500) {
  const error = new Error(message);
  (error as Error & { statusCode?: number }).statusCode = status;
  return error;
}

function asDbClient(db?: DbClient) {
  return db ?? prisma;
}

function normalizeMatchThreshold(value: number | null | undefined) {
  if (!Number.isFinite(value ?? NaN)) {
    return 0.85;
  }

  const threshold = Number(value);
  return threshold > 1 ? threshold / 100 : threshold;
}

function buildThresholds(confidenceThreshold: number | null | undefined): MatchThresholds {
  const matchThreshold = normalizeMatchThreshold(confidenceThreshold);
  const reviewThreshold = Math.max(0.5, Number((matchThreshold - 0.08).toFixed(2)));

  return {
    matchThreshold,
    reviewThreshold,
  };
}

function buildVector(vector: unknown) {
  if (!Array.isArray(vector)) {
    return [];
  }

  return normalizeVector(vector.map((value) => Number(value) || 0));
}

function extractEmbeddingFromMetadata(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return [];
  }

  const embedding = (metadata as Record<string, unknown>).embedding;
  if (!Array.isArray(embedding)) {
    return [];
  }

  return normalizeVector(embedding.map((value) => Number(value) || 0));
}

export class BiometricEngineService {
  async getStatus(tenantId: string) {
    const db = asDbClient();
    try {
      const [identities, enrollments, embeddings, eventsToday, matchedToday] = await Promise.all([
        db.faceIdentity.count({ where: { tenantId } }),
        db.faceEnrollment.count({ where: { tenantId } }),
        db.faceEmbedding.count({ where: { tenantId, isActive: true } }),
        db.faceRecognitionEvent.count({
          where: {
            tenantId,
            recognizedAt: { gte: startOfLocalDay() },
          },
        }),
        db.faceRecognitionEvent.count({
          where: {
            tenantId,
            recognizedAt: { gte: startOfLocalDay() },
            matchStatus: FaceMatchStatus.MATCHED,
          },
        }),
      ]);

      return {
        available: true,
        schemaReady: true,
        service: "vigiaescolar-biometric-engine",
        message: "Motor facial disponível.",
        totals: {
          identities,
          enrollments,
          embeddings,
          eventsToday,
          matchedToday,
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const message = String((error as Error)?.message || "");
      const missingSchema =
        (error as { code?: string }).code === "P2021" ||
        /relation .* does not exist/i.test(message) ||
        /table .* does not exist/i.test(message);

      return {
        available: false,
        schemaReady: false,
        service: "vigiaescolar-biometric-engine",
        message: missingSchema
          ? "As tabelas biométricas ainda não foram aplicadas no banco."
          : "O motor facial está ativo, mas o schema não está pronto.",
        error: message || null,
        timestamp: new Date().toISOString(),
      };
    }
  }

  async collectStudentBiometryAssets(tenantId: string, studentId: string, db?: DbClient) {
    const client = asDbClient(db);
    const identity = await client.faceIdentity.findFirst({
      where: {
        tenantId,
        studentId,
      },
      include: {
        enrollments: {
          select: {
            imagePath: true,
          },
        },
      },
    });

    return {
      hasData: Boolean(identity),
      imagePaths: identity?.enrollments.map((enrollment) => enrollment.imagePath).filter(Boolean) ?? [],
    };
  }

  async setStudentBiometricStatus(input: {
    tenantId: string;
    studentId: string;
    schoolId: string;
    studentName: string;
    isActive: boolean;
  }, db?: DbClient) {
    const client = asDbClient(db);
    const identity = await client.faceIdentity.findFirst({
      where: {
        tenantId: input.tenantId,
        studentId: input.studentId,
      },
    });

    if (!identity) {
      return null;
    }

    return client.faceIdentity.update({
      where: { id: identity.id },
      data: {
        isActive: input.isActive,
        schoolId: input.schoolId,
        label: input.studentName,
      },
    });
  }

  async enrollStudent(input: BiometricEnrollInput, db?: DbClient) {
    const client = asDbClient(db);

    if (!input.files.length) {
      throw badRequest("Envie ao menos uma foto biométrica");
    }

    const student = await client.student.findFirst({
      where: {
        id: input.studentId,
        tenantId: input.tenantId,
      },
    });

    if (!student) {
      throw notFound("Aluno não encontrado");
    }

    if (student.schoolId !== input.schoolId) {
      throw badRequest("O aluno não pertence à escola informada");
    }

    const identity = await client.faceIdentity.upsert({
      where: {
        tenantId_studentId: {
          tenantId: input.tenantId,
          studentId: input.studentId,
        },
      },
      create: {
        tenantId: input.tenantId,
        studentId: input.studentId,
        schoolId: input.schoolId,
        label: input.studentName,
        isActive: true,
      },
      update: {
        schoolId: input.schoolId,
        label: input.studentName,
        isActive: true,
      },
    });

    const savedPaths: string[] = [];

    try {
      for (const file of input.files) {
        const buffer = Buffer.from(await file.arrayBuffer());
        const image = await biometricStorage.persistUploadFile("enrollments", file);
        savedPaths.push(image.absolutePath);

        const legacyVector = await biometricDescriptor.createDescriptorFromBuffer(buffer);
        const metadataVector = extractEmbeddingFromMetadata(input.metadata);
        const vectorsToPersist =
          metadataVector.length > 0
            ? [
                {
                  modelName: input.modelName ?? "face-api.js",
                  modelVersion: input.modelVersion ?? null,
                  vector: metadataVector,
                },
                {
                  modelName: "legacy-grayscale",
                  modelVersion: input.modelVersion ?? null,
                  vector: legacyVector,
                },
              ]
            : [
                {
                  modelName: input.modelName ?? "face-api.js",
                  modelVersion: input.modelVersion ?? null,
                  vector: legacyVector,
                },
              ];

        const enrollment = await client.faceEnrollment.create({
          data: {
            tenantId: input.tenantId,
            identityId: identity.id,
            imagePath: image.relativePath,
            sourceType: input.sourceType ?? FaceEnrollmentSource.ADMIN_UPLOAD,
            sourceLabel: input.sourceLabel ?? null,
            metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
            approvedByUserId: input.approvedByUserId ?? null,
            approvedAt: new Date(),
          },
        });

        for (const vectorEntry of vectorsToPersist) {
          await client.faceEmbedding.create({
            data: {
              tenantId: input.tenantId,
              identityId: identity.id,
              enrollmentId: enrollment.id,
              modelName: vectorEntry.modelName,
              modelVersion: vectorEntry.modelVersion,
              vector: vectorEntry.vector,
              qualityScore: null,
              isActive: true,
            },
          });
        }
      }
    } catch (error) {
      await Promise.allSettled(savedPaths.map((filePath) => biometricStorage.deleteRelativePath(filePath)));
      throw error;
    }

    return client.faceIdentity.findUnique({
      where: { id: identity.id },
      include: {
        student: true,
        school: true,
        enrollments: {
          orderBy: {
            createdAt: "desc",
          },
        },
        embeddings: {
          where: {
            isActive: true,
          },
        },
      },
    });
  }

  async findBestMatch(input: BiometricRecognizeInput, db?: DbClient) {
    const client = asDbClient(db);
    const thresholds = await this.resolveThresholds(input.tenantId, client);
    const vector = buildVector(await biometricDescriptor.createDescriptorFromBase64(input.imageBase64));

    const embeddings = await client.faceEmbedding.findMany({
      where: {
        tenantId: input.tenantId,
        isActive: true,
        identity: {
          isActive: true,
          ...(input.expectedStudentId ? { studentId: input.expectedStudentId } : {}),
          student: {
            tenantId: input.tenantId,
            status: StudentStatus.ACTIVE,
            biometricEnabled: true,
            ...(input.schoolId ? { schoolId: input.schoolId } : {}),
          },
        },
      },
      include: {
        identity: {
          include: {
            student: true,
            school: true,
          },
        },
      },
    });

    const sameLengthEmbeddings = embeddings.filter((embedding) => buildVector(embedding.vector).length === vector.length);
    const searchEmbeddings = sameLengthEmbeddings.length > 0 ? sameLengthEmbeddings : embeddings;

    let bestScore = 0;
    let bestIdentity: IdentityWithSamples | null = null;

    for (const embedding of searchEmbeddings) {
      const candidateVector = buildVector(embedding.vector);
      if (!candidateVector.length) {
        continue;
      }

      const score = cosineSimilarity(vector, candidateVector);
      if (score > bestScore) {
        bestScore = score;
        bestIdentity = embedding.identity as IdentityWithSamples;
      }
    }

    if (input.expectedStudentId && bestIdentity?.studentId !== input.expectedStudentId) {
      return {
        recognized: false,
        matchStatus: FaceMatchStatus.UNMATCHED,
        confidence: bestScore,
        reviewReason: "A biometria detectada não pertence ao aluno esperado.",
        identity: null,
        thresholds,
      };
    }

    if (!bestIdentity) {
      return {
        recognized: false,
        matchStatus: FaceMatchStatus.UNMATCHED,
        confidence: 0,
        reviewReason: "Nenhuma identidade biométrica ativa foi encontrada.",
        identity: null,
        thresholds,
      };
    }

    const isExpectedStudent = Boolean(input.expectedStudentId && bestIdentity.studentId === input.expectedStudentId);
    const matchStatus =
      bestScore >= thresholds.matchThreshold
        ? FaceMatchStatus.MATCHED
        : bestScore >= thresholds.reviewThreshold
          ? isExpectedStudent
            ? FaceMatchStatus.MATCHED
            : FaceMatchStatus.REVIEW_REQUIRED
          : FaceMatchStatus.UNMATCHED;

    return {
      recognized: matchStatus === FaceMatchStatus.MATCHED,
      matchStatus,
      confidence: bestScore,
      reviewReason:
        matchStatus === FaceMatchStatus.MATCHED
          ? null
          : matchStatus === FaceMatchStatus.REVIEW_REQUIRED
            ? "Confiança intermediária exige revisão manual."
            : "Nenhum resultado acima do limiar mínimo.",
      identity: matchStatus === FaceMatchStatus.UNMATCHED ? null : bestIdentity,
      thresholds,
    };
  }

  async listIdentities(tenantId: string, db?: DbClient) {
    const client = asDbClient(db);
    const identities = await client.faceIdentity.findMany({
      where: { tenantId },
      include: {
        student: true,
        school: true,
        enrollments: {
          orderBy: {
            createdAt: "desc",
          },
          take: 1,
        },
        embeddings: {
          where: {
            isActive: true,
          },
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    return identities.map((identity) => ({
      id: identity.id,
      tenantId: identity.tenantId,
      studentId: identity.studentId,
      schoolId: identity.schoolId,
      label: identity.label,
      isActive: identity.isActive,
      student: identity.student,
      school: identity.school,
      totalEnrollments: identity.enrollments.length,
      totalEmbeddings: identity.embeddings.length,
      latestEnrollment: identity.enrollments[0] ?? null,
      updatedAt: identity.updatedAt,
      createdAt: identity.createdAt,
    }));
  }

  async listRecognitionReferences(tenantId: string, db?: DbClient): Promise<BiometricRecognitionReference[]> {
    const client = asDbClient(db);
    const identities = await client.faceIdentity.findMany({
      where: {
        tenantId,
        isActive: true,
        student: {
          biometricEnabled: true,
          status: StudentStatus.ACTIVE,
        },
      },
      include: {
        student: {
          select: {
            id: true,
            name: true,
            schoolId: true,
            photoUrl: true,
            biometricEnabled: true,
            status: true,
          },
        },
        school: {
          select: {
            id: true,
            name: true,
          },
        },
        embeddings: {
          where: {
            isActive: true,
          },
          select: {
            id: true,
            modelName: true,
            modelVersion: true,
            vector: true,
            qualityScore: true,
            isActive: true,
            createdAt: true,
            enrollment: {
              select: {
                metadata: true,
              },
            },
          },
          orderBy: {
            createdAt: "desc",
          },
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    return identities.map((identity) => ({
      id: identity.id,
      tenantId: identity.tenantId,
      studentId: identity.studentId,
      schoolId: identity.schoolId,
      label: identity.label,
      isActive: identity.isActive,
      student: identity.student
        ? {
            id: identity.student.id,
            nome: identity.student.name,
            escolaId: identity.student.schoolId,
            foto: identity.student.photoUrl ?? "",
            ativo: identity.student.status === StudentStatus.ACTIVE,
            biometriaAtiva: identity.student.biometricEnabled,
          }
        : null,
      school: identity.school
        ? {
            id: identity.school.id,
            nome: identity.school.name,
          }
        : null,
      embeddings: identity.embeddings.map((embedding) => {
        const metadataVector = extractEmbeddingFromMetadata(embedding.enrollment?.metadata);
        const fallbackVector = normalizeVector(Array.isArray(embedding.vector) ? embedding.vector.map((value) => Number(value) || 0) : []);

        return {
          id: embedding.id,
          modelName: metadataVector.length > 0 ? "face-api.js" : embedding.modelName,
          modelVersion: embedding.modelVersion,
          vector: metadataVector.length > 0 ? metadataVector : fallbackVector,
          qualityScore: embedding.qualityScore,
          isActive: embedding.isActive,
          createdAt: embedding.createdAt.toISOString(),
        };
      }),
      totalEmbeddings: identity.embeddings.length,
      createdAt: identity.createdAt.toISOString(),
      updatedAt: identity.updatedAt.toISOString(),
    }));
  }

  async listEvents(tenantId: string, filters: {
    schoolId?: string;
    cameraId?: string;
    studentId?: string;
    date?: string;
    matchStatus?: FaceMatchStatus;
  }, db?: DbClient) {
    const client = asDbClient(db);
    const date = filters.date ?? localDateKey();
    const events = await client.faceRecognitionEvent.findMany({
      where: {
        tenantId,
        ...(filters.schoolId ? { schoolId: filters.schoolId } : {}),
        ...(filters.cameraId ? { cameraId: filters.cameraId } : {}),
        ...(filters.studentId ? { studentId: filters.studentId } : {}),
        ...(filters.matchStatus ? { matchStatus: filters.matchStatus } : {}),
        recognizedAt: {
          gte: startOfLocalDay(new Date(`${date}T00:00:00-03:00`)),
          lte: endOfLocalDay(new Date(`${date}T00:00:00-03:00`)),
        },
      },
      include: {
        student: true,
        school: true,
        camera: true,
        identity: {
          include: {
            student: true,
            school: true,
          },
        },
        attendance: true,
      },
      orderBy: {
        recognizedAt: "desc",
      },
    });

    return events;
  }

  private async resolveThresholds(tenantId: string, db: DbClient) {
    const settings = await db.tenantSettings.findUnique({
      where: {
        tenantId,
      },
      select: {
        confidenceThreshold: true,
      },
    });

    return buildThresholds(settings?.confidenceThreshold);
  }
}

export const biometricEngine = new BiometricEngineService();
