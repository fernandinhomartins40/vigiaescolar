import { contextBridge, ipcRenderer } from "electron";
import type { GatewayStatus, PairResponse } from "../shared/types";

contextBridge.exposeInMainWorld("gateway", {
  getStatus: (): Promise<GatewayStatus> => ipcRenderer.invoke("config:get"),
  pair: (code: string): Promise<PairResponse> => ipcRenderer.invoke("pair", code),
  unpair: (): Promise<{ ok: boolean }> => ipcRenderer.invoke("unpair"),
  discoverNow: (): Promise<{ ok: boolean }> => ipcRenderer.invoke("discover-now"),
});

declare global {
  interface Window {
    gateway: {
      getStatus: () => Promise<GatewayStatus>;
      pair: (code: string) => Promise<PairResponse>;
      unpair: () => Promise<{ ok: boolean }>;
      discoverNow: () => Promise<{ ok: boolean }>;
    };
  }
}
