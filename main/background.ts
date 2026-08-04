import path from "path";
import fs from "node:fs";
import { app, nativeTheme, dialog, globalShortcut, protocol, session, shell, Menu, nativeImage, Tray } from "electron";
import serve from "electron-serve";
import { createWindow } from "./helpers";
import { autoUpdater } from "electron-updater";
import { registerIpcHandlers } from "./ipc";
import { getBootstrapState, migrateLegacyCredentials } from "./services/config-vault";
import { prunePreviewGrants, registerPreviewProtocol } from "./services/preview-service";
import { transferManager } from "./services/transfer-manager";
import { IPC_CHANNELS } from "../shared/contracts";
import { syncManager } from "./services/sync-manager";
import { backupManager } from "./services/backup-manager";
import { quickUploadClipboard, quickUploadFiles } from "./services/quick-upload";
import { eventRefreshManager } from "./services/event-refresh";
import { handleR2UploaderUrl } from "./services/protocol-handler";

const isProd = process.env.NODE_ENV === "production";
const pendingProtocolUrls: string[] = process.argv.filter((argument) => argument.startsWith("r2uploader://"));
let mainWindow: Electron.BrowserWindow | undefined;
const nativeText = (english: string, chinese: string) => {
  try { return getBootstrapState().preferences.locale === "zh-CN" ? chinese : english; }
  catch { return english; }
};

if (isProd) app.setAsDefaultProtocolClient("r2uploader");
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
app.on("second-instance", (_event, argv) => {
  const url = argv.find((argument) => argument.startsWith("r2uploader://"));
  if (mainWindow) { mainWindow.show(); mainWindow.focus(); if (url) void handleR2UploaderUrl(url, mainWindow).catch((error) => dialog.showErrorBox(nativeText("External upload request", "外部上传请求"), error instanceof Error ? error.message : String(error))); }
  else if (url) pendingProtocolUrls.push(url);
});
app.on("open-url", (event, url) => {
  event.preventDefault();
  if (mainWindow) void handleR2UploaderUrl(url, mainWindow).catch((error) => dialog.showErrorBox(nativeText("External upload request", "外部上传请求"), error instanceof Error ? error.message : String(error)));
  else pendingProtocolUrls.push(url);
});

protocol.registerSchemesAsPrivileged([
  {
    scheme: "r2preview",
    privileges: { secure: true, standard: true, supportFetchAPI: true, stream: true },
  },
]);

if (isProd) {
  serve({ directory: "app" });
} else {
  app.setPath("userData", `${app.getPath("userData")} (development)`);
}

function configureAutoUpdater(mainWindow: Electron.BrowserWindow) {
  if (!isProd || !fs.existsSync(path.join(process.resourcesPath, "app-update.yml"))) {
    mainWindow.webContents.send(IPC_CHANNELS.updateStatus, {
      state: "current",
      message: nativeText("Update checks are unavailable in this local test build.", "本地测试包不提供更新检查。"),
    });
    return;
  }

  // error
  autoUpdater.on('error', (err) => {
    mainWindow.webContents.send(IPC_CHANNELS.updateStatus, { state: "error", message: err.message });
    dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: nativeText('Update failed', '更新失败'),
      message: nativeText('R2Uploader could not complete the update check.', 'R2Uploader 无法完成更新检查。'),
      detail: err.message,
      buttons: [nativeText('Retry', '重试'), nativeText('Open downloads', '打开下载页'), nativeText('Cancel', '取消')],
      defaultId: 0,
      cancelId: 2,
    }).then((result) => {
      if (result.response === 0) void autoUpdater.checkForUpdates();
      if (result.response === 1) void shell.openExternal('https://github.com/maoxiaoke/r2Uploader/releases/latest');
    });
  });

  // update available
  autoUpdater.on('checking-for-update', () => {
    mainWindow.webContents.send(IPC_CHANNELS.updateStatus, { state: "checking" });
  });

  autoUpdater.on('update-not-available', (info) => {
    mainWindow.webContents.send(IPC_CHANNELS.updateStatus, { state: "current", version: info.version });
  });

  autoUpdater.on('update-available', (info) => {
    mainWindow.webContents.send(IPC_CHANNELS.updateStatus, { state: "available", version: info.version });
    dialog.showMessageBox({
      type: 'info',
      title: nativeText('Update Available', '有可用更新'),
      message: nativeText('A new version is available. Do you want to update now?', '发现新版本，现在更新吗？'),
      buttons: [nativeText('Yes', '是'), nativeText('No', '否')]
    }).then((result) => {
      if (result.response === 0) {
        autoUpdater.downloadUpdate();
      }
    });
  });

  // download progress
  autoUpdater.on('download-progress', (progressObj) => {
    mainWindow.webContents.send(IPC_CHANNELS.updateStatus, { state: "downloading", percent: progressObj.percent });
  });

  // update downloaded
  autoUpdater.on('update-downloaded', (info) => {
    mainWindow.webContents.send(IPC_CHANNELS.updateStatus, { state: "ready", version: info.version, percent: 100 });
    dialog.showMessageBox({
      title: nativeText('Install Update', '安装更新'),
      message: nativeText('The update has been downloaded. The application will restart and install the update.', '更新已下载，应用将重启并安装更新。')
    }).then(() => {
      autoUpdater.quitAndInstall();
    });
  });

  autoUpdater.checkForUpdates();
}

