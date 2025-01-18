import { ipcMain } from "electron";
import { getBuckets } from "../helpers";

/**
 * Get the config of megrez
 */
ipcMain.handle("get-buckets", async () => {
  return getBuckets();
});

// ipcMain.on("set-buckets", async (event, config) => {
//   // storeConfig(config);
//   // event.sender.send("config-updated", getConfig());
// });
