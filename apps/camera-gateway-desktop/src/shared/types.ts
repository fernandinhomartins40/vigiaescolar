export type DiscoveredCameraDTO = {
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
  localLiveUrl?: string;
};

export type EdgeEmbeddingDTO = {
  id: string;
  modelName: string;
  modelVersion?: string | null;
  vector: number[];
  qualityScore?: number | null;
  isActive: boolean;
  createdAt: string;
};

export type EdgeReferenceDTO = {
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
  embeddings: EdgeEmbeddingDTO[];
  totalEmbeddings: number;
  createdAt: string;
  updatedAt: string;
};

export type EdgeSyncStateDTO = {
  syncedAt?: number;
  cameras: Array<{
    id: string;
    schoolId: string;
    name: string;
    location: string;
    serialNumber: string;
    streamKey: string;
    recognitionStartTime?: string | null;
    recognitionEndTime?: string | null;
  }>;
  references: EdgeReferenceDTO[];
  settings: {
    confidenceThreshold: number;
    framesPerSecond: number;
  };
};

export type EdgeRecognitionEventDTO = {
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

export type GatewayStatus = {
  paired: boolean;
  appVersion: string;
  gatewayId?: string;
  gatewayName?: string;
  schoolName?: string;
  apiBaseUrl: string;
  lastDiscoveredCameras: DiscoveredCameraDTO[];
  lastSyncAt?: number;
  edge: EdgeSyncStateDTO;
  pendingEdgeEvents: number;
  update: {
    state: "idle" | "checking" | "available" | "ready" | "error";
    message: string;
    version?: string;
  };
};

export type PairResponse =
  | { ok: true; gatewayId: string; gatewayName: string; schoolName?: string }
  | { ok: false; error: string };

export type LogEntry = {
  ts: number;
  level: "info" | "warn" | "error";
  msg: string;
};
