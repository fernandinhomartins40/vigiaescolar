import { Pool, type PoolClient } from 'pg';
interface CompreFaceSubjectEntry {
  subject?: string;
  similarity?: number;
}

interface CompreFaceFaceEntry {
  box?: Record<string, unknown>;
  subjects?: CompreFaceSubjectEntry[];
}

interface CompreFaceResponse {
  result?: CompreFaceFaceEntry[];
  message?: string;
  error?: string;
  [key: string]: unknown;
}

export interface CompreFaceRecognitionCandidate {
  subject: string;
  similarity: number;
  faceIndex: number;
  box: Record<string, unknown> | null;
  raw: Record<string, unknown>;
}

export interface CompreFaceStatus {
  configured: boolean;
  available: boolean;
  baseUrl: string | null;
  message: string;
}

const DEFAULT_COMPRE_FACE_APP_NAME = 'Digiurban Face Platform';
const DEFAULT_COMPRE_FACE_MODEL_NAME = 'Digiurban Recognition';
const COMPRE_FACE_RECOGNITION_MODEL_TYPE = 'R';
const DEFAULT_COMPRE_FACE_POSTGRES_HOST = 'compreface-postgres-db';
const DEFAULT_COMPRE_FACE_POSTGRES_PORT = 5432;
const DEFAULT_COMPRE_FACE_POSTGRES_USER = 'postgres';
const DEFAULT_COMPRE_FACE_POSTGRES_PASSWORD = 'postgres';
const DEFAULT_COMPRE_FACE_POSTGRES_DB = 'frs';

function stripTrailingSlash(value: string) {
  return value.replace(/\/$/, '');
}

function getConfigurationMessage(baseUrl: string, apiKey: string, discoveryEnabled: boolean) {
  if (!baseUrl && !apiKey) {
    return discoveryEnabled
      ? 'CompreFace não está configurado. Defina COMPREFACE_API_URL e COMPREFACE_API_KEY, ou ajuste o acesso ao banco do CompreFace para descoberta automática.'
      : 'CompreFace não está configurado. Defina COMPREFACE_API_URL e COMPREFACE_API_KEY.';
  }

  if (!baseUrl) {
    return 'CompreFace não está configurado. Defina COMPREFACE_API_URL.';
  }

  if (!apiKey) {
    return discoveryEnabled
      ? 'CompreFace não está configurado. A chave não foi encontrada em COMPREFACE_API_KEY nem no banco do CompreFace.'
      : 'CompreFace não está configurado. Defina COMPREFACE_API_KEY.';
  }

  return 'CompreFace não está configurado.';
}

function buildTimeoutSignal(timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout),
  };
}

