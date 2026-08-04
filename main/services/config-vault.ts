import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import type {
  AppPreferences,
  AutomationRule,
  BackupTask,
  BootstrapState,
  Jurisdiction,
  ProfileInput,
  ProfileSummary,
  SyncTask,
} from "../../shared/contracts";
import { AppError } from "../core/app-error";
import { getConfigPath } from "../helpers/get-config";
import { safeParse } from "../helpers/json";
import { readJson, writeJson } from "./json-store";

interface StoredSecrets {
  apiToken?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

interface StoredProfile {
  id: string;
  name: string;
  accountId: string;
  jurisdiction: Jurisdiction;
  endpoint?: string;
  secrets: StoredSecrets;
  createdAt: string;
  updatedAt: string;
  provider?: "r2" | "s3";
  region?: string;
  forcePathStyle?: boolean;
}

interface VaultData {
  version: 2;
  activeProfileId?: string;
  profiles: StoredProfile[];
  preferences: AppPreferences;
  migratedLegacyCredentials: boolean;
  openAiApiKey?: string;
}

export interface ProfileCredentials extends ProfileSummary {
  apiToken?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

const DEFAULT_PREFERENCES: AppPreferences = {
  locale: "zh-CN",
  theme: "system",
  reduceMotion: false,
  defaultView: "grid",
  transferConcurrency: 3,
  cacheMaxBytes: 512 * 1024 * 1024,
  rememberSearches: true,
  favoriteLocations: [],
  recentLocations: [],
  searchHistory: [],
  customShareTemplates: {},
  profileDefaultViews: {},
  profileSearchHistories: {},
  profileShareTemplates: {},
  defaultShareDomains: {},
  offlineLocations: [],
  uploadImagePreset: { enabled: false, format: "webp", quality: 82, keepOriginal: false, maxWidth: 2_560, maxHeight: 2_560 },
  uploadNamingRule: { enabled: false, template: "{name}", project: "" },
  refreshIntervalSeconds: 60,
  quickUpload: { enabled: false, profileId: "", bucket: "", prefix: "quick", shareKind: "temporary", expiresInSeconds: 3_600 },
  ai: { enabled: false, visionModel: "gpt-4o-mini", embeddingModel: "text-embedding-3-small" },
};

const vaultPath = () => path.join(app.getPath("userData"), "r2uploader-v2.json");

const emptyVault = (): VaultData => ({
  version: 2,
  profiles: [],
  preferences: DEFAULT_PREFERENCES,
  migratedLegacyCredentials: false,
});

const readVault = (): VaultData => {
  const stored = safeParse(vaultPath(), emptyVault()) as Partial<VaultData>;
  return {
    ...emptyVault(),
    ...stored,
    version: 2,
    profiles: Array.isArray(stored.profiles) ? stored.profiles : [],
    preferences: {
      ...DEFAULT_PREFERENCES,
      ...(stored.preferences ?? {}),
      uploadImagePreset: { ...DEFAULT_PREFERENCES.uploadImagePreset, ...(stored.preferences?.uploadImagePreset ?? {}) },
      uploadNamingRule: { ...DEFAULT_PREFERENCES.uploadNamingRule, ...(stored.preferences?.uploadNamingRule ?? {}) },
      quickUpload: { ...DEFAULT_PREFERENCES.quickUpload, ...(stored.preferences?.quickUpload ?? {}) },
      ai: { ...DEFAULT_PREFERENCES.ai, ...(stored.preferences?.ai ?? {}) },
    },
  };
};

const writeVault = (data: VaultData) => {
  const target = vaultPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, target);
  try {
    fs.chmodSync(target, 0o600);
  } catch {
    // Windows permissions are governed by the current user's profile ACL.
  }
};

const ensureEncryption = () => {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new AppError({
      kind: "UNAVAILABLE",
      code: "VAULT_UNAVAILABLE",
      message: "The operating system credential vault is not available yet.",
      action: "Unlock your user session and try again.",
      retryable: true,
    });
  }
};

