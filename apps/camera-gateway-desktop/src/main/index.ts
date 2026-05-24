/**
 * Main process do gateway desktop VigiaEscolar.
 *
 * Responsabilidades:
 *  1. Mostrar tray icon (ícone perto do relógio do Windows)
 *  2. Abrir janela de configuração (pareamento + status)
 *  3. Rodar workers em background:
 *     - LAN scanner (DVRIP) para achar câmeras XM na rede
 *     - Captura periódica de snapshot por câmera
 *     - Upload de frames para a API VigiaEscolar
 *  4. Auto-start no boot do Windows
 *  5. Auto-update via electron-updater
 */
import { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage } from "electron";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import AutoLaunch from "auto-launch";
import { config, saveConfig } from "./config";
import { runDiscoveryLoop, stopDiscovery } from "./lanDiscovery";
import { runCaptureLoop, stopCapture } from "./captureLoop";
import { pairWithServer } from "./pairing";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

// ─── Janela principal ───────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 720,
    height: 560,
    minWidth: 640,
    minHeight: 480,
    title: "VigiaEscolar Gateway",
    icon: join(__dirname, "..", "..", "build", "icon.png"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "..", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Em dev, vite-dev-server serve o renderer
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(join(__dirname, "..", "renderer", "index.html"));
  }

  // Minimizar pro tray ao invés de fechar (gateway precisa rodar 24/7)
  mainWindow.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ─── Tray icon ──────────────────────────────────────────────────────────────
function createTray() {
  const iconPath = join(__dirname, "..", "..", "build", "tray-icon.png");
  // Em dev/sem ícone real, usa placeholder transparente
  const trayIcon = nativeImage.createFromPath(iconPath);
  tray = new Tray(trayIcon.isEmpty() ? nativeImage.createEmpty() : trayIcon);
  tray.setToolTip("VigiaEscolar Gateway");

  rebuildTrayMenu();

  tray.on("double-click", () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function rebuildTrayMenu() {
  if (!tray) return;
  const paired = !!config.get("gatewayToken");
  const camerasCount = config.get("lastDiscoveredCameras")?.length ?? 0;
  const menu = Menu.buildFromTemplate([
    {
      label: paired
        ? `Pareado: ${config.get("gatewayName") || "Sem nome"}`
        : "Não pareado — abra a janela",
      enabled: false,
    },
    {
      label: paired ? `Câmeras detectadas: ${camerasCount}` : "Aguardando pareamento",
      enabled: false,
    },
    { type: "separator" },
    {
      label: "Abrir painel",
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: "Procurar câmeras agora",
      enabled: paired,
      click: () => runDiscoveryLoop({ immediate: true }),
    },
    { type: "separator" },
    {
      label: "Sair",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
}

// ─── IPC entre renderer e main ──────────────────────────────────────────────
ipcMain.handle("config:get", () => {
  // Não expõe gatewayToken por segurança — só status booleano
  const c = config.store;
  return {
    paired: !!c.gatewayToken,
    gatewayId: c.gatewayId,
    gatewayName: c.gatewayName,
    schoolName: c.schoolName,
    apiBaseUrl: c.apiBaseUrl,
    lastDiscoveredCameras: c.lastDiscoveredCameras ?? [],
    lastSyncAt: c.lastSyncAt,
  };
});

ipcMain.handle("pair", async (_evt, code: string) => {
  try {
    const result = await pairWithServer(code);
    rebuildTrayMenu();
    // Inicia descoberta imediatamente após pareamento
    runDiscoveryLoop({ immediate: true });
    runCaptureLoop();
    return { ok: true, ...result };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Erro desconhecido" };
  }
});

ipcMain.handle("unpair", () => {
  stopDiscovery();
  stopCapture();
  saveConfig({
    gatewayToken: undefined,
    gatewayId: undefined,
    gatewayName: undefined,
    schoolName: undefined,
    lastDiscoveredCameras: [],
  });
  rebuildTrayMenu();
  return { ok: true };
});

ipcMain.handle("discover-now", () => {
  runDiscoveryLoop({ immediate: true });
  return { ok: true };
});

// ─── Auto-launch (Windows: chave em HKCU\Run) ───────────────────────────────
const autoLauncher = new AutoLaunch({
  name: "VigiaEscolar Gateway",
  isHidden: true, // inicia minimizado para tray
});

async function ensureAutoLaunch() {
  try {
    const enabled = await autoLauncher.isEnabled();
    if (!enabled) await autoLauncher.enable();
  } catch (e) {
    console.warn("[auto-launch] falha (provavelmente roda em dev):", e);
  }
}

// ─── Single instance ────────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    createTray();
    createWindow();
    await ensureAutoLaunch();

    // Se já está pareado, começa a trabalhar imediatamente
    if (config.get("gatewayToken")) {
      runDiscoveryLoop({ immediate: true });
      runCaptureLoop();
    }
  });

  app.on("window-all-closed", (e: any) => {
    // Não sai no Windows/Linux quando todas as janelas fecham — fica no tray
    e?.preventDefault?.();
  });

  app.on("before-quit", () => {
    isQuitting = true;
    stopDiscovery();
    stopCapture();
  });
}
