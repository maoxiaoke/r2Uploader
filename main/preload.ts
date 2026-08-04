import { contextBridge, ipcRenderer, type IpcRendererEvent, webUtils } from "electron";
import { IPC_CHANNELS } from "../shared/contracts";

const invoke = <T>(channel: string, input?: unknown) => ipcRenderer.invoke(channel, input) as Promise<T>;

const api = {
  app: {
    bootstrap: () => invoke(IPC_CHANNELS.bootstrap),
    updatePreferences: (input: unknown) => invoke(IPC_CHANNELS.preferencesUpdate, input),
    platform: process.platform,
  },
  profiles: {
    save: (input: unknown) => invoke(IPC_CHANNELS.profileSave, input),
    delete: (profileId: string) => invoke(IPC_CHANNELS.profileDelete, { profileId }),
    switch: (profileId: string) => invoke(IPC_CHANNELS.profileSwitch, { profileId }),
    test: (input: unknown) => invoke(IPC_CHANNELS.profileTest, input),
  },
  buckets: {
    list: (profileId: string) => invoke(IPC_CHANNELS.bucketList, { profileId }),
    create: (input: unknown) => invoke(IPC_CHANNELS.bucketCreate, input),
    delete: (input: unknown) => invoke(IPC_CHANNELS.bucketDelete, input),
    setManagedDomain: (input: unknown) => invoke(IPC_CHANNELS.bucketManagedDomain, input),
    attachCustomDomain: (input: unknown) => invoke(IPC_CHANNELS.bucketCustomDomainAttach, input),
    updateCustomDomain: (input: unknown) => invoke(IPC_CHANNELS.bucketCustomDomainUpdate, input),
    removeCustomDomain: (input: unknown) => invoke(IPC_CHANNELS.bucketCustomDomainRemove, input),
    analytics: (input: unknown) => invoke(IPC_CHANNELS.bucketAnalytics, input),
    getLifecycle: (input: unknown) => invoke(IPC_CHANNELS.bucketLifecycleGet, input),
    setLifecycle: (input: unknown) => invoke(IPC_CHANNELS.bucketLifecycleSet, input),
    getCors: (input: unknown) => invoke(IPC_CHANNELS.bucketCorsGet, input),
    setCors: (input: unknown) => invoke(IPC_CHANNELS.bucketCorsSet, input),
    checkDomain: (input: unknown) => invoke(IPC_CHANNELS.bucketDomainHealth, input),
    listEventRefresh: (input: unknown) => invoke(IPC_CHANNELS.bucketEventList, input),
    subscribeEventRefresh: (input: unknown) => invoke(IPC_CHANNELS.bucketEventSubscribe, input),
    pauseEventRefresh: (input: unknown) => invoke(IPC_CHANNELS.bucketEventPause, input),
  },
  objects: {
    list: (input: unknown) => invoke(IPC_CHANNELS.objectList, input),
    search: (input: unknown) => invoke(IPC_CHANNELS.objectSearch, input),
    head: (input: unknown) => invoke(IPC_CHANNELS.objectHead, input),
    updateMetadata: (input: unknown) => invoke(IPC_CHANNELS.objectMetadataUpdate, input),
    preview: (input: unknown) => invoke(IPC_CHANNELS.objectPreview, input),
    share: (input: unknown) => invoke(IPC_CHANNELS.objectShare, input),
    rename: (input: unknown) => invoke(IPC_CHANNELS.objectRename, input),
    copy: (input: unknown) => invoke(IPC_CHANNELS.objectCopy, input),
    trash: (input: unknown) => invoke(IPC_CHANNELS.objectTrash, input),
    restore: (input: unknown) => invoke(IPC_CHANNELS.objectRestore, input),
    deletePermanent: (input: unknown) => invoke(IPC_CHANNELS.objectDelete, input),
    download: (input: unknown) => invoke(IPC_CHANNELS.objectDownload, input),
  },
  folders: {
    create: (input: unknown) => invoke(IPC_CHANNELS.folderCreate, input),
    operate: (input: unknown) => invoke(IPC_CHANNELS.folderOperate, input),
  },
  uploads: {
    chooseFiles: () => invoke(IPC_CHANNELS.fileChoose),
    chooseFolder: () => invoke(IPC_CHANNELS.folderChoose),
    registerDroppedFile: async (file: File) => {
      const filePath = webUtils.getPathForFile(file);
      if (!filePath) return { ok: false, error: { kind: "VALIDATION", code: "DROP_PATH_UNAVAILABLE", message: "The dropped item is not a local file.", retryable: false } };
      return invoke(IPC_CHANNELS.droppedFileRegister, {
        path: filePath,
        name: file.name,
        size: file.size,
        relativePath: file.webkitRelativePath || undefined,
      });
    },
    enqueue: (input: unknown) => invoke(IPC_CHANNELS.uploadEnqueue, input),
    plan: (input: unknown) => invoke(IPC_CHANNELS.uploadPlan, input),
    quickClipboard: () => invoke(IPC_CHANNELS.uploadClipboard),
    quickFiles: () => invoke(IPC_CHANNELS.uploadQuickFiles),
  },
  directories: {
    choose: () => invoke(IPC_CHANNELS.directoryChoose),
  },
  transfers: {
    list: () => invoke(IPC_CHANNELS.transferList),
    cancel: (id: string) => invoke(IPC_CHANNELS.transferCancel, { id }),
    pause: (id: string) => invoke(IPC_CHANNELS.transferPause, { id }),
    retry: (id: string) => invoke(IPC_CHANNELS.transferRetry, { id }),
    clear: () => invoke(IPC_CHANNELS.transferClear),
    openDownload: (id: string) => invoke(IPC_CHANNELS.transferOpenDownload, { id }),
    revealDownload: (id: string) => invoke(IPC_CHANNELS.transferRevealDownload, { id }),
    onUpdated: (callback: (items: unknown) => void) => {
      const listener = (_event: IpcRendererEvent, items: unknown) => callback(items);
      ipcRenderer.on(IPC_CHANNELS.transferUpdated, listener);
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.transferUpdated, listener);
      };
    },
  },
  events: {
    onRemoteChanged: (callback: (event: unknown) => void) => {
      const listener = (_event: IpcRendererEvent, value: unknown) => callback(value);
      ipcRenderer.on(IPC_CHANNELS.remoteObjectsChanged, listener);
      return () => { ipcRenderer.removeListener(IPC_CHANNELS.remoteObjectsChanged, listener); };
    },
  },
  diagnostics: {
    get: () => invoke(IPC_CHANNELS.diagnosticsGet),
    export: () => invoke(IPC_CHANNELS.diagnosticsExport),
  },
  history: {
    list: () => invoke(IPC_CHANNELS.historyList),
    recover: (id: string) => invoke(IPC_CHANNELS.historyRecover, { id, confirmation: true }),
    clear: () => invoke(IPC_CHANNELS.historyClear, { confirmation: true }),
  },
  assets: {
    list: (input?: unknown) => invoke(IPC_CHANNELS.assetIndexList, input),
    rebuild: (input: unknown) => invoke(IPC_CHANNELS.assetIndexRebuild, input),
    update: (input: unknown) => invoke(IPC_CHANNELS.assetIndexUpdate, input),
    updateMediaMetadata: (input: unknown) => invoke(IPC_CHANNELS.assetMediaMetadataUpdate, input),
  },
  ai: {
    configure: (input: unknown) => invoke(IPC_CHANNELS.aiConfigure, input),
    removeKey: () => invoke(IPC_CHANNELS.aiRemoveKey, { confirmation: true }),
    analyze: (id: string) => invoke(IPC_CHANNELS.aiAnalyze, { id, explicitDataSharingConfirmation: true }),
    semanticSearch: (input: unknown) => invoke(IPC_CHANNELS.aiSemanticSearch, input),
  },
  sync: {
    list: () => invoke(IPC_CHANNELS.syncList),
    save: (input: unknown) => invoke(IPC_CHANNELS.syncSave, input),
    run: (input: unknown) => invoke(IPC_CHANNELS.syncRun, input),
    pause: (input: unknown) => invoke(IPC_CHANNELS.syncPause, input),
    delete: (id: string) => invoke(IPC_CHANNELS.syncDelete, { id, confirmation: true }),
  },
  backups: {
    list: () => invoke(IPC_CHANNELS.backupList),
    save: (input: unknown) => invoke(IPC_CHANNELS.backupSave, input),
    run: (id: string) => invoke(IPC_CHANNELS.backupRun, { id }),
    restore: (id: string, keyPrefix?: string, targetPrefix?: string) => invoke(IPC_CHANNELS.backupRestore, { id, keyPrefix, targetPrefix, confirmation: true }),
    delete: (id: string) => invoke(IPC_CHANNELS.backupDelete, { id, confirmation: true }),
  },
  automation: {
    list: (input?: unknown) => invoke(IPC_CHANNELS.automationList, input),
    runs: (input?: unknown) => invoke(IPC_CHANNELS.automationRuns, input),
    save: (input: unknown) => invoke(IPC_CHANNELS.automationSave, input),
    delete: (id: string) => invoke(IPC_CHANNELS.automationDelete, { id, confirmation: true }),
  },
  companion: {
    start: (input: unknown) => invoke(IPC_CHANNELS.companionStart, input),
    stop: () => invoke(IPC_CHANNELS.companionStop, { confirmation: true }),
    status: () => invoke(IPC_CHANNELS.companionStatus),
  },
  cache: {
    stats: () => invoke(IPC_CHANNELS.cacheStats),
    clear: () => invoke(IPC_CHANNELS.cacheClear, { confirmation: true }),
    pinPrefix: (input: unknown) => invoke(IPC_CHANNELS.cachePinPrefix, input),
  },
  updates: {
    check: () => invoke(IPC_CHANNELS.updateCheck),
    install: () => invoke(IPC_CHANNELS.updateInstall, { confirmation: true }),
    onStatus: (callback: (status: unknown) => void) => {
      const listener = (_event: IpcRendererEvent, status: unknown) => callback(status);
      ipcRenderer.on(IPC_CHANNELS.updateStatus, listener);
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.updateStatus, listener);
      };
    },
  },
  secureSettings: {
    export: (input: unknown) => invoke(IPC_CHANNELS.settingsExportEncrypted, input),
    import: (input: unknown) => invoke(IPC_CHANNELS.settingsImportEncrypted, input),
  },
  system: {
    openExternal: (url: string) => invoke(IPC_CHANNELS.externalOpen, { url }),
    copyText: (text: string) => invoke(IPC_CHANNELS.clipboardWrite, { text }),
    exportText: (input: unknown) => invoke(IPC_CHANNELS.textExport, input),
  },
};

contextBridge.exposeInMainWorld("r2", api);

export type R2DesktopApi = typeof api;