const encrypt = (value?: string) => {
  if (!value) return undefined;
  ensureEncryption();
  return safeStorage.encryptString(value).toString("base64");
};

const decrypt = (value?: string) => {
  if (!value) return undefined;
  ensureEncryption();
  return safeStorage.decryptString(Buffer.from(value, "base64"));
};

const lastFour = (value?: string) => (value && value.length >= 4 ? value.slice(-4) : undefined);

const summary = (profile: StoredProfile): ProfileSummary => {
  let apiToken: string | undefined;
  let accessKeyId: string | undefined;
  try {
    apiToken = decrypt(profile.secrets.apiToken);
    accessKeyId = decrypt(profile.secrets.accessKeyId);
  } catch {
    // Bootstrap must remain readable even when the system vault is temporarily locked.
  }
  return {
    id: profile.id,
    name: profile.name,
    accountId: profile.accountId,
    jurisdiction: profile.jurisdiction,
    endpoint: profile.endpoint,
    hasApiToken: Boolean(profile.secrets.apiToken),
    hasS3Credentials: Boolean(profile.secrets.accessKeyId && profile.secrets.secretAccessKey),
    apiTokenLastFour: lastFour(apiToken),
    accessKeyLastFour: lastFour(accessKeyId),
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    provider: profile.provider ?? "r2",
    region: profile.region ?? "auto",
    forcePathStyle: profile.forcePathStyle ?? false,
  };
};

export const migrateLegacyCredentials = () => {
  const data = readVault();
  if (data.migratedLegacyCredentials) return false;

  const legacyPath = getConfigPath();
  const legacy = safeParse(legacyPath, {}) as Record<string, unknown>;
  const accountId = typeof legacy.accountId === "string" ? legacy.accountId.trim() : "";
  const apiToken = typeof legacy.r2Token === "string" ? legacy.r2Token.trim() : "";
  let migrated = false;

  if (accountId && apiToken && data.profiles.length === 0) {
    const now = new Date().toISOString();
    const id = randomUUID();
    data.profiles.push({
      id,
      name: "Migrated R2 account",
      accountId,
      jurisdiction: "default",
      secrets: { apiToken: encrypt(apiToken) },
      createdAt: now,
      updatedAt: now,
    });
    data.activeProfileId = id;
    migrated = true;
  }

  data.migratedLegacyCredentials = true;
  writeVault(data);

  if (apiToken && fs.existsSync(legacyPath)) {
    const { r2Token: _removed, license: _license, ...sanitized } = legacy;
    fs.writeFileSync(legacyPath, JSON.stringify(sanitized, null, 2), { mode: 0o600 });
  }

  return migrated;
};

export const getBootstrapState = (): BootstrapState => {
  const data = readVault();
  return {
    version: app.getVersion(),
    platform: process.platform,
    activeProfileId: data.activeProfileId,
    profiles: data.profiles.map(summary),
    preferences: data.preferences,
    vaultAvailable: safeStorage.isEncryptionAvailable(),
    migratedLegacyCredentials: data.migratedLegacyCredentials,
    hasOpenAiApiKey: Boolean(data.openAiApiKey),
  };
};

export const saveProfile = (input: ProfileInput): ProfileSummary => {
  ensureEncryption();
  const data = readVault();
  const existing = input.id ? data.profiles.find((item) => item.id === input.id) : undefined;
  const now = new Date().toISOString();
  const id = existing?.id ?? randomUUID();
  const profile: StoredProfile = {
    id,
    name: input.name.trim(),
    accountId: input.accountId.trim(),
    jurisdiction: input.jurisdiction ?? existing?.jurisdiction ?? "default",
    endpoint: input.endpoint?.trim() || existing?.endpoint,
    secrets: {
      apiToken: input.apiToken ? encrypt(input.apiToken.trim()) : existing?.secrets.apiToken,
      accessKeyId: input.accessKeyId ? encrypt(input.accessKeyId.trim()) : existing?.secrets.accessKeyId,
      secretAccessKey: input.secretAccessKey
        ? encrypt(input.secretAccessKey.trim())
        : existing?.secrets.secretAccessKey,
    },
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    provider: input.provider ?? existing?.provider ?? "r2",
    region: input.region?.trim() || existing?.region || "auto",
    forcePathStyle: input.forcePathStyle ?? existing?.forcePathStyle ?? false,
  };

  data.profiles = existing
    ? data.profiles.map((item) => (item.id === id ? profile : item))
    : [...data.profiles, profile];
  data.activeProfileId = data.activeProfileId ?? id;
  writeVault(data);
  return summary(profile);
};

