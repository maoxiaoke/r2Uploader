import type { ObjectHead } from "../../shared/contracts";
import { AppError, toAppError } from "../core/app-error";
import type { ProfileCredentials } from "./config-vault";
import { recordOperation } from "./operation-history";
import { R2ObjectService } from "./r2-object-service";
import { readJson, writeJson } from "./json-store";

interface JournalEntry {
  id: string;
  profileId: string;
  sourceBucket: string;
  sourceKey: string;
  targetBucket: string;
  targetKey: string;
  state: "copying" | "copied" | "verified" | "source-delete-failed" | "completed";
  updatedAt: string;
}

const JOURNAL_FILE = "operation-journal.json";

const appendJournal = (entry: JournalEntry) => {
  const entries = readJson<JournalEntry[]>(JOURNAL_FILE, []);
  writeJson(JOURNAL_FILE, [entry, ...entries].slice(0, 500));
};

const updateJournal = (entry: JournalEntry) => {
  const entries = readJson<JournalEntry[]>(JOURNAL_FILE, []);
  writeJson(
    JOURNAL_FILE,
    entries.map((candidate) => (candidate.id === entry.id ? entry : candidate))
  );
};

export const listIncompleteOperations = () =>
  readJson<JournalEntry[]>(JOURNAL_FILE, []).filter((entry) => entry.state !== "completed");

const verifyCopy = (source: ObjectHead, target: ObjectHead) => {
  if (source.size !== target.size) {
    throw new AppError({
      kind: "PARTIAL_SUCCESS",
      code: "COPY_SIZE_MISMATCH",
      message: "The destination object size does not match the source object.",
      action: "The source was retained. Remove the incomplete destination and retry.",
      retryable: true,
      details: { sourceSize: source.size, targetSize: target.size },
    });
  }
};

export const copyOrMoveObject = async (
  profile: ProfileCredentials,
  input: {
    sourceBucket: string;
    sourceKey: string;
    targetBucket: string;
    targetKey: string;
    move: boolean;
    overwrite?: boolean;
  }
) => {
  const service = new R2ObjectService(profile);
  if (!input.overwrite) {
    try {
      await service.headObject(input.targetBucket, input.targetKey);
      throw new AppError({
        kind: "CONFLICT",
        code: "TARGET_EXISTS",
        message: "An object already exists at the destination.",
        action: "Choose overwrite, skip, or an automatically renamed destination.",
        retryable: false,
      });
    } catch (error) {
      const appError = toAppError(error);
      if (appError.kind !== "NOT_FOUND") throw error;
    }
  }

  const id = `${profile.id}:${input.sourceBucket}:${input.sourceKey}:${Date.now()}`;
  const entry: JournalEntry = {
    id,
    profileId: profile.id,
    sourceBucket: input.sourceBucket,
    sourceKey: input.sourceKey,
    targetBucket: input.targetBucket,
    targetKey: input.targetKey,
    state: "copying",
    updatedAt: new Date().toISOString(),
  };
  appendJournal(entry);

  const source = await service.headObject(input.sourceBucket, input.sourceKey);
  await service.copyObject({
    sourceBucket: input.sourceBucket,
    sourceKey: input.sourceKey,
    bucket: input.targetBucket,
    key: input.targetKey,
  });
  entry.state = "copied";
  entry.updatedAt = new Date().toISOString();
  updateJournal(entry);
  const target = await service.headObject(input.targetBucket, input.targetKey);
  verifyCopy(source, target);
  entry.state = "verified";
  entry.updatedAt = new Date().toISOString();
  updateJournal(entry);

  if (input.move) {
    try {
      await service.deleteObject(input.sourceBucket, input.sourceKey);
    } catch (error) {
      entry.state = "source-delete-failed";
      entry.updatedAt = new Date().toISOString();
      updateJournal(entry);
      recordOperation({
        action: "move",
        profileId: profile.id,
        bucket: input.sourceBucket,
        key: input.sourceKey,
        targetBucket: input.targetBucket,
        targetKey: input.targetKey,
        status: "partial",
        reversible: true,
        errorCode: toAppError(error).code,
      });
      throw new AppError({
        kind: "PARTIAL_SUCCESS",
        code: "SOURCE_DELETE_FAILED",
        message: "The object was copied and verified, but the original could not be deleted.",
        action: "Both objects are safe. Retry deleting the original when ready.",
        retryable: true,
      });
    }
  }

  entry.state = "completed";
  entry.updatedAt = new Date().toISOString();
  updateJournal(entry);
  recordOperation({
    action: input.move ? "move" : "copy",
    profileId: profile.id,
    bucket: input.sourceBucket,
    key: input.sourceKey,
    targetBucket: input.targetBucket,
    targetKey: input.targetKey,
    status: "success",
    reversible: input.move,
  });
  return target;
};

export const trashObject = async (profile: ProfileCredentials, bucket: string, key: string) => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const trashKey = `.r2uploader-trash/${timestamp}/${key}`;
  await copyOrMoveObject(profile, {
    sourceBucket: bucket,
    sourceKey: key,
    targetBucket: bucket,
    targetKey: trashKey,
    move: true,
  });
  recordOperation({
    action: "trash",
    profileId: profile.id,
    bucket,
    key,
    targetBucket: bucket,
    targetKey: trashKey,
    status: "success",
    reversible: true,
  });
  return { trashKey };
};
