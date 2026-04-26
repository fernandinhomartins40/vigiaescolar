import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config";
import type { GatewayCamera } from "./api-client";

export type SnapshotResult = {
  filePath: string;
  capturedAt: Date;
  elapsedMs: number;
};

function safeSegment(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, "_") || "unknown";
}

function withCredentials(camera: GatewayCamera) {
  if (!camera.username || !camera.password) {
    return camera.streamUrl;
  }

  try {
    const url = new URL(camera.streamUrl);
    if (url.username || url.password) {
      return camera.streamUrl;
    }

    url.username = camera.username;
    url.password = camera.password;
    return url.toString();
  } catch {
    return camera.streamUrl;
  }
}

export async function captureSnapshot(camera: GatewayCamera): Promise<SnapshotResult> {
  const startedAt = Date.now();
  const cameraDir = path.join(config.snapshotDir, safeSegment(camera.tenantId), safeSegment(camera.id));
  await fs.mkdir(cameraDir, { recursive: true });

  const filePath = path.join(cameraDir, `${Date.now()}.jpg`);
  const streamUrl = withCredentials(camera);
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-rtsp_transport",
    "tcp",
    "-stimeout",
    String(Math.max(config.snapshotTimeoutMs, 1000) * 1000),
    "-i",
    streamUrl,
    "-frames:v",
    "1",
    "-q:v",
    "2",
    "-y",
    filePath,
  ];

  const stderr: string[] = [];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(config.ffmpegPath, args, {
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Timeout capturando snapshot da camera ${camera.name}`));
    }, config.snapshotTimeoutMs);

    child.stderr.on("data", (chunk) => {
      stderr.push(String(chunk));
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr.join("").trim() || `FFmpeg finalizou com codigo ${code}`));
    });
  });

  const stat = await fs.stat(filePath);
  if (stat.size <= 0) {
    throw new Error(`Snapshot vazio para camera ${camera.name}`);
  }

  return {
    filePath,
    capturedAt: new Date(),
    elapsedMs: Date.now() - startedAt,
  };
}