function registerShortcuts(mainWindow: Electron.BrowserWindow) {
  globalShortcut.register('CommandOrControl+Shift+X', () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
    }
  });
  globalShortcut.register('CommandOrControl+Shift+U', () => {
    void quickUploadClipboard().catch((error) => dialog.showMessageBox({ type: 'warning', title: nativeText('Quick Upload', '快速上传'), message: error instanceof Error ? error.message : String(error), buttons: [nativeText('Open settings', '打开设置'), nativeText('Cancel', '取消')] }).then((result) => { if (result.response === 0) { mainWindow.show(); mainWindow.focus(); } }));
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (!isProd && (input.control || input.meta) && input.shift && input.key === 'i') {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });
}

let tray: Tray | undefined;
function createTray(mainWindow: Electron.BrowserWindow) {
  const iconName = process.platform === "win32" ? "icon.ico" : process.platform === "darwin" ? "icon.icns" : "icon.svg";
  const iconPath = isProd ? path.join(process.resourcesPath, iconName) : path.join(process.cwd(), "resources", iconName);
  const image = nativeImage.createFromPath(iconPath);
  tray = new Tray(image.resize({ width: 18, height: 18 }));
  tray.setToolTip("R2Uploader");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: nativeText("Upload clipboard image & copy link", "上传剪贴板图片并复制链接"), accelerator: "CommandOrControl+Shift+U", click: () => void quickUploadClipboard().catch((error) => dialog.showErrorBox(nativeText("Quick Upload", "快速上传"), error instanceof Error ? error.message : String(error))) },
    { label: nativeText("Choose files for Quick Upload…", "选择文件进行快速上传…"), click: () => void quickUploadFiles().catch((error) => dialog.showErrorBox(nativeText("Quick Upload", "快速上传"), error instanceof Error ? error.message : String(error))) },
    { type: "separator" },
    { label: nativeText("Show R2Uploader", "显示 R2Uploader"), click: () => { mainWindow.show(); mainWindow.focus(); } },
    { label: nativeText("Quit", "退出"), role: "quit" },
  ]));
  tray.on("double-click", () => { mainWindow.show(); mainWindow.focus(); });
}

(async () => {
  await app.whenReady();

  migrateLegacyCredentials();
  registerIpcHandlers();
  registerPreviewProtocol();
  transferManager.initialize(getBootstrapState().preferences.transferConcurrency);
  syncManager.initialize();
  backupManager.initialize();
  eventRefreshManager.initialize();
  setInterval(prunePreviewGrants, 60_000).unref();

  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const scriptPolicy = isProd ? "script-src 'self'" : "script-src 'self' 'unsafe-eval' 'unsafe-inline'";
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          `default-src 'self'; ${scriptPolicy}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: r2preview:; media-src 'self' blob: r2preview:; connect-src 'self' r2preview:; font-src 'self' data:; frame-src r2preview:; object-src 'none'; base-uri 'none'; form-action 'self'`,
        ],
      },
    });
  });

  mainWindow = createWindow("main", {
    width: 1000,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
    frame: false,
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 18, y: 16 },
    transparent: process.platform === "darwin",
    vibrancy: "sidebar",
    titleBarOverlay: {
      color: "#00000000",
      symbolColor: nativeTheme.shouldUseDarkColors ? "white" : "black",
      height: 50,
    },
  });

  registerShortcuts(mainWindow);
  createTray(mainWindow);

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const current = new URL(mainWindow.webContents.getURL());
    const target = new URL(url);
    if (target.origin !== current.origin) event.preventDefault();
  });
  mainWindow.webContents.on("will-attach-webview", (event) => event.preventDefault());

  if (isProd) {
    await mainWindow.loadURL("app://./home");
  } else {
    const port = process.argv[2];
    await mainWindow.loadURL(`http://localhost:${port}/home`);
    mainWindow.webContents.openDevTools();
  }

  configureAutoUpdater(mainWindow);
  for (const url of pendingProtocolUrls.splice(0)) void handleR2UploaderUrl(url, mainWindow).catch((error) => dialog.showErrorBox(nativeText("External upload request", "外部上传请求"), error instanceof Error ? error.message : String(error)));
})();

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  // 对于 macOS，通常用户期望应用保持活动状态直到用户明确通过 Cmd + Q 退出
  if (process.platform !== "darwin") {
    app.quit();
  }
});
