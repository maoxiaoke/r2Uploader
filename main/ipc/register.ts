import { app, clipboard, dialog, ipcMain, shell } from "electron";
import { autoUpdater } from "electron-updater";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { IPC_CHANNELS, type AppResult, type ShareLink } from "../../shared/contracts";
import { isDomainReady, isUsableDomain } from "../../shared/domain-status";
import { AppError, toAppError } from "../core/app-error";
import { exportEncryptedSettings, getBootstrapState, getProfile, importEncryptedSettings, saveProfile, deleteProfile, switchProfile, updatePreferences, removeOpenAiApiKey } from "../services/config-vault";
import { getDiagnosticBundle, exportDiagnosticBundle, testConnection } from "../services/diagnostics";
import { rememberError } from "../services/error-log";
import { chooseDirectory, chooseFiles, chooseFolder, registerDroppedFile } from "../services/local-file-registry";
import { createFolder, planFolderOperation, planTrashFolderOperation } from "../services/folder-operations";
import { copyOrMoveObject, trashObject } from "../services/object-operations";
import { clearOperationHistory, listOperationHistory, recordOperation } from "../services/operation-history";
import { cachePrefixForOffline, cacheStats, clearObjectCache } from "../services/object-cache";
import { getBucketAnalytics } from "../services/analytics";
import { checkDomainHealth, getCors, getLifecycle, setCors, setLifecycle } from "../services/bucket-admin";
import { createPreviewGrant } from "../services/preview-service";
import { CloudflareClient, encodeObjectKey, encodePathSegment } from "../services/cloudflare-client";
import { R2ObjectService } from "../services/r2-object-service";
import { transferManager } from "../services/transfer-manager";
import { planUploads } from "../services/upload-planner";
import { clearAssetAiData, listAssetIndex, rebuildAssetIndex, updateAssetIndex, updateAssetMediaMetadata } from "../services/asset-index";
import { syncManager } from "../services/sync-manager";
import { backupManager } from "../services/backup-manager";
import { quickUploadClipboard, quickUploadFiles } from "../services/quick-upload";
import { eventRefreshManager } from "../services/event-refresh";
import { deleteAutomationRule, listAutomationRules, listAutomationRuns, saveAutomationRule } from "../services/automation";
import { companionStatus, startCompanion, stopCompanion } from "../services/companion-server";
import { analyzeIndexedAsset, configureOpenAi, semanticSearchAssets } from "../services/openai-ai";
import { recoverOperation } from "../services/history-recovery";
import { searchObjectKeys } from "../services/object-search";

type AsyncValue<T> = T | Promise<T>;

const handle = <T>(
  channel: string,
  schema: z.ZodType,
  callback: (input: any) => AsyncValue<T>
) => {
  ipcMain.handle(channel, async (_event, raw): Promise<AppResult<T>> => {
    try {
      const parsed = schema.parse(raw);
      return { ok: true, data: await callback(parsed) };
    } catch (error) {
      const problem = error instanceof z.ZodError
        ? {
            kind: "VALIDATION" as const,
            code: "INVALID_IPC_PAYLOAD",
            message: "The request contained invalid or unsafe parameters.",
            retryable: false,
            details: { fields: error.issues.map((issue) => issue.path.join(".")).join(", ") },
          }
        : toAppError(error);
      rememberError(problem);
      return { ok: false, error: problem };
    }
  });
};

const identifier = z.string().trim().min(1).max(256);
const bucketName = z.string().trim().min(1).max(255).regex(/^[^/\\\u0000-\u001F]+$/, "Invalid bucket name");
const cfBucketName = z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/, "Invalid R2 bucket name");
const objectKey = z.string().min(1).max(2_048);
const profileId = z.string().uuid();
const profileSchema = z.object({
  id: profileId.optional(),
  name: z.string().trim().min(1).max(80),
  accountId: z.string().trim().max(64),
  jurisdiction: z.enum(["default", "eu", "fedramp"]).optional(),
  endpoint: z.string().url().refine((value) => value.startsWith("https://"), "Endpoint must use HTTPS").optional().or(z.literal("")),
  apiToken: z.string().trim().min(1).max(4_096).optional().or(z.literal("")),
  accessKeyId: z.string().trim().min(1).max(512).optional().or(z.literal("")),
  secretAccessKey: z.string().trim().min(1).max(4_096).optional().or(z.literal("")),
  provider: z.enum(["r2", "s3"]).optional(),
  region: z.string().trim().min(1).max(128).optional(),
  forcePathStyle: z.boolean().optional(),
}).superRefine((value, context) => {
  if ((value.provider ?? "r2") === "r2" && !/^[a-fA-F0-9]{32}$/.test(value.accountId)) context.addIssue({ code: "custom", path: ["accountId"], message: "R2 Account ID must contain 32 hexadecimal characters" });
  if (value.provider === "s3" && !value.endpoint) context.addIssue({ code: "custom", path: ["endpoint"], message: "An HTTPS S3 endpoint is required" });
});

const activeService = (id?: string) => new R2ObjectService(getProfile(id));
const nativeText = (english: string, chinese: string) => getBootstrapState().preferences.locale === "zh-CN" ? chinese : english;

