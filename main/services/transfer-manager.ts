import { BrowserWindow, shell } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import sharp from "sharp";
import type { ConflictPolicy, DuplicatePolicy, TransferItem } from "../../shared/contracts";
import { IPC_CHANNELS } from "../../shared/contracts";
import { AppError, toAppError } from "../core/app-error";
import { normalizeObjectKey } from "../core/object-key";
import { getProfile } from "./config-vault";
import { readJson, writeJson } from "./json-store";
import { resolveFileHandle } from "./local-file-registry";
import { recordOperation } from "./operation-history";
import { R2ObjectService } from "./r2-object-service";
import { findDuplicate, indexUploadedAsset, sha256File } from "./asset-index";
import { executeUploadAutomations } from "./automation";
import { copyOrMoveObject } from "./object-operations";

interface StoredTransfer extends TransferItem {
  sourcePath?: string;
  contentType?: string;
  conflictPolicy: ConflictPolicy;
  requestedKey: string;
  duplicatePolicy: DuplicatePolicy;
  destinationPath?: string;
  cleanupSource?: boolean;
  remoteSourceBucket?: string;
  remoteSourceKey?: string;
}

const FILE = "transfers.json";

const contentTypeFor = (filePath: string) => {
  const extension = path.extname(filePath).toLowerCase();
  return (
    {
      ".avif": "image/avif",
      ".css": "text/css",
      ".csv": "text/csv",
      ".gif": "image/gif",
      ".html": "text/html",
      ".jpeg": "image/jpeg",
      ".jpg": "image/jpeg",
      ".js": "text/javascript",
      ".json": "application/json",
      ".md": "text/markdown",
      ".mov": "video/quicktime",
      ".mp3": "audio/mpeg",
      ".mp4": "video/mp4",
      ".pdf": "application/pdf",
      ".png": "image/png",
      ".svg": "image/svg+xml",
      ".txt": "text/plain",
      ".webm": "video/webm",
      ".webp": "image/webp",
      ".xml": "application/xml",
      ".zip": "application/zip",
    } as Record<string, string>
  )[extension] ?? "application/octet-stream";
};

class TransferManager {
  private transfers = new Map<string, StoredTransfer>();
  private controllers = new Map<string, AbortController>();
  private inFlight = new Set<string>();
  private active = 0;
  private concurrency = 3;

  initialize(concurrency: number) {
    this.concurrency = Math.max(1, Math.min(concurrency, 8));
    const stored = readJson<StoredTransfer[]>(FILE, []);
    for (const transfer of stored) {
      transfer.duplicatePolicy = transfer.duplicatePolicy ?? "ask";
      if (transfer.status === "running" || transfer.status === "queued") {
        transfer.status = "paused";
        const uploadSourceAvailable = transfer.kind === "upload" && Boolean(transfer.sourcePath) && fs.existsSync(transfer.sourcePath!);
        transfer.error = {
          kind: "UNAVAILABLE",
          code: "APP_RESTARTED",
          message: "The app closed before this transfer finished.",
          action: transfer.kind === "download"
            ? "Retry the authenticated download."
            : transfer.kind === "copy" || transfer.kind === "move"
            ? "Retry the authenticated remote operation."
            : uploadSourceAvailable
            ? "Retry to resume from the local source file."
            : "Choose the local source file again.",
          retryable: transfer.kind !== "upload" || uploadSourceAvailable,
        };
      }
      this.transfers.set(transfer.id, transfer);
    }
    this.persist();
  }

  setConcurrency(value: number) {
    this.concurrency = Math.max(1, Math.min(value, 8));
    this.pump();
  }

