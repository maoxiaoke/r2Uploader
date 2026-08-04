import { app, dialog } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  ConnectionCheck,
  ConnectionDiagnostic,
  DiagnosticBundle,
  TransferStatus,
} from "../../shared/contracts";
import { toAppError } from "../core/app-error";
import { getBootstrapState, getProfile } from "./config-vault";
import { recentErrors } from "./error-log";
import { R2ObjectService } from "./r2-object-service";
import { transferManager } from "./transfer-manager";

let latestConnection: ConnectionDiagnostic | undefined;

export const testConnection = async (profileId: string, bucket?: string, testWrite = false) => {
  const checks: ConnectionCheck[] = [];
  const profile = getProfile(profileId);
  const zh = getBootstrapState().preferences.locale === "zh-CN";
  const copy = (english: string, chinese: string) => zh ? chinese : english;
  checks.push({ id: "vault", status: "passed", label: copy("Credential vault", "凭据保险库"), detail: copy("Secrets decrypted in the main process.", "Secret 只在主进程中解密。") });
  const service = new R2ObjectService(profile);
  let buckets: Array<{ name: string }> = [];

  try {
    buckets = await service.listBuckets();
    checks.push({ id: "authentication", status: "passed", label: copy("Authentication", "身份验证"), detail: profile.provider === "s3" ? copy("The S3 endpoint accepted the credentials.", "S3 端点已接受凭据。") : copy("Cloudflare accepted the credentials.", "Cloudflare 已接受凭据。") });
    checks.push({ id: "buckets", status: "passed", label: copy("List buckets", "列出存储桶"), detail: zh ? `可访问 ${buckets.length} 个存储桶。` : `${buckets.length} bucket(s) visible.` });
  } catch (error) {
    const problem = toAppError(error);
    checks.push({ id: "authentication", status: "failed", label: copy("Authentication", "身份验证"), detail: problem.message, action: problem.action });
    checks.push({ id: "buckets", status: "skipped", label: copy("List buckets", "列出存储桶"), detail: copy("Skipped because authentication failed.", "因身份验证失败而跳过。") });
  }

  const targetBucket = bucket || buckets[0]?.name;
  let canReadObjects = false;
  let canWriteObjects = false;
  if (targetBucket) {
    try {
      await service.listObjects({ bucket: targetBucket, limit: 1 });
      canReadObjects = true;
      checks.push({ id: "read", status: "passed", label: copy("Read objects", "读取对象"), detail: zh ? `已确认可以读取 ${targetBucket}。` : `Read access confirmed for ${targetBucket}.` });
    } catch (error) {
      const problem = toAppError(error);
      checks.push({ id: "read", status: "failed", label: copy("Read objects", "读取对象"), detail: problem.message, action: problem.action });
    }
  } else {
    checks.push({ id: "read", status: "skipped", label: copy("Read objects", "读取对象"), detail: copy("Choose an authorized bucket to test object access.", "请选择一个已授权的存储桶以测试对象访问。") });
  }

  if (targetBucket && testWrite) {
    const temporary = path.join(os.tmpdir(), `r2uploader-${randomUUID()}.txt`);
    const key = `.r2uploader-diagnostics/${randomUUID()}.txt`;
    fs.writeFileSync(temporary, "R2Uploader permission check", { mode: 0o600 });
    try {
      await service.putObject({ bucket: targetBucket, key, filePath: temporary, contentType: "text/plain" });
      canWriteObjects = true;
      checks.push({ id: "write", status: "passed", label: copy("Write objects", "写入对象"), detail: copy("A temporary object was uploaded and verified.", "临时对象已上传并验证。") });
      try {
        await service.deleteObject(targetBucket, key);
        checks.push({ id: "cleanup", status: "passed", label: copy("Clean up", "清理"), detail: copy("The temporary object was removed.", "临时对象已移除。") });
      } catch (error) {
        checks.push({ id: "cleanup", status: "failed", label: copy("Clean up", "清理"), detail: toAppError(error).message, action: copy("Remove the diagnostic key from the bucket.", "请从存储桶中移除诊断 Key。") });
      }
    } catch (error) {
      const problem = toAppError(error);
      checks.push({ id: "write", status: "failed", label: copy("Write objects", "写入对象"), detail: problem.message, action: problem.action });
      checks.push({ id: "cleanup", status: "skipped", label: copy("Clean up", "清理"), detail: copy("Nothing was uploaded.", "没有上传任何对象。") });
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  } else {
    checks.push({ id: "write", status: "skipped", label: copy("Write objects", "写入对象"), detail: testWrite ? copy("Choose a bucket first.", "请先选择存储桶。") : copy("Enable the non-destructive write test when needed.", "需要时可启用无破坏性的写入测试。") });
    checks.push({ id: "cleanup", status: "skipped", label: copy("Clean up", "清理"), detail: copy("No write test was run.", "未运行写入测试。") });
  }

  checks.push({
    id: "s3",
    status: profile.hasS3Credentials ? "passed" : "skipped",
    label: copy("Multipart and temporary links", "分片上传和临时链接"),
    detail: profile.hasS3Credentials
      ? copy("S3 credentials are configured for multipart uploads and presigned links.", "已配置用于分片上传和预签名链接的 S3 凭据。")
      : copy("Add S3 credentials to support uploads above 300 MB and temporary links.", "请添加 S3 凭据，以支持超过 300 MB 的上传和临时链接。"),
  });

  latestConnection = {
    checkedAt: new Date().toISOString(),
    checks,
    canManageBuckets: checks.some((check) => check.id === "buckets" && check.status === "passed"),
    canReadObjects,
    canWriteObjects,
    canUseMultipart: profile.hasS3Credentials,
  };
  return latestConnection;
};

export const getDiagnosticBundle = (): DiagnosticBundle => {
  const bootstrap = getBootstrapState();
  const profile = bootstrap.profiles.find((item) => item.id === bootstrap.activeProfileId) ?? null;
  const statuses: TransferStatus[] = ["queued", "running", "paused", "completed", "failed", "cancelled", "partial"];
  const transfers = transferManager.list();
  const transferSummary = Object.fromEntries(
    statuses.map((status) => [status, transfers.filter((item) => item.status === status).length])
  ) as Record<TransferStatus, number>;
  return {
    generatedAt: new Date().toISOString(),
    appVersion: app.getVersion(),
    platform: `${process.platform} ${os.release()} ${process.arch}`,
    profile: profile
      ? {
          id: profile.id.slice(0, 8),
          name: profile.name,
          jurisdiction: profile.jurisdiction,
          hasApiToken: profile.hasApiToken,
          hasS3Credentials: profile.hasS3Credentials,
        }
      : null,
    connection: latestConnection,
    recentErrors: recentErrors(),
    transferSummary,
  };
};

export const exportDiagnosticBundle = async () => {
  const zh = getBootstrapState().preferences.locale === "zh-CN";
  const result = await dialog.showSaveDialog({
    title: zh ? "导出诊断包" : "Export diagnostics",
    defaultPath: `r2uploader-diagnostics-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (result.canceled || !result.filePath) return null;
  fs.writeFileSync(result.filePath, JSON.stringify(getDiagnosticBundle(), null, 2), { mode: 0o600 });
  return result.filePath;
};
