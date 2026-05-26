import { contextBridge, ipcRenderer } from "electron";
import type { EdgeRecognitionEventDTO, EdgeSyncStateDTO, GatewayStatus, LogEntry, PairResponse } from "../shared/types";

contextBridge.exposeInMainWorld("gateway", {
  getStatus: (): Promise<GatewayStatus> => ipcRenderer.invoke("config:get"),
  pair: (code: string): Promise<PairResponse> => ipcRenderer.invoke("pair", code),
  unpair: (): Promise<{ ok: boolean }> => ipcRenderer.invoke("unpair"),
  discoverNow: (): Promise<{ ok: boolean }> => ipcRenderer.invoke("discover-now"),
  syncEdge: (): Promise<{ ok: boolean; state: EdgeSyncStateDTO }> => ipcRenderer.invoke("edge:sync"),
  getEdge: (): Promise<{ state: EdgeSyncStateDTO; pendingEvents: number }> => ipcRenderer.invoke("edge:get"),
  submitEdgeRecognition: (payload: EdgeRecognitionEventDTO): Promise<{ ok: boolean; queued?: boolean }> =>
    ipcRenderer.invoke("edge:recognition", payload),
  checkForUpdates: (): Promise<{ ok: boolean }> => ipcRenderer.invoke("updates:check"),
  getLogs: (): Promise<LogEntry[]> => ipcRenderer.invoke("logs:get"),
  probeStream: (serialNumber: string, streamKey?: string): Promise<{ ready: boolean }> =>
    ipcRenderer.invoke("stream:probe", serialNumber, streamKey),
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
      syncEdge: () => Promise<{ ok: boolean; state: EdgeSyncStateDTO }>;
      getEdge: () => Promise<{ state: EdgeSyncStateDTO; pendingEvents: number }>;
      submitEdgeRecognition: (payload: EdgeRecognitionEventDTO) => Promise<{ ok: boolean; queued?: boolean }>;
      checkForUpdates: () => Promise<{ ok: boolean }>;
      getLogs: () => Promise<LogEntry[]>;
      probeStream: (serialNumber: string, streamKey?: string) => Promise<{ ready: boolean }>;
      onStatusChanged: (callback: () => void) => () => void;
    };
  }
}
