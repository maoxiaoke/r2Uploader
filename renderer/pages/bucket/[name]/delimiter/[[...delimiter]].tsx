import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import { Alert } from "@openai/apps-sdk-ui/components/Alert";
import { Badge } from "@openai/apps-sdk-ui/components/Badge";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { EmptyMessage } from "@openai/apps-sdk-ui/components/EmptyMessage";
import { Input } from "@openai/apps-sdk-ui/components/Input";
import { SegmentedControl } from "@openai/apps-sdk-ui/components/SegmentedControl";
import {
  ArrowLeft,
  ArrowRotateCw,
  ChevronRight,
  Copy,
  Download,
  Edit,
  File,
  FileAudio,
  FileCode,
  FileDocument,
  FileImage,
  FileVideo,
  FileZip,
  Folder,
  FolderPlus,
  Grid,
  Info,
  Love,
  Search,
  Settings,
  Share,
  Trash,
  UploadDocuments,
  VideoList,
} from "@openai/apps-sdk-ui/components/Icon";
import type {
  AppErrorData,
  AccessKind,
  BucketItem,
  LocalFileHandle,
  ObjectHead,
  ObjectItem,
  ObjectListPage,
  ObjectMetadataInput,
  ShareLink,
} from "../../../../../shared/contracts";
import { ErrorPanel } from "../../../../components/new/error-panel";
import { BatchShareDialog } from "../../../../components/new/batch-share-dialog";
import { BucketToolsDialog } from "../../../../components/new/bucket-tools-dialog";
import { UploadPlannerDialog } from "../../../../components/new/upload-planner-dialog";
import { Modal } from "../../../../components/new/modal";
import { OrganizeDialog, type OrganizeSource } from "../../../../components/new/organize-dialog";
import { useAppState } from "../../../../context/app-state";
import { useTransfers } from "../../../../context/transfers";
import { formatBytes, formatDate } from "../../../../lib/format";
import { errorData, unwrap } from "../../../../lib/ipc";
import { formatShare } from "../../../../lib/share";
import { isConfirmedEmptyListing, mergeObjectPages } from "../../../../../shared/object-listing";

type ViewMode = "grid" | "list";
type SortMode = "name" | "date" | "size" | "type";

const iconFor = (item: Pick<ObjectItem, "contentType" | "key">) => {
  const type = item.contentType ?? "";
  const extension = item.key.split(".").pop()?.toLowerCase();
  if (type.startsWith("image/")) return FileImage;
  if (type.startsWith("video/")) return FileVideo;
  if (type.startsWith("audio/")) return FileAudio;
  if (type.includes("json") || type.startsWith("text/") || ["js", "ts", "css", "html", "md"].includes(extension ?? "")) return FileCode;
  if (type.includes("pdf") || ["doc", "docx", "pdf"].includes(extension ?? "")) return FileDocument;
  if (["zip", "tar", "gz", "7z", "rar"].includes(extension ?? "")) return FileZip;
  return File;
};

const typeGroup = (item: ObjectItem) => {
  const type = item.contentType ?? "";
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/") || type.startsWith("audio/")) return "media";
  if (type.startsWith("text/") || type.includes("json") || type.includes("pdf")) return "document";
  return "other";
};

const routeToPrefix = (router, bucket: string, prefix: string) => {
  const delimiter = prefix.split("/").filter(Boolean);
  return router.push({
    pathname: "/bucket/[name]/delimiter/[[...delimiter]]",
    query: { name: bucket, ...(delimiter.length ? { delimiter } : {}) },
  });
};

