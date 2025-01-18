import { ipcMain, shell, dialog } from "electron";
import fs from "node:fs";

/**
 * open the browser
 */
ipcMain.handle("open-browser", async (evt, { url }) => {
  shell.openExternal(url);
  return true;
});

ipcMain.handle("export-file", async (event, { name, content }) => {
  try {
    const savePath = dialog.showSaveDialogSync({
      defaultPath: name,
      properties: ["createDirectory", "showOverwriteConfirmation"],
    });

    if (savePath) {
      fs.writeFileSync(savePath, content);
      return { success: true, path: savePath };
    }
    return { success: false, error: "No save path selected" };
  } catch (error) {
    return { success: false, error: error.message };
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
