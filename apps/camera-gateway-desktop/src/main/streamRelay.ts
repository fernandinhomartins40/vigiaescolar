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
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { config, type DiscoveredCamera } from "./config";
import { apiRequest } from "./pairing";

const HEARTBEAT_INTERVAL_MS = 60_000;
const RESTART_DELAY_MS = 5_000;
const GO2RTC_API = "http://127.0.0.1:1984";
const __dirname = fileURLToPath(new URL(".", import.meta.url));

let relay: ReturnType<typeof spawn> | null = null;
let relayFingerprint = "";
let heartbeatTimer: NodeJS.Timeout | null = null;
let restartTimer: NodeJS.Timeout | null = null;
let stopping = false;

type LogLevel = "info" | "warn" | "error";
type LogEntry = { ts: number; level: LogLevel; msg: string };
const logBuffer: LogEntry[] = [];
const MAX_LOG = 400;

export function appendLog(level: LogLevel, msg: string) {
  const entry: LogEntry = { ts: Date.now(), level, msg };
  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOG) logBuffer.shift();
  if (level === "error") console.error(`[stream] ${msg}`);
  else if (level === "warn") console.warn(`[stream] ${msg}`);
  else console.log(`[stream] ${msg}`);
}

export function getLogs(): LogEntry[] {
  return [...logBuffer];
}

function relayCameras() {
  return (config.get("lastDiscoveredCameras") ?? []).filter((camera) => !!(camera.streamKey || camera.serialNumber));
}

// go2rtc quebra caminhos com espaços (ex: "C:\Program Files\...") ao invocar ffmpeg.
// Copiamos os binários para userData (normalmente sem espaços) em tempo de execução.
function toolsCacheDir() {
  return join(app.getPath("userData"), "tools");
}

function binaryPath() {
  if (app.isPackaged) {
    return join(toolsCacheDir(), "go2rtc.exe");
  }
  return join(__dirname, "..", "..", "vendor", "go2rtc", "go2rtc.exe");
}

function ffmpegPath() {
  if (app.isPackaged) {
    return join(toolsCacheDir(), "ffmpeg.exe");
  }
  return join(__dirname, "..", "..", "vendor", "ffmpeg", "ffmpeg.exe");
}

async function ensureToolsCache() {
  if (!app.isPackaged) return;
  const cacheDir = toolsCacheDir();
  await mkdir(cacheDir, { recursive: true });
  const srcDir = join(process.resourcesPath, "tools");
  for (const name of ["go2rtc.exe", "ffmpeg.exe"]) {
    const src = join(srcDir, name);
    const dst = join(cacheDir, name);
    if (!fs.existsSync(src)) continue;
    // Só copia se não existe ou tamanho diferente (evita cópia a cada boot)
    const srcStat = fs.statSync(src);
    const dstStat = fs.existsSync(dst) ? fs.statSync(dst) : null;
    if (!dstStat || dstStat.size !== srcStat.size) {
      await copyFile(src, dst);
      appendLog("info", `ferramenta copiada para cache sem espaços: ${name}`);
    }
  }
}

function localConfigPath() {
  return join(app.getPath("userData"), "go2rtc.json");
}

export function safeKey(camera: Pick<DiscoveredCamera, "streamKey" | "serialNumber">) {
  return (camera.streamKey || camera.serialNumber).replace(/[^A-Za-z0-9_-]/g, "");
}

export function localHlsUrl(camera: Pick<DiscoveredCamera, "streamKey" | "serialNumber">) {
  const key = `live_${safeKey(camera)}`;
  // go2rtc v1.9+: endpoint HLS correto é /stream.m3u8 (não /api/stream.m3u8)
  return `${GO2RTC_API}/stream.m3u8?src=${encodeURIComponent(key)}`;
}

export async function probeStreamReady(camera: Pick<DiscoveredCamera, "streamKey" | "serialNumber">): Promise<boolean> {
  const key = `live_${safeKey(camera)}`;
  try {
    const res = await fetch(`${GO2RTC_API}/api/streams`);
    if (!res.ok) return false;
    const data = await res.json() as Record<string, unknown>;
    return key in data;
  } catch {
    return false;
  }
}

