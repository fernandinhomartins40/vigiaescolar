import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
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
  const streamUrl = camera.streamUrl
    .replaceAll("{username}", encodeURIComponent(camera.username ?? ""))
    .replaceAll("{password}", encodeURIComponent(camera.password ?? ""));

  if (!camera.username || !camera.password) {
    return streamUrl;
  }

  try {
    const url = new URL(streamUrl);
    if (url.username || url.password) {
      return streamUrl;
    }

    url.username = camera.username;
    url.password = camera.password;
    return url.toString();
  } catch {
    return streamUrl;
  }
}

/**
 * Resolve os argumentos FFmpeg para câmeras USB/dispositivo local.
 *
 * - Linux:   -f v4l2  -i /dev/video0  (ou o device configurado em CAMERA_USB_DEVICE)
 * - Windows: -f dshow -i video="<device_name>"
 * - macOS:   -f avfoundation -i "0"
 *
 * A URL armazenada no banco é "device://live" ou "device://<índice>".
 * O índice é extraído do path (device://0 → 0, device://live → 0).
 */
function buildUsbArgs(camera: GatewayCamera, filePath: string): string[] {
  const platform = os.platform();

  // Extrai índice/nome do dispositivo da streamUrl
  const rawDevice = camera.streamUrl.replace(/^device:\/\//, "").trim();
  const deviceIndex = rawDevice === "live" || rawDevice === "" ? "0" : rawDevice;

  // Permite override por variável de ambiente (ex: CAMERA_USB_DEVICE=/dev/video2)
  const envDevice = process.env.CAMERA_USB_DEVICE?.trim();

  if (platform === "win32") {
    // No Windows o deviceIndex pode ser um nome como "Integrated Camera"
    const winDevice = envDevice ?? (Number.isNaN(Number(deviceIndex)) ? deviceIndex : `video=${deviceIndex}`);
    return [
      "-hide_banner",
      "-loglevel", "error",
      "-f", "dshow",
      "-i", winDevice.startsWith("video=") ? winDevice : `video=${winDevice}`,
      "-frames:v", "1",
      "-q:v", "2",
      "-y", filePath,
    ];
  }

  if (platform === "darwin") {
    const macDevice = envDevice ?? deviceIndex;
    return [
      "-hide_banner",
      "-loglevel", "error",
      "-f", "avfoundation",
      "-i", `${macDevice}:none`,
      "-frames:v", "1",
      "-q:v", "2",
      "-y", filePath,
    ];
  }

  // Linux (padrão)
  const linuxDevice = envDevice ?? (deviceIndex.startsWith("/dev/") ? deviceIndex : `/dev/video${deviceIndex}`);
  return [
    "-hide_banner",
    "-loglevel", "error",
    "-f", "v4l2",
    "-input_format", "mjpeg",
    "-i", linuxDevice,
    "-frames:v", "1",
    "-q:v", "2",
    "-y", filePath,
  ];
}

function buildNetworkArgs(camera: GatewayCamera, filePath: string): string[] {
  const streamUrl = withCredentials(camera);
  // FFmpeg 8+ removeu `-stimeout`. O RTSP demuxer expõe `-timeout` em
  // microssegundos. Mantém o mesmo valor (snapshotTimeoutMs * 1000).
  // Verificado em produção via `ffmpeg -h demuxer=rtsp` (vps-gateway-01,
  // FFmpeg 8.0.1).
  const timeoutMicroseconds = String(Math.max(config.snapshotTimeoutMs, 1000) * 1000);
  return [
    "-hide_banner",
    "-loglevel", "error",
    "-rtsp_transport", "tcp",
    "-timeout", timeoutMicroseconds,
    "-i", streamUrl,
    "-frames:v", "1",
    "-q:v", "2",
    "-y", filePath,
  ];
}

export async function captureSnapshot(camera: GatewayCamera): Promise<SnapshotResult> {
  const startedAt = Date.now();
  const cameraDir = path.join(config.snapshotDir, safeSegment(camera.tenantId), safeSegment(camera.id));
  await fs.mkdir(cameraDir, { recursive: true });

  const filePath = path.join(cameraDir, `${Date.now()}.jpg`);

  const args = camera.type === "USB"
    ? buildUsbArgs(camera, filePath)
    : buildNetworkArgs(camera, filePath);

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