  list(): TransferItem[] {
    return [...this.transfers.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(({ sourcePath: _path, contentType: _type, conflictPolicy: _policy, requestedKey: _key, cleanupSource: _cleanup, remoteSourceBucket: _sourceBucket, remoteSourceKey: _sourceKey, ...item }) => item);
  }

  unfinishedForProfile(profileId: string) {
    return [...this.transfers.values()].filter((item) => item.profileId === profileId && ["queued", "running", "paused"].includes(item.status));
  }

  enqueue(input: {
    profileId: string;
    bucket: string;
    prefix?: string;
    handles?: string[];
    entries?: Array<{ handleId: string; targetKey: string }>;
    conflictPolicy?: ConflictPolicy;
    duplicatePolicy?: DuplicatePolicy;
  }) {
    const now = new Date().toISOString();
    const entries = input.entries ?? (input.handles ?? []).map((handleId) => ({ handleId, targetKey: "" }));
    const prepared = entries.map((entry) => {
      const file = resolveFileHandle(entry.handleId);
      const suffix = file.relativePath || file.name;
      const requestedKey = entry.targetKey ? normalizeObjectKey(entry.targetKey) : normalizeObjectKey([input.prefix?.replace(/\/$/, ""), suffix].filter(Boolean).join("/"));
      return { file, requestedKey };
    });
    const created = prepared.map(({ file, requestedKey }) => {
      const transfer: StoredTransfer = {
        id: randomUUID(),
        kind: "upload",
        status: "queued",
        profileId: input.profileId,
        bucket: input.bucket,
        key: requestedKey,
        requestedKey,
        source: file.name,
        sourcePath: file.path,
        contentType: contentTypeFor(file.path),
        conflictPolicy: input.conflictPolicy ?? "ask",
        duplicatePolicy: input.duplicatePolicy ?? "ask",
        cleanupSource: Boolean(file.derived),
        bytesTotal: file.size,
        bytesTransferred: 0,
        progress: 0,
        speedBytesPerSecond: 0,
        createdAt: now,
        updatedAt: now,
      };
      this.transfers.set(transfer.id, transfer);
      return transfer.id;
    });
    this.persistAndEmit();
    this.pump();
    return created;
  }

  async enqueueDownload(input: { profileId: string; bucket: string; key: string; destinationPath: string }) {
    const remote = await new R2ObjectService(getProfile(input.profileId)).headObject(input.bucket, input.key);
    const now = new Date().toISOString();
    const transfer: StoredTransfer = {
      id: randomUUID(), kind: "download", status: "queued", profileId: input.profileId, bucket: input.bucket, key: input.key,
      source: `r2://${input.bucket}/${input.key}`, destination: input.destinationPath, destinationPath: input.destinationPath,
      contentType: remote.contentType, conflictPolicy: "ask", duplicatePolicy: "upload", requestedKey: input.key,
      bytesTotal: remote.size, bytesTransferred: 0, progress: 0, speedBytesPerSecond: 0, createdAt: now, updatedAt: now,
    };
    this.transfers.set(transfer.id, transfer);
    this.persistAndEmit();
    this.pump();
    return transfer.id;
  }

  enqueueRemote(input: {
    profileId: string;
    entries: Array<{
      sourceBucket: string;
      sourceKey: string;
      targetBucket: string;
      targetKey: string;
      move: boolean;
      size?: number;
    }>;
    conflictPolicy?: ConflictPolicy;
  }) {
    const now = new Date().toISOString();
    const prepared = input.entries.map((entry) => {
      const requestedKey = normalizeObjectKey(entry.targetKey);
      if (entry.sourceBucket === entry.targetBucket && entry.sourceKey === requestedKey) {
        throw new AppError({ kind: "VALIDATION", code: "SOURCE_EQUALS_DESTINATION", message: "The source and destination are the same object.", action: "Choose another destination folder or name.", retryable: false });
      }
      return { ...entry, requestedKey };
    });
    const created = prepared.map((entry) => {
      const requestedKey = entry.requestedKey;
      const transfer: StoredTransfer = {
        id: randomUUID(),
        kind: entry.move ? "move" : "copy",
        status: "queued",
        profileId: input.profileId,
        bucket: entry.targetBucket,
        key: requestedKey,
        requestedKey,
        source: `r2://${entry.sourceBucket}/${entry.sourceKey}`,
        destination: `r2://${entry.targetBucket}/${requestedKey}`,
        remoteSourceBucket: entry.sourceBucket,
        remoteSourceKey: entry.sourceKey,
        conflictPolicy: input.conflictPolicy ?? "ask",
        duplicatePolicy: "upload",
        bytesTotal: entry.size ?? 0,
        bytesTransferred: 0,
        progress: 0,
        speedBytesPerSecond: 0,
        createdAt: now,
        updatedAt: now,
      };
      this.transfers.set(transfer.id, transfer);
      return transfer.id;
    });
    this.persistAndEmit();
    this.pump();
    return created;
  }

  cancel(id: string) {
    const transfer = this.requireTransfer(id);
    if (["completed", "failed", "cancelled"].includes(transfer.status)) return transfer;
    if (["copy", "move"].includes(transfer.kind) && transfer.status === "running") return transfer;
    transfer.status = "cancelled";
    transfer.updatedAt = new Date().toISOString();
    this.controllers.get(id)?.abort();
    this.persistAndEmit();
    return transfer;
  }

  pause(id: string) {
    const transfer = this.requireTransfer(id);
    if (!["queued", "running"].includes(transfer.status)) return transfer;
    if (["copy", "move"].includes(transfer.kind) && transfer.status === "running") return transfer;
    transfer.status = "paused";
    transfer.updatedAt = new Date().toISOString();
    this.controllers.get(id)?.abort();
    this.persistAndEmit();
    return transfer;
  }

  retry(id: string) {
    const transfer = this.requireTransfer(id);
    if (transfer.kind === "upload" && (!transfer.sourcePath || !fs.existsSync(transfer.sourcePath))) {
      throw new AppError({
        kind: "NOT_FOUND",
        code: "LOCAL_SOURCE_MISSING",
        message: "The local source file is no longer available.",
        action: "Choose the source file again.",
        retryable: false,
      });
    }
    transfer.status = "queued";
    transfer.error = undefined;
    transfer.bytesTransferred = 0;
    transfer.progress = 0;
    transfer.speedBytesPerSecond = 0;
    transfer.updatedAt = new Date().toISOString();
    this.persistAndEmit();
    this.pump();
    return transfer;
  }

  clearFinished() {
    for (const [id, transfer] of this.transfers) {
      if (["completed", "failed", "cancelled", "partial"].includes(transfer.status)) {
        this.cleanupDerivedSource(transfer);
        this.transfers.delete(id);
      }
    }
    this.persistAndEmit();
    return this.list();
  }

  async openDownload(id: string) {
    const transfer = this.requireCompletedDownload(id);
    const message = await shell.openPath(transfer.destinationPath!);
    if (message) throw new AppError({ kind: "UNAVAILABLE", code: "SYSTEM_OPEN_FAILED", message, action: "Reveal the file in its folder and choose an installed application.", retryable: false });
    return true;
  }

  revealDownload(id: string) {
    const transfer = this.requireCompletedDownload(id);
    shell.showItemInFolder(transfer.destinationPath!);
    return true;
  }

  private requireCompletedDownload(id: string) {
    const transfer = this.requireTransfer(id);
    if (transfer.kind !== "download" || transfer.status !== "completed" || !transfer.destinationPath || !fs.existsSync(transfer.destinationPath)) {
      throw new AppError({ kind: "NOT_FOUND", code: "COMPLETED_DOWNLOAD_NOT_FOUND", message: "A completed local download is not available for this task.", action: "Download the object again.", retryable: false });
    }
    return transfer;
  }

  private requireTransfer(id: string) {
    const transfer = this.transfers.get(id);
    if (!transfer) {
      throw new AppError({
        kind: "NOT_FOUND",
        code: "TRANSFER_NOT_FOUND",
        message: "The transfer no longer exists.",
        retryable: false,
      });
    }
    return transfer;
  }

  private pump() {
    while (this.active < this.concurrency) {
      const next = [...this.transfers.values()].find((item) => item.status === "queued" && !this.inFlight.has(item.id) && ![...this.inFlight].some((id) => {
        const active = this.transfers.get(id);
        return active?.profileId === item.profileId && active.bucket === item.bucket && active.requestedKey === item.requestedKey;
      }));
      if (!next) break;
      this.active += 1;
      this.inFlight.add(next.id);
      next.status = "running";
      next.updatedAt = new Date().toISOString();
      this.persistAndEmit();
      void this.run(next).finally(() => {
        this.active -= 1;
        this.inFlight.delete(next.id);
        this.pump();
      });
    }
  }

  private async resolveConflict(service: R2ObjectService, transfer: StoredTransfer) {
    try {
      const existing = await service.headObject(transfer.bucket, transfer.requestedKey);
      if (transfer.conflictPolicy === "skip") {
        transfer.status = "completed";
        transfer.completedAt = new Date().toISOString();
        transfer.error = {
          kind: "CONFLICT",
          code: "UPLOAD_SKIPPED_EXISTING",
          message: "Skipped because the destination already exists.",
          retryable: false,
          details: { existingSize: existing.size, existingModified: existing.lastModified ?? null },
        };
        return false;
      }
      if (transfer.conflictPolicy === "overwrite") return true;
      if (transfer.conflictPolicy === "rename") {
        const extension = path.posix.extname(transfer.requestedKey);
        const base = extension ? transfer.requestedKey.slice(0, -extension.length) : transfer.requestedKey;
        for (let index = 2; index < 10_000; index += 1) {
          const candidate = `${base}-${index}${extension}`;
          try {
            await service.headObject(transfer.bucket, candidate);
          } catch (error) {
            if (toAppError(error).kind === "NOT_FOUND") {
              transfer.key = candidate;
              return true;
            }
            throw error;
          }
        }
      }
      throw new AppError({
        kind: "CONFLICT",
        code: "UPLOAD_TARGET_EXISTS",
        message: "An object already exists at the upload destination.",
        action: "Retry with skip, overwrite, or automatic rename.",
        retryable: false,
        details: { existingSize: existing.size, existingModified: existing.lastModified ?? null },
      });
    } catch (error) {
      if (toAppError(error).kind === "NOT_FOUND") return true;
      throw error;
    }
  }

  private async run(transfer: StoredTransfer) {
    if (transfer.kind === "download") return this.runDownload(transfer);
    if (transfer.kind === "copy" || transfer.kind === "move") return this.runRemote(transfer);
    return this.runUpload(transfer);
  }

  private async runUpload(transfer: StoredTransfer) {
    if (!transfer.sourcePath) throw new AppError({ kind: "NOT_FOUND", code: "LOCAL_SOURCE_MISSING", message: "The local source file is no longer available.", action: "Choose the source file again.", retryable: false });
    const profile = getProfile(transfer.profileId);
    const service = new R2ObjectService(profile);
    const controller = new AbortController();
    this.controllers.set(transfer.id, controller);
    const startedAt = Date.now();
    try {
      const checksum = await sha256File(transfer.sourcePath);
      const duplicate = findDuplicate(transfer.profileId, checksum);
      if (duplicate && (duplicate.bucket !== transfer.bucket || duplicate.key !== transfer.requestedKey)) {
        if (transfer.duplicatePolicy === "skip") {
          transfer.status = "completed";
          transfer.completedAt = new Date().toISOString();
          transfer.error = { kind: "CONFLICT", code: "DUPLICATE_SKIPPED", message: `Identical content already exists at r2://${duplicate.bucket}/${duplicate.key}.`, retryable: false, details: { duplicateBucket: duplicate.bucket, duplicateKey: duplicate.key } };
          this.persistAndEmit();
          return;
        }
        if (transfer.duplicatePolicy === "ask") throw new AppError({ kind: "CONFLICT", code: "DUPLICATE_ASSET", message: `Identical content already exists at r2://${duplicate.bucket}/${duplicate.key}.`, action: "Retry with Upload duplicate if both locations are intentional.", retryable: false, details: { duplicateBucket: duplicate.bucket, duplicateKey: duplicate.key } });
      }
      if (!(await this.resolveConflict(service, transfer))) {
        this.persistAndEmit();
        return;
      }
      const result = await service.putObject({
        bucket: transfer.bucket,
        key: transfer.key,
        filePath: transfer.sourcePath,
        contentType: transfer.contentType,
        signal: controller.signal,
        onProgress: (transferred, total) => {
          const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.1);
          transfer.bytesTransferred = transferred;
          transfer.bytesTotal = total;
          transfer.progress = total ? Math.min(100, (transferred / total) * 100) : 0;
          transfer.speedBytesPerSecond = Math.round(transferred / elapsedSeconds);
          transfer.etaSeconds = transfer.speedBytesPerSecond
            ? Math.max(0, Math.round((total - transferred) / transfer.speedBytesPerSecond))
            : undefined;
          transfer.updatedAt = new Date().toISOString();
          this.emitThrottled();
        },
      });
      transfer.status = "completed";
      transfer.bytesTransferred = result.size;
      transfer.progress = 100;
      transfer.completedAt = new Date().toISOString();
      transfer.updatedAt = transfer.completedAt;
      transfer.error = undefined;
      this.emitRemoteChange(transfer.profileId, transfer.bucket, [transfer.key]);
      let width: number | undefined;
      let height: number | undefined;
      if (transfer.contentType?.startsWith("image/")) {
        try { const metadata = await sharp(transfer.sourcePath).metadata(); width = metadata.width; height = metadata.height; } catch { /* Index basic metadata when dimensions are unavailable. */ }
      }
      indexUploadedAsset({ profileId: transfer.profileId, bucket: transfer.bucket, key: transfer.key, checksum, width, height, remote: result });
      const automation = await executeUploadAutomations(profile, transfer.bucket, transfer.key, result.etag ?? checksum);
      if (automation.failures.length) {
        transfer.status = "partial";
        transfer.error = { kind: "PARTIAL_SUCCESS", code: "UPLOAD_AUTOMATION_PARTIAL", message: "The object uploaded successfully, but one or more automation actions failed.", action: automation.failures.join("; "), retryable: true, details: { matchedRules: automation.matched, failedRules: automation.failures.length } };
      }
      recordOperation({
        action: "upload",
        profileId: transfer.profileId,
        bucket: transfer.bucket,
        key: transfer.key,
        status: transfer.status === "partial" ? "partial" : "success",
        reversible: true,
      });
    } catch (error) {
      if (!controller.signal.aborted && transfer.status !== "cancelled" && transfer.status !== "paused") {
        transfer.status = toAppError(error).kind === "PARTIAL_SUCCESS" ? "partial" : "failed";
        transfer.error = toAppError(error);
        transfer.updatedAt = new Date().toISOString();
        recordOperation({
          action: "upload",
          profileId: transfer.profileId,
          bucket: transfer.bucket,
          key: transfer.key,
          status: transfer.status === "partial" ? "partial" : "failed",
          reversible: false,
          errorCode: transfer.error.code,
        });
      }
    } finally {
      this.controllers.delete(transfer.id);
      if (transfer.status === "completed") this.cleanupDerivedSource(transfer);
      this.persistAndEmit();
    }
  }

