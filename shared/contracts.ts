export type ErrorKind =
  | "AUTHENTICATION"
  | "PERMISSION"
  | "NETWORK"
  | "TIMEOUT"
  | "RATE_LIMIT"
  | "CONFLICT"
  | "NOT_FOUND"
  | "VALIDATION"
  | "UNAVAILABLE"
  | "PARTIAL_SUCCESS"
  | "UNKNOWN";

export interface AppErrorData {
  kind: ErrorKind;
  code: string;
  message: string;
  action?: string;
  status?: number;
  requestId?: string;
  retryable: boolean;
  details?: Record<string, string | number | boolean | null>;
}

export type AppResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: AppErrorData };

export type Locale = "en" | "zh-CN";
export type ThemePreference = "system" | "light" | "dark";
export type Jurisdiction = "default" | "eu" | "fedramp";

export interface ProfileSummary {
  id: string;
  name: string;
  accountId: string;
  jurisdiction: Jurisdiction;
  endpoint?: string;
  hasApiToken: boolean;
  hasS3Credentials: boolean;
  apiTokenLastFour?: string;
  accessKeyLastFour?: string;
  createdAt: string;
  updatedAt: string;
  provider: "r2" | "s3";
  region: string;
  forcePathStyle: boolean;
}

export interface ProfileInput {
  id?: string;
  name: string;
  accountId: string;
  jurisdiction?: Jurisdiction;
  endpoint?: string;
  apiToken?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  provider?: "r2" | "s3";
  region?: string;
  forcePathStyle?: boolean;
}

export interface AppPreferences {
  locale: Locale;
  theme: ThemePreference;
  reduceMotion: boolean;
  defaultView: "grid" | "list";
  transferConcurrency: number;
  cacheMaxBytes: number;
  rememberSearches: boolean;
  favoriteLocations: string[];
  recentLocations: string[];
  searchHistory: string[];
  customShareTemplates: Record<string, string>;
  profileDefaultViews: Record<string, "grid" | "list">;
  profileSearchHistories: Record<string, string[]>;
  profileShareTemplates: Record<string, Record<string, string>>;
  defaultShareDomains: Record<string, string>;
  offlineLocations: string[];
  uploadImagePreset: ImageProcessingPreset;
  uploadNamingRule: NamingRule;
  refreshIntervalSeconds: number;
  quickUpload: QuickUploadSettings;
  ai: AiSettings;
}

export interface AiSettings {
  enabled: boolean;
  visionModel: string;
  embeddingModel: string;
}

export interface QuickUploadSettings {
  enabled: boolean;
  profileId: string;
  bucket: string;
  prefix: string;
  shareKind: "temporary" | "public";
  expiresInSeconds: number;
}

export interface ImageProcessingPreset {
  enabled: boolean;
  maxWidth?: number;
  maxHeight?: number;
  format: "original" | "webp" | "avif" | "jpeg";
  quality: number;
  keepOriginal: boolean;
}

export interface NamingRule {
  enabled: boolean;
  template: string;
  project: string;
}

export interface BootstrapState {
  version: string;
  platform: NodeJS.Platform;
  activeProfileId?: string;
  profiles: ProfileSummary[];
  preferences: AppPreferences;
  vaultAvailable: boolean;
  migratedLegacyCredentials: boolean;
  hasOpenAiApiKey: boolean;
}

export type AccessKind =
  | "private"
  | "public-managed"
  | "public-custom";

export interface DomainStatus {
  domain: string;
  enabled: boolean;
  type: "managed" | "custom";
  ownership?: string;
  ssl?: string;
  zoneId?: string;
}

export interface BucketItem {
  name: string;
  creationDate?: string;
  location?: string;
  jurisdiction?: Jurisdiction;
  access: AccessKind;
  domains: DomainStatus[];
}

export interface ObjectItem {
  key: string;
  displayName: string;
  size: number;
  etag?: string;
  lastModified?: string;
  contentType?: string;
  cacheControl?: string;
  storageClass?: string;
  access: AccessKind;
}

export interface ObjectListPage {
  objects: ObjectItem[];
  folders: string[];
  cursor?: string;
  hasMore: boolean;
  syncedAt: string;
  source: "remote" | "cache";
  scannedObjects?: number;
  searchTruncated?: boolean;
}