const ObjectPreview = ({
  profileId,
  bucket,
  item,
  access,
  onClose,
  onChanged,
  onOrganize,
}: {
  profileId: string;
  bucket: string;
  item: ObjectItem | null;
  access: AccessKind;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onOrganize: (source: OrganizeSource) => void;
}) => {
  const { bootstrap, t, tx } = useAppState();
  const zh = bootstrap?.preferences.locale === "zh-CN";
  const shareTemplates = { ...(bootstrap?.preferences.customShareTemplates ?? {}), ...(bootstrap?.preferences.profileShareTemplates[profileId] ?? {}) };
  const { setOpen: setTransfersOpen } = useTransfers();
  const [head, setHead] = useState<ObjectHead | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [textPreview, setTextPreview] = useState<string>();
  const [error, setError] = useState<AppErrorData | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [nextKey, setNextKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [share, setShare] = useState<ShareLink | null>(null);
  const [shareTemplate, setShareTemplate] = useState("url");
  const [shareExpiry, setShareExpiry] = useState(3_600);
  const [metadata, setMetadata] = useState<ObjectMetadataInput>({});
  const [customMetadataText, setCustomMetadataText] = useState("{}");

  useEffect(() => {
    setHead(null);
    setPreviewUrl(undefined);
    setTextPreview(undefined);
    setShare(null);
    setError(null);
    if (!item) return;
    setNextKey(item.key);
    let cancelled = false;
    (async () => {
      try {
        const details = unwrap<ObjectHead>(await window.r2.objects.head({ profileId, bucket, key: item.key }));
        const preview = unwrap<ShareLink>(await window.r2.objects.preview({ profileId, bucket, key: item.key }));
        if (cancelled) return;
        setHead(details);
        setMetadata({
          contentType: details.contentType,
          cacheControl: details.cacheControl,
          contentDisposition: details.contentDisposition,
          contentEncoding: details.contentEncoding,
          contentLanguage: details.contentLanguage,
          customMetadata: details.customMetadata,
        });
        setCustomMetadataText(JSON.stringify(details.customMetadata ?? {}, null, 2));
        setPreviewUrl(preview.url);
        const type = details.contentType ?? "";
        if (type.startsWith("text/") || type.includes("json") || type.includes("xml")) {
          const response = await fetch(preview.url, { headers: { Range: "bytes=0-262143" } });
          if (!cancelled) setTextPreview(await response.text());
        }
      } catch (problem) {
        if (!cancelled) setError(errorData(problem));
      }
    })();
    return () => { cancelled = true; };
  }, [profileId, bucket, item]);

  if (!item) return null;
  const contentType = head?.contentType ?? item.contentType ?? "application/octet-stream";
  const makeShare = async (kind: "public" | "temporary") => {
    setBusy(true);
    try {
      const link = unwrap<ShareLink>(await window.r2.objects.share({ profileId, bucket, key: item.key, kind, expiresInSeconds: shareExpiry }));
      setShare(link);
      setError(null);
    } catch (problem) {
      setError(errorData(problem));
    } finally { setBusy(false); }
  };
  const rename = async () => {
    setBusy(true);
    try {
      unwrap(await window.r2.objects.rename({ profileId, bucket, key: item.key, targetKey: nextKey }));
      setRenameOpen(false);
      await onChanged();
      onClose();
    } catch (problem) { setError(errorData(problem)); } finally { setBusy(false); }
  };
  const trash = async () => {
    if (!window.confirm(zh ? `将“${item.key}”移到 R2Uploader 回收站？` : `Move “${item.key}” to R2Uploader Trash?`)) return;
    setBusy(true);
    try {
      unwrap(await window.r2.objects.trash({ profileId, bucket, key: item.key }));
      await onChanged();
      onClose();
    } catch (problem) { setError(errorData(problem)); } finally { setBusy(false); }
  };
  const inTrash = item.key.startsWith(".r2uploader-trash/");
  const originalKey = inTrash ? item.key.split("/").slice(2).join("/") : item.key;
  const restore = async () => {
    setBusy(true);
    try {
      unwrap(await window.r2.objects.restore({ profileId, bucket, trashKey: item.key, originalKey }));
      await onChanged();
      onClose();
    } catch (problem) { setError(errorData(problem)); } finally { setBusy(false); }
  };
  const deletePermanent = async () => {
    const confirmation = window.prompt(zh ? `永久删除无法撤销。\n\n输入完整 Key 继续：\n${item.key}` : `Permanent deletion cannot be undone.\n\nType the full key to continue:\n${item.key}`);
    if (confirmation !== item.key) return;
    setBusy(true);
    try {
      unwrap(await window.r2.objects.deletePermanent({ profileId, bucket, key: item.key, confirmation: true }));
      await onChanged();
      onClose();
    } catch (problem) { setError(errorData(problem)); } finally { setBusy(false); }
  };
  const saveMetadata = async () => {
    if (!window.confirm(tx("Saving metadata performs an in-place server-side copy with REPLACE semantics. The object body stays the same, but HTTP or custom metadata omitted from this form will be removed. Continue?"))) return;
    setBusy(true);
    try {
      const customMetadata = JSON.parse(customMetadataText || "{}") as Record<string, string>;
      if (!customMetadata || Array.isArray(customMetadata) || typeof customMetadata !== "object" || Object.values(customMetadata).some((value) => typeof value !== "string")) throw new Error(tx("Custom metadata must be a JSON object whose values are strings."));
      const updated = unwrap<ObjectHead>(await window.r2.objects.updateMetadata({ profileId, bucket, key: item.key, ...metadata, customMetadata }));
      setHead(updated);
      setError(null);
      await onChanged();
    } catch (problem) { setError(errorData(problem)); } finally { setBusy(false); }
  };
  const shareText = useMemo(() => {
    if (!share) return "";
    return formatShare(item, share, shareTemplate, shareTemplates);
  }, [item, share, shareTemplate, shareTemplates]);

  return (
    <>
      <Modal open={Boolean(item)} onClose={onClose} title={item.displayName} description={item.key}>
        <div className="space-y-5">
          {error ? <ErrorPanel error={error} /> : null}
          <div className="grid min-h-52 place-items-center overflow-hidden rounded-2xl border border-subtle bg-surface-secondary p-3">
            {!previewUrl ? <p className="text-sm text-secondary">{t("loading")}</p>
              : contentType.startsWith("image/") ? <img src={previewUrl} alt={item.displayName} className="max-h-[360px] max-w-full rounded-lg object-contain" />
              : contentType.startsWith("video/") ? <video src={previewUrl} controls className="max-h-[360px] max-w-full rounded-lg" onLoadedMetadata={(event) => { const media = event.currentTarget; if (Number.isFinite(media.duration)) void window.r2.assets.updateMediaMetadata({ profileId, bucket, key: item.key, durationSeconds: media.duration, width: media.videoWidth, height: media.videoHeight }); }} />
              : contentType.startsWith("audio/") ? <audio src={previewUrl} controls className="w-full" onLoadedMetadata={(event) => { const media = event.currentTarget; if (Number.isFinite(media.duration)) void window.r2.assets.updateMediaMetadata({ profileId, bucket, key: item.key, durationSeconds: media.duration }); }} />
              : contentType === "application/pdf" ? <iframe src={previewUrl} title={item.displayName} sandbox="" className="h-[360px] w-full rounded-lg border-0" />
              : textPreview !== undefined ? <pre className="max-h-[360px] w-full overflow-auto whitespace-pre-wrap break-words text-xs">{textPreview}</pre>
              : (() => { const Icon = iconFor(item); return <div className="text-center text-secondary"><Icon className="mx-auto size-12" /><p className="mt-3 text-sm">{tx("No safe inline preview for")} {contentType}</p></div>; })()}
          </div>

          <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
            <dt className="text-secondary">{t("key")}</dt><dd className="break-all font-mono text-xs">{item.key}</dd>
            <dt className="text-secondary">{t("size")}</dt><dd>{formatBytes(head?.size ?? item.size, bootstrap?.preferences.locale)}</dd>
            <dt className="text-secondary">{t("type")}</dt><dd>{contentType}</dd>
            <dt className="text-secondary">{t("modified")}</dt><dd>{formatDate(head?.lastModified ?? item.lastModified, bootstrap?.preferences.locale)}</dd>
            <dt className="text-secondary">{t("etag")}</dt><dd className="break-all font-mono text-xs">{head?.etag ?? item.etag ?? "—"}</dd>
            <dt className="text-secondary">{t("access")}</dt><dd><Badge color={access === "private" ? "secondary" : "warning"}>{access === "private" ? t("private") : access === "public-custom" ? t("publicCustom") : t("publicManaged")}</Badge></dd>
          </dl>

          <details className="rounded-xl border border-subtle p-3">
            <summary className="cursor-pointer text-sm font-medium">{tx("Edit HTTP and custom metadata")}</summary>
            <Alert className="mt-3" color="warning" title={tx("Metadata replacement affects live delivery")} description={tx("Saving rewrites this object's metadata in place. Its body and key remain unchanged, but caches, downloads, content rendering, and any metadata not present in this form can change immediately.")} />
            <div className="mt-3 flex flex-wrap gap-2" aria-label={tx("Cache-Control presets")}><Button color="secondary" variant="outline" size="xs" onClick={() => setMetadata((current) => ({ ...current, cacheControl: "public, max-age=31536000, immutable" }))}>{tx("Long-lived static asset")}</Button><Button color="secondary" variant="outline" size="xs" onClick={() => setMetadata((current) => ({ ...current, cacheControl: "public, max-age=60, must-revalidate" }))}>{tx("Frequently updated")}</Button><Button color="secondary" variant="outline" size="xs" onClick={() => setMetadata((current) => ({ ...current, cacheControl: "private, no-store" }))}>{tx("Private no-store")}</Button></div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-secondary">Content-Type<Input className="mt-1" value={metadata.contentType ?? ""} onChange={(event) => setMetadata((current) => ({ ...current, contentType: event.target.value }))} placeholder="image/webp" /></label>
              <label className="text-xs text-secondary">Cache-Control<Input className="mt-1" value={metadata.cacheControl ?? ""} onChange={(event) => setMetadata((current) => ({ ...current, cacheControl: event.target.value }))} placeholder="public, max-age=31536000, immutable" /></label>
              <label className="text-xs text-secondary">Content-Disposition<Input className="mt-1" value={metadata.contentDisposition ?? ""} onChange={(event) => setMetadata((current) => ({ ...current, contentDisposition: event.target.value }))} placeholder="inline" /></label>
              <label className="text-xs text-secondary">Content-Language<Input className="mt-1" value={metadata.contentLanguage ?? ""} onChange={(event) => setMetadata((current) => ({ ...current, contentLanguage: event.target.value }))} placeholder="zh-CN" /></label>
            </div>
            <label className="mt-3 block text-xs text-secondary">{tx("Custom metadata (JSON string values)")}<textarea className="mt-1 min-h-24 w-full rounded-lg border border-default bg-surface p-2 font-mono text-xs" value={customMetadataText} onChange={(event) => setCustomMetadataText(event.target.value)} /></label>
            <div className="mt-3 text-right"><Button color="primary" variant="outline" size="sm" loading={busy} onClick={() => void saveMetadata()}>{tx("Save metadata")}</Button></div>
          </details>

          {share ? (
            <div className="rounded-2xl border border-success-outline bg-success-soft p-3">
              <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">{share.kind === "temporary" ? t("temporaryLink") : t("publicLink")}</p><select className="h-7 rounded-md border border-default bg-surface px-2 text-xs" value={shareTemplate} onChange={(event) => setShareTemplate(event.target.value)}><option value="url">URL</option><option value="markdown">Markdown</option><option value="html">HTML</option><option value="css">CSS</option><option value="json">JSON</option>{Object.keys(shareTemplates).map((name) => <option key={name} value={name}>{name}</option>)}</select></div>
              <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-surface p-2 text-xs">{shareText}</pre>
              <div className="mt-2 flex items-center justify-between gap-2">{share.expiresAt ? <p className="text-xs text-secondary">{zh ? "授权链接 · 到期时间" : "Bearer link · expires"} {formatDate(share.expiresAt, bootstrap?.preferences.locale)}</p> : <p className="text-xs text-secondary">{tx("Permanent while this public domain stays enabled.")}</p>}<Button color="success" variant="outline" size="sm" onClick={() => void window.r2.system.copyText(shareText)}><Copy />{t("copy")}</Button></div>
            </div>
          ) : null}

          <div className="flex flex-wrap justify-between gap-3 border-t border-subtle pt-4">
            <div className="flex flex-wrap gap-2">
              <Button color="secondary" variant="outline" disabled={busy} onClick={async () => { try { const result = unwrap(await window.r2.objects.download({ profileId, bucket, key: item.key })); if (result) setTransfersOpen(true); } catch (problem) { setError(errorData(problem)); } }}><Download />{t("download")}</Button>
              {!inTrash ? <Button color="secondary" variant="outline" disabled={busy} onClick={() => setRenameOpen(true)}><Edit />{t("rename")}</Button> : null}
              {inTrash ? <Button color="success" variant="outline" disabled={busy} onClick={() => void restore()}><ArrowRotateCw />{zh ? `恢复到 ${originalKey}` : `Restore to ${originalKey}`}</Button> : <Button color="danger" variant="ghost" disabled={busy} onClick={() => void trash()}><Trash />{t("moveToTrash")}</Button>}
              {inTrash ? <Button color="danger" variant="ghost" disabled={busy} onClick={() => void deletePermanent()}><Trash />{t("permanentDelete")}</Button> : null}
            </div>
            {!inTrash ? <div className="flex flex-wrap gap-2">
              <select aria-label={tx("Temporary link expiry")} className="h-8 rounded-lg border border-default bg-surface px-2 text-xs" value={shareExpiry} onChange={(event) => setShareExpiry(Number(event.target.value))}><option value={900}>{tx("15 minutes")}</option><option value={3600}>{tx("1 hour")}</option><option value={86400}>{tx("1 day")}</option><option value={604800}>{tx("7 days")}</option></select>
              <Button color="secondary" variant="outline" disabled={busy} onClick={() => { onClose(); onOrganize({ kind: "object", key: item.key }); }}><Copy />{tx("Move / copy")}</Button>
              <Button color="secondary" variant="outline" loading={busy} onClick={() => void makeShare("public")}><Share />{t("publicLink")}</Button>
              <Button color="primary" loading={busy} onClick={() => void makeShare("temporary")}><Share />{t("temporaryLink")}</Button>
            </div> : null}
          </div>
        </div>
      </Modal>
      <Modal open={renameOpen} onClose={() => setRenameOpen(false)} title={t("rename")} description={tx("Copy → verify → delete source. The source is never removed before verification.")}>
        <div className="space-y-4"><Input value={nextKey} onChange={(event) => setNextKey(event.target.value)} autoFocus /><div className="flex justify-end gap-2"><Button color="secondary" variant="outline" onClick={() => setRenameOpen(false)}>{t("cancel")}</Button><Button color="primary" loading={busy} disabled={!nextKey || nextKey === item.key} onClick={() => void rename()}>{t("rename")}</Button></div></div>
      </Modal>
    </>
  );
};

export default function BucketPage() {
  const router = useRouter();
  const { activeProfile, bootstrap, updatePreferences, t, tx } = useAppState();
  const zh = bootstrap?.preferences.locale === "zh-CN";
  const { setOpen: setTransfersOpen, items: transfers } = useTransfers();
  const bucket = typeof router.query.name === "string" ? router.query.name : "";
  const delimiter = Array.isArray(router.query.delimiter) ? router.query.delimiter : typeof router.query.delimiter === "string" ? [router.query.delimiter] : [];
  const prefix = delimiter.length ? `${delimiter.join("/")}/` : "";
  const [page, setPage] = useState<ObjectListPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AppErrorData | null>(null);
  const [search, setSearch] = useState("");
  const [searchScope, setSearchScope] = useState<"folder" | "bucket">("folder");
  const [view, setView] = useState<ViewMode>(bootstrap?.preferences.defaultView ?? "grid");
  const [sort, setSort] = useState<SortMode>("name");
  const [filter, setFilter] = useState("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [minSizeMb, setMinSizeMb] = useState("");
  const [maxSizeMb, setMaxSizeMb] = useState("");
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<ObjectItem | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [dragItemCount, setDragItemCount] = useState(0);
  const [pendingUpload, setPendingUpload] = useState<{ handles: LocalFileHandle[]; destination: string } | null>(null);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [folderBusy, setFolderBusy] = useState(false);
  const [bucketInfo, setBucketInfo] = useState<BucketItem | null>(null);
  const [buckets, setBuckets] = useState<BucketItem[]>([]);
  const [organizeSources, setOrganizeSources] = useState<OrganizeSource[]>([]);
  const [organizeOpen, setOrganizeOpen] = useState(false);
  const [favorite, setFavorite] = useState(false);
  const [offlinePinned, setOfflinePinned] = useState(false);
  const [batchShareOpen, setBatchShareOpen] = useState(false);
  const [bucketToolsOpen, setBucketToolsOpen] = useState(false);
  const [remoteEventAt, setRemoteEventAt] = useState<string>();
  const [selectionBox, setSelectionBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const requestId = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const savedScrollTop = useRef(0);
  const lastSelected = useRef<number | null>(null);
  const seenCompleted = useRef(new Set<string>());
  const boxStart = useRef<{ x: number; y: number; base: Set<string>; container: HTMLElement } | null>(null);
  const viewPreferenceKey = activeProfile && bucket ? `${activeProfile.id}:${bucket}` : "";
  const navigationStateKey = activeProfile && bucket ? `r2uploader:navigation:${activeProfile.id}:${bucket}:${prefix}` : "";
  const profileSearchHistory = activeProfile && bootstrap ? bootstrap.preferences.profileSearchHistories[activeProfile.id] ?? bootstrap.preferences.searchHistory : [];
  const navigationState = useRef({ search, searchScope, sort, filter, dateFrom, dateTo, minSizeMb, maxSizeMb });
  navigationState.current = { search, searchScope, sort, filter, dateFrom, dateTo, minSizeMb, maxSizeMb };

  useEffect(() => {
    if (viewPreferenceKey && bootstrap) setView(bootstrap.preferences.profileDefaultViews[viewPreferenceKey] ?? bootstrap.preferences.defaultView);
  }, [bootstrap?.preferences.defaultView, bootstrap?.preferences.profileDefaultViews, viewPreferenceKey]);

  const load = useCallback(async (options?: { append?: boolean; cursor?: string }) => {
    if (!activeProfile || !bucket) return;
    const currentRequest = ++requestId.current;
    setLoading(true);
    try {
      const result = searchScope === "bucket" && search.trim()
        ? unwrap<ObjectListPage>(await window.r2.objects.search({ profileId: activeProfile.id, bucket, query: search.trim() }))
        : unwrap<ObjectListPage>(await window.r2.objects.list({ profileId: activeProfile.id, bucket, prefix: `${prefix}${search.trim()}` || undefined, cursor: options?.cursor, delimiter: "/" }));
      if (currentRequest !== requestId.current) return;
      setPage((current) => mergeObjectPages(current, result, Boolean(options?.append)));
      setError(null);
    } catch (problem) {
      if (currentRequest === requestId.current) setError(errorData(problem));
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [activeProfile, bucket, prefix, search, searchScope]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), search ? 250 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  useEffect(() => {
    const intervalSeconds = bootstrap?.preferences.refreshIntervalSeconds ?? 60;
    if (!intervalSeconds) return;
    const timer = window.setInterval(() => void load(), intervalSeconds * 1_000);
    return () => window.clearInterval(timer);
  }, [bootstrap?.preferences.refreshIntervalSeconds, load]);

  useEffect(() => {
    let changed = false;
    for (const transfer of transfers) {
      if (transfer.profileId === activeProfile?.id && transfer.bucket === bucket && transfer.status === "completed" && !seenCompleted.current.has(transfer.id)) changed = true;
      if (transfer.status === "completed") seenCompleted.current.add(transfer.id);
    }
    if (changed) void load();
  }, [activeProfile?.id, bucket, load, transfers]);

  useEffect(() => window.r2.events.onRemoteChanged((value) => {
    const event = value as { profileId?: string; bucket?: string; keys?: string[]; receivedAt?: string };
    if (event.profileId === activeProfile?.id && event.bucket === bucket && (!event.keys?.length || event.keys.some((key) => key.startsWith(prefix)))) {
      setRemoteEventAt(event.receivedAt ?? new Date().toISOString());
      void load();
    }
  }), [activeProfile?.id, bucket, load, prefix]);

  useEffect(() => {
    setSelection(new Set());
    setPage(null);
    if (!navigationStateKey) return;
    try {
      const saved = JSON.parse(sessionStorage.getItem(navigationStateKey) ?? "null") as Partial<typeof navigationState.current> & { scrollTop?: number } | null;
      setSearch(saved?.search ?? "");
      setSearchScope(saved?.searchScope === "bucket" ? "bucket" : "folder");
      setSort(["name", "date", "size", "type"].includes(saved?.sort ?? "") ? saved?.sort as SortMode : "name");
      setFilter(saved?.filter ?? "all");
      setDateFrom(saved?.dateFrom ?? "");
      setDateTo(saved?.dateTo ?? "");
      setMinSizeMb(saved?.minSizeMb ?? "");
      setMaxSizeMb(saved?.maxSizeMb ?? "");
      savedScrollTop.current = saved?.scrollTop ?? 0;
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: savedScrollTop.current }));
    } catch { sessionStorage.removeItem(navigationStateKey); }
    const key = navigationStateKey;
    return () => {
      sessionStorage.setItem(key, JSON.stringify({ ...navigationState.current, scrollTop: savedScrollTop.current }));
    };
  }, [navigationStateKey]);

  useEffect(() => {
    const location = activeProfile && bucket ? `${activeProfile.id}:${bucket}:${prefix}` : "";
    if (!location || !bootstrap) return;
    setFavorite(bootstrap.preferences.favoriteLocations.includes(location));
    setOfflinePinned(bootstrap.preferences.offlineLocations.includes(location));
    if (bootstrap.preferences.recentLocations[0] === location) return;
    const recentLocations = [location, ...bootstrap.preferences.recentLocations.filter((item) => item !== location)].slice(0, 30);
    void updatePreferences({ recentLocations });
  }, [activeProfile?.id, bootstrap, bucket, prefix, updatePreferences]);

  useEffect(() => {
    if (!activeProfile || !bucket) return;
    window.r2.buckets.list(activeProfile.id)
      .then((result) => {
        const items = unwrap<BucketItem[]>(result);
        setBuckets(items);
        setBucketInfo(items.find((item) => item.name === bucket) ?? null);
      })
      .catch(() => { setBuckets([]); setBucketInfo(null); });
  }, [activeProfile, bucket]);

  const visibleObjects = useMemo(() => {
    const from = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : undefined;
    const to = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : undefined;
    const minBytes = minSizeMb ? Number(minSizeMb) * 1024 * 1024 : undefined;
    const maxBytes = maxSizeMb ? Number(maxSizeMb) * 1024 * 1024 : undefined;
    const filtered = (page?.objects ?? []).filter((item) => {
      if (filter !== "all" && typeGroup(item) !== filter) return false;
      const modified = item.lastModified ? Date.parse(item.lastModified) : undefined;
      if (from !== undefined && (!modified || modified < from)) return false;
      if (to !== undefined && (!modified || modified > to)) return false;
      if (minBytes !== undefined && item.size < minBytes) return false;
      if (maxBytes !== undefined && item.size > maxBytes) return false;
      return true;
    });
    return [...filtered].sort((a, b) => {
      if (sort === "size") return b.size - a.size || a.key.localeCompare(b.key);
      if (sort === "date") return (b.lastModified ?? "").localeCompare(a.lastModified ?? "") || a.key.localeCompare(b.key);
      if (sort === "type") return (a.contentType ?? "").localeCompare(b.contentType ?? "") || a.key.localeCompare(b.key);
      return a.key.localeCompare(b.key);
    });
  }, [dateFrom, dateTo, filter, maxSizeMb, minSizeMb, page?.objects, sort]);
  const hasAdvancedFilters = Boolean(dateFrom || dateTo || minSizeMb || maxSizeMb);

  const stageUpload = (handles: LocalFileHandle[], destination = prefix) => { if (handles.length) setPendingUpload({ handles, destination }); };
  const chooseFiles = async () => stageUpload(unwrap<LocalFileHandle[]>(await window.r2.uploads.chooseFiles()));
  const chooseFolder = async () => stageUpload(unwrap<LocalFileHandle[]>(await window.r2.uploads.chooseFolder()));
  const dropFiles = async (event: React.DragEvent, destination = prefix) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    setDragItemCount(0);
    const handles: LocalFileHandle[] = [];
    for (const file of Array.from(event.dataTransfer.files)) {
      try { handles.push(...unwrap<LocalFileHandle[]>(await window.r2.uploads.registerDroppedFile(file))); }
      catch (problem) { setError(errorData(problem)); }
    }
    stageUpload(handles, destination);
  };

  const select = (key: string, index: number, event: React.MouseEvent | React.ChangeEvent) => {
    setSelection((current) => {
      const next = new Set(current);
      const native = "nativeEvent" in event ? event.nativeEvent as MouseEvent : null;
      if (native?.shiftKey && lastSelected.current !== null) {
        const [start, end] = [lastSelected.current, index].sort((a, b) => a - b);
        visibleObjects.slice(start, end + 1).forEach((item) => next.add(item.key));
      } else if (next.has(key)) next.delete(key); else next.add(key);
      lastSelected.current = index;
      return next;
    });
  };

  const startBoxSelection = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("[data-object-key]")) return;
    const container = event.currentTarget;
    boxStart.current = { x: event.clientX, y: event.clientY, base: event.metaKey || event.ctrlKey ? new Set(selection) : new Set(), container };
    container.setPointerCapture(event.pointerId);
  };
  const moveBoxSelection = (event: React.PointerEvent<HTMLElement>) => {
    const start = boxStart.current;
    if (!start) return;
    const left = Math.min(start.x, event.clientX);
    const top = Math.min(start.y, event.clientY);
    const right = Math.max(start.x, event.clientX);
    const bottom = Math.max(start.y, event.clientY);
    if (right - left < 3 && bottom - top < 3) return;
    setSelectionBox({ left, top, width: right - left, height: bottom - top });
    const next = new Set(start.base);
    start.container.querySelectorAll<HTMLElement>("[data-object-key]").forEach((element) => {
      const rect = element.getBoundingClientRect();
      if (rect.left < right && rect.right > left && rect.top < bottom && rect.bottom > top) next.add(element.dataset.objectKey as string);
    });
    setSelection(next);
  };
  const finishBoxSelection = (event: React.PointerEvent<HTMLElement>) => {
    if (boxStart.current) event.currentTarget.releasePointerCapture(event.pointerId);
    boxStart.current = null;
    setSelectionBox(null);
  };

  const trashSelected = async () => {
    if (!activeProfile || selection.size === 0 || !window.confirm(zh ? `将 ${selection.size} 个对象移到回收站？` : `Move ${selection.size} object(s) to Trash?`)) return;
    const failures: Array<{ key: string; error: AppErrorData }> = [];
    for (const key of selection) {
      try { unwrap(await window.r2.objects.trash({ profileId: activeProfile.id, bucket, key })); }
      catch (problem) { failures.push({ key, error: errorData(problem) }); }
    }
    setSelection(new Set());
    await load();
    if (failures.length) setError({ kind: "PARTIAL_SUCCESS", code: "BATCH_TRASH_PARTIAL", message: `${failures.length} object(s) could not be moved to Trash.`, action: failures.map((failure) => `${failure.key}: ${failure.error.message}`).join("; "), retryable: failures.some((failure) => failure.error.retryable) });
  };
  const createRemoteFolder = async () => {
    if (!activeProfile || !folderName.trim()) return;
    setFolderBusy(true);
    try {
      unwrap(await window.r2.folders.create({ profileId: activeProfile.id, bucket, prefix: `${prefix}${folderName.trim()}` }));
      setFolderName("");
      setCreateFolderOpen(false);
      await load();
    } catch (problem) { setError(errorData(problem)); } finally { setFolderBusy(false); }
  };
  const trashFolder = async (folder: string) => {
    if (!activeProfile || !window.confirm(zh ? `将“${folder}”下的每个对象都移到回收站？` : `Move every object under “${folder}” to Trash?`)) return;
    setFolderBusy(true);
    try {
      const result = unwrap<{ total: number; queued: number; transferIds: string[] }>(await window.r2.folders.operate({ operation: "trash", profileId: activeProfile.id, sourceBucket: bucket, sourcePrefix: folder }));
      if (result.queued) setTransfersOpen(true);
    } catch (problem) { setError(errorData(problem)); } finally { setFolderBusy(false); }
  };
  const openOrganize = (sources: OrganizeSource[]) => {
    setOrganizeSources(sources);
    setOrganizeOpen(true);
  };
  const toggleFavorite = async () => {
    if (!activeProfile || !bootstrap) return;
    const location = `${activeProfile.id}:${bucket}:${prefix}`;
    const favoriteLocations = favorite
      ? bootstrap.preferences.favoriteLocations.filter((item) => item !== location)
      : [location, ...bootstrap.preferences.favoriteLocations.filter((item) => item !== location)].slice(0, 500);
    await updatePreferences({ favoriteLocations });
    setFavorite(!favorite);
  };
  const toggleOffline = async () => {
    if (!activeProfile || !bootstrap) return;
    const location = `${activeProfile.id}:${bucket}:${prefix}`;
    if (offlinePinned) {
      await updatePreferences({ offlineLocations: bootstrap.preferences.offlineLocations.filter((item) => item !== location) });
      setOfflinePinned(false);
      return;
    }
    if (!window.confirm(zh ? `让 r2://${bucket}/${prefix} 下的小对象可离线使用？\n\n不超过 10 MB 的对象会下载到有容量上限的私有预览缓存；过大或失败的对象会报告并跳过。` : `Keep small objects under r2://${bucket}/${prefix} available offline?\n\nObjects up to 10 MB are downloaded into the bounded private preview cache. Large or failed objects are reported and skipped.`)) return;
    try {
      const result = unwrap<{ cached: number; skipped: number; failed: number; bytes: number }>(await window.r2.cache.pinPrefix({ profileId: activeProfile.id, bucket, prefix, confirmation: true }));
      await updatePreferences({ offlineLocations: [location, ...bootstrap.preferences.offlineLocations.filter((item) => item !== location)].slice(0, 500) });
      setOfflinePinned(true);
      setError(result.failed ? { kind: "PARTIAL_SUCCESS", code: "OFFLINE_CACHE_PARTIAL", message: `${result.cached} objects cached; ${result.skipped} large and ${result.failed} failed objects were not cached.`, retryable: true } : null);
    } catch (problem) { setError(errorData(problem)); }
  };
  const rememberSearch = async () => {
    const value = search.trim();
    if (!value || !activeProfile || !bootstrap?.preferences.rememberSearches) return;
    const history = [value, ...profileSearchHistory.filter((item) => item !== value)].slice(0, 30);
    await updatePreferences({ profileSearchHistories: { ...bootstrap.preferences.profileSearchHistories, [activeProfile.id]: history } });
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = target?.matches("input, textarea, select, [contenteditable=true]");
      if (!editing && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        setSelection(new Set(visibleObjects.map((item) => item.key)));
      }
      if (!editing && event.key === "Escape") {
        setPreview(null);
        setSelection(new Set());
      }
      if (!editing && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "r") {
        event.preventDefault();
        void load();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [load, visibleObjects]);

  const breadcrumbs = delimiter.map((segment, index) => ({ label: segment, prefix: `${delimiter.slice(0, index + 1).join("/")}/` }));
  if (!activeProfile && router.isReady) void router.push("/home");

  return (
    <>
      <Head><title>{bucket || t("appName")} · {t("appName")}</title></Head>
      <div
        ref={scrollRef}
        className={`page-scroll ${dragActive ? "drop-active" : ""}`}
        onScroll={(event) => { savedScrollTop.current = event.currentTarget.scrollTop; }}
        onDragEnter={(event) => { event.preventDefault(); setDragActive(true); setDragItemCount(event.dataTransfer.items.length || event.dataTransfer.files.length); }}
        onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setDragItemCount(event.dataTransfer.items.length || event.dataTransfer.files.length); }}
        onDragLeave={(event) => { if (event.currentTarget === event.target) { setDragActive(false); setDragItemCount(0); } }}
        onDrop={(event) => void dropFiles(event)}
      >
        <div className="page-container">
          <header>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <Button color="secondary" variant="ghost" size="sm" uniform aria-label={tx("Back to buckets")} onClick={() => void router.push("/home")}><ArrowLeft /></Button>
                <div className="min-w-0"><p className="text-xs text-secondary">{activeProfile?.name}</p><h1 className="heading-lg truncate">{bucket}</h1></div>
                <Badge color={bucketInfo?.access === "private" || !bucketInfo ? "secondary" : "warning"}><Info className="size-3" />{!bucketInfo || bucketInfo.access === "private" ? t("private") : bucketInfo.access === "public-custom" ? t("publicCustom") : t("publicManaged")}</Badge>
                <Button color={favorite ? "primary" : "secondary"} variant={favorite ? "soft" : "ghost"} size="xs" uniform aria-label={tx(favorite ? "Remove current location from favorites" : "Add current location to favorites")} onClick={() => void toggleFavorite()}><Love /></Button>
                <Button color={offlinePinned ? "primary" : "secondary"} variant={offlinePinned ? "soft" : "ghost"} size="xs" uniform aria-label={tx(offlinePinned ? "Stop retaining this prefix offline" : "Keep small objects in this prefix offline")} onClick={() => void toggleOffline()}><Download /></Button>
              </div>
              <div className="window-no-drag flex flex-wrap gap-2">
                <Button color="secondary" variant="outline" loading={loading} onClick={() => void load()}><ArrowRotateCw />{t("refresh")}</Button>
                <Button color="secondary" variant="outline" onClick={() => setBucketToolsOpen(true)}><Settings />{tx("Bucket tools")}</Button>
                <Button color="secondary" variant="outline" onClick={() => void routeToPrefix(router, bucket, ".r2uploader-trash/")}><Trash />{tx("Trash")}</Button>
                <Button color="secondary" variant="outline" onClick={() => setCreateFolderOpen(true)}><FolderPlus />{tx("New folder")}</Button>
                <Button color="secondary" variant="outline" onClick={() => void chooseFolder()}><Folder />{t("chooseFolder")}</Button>
                <Button color="primary" onClick={() => void chooseFiles()}><UploadDocuments />{t("chooseFiles")}</Button>
              </div>
            </div>
            <nav className="mt-4 flex min-h-8 flex-wrap items-center gap-1 text-sm" aria-label={tx("Breadcrumb")}>
              <button className="rounded-md px-2 py-1 text-secondary hover:bg-surface-secondary hover:text-primary" onClick={() => void routeToPrefix(router, bucket, "")}>{bucket}</button>
              {breadcrumbs.map((crumb) => <span key={crumb.prefix} className="flex items-center gap-1"><ChevronRight className="size-4 text-tertiary" /><button className="rounded-md px-2 py-1 text-secondary hover:bg-surface-secondary hover:text-primary" onClick={() => void routeToPrefix(router, bucket, crumb.prefix)}>{crumb.label}</button></span>)}
            </nav>
          </header>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Input className="min-w-64 flex-1" value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void rememberSearch(); }} placeholder={searchScope === "folder" ? t("searchObjects") : tx("Contains search across the whole bucket")} startAdornment={<Search className="size-4" />} />
            <SegmentedControl value={searchScope} onChange={(value) => setSearchScope(value as "folder" | "bucket")} aria-label={tx("Search scope")} size="sm"><SegmentedControl.Option value="folder">{tx("Folder")}</SegmentedControl.Option><SegmentedControl.Option value="bucket">{tx("Bucket")}</SegmentedControl.Option></SegmentedControl>
            <select aria-label={tx("Sort loaded objects")} className="h-8 rounded-lg border border-default bg-surface px-2 text-sm" value={sort} onChange={(event) => setSort(event.target.value as SortMode)}><option value="name">{t("sortName")}</option><option value="date">{t("sortDate")}</option><option value="size">{t("sortSize")}</option><option value="type">{tx("File type")}</option></select>
            <select className="h-8 rounded-lg border border-default bg-surface px-2 text-sm" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">{t("allTypes")}</option><option value="image">{tx("Images")}</option><option value="media">{tx("Audio & video")}</option><option value="document">{tx("Documents")}</option><option value="other">{tx("Other")}</option></select>
            <Button color={hasAdvancedFilters ? "primary" : "secondary"} variant="outline" size="sm" onClick={() => setFiltersOpen((value) => !value)}>{tx("Date & size filters")}</Button>
            <SegmentedControl value={view} onChange={(next) => { const value = next as ViewMode; setView(value); if (viewPreferenceKey && bootstrap) void updatePreferences({ profileDefaultViews: { ...bootstrap.preferences.profileDefaultViews, [viewPreferenceKey]: value } }); }} aria-label={tx("View mode")} size="sm"><SegmentedControl.Option value="grid"><Grid className="size-4" /></SegmentedControl.Option><SegmentedControl.Option value="list"><VideoList className="size-4" /></SegmentedControl.Option></SegmentedControl>
          </div>

          {filtersOpen ? <div className="mt-3 grid gap-2 rounded-xl border border-subtle bg-surface-secondary p-3 sm:grid-cols-5"><label className="text-xs font-medium">{tx("Modified from")}<Input className="mt-1" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label><label className="text-xs font-medium">{tx("Modified through")}<Input className="mt-1" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label><label className="text-xs font-medium">{tx("Minimum size (MB)")}<Input className="mt-1" type="number" min={0} value={minSizeMb} onChange={(event) => setMinSizeMb(event.target.value)} /></label><label className="text-xs font-medium">{tx("Maximum size (MB)")}<Input className="mt-1" type="number" min={0} value={maxSizeMb} onChange={(event) => setMaxSizeMb(event.target.value)} /></label><div className="flex items-end"><Button color="secondary" variant="ghost" size="sm" disabled={!hasAdvancedFilters && filter === "all"} onClick={() => { setDateFrom(""); setDateTo(""); setMinSizeMb(""); setMaxSizeMb(""); setFilter("all"); }}>{tx("Clear filters")}</Button></div></div> : null}

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-tertiary">
            <span>{zh ? (search ? `${searchScope === "folder" ? "前缀" : "包含"}搜索 · ${searchScope === "folder" ? `/${prefix}` : `整个存储桶 · 已扫描 ${page?.scannedObjects ?? 0} 个${page?.searchTruncated ? "（达到扫描上限）" : ""}`} · ` : `${t("currentScope")}: /${prefix} · `) : (search ? `${searchScope === "folder" ? "Prefix" : "Contains"} search · ${searchScope === "folder" ? `/${prefix}` : `whole bucket · ${page?.scannedObjects ?? 0} scanned${page?.searchTruncated ? " (scan limit reached)" : ""}`} · ` : `${t("currentScope")}: /${prefix} · `)}{(page?.folders.length ?? 0)} {zh ? "个文件夹" : "folders"} · {visibleObjects.length}/{page?.objects.length ?? 0} {zh ? "个已加载对象命中" : "loaded objects match"}{page?.hasMore ? (zh ? " · 尚有远端结果未加载" : " · more remote results not loaded") : ""}</span>
            <span>{page?.syncedAt ? `${t("lastSynced")} ${formatDate(page.syncedAt, bootstrap?.preferences.locale)}${remoteEventAt ? ` · ${zh ? "远端事件" : "remote event"} ${formatDate(remoteEventAt, bootstrap?.preferences.locale)}` : zh ? " · 后备轮询已启用" : " · polling fallback active"}` : ""}</span>
          </div>
          {search && profileSearchHistory.length ? <div className="mt-2 flex flex-wrap items-center gap-1 text-xs text-secondary"><span>{tx("Recent:")}</span>{profileSearchHistory.slice(0, 6).map((value) => <button key={value} className="rounded-md bg-surface-secondary px-2 py-1 hover:text-primary" onClick={() => setSearch(value)}>{value}</button>)}<button className="px-2 py-1 text-tertiary hover:text-primary" onClick={() => setSearch("")}>{tx("Clear")}</button></div> : null}

          {selection.size ? (
            <div className="sticky top-2 z-20 mt-4 flex items-center justify-between gap-3 rounded-xl border border-default bg-surface-elevated px-3 py-2 shadow-lg">
              <p className="text-sm font-medium">{selection.size} {t("selected")} · {formatBytes(visibleObjects.filter((item) => selection.has(item.key)).reduce((sum, item) => sum + item.size, 0), bootstrap?.preferences.locale)}</p>
              <div className="flex gap-2"><Button color="secondary" variant="ghost" size="sm" onClick={() => setSelection(new Set())}>{t("clearSelection")}</Button><Button color="secondary" variant="outline" size="sm" onClick={() => setBatchShareOpen(true)}><Share />{tx("Links")}</Button><Button color="secondary" variant="outline" size="sm" onClick={() => openOrganize(visibleObjects.filter((item) => selection.has(item.key)).map((item) => ({ kind: "object", key: item.key })))}><Copy />{tx("Move / copy")}</Button><Button color="danger" variant="soft" size="sm" onClick={() => void trashSelected()}><Trash />{t("moveToTrash")}</Button></div>
            </div>
          ) : null}

          {error ? <div className="mt-5"><ErrorPanel error={error} onRetry={() => void load()} /></div> : null}
          {!error && loading && !page ? <p className="mt-16 text-center text-sm text-secondary">{t("loading")}</p> : null}
          {isConfirmedEmptyListing(page, visibleObjects, loading, Boolean(error)) ? (
            <div className="mt-16"><EmptyMessage fill="none"><EmptyMessage.Icon><UploadDocuments /></EmptyMessage.Icon><EmptyMessage.Title>{t("objectsEmpty")}</EmptyMessage.Title><EmptyMessage.Description>{search ? (searchScope === "bucket" ? (zh ? `整个存储桶中没有包含“${search}”的 Key。` : `No key contains “${search}” in this bucket.`) : (zh ? `此文件夹中没有以“${search}”开头的 Key。` : `No key starts with “${search}” in this folder.`)) : t("objectsEmptyDescription")}</EmptyMessage.Description><EmptyMessage.ActionRow><Button color="primary" onClick={() => void chooseFiles()}><UploadDocuments />{t("chooseFiles")}</Button></EmptyMessage.ActionRow></EmptyMessage></div>
          ) : null}

          {dragActive ? <Alert className="sticky top-3 z-30 mt-4" color="info" variant="solid" title={`${t("uploadDrop")} r2://${bucket}/${prefix}`} description={`${dragItemCount ? (zh ? `${dragItemCount} 个顶层拖入项；文件夹会在放手后递归展开。` : `${dragItemCount} top-level dropped item(s); folders expand recursively after drop. `) : ""}${tx("The target remains private. Conflict rules are shown in the toolbar.")}`} /> : null}

          {page?.folders.length ? (
            <section className="mt-6">
              <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-tertiary">{tx("Folders")}</h2>
              <div className="object-grid">
                {page.folders.map((folder) => {
                  const label = folder.replace(prefix, "").replace(/\/$/, "") || folder;
                  return <div key={folder} className="surface-card interactive-card flex min-h-20 items-center gap-3 p-4 text-left" role="button" tabIndex={0} onClick={() => void routeToPrefix(router, bucket, folder)} onKeyDown={(event) => event.key === "Enter" && void routeToPrefix(router, bucket, folder)} onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "copy"; setDragItemCount(event.dataTransfer.items.length || event.dataTransfer.files.length); }} onDrop={(event) => void dropFiles(event, folder)}><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-secondary"><Folder className="size-5" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{label}</span><span className="block truncate text-xs text-tertiary">{dragActive ? `r2://${bucket}/${folder}` : zh ? "前缀 · 拖放到这里上传" : "prefix · drop to upload here"}</span></span>{!folder.startsWith(".r2uploader-trash/") ? <span className="flex"><Button color="secondary" variant="ghost" size="xs" uniform aria-label={zh ? `移动或复制 ${folder}` : `Move or copy ${folder}`} disabled={folderBusy} onClick={(event) => { event.stopPropagation(); openOrganize([{ kind: "folder", key: folder }]); }}><Copy /></Button><Button color="danger" variant="ghost" size="xs" uniform aria-label={zh ? `将 ${folder} 移到回收站` : `Move ${folder} to Trash`} disabled={folderBusy} onClick={(event) => { event.stopPropagation(); void trashFolder(folder); }}><Trash /></Button></span> : null}</div>;
                })}
              </div>
            </section>
          ) : null}

          {visibleObjects.length ? (
            <section className="mt-6">
              <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-tertiary">{tx("Objects")}</h2>
              {view === "grid" ? (
                <div className="object-grid select-none" onPointerDown={startBoxSelection} onPointerMove={moveBoxSelection} onPointerUp={finishBoxSelection} onPointerCancel={finishBoxSelection}>
                  {visibleObjects.map((item, index) => { const Icon = iconFor(item); const checked = selection.has(item.key); return (
                    <article data-object-key={item.key} key={item.key} className={`surface-card interactive-card relative min-h-36 cursor-default p-4 ${checked ? "ring-2 ring-info" : ""}`} onClick={(event) => select(item.key, index, event)} onDoubleClick={() => setPreview(item)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") setPreview(item); if (event.key === " ") { event.preventDefault(); select(item.key, index, event as unknown as React.MouseEvent); } }}>
                      <input type="checkbox" aria-label={zh ? `选择 ${item.displayName}` : `Select ${item.displayName}`} checked={checked} onChange={(event) => select(item.key, index, event)} onClick={(event) => event.stopPropagation()} className="absolute right-3 top-3" />
                      <div className="flex size-12 items-center justify-center rounded-2xl bg-surface-secondary"><Icon className="size-6" /></div>
                      <h3 className="mt-4 truncate text-sm font-medium" title={item.key}>{item.displayName}</h3>
                      <p className="mt-1 text-xs text-tertiary">{formatBytes(item.size, bootstrap?.preferences.locale)} · {formatDate(item.lastModified, bootstrap?.preferences.locale)}</p>
                      <Button className="absolute bottom-2 right-2" color="secondary" variant="ghost" size="xs" uniform aria-label={`${t("details")} ${item.displayName}`} onClick={(event) => { event.stopPropagation(); setPreview(item); }}><Info /></Button>
                    </article>
                  ); })}
                </div>
              ) : (
                <div className="surface-card overflow-hidden select-none" onPointerDown={startBoxSelection} onPointerMove={moveBoxSelection} onPointerUp={finishBoxSelection} onPointerCancel={finishBoxSelection}>
                  {visibleObjects.map((item, index) => { const Icon = iconFor(item); const checked = selection.has(item.key); return (
                    <div data-object-key={item.key} key={item.key} className={`object-list-row ${checked ? "bg-info-soft" : ""}`} onDoubleClick={() => setPreview(item)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") setPreview(item); if (event.key === " ") { event.preventDefault(); select(item.key, index, event as unknown as React.MouseEvent); } }}>
                      <div className="flex min-w-0 items-center gap-3"><input type="checkbox" checked={checked} aria-label={zh ? `选择 ${item.displayName}` : `Select ${item.displayName}`} onChange={(event) => select(item.key, index, event)} /><Icon className="size-5 shrink-0 text-secondary" /><span className="truncate text-sm" title={item.key}>{item.displayName}</span></div>
                      <span className="text-xs text-secondary">{formatBytes(item.size, bootstrap?.preferences.locale)}</span>
                      <span className="truncate text-xs text-secondary">{formatDate(item.lastModified, bootstrap?.preferences.locale)}</span>
                      <Badge color={item.access === "private" ? "secondary" : "warning"} size="sm">{item.contentType || "object"} · {tx(item.access)}</Badge>
                      <Button color="secondary" variant="ghost" size="xs" uniform aria-label={`${t("details")} ${item.displayName}`} onClick={() => setPreview(item)}><Info /></Button>
                    </div>
                  ); })}
                </div>
              )}
              {page?.hasMore ? <div className="mt-5 text-center"><Button color="secondary" variant="outline" loading={loading} onClick={() => void load({ append: true, cursor: page.cursor })}>{tx("Load more")}</Button></div> : null}
            </section>
          ) : null}
        </div>
      </div>
      {selectionBox ? <div className="selection-box" style={selectionBox} aria-hidden="true" /> : null}
      {activeProfile ? <ObjectPreview profileId={activeProfile.id} bucket={bucket} item={preview} access={bucketInfo?.access ?? "private"} onClose={() => setPreview(null)} onChanged={() => load()} onOrganize={(source) => openOrganize([source])} /> : null}
      {activeProfile ? <OrganizeDialog open={organizeOpen} onClose={() => setOrganizeOpen(false)} onComplete={async () => { setSelection(new Set()); await load(); }} profileId={activeProfile.id} sourceBucket={bucket} sources={organizeSources} buckets={buckets} /> : null}
      {activeProfile ? <BatchShareDialog open={batchShareOpen} onClose={() => setBatchShareOpen(false)} profileId={activeProfile.id} bucket={bucket} items={visibleObjects.filter((item) => selection.has(item.key))} /> : null}
      {activeProfile ? <BucketToolsDialog open={bucketToolsOpen} onClose={() => setBucketToolsOpen(false)} profileId={activeProfile.id} provider={activeProfile.provider} bucket={bucketInfo} /> : null}
      {activeProfile && pendingUpload ? <UploadPlannerDialog open={Boolean(pendingUpload)} onClose={() => setPendingUpload(null)} onQueued={() => setTransfersOpen(true)} profileId={activeProfile.id} bucket={bucket} prefix={pendingUpload.destination} handles={pendingUpload.handles} /> : null}
      <Modal open={createFolderOpen} onClose={() => setCreateFolderOpen(false)} title={tx("New folder")} description={tx("R2 has no physical folders. R2Uploader creates a hidden marker so an empty prefix remains visible.")}>
        <div className="space-y-4"><Input value={folderName} onChange={(event) => setFolderName(event.target.value.replace(/[\\/]/g, "-"))} placeholder="assets" autoFocus /><p className="text-xs text-secondary">{tx("Target")}: r2://{bucket}/{prefix}{folderName}/</p><div className="flex justify-end gap-2"><Button color="secondary" variant="outline" onClick={() => setCreateFolderOpen(false)}>{t("cancel")}</Button><Button color="primary" loading={folderBusy} disabled={!folderName.trim()} onClick={() => void createRemoteFolder()}>{t("create")}</Button></div></div>
      </Modal>
    </>
  );
}
