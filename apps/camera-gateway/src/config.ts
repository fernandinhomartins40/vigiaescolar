import os from "node:os";
import path from "node:path";

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function stringEnv(name: string, fallback = "") {
  return process.env[name]?.trim() || fallback;
}

export const config = {
  gatewayId: stringEnv("CAMERA_GATEWAY_ID", `${os.hostname()}-${process.pid}`),
  apiBaseUrl: stringEnv("VIGIA_API_URL", "http://localhost:3001/api").replace(/\/$/, ""),
  serviceToken: stringEnv("CAMERA_GATEWAY_SERVICE_TOKEN") || stringEnv("FACE_PLATFORM_SERVICE_TOKEN"),
  ffmpegPath: stringEnv("FFMPEG_PATH", "ffmpeg"),
  pollIntervalMs: numberEnv("CAMERA_GATEWAY_POLL_INTERVAL_MS", 30_000),
  frameIntervalMs: numberEnv("CAMERA_GATEWAY_FRAME_INTERVAL_MS", 5_000),
  snapshotDir: path.resolve(stringEnv("CAMERA_GATEWAY_SNAPSHOT_DIR", path.join(process.cwd(), "snapshots"))),
  snapshotTimeoutMs: numberEnv("CAMERA_GATEWAY_SNAPSHOT_TIMEOUT_MS", 15_000),
  maxConcurrentCaptures: numberEnv("CAMERA_GATEWAY_MAX_CONCURRENT_CAPTURES", 4),
  // true quando o gateway está instalado no mesmo dispositivo que possui câmeras USB.
  // Habilita captura via v4l2/dshow/avfoundation e expõe câmeras USB do banco.
  isLocal: process.env.CAMERA_GATEWAY_LOCAL === "true",
  // Dispositivo USB explícito (ex: /dev/video0, "Integrated Camera").
  // Se vazio, o gateway usa o índice extraído da streamUrl da câmera.
  usbDevice: stringEnv("CAMERA_USB_DEVICE"),

  // Modo MediaMTX: o gateway desktop da escola publica RTMPS para a VPS.
  // Quando preenchido, o gateway IGNORA a streamUrl gravada no banco
  // (que aponta para IP da câmera, inalcançável pela VPS) e usa
  // `${mediaServer}/live/<SerialNumber>` para puxar o stream republicado
  // pelo MediaMTX. Ex.: rtsp://mediamtx:8554
  mediaServer: stringEnv("CAMERA_GATEWAY_MEDIA_SERVER"),
  // Credenciais para autenticar como "read" no MediaMTX. Em deploy padrão
  // ambos containers ficam na rede docker interna, mas se MediaMTX exigir
  // auth, usamos estas. Senão fica vazio.
  mediaServerUser: stringEnv("CAMERA_GATEWAY_MEDIA_USER", "gateway"),
  mediaServerPass: stringEnv("CAMERA_GATEWAY_MEDIA_PASS"),
};

export function validateConfig() {
  if (!config.serviceToken) {
    throw new Error("CAMERA_GATEWAY_SERVICE_TOKEN ou FACE_PLATFORM_SERVICE_TOKEN precisa estar configurado.");
  }
}
