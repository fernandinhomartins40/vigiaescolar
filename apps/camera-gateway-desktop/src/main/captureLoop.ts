/**
 * Captura periódica de snapshots/frames das câmeras descobertas e envio
 * para o face-server da VPS via API VigiaEscolar.
 *
 * Status atual: SKELETON. Próxima iteração:
 *  - Para cada câmera de lastDiscoveredCameras, abre OPMonitor DVRIP
 *  - Lê 1 frame a cada N segundos (config: frameIntervalMs)
 *  - Faz POST multipart para /api/internal/camera-gateway/frame
 *  - Mantém heartbeat /api/internal/camera-gateway/heartbeat
 */
import { config } from "./config";

let captureTimer: NodeJS.Timeout | null = null;
const CAPTURE_INTERVAL_MS = 5_000;

export function runCaptureLoop() {
  if (captureTimer) return;
  captureTimer = setInterval(() => {
    const cams = config.get("lastDiscoveredCameras") ?? [];
    if (cams.length === 0) return;
    // TODO: para cada câmera, capturar frame via DVRIP OPMonitor/OPSnapPicture
    // e enviar para /api/internal/camera-gateway/frame
    console.log(`[capture] tick — ${cams.length} câmeras (stub)`);
  }, CAPTURE_INTERVAL_MS);
}

export function stopCapture() {
  if (captureTimer) {
    clearInterval(captureTimer);
    captureTimer = null;
  }
}