export interface ObjectHead extends ObjectItem {
  contentDisposition?: string;
  contentEncoding?: string;
  contentLanguage?: string;
  customMetadata?: Record<string, string>;
}

export interface ObjectMetadataInput {
  contentType?: string;
  cacheControl?: string;
  contentDisposition?: string;
  contentEncoding?: string;
  contentLanguage?: string;
  customMetadata?: Record<string, string>;
}

export type ConflictPolicy = "ask" | "skip" | "overwrite" | "rename";
export type DuplicatePolicy = "ask" | "skip" | "upload";
export type TransferKind = "upload" | "download" | "copy" | "move" | "delete" | "restore";
export type TransferStatus =
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled"
  | "partial";

export interface TransferItem {
  id: string;
  kind: TransferKind;
  status: TransferStatus;
  profileId: string;
  bucket: string;
  key: string;
  source?: string;
  destination?: string;
  bytesTotal: number;
  bytesTransferred: number;
  progress: number;
  speedBytesPerSecond: number;
  etaSeconds?: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: AppErrorData;
}

export interface ConnectionCheck {
  id: "vault" | "authentication" | "buckets" | "read" | "write" | "cleanup" | "s3";
  status: "passed" | "failed" | "skipped";
  label: string;
  detail: string;
  action?: string;
}

export interface ConnectionDiagnostic {
  checkedAt: string;
  checks: ConnectionCheck[];
  canManageBuckets: boolean;
  canReadObjects: boolean;
  canWriteObjects: boolean;
  canUseMultipart: boolean;
}

export interface DiagnosticBundle {
  generatedAt: string;
  appVersion: string;
  platform: string;
  profile: Pick<ProfileSummary, "id" | "name" | "jurisdiction" | "hasApiToken" | "hasS3Credentials"> | null;
  connection?: ConnectionDiagnostic;
  recentErrors: AppErrorData[];
  transferSummary: Record<TransferStatus, number>;
}

export interface ShareLink {
  url: string;
  kind: "public" | "temporary" | "local-preview";
  expiresAt?: string;
}

export interface LocalFileHandle {
  id: string;
  name: string;
  size: number;
  relativePath?: string;
}

export interface UploadPlanItem {
  handleId: string;
  sourceHandleId: string;
  sourceName: string;
  sourceSize: number;
  targetKey: string;
  outputSize: number;
  checksum: string;
  width?: number;
  height?: number;
  transformed: boolean;
  duplicate?: { bucket: string; key: string; uploadedAt?: string };
  existing?: { size: number; lastModified?: string; contentType?: string };
  batchConflict?: boolean;
  targetUnchecked?: boolean;
  processingWarning?: string;
}

export interface AssetIndexRecord {
  id: string;
  profileId: string;
  bucket: string;
  key: string;
  size: number;
  checksum?: string;
  etag?: string;
  contentType?: string;
  width?: number;
  height?: number;
  orientation?: "square" | "landscape" | "portrait";
  durationSeconds?: number;
  tags: string[];
  aiDescription?: string;
  embedding?: number[];
  embeddingModel?: string;
  source: "upload" | "remote-rebuild";
  indexedAt: string;
  uploadedAt?: string;
}

export interface LocalDirectoryHandle {
  id: string;
  name: string;
  displayPath: string;
}

export interface SyncTask {
  id: string;
  name: string;
  profileId: string;
  bucket: string;
  prefix: string;
  localPath: string;
  excludes: string[];
  conflictPolicy: ConflictPolicy;
  enabled: boolean;
  status: "idle" | "scanning" | "queued" | "paused" | "error";
  lastRunAt?: string;
  nextPollAt?: string;
  queuedFiles?: number;
  error?: AppErrorData;
}

export interface SyncPreview {
  taskId: string;
  scannedFiles: number;
  changedFiles: Array<{ relativePath: string; size: number; targetKey: string }>;
  excludedFiles: number;
  truncated: boolean;
}