const publicShare = async (id: string, bucket: string, key: string): Promise<ShareLink> => {
  const service = activeService(id);
  const buckets = await service.listBuckets();
  const item = buckets.find((candidate) => candidate.name === bucket);
  const preferred = getBootstrapState().preferences.defaultShareDomains[`${id}:${bucket}`];
  const domain = item?.domains.find((candidate) => isUsableDomain(candidate) && candidate.domain === preferred)
    ?? item?.domains.find((candidate) => candidate.type === "custom" && isUsableDomain(candidate))
    ?? item?.domains.find((candidate) => candidate.type === "managed" && isUsableDomain(candidate));
  if (!domain) {
    throw new AppError({
      kind: "VALIDATION",
      code: "PUBLIC_DOMAIN_UNAVAILABLE",
      message: "This private bucket does not have an active public domain.",
      action: "Use a temporary link, or explicitly enable a public domain.",
      retryable: false,
    });
  }
  return { url: `https://${domain.domain}/${encodeObjectKey(key)}`, kind: "public" };
};

const safeDownloadName = (key: string) => {
  const fallback = key.split("/").filter(Boolean).pop() || "download";
  return fallback.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").slice(0, 180);
};

const downloadObject = async (input: { profileId: string; bucket: string; key: string }) => {
  const selection = await dialog.showSaveDialog({ defaultPath: safeDownloadName(input.key) });
  if (selection.canceled || !selection.filePath) return null;
  const transferId = await transferManager.enqueueDownload({ ...input, destinationPath: selection.filePath });
  return { filePath: selection.filePath, transferId };
};