export const deleteProfile = (profileId: string) => {
  const data = readVault();
  const before = data.profiles.length;
  data.profiles = data.profiles.filter((profile) => profile.id !== profileId);
  if (data.activeProfileId === profileId) data.activeProfileId = data.profiles[0]?.id;
  writeVault(data);
  return before !== data.profiles.length;
};

export const switchProfile = (profileId: string) => {
  const data = readVault();
  if (!data.profiles.some((profile) => profile.id === profileId)) {
    throw new AppError({
      kind: "NOT_FOUND",
      code: "PROFILE_NOT_FOUND",
      message: "The selected connection profile no longer exists.",
      retryable: false,
    });
  }
  data.activeProfileId = profileId;
  writeVault(data);
  return getProfile(profileId);
};

export const updatePreferences = (input: Partial<AppPreferences>) => {
  const data = readVault();
  data.preferences = { ...data.preferences, ...input };
  writeVault(data);
  return data.preferences;
};

export const setOpenAiApiKey = (apiKey: string) => {
  const value = apiKey.trim();
  if (!value) throw new AppError({ kind: "VALIDATION", code: "OPENAI_API_KEY_REQUIRED", message: "Enter an OpenAI API key.", retryable: false });
  const data = readVault();
  data.openAiApiKey = encrypt(value);
  writeVault(data);
  return true;
};

export const getOpenAiApiKey = () => {
  const encrypted = readVault().openAiApiKey;
  if (!encrypted) throw new AppError({ kind: "VALIDATION", code: "OPENAI_API_KEY_REQUIRED", message: "Add an OpenAI API key in Settings before using AI indexing.", retryable: false });
  return decrypt(encrypted) as string;
};

export const removeOpenAiApiKey = () => {
  const data = readVault();
  data.openAiApiKey = undefined;
  data.preferences = { ...data.preferences, ai: { ...data.preferences.ai, enabled: false } };
  writeVault(data);
  return true;
};

export const getProfile = (profileId?: string): ProfileCredentials => {
  const data = readVault();
  const id = profileId ?? data.activeProfileId;
  const profile = data.profiles.find((item) => item.id === id);
  if (!profile) {
    throw new AppError({
      kind: "VALIDATION",
      code: "PROFILE_REQUIRED",
      message: "Choose or create a connection profile first.",
      action: "Open Connections and add your Cloudflare R2 credentials.",
      retryable: false,
    });
  }
  return {
    ...summary(profile),
    apiToken: decrypt(profile.secrets.apiToken),
    accessKeyId: decrypt(profile.secrets.accessKeyId),
    secretAccessKey: decrypt(profile.secrets.secretAccessKey),
  };
};

const PORTABLE_HEADER = "R2UPLOADER-E2EE-V1\n";
type PortableSyncTask = Pick<SyncTask, "id" | "name" | "profileId" | "bucket" | "prefix" | "localPath" | "excludes" | "conflictPolicy" | "enabled">;
type PortableBackupTask = Pick<BackupTask, "id" | "name" | "profileId" | "bucket" | "prefix" | "localPath" | "schedule" | "keepLast" | "enabled">;
interface PortableVault {
  version: 1;
  exportedAt: string;
  profiles: Array<Omit<StoredProfile, "secrets"> & { secrets: { apiToken?: string; accessKeyId?: string; secretAccessKey?: string } }>;
  preferences: AppPreferences;
  openAiApiKey?: string;
  syncTasks?: PortableSyncTask[];
  backupTasks?: PortableBackupTask[];
  automationRules?: AutomationRule[];
}