export interface BackupTask {
  id: string;
  name: string;
  profileId: string;
  bucket: string;
  prefix: string;
  localPath: string;
  schedule: "manual" | "daily" | "weekly";
  keepLast: number;
  enabled: boolean;
  status: "idle" | "running" | "error";
  lastRunAt?: string;
  lastRunPath?: string;
  verifiedObjects?: number;
  error?: AppErrorData;
}

export interface BackupRunResult {
  taskId: string;
  path: string;
  objects: number;
  bytes: number;
  manifestPath: string;
  failures: Array<{ key: string; message: string }>;
}

export type OperationAction =
  | "upload"
  | "download"
  | "copy"
  | "move"
  | "trash"
  | "restore"
  | "delete"
  | "bucket-create"
  | "bucket-delete"
  | "domain-change"
  | "lifecycle-change"
  | "cors-change"
  | "automation-change"
  | "metadata";

export interface OperationRecord {
  id: string;
  action: OperationAction;
  profileId: string;
  bucket: string;
  key?: string;
  targetBucket?: string;
  targetKey?: string;
  status: "success" | "failed" | "partial";
  createdAt: string;
  reversible: boolean;
  errorCode?: string;
}

export interface UpdateStatus {
  state: "idle" | "checking" | "available" | "downloading" | "ready" | "current" | "error";
  version?: string;
  percent?: number;
  message?: string;
}

export interface BucketAnalytics {
  bucket: string;
  from: string;
  to: string;
  fetchedAt: string;
  retentionDays: number;
  dataMayLag: boolean;
  storage: Array<{ at: string; objectCount: number; payloadBytes: number; metadataBytes: number }>;
  operations: Array<{ actionType: string; requests: number; pricingClass: "A" | "B" | "free" | "unknown" }>;
  totals: { objectCount: number; storageBytes: number; classA: number; classB: number; free: number; unknown: number };
  estimate: {
    currency: "USD";
    amount: number;
    note: string;
    pricingUpdatedAt: string;
    pricingSource: string;
    freeTier: { storageGbMonth: number; classA: number; classB: number };
    breakdown: { storage: number; classA: number; classB: number; internetEgress: number; infrequentAccessRetrieval?: number };
  };
  insights: {
    storageGrowthBytes?: number;
    storageGrowthPercent?: number;
    abnormalStorageGrowth: boolean;
    unknownRequests: number;
    internetEgressPricedAtZero: boolean;
    retrievalUsageAvailable: boolean;
  };
}

export interface LifecycleRule {
  id: string;
  prefix: string;
  enabled: boolean;
  deleteAfterDays?: number;
  abortMultipartAfterDays?: number;
  transitionToInfrequentAfterDays?: number;
}

export interface CorsRule {
  id?: string;
  origins: string[];
  methods: Array<"GET" | "PUT" | "POST" | "DELETE" | "HEAD">;
  headers?: string[];
  exposeHeaders?: string[];
  maxAgeSeconds?: number;
}

export interface DomainHealthResult {
  url: string;
  checkedAt: string;
  dns: "ok" | "failed" | "skipped";
  tls: "ok" | "failed" | "skipped";
  http: "ok" | "warning" | "failed";
  status?: number;
  latencyMs?: number;
  cacheStatus?: string;
  contentType?: string;
  detail: string;
}

export interface EventRefreshSubscription {
  id: string;
  profileId: string;
  bucket: string;
  queueId: string;
  queueName?: string;
  enabled: boolean;
  status: "active" | "fallback-polling" | "paused" | "error";
  lastCheckedAt?: string;
  lastEventAt?: string;
  lastError?: AppErrorData;
}