  private async runRemote(transfer: StoredTransfer) {
    if (!transfer.remoteSourceBucket || !transfer.remoteSourceKey) {
      transfer.status = "failed";
      transfer.error = { kind: "VALIDATION", code: "REMOTE_SOURCE_MISSING", message: "The remote source was not recorded for this task.", retryable: false };
      transfer.updatedAt = new Date().toISOString();
      this.persistAndEmit();
      return;
    }
    const profile = getProfile(transfer.profileId);
    const service = new R2ObjectService(profile);
    try {
      const source = await service.headObject(transfer.remoteSourceBucket, transfer.remoteSourceKey);
      transfer.bytesTotal = source.size;
      transfer.updatedAt = new Date().toISOString();
      this.persistAndEmit();
      if (!(await this.resolveConflict(service, transfer))) {
        this.persistAndEmit();
        return;
      }
      transfer.destination = `r2://${transfer.bucket}/${transfer.key}`;
      await copyOrMoveObject(profile, {
        sourceBucket: transfer.remoteSourceBucket,
        sourceKey: transfer.remoteSourceKey,
        targetBucket: transfer.bucket,
        targetKey: transfer.key,
        move: transfer.kind === "move",
        overwrite: transfer.conflictPolicy === "overwrite",
      });
      transfer.status = "completed";
      transfer.bytesTransferred = source.size;
      transfer.progress = 100;
      transfer.completedAt = new Date().toISOString();
      transfer.updatedAt = transfer.completedAt;
      transfer.error = undefined;
      this.emitRemoteChange(transfer.profileId, transfer.bucket, [transfer.key]);
      if (transfer.kind === "move") this.emitRemoteChange(transfer.profileId, transfer.remoteSourceBucket, [transfer.remoteSourceKey]);
    } catch (error) {
      if (transfer.status !== "cancelled" && transfer.status !== "paused") {
        transfer.error = toAppError(error);
        transfer.status = transfer.error.kind === "PARTIAL_SUCCESS" ? "partial" : "failed";
        transfer.updatedAt = new Date().toISOString();
      }
    } finally {
      this.persistAndEmit();
    }
  }

