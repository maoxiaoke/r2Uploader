import { app } from "electron";
import path from "path";
import fs from "fs";

const HOME = "r2uploader";

export const getAppHome = () => {
  const userHomeDirectoryPath = app.getPath("home");

  return path.join(userHomeDirectoryPath, HOME);
};

export const ensurePathExists = (path: string) => {
  if (!fs.existsSync(path)) {
    fs.mkdirSync(path, { recursive: true });
  }

  return path;
};

export const ensureAppHome = () => {
  const configPath = getAppHome();

  ensurePathExists(configPath);

  return configPath;
};
