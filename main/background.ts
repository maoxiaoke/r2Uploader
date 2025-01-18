import path from "path";
import { app, ipcMain, nativeTheme } from "electron";
import serve from "electron-serve";
import { createWindow } from "./helpers";
import "./ipc/index";

const isProd = process.env.NODE_ENV === "production";

if (isProd) {
  serve({ directory: "app" });
} else {
  app.setPath("userData", `${app.getPath("userData")} (development)`);
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
