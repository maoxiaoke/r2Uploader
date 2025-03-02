import path from "path";
import { app, ipcMain, nativeTheme, dialog } from "electron";
import serve from "electron-serve";
import { createWindow } from "./helpers";
import { autoUpdater } from "electron-updater";
import "./ipc/index";

const isProd = process.env.NODE_ENV === "production";

if (isProd) {
  serve({ directory: "app" });
} else {
  app.setPath("userData", `${app.getPath("userData")} (development)`);
}

// 配置自动更新
function configureAutoUpdater(mainWindow: Electron.BrowserWindow) {
  if (!isProd) return;

  // 检查更新出错
  autoUpdater.on('error', (err) => {
    dialog.showErrorBox('Error', err.message);
  });

  // 检查到新版本
  autoUpdater.on('update-available', () => {
    dialog.showMessageBox({
      type: 'info',
      title: '发现新版本',
      message: '发现新版本，是否现在更新？',
      buttons: ['是', '否']
    }).then((result) => {
      if (result.response === 0) {
        autoUpdater.downloadUpdate();
      }
    });
  });

  // 没有新版本
  autoUpdater.on('update-not-available', () => {
    dialog.showMessageBox({
      title: '没有新版本',
      message: '当前已经是最新版本'
    });
  });

  // 更新下载进度
  autoUpdater.on('download-progress', (progressObj) => {
    mainWindow.webContents.send('download-progress', progressObj);
  });

  // 更新下载完毕
  autoUpdater.on('update-downloaded', () => {
    dialog.showMessageBox({
      title: '安装更新',
      message: '更新下载完毕，应用将重启并安装'
    }).then(() => {
      autoUpdater.quitAndInstall();
    });
  });

  // 每次启动时检查更新
  autoUpdater.checkForUpdates();
}

(async () => {
  await app.whenReady();

  const mainWindow = createWindow("main", {
    width: 1000,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
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

  if (isProd) {
    await mainWindow.loadURL("app://./home");
  } else {
    const port = process.argv[2];
    await mainWindow.loadURL(`http://localhost:${port}/home`);
    mainWindow.webContents.openDevTools();
  }

  // 配置自动更新
  configureAutoUpdater(mainWindow);
})();

app.on("window-all-closed", () => {
  // 对于 macOS，通常用户期望应用保持活动状态直到用户明确通过 Cmd + Q 退出
  if (process.platform !== "darwin") {
    app.quit();
  }
});

ipcMain.on("message", async (event, arg) => {
  event.reply("message", `${arg} World!`);
});
