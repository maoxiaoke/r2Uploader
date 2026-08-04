import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import type { AssetIndexRecord } from "../../shared/contracts";
import type { ObjectHead } from "../../shared/contracts";
import { readJson, writeJson } from "./json-store";
import type { R2ObjectService } from "./r2-object-service";

const FILE = "asset-index.json";
const LIMIT = 250_000;

const records = () => readJson<AssetIndexRecord[]>(FILE, []);
const save = (items: AssetIndexRecord[]) => writeJson(FILE, items.slice(0, LIMIT));

export const sha256File = async (filePath: string) => new Promise<string>((resolve, reject) => {
  const hash = createHash("sha256");
  const stream = fs.createReadStream(filePath);
  stream.on("error", reject);
  stream.on("data", (chunk) => hash.update(chunk));
  stream.on("end", () => resolve(hash.digest("hex")));
});

export const findDuplicate = (profileId: string, checksum: string) => records().find((item) => item.profileId === profileId && item.checksum === checksum);

export const indexUploadedAsset = (input: {
  profileId: string;
  bucket: string;
  key: string;
  checksum: string;
  width?: number;
  height?: number;
  remote: ObjectHead;
}) => {
  const items = records();
  const existing = items.find((item) => item.profileId === input.profileId && item.bucket === input.bucket && item.key === input.key);
  const orientation = input.width && input.height ? input.width === input.height ? "square" : input.width > input.height ? "landscape" : "portrait" : undefined;
  const next: AssetIndexRecord = {
    id: existing?.id ?? randomUUID(),
    profileId: input.profileId,
    bucket: input.bucket,
    key: input.key,
    size: input.remote.size,
    checksum: input.checksum,
    etag: input.remote.etag,
    contentType: input.remote.contentType,
    width: input.width,
    height: input.height,
    orientation,
    durationSeconds: existing?.durationSeconds,
    tags: existing?.tags ?? [],
    aiDescription: existing?.aiDescription,
    embedding: existing?.embedding,
    embeddingModel: existing?.embeddingModel,
    source: "upload",
    indexedAt: new Date().toISOString(),
    uploadedAt: input.remote.lastModified,
  };
  save([next, ...items.filter((item) => item.id !== next.id)]);
  return next;
};

export const listAssetIndex = (input?: { profileId?: string; bucket?: string; query?: string }) => {
  const query = input?.query?.trim().toLowerCase();
  return records().filter((item) => {
    if (input?.profileId && item.profileId !== input.profileId) return false;
    if (input?.bucket && item.bucket !== input.bucket) return false;
    if (!query) return true;
    return [item.key, item.bucket, item.contentType, item.aiDescription, ...item.tags].some((value) => value?.toLowerCase().includes(query));
  });
};

export const updateAssetIndex = (id: string, input: { tags?: string[]; aiDescription?: string }) => {
  const items = records();
  const current = items.find((item) => item.id === id);
  if (!current) return null;
  const next = { ...current, ...input, tags: input.tags ?? current.tags, indexedAt: new Date().toISOString() };
  save(items.map((item) => item.id === id ? next : item));
  return next;
};

export const updateAssetMediaMetadata = (input: { profileId: string; bucket: string; key: string; durationSeconds: number; width?: number; height?: number }) => {
  const items = records();
  const current = items.find((item) => item.profileId === input.profileId && item.bucket === input.bucket && item.key === input.key);
  if (!current) return null;
  const orientation = input.width && input.height ? input.width === input.height ? "square" as const : input.width > input.height ? "landscape" as const : "portrait" as const : current.orientation;
  const next: AssetIndexRecord = { ...current, durationSeconds: input.durationSeconds, width: input.width || current.width, height: input.height || current.height, orientation, indexedAt: new Date().toISOString() };
  save(items.map((item) => item.id === current.id ? next : item));
  return next;
};

export const getAssetIndexRecord = (id: string) => records().find((item) => item.id === id);

export const updateAssetAnalysis = (id: string, input: { tags: string[]; aiDescription: string; embedding: number[]; embeddingModel: string }) => {
  const items = records();
  const current = items.find((item) => item.id === id);
  if (!current) return null;
  const next: AssetIndexRecord = {
    ...current,
    tags: [...new Set([...current.tags, ...input.tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean)])].slice(0, 100),
    aiDescription: input.aiDescription,
    embedding: input.embedding,
    embeddingModel: input.embeddingModel,
    indexedAt: new Date().toISOString(),
  };
  save(items.map((item) => item.id === id ? next : item));
  return next;
};

export const clearAssetAiData = () => {
  const items = records();
  let cleared = 0;
  const next = items.map((item) => {
    if (!item.aiDescription && !item.embedding && !item.embeddingModel) return item;
    cleared += 1;
    const { aiDescription: _description, embedding: _embedding, embeddingModel: _model, ...rest } = item;
    return rest;
  });
  save(next);
  return { cleared };
};

export const rebuildAssetIndex = async (profileId: string, bucket: string, service: R2ObjectService) => {
  const previous = records();
  const rebuilt: AssetIndexRecord[] = [];
  let cursor: string | undefined;
  do {
    const page = await service.listObjects({ bucket, cursor, delimiter: "", limit: 1_000 });
    for (const item of page.objects) {
      const old = previous.find((entry) => entry.profileId === profileId && entry.bucket === bucket && entry.key === item.key);
      rebuilt.push({
        id: old?.id ?? randomUUID(), profileId, bucket, key: item.key, size: item.size, checksum: old?.checksum,
        etag: item.etag, contentType: item.contentType, width: old?.width, height: old?.height, orientation: old?.orientation,
        durationSeconds: old?.durationSeconds, tags: old?.tags ?? [], aiDescription: old?.aiDescription,
        embedding: old?.embedding, embeddingModel: old?.embeddingModel,
        source: old?.source === "upload" ? "upload" : "remote-rebuild", indexedAt: new Date().toISOString(), uploadedAt: item.lastModified,
      });
    }
    cursor = page.cursor;
  } while (cursor);
  save([...rebuilt, ...previous.filter((item) => item.profileId !== profileId || item.bucket !== bucket)]);
  return { indexed: rebuilt.length, rebuiltAt: new Date().toISOString() };
};