  private async runDownload(transfer: StoredTransfer) {
    if (!transfer.destinationPath) throw new AppError({ kind: "VALIDATION", code: "DOWNLOAD_DESTINATION_MISSING", message: "The selected download destination is unavailable.", retryable: false });
    const service = new R2ObjectService(getProfile(transfer.profileId));
    const controller = new AbortController();
    this.controllers.set(transfer.id, controller);
    const startedAt = Date.now();
    try {
      const object = await service.getObject(transfer.bucket, transfer.key);
      const progress = new Transform({ transform: (chunk, _encoding, callback) => {
        transfer.bytesTransferred += chunk.length;
        transfer.bytesTotal = Math.max(transfer.bytesTotal, object.contentLength);
        transfer.progress = transfer.bytesTotal ? Math.min(100, transfer.bytesTransferred / transfer.bytesTotal * 100) : 0;
        const elapsed = Math.max((Date.now() - startedAt) / 1000, 0.1);
        transfer.speedBytesPerSecond = Math.round(transfer.bytesTransferred / elapsed);
        transfer.etaSeconds = transfer.speedBytesPerSecond ? Math.max(0, Math.round((transfer.bytesTotal - transfer.bytesTransferred) / transfer.speedBytesPerSecond)) : undefined;
        transfer.updatedAt = new Date().toISOString();
        this.emitThrottled();
        callback(null, chunk);
      } });
      controller.signal.addEventListener("abort", () => object.body.destroy(new Error("Transfer paused or cancelled")), { once: true });
      fs.mkdirSync(path.dirname(transfer.destinationPath), { recursive: true });
      await pipeline(object.body, progress, fs.createWriteStream(transfer.destinationPath, { mode: 0o600 }));
      const size = fs.statSync(transfer.destinationPath).size;
      if (transfer.bytesTotal && size !== transfer.bytesTotal) throw new AppError({ kind: "PARTIAL_SUCCESS", code: "DOWNLOAD_VERIFICATION_FAILED", message: "The downloaded file size did not match the remote object.", action: "Keep or remove the partial file, then retry.", retryable: true, details: { localSize: size, remoteSize: transfer.bytesTotal } });
      transfer.status = "completed"; transfer.progress = 100; transfer.completedAt = new Date().toISOString(); transfer.updatedAt = transfer.completedAt; transfer.error = undefined;
      recordOperation({ action: "download", profileId: transfer.profileId, bucket: transfer.bucket, key: transfer.key, status: "success", reversible: false });
    } catch (error) {
      if (!controller.signal.aborted && transfer.status !== "cancelled" && transfer.status !== "paused") { transfer.status = toAppError(error).kind === "PARTIAL_SUCCESS" ? "partial" : "failed"; transfer.error = toAppError(error); transfer.updatedAt = new Date().toISOString(); }
    } finally { this.controllers.delete(transfer.id); this.persistAndEmit(); }
  }

