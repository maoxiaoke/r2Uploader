import { useEffect, useState } from "react";
import { Alert } from "@openai/apps-sdk-ui/components/Alert";
import { Badge } from "@openai/apps-sdk-ui/components/Badge";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { Input } from "@openai/apps-sdk-ui/components/Input";
import { SegmentedControl } from "@openai/apps-sdk-ui/components/SegmentedControl";
import type { AppErrorData, BackupRunResult, BackupTask, BucketItem, ConflictPolicy, LocalDirectoryHandle, SyncPreview, SyncTask } from "../../../shared/contracts";
import { useAppState } from "../../context/app-state";
import { formatBytes, formatDate } from "../../lib/format";
import { errorData, unwrap } from "../../lib/ipc";
import { ErrorPanel } from "./error-panel";
import { Modal } from "./modal";

const newSync = () => ({ name: "Local assets", bucket: "", prefix: "", excludes: [".DS_Store", ".git/*", "node_modules/*"], conflictPolicy: "ask" as ConflictPolicy, enabled: false });
const newBackup = () => ({ name: "R2 backup", bucket: "", prefix: "", schedule: "manual" as BackupTask["schedule"], keepLast: 3, enabled: true });

export const SyncBackupDialog = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const { activeProfile, bootstrap, tx } = useAppState();
  const zh = bootstrap?.preferences.locale === "zh-CN";
  const [tab, setTab] = useState<"sync" | "backup">("sync");
  const [syncTasks, setSyncTasks] = useState<SyncTask[]>([]);
  const [backupTasks, setBackupTasks] = useState<BackupTask[]>([]);
  const [buckets, setBuckets] = useState<BucketItem[]>([]);
  const [syncDraft, setSyncDraft] = useState(newSync);
  const [backupDraft, setBackupDraft] = useState(newBackup);
  const [directory, setDirectory] = useState<LocalDirectoryHandle | null>(null);
  const [preview, setPreview] = useState<SyncPreview | null>(null);
  const [backupResult, setBackupResult] = useState<BackupRunResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppErrorData | null>(null);
  const load = async () => {
    if (!activeProfile) return;
    setBusy(true);
    try {
      const [syncResult, backupResultValue, bucketResult] = await Promise.all([window.r2.sync.list(), window.r2.backups.list(), window.r2.buckets.list(activeProfile.id)]);
      setSyncTasks(unwrap(syncResult)); setBackupTasks(unwrap(backupResultValue)); setBuckets(unwrap(bucketResult)); setError(null);
    } catch (problem) { setError(errorData(problem)); } finally { setBusy(false); }
  };
  useEffect(() => { if (open) void load(); }, [open, activeProfile?.id]);
  const chooseDirectory = async () => setDirectory(unwrap<LocalDirectoryHandle | null>(await window.r2.directories.choose()));
  const saveSync = async () => {
    if (!activeProfile) return;
    setBusy(true);
    try { unwrap(await window.r2.sync.save({ ...syncDraft, profileId: activeProfile.id, directoryId: directory?.id })); setSyncDraft(newSync()); setDirectory(null); await load(); }
    catch (problem) { setError(errorData(problem)); } finally { setBusy(false); }
  };
  const saveBackup = async () => {
    if (!activeProfile) return;
    setBusy(true);
    try { unwrap(await window.r2.backups.save({ ...backupDraft, profileId: activeProfile.id, directoryId: directory?.id })); setBackupDraft(newBackup()); setDirectory(null); await load(); }
    catch (problem) { setError(errorData(problem)); } finally { setBusy(false); }
  };
  const rebindSync = async (task: SyncTask) => {
    const selected = unwrap<LocalDirectoryHandle | null>(await window.r2.directories.choose());
    if (!selected) return;
    unwrap(await window.r2.sync.save({ id: task.id, name: task.name, profileId: task.profileId, bucket: task.bucket, prefix: task.prefix, directoryId: selected.id, excludes: task.excludes, conflictPolicy: task.conflictPolicy, enabled: false }));
    await load();
  };
  const rebindBackup = async (task: BackupTask) => {
    const selected = unwrap<LocalDirectoryHandle | null>(await window.r2.directories.choose());
    if (!selected) return;
    unwrap(await window.r2.backups.save({ id: task.id, name: task.name, profileId: task.profileId, bucket: task.bucket, prefix: task.prefix, directoryId: selected.id, schedule: task.schedule, keepLast: task.keepLast, enabled: false }));
    await load();
  };
  if (!activeProfile) return null;
  return <Modal open={open} onClose={onClose} title={tx("Sync & verified backups")} description={tx("Both workflows are private, local-first tasks. Sync is upload-only; backups download into versioned snapshots with manifests.")}><div className="space-y-5">
    <SegmentedControl value={tab} onChange={(value) => { setTab(value as "sync" | "backup"); setDirectory(null); }} aria-label={tx("Task type")}><SegmentedControl.Option value="sync">{tx("Local → R2 sync")}</SegmentedControl.Option><SegmentedControl.Option value="backup">{tx("R2 → local backup")}</SegmentedControl.Option></SegmentedControl>
    {error ? <ErrorPanel error={error} /> : null}
    {tab === "sync" ? <>
      <Alert color="info" title={tx("One-way incremental sync")} description={tx("Changed local files are queued for upload. Remote deletions never delete local files; local deletions never delete remote objects. Exclusions use simple * wildcards.")} />
      <TaskForm tx={tx} name={syncDraft.name} setName={(name) => setSyncDraft((current) => ({ ...current, name }))} bucket={syncDraft.bucket} setBucket={(bucket) => setSyncDraft((current) => ({ ...current, bucket }))} prefix={syncDraft.prefix} setPrefix={(prefix) => setSyncDraft((current) => ({ ...current, prefix }))} buckets={buckets} directory={directory} chooseDirectory={chooseDirectory} />
      <Input value={syncDraft.excludes.join(", ")} onChange={(event) => setSyncDraft((current) => ({ ...current, excludes: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) }))} placeholder={tx("Exclude patterns, comma-separated")} />
      <div className="grid gap-2 sm:grid-cols-2"><label className="text-xs font-medium">{tx("Conflict behavior")}<select className="mt-1 h-8 w-full rounded-lg border border-default bg-surface px-2" value={syncDraft.conflictPolicy} onChange={(event) => setSyncDraft((current) => ({ ...current, conflictPolicy: event.target.value as ConflictPolicy }))}><option value="ask">{tx("Stop on remote conflict")}</option><option value="skip">{tx("Keep remote")}</option><option value="rename">{tx("Upload with a new name")}</option><option value="overwrite">{tx("Replace remote")}</option></select></label><label className="flex items-center gap-2 pt-5 text-sm"><input type="checkbox" checked={syncDraft.enabled} onChange={(event) => setSyncDraft((current) => ({ ...current, enabled: event.target.checked }))} />{tx("Poll every minute while app is running")}</label></div>
      <div className="text-right"><Button color="primary" disabled={!directory || !syncDraft.bucket || !syncDraft.name} loading={busy} onClick={() => void saveSync()}>{tx("Create sync task")}</Button></div>
      {preview ? <Alert color="warning" title={zh ? `${preview.changedFiles.length}${preview.truncated ? "+" : ""} 个变更文件` : `${preview.changedFiles.length}${preview.truncated ? "+" : ""} changed files`} description={zh ? `已扫描 ${preview.scannedFiles} 个，排除 ${preview.excludedFiles} 个。${preview.changedFiles.slice(0, 4).map((item) => item.targetKey).join(" · ")}` : `${preview.scannedFiles} scanned, ${preview.excludedFiles} excluded. ${preview.changedFiles.slice(0, 4).map((item) => item.targetKey).join(" · ")}`} /> : null}
      <TaskList>{syncTasks.filter((task) => task.profileId === activeProfile.id).map((task) => <div key={task.id} className="rounded-xl border border-subtle p-3"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium">{task.name} <Badge color={task.status === "error" ? "danger" : task.enabled ? "success" : "secondary"}>{tx(task.status)}</Badge></p><p className="mt-1 text-xs text-secondary">{task.localPath} → r2://{task.bucket}/{task.prefix}</p><p className="mt-1 text-xs text-tertiary">{task.lastRunAt ? `${zh ? "上次扫描" : "Last scan"} ${formatDate(task.lastRunAt, bootstrap?.preferences.locale)} · ` : ""}{task.queuedFiles ?? 0} {zh ? "项排队中" : "queued"}</p></div><div className="flex flex-wrap gap-1"><Button color="secondary" variant="ghost" size="xs" onClick={() => void rebindSync(task)}>{tx("Change local folder")}</Button><Button color="secondary" variant="ghost" size="xs" onClick={async () => setPreview(unwrap(await window.r2.sync.run({ id: task.id, previewOnly: true })))}>{tx("Preview")}</Button><Button color="primary" variant="outline" size="xs" onClick={async () => { unwrap(await window.r2.sync.run({ id: task.id, previewOnly: false })); await load(); }}>{tx("Run")}</Button><Button color="secondary" variant="ghost" size="xs" onClick={async () => { unwrap(await window.r2.sync.pause({ id: task.id, paused: task.enabled })); await load(); }}>{tx(task.enabled ? "Pause" : "Resume")}</Button><Button color="danger" variant="ghost" size="xs" onClick={async () => { if (window.confirm(zh ? `删除同步任务 ${task.name}？远端和本地文件都不会被改动。` : `Delete sync task ${task.name}? Remote and local files stay untouched.`)) { unwrap(await window.r2.sync.delete(task.id)); await load(); } }}>{tx("Delete")}</Button></div></div></div>)}</TaskList>
    </> : <>
      <Alert color="success" title={tx("Versioned, verified snapshots")} description={tx("Each run streams objects into a new timestamped folder, verifies size, writes SHA-256 hashes and a manifest, then applies the retention count.")} />
      <TaskForm tx={tx} name={backupDraft.name} setName={(name) => setBackupDraft((current) => ({ ...current, name }))} bucket={backupDraft.bucket} setBucket={(bucket) => setBackupDraft((current) => ({ ...current, bucket }))} prefix={backupDraft.prefix} setPrefix={(prefix) => setBackupDraft((current) => ({ ...current, prefix }))} buckets={buckets} directory={directory} chooseDirectory={chooseDirectory} />
      <div className="grid gap-2 sm:grid-cols-2"><label className="text-xs font-medium">{tx("Schedule")}<select className="mt-1 h-8 w-full rounded-lg border border-default bg-surface px-2" value={backupDraft.schedule} onChange={(event) => setBackupDraft((current) => ({ ...current, schedule: event.target.value as BackupTask["schedule"] }))}><option value="manual">{tx("Manual")}</option><option value="daily">{tx("Daily while app runs")}</option><option value="weekly">{tx("Weekly while app runs")}</option></select></label><label className="text-xs font-medium">{tx("Keep latest snapshots")}<Input className="mt-1" type="number" min={1} max={100} value={backupDraft.keepLast} onChange={(event) => setBackupDraft((current) => ({ ...current, keepLast: Number(event.target.value) }))} /></label></div>
      <div className="text-right"><Button color="primary" disabled={!directory || !backupDraft.bucket || !backupDraft.name} loading={busy} onClick={() => void saveBackup()}>{tx("Create backup task")}</Button></div>
      {backupResult ? <Alert color={backupResult.failures.length ? "warning" : "success"} title={zh ? `已验证 ${backupResult.objects} 个对象 · ${formatBytes(backupResult.bytes, bootstrap?.preferences.locale)}` : `${backupResult.objects} objects verified · ${formatBytes(backupResult.bytes, bootstrap?.preferences.locale)}`} description={`${backupResult.path}${backupResult.failures.length ? ` · ${backupResult.failures.length} ${zh ? "项失败" : "failures"}` : ""}`} /> : null}
      <TaskList>{backupTasks.filter((task) => task.profileId === activeProfile.id).map((task) => <div key={task.id} className="rounded-xl border border-subtle p-3"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium">{task.name} <Badge color={task.status === "error" ? "danger" : "secondary"}>{tx(task.status)}</Badge></p><p className="mt-1 text-xs text-secondary">r2://{task.bucket}/{task.prefix} → {task.localPath}</p><p className="mt-1 text-xs text-tertiary">{task.lastRunAt ? `${formatDate(task.lastRunAt, bootstrap?.preferences.locale)} · ${task.verifiedObjects ?? 0} ${zh ? "项已验证" : "verified"}` : tx("Never run")} · {zh ? `保留 ${task.keepLast} 份` : `keep ${task.keepLast}`}</p></div><div className="flex flex-wrap gap-1"><Button color="secondary" variant="ghost" size="xs" onClick={() => void rebindBackup(task)}>{tx("Change local folder")}</Button><Button color="primary" variant="outline" size="xs" onClick={async () => { setBackupResult(unwrap(await window.r2.backups.run(task.id))); await load(); }}>{tx("Run")}</Button><Button color="warning" variant="outline" size="xs" disabled={!task.lastRunPath} onClick={async () => { if (window.confirm(zh ? `将最近一次完整已验证清单排队恢复到 ${task.bucket}？遇到已有 Key 会停止并等待检查。` : `Queue the complete latest verified manifest into ${task.bucket}? Existing keys will stop for review.`)) unwrap(await window.r2.backups.restore(task.id)); }}>{tx("Restore all")}</Button><Button color="warning" variant="ghost" size="xs" disabled={!task.lastRunPath} onClick={async () => { const keyPrefix = window.prompt(tx("Restore one exact object key or every object under a prefix:"), task.prefix); if (keyPrefix?.trim() && window.confirm(zh ? `只从最近的已验证清单排队恢复“${keyPrefix.trim()}”？` : `Queue only “${keyPrefix.trim()}” from the latest verified manifest?`)) unwrap(await window.r2.backups.restore(task.id, keyPrefix.trim())); }}>{tx("Restore key/prefix")}</Button><Button color="warning" variant="ghost" size="xs" disabled={!task.lastRunPath} onClick={async () => { const targetPrefix = window.prompt(tx("Restore the full verified snapshot into a new destination prefix:"), `restored/${new Date().toISOString().slice(0, 10)}`); if (targetPrefix?.trim() && window.confirm(zh ? `将完整快照排队恢复到 ${task.bucket}/${targetPrefix.trim()}/？原路径不会被覆盖。` : `Queue the full snapshot into ${task.bucket}/${targetPrefix.trim()}/? Original paths will not be overwritten.`)) unwrap(await window.r2.backups.restore(task.id, undefined, targetPrefix.trim())); }}>{tx("Restore to new prefix")}</Button><Button color="danger" variant="ghost" size="xs" onClick={async () => { if (window.confirm(zh ? `删除备份任务 ${task.name}？磁盘上的现有备份文件会保留。` : `Delete backup task ${task.name}? Existing backup files stay on disk.`)) { unwrap(await window.r2.backups.delete(task.id)); await load(); } }}>{tx("Delete task")}</Button></div></div></div>)}</TaskList>
    </>}
    <div className="flex justify-end"><Button color="secondary" variant="outline" onClick={onClose}>{tx("Close")}</Button></div>
  </div></Modal>;
};

const TaskForm = ({ tx, name, setName, bucket, setBucket, prefix, setPrefix, buckets, directory, chooseDirectory }: { tx: (value: string) => string; name: string; setName: (value: string) => void; bucket: string; setBucket: (value: string) => void; prefix: string; setPrefix: (value: string) => void; buckets: BucketItem[]; directory: LocalDirectoryHandle | null; chooseDirectory: () => Promise<void> }) => <div className="grid gap-2 sm:grid-cols-2"><Input value={name} onChange={(event) => setName(event.target.value)} placeholder={tx("Task name")} /><select className="h-8 rounded-lg border border-default bg-surface px-2 text-sm" value={bucket} onChange={(event) => setBucket(event.target.value)}><option value="">{tx("Choose bucket")}</option>{buckets.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select><Input value={prefix} onChange={(event) => setPrefix(event.target.value.replace(/^\/+/, ""))} placeholder={tx("Optional R2 prefix")} /><Button color="secondary" variant="outline" onClick={() => void chooseDirectory()}>{directory ? directory.displayPath : tx("Choose local directory")}</Button></div>;
const TaskList = ({ children }: { children: React.ReactNode }) => <div className="max-h-72 space-y-2 overflow-auto">{children}</div>;
