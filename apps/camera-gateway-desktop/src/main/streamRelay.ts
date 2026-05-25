/**
 * Relay continuo de video das cameras XM.
 *
 * go2rtc implementa o protocolo privado DVRIP/XMEye e publica o stream
 * continuamente por RTMPS para o MediaMTX na VPS. O backend e o navegador
 * passam a consumir o mesmo video ao vivo (RTSP/HLS), sem uploads de JPEG.
 */
import { app } from "electron";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { config, type DiscoveredCamera } from "./config";
import { apiRequest } from "./pairing";

const HEARTBEAT_INTERVAL_MS = 60_000;
const RESTART_DELAY_MS = 5_000;
const __dirname = fileURLToPath(new URL(".", import.meta.url));

let relay: ReturnType<typeof spawn> | null = null;
let relayFingerprint = "";
let heartbeatTimer: NodeJS.Timeout | null = null;
let restartTimer: NodeJS.Timeout | null = null;
let stopping = false;

function relayCameras() {
  return (config.get("lastDiscoveredCameras") ?? []).filter(
    (camera): camera is DiscoveredCamera & { publishUrl: string } => !!camera.publishUrl,
  );
}

function binaryPath() {
  if (app.isPackaged) {
    return join(process.resourcesPath, "tools", "go2rtc.exe");
  }

  return join(__dirname, "..", "..", "vendor", "go2rtc", "go2rtc.exe");
}

function localConfigPath() {
  return join(app.getPath("userData"), "go2rtc.json");
}

function safeKey(camera: DiscoveredCamera) {
  return (camera.streamKey || camera.serialNumber).replace(/[^A-Za-z0-9_-]/g, "");
}

function dvripUrl(camera: DiscoveredCamera) {
  const credentials = config.get("cameraCredentials")[camera.ip] ?? { user: "admin", pass: "" };
  const user = encodeURIComponent(credentials.user || "admin");
  const pass = encodeURIComponent(credentials.pass || "");
  return `dvrip://${user}:${pass}@${camera.ip}:34567?channel=0&subtype=0`;
}

function createGo2rtcConfig(cameras: Array<DiscoveredCamera & { publishUrl: string }>) {
  const streams: Record<string, string> = {};
  const publish: Record<string, string[]> = {};
  const preload: Record<string, string> = {};

  for (const camera of cameras) {
    const key = `live_${safeKey(camera)}`;
    streams[key] = dvripUrl(camera);
    publish[key] = [camera.publishUrl];
    preload[key] = "video";
  }

  return {
    api: { listen: "127.0.0.1:1984" },
    rtsp: { listen: "127.0.0.1:8554" },
    webrtc: { listen: "" },
    streams,
    publish,
    preload,
  };
}

function hashConfig(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function terminateRelay() {
  if (!relay) return;
  relay.removeAllListeners();
  relay.kill();
  relay = null;
}

async function launchRelay() {
  const cameras = relayCameras();
  if (cameras.length === 0) {
    relayFingerprint = "";
    terminateRelay();
    return;
  }

  const executable = binaryPath();
  if (!fs.existsSync(executable)) {
    console.error(`[stream] go2rtc nao encontrado em ${executable}. Reinstale o gateway atualizado.`);
    return;
  }

  const go2rtcConfig = createGo2rtcConfig(cameras);
  const nextFingerprint = hashConfig(go2rtcConfig);
  if (relay && nextFingerprint === relayFingerprint) return;

  relayFingerprint = nextFingerprint;
  terminateRelay();
  await writeFile(localConfigPath(), JSON.stringify(go2rtcConfig, null, 2), "utf8");

  console.log(`[stream] iniciando relay ao vivo para ${cameras.length} camera(s)`);
  const child = spawn(executable, ["-c", localConfigPath()], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  relay = child;
  child.stdout.on("data", (chunk) => console.log(`[go2rtc] ${String(chunk).trim()}`));
  child.stderr.on("data", (chunk) => console.warn(`[go2rtc] ${String(chunk).trim()}`));
  child.on("error", (error) => console.error("[stream] falha ao iniciar go2rtc:", error));
  child.on("close", (code) => {
    relay = null;
    if (stopping) return;
    console.warn(`[stream] relay encerrado (codigo=${code}); reiniciando.`);
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = setTimeout(() => void launchRelay(), RESTART_DELAY_MS);
  });
}

async function sendHeartbeat() {
  try {
    await apiRequest("/gateways/heartbeat", { method: "POST" });
  } catch (error) {
    console.warn("[heartbeat] falhou:", (error as Error).message);
  }
}

export function runStreamRelay() {
  stopping = false;
  if (!heartbeatTimer) {
    heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
    void sendHeartbeat();
  }
  void launchRelay();
}

export function syncStreamRelays() {
  if (!config.get("gatewayToken")) return;
  runStreamRelay();
}

export function stopStreamRelay() {
  stopping = true;
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (restartTimer) clearTimeout(restartTimer);
  heartbeatTimer = null;
  restartTimer = null;
  relayFingerprint = "";
  terminateRelay();
}
