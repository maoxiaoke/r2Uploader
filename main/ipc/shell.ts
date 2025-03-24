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

    await download(win, url, {
      saveAs: true,
      showBadge: true,
      showProgressBar: true,
    });

    return true;
  } catch (error) {
    return false;
  }
});

ipcMain.handle("copy-2-clipboard", async (evt, { url, copyFileType }) => {
  try {
    const win = BrowserWindow.getFocusedWindow();
    const cachePath = getCachePath();

    const downloadRes = await download(win, url, {
      directory: cachePath,
    });

    const savePath = downloadRes.getSavePath();

    if (copyFileType === "image") {
      const image = nativeImage.createFromPath(savePath);
      clipboard.writeImage(image);
    }

    if (copyFileType === "text") {
      const fileContent = fs.readFileSync(savePath, "utf-8");

      clipboard.writeText(fileContent);
    }

    fs.unlinkSync(savePath);

    return true;
  } catch (e) {
    return false;
  }
});

/**
 * download the file and return the save path
 */
ipcMain.handle("download-file", async (evt, { url }) => {
  try {
    const win = BrowserWindow.getFocusedWindow();
    const cachePath = getCachePath();

    console.log('downloading file', url, cachePath);

    const downloadRes = await download(win, url, {
      directory: cachePath,
    });

    const savePath = downloadRes.getSavePath();
    return savePath;
  } catch (e) {
    return false;
  }
})

ipcMain.handle("remove-cache-file", async (evt, { path }) => {
  if (fs.existsSync(path)) {
    fs.unlinkSync(path);
  }
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
