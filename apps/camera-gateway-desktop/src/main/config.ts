/**
 * Persistência local do gateway (Windows: %APPDATA%/VigiaEscolar Gateway/config.json).
 *
 * Mantém:
 *  - apiBaseUrl: URL da API VigiaEscolar (https://vigiaescolar.com.br/api)
 *  - gatewayId / gatewayToken: credenciais geradas no pareamento
 *  - gatewayName, schoolId, schoolName: metadata para UI
 *  - lastDiscoveredCameras: cache da última varredura LAN
 *  - cameraCredentials: senha DVRIP por câmera (não trafega pela API)
 */
import Store from "electron-store";

export type DiscoveredCamera = {
  ip: string;
  serialNumber: string;
  deviceModel: string;
  hardware: string;
  mac: string;
  lastSeenAt: number;
  cameraId?: string;
  streamKey?: string;
  liveUrl?: string;
  publishUrl?: string;
};

export type EdgeEmbedding = {
  id: string;
  modelName: string;
  modelVersion?: string | null;
  vector: number[];
  qualityScore?: number | null;
  isActive: boolean;
  createdAt: string;
};

export type EdgeReference = {
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
  embeddings: EdgeEmbedding[];
  totalEmbeddings: number;
  createdAt: string;
  updatedAt: string;
};

export type EdgeCamera = {
  id: string;
  schoolId: string;
  name: string;
  location: string;
  serialNumber: string;
  streamKey: string;
  recognitionStartTime?: string | null;
  recognitionEndTime?: string | null;
};

export type EdgeSyncState = {
  syncedAt?: number;
  cameras: EdgeCamera[];
  references: EdgeReference[];
  settings: {
    confidenceThreshold: number;
    framesPerSecond: number;
  };
};

export type PendingEdgeRecognitionEvent = {
  eventId: string;
  cameraId: string;
  schoolId: string;
  identityId?: string | null;
  studentId?: string | null;
  matchStatus: "MATCHED" | "REVIEW_REQUIRED" | "UNMATCHED";
  confidence: number;
  recognizedAt: string;
  direction: "ENTRY" | "EXIT" | "UNKNOWN";
  modelName: string;
  modelVersion?: string | null;
  distance?: number | null;
  metadata?: Record<string, unknown>;
};

export type GatewayConfig = {
  apiBaseUrl: string;
  gatewayId?: string;
  gatewayToken?: string;
  gatewayName?: string;
  schoolId?: string;
  schoolName?: string;
  lastDiscoveredCameras: DiscoveredCamera[];
  lastSyncAt?: number;
  cameraCredentials: Record<string, { user: string; pass: string }>;
  remoteRelayEnabled: boolean;
  edge: EdgeSyncState;
  pendingEdgeRecognitionEvents: PendingEdgeRecognitionEvent[];
};

export const config = new Store<GatewayConfig>({
  defaults: {
    apiBaseUrl: "https://vigiaescolar.com.br/api",
    lastDiscoveredCameras: [],
    cameraCredentials: {},
    remoteRelayEnabled: false,
    edge: {
      cameras: [],
      references: [],
      settings: {
        confidenceThreshold: 0.6,
        framesPerSecond: 2,
      },
    },
    pendingEdgeRecognitionEvents: [],
  },
});

export function saveConfig(patch: Partial<GatewayConfig>) {
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) {
      // electron-store v10 não tem delete tipado bem; usamos cast
      (config as unknown as { delete: (k: string) => void }).delete(k);
    } else {
      config.set(k as keyof GatewayConfig, v as never);
    }
  }
}