  private persist() {
    writeJson(FILE, [...this.transfers.values()]);
  }

  private persistAndEmit() {
    this.persist();
    this.emit();
  }

  private lastEmit = 0;
  private emitThrottled() {
    if (Date.now() - this.lastEmit < 120) return;
    this.lastEmit = Date.now();
    this.persistAndEmit();
  }

  private emit() {
    const items = this.list();
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.transferUpdated, items);
    }
  }

  private emitRemoteChange(profileId: string, bucket: string, keys: string[]) {
    const event = { profileId, bucket, keys, receivedAt: new Date().toISOString(), source: "transfer" };
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.remoteObjectsChanged, event);
    }
  }

  private cleanupDerivedSource(transfer: StoredTransfer) {
    if (!transfer.cleanupSource || !transfer.sourcePath) return;
    try {
      fs.rmSync(transfer.sourcePath, { force: true });
      const parent = path.dirname(transfer.sourcePath);
      if (path.dirname(parent) === os.tmpdir() && path.basename(parent).startsWith("r2uploader-") && fs.readdirSync(parent).length === 0) fs.rmdirSync(parent);
      transfer.cleanupSource = false;
    } catch { /* Explicitly registered derived files are cleaned up best effort. */ }
  }
}

export const transferManager = new TransferManager();