function createCompreFaceError(message: string, status = 500, details?: unknown) {
  const error = new Error(message) as Error & { status?: number; details?: unknown };
  error.status = status;
  error.details = details;
  return error;
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

function createDatabasePool() {
  if (process.env.COMPREFACE_DISCOVER_API_KEY_FROM_DB === 'false') {
    return null;
  }

  const connectionString = process.env.COMPREFACE_POSTGRES_URL;

  if (connectionString) {
    return new Pool({
      connectionString,
      connectionTimeoutMillis: Number(process.env.COMPREFACE_POSTGRES_TIMEOUT_MS || 5000),
      max: 1,
      idleTimeoutMillis: 1000,
    });
  }

  return new Pool({
    host: process.env.COMPREFACE_POSTGRES_HOST || DEFAULT_COMPRE_FACE_POSTGRES_HOST,
    port: Number(process.env.COMPREFACE_POSTGRES_PORT || DEFAULT_COMPRE_FACE_POSTGRES_PORT),
    user: process.env.COMPREFACE_POSTGRES_USER || DEFAULT_COMPRE_FACE_POSTGRES_USER,
    password: process.env.COMPREFACE_POSTGRES_PASSWORD || DEFAULT_COMPRE_FACE_POSTGRES_PASSWORD,
    database: process.env.COMPREFACE_POSTGRES_DB || DEFAULT_COMPRE_FACE_POSTGRES_DB,
    connectionTimeoutMillis: Number(process.env.COMPREFACE_POSTGRES_TIMEOUT_MS || 5000),
    max: 1,
    idleTimeoutMillis: 1000,
  });
}

export class CompreFaceClient {
  private readonly baseUrl: string;
  private apiKey: string;
  private readonly timeoutMs: number;
  private readonly appName: string;
  private readonly modelName: string;
  private readonly databasePool: Pool | null;
  private apiKeyResolutionPromise: Promise<string | null> | null = null;

  constructor() {
    this.baseUrl = stripTrailingSlash(process.env.COMPREFACE_API_URL || 'http://compreface-ui:80');
    this.apiKey = process.env.COMPREFACE_API_KEY || '';
    this.timeoutMs = Number(process.env.COMPREFACE_TIMEOUT_MS || 15000);
    this.appName = process.env.COMPREFACE_APP_NAME || DEFAULT_COMPRE_FACE_APP_NAME;
    this.modelName = process.env.COMPREFACE_MODEL_NAME || DEFAULT_COMPRE_FACE_MODEL_NAME;
    this.databasePool = createDatabasePool();
  }

  public isConfigured() {
    return Boolean(this.baseUrl);
  }

  public async getStatus(): Promise<CompreFaceStatus> {
    const apiKey = await this.resolveApiKey();

    if (!this.baseUrl || !apiKey) {
      return {
        configured: false,
        available: false,
        baseUrl: this.baseUrl || null,
        message: getConfigurationMessage(this.baseUrl, apiKey || '', Boolean(this.databasePool)),
      };
    }

    try {
      await this.request('/api/v1/recognition/subjects', {
        method: 'GET',
      });

      return {
        configured: true,
        available: true,
        baseUrl: this.baseUrl,
        message: 'CompreFace disponível.',
      };
    } catch (error: any) {
      return {
        configured: true,
        available: false,
        baseUrl: this.baseUrl,
        message: error?.message || 'CompreFace indisponível.',
      };
    }
  }

  private async ensureConfigured() {
    const apiKey = await this.resolveApiKey();

    if (!this.baseUrl || !apiKey) {
      throw createCompreFaceError(getConfigurationMessage(this.baseUrl, apiKey || '', Boolean(this.databasePool)), 503, {
        baseUrl: this.baseUrl || null,
        appName: this.appName,
        modelName: this.modelName,
        discoveryEnabled: Boolean(this.databasePool),
      });
    }
  }

  private async resolveApiKey() {
    if (this.apiKey) {
      return this.apiKey;
    }

    if (!this.apiKeyResolutionPromise) {
      this.apiKeyResolutionPromise = this.resolveApiKeyInternal().finally(() => {
        this.apiKeyResolutionPromise = null;
      });
    }

    const resolved = await this.apiKeyResolutionPromise;

    if (resolved) {
      this.apiKey = resolved;
    }

    return this.apiKey || null;
  }

  private async resolveApiKeyInternal() {
    const fromDatabase = await this.resolveApiKeyFromDatabase();

    if (fromDatabase) {
      return fromDatabase;
    }

    return null;
  }

  private async resolveApiKeyFromDatabase() {
    if (!this.databasePool) {
      return null;
    }

    let client: PoolClient | null = null;

    try {
      client = await this.databasePool.connect();

      const modelResult = await client.query<{ api_key: string }>(
        `
          SELECT m.api_key
          FROM model m
          INNER JOIN app a ON a.id = m.app_id
          WHERE a.name = $1
            AND m.name = $2
            AND m.type = $3
          ORDER BY COALESCE(m.created_date, NOW()) DESC, m.id DESC
          LIMIT 1
        `,
        [this.appName, this.modelName, COMPRE_FACE_RECOGNITION_MODEL_TYPE]
      );

      const modelApiKey = modelResult.rows[0]?.api_key?.trim();

      if (modelApiKey) {
        return modelApiKey;
      }

      const appResult = await client.query<{ api_key: string }>(
        `
          SELECT api_key
          FROM app
          WHERE name = $1
          ORDER BY id DESC
          LIMIT 1
        `,
        [this.appName]
      );

      const appApiKey = appResult.rows[0]?.api_key?.trim();

      if (appApiKey) {
        return appApiKey;
      }

      const fallbackModelResult = await client.query<{ api_key: string }>(
        `
          SELECT api_key
          FROM model
          WHERE type = $1
          ORDER BY COALESCE(created_date, NOW()) DESC, id DESC
          LIMIT 1
        `,
        [COMPRE_FACE_RECOGNITION_MODEL_TYPE]
      );

      return fallbackModelResult.rows[0]?.api_key?.trim() || null;
    } catch {
      return null;
    } finally {
      client?.release();
    }
  }

  private async request(path: string, init: RequestInit) {
    const apiKey = await this.resolveApiKey();

    if (!this.baseUrl || !apiKey) {
      throw createCompreFaceError(getConfigurationMessage(this.baseUrl, apiKey || '', Boolean(this.databasePool)), 503, {
        baseUrl: this.baseUrl || null,
        appName: this.appName,
        modelName: this.modelName,
        discoveryEnabled: Boolean(this.databasePool),
      });
    }

    const timeout = buildTimeoutSignal(this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: timeout.signal,
        headers: {
          'x-api-key': apiKey,
          ...(init.headers || {}),
        },
      });

      const payload = await parseJsonResponse(response);

      if (!response.ok) {
        throw createCompreFaceError(
          String(payload.message || payload.error || `CompreFace respondeu com status ${response.status}`),
          response.status,
          payload
        );
      }

      return payload as CompreFaceResponse;
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        throw createCompreFaceError('Tempo esgotado ao consultar o CompreFace.', 504);
      }

      throw error;
    } finally {
      timeout.clear();
    }
  }
}

export default new CompreFaceClient();