export const registerIpcHandlers = () => {
  handle(IPC_CHANNELS.bootstrap, z.undefined().optional(), () => getBootstrapState());
  handle(
    IPC_CHANNELS.preferencesUpdate,
    z.object({
      locale: z.enum(["en", "zh-CN"]).optional(),
      theme: z.enum(["system", "light", "dark"]).optional(),
      reduceMotion: z.boolean().optional(),
      defaultView: z.enum(["grid", "list"]).optional(),
      transferConcurrency: z.number().int().min(1).max(8).optional(),
      cacheMaxBytes: z.number().int().min(0).max(100 * 1024 * 1024 * 1024).optional(),
      rememberSearches: z.boolean().optional(),
      favoriteLocations: z.array(z.string().max(4_096)).max(500).optional(),
      recentLocations: z.array(z.string().max(4_096)).max(50).optional(),
      searchHistory: z.array(z.string().max(2_048)).max(50).optional(),
      customShareTemplates: z.record(z.string().max(80), z.string().max(20_000)).optional(),
      profileDefaultViews: z.record(z.string().max(512), z.enum(["grid", "list"])).optional(),
      profileSearchHistories: z.record(z.string().max(128), z.array(z.string().max(2_048)).max(50)).optional(),
      profileShareTemplates: z.record(z.string().max(128), z.record(z.string().max(80), z.string().max(20_000))).optional(),
      defaultShareDomains: z.record(z.string().max(512), z.string().max(253)).optional(),
      offlineLocations: z.array(z.string().max(4_096)).max(500).optional(),
      uploadImagePreset: z.object({ enabled: z.boolean(), maxWidth: z.number().int().min(1).max(32_768).optional(), maxHeight: z.number().int().min(1).max(32_768).optional(), format: z.enum(["original", "webp", "avif", "jpeg"]), quality: z.number().int().min(1).max(100), keepOriginal: z.boolean() }).optional(),
      uploadNamingRule: z.object({ enabled: z.boolean(), template: z.string().min(1).max(512), project: z.string().max(128) }).optional(),
      refreshIntervalSeconds: z.number().int().min(0).max(3_600).optional(),
      quickUpload: z.object({ enabled: z.boolean(), profileId: z.string().max(128), bucket: z.string().max(64), prefix: z.string().max(2_048), shareKind: z.enum(["temporary", "public"]), expiresInSeconds: z.number().int().min(1).max(604_800) }).optional(),
      ai: z.object({ enabled: z.boolean(), visionModel: z.string().regex(/^[a-zA-Z0-9._-]{1,128}$/), embeddingModel: z.enum(["text-embedding-3-small", "text-embedding-3-large"]) }).optional(),
    }),
    (input) => {
      const preferences = updatePreferences(input);
      if (input.transferConcurrency) transferManager.setConcurrency(input.transferConcurrency);
      return preferences;
    }
  );
  handle(IPC_CHANNELS.profileSave, profileSchema, saveProfile);
  handle(IPC_CHANNELS.profileDelete, z.object({ profileId }), ({ profileId: id }) => {
    const unfinished = transferManager.unfinishedForProfile(id);
    if (unfinished.length) throw new AppError({ kind: "CONFLICT", code: "PROFILE_HAS_UNFINISHED_TRANSFERS", message: "This connection still has unfinished transfers.", action: "Finish or cancel its queued, running, and paused transfers before deleting the local connection.", retryable: false, details: { unfinishedTransfers: unfinished.length } });
    return deleteProfile(id);
  });
  handle(IPC_CHANNELS.profileSwitch, z.object({ profileId }), ({ profileId: id }) => switchProfile(id));
  handle(
    IPC_CHANNELS.profileTest,
    z.object({ profileId, bucket: bucketName.optional(), testWrite: z.boolean().optional() }),
    ({ profileId: id, bucket, testWrite }) => testConnection(id, bucket, testWrite)
  );

  handle(IPC_CHANNELS.bucketList, z.object({ profileId }), ({ profileId: id }) => activeService(id).listBuckets());
  handle(
    IPC_CHANNELS.bucketCreate,
    z.object({ profileId, name: bucketName, location: z.enum(["apac", "eeur", "enam", "weur", "wnam", "oc"]).optional() }),
    async ({ profileId: id, name, location }) => {
      const profile = getProfile(id);
      if (profile.provider === "s3") {
        const result = await activeService(id).createBucket(name);
        recordOperation({ action: "bucket-create", profileId: id, bucket: name, status: "success", reversible: false });
        return result;
      }
      if (!cfBucketName.safeParse(name).success) throw new AppError({ kind: "VALIDATION", code: "R2_BUCKET_NAME_INVALID", message: "Cloudflare R2 bucket names must be 3–64 lowercase letters, numbers, or hyphens.", retryable: false });
      const client = new CloudflareClient(profile);
      const result = await client.json(client.accountPath("/buckets"), {
        method: "POST",
        body: JSON.stringify({ name, locationHint: location, storageClass: "Standard" }),
      });
      recordOperation({ action: "bucket-create", profileId: id, bucket: name, status: "success", reversible: false });
      return result;
    }
  );
  handle(
    IPC_CHANNELS.bucketDelete,
    z.object({ profileId, name: bucketName, confirmation: z.string() }),
    async ({ profileId: id, name, confirmation }) => {
      if (confirmation !== name) {
        throw new AppError({ kind: "VALIDATION", code: "BUCKET_CONFIRMATION_MISMATCH", message: "Type the exact bucket name to confirm deletion.", retryable: false });
      }
      const profile = getProfile(id);
      if (profile.provider === "s3") await activeService(id).deleteBucket(name);
      else { const client = new CloudflareClient(profile); await client.raw(client.bucketPath(name), { method: "DELETE" }); }
      recordOperation({ action: "bucket-delete", profileId: id, bucket: name, status: "success", reversible: false });
      return true;
    }
  );
  handle(
    IPC_CHANNELS.bucketManagedDomain,
    z.object({ profileId, bucket: bucketName, enabled: z.boolean(), confirmation: z.boolean() }),
    async ({ profileId: id, bucket, enabled, confirmation }) => {
      if (!confirmation) throw new AppError({ kind: "VALIDATION", code: "PUBLIC_ACCESS_CONFIRMATION_REQUIRED", message: "Public access changes require explicit confirmation.", retryable: false });
      const client = new CloudflareClient(getProfile(id));
      const result = await client.json(client.bucketPath(bucket, "/domains/managed"), {
        method: "PUT",
        body: JSON.stringify({ enabled }),
      });
      recordOperation({ action: "domain-change", profileId: id, bucket, status: "success", reversible: false });
      return result;
    }
  );
  const domainName = z.string().trim().min(1).max(253).refine((value) => {
    try { const parsed = new URL(`https://${value}`); return parsed.hostname === value.toLowerCase() && !value.includes("/"); } catch { return false; }
  }, "Invalid domain name");
  handle(
    IPC_CHANNELS.bucketCustomDomainAttach,
    z.object({ profileId, bucket: bucketName, domain: domainName, zoneId: z.string().regex(/^[a-fA-F0-9]{32}$/), confirmation: z.literal(true) }),
    async ({ profileId: id, bucket, domain, zoneId }) => {
      const client = new CloudflareClient(getProfile(id));
      const result = await client.json(client.bucketPath(bucket, "/domains/custom"), { method: "POST", body: JSON.stringify({ domain, zoneId, enabled: false }) });
      recordOperation({ action: "domain-change", profileId: id, bucket, key: domain, status: "success", reversible: false });
      return result;
    }
  );
  handle(
    IPC_CHANNELS.bucketCustomDomainUpdate,
    z.object({ profileId, bucket: bucketName, domain: domainName, enabled: z.boolean(), confirmation: z.literal(true) }),
    async ({ profileId: id, bucket, domain, enabled }) => {
      if (enabled) {
        const info = (await activeService(id).listBuckets()).find((item) => item.name === bucket);
        const current = info?.domains.find((item) => item.type === "custom" && item.domain === domain);
        if (!current || !isDomainReady(current)) throw new AppError({ kind: "CONFLICT", code: "CUSTOM_DOMAIN_NOT_READY", message: "The custom domain ownership or SSL status is not active yet.", action: "Refresh domain states after Cloudflare finishes ownership and certificate provisioning.", retryable: true });
      }
      const client = new CloudflareClient(getProfile(id));
      const result = await client.json(client.bucketPath(bucket, `/domains/custom/${encodePathSegment(domain)}`), { method: "PUT", body: JSON.stringify({ enabled }) });
      recordOperation({ action: "domain-change", profileId: id, bucket, key: domain, status: "success", reversible: false });
      return result;
    }
  );
  handle(
    IPC_CHANNELS.bucketCustomDomainRemove,
    z.object({ profileId, bucket: bucketName, domain: domainName, confirmation: domainName }).refine((value) => value.confirmation === value.domain, { path: ["confirmation"], message: "Type the exact domain to remove it" }),
    async ({ profileId: id, bucket, domain }) => {
      const client = new CloudflareClient(getProfile(id));
      await client.raw(client.bucketPath(bucket, `/domains/custom/${encodePathSegment(domain)}`), { method: "DELETE" });
      recordOperation({ action: "domain-change", profileId: id, bucket, key: domain, status: "success", reversible: false });
      return true;
    }
  );
  handle(
    IPC_CHANNELS.bucketAnalytics,
    z.object({ profileId, bucket: bucketName, days: z.number().int().min(1).max(31).optional() }),
    ({ profileId: id, bucket, days }) => getBucketAnalytics(getProfile(id), bucket, days)
  );
  const lifecycleRuleSchema = z.object({
    id: z.string().trim().regex(/^[a-zA-Z0-9._-]{1,64}$/),
    prefix: z.string().max(1_024),
    enabled: z.boolean(),
    deleteAfterDays: z.number().min(1).max(36_500).optional(),
    abortMultipartAfterDays: z.number().min(1).max(365).optional(),
    transitionToInfrequentAfterDays: z.number().min(30).max(36_500).optional(),
  });
  handle(IPC_CHANNELS.bucketLifecycleGet, z.object({ profileId, bucket: bucketName }), ({ profileId: id, bucket }) => getLifecycle(getProfile(id), bucket));
  handle(
    IPC_CHANNELS.bucketLifecycleSet,
    z.object({ profileId, bucket: bucketName, rules: z.array(lifecycleRuleSchema).max(100), confirmation: z.boolean() }),
    async ({ profileId: id, bucket, rules, confirmation }) => {
      if (!confirmation) throw new AppError({ kind: "VALIDATION", code: "LIFECYCLE_CONFIRMATION_REQUIRED", message: "Lifecycle changes require an explicit impact confirmation.", retryable: false });
      const result = await setLifecycle(getProfile(id), bucket, rules);
      recordOperation({ action: "lifecycle-change", profileId: id, bucket, key: `${rules.length} rule(s)`, status: "success", reversible: false });
      return result;
    }
  );
  const corsRuleSchema = z.object({
    id: z.string().max(64).optional(),
    origins: z.array(z.string().max(2_048).refine((value) => value === "*" || /^https?:\/\//.test(value), "Origin must be * or an HTTP(S) origin")).min(1).max(100),
    methods: z.array(z.enum(["GET", "PUT", "POST", "DELETE", "HEAD"])).min(1).max(5),
    headers: z.array(z.string().max(256)).max(100).optional(),
    exposeHeaders: z.array(z.string().max(256)).max(100).optional(),
    maxAgeSeconds: z.number().int().min(0).max(86_400).optional(),
  });
  handle(IPC_CHANNELS.bucketCorsGet, z.object({ profileId, bucket: bucketName }), ({ profileId: id, bucket }) => getCors(getProfile(id), bucket));
  handle(
    IPC_CHANNELS.bucketCorsSet,
    z.object({ profileId, bucket: bucketName, rules: z.array(corsRuleSchema).max(100), confirmation: z.boolean() }),
    async ({ profileId: id, bucket, rules, confirmation }) => {
      if (!confirmation) throw new AppError({ kind: "VALIDATION", code: "CORS_CONFIRMATION_REQUIRED", message: "CORS changes require an explicit confirmation.", retryable: false });
      const result = await setCors(getProfile(id), bucket, rules);
      recordOperation({ action: "cors-change", profileId: id, bucket, key: rules.length ? `${rules.length} rule(s)` : "removed", status: "success", reversible: false });
      return result;
    }
  );
  handle(
    IPC_CHANNELS.bucketDomainHealth,
    z.object({ profileId, bucket: bucketName, domain: z.string().max(253), key: z.string().max(2_048).optional() }),
    async ({ profileId: id, bucket, domain, key }) => {
      const service = activeService(id);
      const info = (await service.listBuckets()).find((item) => item.name === bucket);
      if (!info?.domains.some((item) => item.domain === domain)) throw new AppError({ kind: "PERMISSION", code: "DOMAIN_NOT_OWNED_BY_BUCKET", message: "The requested health-check domain is not attached to this bucket.", retryable: false });
      return checkDomainHealth(`https://${domain}/${key ? encodeObjectKey(key) : ""}`);
    }
  );
  handle(IPC_CHANNELS.bucketEventList, z.object({ profileId, bucket: bucketName }), ({ profileId: id, bucket }) => eventRefreshManager.list(id, bucket));
  handle(IPC_CHANNELS.bucketEventSubscribe, z.object({ profileId, bucket: bucketName, queueId: z.string().regex(/^[a-fA-F0-9]{32}$/), dedicatedQueueConfirmation: z.literal(true) }), ({ profileId: id, bucket, queueId }) => eventRefreshManager.subscribe({ profileId: id, bucket, queueId }));
  handle(IPC_CHANNELS.bucketEventPause, z.object({ id: z.string().uuid(), paused: z.boolean() }), ({ id, paused }) => eventRefreshManager.pause(id, paused));

  const listSchema = z.object({
    profileId,
    bucket: bucketName,
    prefix: z.string().max(2_048).optional(),
    cursor: z.string().max(4_096).optional(),
    delimiter: z.string().max(1).optional(),
    limit: z.number().int().min(1).max(1_000).optional(),
  });
  handle(IPC_CHANNELS.objectList, listSchema, (input) => activeService(input.profileId).listObjects(input));
  handle(IPC_CHANNELS.objectSearch, z.object({ profileId, bucket: bucketName, query: z.string().trim().min(1).max(2_048) }), ({ profileId: id, bucket, query }) => searchObjectKeys(activeService(id), bucket, query));
  const objectSchema = z.object({ profileId, bucket: bucketName, key: objectKey });
  handle(IPC_CHANNELS.objectHead, objectSchema, ({ profileId: id, bucket, key }) => activeService(id).headObject(bucket, key));
  handle(
    IPC_CHANNELS.objectMetadataUpdate,
    objectSchema.extend({
      contentType: z.string().trim().max(512).optional(),
      cacheControl: z.string().trim().max(1_024).optional(),
      contentDisposition: z.string().trim().max(1_024).optional(),
      contentEncoding: z.string().trim().max(256).optional(),
      contentLanguage: z.string().trim().max(256).optional(),
      customMetadata: z.record(z.string().regex(/^[a-zA-Z0-9._-]{1,128}$/), z.string().max(2_048)).optional(),
    }),
    async ({ profileId: id, bucket, key, ...metadata }) => {
      const result = await activeService(id).updateMetadata(bucket, key, metadata);
      recordOperation({ action: "metadata", profileId: id, bucket, key, status: "success", reversible: false });
      return result;
    }
  );
  handle(IPC_CHANNELS.objectPreview, objectSchema, ({ profileId: id, bucket, key }) => createPreviewGrant(id, bucket, key));
  handle(
    IPC_CHANNELS.objectShare,
    objectSchema.extend({ kind: z.enum(["public", "temporary"]), expiresInSeconds: z.number().int().min(1).max(604_800).optional() }),
    ({ profileId: id, bucket, key, kind, expiresInSeconds }) =>
      kind === "public"
        ? publicShare(id, bucket, key)
        : activeService(id).temporaryShare(bucket, key, expiresInSeconds ?? 3_600)
  );
  handle(
    IPC_CHANNELS.objectRename,
    objectSchema.extend({ targetKey: objectKey, overwrite: z.boolean().optional() }),
    ({ profileId: id, bucket, key, targetKey, overwrite }) => copyOrMoveObject(getProfile(id), { sourceBucket: bucket, sourceKey: key, targetBucket: bucket, targetKey, move: true, overwrite })
  );
  handle(
    IPC_CHANNELS.objectCopy,
    objectSchema.extend({ targetBucket: bucketName, targetKey: objectKey, move: z.boolean().optional(), conflictPolicy: z.enum(["ask", "skip", "overwrite", "rename"]).optional(), overwrite: z.boolean().optional() }),
    ({ profileId: id, bucket, key, targetBucket, targetKey, move, conflictPolicy, overwrite }) => {
      const transferIds = transferManager.enqueueRemote({
        profileId: id,
        entries: [{ sourceBucket: bucket, sourceKey: key, targetBucket, targetKey, move: Boolean(move) }],
        conflictPolicy: conflictPolicy ?? (overwrite ? "overwrite" : "ask"),
      });
      return { total: 1, queued: 1, transferIds };
    }
  );
  handle(IPC_CHANNELS.objectTrash, objectSchema, ({ profileId: id, bucket, key }) => trashObject(getProfile(id), bucket, key));
  handle(
    IPC_CHANNELS.objectRestore,
    z.object({ profileId, bucket: bucketName, trashKey: objectKey, originalKey: objectKey, overwrite: z.boolean().optional() }),
    ({ profileId: id, bucket, trashKey, originalKey, overwrite }) => copyOrMoveObject(getProfile(id), { sourceBucket: bucket, sourceKey: trashKey, targetBucket: bucket, targetKey: originalKey, move: true, overwrite })
  );
  handle(
    IPC_CHANNELS.objectDelete,
    objectSchema.extend({ confirmation: z.literal(true) }),
    async ({ profileId: id, bucket, key }) => {
      await activeService(id).deleteObject(bucket, key);
      recordOperation({ action: "delete", profileId: id, bucket, key, status: "success", reversible: false });
      return true;
    }
  );
  handle(IPC_CHANNELS.objectDownload, objectSchema, downloadObject);
  handle(
    IPC_CHANNELS.folderCreate,
    z.object({ profileId, bucket: bucketName, prefix: objectKey }),
    ({ profileId: id, bucket, prefix }) => createFolder(getProfile(id), bucket, prefix)
  );
  handle(
    IPC_CHANNELS.folderOperate,
    z.discriminatedUnion("operation", [
      z.object({ operation: z.literal("trash"), profileId, sourceBucket: bucketName, sourcePrefix: objectKey }),
      z.object({ operation: z.enum(["copy", "move"]), profileId, sourceBucket: bucketName, sourcePrefix: objectKey, targetBucket: bucketName, targetPrefix: objectKey, conflictPolicy: z.enum(["ask", "skip", "overwrite", "rename"]).optional(), overwrite: z.boolean().optional() }),
    ]),
    async (input) => {
      if (input.operation === "trash") {
        const entries = await planTrashFolderOperation(getProfile(input.profileId), input.sourceBucket, input.sourcePrefix);
        const transferIds = transferManager.enqueueRemote({ profileId: input.profileId, entries, conflictPolicy: "ask" });
        return { total: entries.length, queued: transferIds.length, transferIds };
      }
      const entries = await planFolderOperation(getProfile(input.profileId), {
        sourceBucket: input.sourceBucket,
        sourcePrefix: input.sourcePrefix,
        targetBucket: input.targetBucket,
        targetPrefix: input.targetPrefix,
        move: input.operation === "move",
      });
      const transferIds = transferManager.enqueueRemote({
        profileId: input.profileId,
        entries,
        conflictPolicy: input.conflictPolicy ?? (input.overwrite ? "overwrite" : "ask"),
      });
      return { total: entries.length, queued: transferIds.length, transferIds };
    }
  );

  handle(
    IPC_CHANNELS.uploadEnqueue,
    z.object({ profileId, bucket: bucketName, prefix: z.string().max(2_048).optional(), handles: z.array(z.string().uuid()).min(1).max(10_000).optional(), entries: z.array(z.object({ handleId: z.string().uuid(), targetKey: objectKey })).min(1).max(10_000).optional(), conflictPolicy: z.enum(["ask", "skip", "overwrite", "rename"]).optional(), duplicatePolicy: z.enum(["ask", "skip", "upload"]).optional() }).refine((value) => Boolean(value.handles?.length || value.entries?.length), "At least one upload source is required"),
    transferManager.enqueue.bind(transferManager)
  );
  handle(
    IPC_CHANNELS.uploadPlan,
    z.object({
      profileId,
      bucket: bucketName,
      prefix: z.string().max(2_048).optional(),
      handles: z.array(z.string().uuid()).min(1).max(10_000),
      imagePreset: z.object({ enabled: z.boolean(), maxWidth: z.number().int().min(1).max(32_768).optional(), maxHeight: z.number().int().min(1).max(32_768).optional(), format: z.enum(["original", "webp", "avif", "jpeg"]), quality: z.number().int().min(1).max(100), keepOriginal: z.boolean() }),
      namingRule: z.object({ enabled: z.boolean(), template: z.string().min(1).max(512), project: z.string().max(128) }),
    }),
    planUploads
  );
  handle(IPC_CHANNELS.uploadClipboard, z.undefined().optional(), quickUploadClipboard);
  handle(IPC_CHANNELS.uploadQuickFiles, z.undefined().optional(), quickUploadFiles);
  handle(IPC_CHANNELS.transferList, z.undefined().optional(), () => transferManager.list());
  handle(IPC_CHANNELS.transferCancel, z.object({ id: z.string().uuid() }), ({ id }) => transferManager.cancel(id));
  handle(IPC_CHANNELS.transferPause, z.object({ id: z.string().uuid() }), ({ id }) => transferManager.pause(id));
  handle(IPC_CHANNELS.transferRetry, z.object({ id: z.string().uuid() }), ({ id }) => transferManager.retry(id));
  handle(IPC_CHANNELS.transferClear, z.undefined().optional(), () => transferManager.clearFinished());
  handle(IPC_CHANNELS.transferOpenDownload, z.object({ id: z.string().uuid() }), ({ id }) => transferManager.openDownload(id));
  handle(IPC_CHANNELS.transferRevealDownload, z.object({ id: z.string().uuid() }), ({ id }) => transferManager.revealDownload(id));
  handle(IPC_CHANNELS.fileChoose, z.undefined().optional(), chooseFiles);
  handle(IPC_CHANNELS.folderChoose, z.undefined().optional(), chooseFolder);
  handle(IPC_CHANNELS.directoryChoose, z.undefined().optional(), chooseDirectory);
  handle(
    IPC_CHANNELS.droppedFileRegister,
    z.object({ path: z.string().min(1).max(32_768), name: z.string().max(512).optional(), size: z.number().nonnegative().optional(), relativePath: z.string().max(4_096).optional() }),
    registerDroppedFile
  );

  handle(IPC_CHANNELS.diagnosticsGet, z.undefined().optional(), getDiagnosticBundle);
  handle(IPC_CHANNELS.diagnosticsExport, z.undefined().optional(), exportDiagnosticBundle);
  handle(IPC_CHANNELS.historyList, z.undefined().optional(), listOperationHistory);
  handle(IPC_CHANNELS.historyRecover, z.object({ id: z.string().uuid(), confirmation: z.literal(true) }), ({ id }) => recoverOperation(id));
  handle(IPC_CHANNELS.historyClear, z.object({ confirmation: z.literal(true) }), clearOperationHistory);
  handle(IPC_CHANNELS.assetIndexList, z.object({ profileId: profileId.optional(), bucket: bucketName.optional(), query: z.string().max(2_048).optional() }).optional(), (input) => listAssetIndex(input));
  handle(IPC_CHANNELS.assetIndexRebuild, z.object({ profileId, bucket: bucketName }), ({ profileId: id, bucket }) => rebuildAssetIndex(id, bucket, activeService(id)));
  handle(IPC_CHANNELS.assetIndexUpdate, z.object({ id: z.string().uuid(), tags: z.array(z.string().trim().min(1).max(128)).max(100).optional(), aiDescription: z.string().max(10_000).optional() }), ({ id, ...input }) => updateAssetIndex(id, input));
  handle(IPC_CHANNELS.assetMediaMetadataUpdate, z.object({ profileId, bucket: bucketName, key: objectKey, durationSeconds: z.number().nonnegative().max(31_536_000), width: z.number().int().positive().max(65_535).optional(), height: z.number().int().positive().max(65_535).optional() }), updateAssetMediaMetadata);
  handle(IPC_CHANNELS.aiConfigure, z.object({ apiKey: z.string().trim().min(1).max(4_096).optional().or(z.literal("")), enabled: z.boolean(), visionModel: z.string().regex(/^[a-zA-Z0-9._-]{1,128}$/), embeddingModel: z.enum(["text-embedding-3-small", "text-embedding-3-large"]), test: z.boolean() }), configureOpenAi);
  handle(IPC_CHANNELS.aiRemoveKey, z.object({ confirmation: z.literal(true) }), () => { removeOpenAiApiKey(); return clearAssetAiData(); });
  handle(IPC_CHANNELS.aiAnalyze, z.object({ id: z.string().uuid(), explicitDataSharingConfirmation: z.literal(true) }), ({ id }) => analyzeIndexedAsset(id));
  handle(IPC_CHANNELS.aiSemanticSearch, z.object({ profileId, bucket: bucketName, query: z.string().trim().min(1).max(2_000), limit: z.number().int().min(1).max(100).optional() }), ({ limit, ...input }) => semanticSearchAssets({ ...input, limit: limit ?? 30 }));
  handle(IPC_CHANNELS.syncList, z.undefined().optional(), () => syncManager.list());
  handle(IPC_CHANNELS.syncSave, z.object({ id: z.string().uuid().optional(), name: z.string().trim().min(1).max(100), profileId, bucket: bucketName, prefix: z.string().max(2_048), directoryId: z.string().uuid().optional(), excludes: z.array(z.string().min(1).max(512)).max(100), conflictPolicy: z.enum(["ask", "skip", "overwrite", "rename"]), enabled: z.boolean() }), (input) => syncManager.save(input));
  handle(IPC_CHANNELS.syncRun, z.object({ id: z.string().uuid(), previewOnly: z.boolean() }), ({ id, previewOnly }) => syncManager.run(id, previewOnly));
  handle(IPC_CHANNELS.syncPause, z.object({ id: z.string().uuid(), paused: z.boolean() }), ({ id, paused }) => syncManager.pause(id, paused));
  handle(IPC_CHANNELS.syncDelete, z.object({ id: z.string().uuid(), confirmation: z.literal(true) }), ({ id }) => syncManager.delete(id));
  handle(IPC_CHANNELS.backupList, z.undefined().optional(), () => backupManager.list());
  handle(IPC_CHANNELS.backupSave, z.object({ id: z.string().uuid().optional(), name: z.string().trim().min(1).max(100), profileId, bucket: bucketName, prefix: z.string().max(2_048), directoryId: z.string().uuid().optional(), schedule: z.enum(["manual", "daily", "weekly"]), keepLast: z.number().int().min(1).max(100), enabled: z.boolean() }), (input) => backupManager.save(input));
  handle(IPC_CHANNELS.backupRun, z.object({ id: z.string().uuid() }), ({ id }) => backupManager.run(id));
  handle(IPC_CHANNELS.backupRestore, z.object({ id: z.string().uuid(), keyPrefix: z.string().min(1).max(2_048).optional(), targetPrefix: z.string().max(2_048).optional(), confirmation: z.literal(true) }), ({ id, keyPrefix, targetPrefix }) => backupManager.restore(id, keyPrefix, targetPrefix));
  handle(IPC_CHANNELS.backupDelete, z.object({ id: z.string().uuid(), confirmation: z.literal(true) }), ({ id }) => backupManager.delete(id));
  handle(IPC_CHANNELS.automationList, z.object({ profileId: profileId.optional() }).optional(), (input) => listAutomationRules(input?.profileId));
  handle(IPC_CHANNELS.automationRuns, z.object({ profileId: profileId.optional() }).optional(), (input) => listAutomationRuns(input?.profileId));
  handle(IPC_CHANNELS.automationSave, z.object({ id: z.string().uuid().optional(), name: z.string().trim().min(1).max(100), profileId, bucket: bucketName, prefix: z.string().max(2_048), enabled: z.boolean(), notify: z.boolean(), copyLink: z.enum(["none", "temporary", "public"]), expiresInSeconds: z.number().int().min(1).max(604_800), copyToBucket: bucketName.optional().or(z.literal("")), copyToPrefix: z.string().max(2_048).optional() }), (input) => {
    const rule = saveAutomationRule(input);
    recordOperation({ action: "automation-change", profileId: rule.profileId, bucket: rule.bucket, key: rule.name, status: "success", reversible: false });
    return rule;
  });
  handle(IPC_CHANNELS.automationDelete, z.object({ id: z.string().uuid(), confirmation: z.literal(true) }), ({ id }) => {
    const rule = listAutomationRules().find((item) => item.id === id);
    const result = deleteAutomationRule(id);
    if (rule) recordOperation({ action: "automation-change", profileId: rule.profileId, bucket: rule.bucket, key: `deleted: ${rule.name}`, status: "success", reversible: false });
    return result;
  });
  handle(IPC_CHANNELS.companionStart, z.object({ profileId, bucket: bucketName, prefix: z.string().max(2_048), expiresInMinutes: z.number().int().min(5).max(120), localNetworkConfirmation: z.literal(true) }), ({ localNetworkConfirmation: _confirmation, ...input }) => startCompanion(input));
  handle(IPC_CHANNELS.companionStop, z.object({ confirmation: z.literal(true) }), stopCompanion);
  handle(IPC_CHANNELS.companionStatus, z.undefined().optional(), companionStatus);
  handle(IPC_CHANNELS.cacheStats, z.undefined().optional(), cacheStats);
  handle(IPC_CHANNELS.cacheClear, z.object({ confirmation: z.literal(true) }), clearObjectCache);
  handle(IPC_CHANNELS.cachePinPrefix, z.object({ profileId, bucket: bucketName, prefix: z.string().max(2_048), confirmation: z.literal(true) }), ({ confirmation: _confirmation, ...input }) => cachePrefixForOffline(input));
  handle(IPC_CHANNELS.updateCheck, z.undefined().optional(), async () => {
    if (!app.isPackaged || !fs.existsSync(path.join(process.resourcesPath, "app-update.yml"))) {
      return { state: "current", message: nativeText("Update checks are unavailable in this local test build.", "本地测试包不提供更新检查。") };
    }
    await autoUpdater.checkForUpdates();
    return { state: "checking" };
  });
  handle(IPC_CHANNELS.updateInstall, z.object({ confirmation: z.literal(true) }), () => {
    autoUpdater.quitAndInstall();
    return true;
  });
  handle(IPC_CHANNELS.settingsExportEncrypted, z.object({ passphrase: z.string().min(12).max(1_024), includeSecrets: z.boolean() }), async ({ passphrase, includeSecrets }) => {
    const selection = await dialog.showSaveDialog({ title: nativeText("Export encrypted R2Uploader settings", "导出加密的 R2Uploader 设置"), defaultPath: `r2uploader-settings-${new Date().toISOString().slice(0, 10)}.r2ue2e`, filters: [{ name: nativeText("R2Uploader encrypted backup", "R2Uploader 加密备份"), extensions: ["r2ue2e"] }] });
    if (selection.canceled || !selection.filePath) return null;
    fs.writeFileSync(selection.filePath, exportEncryptedSettings(passphrase, includeSecrets), { mode: 0o600 });
    return selection.filePath;
  });
  handle(IPC_CHANNELS.settingsImportEncrypted, z.object({ passphrase: z.string().min(12).max(1_024), mode: z.enum(["merge", "replace"]), confirmation: z.literal(true) }), async ({ passphrase, mode }) => {
    const selection = await dialog.showOpenDialog({ title: nativeText("Import encrypted R2Uploader settings", "导入加密的 R2Uploader 设置"), properties: ["openFile"], filters: [{ name: nativeText("R2Uploader encrypted backup", "R2Uploader 加密备份"), extensions: ["r2ue2e"] }] });
    const filePath = selection.filePaths[0];
    if (selection.canceled || !filePath) return null;
    const stat = fs.statSync(filePath);
    if (stat.size > 20 * 1024 * 1024) throw new AppError({ kind: "VALIDATION", code: "SETTINGS_BACKUP_TOO_LARGE", message: "The settings backup exceeds the 20 MB safety limit.", retryable: false });
    return importEncryptedSettings(fs.readFileSync(filePath), passphrase, mode);
  });
  handle(
    IPC_CHANNELS.externalOpen,
    z.object({ url: z.string().url() }),
    async ({ url }) => {
      const parsed = new URL(url);
      const allowedHosts = ["cloudflare.com", "github.com", "openai.com", "openai.github.io", "x.com", "lemonsqueezy.com"];
      const allowed = parsed.protocol === "https:" && allowedHosts.some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`));
      if (!allowed) throw new AppError({ kind: "PERMISSION", code: "EXTERNAL_URL_BLOCKED", message: "This external destination is not trusted by the app.", retryable: false });
      await shell.openExternal(parsed.toString());
      return true;
    }
  );
  handle(IPC_CHANNELS.clipboardWrite, z.object({ text: z.string().max(5_000_000) }), ({ text }) => {
    clipboard.writeText(text);
    return true;
  });
  handle(IPC_CHANNELS.textExport, z.object({ defaultName: z.string().regex(/^[a-zA-Z0-9._-]{1,200}$/), text: z.string().max(5_000_000), extension: z.string().regex(/^[a-zA-Z0-9]{1,12}$/).optional() }), async ({ defaultName, text, extension }) => {
    const selection = await dialog.showSaveDialog({ title: nativeText("Export text file", "导出文本文件"), defaultPath: defaultName, filters: extension ? [{ name: extension.toUpperCase(), extensions: [extension] }] : undefined });
    if (selection.canceled || !selection.filePath) return null;
    fs.writeFileSync(selection.filePath, text, { encoding: "utf8", mode: 0o600 });
    return selection.filePath;
  });
};
