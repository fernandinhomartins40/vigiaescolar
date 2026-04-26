interface FaceLivenessInput {
  imageBase64?: string | null;
  hintedScore?: number | null;
  metadata?: unknown;
}

export interface FaceLivenessResult {
  provider: string;
  score: number | null;
  passed: boolean | null;
  mode: 'server' | 'payload' | 'disabled';
  details: Record<string, unknown>;
}

export interface FaceLivenessStatus {
  configured: boolean;
  available: boolean;
  provider: string;
  message: string;
}

function buildTimeoutSignal(timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout),
  };
}

async function parseJsonResponse(response: Response) {
  const text = await response.text();

  if (!text) {
    return {} as Record<string, unknown>;
  }

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {
      raw: text,
    } as Record<string, unknown>;
  }
}

function getMinimumLivenessThreshold() {
  return Number(process.env.FACE_AUTO_APPROVE_LIVENESS_THRESHOLD || 0.82);
}

function createFaceLivenessError(message: string, status = 500, details?: unknown) {
  const error = new Error(message) as Error & { status?: number; details?: unknown };
  error.status = status;
  error.details = details;
  return error;
}

export class FaceLivenessService {
  private readonly provider: string;
  private readonly apiUrl: string;
  private readonly apiToken: string;
  private readonly timeoutMs: number;
  private readonly requireServerProvider: boolean;

  constructor() {
    this.provider = process.env.FACE_LIVENESS_PROVIDER || 'guided-live-session';
    this.apiUrl = (process.env.SILENT_FACE_LIVENESS_API_URL || '').replace(/\/$/, '');
    this.apiToken = process.env.SILENT_FACE_LIVENESS_API_TOKEN || '';
    this.timeoutMs = Number(process.env.FACE_LIVENESS_TIMEOUT_MS || 12000);
    this.requireServerProvider = process.env.FACE_REQUIRE_SERVER_LIVENESS === 'true';
  }

  public async getStatus(): Promise<FaceLivenessStatus> {
    if (this.provider === 'disabled') {
      return {
        configured: true,
        available: true,
        provider: this.provider,
        message: 'Validação de prova de vida desabilitada por configuração.',
      };
    }

    if (this.provider !== 'silent-face-http') {
      return {
        configured: true,
        available: true,
        provider: this.provider,
        message: 'Prova de vida usando score enviado pela sessão guiada.',
      };
    }

    if (!this.apiUrl) {
      return {
        configured: false,
        available: false,
        provider: this.provider,
        message: 'SILENT_FACE_LIVENESS_API_URL não está configurado.',
      };
    }

    const timeout = buildTimeoutSignal(this.timeoutMs);

    try {
      const response = await fetch(`${this.apiUrl}/health`, {
        method: 'GET',
        signal: timeout.signal,
        headers: this.apiToken
          ? {
              Authorization: `Bearer ${this.apiToken}`,
            }
          : undefined,
      });

      if (!response.ok) {
        throw createFaceLivenessError(`Status ${response.status}`, response.status);
      }

      return {
        configured: true,
        available: true,
        provider: this.provider,
        message: 'Serviço externo de prova de vida disponível.',
      };
    } catch (error: any) {
      return {
        configured: true,
        available: false,
        provider: this.provider,
        message: error?.message || 'Serviço externo de prova de vida indisponível.',
      };
    } finally {
      timeout.clear();
    }
  }

  public async assess(input: FaceLivenessInput): Promise<FaceLivenessResult> {
    if (this.provider === 'disabled') {
      return {
        provider: 'disabled',
        score: input.hintedScore ?? null,
        passed: null,
        mode: 'disabled',
        details: {},
      };
    }

    if (this.provider === 'silent-face-http' && this.apiUrl) {
      try {
        return await this.assessByHttp(input);
      } catch (error: any) {
        if (this.requireServerProvider) {
          throw error;
        }
      }
    }

    return this.assessFromPayload(input);
  }

  private assessFromPayload(input: FaceLivenessInput): FaceLivenessResult {
    const score = input.hintedScore ?? this.extractMetadataScore(input.metadata);

    return {
      provider: 'guided-live-session',
      score,
      passed: score === null ? null : score >= getMinimumLivenessThreshold(),
      mode: 'payload',
      details: {
        source: 'guided-live-session',
      },
    };
  }

  private async assessByHttp(input: FaceLivenessInput): Promise<FaceLivenessResult> {
    if (!input.imageBase64) {
      throw createFaceLivenessError('A análise de prova de vida exige imagem ao vivo.', 400);
    }

    const timeout = buildTimeoutSignal(this.timeoutMs);

    try {
      const response = await fetch(`${this.apiUrl}/api/liveness/analyze`, {
        method: 'POST',
        signal: timeout.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiToken
            ? {
                Authorization: `Bearer ${this.apiToken}`,
              }
            : {}),
        },
        body: JSON.stringify({
          imageBase64: input.imageBase64,
          metadata: input.metadata || null,
          hintedScore: input.hintedScore ?? null,
        }),
      });

      const payload = await parseJsonResponse(response);

      if (!response.ok) {
        throw createFaceLivenessError(
          String(payload.message || payload.error || `Serviço de prova de vida respondeu ${response.status}`),
          response.status,
          payload
        );
      }

      const rawScore = payload.score;
      const score = rawScore === null || rawScore === undefined ? null : Number(rawScore);
      const passed =
        typeof payload.passed === 'boolean'
          ? payload.passed
          : score === null
            ? null
            : score >= getMinimumLivenessThreshold();

      return {
        provider: String(payload.provider || 'silent-face-http'),
        score: Number.isFinite(score ?? NaN) ? score : null,
        passed,
        mode: 'server',
        details: payload,
      };
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        throw createFaceLivenessError('Tempo esgotado ao consultar o serviço de prova de vida.', 504);
      }

      throw error;
    } finally {
      timeout.clear();
    }
  }

  private extractMetadataScore(metadata: unknown) {
    if (!metadata || typeof metadata !== 'object') {
      return null;
    }

    const objectMetadata = metadata as Record<string, unknown>;
    const rawScore = objectMetadata.livenessScore || objectMetadata.score;

    if (rawScore === null || rawScore === undefined) {
      return null;
    }

    const score = Number(rawScore);
    return Number.isFinite(score) ? score : null;
  }
}

export default new FaceLivenessService();
