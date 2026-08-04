import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

const dataDirectory = () => {
  const target = path.join(app.getPath("userData"), "data");
  fs.mkdirSync(target, { recursive: true });
  return target;
};

export const readJson = <T>(name: string, fallback: T): T => {
  const target = path.join(dataDirectory(), name);
  if (!fs.existsSync(target)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(target, "utf8")) as T;
  } catch {
    return fallback;
  }
};

export const writeJson = <T>(name: string, value: T) => {
  const target = path.join(dataDirectory(), name);
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, target);
};
