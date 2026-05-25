import { config } from "./config";

export type GatewayCamera = {
  id: string;
  tenantId: string;
  schoolId: string;
  name: string;
  location: string;
  type: "RTSP" | "IP" | "USB";
  streamUrl: string;
  configuredFps: number;
  username: string | null;
  password: string | null;
  // Identificadores físicos (XM/iCSee). Quando o gateway está em modo
  // MediaMTX, ignora streamUrl e usa serialNumber como stream key:
  // rtsp://${mediaServer}/live/<serialNumber>
  bluetoothMac?: string | null;
  serialNumber?: string | null;
  wifiSsid?: string | null;
};

export type CameraHealthStatus = "ONLINE" | "OFFLINE" | "DEGRADED" | "ERROR";

async function apiRequest<T>(path: string, init: RequestInit & { headers?: Record<string, string> } = {}) {
  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${config.serviceToken}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) as unknown : null;

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "message" in payload
        ? String((payload as Record<string, unknown>).message)
        : response.statusText;
    throw new Error(message || `API request failed with status ${response.status}`);
  }

  return payload as T;
}

export async function listGatewayCameras() {
  const payload = await apiRequest<{ cameras: GatewayCamera[] }>("/internal/camera-gateway/cameras", {
    headers: config.isLocal ? { "X-Gateway-Local": "true" } : {},
  });
  return payload.cameras ?? [];
}

export async function sendHeartbeat(input: {
  camera: GatewayCamera;
  healthStatus: CameraHealthStatus;
  lastFrameAt?: Date | null;
  lastError?: string | null;
  measuredFps?: number | null;
  metadata?: Record<string, unknown>;
}) {
  await apiRequest("/internal/camera-gateway/heartbeat", {
    method: "POST",
    body: JSON.stringify({
      tenantId: input.camera.tenantId,
      schoolId: input.camera.schoolId,
      cameraId: input.camera.id,
      gatewayId: config.gatewayId,
      healthStatus: input.healthStatus,
      lastHeartbeatAt: new Date().toISOString(),
      lastFrameAt: input.lastFrameAt?.toISOString(),
      lastError: input.lastError ?? null,
      measuredFps: input.measuredFps ?? null,
      metadata: input.metadata ?? {},
    }),
  });
}

export async function sendRecognitionSnapshot(input: {
  camera: GatewayCamera;
  imageBase64: string;
  capturedAt: Date;
  metadata?: Record<string, unknown>;
}) {
  await apiRequest("/internal/camera-gateway/recognition", {
    method: "POST",
    body: JSON.stringify({
      tenantId: input.camera.tenantId,
      schoolId: input.camera.schoolId,
      cameraId: input.camera.id,
      imageBase64: input.imageBase64,
      capturedAt: input.capturedAt.toISOString(),
      direction: "UNKNOWN",
      metadata: {
        gatewayId: config.gatewayId,
        streamType: input.camera.type,
        ...(input.metadata ?? {}),
      },
    }),
  });
}
