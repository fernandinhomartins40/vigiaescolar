export type DiscoveredCameraDTO = {
  ip: string;
  serialNumber: string;
  deviceModel: string;
  hardware: string;
  mac: string;
  lastSeenAt: number;
};

export type GatewayStatus = {
  paired: boolean;
  gatewayId?: string;
  gatewayName?: string;
  schoolName?: string;
  apiBaseUrl: string;
  lastDiscoveredCameras: DiscoveredCameraDTO[];
  lastSyncAt?: number;
};

export type PairResponse =
  | { ok: true; gatewayId: string; gatewayName: string; schoolName?: string }
  | { ok: false; error: string };
