import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { readJson, writeJson } from "./json-store";
import { getBootstrapState, getProfile } from "./config-vault";
import { R2ObjectService } from "./r2-object-service";

interface CacheEntry {
  id: string;
  profileId: string;
  bucket: string;
  key: string;
  etag?: string;
  contentType: string;
  size: number;
  createdAt: string;
  accessedAt: string;
}

const INDEX = "object-cache-index.json";
const directory = () => {
  const value = path.join(app.getPath("userData"), "object-cache");
  fs.mkdirSync(value, { recursive: true });
  return value;
};

const idFor = (profileId: string, bucket: string, key: string) =>
  createHash("sha256").update(`${profileId}\0${bucket}\0${key}`).digest("hex");

const entries = () => readJson<CacheEntry[]>(INDEX, []);

export const cachedObject = (profileId: string, bucket: string, key: string, etag?: string) => {
  const id = idFor(profileId, bucket, key);
  const index = entries();
  const entry = index.find((candidate) => candidate.id === id && (!etag || candidate.etag === etag));
  const filePath = path.join(directory(), id);
  if (!entry || !fs.existsSync(filePath)) return null;
  entry.accessedAt = new Date().toISOString();
  writeJson(INDEX, index);
  return { entry, filePath };
};

export const storeCachedObject = (input: {
  profileId: string;
  bucket: string;
  key: string;
  etag?: string;
  contentType: string;
  data: Buffer;
  maxBytes: number;
}) => {
  const id = idFor(input.profileId, input.bucket, input.key);
  const target = path.join(directory(), id);
  if (input.maxBytes <= 0 || input.data.length > input.maxBytes) {
    fs.rmSync(target, { force: true });
    const index = entries().filter((entry) => entry.id !== id);
    writeJson(INDEX, index);
    return { entries: index.length, bytes: index.reduce((sum, entry) => sum + entry.size, 0) };
  }
  fs.writeFileSync(target, input.data, { mode: 0o600 });
  const now = new Date().toISOString();
  let index = entries().filter((entry) => entry.id !== id);
  index.push({
    id,
    profileId: input.profileId,
    bucket: input.bucket,
    key: input.key,
    etag: input.etag,
    contentType: input.contentType,
    size: input.data.length,
    createdAt: now,
    accessedAt: now,
  });
  index.sort((a, b) => a.accessedAt.localeCompare(b.accessedAt));
  let total = index.reduce((sum, entry) => sum + entry.size, 0);
  while (total > input.maxBytes && index.length > 1) {
    const removed = index.shift();
    if (!removed) break;
    fs.rmSync(path.join(directory(), removed.id), { force: true });
    total -= removed.size;
  }
  writeJson(INDEX, index);
  return { entries: index.length, bytes: total };
};

export const cacheStats = () => {
  const index = entries().filter((entry) => fs.existsSync(path.join(directory(), entry.id)));
  return { entries: index.length, bytes: index.reduce((sum, entry) => sum + entry.size, 0), path: directory() };
};

export const clearObjectCache = () => {
  for (const entry of entries()) fs.rmSync(path.join(directory(), entry.id), { force: true });
  writeJson(INDEX, []);
  return cacheStats();
};

export const cachePrefixForOffline = async (input: { profileId: string; bucket: string; prefix: string }) => {
  const service = new R2ObjectService(getProfile(input.profileId));
  const maxBytes = getBootstrapState().preferences.cacheMaxBytes;
  if (!maxBytes) return { cached: 0, skipped: 0, failed: 0, bytes: 0 };
  let cursor: string | undefined;
  let cached = 0;
  let skipped = 0;
  let failed = 0;
  let bytes = 0;
  do {
    const page = await service.listObjects({ bucket: input.bucket, prefix: input.prefix, cursor, delimiter: "", limit: 1_000 });
    for (const item of page.objects) {
      if (item.size > 10 * 1024 * 1024) { skipped += 1; continue; }
      try {
        const object = await service.getObject(input.bucket, item.key);
        const chunks: Buffer[] = [];
        let total = 0;
        for await (const chunk of object.body) { const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); total += buffer.length; if (total > 10 * 1024 * 1024) { object.body.destroy(); break; } chunks.push(buffer); }
        if (total > 10 * 1024 * 1024) { skipped += 1; continue; }
        storeCachedObject({ profileId: input.profileId, bucket: input.bucket, key: item.key, etag: object.etag, contentType: object.contentType, data: Buffer.concat(chunks), maxBytes });
        cached += 1;
        bytes += total;
      } catch { failed += 1; }
    }
    cursor = page.cursor;
  } while (cursor);
  return { cached, skipped, failed, bytes };
};
