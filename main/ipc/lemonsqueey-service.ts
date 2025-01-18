import { ipcMain } from "electron";
import fetch from "node-fetch";
import { storeConfig, getConfig } from "../helpers";

ipcMain.handle("activate-license", async (evt, { license_key }) => {
  const rsp = await fetch("https://api.lemonsqueezy.com/v1/licenses/activate", {
    method: "POST",
    body: JSON.stringify({ license_key, instance_name: "R2Uploader" }),
    headers: {
      "Content-Type": "application/json",
    },
  });

  const data = await rsp.json();

  if (data?.activated) {
    storeConfig({
      license: license_key,
      activated: true,
      instance_id: data?.instance?.id,
    });

    evt.sender.send("config-updated", getConfig());
  }

  return data;
});

ipcMain.handle("deactivate-license", async (evt) => {
  const config = getConfig();
  const rsp = await fetch(
    "https://api.lemonsqueezy.com/v1/licenses/deactivate",
    {
      method: "POST",
      body: JSON.stringify({
        license_key: config.license,
        instance_id: config.instance_id,
      }),
      headers: {
        "Content-Type": "application/json",
      },
    }
  );

  const data = await rsp.json();

  if (data?.deactivated) {
    storeConfig({
      license: "",
      activated: false,
      instance_id: "",
    });

    evt.sender.send("config-updated", getConfig());
  }

  return data;
});
