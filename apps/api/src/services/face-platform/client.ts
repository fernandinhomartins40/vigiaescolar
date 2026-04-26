type FacePlatformStatus = {
  available: boolean;
  configured: boolean;
  schemaReady?: boolean;
  service: string;
  message: string;
  statusCode?: number;
  error?: string | null;
  timestamp: string;
  raw?: unknown;
};

type FacePlatformRequestOptions = {
  tenantId: string;
  userId?: string | null;
  method?: "GET" | "POST" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
};

const DEFAULT_TIMEOUT_MS = 5000;

function getBaseUrl() {
  return (process.env.FACE_PLATFORM_URL || "").replace(/\/$/, "");
}

function getServiceToken() {
  return process.env.FACE_PLATFORM_SERVICE_TOKEN || "";
}

function getTimeoutMs() {
  const value = Number(process.env.FACE_PLATFORM_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
}

function unavailableStatus(message: string, extra?: Partial<FacePlatformStatus>): FacePlatformStatus {
  return {
    available: false,
    configured: Boolean(getBaseUrl() && getServiceToken()),
    service: "ultrazend-face-server",
    message,
    timestamp: new Date().toISOString(),
    ...extra,
  };
}

function buildUrl(baseUrl: string, path: string, query?: FacePlatformRequestOptions["query"]) {
  const url = new URL(`${baseUrl}${path.startsWith("/") ? path : `/${path}`}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function requestFacePlatform<T>(path: string, params: FacePlatformRequestOptions) {
  const baseUrl = getBaseUrl();
  const serviceToken = getServiceToken();

  if (!baseUrl || !serviceToken) {
    throw new Error("FACE_PLATFORM_URL e FACE_PLATFORM_SERVICE_TOKEN precisam estar configurados.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getTimeoutMs());

  try {
    const response = await fetch(buildUrl(baseUrl, path, params.query), {
      method: params.method ?? "GET",
      headers: {
        Accept: "application/json",
        ...(params.body ? { "Content-Type": "application/json" } : {}),
        Authorization: `Bearer ${serviceToken}`,
        "x-tenant-id": params.tenantId,
        ...(params.userId ? { "x-user-id": params.userId } : {}),
      },
      body: params.body ? JSON.stringify(params.body) : undefined,
      signal: controller.signal,
    });

    const text = await response.text();
    const payload = text ? JSON.parse(text) as unknown : null;

    if (!response.ok) {
      return unavailableStatus("Face Server respondeu com erro.", {
        statusCode: response.status,
        error: response.statusText || null,
        raw: payload,
      }) as T;
    }

    return payload as T;
  } finally {
    clearTimeout(timeout);
  }
}

export const facePlatformClient = {
  isConfigured() {
    return Boolean(getBaseUrl() && getServiceToken());
  },

  async getStatus(tenantId: string, userId?: string | null): Promise<FacePlatformStatus> {
    if (!this.isConfigured()) {
      return unavailableStatus("Face Server nao configurado na API principal.");
    }

    try {
      const status = await requestFacePlatform<Record<string, unknown>>("/status", { tenantId, userId });
      const available = Boolean(status.available);

      return {
        available,
        configured: true,
        schemaReady: typeof status.schemaReady === "boolean" ? status.schemaReady : undefined,
        service: String(status.service || "ultrazend-face-server"),
        message: String(status.message || (available ? "Face Server disponivel." : "Face Server indisponivel.")),
        timestamp: String(status.timestamp || new Date().toISOString()),
        raw: status,
      };
    } catch (error) {
      return unavailableStatus("Falha ao consultar Face Server.", {
        configured: true,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  async createEnrollment(input: {
    tenantId: string;
    userId?: string | null;
    citizenId: string;
    imageBase64?: string | null;
    embedding: number[];
    modelName?: string;
    modelVersion?: string | null;
    qualityScore?: number | null;
    livenessScore?: number | null;
    sourceLabel?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    return requestFacePlatform<unknown>("/identities/enrollments", {
      tenantId: input.tenantId,
      userId: input.userId,
      method: "POST",
      body: {
        citizenId: input.citizenId,
        imageBase64: input.imageBase64,
        embedding: input.embedding,
        modelName: input.modelName ?? "face-api.js",
        modelVersion: input.modelVersion ?? null,
        qualityScore: input.qualityScore ?? null,
        livenessScore: input.livenessScore ?? null,
        sourceLabel: input.sourceLabel ?? null,
        metadata: input.metadata ?? {},
      },
    });
  },

  async ingestRecognition(input: {
    tenantId: string;
    userId?: string | null;
    deviceId: string;
    zoneId?: string | null;
    unidadeEducacaoId?: string | null;
    imageBase64?: string | null;
    embedding: number[];
    eventType?: "ENTRY" | "EXIT" | "UNKNOWN";
    recognizedAt?: string;
    modelName?: string;
    modelVersion?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    return requestFacePlatform<unknown>("/events/ingest", {
      tenantId: input.tenantId,
      userId: input.userId,
      method: "POST",
      body: {
        deviceId: input.deviceId,
        zoneId: input.zoneId ?? null,
        unidadeEducacaoId: input.unidadeEducacaoId ?? null,
        imageBase64: input.imageBase64 ?? null,
        embedding: input.embedding,
        eventType: input.eventType ?? "UNKNOWN",
        recognizedAt: input.recognizedAt,
        modelName: input.modelName ?? "face-api.js",
        modelVersion: input.modelVersion ?? null,
        metadata: input.metadata ?? {},
      },
    });
  },

  async listEvents(input: {
    tenantId: string;
    userId?: string | null;
    unidadeEducacaoId?: string;
    zoneId?: string;
    matchStatus?: "MATCHED" | "REVIEW_REQUIRED" | "UNMATCHED";
    limit?: number;
  }) {
    return requestFacePlatform<unknown[]>("/events", {
      tenantId: input.tenantId,
      userId: input.userId,
      query: {
        unidadeEducacaoId: input.unidadeEducacaoId,
        zoneId: input.zoneId,
        matchStatus: input.matchStatus,
        limit: input.limit,
      },
    });
  },
};
