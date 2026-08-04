import { clipboard, Notification } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AppError } from "../core/app-error";
import { isUsableDomain } from "../../shared/domain-status";
import { encodeObjectKey } from "./cloudflare-client";
import { getBootstrapState, getProfile } from "./config-vault";
import { registerDerivedFile } from "./local-file-registry";
import { chooseFiles } from "./local-file-registry";
import { planUploads } from "./upload-planner";
import { transferManager } from "./transfer-manager";
import { R2ObjectService } from "./r2-object-service";

const notify = (title: string, body: string) => { if (Notification.isSupported()) new Notification({ title, body }).show(); };
const isZh = () => getBootstrapState().preferences.locale === "zh-CN";

const settings = () => {
  const value = getBootstrapState().preferences.quickUpload;
  if (!value.enabled || !value.profileId || !value.bucket) throw new AppError({ kind: "VALIDATION", code: "QUICK_UPLOAD_NOT_CONFIGURED", message: "Quick Upload does not have a target yet.", action: "Open Settings and choose a connection, bucket, path, and link type.", retryable: false });
  return value;
};

const publicLink = async (profileId: string, bucket: string, key: string) => {
  const service = new R2ObjectService(getProfile(profileId));
  const info = (await service.listBuckets()).find((item) => item.name === bucket);
  const preferred = getBootstrapState().preferences.defaultShareDomains[`${profileId}:${bucket}`];
  const domain = info?.domains.find((item) => isUsableDomain(item) && item.domain === preferred) ?? info?.domains.find((item) => isUsableDomain(item) && item.type === "custom") ?? info?.domains.find((item) => isUsableDomain(item) && item.type === "managed");
  if (!domain) throw new AppError({ kind: "VALIDATION", code: "QUICK_PUBLIC_DOMAIN_UNAVAILABLE", message: "Quick Upload completed, but this bucket has no enabled public domain.", action: "Use temporary links or enable a public domain explicitly.", retryable: false });
  return `https://${domain.domain}/${encodeObjectKey(key)}`;
};

const waitAndCopy = async (ids: string[], profileId: string, bucket: string, keys: string[], shareKind: "temporary" | "public", expiresInSeconds: number) => {
  const deadline = Date.now() + 24 * 60 * 60_000;
  while (Date.now() < deadline) {
    const byId = new Map(transferManager.list().map((item) => [item.id, item]));
    const current = ids.map((id) => byId.get(id));
    if (current.some((item) => item && ["failed", "cancelled", "partial"].includes(item.status))) { notify(isZh() ? "R2Uploader 快速上传失败" : "R2Uploader quick upload failed", isZh() ? "请打开传输中心检查并重试失败项目。" : "Open Transfer Center to review and retry the failed item."); return; }
    if (current.every((item) => item?.status === "completed")) {
      try {
        const service = new R2ObjectService(getProfile(profileId));
        const links: string[] = [];
        const uploadedKeys = current.map((item, index) => item?.key || keys[index]);
        for (const key of uploadedKeys) links.push(shareKind === "temporary" ? (await service.temporaryShare(bucket, key, expiresInSeconds)).url : await publicLink(profileId, bucket, key));
        clipboard.writeText(links.join("\n"));
        notify(isZh() ? "R2Uploader 快速上传完成" : "R2Uploader quick upload complete", isZh() ? `已将 ${links.length} 个链接复制到剪贴板。` : `${links.length} link${links.length === 1 ? "" : "s"} copied to the clipboard.`);
      } catch (error) { notify(isZh() ? "上传完成，但链接不可用" : "Upload complete; link unavailable", error instanceof Error ? error.message : String(error)); }
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
};

const queue = async (handleIds: string[]) => {
  const target = settings();
  const bootstrap = getBootstrapState();
  const preferences = bootstrap.preferences;
  const plan = await planUploads({ profileId: target.profileId, bucket: target.bucket, prefix: target.prefix, handles: handleIds, imagePreset: preferences.uploadImagePreset, namingRule: preferences.uploadNamingRule });
  const ids = transferManager.enqueue({ profileId: target.profileId, bucket: target.bucket, entries: plan.map((item) => ({ handleId: item.handleId, targetKey: item.targetKey })), conflictPolicy: "rename", duplicatePolicy: "skip" });
  const profileName = bootstrap.profiles.find((profile) => profile.id === target.profileId)?.name ?? target.profileId;
  notify(isZh() ? "R2Uploader 快速上传" : "R2Uploader quick upload", isZh() ? `已将 ${ids.length} 个项目加入“${profileName}” · r2://${target.bucket}/${target.prefix} 的队列。` : `${ids.length} item${ids.length === 1 ? "" : "s"} queued for “${profileName}” · r2://${target.bucket}/${target.prefix}.`);
  void waitAndCopy(ids, target.profileId, target.bucket, plan.map((item) => item.targetKey), target.shareKind, target.expiresInSeconds);
  return { transferIds: ids, targets: plan.map((item) => item.targetKey) };
};

export const quickUploadClipboard = async () => {
  const image = clipboard.readImage();
  if (image.isEmpty()) throw new AppError({ kind: "VALIDATION", code: "CLIPBOARD_IMAGE_REQUIRED", message: "The clipboard does not contain an image.", action: "Copy an image or take a screenshot, then retry the shortcut.", retryable: false });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "r2uploader-clipboard-"));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(directory, `screenshot-${stamp}.png`);
  fs.writeFileSync(filePath, image.toPNG(), { mode: 0o600 });
  const handle = registerDerivedFile(filePath, path.basename(filePath));
  return queue([handle.id]);
};

export const quickUploadFiles = async () => {
  const handles = await chooseFiles();
  if (!handles.length) return null;
  return queue(handles.map((handle) => handle.id));
};
