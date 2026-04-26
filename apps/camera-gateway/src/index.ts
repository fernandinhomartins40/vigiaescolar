import { setTimeout as delay } from "node:timers/promises";
import fs from "node:fs/promises";
import { listGatewayCameras, sendHeartbeat, sendRecognitionSnapshot, type GatewayCamera } from "./api-client";
import { config, validateConfig } from "./config";
import { captureSnapshot } from "./ffmpeg";

type CameraWorkerState = {
  camera: GatewayCamera;
  running: boolean;
  stopped: boolean;
  lastFrameAt: Date | null;
  lastError: string | null;
  capturesInWindow: number;
  windowStartedAt: number;
};

const workers = new Map<string, CameraWorkerState>();
let activeCaptures = 0;
let shuttingDown = false;

function log(message: string, context?: Record<string, unknown>) {
  console.log(JSON.stringify({
    level: "info",
    service: "camera-gateway",
    gatewayId: config.gatewayId,
    message,
    ...(context ?? {}),
    timestamp: new Date().toISOString(),
  }));
}

function errorLog(message: string, context?: Record<string, unknown>) {
  console.error(JSON.stringify({
    level: "error",
    service: "camera-gateway",
    gatewayId: config.gatewayId,
    message,
    ...(context ?? {}),
    timestamp: new Date().toISOString(),
  }));
}

function measuredFps(state: CameraWorkerState) {
  const elapsedSeconds = Math.max((Date.now() - state.windowStartedAt) / 1000, 1);
  return Math.round((state.capturesInWindow / elapsedSeconds) * 100) / 100;
}

async function waitForCaptureSlot() {
  while (!shuttingDown && activeCaptures >= config.maxConcurrentCaptures) {
    await delay(200);
  }
}

async function runCameraWorker(state: CameraWorkerState) {
  if (state.running) {
    return;
  }

  state.running = true;
  log("camera_worker_started", { cameraId: state.camera.id, cameraName: state.camera.name });

  while (!shuttingDown && !state.stopped) {
    try {
      await waitForCaptureSlot();
      if (shuttingDown || state.stopped) {
        break;
      }

      activeCaptures += 1;
      let snapshot: Awaited<ReturnType<typeof captureSnapshot>>;
      try {
        snapshot = await captureSnapshot(state.camera);
      } finally {
        activeCaptures = Math.max(activeCaptures - 1, 0);
      }

      state.lastFrameAt = snapshot.capturedAt;
      state.lastError = null;
      state.capturesInWindow += 1;

      await sendHeartbeat({
        camera: state.camera,
        healthStatus: "ONLINE",
        lastFrameAt: state.lastFrameAt,
        lastError: null,
        measuredFps: measuredFps(state),
        metadata: {
          snapshotPath: snapshot.filePath,
          snapshotElapsedMs: snapshot.elapsedMs,
          streamType: state.camera.type,
        },
      });

      const imageBase64 = `data:image/jpeg;base64,${await fs.readFile(snapshot.filePath, "base64")}`;
      await sendRecognitionSnapshot({
        camera: state.camera,
        imageBase64,
        capturedAt: snapshot.capturedAt,
        metadata: {
          snapshotPath: snapshot.filePath,
          snapshotElapsedMs: snapshot.elapsedMs,
        },
      });

      log("snapshot_captured", {
        cameraId: state.camera.id,
        elapsedMs: snapshot.elapsedMs,
        filePath: snapshot.filePath,
      });
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error);

      await sendHeartbeat({
        camera: state.camera,
        healthStatus: "ERROR",
        lastFrameAt: state.lastFrameAt,
        lastError: state.lastError,
        measuredFps: measuredFps(state),
      }).catch((heartbeatError) => {
        errorLog("heartbeat_failed", {
          cameraId: state.camera.id,
          error: heartbeatError instanceof Error ? heartbeatError.message : String(heartbeatError),
        });
      });

      errorLog("snapshot_failed", {
        cameraId: state.camera.id,
        cameraName: state.camera.name,
        error: state.lastError,
      });
    }

    if (Date.now() - state.windowStartedAt > 60_000) {
      state.windowStartedAt = Date.now();
      state.capturesInWindow = 0;
    }

    await delay(config.frameIntervalMs);
  }

  state.running = false;
  log("camera_worker_stopped", { cameraId: state.camera.id, cameraName: state.camera.name });
}

function syncWorkers(cameras: GatewayCamera[]) {
  const activeIds = new Set(cameras.map((camera) => camera.id));

  for (const [cameraId, state] of workers) {
    if (!activeIds.has(cameraId)) {
      state.stopped = true;
      workers.delete(cameraId);
      void sendHeartbeat({
        camera: state.camera,
        healthStatus: "OFFLINE",
        lastFrameAt: state.lastFrameAt,
        lastError: "Camera removida da lista ativa do gateway.",
        measuredFps: measuredFps(state),
      }).catch(() => undefined);
    }
  }

  for (const camera of cameras) {
    const current = workers.get(camera.id);
    if (current) {
      current.camera = camera;
      continue;
    }

    const state: CameraWorkerState = {
      camera,
      running: false,
      stopped: false,
      lastFrameAt: null,
      lastError: null,
      capturesInWindow: 0,
      windowStartedAt: Date.now(),
    };

    workers.set(camera.id, state);
    void runCameraWorker(state);
  }
}

async function pollCameras() {
  while (!shuttingDown) {
    try {
      const cameras = await listGatewayCameras();
      syncWorkers(cameras);
      log("camera_poll_completed", { totalCameras: cameras.length });
    } catch (error) {
      errorLog("camera_poll_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    await delay(config.pollIntervalMs);
  }
}

async function main() {
  validateConfig();
  log("camera_gateway_started", {
    apiBaseUrl: config.apiBaseUrl,
    frameIntervalMs: config.frameIntervalMs,
    pollIntervalMs: config.pollIntervalMs,
    snapshotDir: config.snapshotDir,
  });

  process.on("SIGTERM", () => {
    shuttingDown = true;
  });
  process.on("SIGINT", () => {
    shuttingDown = true;
  });

  await pollCameras();
}

void main().catch((error) => {
  errorLog("camera_gateway_crashed", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
