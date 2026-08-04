import { app } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { ImageProcessingPreset, NamingRule, UploadPlanItem } from "../../shared/contracts";
import { toAppError } from "../core/app-error";
import { normalizeObjectKey } from "../core/object-key";
import { findDuplicate, sha256File } from "./asset-index";
import { getProfile } from "./config-vault";
import { registerDerivedFile, resolveFileHandle } from "./local-file-registry";
import { R2ObjectService } from "./r2-object-service";

const imageExtensions = new Set([".avif", ".gif", ".heic", ".heif", ".jpeg", ".jpg", ".png", ".tif", ".tiff", ".webp"]);
const outputExtension = (format: ImageProcessingPreset["format"], original: string) => format === "original" ? original.replace(/^\./, "") : format === "jpeg" ? "jpg" : format;
const two = (value: number) => String(value).padStart(2, "0");

const applyNaming = (input: { fileName: string; index: number; checksum: string; width?: number; height?: number; rule: NamingRule; extension: string; randomId: string }) => {
  const parsed = path.parse(input.fileName);
  if (!input.rule.enabled) return `${parsed.name}.${input.extension}`;
  const now = new Date();
  const tokens: Record<string, string> = {
    name: parsed.name,
    ext: input.extension,
    date: `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`,
    time: `${two(now.getHours())}-${two(now.getMinutes())}-${two(now.getSeconds())}`,
    index: String(input.index + 1).padStart(3, "0"),
    hash8: input.checksum.slice(0, 8),
    width: String(input.width ?? ""),
    height: String(input.height ?? ""),
    project: input.rule.project.trim(),
    random: input.randomId,
    uuid: input.randomId,
  };
  let value = input.rule.template.replace(/\{(name|ext|date|time|index|hash8|width|height|project|random|uuid)\}/g, (_match, key: string) => tokens[key] ?? "");
  value = value.replace(/[<>:"|?*\u0000-\u001F]/g, "-").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/\/{2,}/g, "/").replace(/^\/+|\/+$/g, "");
  if (!value) value = parsed.name;
  if (!input.rule.template.includes("{ext}")) value += `.${input.extension}`;
  return value;
};

const deriveImage = async (filePath: string, preset: ImageProcessingPreset, extension: string) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "r2uploader-image-"));
  const target = path.join(directory, `processed.${extension}`);
  let pipeline = sharp(filePath, { failOn: "warning" }).rotate().resize({ width: preset.maxWidth, height: preset.maxHeight, fit: "inside", withoutEnlargement: true });
  if (preset.format === "webp") pipeline = pipeline.webp({ quality: preset.quality });
  if (preset.format === "avif") pipeline = pipeline.avif({ quality: preset.quality });
  if (preset.format === "jpeg") pipeline = pipeline.jpeg({ quality: preset.quality, mozjpeg: true });
  try {
    await pipeline.toFile(target);
    return target;
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
};

