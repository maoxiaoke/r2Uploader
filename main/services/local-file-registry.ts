import { dialog } from "electron";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { LocalDirectoryHandle, LocalFileHandle } from "../../shared/contracts";
import { AppError } from "../core/app-error";
import { getBootstrapState } from "./config-vault";

const title = (english: string, chinese: string) => getBootstrapState().preferences.locale === "zh-CN" ? chinese : english;

export interface RegisteredFile extends LocalFileHandle {
  path: string;
  derived?: boolean;
}

const files = new Map<string, RegisteredFile>();
const directories = new Map<string, string>();

const register = (filePath: string, relativePath?: string): LocalFileHandle => {
  const resolved = path.resolve(filePath);
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) {
    throw new AppError({
      kind: "VALIDATION",
      code: "LOCAL_FILE_REQUIRED",
      message: "Only files selected by the user can be uploaded.",
      retryable: false,
    });
  }
  const entry: RegisteredFile = {
    id: randomUUID(),
    name: path.basename(resolved),
    size: stat.size,
    relativePath,
    path: resolved,
  };
  files.set(entry.id, entry);
  return { id: entry.id, name: entry.name, size: entry.size, relativePath: entry.relativePath };
};

export const registerDerivedFile = (filePath: string, name: string, relativePath?: string): LocalFileHandle => {
  const handle = register(filePath, relativePath);
  const entry = files.get(handle.id);
  if (entry) { entry.name = name; entry.derived = true; }
  return { ...handle, name };
};

export const registerDroppedFile = (input: {
  path: string;
  name?: string;
  size?: number;
  relativePath?: string;
}) => {
  const resolved = path.resolve(input.path);
  const stat = fs.statSync(resolved);
  if (stat.isDirectory()) {
    const output: LocalFileHandle[] = [];
    walk(path.dirname(resolved), resolved, output);
    return output;
  }
  const handle = register(resolved, input.relativePath);
  if (input.name && input.name !== handle.name) {
    throw new AppError({
      kind: "VALIDATION",
      code: "LOCAL_FILE_MISMATCH",
      message: "The dropped file metadata did not match the selected file.",
      retryable: false,
    });
  }
  return [handle];
};

export const chooseFiles = async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile", "multiSelections"],
    title: title("Choose files to upload", "选择要上传的文件"),
  });
  return result.canceled ? [] : result.filePaths.map((filePath) => register(filePath));
};

const walk = (root: string, current: string, output: LocalFileHandle[]) => {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    if (entry.name === ".DS_Store") continue;
    const absolute = path.join(current, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      walk(root, absolute, output);
    } else if (entry.isFile()) {
      output.push(register(absolute, path.relative(root, absolute).split(path.sep).join("/")));
    }
  }
};

export const chooseFolder = async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
    title: title("Choose a folder to upload", "选择要上传的文件夹"),
  });
  if (result.canceled || !result.filePaths[0]) return [];
  const output: LocalFileHandle[] = [];
  walk(result.filePaths[0], result.filePaths[0], output);
  return output;
};

export const chooseDirectory = async (): Promise<LocalDirectoryHandle | null> => {
  const result = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"], title: title("Choose a local directory", "选择本地目录") });
  const selected = result.filePaths[0];
  if (result.canceled || !selected) return null;
  const resolved = path.resolve(selected);
  const id = randomUUID();
  directories.set(id, resolved);
  return { id, name: path.basename(resolved), displayPath: resolved };
};

export const resolveDirectoryHandle = (id: string) => {
  const directory = directories.get(id);
  if (!directory || !fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    throw new AppError({ kind: "NOT_FOUND", code: "LOCAL_DIRECTORY_HANDLE_EXPIRED", message: "The selected local directory is no longer available.", action: "Choose the directory again.", retryable: false });
  }
  return directory;
};

export const registerAutomationFile = (filePath: string, relativePath?: string) => register(filePath, relativePath);

export const resolveFileHandle = (id: string) => {
  const entry = files.get(id);
  if (!entry || !fs.existsSync(entry.path)) {
    throw new AppError({
      kind: "NOT_FOUND",
      code: "LOCAL_FILE_HANDLE_EXPIRED",
      message: "The selected local file is no longer available.",
      action: "Choose the file again and retry.",
      retryable: false,
    });
  }
  return entry;
};
