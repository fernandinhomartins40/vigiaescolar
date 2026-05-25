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
  update: {
    state: "idle" | "checking" | "available" | "ready" | "error";
    message: string;
    version?: string;
  };
};

export type PairResponse =
  | { ok: true; gatewayId: string; gatewayName: string; schoolName?: string }
  | { ok: false; error: string };