export interface AutomationRule {
  id: string;
  name: string;
  profileId: string;
  bucket: string;
  prefix: string;
  enabled: boolean;
  notify: boolean;
  copyLink: "none" | "temporary" | "public";
  expiresInSeconds: number;
  copyToBucket?: string;
  copyToPrefix?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRunRecord {
  eventId: string;
  ruleId: string;
  bucket?: string;
  key?: string;
  actions: string[];
  failures: string[];
  updatedAt: string;
}

export interface CompanionSession {
  id: string;
  profileId: string;
  bucket: string;
  prefix: string;
  url: string;
  expiresAt: string;
  certificateFingerprint: string;
  readOnly: true;
}

export interface AiAnalysisResult {
  asset: AssetIndexRecord;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
}

export interface SemanticSearchResult {
  asset: AssetIndexRecord;
  score: number;
}

export const IPC_CHANNELS = {
  bootstrap: "app:bootstrap",
  preferencesUpdate: "preferences:update",
  profileSave: "profiles:save",
  profileDelete: "profiles:delete",
  profileSwitch: "profiles:switch",
  profileTest: "profiles:test",
  bucketList: "buckets:list",
  bucketCreate: "buckets:create",
  bucketDelete: "buckets:delete",
  bucketManagedDomain: "buckets:managed-domain",
  bucketCustomDomainAttach: "buckets:custom-domain-attach",
  bucketCustomDomainUpdate: "buckets:custom-domain-update",
  bucketCustomDomainRemove: "buckets:custom-domain-remove",
  bucketAnalytics: "buckets:analytics",
  bucketLifecycleGet: "buckets:lifecycle-get",
  bucketLifecycleSet: "buckets:lifecycle-set",
  bucketCorsGet: "buckets:cors-get",
  bucketCorsSet: "buckets:cors-set",
  bucketDomainHealth: "buckets:domain-health",
  bucketEventList: "buckets:event-list",
  bucketEventSubscribe: "buckets:event-subscribe",
  bucketEventPause: "buckets:event-pause",
  remoteObjectsChanged: "objects:remote-changed",
  objectList: "objects:list",
  objectSearch: "objects:search",
  objectHead: "objects:head",
  objectMetadataUpdate: "objects:metadata-update",
  objectPreview: "objects:preview",
  objectShare: "objects:share",
  objectRename: "objects:rename",
  objectCopy: "objects:copy",
  objectTrash: "objects:trash",
  objectRestore: "objects:restore",
  objectDelete: "objects:delete",
  folderCreate: "folders:create",
  folderOperate: "folders:operate",
  uploadEnqueue: "uploads:enqueue",
  uploadPlan: "uploads:plan",
  uploadClipboard: "uploads:clipboard",
  uploadQuickFiles: "uploads:quick-files",
  transferList: "transfers:list",
  transferCancel: "transfers:cancel",
  transferPause: "transfers:pause",
  transferRetry: "transfers:retry",
  transferClear: "transfers:clear",
  transferOpenDownload: "transfers:open-download",
  transferRevealDownload: "transfers:reveal-download",
  transferUpdated: "transfers:updated",
  fileChoose: "files:choose",
  folderChoose: "folders:choose",
  directoryChoose: "directories:choose",
  droppedFileRegister: "files:register-drop",
  objectDownload: "objects:download",
  diagnosticsGet: "diagnostics:get",
  diagnosticsExport: "diagnostics:export",
  externalOpen: "external:open",
  clipboardWrite: "clipboard:write",
  textExport: "text:export",
  historyList: "history:list",
  historyRecover: "history:recover",
  historyClear: "history:clear",
  assetIndexList: "assets:index-list",
  assetIndexRebuild: "assets:index-rebuild",
  assetIndexUpdate: "assets:index-update",
  assetMediaMetadataUpdate: "assets:media-metadata-update",
  aiConfigure: "ai:configure",
  aiRemoveKey: "ai:remove-key",
  aiAnalyze: "ai:analyze",
  aiSemanticSearch: "ai:semantic-search",
  syncList: "sync:list",
  syncSave: "sync:save",
  syncRun: "sync:run",
  syncPause: "sync:pause",
  syncDelete: "sync:delete",
  backupList: "backup:list",
  backupSave: "backup:save",
  backupRun: "backup:run",
  backupRestore: "backup:restore",
  backupDelete: "backup:delete",
  automationList: "automation:list",
  automationRuns: "automation:runs",
  automationSave: "automation:save",
  automationDelete: "automation:delete",
  companionStart: "companion:start",
  companionStop: "companion:stop",
  companionStatus: "companion:status",
  cacheStats: "cache:stats",
  cacheClear: "cache:clear",
  cachePinPrefix: "cache:pin-prefix",
  updateCheck: "update:check",
  updateInstall: "update:install",
  settingsExportEncrypted: "settings:export-encrypted",
  settingsImportEncrypted: "settings:import-encrypted",
  updateStatus: "update:status",
} as const;
