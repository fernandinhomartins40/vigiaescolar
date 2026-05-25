/**
 * Varredura da LAN local para encontrar câmeras XM via DVRIP (porta 34567).
 *
 * Estratégia:
 *  1. Lista IPs do range /24 de cada interface de rede local
 *  2. Tenta TCP connect em :34567 com timeout 500ms (paralelo, batches de 32)
 *  3. Para cada IP que responde, faz login DVRIP anônimo + GetSystemInfo
 *  4. Coleta SerialNumber, MAC, modelo
 *  5. Envia lista para API VigiaEscolar (cameras dessa escola)
 */
import os from "node:os";
import { createConnection } from "node:net";
import { config, saveConfig, type DiscoveredCamera } from "./config";
import { dvripGetSystemInfo } from "./dvrip";
import { apiRequest } from "./pairing";
import { syncStreamRelays } from "./streamRelay";
import { syncEdgeData } from "./edgeSync";

const DVRIP_PORT = 34567;
const TCP_TIMEOUT_MS = 500;
const SCAN_BATCH_SIZE = 32;
const SCAN_INTERVAL_MS = 5 * 60 * 1000; // a cada 5 min

let discoveryTimer: NodeJS.Timeout | null = null;
let scanning = false;

function localSubnets(): string[] {
  const subnets: string[] = [];
  const ifaces = os.networkInterfaces();
  for (const list of Object.values(ifaces)) {
    if (!list) continue;
    for (const item of list) {
      if (item.family !== "IPv4" || item.internal) continue;
      const parts = item.address.split(".");
      if (parts.length !== 4) continue;
      // Só ranges privados
      if (!/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(item.address)) continue;
      subnets.push(`${parts[0]}.${parts[1]}.${parts[2]}.`);
    }
  }
  return Array.from(new Set(subnets));
}

function probePort(ip: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = createConnection({ host: ip, port });
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      try {
        sock.destroy();
      } catch {
        /* ignore */
      }
      resolve(ok);
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => finish(true));
    sock.once("timeout", () => finish(false));
    sock.once("error", () => finish(false));
  });
}

async function scanSubnet(prefix: string): Promise<string[]> {
  const allIps = Array.from({ length: 254 }, (_, i) => `${prefix}${i + 1}`);
  const hits: string[] = [];
  for (let i = 0; i < allIps.length; i += SCAN_BATCH_SIZE) {
    const batch = allIps.slice(i, i + SCAN_BATCH_SIZE);
    const results = await Promise.all(batch.map((ip) => probePort(ip, DVRIP_PORT, TCP_TIMEOUT_MS)));
    results.forEach((open, j) => {
      if (open) hits.push(batch[j]);
    });
  }
  return hits;
}

async function inspectCamera(ip: string): Promise<DiscoveredCamera | null> {
  // Tenta com credenciais conhecidas localmente, depois senha vazia
  const cred = config.get("cameraCredentials")[ip] ?? { user: "admin", pass: "" };
  try {
    const info = await dvripGetSystemInfo(ip, cred.user, cred.pass);
    if (info.Ret !== 100 || !info.SystemInfo) return null;
    const sys = info.SystemInfo;
    // MAC vem em NetCommon — não é crítico aqui; deixa pra outro round se quiser
    return {
      ip,
      serialNumber: String(sys.SerialNo ?? ""),
      deviceModel: String(sys.DeviceModel ?? ""),
      hardware: String(sys.HardWare ?? ""),
      mac: "",
      lastSeenAt: Date.now(),
    };
  } catch (e) {
    console.warn(`[discovery] ${ip} login falhou:`, (e as Error).message);
    return null;
  }
}

async function runScanOnce(): Promise<DiscoveredCamera[]> {
  if (scanning) return [];
  scanning = true;
  try {
    const subnets = localSubnets();
    console.log(`[discovery] varrendo subnets:`, subnets);
    const allHits: string[] = [];
    for (const prefix of subnets) {
      const hits = await scanSubnet(prefix);
      allHits.push(...hits);
    }
    console.log(`[discovery] IPs com DVRIP aberto:`, allHits);

    const cameras: DiscoveredCamera[] = [];
    for (const ip of allHits) {
      const cam = await inspectCamera(ip);
      if (cam && cam.serialNumber) cameras.push(cam);
    }

    const registered = await uploadToServer(cameras).catch((e) => {
      console.warn(`[discovery] upload p/ API falhou:`, e.message);
      return cameras;
    });
    saveConfig({ lastDiscoveredCameras: registered, lastSyncAt: Date.now() });
    syncStreamRelays();
    void syncEdgeData();

    return registered;
  } finally {
    scanning = false;
  }
}

async function uploadToServer(cameras: DiscoveredCamera[]): Promise<DiscoveredCamera[]> {
  if (cameras.length === 0) return [];
  const response = await apiRequest<{
    registered: Array<{
      serialNumber: string;
      cameraId: string;
      streamKey: string;
      liveUrl: string;
      publishUrl: string | null;
    }>;
  }>("/gateways/cameras/discovered", {
    method: "POST",
    body: JSON.stringify({
      cameras: cameras.map((c) => ({
        ip: c.ip,
        serialNumber: c.serialNumber,
        deviceModel: c.deviceModel,
        hardware: c.hardware,
        mac: c.mac,
      })),
    }),
  });

  const bySerial = new Map(response.registered.map((camera) => [camera.serialNumber, camera]));
  return cameras.map((camera) => {
    const registered = bySerial.get(camera.serialNumber);
    return registered?.publishUrl
      ? { ...camera, ...registered, publishUrl: registered.publishUrl }
      : camera;
  });
}

export function runDiscoveryLoop(opts: { immediate?: boolean } = {}) {
  if (discoveryTimer) clearTimeout(discoveryTimer);
  const schedule = () => {
    discoveryTimer = setTimeout(async () => {
      await runScanOnce().catch((e) => console.error("[discovery] erro:", e));
      schedule();
    }, SCAN_INTERVAL_MS);
  };
  if (opts.immediate) {
    runScanOnce().catch((e) => console.error("[discovery] erro:", e));
  }
  schedule();
}

export function stopDiscovery() {
  if (discoveryTimer) {
    clearTimeout(discoveryTimer);
    discoveryTimer = null;
  }
}
