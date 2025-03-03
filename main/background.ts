import path from "path";
import { app, ipcMain, nativeTheme, dialog, globalShortcut, BrowserWindow } from "electron";
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

function configureAutoUpdater(mainWindow: Electron.BrowserWindow) {
  if (!isProd) return;

  // error
  autoUpdater.on('error', (err) => {
    dialog.showErrorBox('Error', err.message);
  });

  // update available
  autoUpdater.on('update-available', () => {
    dialog.showMessageBox({
      type: 'info',
      title: 'Update Available',
      message: 'A new version is available. Do you want to update now?',
      buttons: ['Yes', 'No']
    }).then((result) => {
      if (result.response === 0) {
        autoUpdater.downloadUpdate();
      }
    });
  });

  // download progress
  autoUpdater.on('download-progress', (progressObj) => {
    mainWindow.webContents.send('download-progress', progressObj);
  });

  // update downloaded
  autoUpdater.on('update-downloaded', () => {
    dialog.showMessageBox({
      title: 'Install Update',
      message: 'The update has been downloaded. The application will restart and install the update.'
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

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.control || input.meta) {
      if (input.key === 'r') {
        mainWindow.reload();
        event.preventDefault();
      }
    }

    if ((input.control || input.meta) && input.shift && input.key === 'i') {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });
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

  registerShortcuts(mainWindow);

  if (isProd) {
    await mainWindow.loadURL("app://./home");
  } else {
    const port = process.argv[2];
    await mainWindow.loadURL(`http://localhost:${port}/home`);
    mainWindow.webContents.openDevTools();
  }

  configureAutoUpdater(mainWindow);
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

ipcMain.on("message", async (event, arg) => {
  event.reply("message", `${arg} World!`);
});
