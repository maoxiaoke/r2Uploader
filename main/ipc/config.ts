import { ipcMain } from "electron";
import { storeConfig, getConfig } from "../helpers";

/**
 * Get the config of megrez
 */
ipcMain.handle("get-config", async () => {
  return getConfig();
});

ipcMain.handle("set-config", async (evt, config) => {
  storeConfig(config);
  return getConfig();
});

ipcMain.on("set-config", async (event, config) => {
  storeConfig(config);
  event.sender.send("config-updated", getConfig());
});
