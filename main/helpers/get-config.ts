import path from "path";
import fs from "fs";
import { ensureAppHome } from "./path";
import { safeParse } from "./json";
import { log } from "./log";

const ConfigName = "r2uploader.json";

export const getConfigPath = () => {
  return path.join(ensureAppHome(), ConfigName);
};

export const getConfig = (key?: string) => {
  const configPath = getConfigPath();
  const config = safeParse(configPath);

  if (key) {
    return config[key] ?? null;
  }

  return config;
};

export const storeConfig = (cig: Record<string, any>) => {
  const config = getConfig();

  const result = {};
  for (const key in cig) {
    const keys = key.split(".");
    keys.reduce((res, k, i) => {
      return (res[k] = keys.length === i + 1 ? cig[key] : res[k] || {});
    }, result);
  }

  fs.writeFileSync(
    getConfigPath(),
    JSON.stringify({ ...config, ...result }, null, 2)
  );
};
