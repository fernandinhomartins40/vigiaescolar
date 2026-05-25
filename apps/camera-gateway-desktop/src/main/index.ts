/**
 * Main process do gateway desktop VigiaEscolar.
 *
 * Responsabilidades:
 *  1. Mostrar tray icon (ícone perto do relógio do Windows)
 *  2. Abrir janela de configuração (pareamento + status)
 *  3. Rodar workers em background:
 *     - LAN scanner (DVRIP) para achar câmeras XM na rede
 *     - Relay continuo DVRIP -> RTMPS/MediaMTX por camera
 *  4. Auto-start no boot do Windows
 *  5. Auto-update via electron-updater
 */
import { app, BrowserWindow, Tray, Menu, Notification, ipcMain, nativeImage } from "electron";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { autoUpdater } from "electron-updater";
import { config, saveConfig } from "./config";
import { runDiscoveryLoop, stopDiscovery } from "./lanDiscovery";
import { runStreamRelay, stopStreamRelay } from "./streamRelay";
import { pairWithServer } from "./pairing";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let updateTimer: NodeJS.Timeout | null = null;
const startHidden = process.argv.includes("--hidden");
const appIconPath = join(__dirname, "..", "..", "build", "icon.png");

type UpdateStatus = {
  state: "idle" | "checking" | "available" | "ready" | "error";
  message: string;
  version?: string;
};

let updateStatus: UpdateStatus = {
  state: "idle",
  message: "Aplicativo atualizado",
};

function setUpdateStatus(status: UpdateStatus) {
  updateStatus = status;
  mainWindow?.webContents.send("status:changed");
  rebuildTrayMenu();
}

// ─── Janela principal ───────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 720,
    height: 560,
    minWidth: 640,
    minHeight: 480,
    title: "VigiaEscolar Gateway",
    icon: appIconPath,
    show: !startHidden,
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
  const trayIcon = nativeImage.createFromPath(appIconPath);
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
    {
      label: updateStatus.message,
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
    {
      label: updateStatus.state === "ready" ? "Reiniciar e atualizar" : "Verificar atualização",
      click: () => {
        if (updateStatus.state === "ready") {
          autoUpdater.quitAndInstall();
        } else {
          checkForUpdates();
        }
      },
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
    appVersion: app.getVersion(),
    gatewayId: c.gatewayId,
    gatewayName: c.gatewayName,
    schoolName: c.schoolName,
    apiBaseUrl: c.apiBaseUrl,
    lastDiscoveredCameras: c.lastDiscoveredCameras ?? [],
    lastSyncAt: c.lastSyncAt,
    update: updateStatus,
  };
});

ipcMain.handle("pair", async (_evt, code: string) => {
  try {
    const result = await pairWithServer(code);
    rebuildTrayMenu();
    // Inicia descoberta imediatamente após pareamento
    runDiscoveryLoop({ immediate: true });
    runStreamRelay();
    return { ok: true, ...result };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Erro desconhecido" };
  }
});

ipcMain.handle("unpair", () => {
  stopDiscovery();
  stopStreamRelay();
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

ipcMain.handle("updates:check", async () => {
  await checkForUpdates();
  return { ok: true };
});

// ─── Auto-launch + atualização ──────────────────────────────────────────────
function ensureAutoLaunch() {
  if (!app.isPackaged || process.platform !== "win32") return;
  try {
    app.setLoginItemSettings({
      openAtLogin: true,
      path: process.execPath,
      args: ["--hidden"],
    });
  } catch (e) {
    console.warn("[auto-launch] falha:", e);
  }
}

async function checkForUpdates() {
  if (!app.isPackaged || process.platform !== "win32") {
    setUpdateStatus({ state: "idle", message: "Atualizações disponíveis no instalador" });
    return;
  }

  setUpdateStatus({ state: "checking", message: "Verificando atualização..." });
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    setUpdateStatus({ state: "error", message: "Falha ao consultar atualizações" });
    console.warn("[update] falha ao consultar:", error);
  }
}

function configureAutoUpdate() {
  if (!app.isPackaged || process.platform !== "win32") return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("update-not-available", () => {
    setUpdateStatus({ state: "idle", message: "Aplicativo atualizado" });
  });
  autoUpdater.on("update-available", (info) => {
    setUpdateStatus({
      state: "available",
      message: `Baixando atualização v${info.version}...`,
      version: info.version,
    });
  });
  autoUpdater.on("update-downloaded", (info) => {
    setUpdateStatus({
      state: "ready",
      message: `Atualização v${info.version} pronta`,
      version: info.version,
    });
    if (Notification.isSupported()) {
      new Notification({
        title: "VigiaEscolar Gateway",
        body: "Atualização pronta. Reinicie pelo ícone perto do relógio para aplicar.",
        icon: appIconPath,
      }).show();
    }
  });
  autoUpdater.on("error", (error) => {
    setUpdateStatus({ state: "error", message: "Falha ao baixar atualização" });
    console.warn("[update] erro:", error);
  });

  checkForUpdates();
  updateTimer = setInterval(checkForUpdates, 6 * 60 * 60 * 1000);
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
    app.setAppUserModelId("br.com.vigiaescolar.gateway");
    createTray();
    createWindow();
    ensureAutoLaunch();
    configureAutoUpdate();

    // Se já está pareado, começa a trabalhar imediatamente
    if (config.get("gatewayToken")) {
      runDiscoveryLoop({ immediate: true });
      runStreamRelay();
    }
  });

  app.on("before-quit", () => {
    isQuitting = true;
    stopDiscovery();
    stopStreamRelay();
    if (updateTimer) clearInterval(updateTimer);
  });
}