export const exportEncryptedSettings = (passphrase: string, includeSecrets: boolean) => {
  if (passphrase.length < 12) throw new AppError({ kind: "VALIDATION", code: "EXPORT_PASSPHRASE_TOO_SHORT", message: "Use a passphrase with at least 12 characters.", retryable: false });
  const data = readVault();
  const portable: PortableVault = {
    version: 1,
    exportedAt: new Date().toISOString(),
    profiles: data.profiles.map((profile) => ({ ...profile, secrets: includeSecrets ? { apiToken: decrypt(profile.secrets.apiToken), accessKeyId: decrypt(profile.secrets.accessKeyId), secretAccessKey: decrypt(profile.secrets.secretAccessKey) } : {} })),
    preferences: data.preferences,
    openAiApiKey: includeSecrets ? decrypt(data.openAiApiKey) : undefined,
    syncTasks: readJson<SyncTask[]>("sync-tasks.json", []).map((task) => ({ id: task.id, name: task.name, profileId: task.profileId, bucket: task.bucket, prefix: task.prefix, localPath: task.localPath, excludes: task.excludes, conflictPolicy: task.conflictPolicy, enabled: task.enabled })),
    backupTasks: readJson<BackupTask[]>("backup-tasks.json", []).map((task) => ({ id: task.id, name: task.name, profileId: task.profileId, bucket: task.bucket, prefix: task.prefix, localPath: task.localPath, schedule: task.schedule, keepLast: task.keepLast, enabled: task.enabled })),
    automationRules: readJson<AutomationRule[]>("automation-rules.json", []),
  };
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(portable), "utf8"), cipher.final()]);
  const envelope = { kdf: "scrypt-N32768-r8-p1", cipher: "aes-256-gcm", salt: salt.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: encrypted.toString("base64") };
  return Buffer.from(`${PORTABLE_HEADER}${JSON.stringify(envelope)}`, "utf8");
};