export const planUploads = async (input: { profileId: string; bucket: string; prefix?: string; handles: string[]; imagePreset: ImageProcessingPreset; namingRule: NamingRule }): Promise<UploadPlanItem[]> => {
  // Accessing userData here ensures Electron is initialized before native image work begins.
  void app.getPath("userData");
  const output: UploadPlanItem[] = [];
  for (let index = 0; index < input.handles.length; index += 1) {
    const source = resolveFileHandle(input.handles[index]);
    const sourceExtension = path.extname(source.path).toLowerCase();
    const originalChecksum = await sha256File(source.path);
    const randomId = randomUUID().replace(/-/g, "").slice(0, 12);
    let width: number | undefined;
    let height: number | undefined;
    if (imageExtensions.has(sourceExtension)) {
      try { const metadata = await sharp(source.path).metadata(); width = metadata.width; height = metadata.height; } catch { /* Unsupported image data uploads unchanged. */ }
    }
    let shouldTransform = Boolean(input.imagePreset.enabled && width && height && input.imagePreset.format !== "original");
    let targetExtension = outputExtension(shouldTransform ? input.imagePreset.format : "original", sourceExtension || ".bin");
    let named = applyNaming({ fileName: source.name, index, checksum: originalChecksum, width, height, rule: input.namingRule, extension: targetExtension, randomId });
    let targetKey = normalizeObjectKey([input.prefix?.replace(/\/$/, ""), source.relativePath ? path.posix.dirname(source.relativePath) : "", named].filter((value) => value && value !== ".").join("/"));
    let processingWarning: string | undefined;
    if (shouldTransform) {
      let derivedPath: string;
      try {
        derivedPath = await deriveImage(source.path, input.imagePreset, targetExtension);
      } catch (error) {
        processingWarning = toAppError(error).message;
        shouldTransform = false;
        targetExtension = outputExtension("original", sourceExtension || ".bin");
        named = applyNaming({ fileName: source.name, index, checksum: originalChecksum, width, height, rule: input.namingRule, extension: targetExtension, randomId });
        targetKey = normalizeObjectKey([input.prefix?.replace(/\/$/, ""), source.relativePath ? path.posix.dirname(source.relativePath) : "", named].filter((value) => value && value !== ".").join("/"));
      }
      if (!shouldTransform) {
        const duplicate = findDuplicate(input.profileId, originalChecksum);
        output.push({ handleId: source.id, sourceHandleId: source.id, sourceName: source.name, sourceSize: source.size, targetKey, outputSize: source.size, checksum: originalChecksum, width, height, transformed: false, processingWarning, duplicate: duplicate ? { bucket: duplicate.bucket, key: duplicate.key, uploadedAt: duplicate.uploadedAt } : undefined });
        continue;
      }
      const derivedName = path.basename(named);
      const handle = registerDerivedFile(derivedPath!, derivedName, source.relativePath ? path.posix.join(path.posix.dirname(source.relativePath), derivedName) : undefined);
      const checksum = await sha256File(derivedPath!);
      const duplicate = findDuplicate(input.profileId, checksum);
      output.push({ handleId: handle.id, sourceHandleId: source.id, sourceName: source.name, sourceSize: source.size, targetKey, outputSize: handle.size, checksum, width: input.imagePreset.maxWidth && width ? Math.min(width, input.imagePreset.maxWidth) : width, height: input.imagePreset.maxHeight && height ? Math.min(height, input.imagePreset.maxHeight) : height, transformed: true, duplicate: duplicate ? { bucket: duplicate.bucket, key: duplicate.key, uploadedAt: duplicate.uploadedAt } : undefined });
      if (input.imagePreset.keepOriginal) {
        const parsed = path.posix.parse(targetKey);
        const originalKey = `${parsed.dir ? `${parsed.dir}/` : ""}${parsed.name}.original${sourceExtension || ".bin"}`;
        const originalDuplicate = findDuplicate(input.profileId, originalChecksum);
        output.push({ handleId: source.id, sourceHandleId: source.id, sourceName: source.name, sourceSize: source.size, targetKey: originalKey, outputSize: source.size, checksum: originalChecksum, width, height, transformed: false, duplicate: originalDuplicate ? { bucket: originalDuplicate.bucket, key: originalDuplicate.key, uploadedAt: originalDuplicate.uploadedAt } : undefined });
      }
    } else {
      const duplicate = findDuplicate(input.profileId, originalChecksum);
      output.push({ handleId: source.id, sourceHandleId: source.id, sourceName: source.name, sourceSize: source.size, targetKey, outputSize: source.size, checksum: originalChecksum, width, height, transformed: false, duplicate: duplicate ? { bucket: duplicate.bucket, key: duplicate.key, uploadedAt: duplicate.uploadedAt } : undefined });
    }
  }
  const counts = new Map<string, number>();
  for (const item of output) counts.set(item.targetKey, (counts.get(item.targetKey) ?? 0) + 1);
  for (const item of output) item.batchConflict = (counts.get(item.targetKey) ?? 0) > 1;
  const service = new R2ObjectService(getProfile(input.profileId));
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(6, output.length) }, async () => {
    while (next < output.length) {
      const item = output[next++];
      try {
        const existing = await service.headObject(input.bucket, item.targetKey);
        item.existing = { size: existing.size, lastModified: existing.lastModified, contentType: existing.contentType };
      } catch (error) {
        if (toAppError(error).kind !== "NOT_FOUND") throw error;
      }
    }
  }));
  return output;
};
