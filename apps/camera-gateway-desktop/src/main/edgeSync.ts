import { randomUUID } from "node:crypto";
import { config, saveConfig, type EdgeSyncState, type PendingEdgeRecognitionEvent } from "./config";
import { apiRequest } from "./pairing";

const SYNC_INTERVAL_MS = 5 * 60 * 1000;
const FLUSH_INTERVAL_MS = 30_000;
const MAX_PENDING_EVENTS = 1_000;

let syncTimer: NodeJS.Timeout | null = null;
let flushTimer: NodeJS.Timeout | null = null;
let syncing = false;
let flushing = false;

export function edgeSyncState(): EdgeSyncState {
  return config.get("edge");
}

export async function syncEdgeData() {
  if (syncing || !config.get("gatewayToken")) return edgeSyncState();
  syncing = true;
  try {
    const state = await apiRequest<EdgeSyncState>("/gateways/edge/sync", { method: "GET" });
    const normalized: EdgeSyncState = {
      syncedAt: Date.now(),
      cameras: state.cameras ?? [],
      references: state.references ?? [],
      settings: {
        confidenceThreshold: Number(state.settings?.confidenceThreshold ?? 0.6),
        framesPerSecond: Math.max(1, Number(state.settings?.framesPerSecond ?? 2)),
      },
    };
    saveConfig({ edge: normalized });
    return normalized;
  } catch (error) {
    console.warn("[edge] sync falhou:", (error as Error).message);
    return edgeSyncState();
  } finally {
    syncing = false;
  }
}

function enqueueEvent(event: PendingEdgeRecognitionEvent) {
  const pending = config.get("pendingEdgeRecognitionEvents") ?? [];
  const next = [...pending, event].slice(-MAX_PENDING_EVENTS);
  saveConfig({ pendingEdgeRecognitionEvents: next });
}

export async function submitEdgeRecognitionEvent(
  event: Omit<PendingEdgeRecognitionEvent, "eventId"> & { eventId?: string },
) {
  const payload: PendingEdgeRecognitionEvent = {
    ...event,
    eventId: event.eventId ?? randomUUID(),
  };

  try {
    await apiRequest("/gateways/edge/recognitions", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return { ok: true, queued: false };
  } catch (error) {
    console.warn("[edge] envio de reconhecimento falhou, enfileirando:", (error as Error).message);
    enqueueEvent(payload);
    return { ok: true, queued: true };
  }
}

export async function flushPendingEdgeRecognitionEvents() {
  if (flushing || !config.get("gatewayToken")) return;
  const pending = config.get("pendingEdgeRecognitionEvents") ?? [];
  if (pending.length === 0) return;

  flushing = true;
  const remaining: PendingEdgeRecognitionEvent[] = [];
  try {
    for (const event of pending) {
      try {
        await apiRequest("/gateways/edge/recognitions", {
          method: "POST",
          body: JSON.stringify(event),
        });
      } catch {
        remaining.push(event);
      }
    }
  } finally {
    saveConfig({ pendingEdgeRecognitionEvents: remaining });
    flushing = false;
  }
}

export function runEdgeSyncLoop() {
  if (!syncTimer) {
    syncTimer = setInterval(() => void syncEdgeData(), SYNC_INTERVAL_MS);
    void syncEdgeData();
  }
  if (!flushTimer) {
    flushTimer = setInterval(() => void flushPendingEdgeRecognitionEvents(), FLUSH_INTERVAL_MS);
    void flushPendingEdgeRecognitionEvents();
  }
}

export function stopEdgeSyncLoop() {
  if (syncTimer) clearInterval(syncTimer);
  if (flushTimer) clearInterval(flushTimer);
  syncTimer = null;
  flushTimer = null;
}
