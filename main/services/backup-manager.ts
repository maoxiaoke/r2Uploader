import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import type { BackupRunResult, BackupTask } from "../../shared/contracts";
import { AppError, toAppError } from "../core/app-error";
import { normalizeObjectKey } from "../core/object-key";
import { getProfile } from "./config-vault";
import { readJson, writeJson } from "./json-store";
import { registerAutomationFile, resolveDirectoryHandle } from "./local-file-registry";
import { R2ObjectService } from "./r2-object-service";
import { sha256File } from "./asset-index";
import { transferManager } from "./transfer-manager";

const FILE = "backup-tasks.json";
interface Manifest { version: 1; taskId: string; profileId: string; bucket: string; prefix: string; createdAt: string; objects: Array<{ key: string; relativePath: string; size: number; etag?: string; sha256: string }> }

const safeRelative = (key: string, prefix: string) => {
  const relative = key.startsWith(prefix) ? key.slice(prefix.length) : key;
  return relative.split("/").filter((segment) => segment && segment !== "." && segment !== "..").map((segment) => segment.replace(/[<>:"|?*\u0000-\u001F]/g, "_")).join("/") || "object";
};

class BackupManager {
  private timer?: NodeJS.Timeout;
  initialize() {
    this.timer = setInterval(() => {
      const now = Date.now();
      for (const task of this.list()) {
        if (!task.enabled || task.schedule === "manual" || task.status === "running") continue;
        const interval = task.schedule === "daily" ? 86_400_000 : 7 * 86_400_000;
        if (!task.lastRunAt || now - Date.parse(task.lastRunAt) >= interval) void this.run(task.id);
      }
    }, 60 * 60_000);
    this.timer.unref();
  }
  list() { return readJson<BackupTask[]>(FILE, []); }
  save(input: { id?: string; name: string; profileId: string; bucket: string; prefix: string; directoryId?: string; schedule: BackupTask["schedule"]; keepLast: number; enabled: boolean }) {
    const tasks = this.list();
    const existing = input.id ? tasks.find((task) => task.id === input.id) : undefined;
    const localPath = input.directoryId ? resolveDirectoryHandle(input.directoryId) : existing?.localPath;
    if (!localPath) throw new Error("Choose a local backup directory.");
    const task: BackupTask = { id: existing?.id ?? randomUUID(), name: input.name, profileId: input.profileId, bucket: input.bucket, prefix: input.prefix.replace(/^\/+/, ""), localPath, schedule: input.schedule, keepLast: input.keepLast, enabled: input.enabled, status: "idle", lastRunAt: existing?.lastRunAt, lastRunPath: existing?.lastRunPath, verifiedObjects: existing?.verifiedObjects };
    writeJson(FILE, [task, ...tasks.filter((item) => item.id !== task.id)]);
    return task;
  }
  delete(id: string) { writeJson(FILE, this.list().filter((task) => task.id !== id)); return true; }
  async run(id: string): Promise<BackupRunResult> {
    const tasks = this.list();
    const task = tasks.find((item) => item.id === id);
    if (!task) throw new Error("Backup task not found.");
    task.status = "running";
    task.error = undefined;
    writeJson(FILE, tasks);
    const service = new R2ObjectService(getProfile(task.profileId));
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const taskRoot = path.join(task.localPath, "r2uploader-backups", task.id);
    const runRoot = path.join(taskRoot, stamp);
    fs.mkdirSync(runRoot, { recursive: true });
    const manifest: Manifest = { version: 1, taskId: task.id, profileId: task.profileId, bucket: task.bucket, prefix: task.prefix, createdAt: new Date().toISOString(), objects: [] };
    const failures: BackupRunResult["failures"] = [];
    let bytes = 0;
    try {
      let cursor: string | undefined;
      do {
        const page = await service.listObjects({ bucket: task.bucket, prefix: task.prefix || undefined, cursor, delimiter: "", limit: 1_000 });
        for (const object of page.objects) {
          const relativePath = safeRelative(object.key, task.prefix);
          const target = path.join(runRoot, ...relativePath.split("/"));
          try {
            fs.mkdirSync(path.dirname(target), { recursive: true });
            const remote = await service.getObject(task.bucket, object.key);
            await pipeline(remote.body, fs.createWriteStream(target, { mode: 0o600 }));
            const stat = fs.statSync(target);
            if (stat.size !== object.size) throw new Error(`Size mismatch: expected ${object.size}, received ${stat.size}.`);
            manifest.objects.push({ key: object.key, relativePath, size: stat.size, etag: object.etag, sha256: await sha256File(target) });
            bytes += stat.size;
          } catch (error) { failures.push({ key: object.key, message: error instanceof Error ? error.message : String(error) }); }
        }
        cursor = page.cursor;
      } while (cursor);
      const manifestPath = path.join(runRoot, "r2uploader-backup-manifest.json");
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });
      task.lastRunAt = new Date().toISOString();
      if (failures.length) {
        task.status = "error";
        task.error = { kind: "PARTIAL_SUCCESS", code: "BACKUP_PARTIAL", message: `${manifest.objects.length} objects verified; ${failures.length} failed.`, action: "The last complete snapshot was retained. Review the failed objects and run the backup again.", retryable: true };
      } else {
        task.status = "idle";
        task.lastRunPath = runRoot;
        task.verifiedObjects = manifest.objects.length;
        task.error = undefined;
        this.prune(taskRoot, task.keepLast);
      }
      writeJson(FILE, tasks);
      return { taskId: task.id, path: runRoot, objects: manifest.objects.length, bytes, manifestPath, failures };
    } catch (error) {
      task.status = "error";
      task.error = toAppError(error);
      writeJson(FILE, tasks);
      throw error;
    }
  }
  async restore(id: string, keyPrefix?: string, targetPrefix?: string) {
    const task = this.list().find((item) => item.id === id);
    if (!task?.lastRunPath) throw new Error("This task does not have a completed backup to restore.");
    const expectedRoot = path.resolve(task.localPath, "r2uploader-backups", task.id);
    const runRoot = path.resolve(task.lastRunPath);
    if (!runRoot.startsWith(`${expectedRoot}${path.sep}`)) throw new Error("The backup path is outside the selected task directory.");
    const manifestPath = path.join(runRoot, "r2uploader-backup-manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Manifest;
    if (manifest.version !== 1 || manifest.taskId !== task.id || manifest.profileId !== task.profileId || manifest.bucket !== task.bucket || !Array.isArray(manifest.objects)) {
      throw new AppError({ kind: "VALIDATION", code: "BACKUP_MANIFEST_INVALID", message: "The backup manifest does not match this task.", action: "Do not restore from a moved or edited manifest. Run a new verified backup.", retryable: false });
    }
    const selected = keyPrefix ? manifest.objects.filter((object) => object.key === keyPrefix || object.key.startsWith(keyPrefix)) : manifest.objects;
    if (!selected.length) throw new Error("No object in the latest verified manifest matches that key or prefix.");
    const handles: ReturnType<typeof registerAutomationFile>[] = [];
    for (const object of selected) {
      const source = path.resolve(runRoot, ...object.relativePath.split("/"));
      if (!source.startsWith(`${runRoot}${path.sep}`) || !fs.existsSync(source) || !fs.statSync(source).isFile()) {
        throw new AppError({ kind: "NOT_FOUND", code: "BACKUP_OBJECT_MISSING", message: `The verified backup file for ${object.key} is missing.`, action: "Keep the remote object unchanged and run a new backup.", retryable: false });
      }
      const stat = fs.statSync(source);
      const checksum = await sha256File(source);
      if (stat.size !== object.size || checksum !== object.sha256) {
        throw new AppError({ kind: "VALIDATION", code: "BACKUP_OBJECT_INTEGRITY_FAILED", message: `The local backup file for ${object.key} no longer matches its verified manifest.`, action: "Do not restore this snapshot. Run a new backup or inspect the local disk.", retryable: false });
      }
      handles.push(registerAutomationFile(source, object.relativePath));
    }
    const normalizedTargetPrefix = targetPrefix?.replace(/^\/+|\/+$/g, "");
    const ids = transferManager.enqueue({ profileId: task.profileId, bucket: task.bucket, entries: handles.map((handle, index) => {
      const originalKey = selected[index].key;
      const relative = originalKey.startsWith(task.prefix) ? originalKey.slice(task.prefix.length).replace(/^\/+/, "") : originalKey;
      return { handleId: handle.id, targetKey: normalizedTargetPrefix ? normalizeObjectKey(`${normalizedTargetPrefix}/${relative}`) : originalKey };
    }), conflictPolicy: "ask", duplicatePolicy: "upload" });
    return { queued: ids.length, transferIds: ids, manifestPath, keyPrefix, targetPrefix: normalizedTargetPrefix };
  }
  private prune(taskRoot: string, keepLast: number) {
    if (!fs.existsSync(taskRoot)) return;
    const runs = fs.readdirSync(taskRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => path.join(taskRoot, entry.name)).sort().reverse();
    for (const obsolete of runs.slice(Math.max(1, keepLast))) fs.rmSync(obsolete, { recursive: true, force: true });
  }
}

export const backupManager = new BackupManager();