function dvripUrl(camera: DiscoveredCamera) {
  const credentials = config.get("cameraCredentials")[camera.ip] ?? { user: "admin", pass: "" };
  const user = encodeURIComponent(credentials.user || "admin");
  const pass = encodeURIComponent(credentials.pass || "");
  return `dvrip://${user}:${pass}@${camera.ip}:34567?channel=0&subtype=0`;
}

function createGo2rtcConfig(cameras: DiscoveredCamera[]) {
  const streams: Record<string, string[]> = {};
  const publish: Record<string, string[]> = {};
  const preload: Record<string, string> = {};
  const remoteRelayEnabled = config.get("remoteRelayEnabled");

  for (const camera of cameras) {
    const key = `live_${safeKey(camera)}`;
    // Fluxo primário: DVRIP direto.
    // Fallback ffmpeg: transcodifica para H.264 se câmera usar H.265 (codec 82).
    // HLS só suporta H.264/H.265 com fMP4; usamos H.264 para máxima compatibilidade.
    streams[key] = [
      dvripUrl(camera),
      `ffmpeg:${key}#video=h264#audio=aac`,
    ];
    if (remoteRelayEnabled && camera.publishUrl) {
      publish[key] = [camera.publishUrl];
    }
  }

  return {
    api: { listen: "127.0.0.1:1984", origin: "*" },
    rtsp: { listen: "127.0.0.1:8554" },
    webrtc: { listen: "" },
    hls: { listen: "" },
    ffmpeg: { bin: ffmpegPath() },
    streams,
    ...(Object.keys(publish).length ? { publish } : {}),
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

  await ensureToolsCache();

  const executable = binaryPath();
  if (!fs.existsSync(executable)) {
    appendLog("error", `go2rtc nao encontrado em ${executable}. Reinstale o gateway.`);
    return;
  }
  if (!fs.existsSync(ffmpegPath())) {
    appendLog("warn", `FFmpeg nao encontrado em ${ffmpegPath()}; cameras H265 nao poderao ser transcodificadas.`);
  } else {
    appendLog("info", `FFmpeg: ${ffmpegPath()}`);
  }

  const go2rtcConfig = createGo2rtcConfig(cameras);
  const nextFingerprint = hashConfig(go2rtcConfig);
  if (relay && nextFingerprint === relayFingerprint) return;

  relayFingerprint = nextFingerprint;
  terminateRelay();
  await writeFile(localConfigPath(), JSON.stringify(go2rtcConfig, null, 2), "utf8");

  appendLog("info", `iniciando relay ao vivo para ${cameras.length} camera(s)`);
  const child = spawn(executable, ["-c", localConfigPath()], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  relay = child;
  child.stdout.on("data", (chunk) => {
    for (const line of String(chunk).split("\n").map((l) => l.trim()).filter(Boolean)) {
      appendLog("info", `[go2rtc] ${line}`);
    }
  });
  child.stderr.on("data", (chunk) => {
    for (const line of String(chunk).split("\n").map((l) => l.trim()).filter(Boolean)) {
      appendLog("warn", `[go2rtc] ${line}`);
    }
  });
  child.on("error", (error) => appendLog("error", `falha ao iniciar go2rtc: ${(error as Error).message}`));
  child.on("close", (code) => {
    relay = null;
    if (stopping) return;
    appendLog("warn", `relay encerrado (codigo=${code}); reiniciando em ${RESTART_DELAY_MS / 1000}s`);
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = setTimeout(() => void launchRelay(), RESTART_DELAY_MS);
  });
}

async function sendHeartbeat() {
  try {
    await apiRequest("/gateways/heartbeat", {
      method: "POST",
      body: JSON.stringify({
        appVersion: app.getVersion(),
        streamRelay: {
          configuredCameras: relayCameras().length,
          running: !!relay,
        },
      }),
    });
  } catch (error) {
    console.warn("[heartbeat] falhou:", (error as Error).message);
  }
}

export function isRelayRunning() {
  return relay !== null;
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