export const importEncryptedSettings = (payload: Buffer, passphrase: string, mode: "merge" | "replace") => {
  ensureEncryption();
  const text = payload.toString("utf8");
  if (!text.startsWith(PORTABLE_HEADER)) throw new AppError({ kind: "VALIDATION", code: "SETTINGS_BACKUP_FORMAT_INVALID", message: "This is not an R2Uploader encrypted settings backup.", retryable: false });
  try {
    const envelope = JSON.parse(text.slice(PORTABLE_HEADER.length)) as { salt: string; iv: string; tag: string; ciphertext: string };
    const key = scryptSync(passphrase, Buffer.from(envelope.salt, "base64"), 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    const portable = JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]).toString("utf8")) as PortableVault;
    if (portable.version !== 1 || !Array.isArray(portable.profiles) || !portable.preferences) throw new Error("Unsupported backup content.");
    const current = readVault();
    const importedProfiles: StoredProfile[] = portable.profiles.map((profile) => {
      const existing = current.profiles.find((candidate) => candidate.id === profile.id);
      const importedSecrets = {
        apiToken: encrypt(profile.secrets?.apiToken),
        accessKeyId: encrypt(profile.secrets?.accessKeyId),
        secretAccessKey: encrypt(profile.secrets?.secretAccessKey),
      };
      return {
        id: profile.id || randomUUID(),
        name: String(profile.name).slice(0, 80),
        accountId: String(profile.accountId).slice(0, 64),
        jurisdiction: profile.jurisdiction ?? "default",
        endpoint: profile.endpoint,
        provider: profile.provider ?? "r2",
        region: profile.region ?? "auto",
        forcePathStyle: profile.forcePathStyle ?? false,
        createdAt: profile.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        secrets: mode === "merge" && existing
          ? {
              apiToken: importedSecrets.apiToken ?? existing.secrets.apiToken,
              accessKeyId: importedSecrets.accessKeyId ?? existing.secrets.accessKeyId,
              secretAccessKey: importedSecrets.secretAccessKey ?? existing.secrets.secretAccessKey,
            }
          : importedSecrets,
      };
    });
    const profiles = mode === "replace" ? importedProfiles : [...importedProfiles, ...current.profiles.filter((profile) => !importedProfiles.some((imported) => imported.id === profile.id))];
    const next: VaultData = {
      ...current,
      profiles,
      preferences: { ...DEFAULT_PREFERENCES, ...(mode === "replace" ? portable.preferences : { ...current.preferences, ...portable.preferences }) },
      activeProfileId: profiles.some((profile) => profile.id === current.activeProfileId) ? current.activeProfileId : profiles[0]?.id,
      openAiApiKey: portable.openAiApiKey ? encrypt(portable.openAiApiKey) : mode === "replace" ? undefined : current.openAiApiKey,
    };
    writeVault(next);
    const validProfileIds = new Set(profiles.map((profile) => profile.id));
    const existingSyncTasks = readJson<SyncTask[]>("sync-tasks.json", []);
    const existingBackupTasks = readJson<BackupTask[]>("backup-tasks.json", []);
    const existingAutomationRules = readJson<AutomationRule[]>("automation-rules.json", []);
    const importedSyncTasks: SyncTask[] = (portable.syncTasks ?? []).filter((task) => validProfileIds.has(task.profileId)).map((task) => ({
      ...task,
      enabled: false,
      status: "paused",
    }));
    const importedBackupTasks: BackupTask[] = (portable.backupTasks ?? []).filter((task) => validProfileIds.has(task.profileId)).map((task) => ({
      ...task,
      enabled: false,
      status: "idle",
    }));
    const importedAutomationRules: AutomationRule[] = (portable.automationRules ?? []).filter((rule) => validProfileIds.has(rule.profileId)).map((rule) => ({
      ...rule,
      enabled: false,
      updatedAt: new Date().toISOString(),
    }));
    const mergeById = <T extends { id: string }>(imported: T[], existing: T[]) => mode === "replace" ? imported : [...imported, ...existing.filter((item) => !imported.some((candidate) => candidate.id === item.id))];
    if (portable.syncTasks) writeJson("sync-tasks.json", mergeById(importedSyncTasks, existingSyncTasks));
    if (portable.backupTasks) writeJson("backup-tasks.json", mergeById(importedBackupTasks, existingBackupTasks));
    if (portable.automationRules) writeJson("automation-rules.json", mergeById(importedAutomationRules, existingAutomationRules));
    return {
      profiles: importedProfiles.length,
      syncTasks: importedSyncTasks.length,
      backupTasks: importedBackupTasks.length,
      automationRules: importedAutomationRules.length,
      conflicts: {
        profiles: importedProfiles.filter((item) => current.profiles.some((candidate) => candidate.id === item.id)).length,
        syncTasks: importedSyncTasks.filter((item) => existingSyncTasks.some((candidate) => candidate.id === item.id)).length,
        backupTasks: importedBackupTasks.filter((item) => existingBackupTasks.some((candidate) => candidate.id === item.id)).length,
        automationRules: importedAutomationRules.filter((item) => existingAutomationRules.some((candidate) => candidate.id === item.id)).length,
      },
      includesSecrets: Boolean(portable.openAiApiKey) || portable.profiles.some((profile) => Object.values(profile.secrets ?? {}).some(Boolean)),
      exportedAt: portable.exportedAt,
      mode,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError({ kind: "AUTHENTICATION", code: "SETTINGS_BACKUP_DECRYPT_FAILED", message: "The backup could not be decrypted or validated.", action: "Check the passphrase and file, then try again.", retryable: false });
  }
};
