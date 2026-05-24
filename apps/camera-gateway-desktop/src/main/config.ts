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
};

export const config = new Store<GatewayConfig>({
  defaults: {
    apiBaseUrl: "https://vigiaescolar.com.br/api",
    lastDiscoveredCameras: [],
    cameraCredentials: {},
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
