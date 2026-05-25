import { contextBridge, ipcRenderer } from "electron";
import type { GatewayStatus, PairResponse } from "../shared/types";

contextBridge.exposeInMainWorld("gateway", {
  getStatus: (): Promise<GatewayStatus> => ipcRenderer.invoke("config:get"),
  pair: (code: string): Promise<PairResponse> => ipcRenderer.invoke("pair", code),
  unpair: (): Promise<{ ok: boolean }> => ipcRenderer.invoke("unpair"),
  discoverNow: (): Promise<{ ok: boolean }> => ipcRenderer.invoke("discover-now"),
  checkForUpdates: (): Promise<{ ok: boolean }> => ipcRenderer.invoke("updates:check"),
  onStatusChanged: (callback: () => void): (() => void) => {
    const listener = () => callback();
    ipcRenderer.on("status:changed", listener);
    return () => ipcRenderer.removeListener("status:changed", listener);
  },
});

declare global {
  interface Window {
    gateway: {
      getStatus: () => Promise<GatewayStatus>;
      pair: (code: string) => Promise<PairResponse>;
      unpair: () => Promise<{ ok: boolean }>;
      discoverNow: () => Promise<{ ok: boolean }>;
      checkForUpdates: () => Promise<{ ok: boolean }>;
      onStatusChanged: (callback: () => void) => () => void;
    };
  }
}
