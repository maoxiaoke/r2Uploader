import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ConflictPolicy, SyncPreview, SyncTask } from "../../shared/contracts";
import { AppError, toAppError } from "../core/app-error";
import { normalizeObjectKey } from "../core/object-key";
import { readJson, writeJson } from "./json-store";
import { registerAutomationFile, resolveDirectoryHandle } from "./local-file-registry";
import { transferManager } from "./transfer-manager";

interface ManifestEntry { size: number; mtimeMs: number; }
interface PendingEntry extends ManifestEntry { transferId: string; taskId: string; relativePath: string; }
const TASK_FILE = "sync-tasks.json";
const MANIFEST_FILE = "sync-manifests.json";
const PENDING_FILE = "sync-pending.json";

const normalizeRelative = (value: string) => value.split(path.sep).join("/");
const wildcard = (pattern: string) => new RegExp(`^${pattern.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
const excluded = (relative: string, patterns: string[]) => patterns.some((pattern) => wildcard(pattern).test(relative) || wildcard(pattern).test(path.posix.basename(relative)));

const scan = (root: string, patterns: string[]) => {
  const files: Array<{ absolute: string; relative: string; size: number; mtimeMs: number }> = [];
  let excludedFiles = 0;
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(directory, entry.name);
      const relative = normalizeRelative(path.relative(root, absolute));
      if (excluded(relative, patterns)) { excludedFiles += 1; continue; }
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) { const stat = fs.statSync(absolute); files.push({ absolute, relative, size: stat.size, mtimeMs: stat.mtimeMs }); }
    }
  };
  visit(root);
  return { files, excludedFiles };
};

class SyncManager {
  private timer?: NodeJS.Timeout;

  initialize() {
    this.reconcile();
    this.timer = setInterval(() => {
      this.reconcile();
      const now = Date.now();
      for (const task of this.list()) {
        if (task.enabled && !["scanning", "queued"].includes(task.status) && (!task.lastRunAt || now - Date.parse(task.lastRunAt) >= 60_000)) void this.run(task.id, false);
      }
    }, 30_000);
    this.timer.unref();
  }

  list() { return readJson<SyncTask[]>(TASK_FILE, []); }

  save(input: { id?: string; name: string; profileId: string; bucket: string; prefix: string; directoryId?: string; excludes: string[]; conflictPolicy: ConflictPolicy; enabled: boolean }) {
    const tasks = this.list();
    const existing = input.id ? tasks.find((task) => task.id === input.id) : undefined;
    const localPath = input.directoryId ? resolveDirectoryHandle(input.directoryId) : existing?.localPath;
    if (!localPath) throw new Error("Choose a local directory for this sync task.");
    const task: SyncTask = { id: existing?.id ?? randomUUID(), name: input.name, profileId: input.profileId, bucket: input.bucket, prefix: input.prefix.replace(/^\/+|\/+$/g, ""), localPath, excludes: input.excludes, conflictPolicy: input.conflictPolicy, enabled: input.enabled, status: input.enabled ? "idle" : "paused", lastRunAt: existing?.lastRunAt, queuedFiles: existing?.queuedFiles };
    writeJson(TASK_FILE, [task, ...tasks.filter((item) => item.id !== task.id)]);
    return task;
  }

  delete(id: string) {
    const tasks = this.list();
    writeJson(TASK_FILE, tasks.filter((task) => task.id !== id));
    const manifests = readJson<Record<string, Record<string, ManifestEntry>>>(MANIFEST_FILE, {});
    delete manifests[id];
    writeJson(MANIFEST_FILE, manifests);
    return true;
  }

  pause(id: string, paused: boolean) {
    const tasks = this.list();
    const task = tasks.find((item) => item.id === id);
    if (!task) throw new Error("Sync task not found.");
    task.enabled = !paused;
    task.status = paused ? "paused" : "idle";
    writeJson(TASK_FILE, tasks);
    return task;
  }

  async run(id: string, previewOnly: boolean): Promise<SyncPreview> {
    const tasks = this.list();
    const task = tasks.find((item) => item.id === id);
    if (!task) throw new Error("Sync task not found.");
    if (!previewOnly && readJson<PendingEntry[]>(PENDING_FILE, []).some((item) => item.taskId === id)) {
      throw new AppError({ kind: "CONFLICT", code: "SYNC_ALREADY_QUEUED", message: "This sync task still has unfinished uploads.", action: "Review the Transfer Center and wait, retry, or cancel those items before starting another run.", retryable: false });
    }
    task.status = "scanning";
    writeJson(TASK_FILE, tasks);
    try {
      const { files, excludedFiles } = scan(task.localPath, task.excludes);
      const manifests = readJson<Record<string, Record<string, ManifestEntry>>>(MANIFEST_FILE, {});
      const manifest = manifests[id] ?? {};
      const changed = files.filter((file) => !manifest[file.relative] || manifest[file.relative].size !== file.size || Math.abs(manifest[file.relative].mtimeMs - file.mtimeMs) > 1);
      const preview: SyncPreview = { taskId: id, scannedFiles: files.length, changedFiles: changed.slice(0, 5_000).map((file) => ({ relativePath: file.relative, size: file.size, targetKey: normalizeObjectKey([task.prefix, file.relative].filter(Boolean).join("/")) })), excludedFiles, truncated: changed.length > 5_000 };
      if (!previewOnly && changed.length) {
        const accepted = changed.slice(0, 5_000);
        const handles = accepted.map((file) => registerAutomationFile(file.absolute, file.relative));
        const ids = transferManager.enqueue({ profileId: task.profileId, bucket: task.bucket, entries: handles.map((handle, index) => ({ handleId: handle.id, targetKey: normalizeObjectKey([task.prefix, accepted[index].relative].filter(Boolean).join("/")) })), conflictPolicy: task.conflictPolicy, duplicatePolicy: "skip" });
        const pending = readJson<PendingEntry[]>(PENDING_FILE, []);
        writeJson(PENDING_FILE, [...pending, ...ids.map((transferId, index) => ({ transferId, taskId: task.id, relativePath: accepted[index].relative, size: accepted[index].size, mtimeMs: accepted[index].mtimeMs }))]);
        task.status = "queued";
        task.queuedFiles = ids.length;
      } else task.status = task.enabled ? "idle" : "paused";
      task.lastRunAt = new Date().toISOString();
      task.error = undefined;
      writeJson(TASK_FILE, tasks);
      return preview;
    } catch (error) {
      task.status = "error";
      task.error = toAppError(error);
      writeJson(TASK_FILE, tasks);
      throw error;
    }
  }

  private reconcile() {
    const pending = readJson<PendingEntry[]>(PENDING_FILE, []);
    if (!pending.length) return;
    const statuses = new Map(transferManager.list().map((transfer) => [transfer.id, transfer.status]));
    const manifests = readJson<Record<string, Record<string, ManifestEntry>>>(MANIFEST_FILE, {});
    const remaining: PendingEntry[] = [];
    for (const item of pending) {
      const status = statuses.get(item.transferId);
      if (status === "completed") {
        manifests[item.taskId] = manifests[item.taskId] ?? {};
        manifests[item.taskId][item.relativePath] = { size: item.size, mtimeMs: item.mtimeMs };
      } else if (!status || ["failed", "cancelled", "partial"].includes(status)) {
        // A later scan will retry failed or missing work.
      } else remaining.push(item);
    }
    writeJson(MANIFEST_FILE, manifests);
    writeJson(PENDING_FILE, remaining);
    const tasks = this.list();
    for (const task of tasks) {
      const count = remaining.filter((item) => item.taskId === task.id).length;
      task.queuedFiles = count;
      if (!count && task.status === "queued") task.status = task.enabled ? "idle" : "paused";
    }
    writeJson(TASK_FILE, tasks);
  }
}

export const syncManager = new SyncManager();
