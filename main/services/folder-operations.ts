import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { AppError, toAppError } from "../core/app-error";
import type { ProfileCredentials } from "./config-vault";
import { copyOrMoveObject } from "./object-operations";
import { R2ObjectService } from "./r2-object-service";

const normalizedPrefix = (value: string) => `${value.replace(/^\/+|\/+$/g, "")}/`;

export const createFolder = async (profile: ProfileCredentials, bucket: string, prefix: string) => {
  const folder = normalizedPrefix(prefix);
  const temporary = path.join(os.tmpdir(), `r2uploader-folder-${randomUUID()}`);
  fs.writeFileSync(temporary, "", { mode: 0o600 });
  try {
    return await new R2ObjectService(profile).putObject({
      bucket,
      key: `${folder}.r2uploader-folder`,
      filePath: temporary,
      contentType: "application/x-r2uploader-folder",
    });
  } finally {
    fs.rmSync(temporary, { force: true });
  }
};

const listEveryObject = async (service: R2ObjectService, bucket: string, prefix: string) => {
  const objects = [];
  let cursor: string | undefined;
  do {
    const page = await service.listObjects({ bucket, prefix, cursor, delimiter: "", limit: 1_000, includeInternal: true });
    objects.push(...page.objects);
    cursor = page.cursor;
  } while (cursor);
  return objects;
};

export const planFolderOperation = async (
  profile: ProfileCredentials,
  input: {
    sourceBucket: string;
    sourcePrefix: string;
    targetBucket: string;
    targetPrefix: string;
    move: boolean;
  }
) => {
  const sourcePrefix = normalizedPrefix(input.sourcePrefix);
  const targetPrefix = normalizedPrefix(input.targetPrefix);
  if (input.sourceBucket === input.targetBucket && targetPrefix.startsWith(sourcePrefix)) {
    throw new AppError({
      kind: "VALIDATION",
      code: "FOLDER_TARGET_INSIDE_SOURCE",
      message: "A folder cannot be copied or moved inside itself.",
      retryable: false,
    });
  }
  const objects = await listEveryObject(new R2ObjectService(profile), input.sourceBucket, sourcePrefix);
  if (objects.length === 0) {
    throw new AppError({
      kind: "NOT_FOUND",
      code: "FOLDER_EMPTY_OR_MISSING",
      message: "No objects were found under this prefix.",
      retryable: false,
    });
  }
  return objects.map((object) => ({
    sourceBucket: input.sourceBucket,
    sourceKey: object.key,
    targetBucket: input.targetBucket,
    targetKey: `${targetPrefix}${object.key.slice(sourcePrefix.length)}`,
    move: input.move,
    size: object.size,
  }));
};

export const operateFolder = async (
  profile: ProfileCredentials,
  input: {
    sourceBucket: string;
    sourcePrefix: string;
    targetBucket: string;
    targetPrefix: string;
    move: boolean;
    overwrite?: boolean;
  }
) => {
  const sourcePrefix = normalizedPrefix(input.sourcePrefix);
  const targetPrefix = normalizedPrefix(input.targetPrefix);
  if (input.sourceBucket === input.targetBucket && targetPrefix.startsWith(sourcePrefix)) {
    throw new AppError({
      kind: "VALIDATION",
      code: "FOLDER_TARGET_INSIDE_SOURCE",
      message: "A folder cannot be copied or moved inside itself.",
      retryable: false,
    });
  }
  const service = new R2ObjectService(profile);
  const objects = await listEveryObject(service, input.sourceBucket, sourcePrefix);
  if (objects.length === 0) {
    throw new AppError({
      kind: "NOT_FOUND",
      code: "FOLDER_EMPTY_OR_MISSING",
      message: "No objects were found under this prefix.",
      retryable: false,
    });
  }
  const failures: Array<{ key: string; code: string; message: string }> = [];
  let completed = 0;
  for (const object of objects) {
    const relative = object.key.slice(sourcePrefix.length);
    try {
      await copyOrMoveObject(profile, {
        sourceBucket: input.sourceBucket,
        sourceKey: object.key,
        targetBucket: input.targetBucket,
        targetKey: `${targetPrefix}${relative}`,
        move: input.move,
        overwrite: input.overwrite,
      });
      completed += 1;
    } catch (error) {
      const problem = toAppError(error);
      failures.push({ key: object.key, code: problem.code, message: problem.message });
    }
  }
  return { total: objects.length, completed, failures };
};

export const trashFolder = async (profile: ProfileCredentials, bucket: string, prefix: string) => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return operateFolder(profile, {
    sourceBucket: bucket,
    sourcePrefix: prefix,
    targetBucket: bucket,
    targetPrefix: `.r2uploader-trash/${timestamp}/${normalizedPrefix(prefix)}`,
    move: true,
  });
};

export const planTrashFolderOperation = (profile: ProfileCredentials, bucket: string, prefix: string) => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return planFolderOperation(profile, {
    sourceBucket: bucket,
    sourcePrefix: prefix,
    targetBucket: bucket,
    targetPrefix: `.r2uploader-trash/${timestamp}/${normalizedPrefix(prefix)}`,
    move: true,
  });
};
