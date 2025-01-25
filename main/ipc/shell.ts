import {
  ipcMain,
  shell,
  dialog,
  BrowserWindow,
  clipboard,
  nativeImage,
} from "electron";
import { download } from "electron-dl";
import { getCachePath } from "../helpers/cache";
import fs from "node:fs";

/**
 * open the browser
 */
ipcMain.handle("open-browser", async (evt, { url }) => {
  shell.openExternal(url);
  return true;
});

ipcMain.handle("export-file", async (event, { url }) => {
  try {
    const win = BrowserWindow.getFocusedWindow();

    const res = await download(win, url, {
      saveAs: true,
    });

    console.log("res", res, url);
    return true;
  } catch (error) {
    return false;
  }
});

ipcMain.handle("copy-2-clipboard", async (evt, { url }) => {
  const win = BrowserWindow.getFocusedWindow();

  const cachePath = getCachePath();

  const downloadRes = await download(win, url, {
    directory: cachePath,
  });

  const savePath = downloadRes.getSavePath();

  const image = nativeImage.createFromPath(savePath);
  clipboard.writeImage(image);

  fs.unlinkSync(savePath);

  return true;
});

ipcMain.handle("show-message-box-sync", (evt, { message, type, detail }) => {
  const actionStatus = dialog.showMessageBoxSync({
    message,
    type,
    detail,
    buttons: ["Sure", "Cancel"],
  });

  return actionStatus;
});
