/**
 * Relay de vídeo ao vivo via go2rtc.
 *
 * Câmeras XM com H.265 no stream principal (subtype=0) sempre têm substream
 * H.264 (subtype=1) — resolução menor (~640x360) mas sem FFmpeg.
 * go2rtc serve HLS via /api/stream.m3u8 sem dependência de transcodificação.
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
  if (level === "error") console.error(`[relay] ${msg}`);
  else if (level === "warn") console.warn(`[relay] ${msg}`);
  else console.log(`[relay] ${msg}`);
}

export function getLogs(): LogEntry[] {
  return [...logBuffer];
}

// ── Paths ────────────────────────────────────────────────────────────────────

function toolsCacheDir() {
  // userData nunca tem espaços (ex: C:\Users\user\AppData\Roaming\...)
  // go2rtc quebra caminhos com espaços ao invocar FFmpeg
  return join(app.getPath("userData"), "tools");
}

function binaryPath() {
  if (app.isPackaged) return join(toolsCacheDir(), "go2rtc.exe");
  return join(__dirname, "..", "..", "vendor", "go2rtc", "go2rtc.exe");
}

function localConfigPath() {
  return join(app.getPath("userData"), "go2rtc.json");
}

export async function ensureToolsCache() {
  if (!app.isPackaged) return;
  const cacheDir = toolsCacheDir();
  await mkdir(cacheDir, { recursive: true });
  const srcDir = join(process.resourcesPath, "tools");
  for (const name of ["go2rtc.exe"]) {
    const src = join(srcDir, name);
    const dst = join(cacheDir, name);
    if (!fs.existsSync(src)) continue;
    const srcSize = fs.statSync(src).size;
    const dstSize = fs.existsSync(dst) ? fs.statSync(dst).size : -1;
    if (srcSize !== dstSize) {
      await copyFile(src, dst);
      appendLog("info", `copiado ${name} para cache (sem espaços no path)`);
    }
  }
}

// ── Configuração go2rtc ──────────────────────────────────────────────────────

export function safeKey(camera: Pick<DiscoveredCamera, "streamKey" | "serialNumber">) {
  return (camera.streamKey || camera.serialNumber).replace(/[^A-Za-z0-9_-]/g, "");
}

export function localHlsUrl(camera: Pick<DiscoveredCamera, "streamKey" | "serialNumber">) {
  const key = `live_${safeKey(camera)}`;
  return `${GO2RTC_API}/api/stream.m3u8?src=${encodeURIComponent(key)}`;
}

function dvripUrl(camera: DiscoveredCamera) {
  const cred = config.get("cameraCredentials")[camera.ip] ?? { user: "admin", pass: "" };
  const user = encodeURIComponent(cred.user || "admin");
  const pass = encodeURIComponent(cred.pass || "");
  // subtype=1 = substream H.264 (câmeras XM com main stream H.265 sempre têm isso)
  // subtype=0 = main stream H.265 — evitado para não depender de FFmpeg
  return `dvrip://${user}:${pass}@${camera.ip}:34567?channel=0&subtype=1`;
}

function relayCameras() {
  return (config.get("lastDiscoveredCameras") ?? []).filter(
    (c) => !!(c.streamKey || c.serialNumber),
  );
}

function createGo2rtcConfig(cameras: DiscoveredCamera[]) {
  const streams: Record<string, string | string[]> = {};
  const preload: Record<string, string[]> = {};

  for (const cam of cameras) {
    const key = `live_${safeKey(cam)}`;
    // Só DVRIP substream — sem FFmpeg, sem transcodificação
    streams[key] = dvripUrl(cam);
    // preload: conecta imediatamente sem esperar primeiro consumer
    preload[key] = [];
  }

  return {
    api: { listen: "127.0.0.1:1984", origin: "*" },
    rtsp: { listen: "127.0.0.1:8554" },
    streams,
    preload,
  };
}

// ── go2rtc process ───────────────────────────────────────────────────────────

function hashConfig(v: unknown) {
  return createHash("sha256").update(JSON.stringify(v)).digest("hex");
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
    appendLog("error", `go2rtc não encontrado em ${executable}`);
    return;
  }

  const cfg = createGo2rtcConfig(cameras);
  const fingerprint = hashConfig(cfg);
  if (relay && fingerprint === relayFingerprint) return;

  relayFingerprint = fingerprint;
  terminateRelay();
  await writeFile(localConfigPath(), JSON.stringify(cfg, null, 2), "utf8");
  appendLog("info", `iniciando go2rtc para ${cameras.length} câmera(s) — substream H.264, sem FFmpeg`);

  const child = spawn(executable, ["-c", localConfigPath()], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  relay = child;

  child.stdout.on("data", (chunk: Buffer) => {
    for (const line of String(chunk).split("\n").map((l) => l.trim()).filter(Boolean)) {
      appendLog("info", `[go2rtc] ${line}`);
    }
  });
  child.stderr.on("data", (chunk: Buffer) => {
    for (const line of String(chunk).split("\n").map((l) => l.trim()).filter(Boolean)) {
      appendLog("warn", `[go2rtc] ${line}`);
    }
  });
  child.on("error", (err: Error) => appendLog("error", `go2rtc falhou ao iniciar: ${err.message}`));
  child.on("close", (code: number) => {
    relay = null;
    if (stopping) return;
    appendLog("warn", `go2rtc encerrou (código=${code}), reiniciando em ${RESTART_DELAY_MS / 1000}s`);
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = setTimeout(() => void launchRelay(), RESTART_DELAY_MS);
  });
}

// ── Heartbeat ────────────────────────────────────────────────────────────────

async function sendHeartbeat() {
  try {
    await apiRequest("/gateways/heartbeat", {
      method: "POST",
      body: JSON.stringify({
        appVersion: app.getVersion(),
        streamRelay: { configuredCameras: relayCameras().length, running: !!relay },
      }),
    });
  } catch (err) {
    appendLog("warn", `heartbeat falhou: ${(err as Error).message}`);
  }
}

// ── API pública ──────────────────────────────────────────────────────────────

export function isRelayRunning() {
  return relay !== null;
}

export async function probeStreamReady(
  camera: Pick<DiscoveredCamera, "serialNumber" | "streamKey">,
): Promise<boolean> {
  const key = `live_${safeKey(camera)}`;
  try {
    const res = await fetch(`${GO2RTC_API}/api/streams`);
    if (!res.ok) return false;
    const data = (await res.json()) as Record<string, { producers?: unknown[] }>;
    return (data[key]?.producers?.length ?? 0) > 0;
  } catch {
    return false;
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
