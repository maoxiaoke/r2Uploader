import { useEffect, useState } from "react";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { Input } from "@openai/apps-sdk-ui/components/Input";
import { SegmentedControl } from "@openai/apps-sdk-ui/components/SegmentedControl";
import { Alert } from "@openai/apps-sdk-ui/components/Alert";
import { useAppState } from "../../context/app-state";
import { errorData, unwrap } from "../../lib/ipc";
import { formatBytes } from "../../lib/format";
import type { BucketItem, QuickUploadSettings, UpdateStatus } from "../../../shared/contracts";
import { Modal } from "./modal";

interface PortableImportResult {
  profiles: number;
  syncTasks: number;
  backupTasks: number;
  automationRules: number;
  conflicts: { profiles: number; syncTasks: number; backupTasks: number; automationRules: number };
  includesSecrets: boolean;
  exportedAt: string;
  mode: "merge" | "replace";
}

export const SettingsDialog = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const { bootstrap, activeProfile, refresh, updatePreferences, t, tx } = useAppState();
  const [cache, setCache] = useState<{ entries: number; bytes: number; path: string } | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ state: "idle" });
  const [templateName, setTemplateName] = useState("");
  const [templateValue, setTemplateValue] = useState("{url}");
  const [quick, setQuick] = useState<QuickUploadSettings | null>(null);
  const [quickBuckets, setQuickBuckets] = useState<BucketItem[]>([]);
  const [portablePassphrase, setPortablePassphrase] = useState("");
  const [portableMessage, setPortableMessage] = useState("");
  const [aiKey, setAiKey] = useState("");
  const [aiEnabled, setAiEnabled] = useState(false);
  const [visionModel, setVisionModel] = useState("gpt-4o-mini");
  const [embeddingModel, setEmbeddingModel] = useState<"text-embedding-3-small" | "text-embedding-3-large">("text-embedding-3-small");
  const [aiMessage, setAiMessage] = useState("");
  const [aiError, setAiError] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  useEffect(() => {
    if (open) {
      window.r2.cache.stats().then((result) => setCache(unwrap(result)));
      if (bootstrap) {
        setQuick(bootstrap.preferences.quickUpload);
        setAiEnabled(bootstrap.preferences.ai.enabled);
        setVisionModel(bootstrap.preferences.ai.visionModel);
        setEmbeddingModel(bootstrap.preferences.ai.embeddingModel as "text-embedding-3-small" | "text-embedding-3-large");
      }
    }
  }, [open, bootstrap?.hasOpenAiApiKey]);
  useEffect(() => {
    if (!open || !quick?.profileId) { setQuickBuckets([]); return; }
    window.r2.buckets.list(quick.profileId).then((result) => setQuickBuckets(unwrap(result))).catch(() => setQuickBuckets([]));
  }, [open, quick?.profileId]);
  useEffect(() => window.r2.updates.onStatus((status) => setUpdateStatus(status as UpdateStatus)), []);
  if (!bootstrap) return null;
  const preferences = bootstrap.preferences;
  const profileId = activeProfile?.id ?? "unassigned";
  const shareTemplates = { ...preferences.customShareTemplates, ...(preferences.profileShareTemplates[profileId] ?? {}) };
  const zh = preferences.locale === "zh-CN";
  const update = async (input: object) => {
    await updatePreferences(input);
  };
  const saveAi = async (test: boolean) => {
    setAiBusy(true);
    setAiError("");
    setAiMessage("");
    try {
      unwrap(await window.r2.ai.configure({ apiKey: aiKey, enabled: aiEnabled, visionModel, embeddingModel, test }));
      setAiKey("");
      setAiMessage(tx(test ? "OpenAI connection tested and settings saved." : "AI settings saved."));
      await refresh();
    } catch (problem) { setAiError(errorData(problem).message); } finally { setAiBusy(false); }
  };
  const importPortable = async (mode: "merge" | "replace") => {
    const warning = mode === "replace"
      ? tx("Replace local profiles, preferences, and task definitions with an encrypted settings backup? Existing local items not present in the backup will be removed.")
      : tx("Merge an encrypted settings backup? Matching profile and task IDs will be updated; existing credentials are kept when the backup does not include them.");
    if (!window.confirm(warning)) return;
    try {
      const result = unwrap<PortableImportResult | null>(await window.r2.secureSettings.import({ passphrase: portablePassphrase, mode, confirmation: true }));
      if (!result) return;
      const conflicts = Object.values(result.conflicts).reduce((total, value) => total + value, 0);
      setPortableMessage(zh
        ? `已导入 ${result.profiles} 个连接、${result.syncTasks} 个同步任务、${result.backupTasks} 个备份任务和 ${result.automationRules} 条自动化规则；${conflicts} 个同 ID 项按“${mode === "merge" ? "合并" : "替换"}”处理。所有导入任务与自动化均已暂停，需在本机复核目录后手动启用。`
        : `Imported ${result.profiles} connections, ${result.syncTasks} sync tasks, ${result.backupTasks} backup tasks, and ${result.automationRules} automation rules; ${conflicts} matching IDs followed ${mode} semantics. Imported tasks and automations are paused until their local paths are reviewed on this device.`);
      await refresh();
    } finally { setPortablePassphrase(""); }
  };
  return (
    <Modal open={open} onClose={onClose} title={t("settings")}>
      <div className="space-y-6">
        <section>
          <h3 className="text-sm font-medium">{t("language")}</h3>
          <SegmentedControl value={preferences.locale} onChange={(locale) => void update({ locale })} aria-label={t("language")} className="mt-2">
            <SegmentedControl.Option value="zh-CN">简体中文</SegmentedControl.Option>
            <SegmentedControl.Option value="en">English</SegmentedControl.Option>
          </SegmentedControl>
        </section>
        <section>
          <h3 className="text-sm font-medium">{t("theme")}</h3>
          <SegmentedControl value={preferences.theme} onChange={(theme) => void update({ theme })} aria-label={t("theme")} className="mt-2" block>
            <SegmentedControl.Option value="system">{t("system")}</SegmentedControl.Option>
            <SegmentedControl.Option value="light">{t("light")}</SegmentedControl.Option>
            <SegmentedControl.Option value="dark">{t("dark")}</SegmentedControl.Option>
          </SegmentedControl>
        </section>
        <label className="flex items-start justify-between gap-4 rounded-xl border border-subtle p-3">
          <span>
            <span className="block text-sm font-medium">{tx("Reduce motion")}</span>
            <span className="block text-xs text-secondary">{tx("Disable non-essential interface animation.")}</span>
          </span>
          <input type="checkbox" checked={preferences.reduceMotion} onChange={(event) => void update({ reduceMotion: event.target.checked })} />
        </label>
        <section className="rounded-xl border border-subtle p-3">
          <div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-medium">{tx("Transfer concurrency")}</h3><p className="text-xs text-secondary">{tx("Bounded to 1–8 simultaneous tasks.")}</p></div><Input className="w-20" type="number" min={1} max={8} value={preferences.transferConcurrency} onChange={(event) => void update({ transferConcurrency: Number(event.target.value) })} /></div>
        </section>
        {quick ? <section className="rounded-xl border border-subtle p-3"><div className="flex items-start justify-between gap-4"><div><h3 className="text-sm font-medium">{tx("Quick Upload")}</h3><p className="text-xs text-secondary">{tx("⌘/Ctrl + Shift + U uploads the clipboard image, then copies its link. The tray menu can choose files.")}</p></div><input type="checkbox" checked={quick.enabled} onChange={(event) => setQuick((current) => current ? { ...current, enabled: event.target.checked } : current)} /></div><div className="mt-3 grid gap-2 sm:grid-cols-2"><select className="h-8 rounded-lg border border-default bg-surface px-2 text-sm" value={quick.profileId} onChange={(event) => setQuick((current) => current ? { ...current, profileId: event.target.value, bucket: "" } : current)}><option value="">{tx("Choose connection")}</option>{bootstrap.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select><select className="h-8 rounded-lg border border-default bg-surface px-2 text-sm" value={quick.bucket} onChange={(event) => setQuick((current) => current ? { ...current, bucket: event.target.value } : current)}><option value="">{tx("Choose bucket")}</option>{quickBuckets.map((bucket) => <option key={bucket.name} value={bucket.name}>{bucket.name} · {tx(bucket.access)}</option>)}</select><Input value={quick.prefix} onChange={(event) => setQuick((current) => current ? { ...current, prefix: event.target.value.replace(/^\/+/, "") } : current)} placeholder={tx("Target prefix")} /><select className="h-8 rounded-lg border border-default bg-surface px-2 text-sm" value={quick.shareKind} onChange={(event) => setQuick((current) => current ? { ...current, shareKind: event.target.value as QuickUploadSettings["shareKind"] } : current)}><option value="temporary">{tx("Temporary bearer link")}</option><option value="public">{tx("Permanent public URL")}</option></select></div><div className="mt-3 flex items-center justify-between gap-3"><p className="text-xs text-tertiary">{zh ? `临时链接有效期：${Math.round(quick.expiresInSeconds / 60)} 分钟。快速上传会自动重命名 Key 冲突，并跳过已知的相同内容。` : `Temporary expiry: ${Math.round(quick.expiresInSeconds / 60)} minutes. Quick Upload auto-renames key conflicts and skips known identical content.`}</p><Button color="primary" variant="outline" size="sm" disabled={quick.enabled && (!quick.profileId || !quick.bucket)} onClick={() => void update({ quickUpload: quick })}>{tx("Save Quick Upload")}</Button></div></section> : null}
        <section className="rounded-xl border border-subtle p-3">
          <div className="flex items-start justify-between gap-4"><div><h3 className="text-sm font-medium">{tx("OpenAI asset intelligence")}</h3><p className="text-xs text-secondary">{tx("Manual image tags, descriptions, and semantic search. Nothing is analyzed automatically.")}</p></div><input type="checkbox" checked={aiEnabled} onChange={(event) => setAiEnabled(event.target.checked)} aria-label={tx("OpenAI asset intelligence")} /></div>
          <Alert className="mt-3" color="warning" title={tx("Explicit external processing")} description={tx("When you click Analyze on an indexed image, R2Uploader downloads it privately, creates a smaller JPEG copy, and sends that copy to OpenAI. Requests use store=false. Search sends only your query text. The API key stays encrypted in the main process.")} />
          <div className="mt-3 grid gap-2 sm:grid-cols-2"><Input type="password" autoComplete="off" value={aiKey} onChange={(event) => setAiKey(event.target.value)} placeholder={bootstrap.hasOpenAiApiKey ? tx("API key stored · enter to replace") : "OpenAI API key"} /><Input value={visionModel} onChange={(event) => setVisionModel(event.target.value.replace(/[^a-zA-Z0-9._-]/g, ""))} placeholder={tx("Vision model")} /><label className="text-xs font-medium">{tx("Embedding model")}<select className="mt-1 h-8 w-full rounded-lg border border-default bg-surface px-2 text-sm" value={embeddingModel} onChange={(event) => setEmbeddingModel(event.target.value as typeof embeddingModel)}><option value="text-embedding-3-small">text-embedding-3-small</option><option value="text-embedding-3-large">text-embedding-3-large</option></select></label></div>
          {aiError ? <p role="alert" className="mt-2 text-xs text-danger">{aiError}</p> : null}{aiMessage ? <p role="status" className="mt-2 text-xs text-success">{aiMessage}</p> : null}
          <div className="mt-3 flex flex-wrap justify-end gap-2">{bootstrap.hasOpenAiApiKey ? <Button color="danger" variant="ghost" size="sm" onClick={async () => { if (!window.confirm(tx("Remove the encrypted OpenAI API key, disable AI indexing, and delete every locally stored AI description and vector? Manual tags are kept."))) return; const result = unwrap<{ cleared: number }>(await window.r2.ai.removeKey()); setAiEnabled(false); setAiMessage(zh ? `OpenAI API Key 已移除，并清除了 ${result.cleared} 个素材的 AI 数据。` : `OpenAI API key removed and AI data cleared from ${result.cleared} assets.`); await refresh(); }}>{tx("Remove key & AI data")}</Button> : null}<Button color="secondary" variant="outline" size="sm" loading={aiBusy} onClick={() => void saveAi(false)}>{t("save")}</Button><Button color="primary" variant="outline" size="sm" loading={aiBusy} disabled={!aiKey && !bootstrap.hasOpenAiApiKey} onClick={() => void saveAi(true)}>{tx("Test & save")}</Button></div>
        </section>
        <section className="rounded-xl border border-subtle p-3">
          <h3 className="text-sm font-medium">{tx("Encrypted portable settings")}</h3>
          <p className="mt-1 text-xs text-secondary">{tx("Move profiles, presets, favorites, sync tasks, backup tasks, automation rules, and optionally credentials to another computer. AES-256-GCM with a memory-hard scrypt key; the recovery passphrase is never stored.")}</p>
          <Alert className="mt-3" color="info" title={tx("Manual end-to-end encrypted sync")} description={tx("Save the encrypted file in a storage folder you control. The storage provider sees only ciphertext. To revoke an old device from future generations, export again with a new passphrase and replace the old file. This does not revoke credentials already imported onto that device.")} />
          <Input className="mt-3" type="password" value={portablePassphrase} onChange={(event) => setPortablePassphrase(event.target.value)} placeholder={tx("Recovery passphrase (at least 12 characters)")} />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button color="secondary" variant="outline" size="sm" disabled={portablePassphrase.length < 12} onClick={async () => { try { const savedPath = unwrap<string | null>(await window.r2.secureSettings.export({ passphrase: portablePassphrase, includeSecrets: false })); if (savedPath) setPortableMessage(zh ? `不含凭据的加密设置已保存到 ${savedPath}` : `Encrypted non-secret settings saved to ${savedPath}`); } finally { setPortablePassphrase(""); } }}>{tx("Export without credentials")}</Button>
            <Button color="warning" variant="outline" size="sm" disabled={portablePassphrase.length < 12} onClick={async () => { if (!window.confirm(tx("The file will include API, S3, and OpenAI credentials inside passphrase encryption. Continue?"))) return; try { const savedPath = unwrap<string | null>(await window.r2.secureSettings.export({ passphrase: portablePassphrase, includeSecrets: true })); if (savedPath) setPortableMessage(zh ? `完整加密设置已保存到 ${savedPath}` : `Encrypted full settings saved to ${savedPath}`); } finally { setPortablePassphrase(""); } }}>{tx("Export with credentials")}</Button>
            <Button color="primary" variant="outline" size="sm" disabled={portablePassphrase.length < 12} onClick={() => void importPortable("merge")}>{tx("Import & merge")}</Button>
            <Button color="danger" variant="ghost" size="sm" disabled={portablePassphrase.length < 12} onClick={() => void importPortable("replace")}>{tx("Import & replace")}</Button>
          </div>
          {portableMessage ? <p role="status" className="mt-2 break-all text-xs text-success">{portableMessage}</p> : null}
        </section>
        <section className="rounded-xl border border-subtle p-3"><div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-medium">{tx("External-change refresh")}</h3><p className="text-xs text-secondary">{tx("Local transfers refresh immediately. Polling catches changes from other clients; 0 disables it.")}</p></div><Input className="w-24" type="number" min={0} max={3600} value={preferences.refreshIntervalSeconds} onChange={(event) => void update({ refreshIntervalSeconds: Number(event.target.value) })} /></div><p className="mt-2 text-xs text-tertiary">{tx("Seconds between fallback polls")}</p></section>
        <section className="rounded-xl border border-subtle p-3">
          <h3 className="text-sm font-medium">{tx("Custom share templates")}</h3>
          <p className="mt-1 text-xs text-secondary">{tx("Use {url}, {name}, {key}, {expiresAt}, or {contentType}. Templates only format copied text.")}</p>
          <p className="mt-1 text-xs text-tertiary">{activeProfile ? `${tx("Connection")}: ${activeProfile.name}` : tx("Choose a connection first")}</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-[140px_1fr_auto]"><Input value={templateName} onChange={(event) => setTemplateName(event.target.value.replace(/[^a-zA-Z0-9 _-]/g, "").slice(0, 80))} placeholder="React import" /><Input value={templateValue} onChange={(event) => setTemplateValue(event.target.value)} placeholder={'import asset from "{url}"'} /><Button color="primary" variant="outline" disabled={!activeProfile || !templateName.trim() || !templateValue} onClick={async () => { await update({ profileShareTemplates: { ...preferences.profileShareTemplates, [profileId]: { ...(preferences.profileShareTemplates[profileId] ?? {}), [templateName.trim()]: templateValue } } }); setTemplateName(""); }}>{tx("Add")}</Button></div>
          {Object.entries(shareTemplates).length ? <div className="mt-3 space-y-2">{Object.entries(shareTemplates).map(([name, value]) => <div key={name} className="flex items-center justify-between gap-3 rounded-lg bg-surface-secondary p-2"><div className="min-w-0"><p className="text-xs font-medium">{name}</p><p className="truncate font-mono text-[11px] text-tertiary">{value}</p></div><Button color="danger" variant="ghost" size="xs" disabled={!preferences.profileShareTemplates[profileId]?.[name] && Boolean(preferences.customShareTemplates[name])} onClick={() => { const next = { ...(preferences.profileShareTemplates[profileId] ?? {}) }; delete next[name]; void update({ profileShareTemplates: { ...preferences.profileShareTemplates, [profileId]: next } }); }}>{tx("Remove")}</Button></div>)}</div> : null}
        </section>
        <section className="rounded-xl border border-subtle p-3">
          <div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-medium">{tx("Updates")} · v{bootstrap.version}</h3><p className="text-xs text-secondary">{updateStatus.state === "idle" ? tx("Check the signed GitHub release channel.") : updateStatus.message || `${tx(updateStatus.state)}${updateStatus.version ? ` · v${updateStatus.version}` : ""}${updateStatus.percent !== undefined ? ` · ${Math.round(updateStatus.percent)}%` : ""}`}</p></div>{updateStatus.state === "ready" ? <Button color="primary" size="sm" onClick={() => void window.r2.updates.install()}>{tx("Restart & install")}</Button> : <Button color="secondary" variant="outline" size="sm" onClick={() => { setUpdateStatus({ state: "checking" }); void window.r2.updates.check(); }}>{tx("Check")}</Button>}</div>
        </section>
        <section className="rounded-xl border border-subtle p-3">
          <div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-medium">{tx("Private preview cache")}</h3><p className="mt-1 text-xs text-secondary">{cache ? `${cache.entries} ${zh ? "个对象" : "objects"} · ${formatBytes(cache.bytes, preferences.locale)} · ${cache.path}` : tx("Reading cache status…")}</p><p className="mt-1 text-xs text-tertiary">{tx("Small objects are validated with ETag before reuse. Cached files stay inside your OS user profile.")}</p></div><Button color="danger" variant="ghost" size="sm" onClick={async () => { setCache(unwrap(await window.r2.cache.clear())); }}>{tx("Clear")}</Button></div>
          <label className="mt-3 flex items-center gap-3 text-sm"><span>{tx("Limit (MB)")}</span><Input className="w-28" type="number" min={0} max={102400} value={Math.round(preferences.cacheMaxBytes / 1024 / 1024)} onChange={(event) => void update({ cacheMaxBytes: Number(event.target.value) * 1024 * 1024 })} /></label>
        </section>
        <div className="text-right"><Button color="secondary" variant="outline" onClick={onClose}>{t("close")}</Button></div>
      </div>
    </Modal>
  );
};
