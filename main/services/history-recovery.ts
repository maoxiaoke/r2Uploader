import { AppError } from "../core/app-error";
import { getProfile } from "./config-vault";
import { getOperationRecord } from "./operation-history";
import { copyOrMoveObject, trashObject } from "./object-operations";

export const recoverOperation = async (id: string) => {
  const record = getOperationRecord(id);
  if (!record) throw new AppError({ kind: "NOT_FOUND", code: "HISTORY_RECORD_NOT_FOUND", message: "The selected operation history record no longer exists.", retryable: false });
  if (!record.reversible || record.status === "failed") throw new AppError({ kind: "VALIDATION", code: "HISTORY_OPERATION_NOT_REVERSIBLE", message: "This operation does not have a safe automated recovery action.", retryable: false });
  const profile = getProfile(record.profileId);
  if (record.action === "trash" && record.key && record.targetKey) {
    return copyOrMoveObject(profile, { sourceBucket: record.targetBucket ?? record.bucket, sourceKey: record.targetKey, targetBucket: record.bucket, targetKey: record.key, move: true, overwrite: false });
  }
  if (record.action === "move" && record.key && record.targetKey) {
    return copyOrMoveObject(profile, { sourceBucket: record.targetBucket ?? record.bucket, sourceKey: record.targetKey, targetBucket: record.bucket, targetKey: record.key, move: true, overwrite: false });
  }
  if (record.action === "upload" && record.key) return trashObject(profile, record.bucket, record.key);
  throw new AppError({ kind: "VALIDATION", code: "HISTORY_RECOVERY_UNSUPPORTED", message: "The recorded operation cannot be recovered automatically.", retryable: false });
};
