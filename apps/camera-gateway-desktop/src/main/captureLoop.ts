/**
 * Captura periódica de snapshots das câmeras descobertas e envio para
 * o face-server da VPS via API VigiaEscolar (POST multipart).
 *
 * Cada câmera é processada em paralelo com limite de concorrência (3 por vez)
 * para não sobrecarregar a rede da escola. Falhas são logadas mas não param
 * o loop — a câmera que falhou pula esse ciclo e tenta no próximo.
 *
 * Heartbeat: a cada minuto pinga POST /api/gateways/heartbeat para o backend
 * saber que o gateway está vivo.
 */
import { config, type DiscoveredCamera } from "./config";
import { dvripSnapPicture } from "./dvrip";
import { apiRequest, getApiBase, getGatewayToken } from "./pairing";

const FRAME_INTERVAL_MS = 5_000;       // intervalo entre frames por câmera
const HEARTBEAT_INTERVAL_MS = 60_000;  // 1 min
const MAX_CONCURRENT = 3;              // câmeras em paralelo
const FRAME_TIMEOUT_MS = 10_000;       // timeout total por câmera

let captureTimer: NodeJS.Timeout | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
let inflight = new Set<string>();      // câmeras com captura em andamento

export function runCaptureLoop() {
  if (captureTimer) return;
  console.log("[capture] iniciando loop de captura");
  captureTimer = setInterval(tickCaptures, FRAME_INTERVAL_MS);
  heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
  // Heartbeat inicial pra avisar que o gateway está online
  sendHeartbeat();
}

export function stopCapture() {
  if (captureTimer) clearInterval(captureTimer);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  captureTimer = null;
  heartbeatTimer = null;
  inflight.clear();
}

async function tickCaptures() {
  const cams = config.get("lastDiscoveredCameras") ?? [];
  if (cams.length === 0) return;

  // Filtra câmeras que NÃO estão sendo capturadas neste momento
  // e respeita limite de concorrência
  const eligible = cams.filter((c) => !inflight.has(c.ip));
  const slotsLeft = MAX_CONCURRENT - inflight.size;
  if (slotsLeft <= 0) return;

  for (const cam of eligible.slice(0, slotsLeft)) {
    inflight.add(cam.ip);
    captureOne(cam)
      .catch((e) => console.warn(`[capture] ${cam.ip} falhou:`, (e as Error).message))
      .finally(() => inflight.delete(cam.ip));
  }
}

async function captureOne(cam: DiscoveredCamera): Promise<void> {
  const startedAt = Date.now();
  const cred = config.get("cameraCredentials")[cam.ip] ?? { user: "admin", pass: "" };

  // Timeout total
  const jpeg = await Promise.race([
    dvripSnapPicture(cam.ip, cred.user, cred.pass),
    new Promise<Buffer>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout ${FRAME_TIMEOUT_MS}ms`)), FRAME_TIMEOUT_MS),
    ),
  ]);

  if (!jpeg || jpeg.length < 100) {
    throw new Error(`JPEG vazio/inválido (${jpeg?.length ?? 0} bytes)`);
  }

  await uploadFrame(cam, jpeg, Date.now() - startedAt);
}

async function uploadFrame(cam: DiscoveredCamera, jpeg: Buffer, elapsedMs: number) {
  const token = getGatewayToken();
  if (!token) throw new Error("gateway sem token");
  const apiBase = getApiBase();

  // Envio simples: JPEG cru como octet-stream + metadados em query string.
  // Evita dependência de multer/multipart no backend.
  const params = new URLSearchParams({
    serialNumber: cam.serialNumber,
    cameraIp: cam.ip,
    capturedAt: String(Date.now()),
    elapsedMs: String(elapsedMs),
  });

  const res = await fetch(`${apiBase}/gateways/frame?${params}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "image/jpeg",
    },
    body: jpeg,
  });

  if (!res.ok) {
    throw new Error(`upload HTTP ${res.status}`);
  }
}

async function sendHeartbeat() {
  try {
    await apiRequest("/gateways/heartbeat", { method: "POST" });
  } catch (e) {
    console.warn("[heartbeat] falhou:", (e as Error).message);
  }
}
