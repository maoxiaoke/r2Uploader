import { useEffect, useMemo, useState } from "react";
import { Alert } from "@openai/apps-sdk-ui/components/Alert";
import { Badge } from "@openai/apps-sdk-ui/components/Badge";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { Input } from "@openai/apps-sdk-ui/components/Input";
import { SegmentedControl } from "@openai/apps-sdk-ui/components/SegmentedControl";
import type { AiAnalysisResult, AppErrorData, AssetIndexRecord, BucketAnalytics, BucketItem, CorsRule, DomainHealthResult, EventRefreshSubscription, LifecycleRule, ObjectListPage, SemanticSearchResult } from "../../../shared/contracts";
import { formatBytes, formatDate } from "../../lib/format";
import { errorData, unwrap } from "../../lib/ipc";
import { useAppState } from "../../context/app-state";
import { ErrorPanel } from "./error-panel";
import { Modal } from "./modal";

type Tab = "analytics" | "index" | "lifecycle" | "cors" | "events" | "health";
const emptyRule = (): LifecycleRule => ({ id: `rule-${Date.now()}`, prefix: "", enabled: true, deleteAfterDays: 30 });

export const BucketToolsDialog = ({ open, onClose, profileId, provider, bucket }: { open: boolean; onClose: () => void; profileId: string; provider: "r2" | "s3"; bucket: BucketItem | null }) => {
  const { bootstrap, tx } = useAppState();
  const zh = bootstrap?.preferences.locale === "zh-CN";
  const [tab, setTab] = useState<Tab>("analytics");
  const [analytics, setAnalytics] = useState<BucketAnalytics | null>(null);
  const [analyticsDays, setAnalyticsDays] = useState<1 | 7 | 31>(31);
  const [lifecycle, setLifecycle] = useState<LifecycleRule[]>([]);
  const [lifecycleText, setLifecycleText] = useState("[]");
  const [cors, setCors] = useState<CorsRule[]>([]);
  const [corsText, setCorsText] = useState("[]");
  const [previousCors, setPreviousCors] = useState<CorsRule[] | null>(null);
  const [draftRule, setDraftRule] = useState<LifecycleRule>(emptyRule);
  const [origin, setOrigin] = useState("https://example.com");
  const [healthKey, setHealthKey] = useState("");
  const [health, setHealth] = useState<DomainHealthResult[]>([]);
  const [assets, setAssets] = useState<AssetIndexRecord[]>([]);
  const [assetQuery, setAssetQuery] = useState("");
  const [assetOrientation, setAssetOrientation] = useState<"all" | "square" | "landscape" | "portrait">("all");
  const [assetMinWidth, setAssetMinWidth] = useState(0);
  const [assetMinDuration, setAssetMinDuration] = useState(0);
  const [semanticQuery, setSemanticQuery] = useState("");
  const [semanticResults, setSemanticResults] = useState<SemanticSearchResult[]>([]);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [eventSubscriptions, setEventSubscriptions] = useState<EventRefreshSubscription[]>([]);
  const [queueId, setQueueId] = useState("");
  const [impact, setImpact] = useState<{ count: number; bytes: number; truncated: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppErrorData | null>(null);

  const load = async () => {
    if (!bucket) return;
    setBusy(true);
    setError(null);
    try {
      if (tab === "analytics") setAnalytics(unwrap(await window.r2.buckets.analytics({ profileId, bucket: bucket.name, days: analyticsDays })));
      if (tab === "index") setAssets(unwrap(await window.r2.assets.list({ profileId, bucket: bucket.name, query: assetQuery || undefined })));
      if (tab === "lifecycle") { const value = unwrap<LifecycleRule[]>(await window.r2.buckets.getLifecycle({ profileId, bucket: bucket.name })); setLifecycle(value); setLifecycleText(JSON.stringify(value, null, 2)); }
      if (tab === "cors") { const value = unwrap<CorsRule[]>(await window.r2.buckets.getCors({ profileId, bucket: bucket.name })); setCors(value); setCorsText(JSON.stringify(value, null, 2)); }
      if (tab === "events") setEventSubscriptions(unwrap(await window.r2.buckets.listEventRefresh({ profileId, bucket: bucket.name })));
    } catch (problem) { setError(errorData(problem)); } finally { setBusy(false); }
  };
  useEffect(() => { if (open) void load(); }, [open, tab, bucket?.name, analyticsDays]);
  useEffect(() => { if (open && provider === "s3" && tab !== "index") setTab("index"); }, [open, provider]);

  const estimateImpact = async () => {
    if (!bucket) return;
    setBusy(true);
    try {
      const page = unwrap<ObjectListPage>(await window.r2.objects.list({ profileId, bucket: bucket.name, prefix: draftRule.prefix || undefined, delimiter: "", limit: 1000 }));
      setImpact({ count: page.objects.length, bytes: page.objects.reduce((sum, item) => sum + item.size, 0), truncated: page.hasMore });
    } catch (problem) { setError(errorData(problem)); } finally { setBusy(false); }
  };
  const saveLifecycle = async (next: LifecycleRule[]) => {
    if (!bucket || window.prompt(zh ? `生命周期规则可自动删除对象或转换存储层级。\n\n输入 ${bucket.name} 确认：` : `Lifecycle rules can delete or tier objects automatically.\n\nType ${bucket.name} to confirm:`) !== bucket.name) return;
    setBusy(true);
    try { const value = unwrap<LifecycleRule[]>(await window.r2.buckets.setLifecycle({ profileId, bucket: bucket.name, rules: next, confirmation: true })); setLifecycle(value); setLifecycleText(JSON.stringify(value, null, 2)); setImpact(null); setError(null); }
    catch (problem) { setError(errorData(problem)); } finally { setBusy(false); }
  };
  const saveCors = async (next: CorsRule[], keepSnapshot = true) => {
    if (!bucket || !window.confirm(zh ? `将此 CORS 策略应用到 ${bucket.name}？浏览器访问行为会立即变化。` : `Apply this CORS policy to ${bucket.name}? Browser access can change immediately.`)) return;
    setBusy(true);
    try { if (keepSnapshot) setPreviousCors(cors); const value = unwrap<CorsRule[]>(await window.r2.buckets.setCors({ profileId, bucket: bucket.name, rules: next, confirmation: true })); setCors(value); setCorsText(JSON.stringify(value, null, 2)); setError(null); }
    catch (problem) { setError(errorData(problem)); } finally { setBusy(false); }
  };
  const applyLifecycleJson = async () => {
    try {
      const value = JSON.parse(lifecycleText) as unknown;
      if (!Array.isArray(value)) throw new Error("The lifecycle JSON root must be an array.");
      await saveLifecycle(value as LifecycleRule[]);
    } catch (problem) {
      if (problem instanceof SyntaxError || problem instanceof Error && problem.message.includes("JSON root")) setError({ kind: "VALIDATION", code: "LIFECYCLE_JSON_INVALID", message: problem.message, action: "Fix the JSON and try again. No remote changes were made.", retryable: false });
      else throw problem;
    }
  };
  const applyCorsJson = async () => {
    try {
      const value = JSON.parse(corsText) as unknown;
      if (!Array.isArray(value)) throw new Error("The CORS JSON root must be an array.");
      await saveCors(value as CorsRule[]);
    } catch (problem) {
      if (problem instanceof SyntaxError || problem instanceof Error && problem.message.includes("JSON root")) setError({ kind: "VALIDATION", code: "CORS_JSON_INVALID", message: problem.message, action: "Fix the JSON and try again. No remote changes were made.", retryable: false });
      else throw problem;
    }
  };
  const checkHealth = async () => {
    if (!bucket) return;
    setBusy(true);
    const output: DomainHealthResult[] = [];
    for (const domain of bucket.domains.filter((item) => item.enabled)) {
      try { output.push(unwrap(await window.r2.buckets.checkDomain({ profileId, bucket: bucket.name, domain: domain.domain, key: healthKey || undefined }))); }
      catch (problem) { setError(errorData(problem)); }
    }
    setHealth(output);
    setBusy(false);
  };
  const peak = useMemo(() => analytics?.storage[0], [analytics]);
  const visibleAssets = useMemo(() => assets.filter((item) => (assetOrientation === "all" || item.orientation === assetOrientation) && (!assetMinWidth || (item.width ?? 0) >= assetMinWidth) && (!assetMinDuration || (item.durationSeconds ?? 0) >= assetMinDuration)), [assetMinDuration, assetMinWidth, assetOrientation, assets]);
  if (!bucket) return null;
  return <Modal open={open} onClose={onClose} title={`${tx("Bucket tools")} · ${bucket.name}`} description={tx("Analytics and policy operations use Cloudflare's authenticated account APIs.")}><div className="space-y-5">
    <SegmentedControl value={tab} onChange={(value) => setTab(value as Tab)} aria-label={tx("Bucket tool")}>{provider === "r2" ? <SegmentedControl.Option value="analytics">{tx("Usage")}</SegmentedControl.Option> : null}<SegmentedControl.Option value="index">{tx("Index")}</SegmentedControl.Option>{provider === "r2" ? <><SegmentedControl.Option value="lifecycle">{tx("Lifecycle")}</SegmentedControl.Option><SegmentedControl.Option value="cors">CORS</SegmentedControl.Option><SegmentedControl.Option value="events">{tx("Events")}</SegmentedControl.Option><SegmentedControl.Option value="health">{tx("Health")}</SegmentedControl.Option></> : null}</SegmentedControl>
    {error ? <ErrorPanel error={error} onRetry={() => void load()} /> : null}
    {busy && !error ? <p className="text-sm text-secondary">{tx("Reading live bucket state…")}</p> : null}
    {tab === "analytics" && analytics ? <div className="space-y-4">
      <SegmentedControl value={String(analyticsDays)} onChange={(value) => setAnalyticsDays(Number(value) as 1 | 7 | 31)} aria-label={tx("Analytics range")}><SegmentedControl.Option value="1">{tx("24 hours")}</SegmentedControl.Option><SegmentedControl.Option value="7">{tx("7 days")}</SegmentedControl.Option><SegmentedControl.Option value="31">{tx("31 days")}</SegmentedControl.Option></SegmentedControl>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><Metric label={tx("Objects")} value={analytics.totals.objectCount.toLocaleString()} /><Metric label={tx("Storage")} value={formatBytes(analytics.totals.storageBytes, bootstrap?.preferences.locale)} /><Metric label="Class A" value={analytics.totals.classA.toLocaleString()} /><Metric label="Class B" value={analytics.totals.classB.toLocaleString()} /></div>
      {analytics.storage.length || analytics.operations.length ? <div className="rounded-xl border border-subtle p-4"><p className="text-xs text-secondary">{tx("Estimated Standard-class cost for queried usage")}</p><p className="mt-1 text-2xl font-semibold">${analytics.estimate.amount.toFixed(2)} USD</p><div className="mt-3 grid gap-2 sm:grid-cols-3"><Quota label={tx("Storage free tier")} value={analytics.totals.storageBytes / 1_000_000_000} limit={analytics.estimate.freeTier.storageGbMonth} suffix={tx("GB-month snapshot")} /><Quota label={tx("Class A free tier")} value={analytics.totals.classA} limit={analytics.estimate.freeTier.classA} suffix={tx("requests")} /><Quota label={tx("Class B free tier")} value={analytics.totals.classB} limit={analytics.estimate.freeTier.classB} suffix={tx("requests")} /></div><p className="mt-3 text-xs text-tertiary">{zh ? `估算使用最新的 Standard 存储快照和这 ${analyticsDays} 天查询中观察到的操作。它不是账单；账号级免费额度共享、每日 GB-month 平均值、低频存储、读取费用、税费和分析延迟都可能改变实际费用。` : analytics.estimate.note}</p><Button className="mt-2" color="secondary" variant="ghost" size="xs" onClick={() => void window.r2.system.openExternal(analytics.estimate.pricingSource)}>{zh ? `定价核对于 ${analytics.estimate.pricingUpdatedAt}` : `Pricing checked ${analytics.estimate.pricingUpdatedAt}`}</Button></div> : <Alert color="warning" title={tx("No billable analytics samples returned")} description={tx("R2Uploader will not present a zero-cost claim without source data. Check Analytics Read permission or try a longer range.")} />}
      {analytics.storage.length || analytics.operations.length ? <div className="grid gap-2 sm:grid-cols-4"><Metric label={tx("Estimated storage")} value={`$${analytics.estimate.breakdown.storage.toFixed(4)}`} /><Metric label={tx("Estimated Class A")} value={`$${analytics.estimate.breakdown.classA.toFixed(4)}`} /><Metric label={tx("Estimated Class B")} value={`$${analytics.estimate.breakdown.classB.toFixed(4)}`} /><Metric label={tx("Internet egress price")} value="$0" /></div> : null}
      {analytics.insights.abnormalStorageGrowth ? <Alert color="warning" title={tx("Unusual storage growth detected")} description={zh ? `与所选区间最早样本相比，存储增加了 ${formatBytes(analytics.insights.storageGrowthBytes ?? 0, bootstrap?.preferences.locale)}${analytics.insights.storageGrowthPercent !== undefined ? `（${analytics.insights.storageGrowthPercent.toFixed(1)}%）` : ""}。这是趋势提醒，不是账单告警；请核对近期批量上传、同步和自动化。` : `Storage increased by ${formatBytes(analytics.insights.storageGrowthBytes ?? 0, bootstrap?.preferences.locale)}${analytics.insights.storageGrowthPercent !== undefined ? ` (${analytics.insights.storageGrowthPercent.toFixed(1)}%)` : ""} from the oldest sample in this range. This is a trend signal, not a billing alert; review recent batch uploads, syncs, and automations.`} /> : null}
      <Alert color={analytics.insights.unknownRequests ? "warning" : "info"} title={tx("Cost coverage and exclusions")} description={zh ? `R2 当前互联网出口单价为 $0，但此查询不测量带宽。低频存储读取量和对应读取费用未由这组 Analytics 数据返回，因此未计入估算。${analytics.insights.unknownRequests ? `另有 ${analytics.insights.unknownRequests.toLocaleString()} 次未识别操作未计价。` : ""}` : `R2 internet egress is currently priced at $0, but this query does not measure bandwidth. Infrequent Access retrieval volume and retrieval fees are not returned by these Analytics groups and are excluded.${analytics.insights.unknownRequests ? ` ${analytics.insights.unknownRequests.toLocaleString()} unclassified requests are also unpriced.` : ""}`} />
      <Alert color="info" title={zh ? `Cloudflare Analytics · 保留 ${analytics.retentionDays} 天` : `Cloudflare Analytics · ${analytics.retentionDays}-day retention`} description={zh ? `范围 ${formatDate(analytics.from, bootstrap?.preferences.locale)} – ${formatDate(analytics.to, bootstrap?.preferences.locale)}。分析数据可能落后于实时对象状态。${peak ? `最新样本：${formatDate(peak.at, bootstrap?.preferences.locale)}。` : ""}` : `Range ${formatDate(analytics.from, bootstrap?.preferences.locale)} – ${formatDate(analytics.to, bootstrap?.preferences.locale)}. Analytics may lag behind live object state.${peak ? ` Latest sample: ${formatDate(peak.at, bootstrap?.preferences.locale)}.` : ""}`} />
      {analytics.operations.length ? <div className="max-h-44 overflow-auto rounded-xl border border-subtle">{analytics.operations.map((item) => <div key={item.actionType} className="flex justify-between border-b border-subtle px-3 py-2 text-xs last:border-0"><span>{item.actionType} <Badge color="secondary" size="sm">{item.pricingClass}</Badge></span><span>{item.requests.toLocaleString()}</span></div>)}</div> : <p className="text-sm text-secondary">{tx("No operations were returned for this range.")}</p>}
    </div> : null}
    {tab === "index" ? <div className="space-y-4">
      <Alert color="info" title={tx("Local, rebuildable index")} description={tx("Dimensions and checksums are captured for local uploads. A remote rebuild restores object basics without pretending unknown content properties were discovered.")} />
      <div className="flex gap-2"><Input className="flex-1" value={assetQuery} onChange={(event) => setAssetQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void load(); }} placeholder={tx("Search key, MIME type, tag, or description")} /><Button color="secondary" variant="outline" onClick={() => void load()}>{tx("Search")}</Button><Button color="primary" variant="outline" onClick={async () => { setBusy(true); try { unwrap(await window.r2.assets.rebuild({ profileId, bucket: bucket.name })); setAssets(unwrap(await window.r2.assets.list({ profileId, bucket: bucket.name, query: assetQuery || undefined }))); } catch (problem) { setError(errorData(problem)); } finally { setBusy(false); } }}>{tx("Rebuild")}</Button></div>
      <div className="grid gap-2 sm:grid-cols-3"><label className="text-xs font-medium">{tx("Orientation")}<select className="mt-1 h-8 w-full rounded-lg border border-default bg-surface px-2 text-sm" value={assetOrientation} onChange={(event) => setAssetOrientation(event.target.value as typeof assetOrientation)}><option value="all">{tx("Any orientation")}</option><option value="landscape">{tx("Landscape")}</option><option value="portrait">{tx("Portrait")}</option><option value="square">{tx("Square")}</option></select></label><label className="text-xs font-medium">{tx("Minimum width")}<Input className="mt-1" type="number" min={0} value={assetMinWidth} onChange={(event) => setAssetMinWidth(Number(event.target.value))} /></label><label className="text-xs font-medium">{tx("Minimum duration (seconds)")}<Input className="mt-1" type="number" min={0} value={assetMinDuration} onChange={(event) => setAssetMinDuration(Number(event.target.value))} /></label></div>
      {bootstrap?.preferences.ai.enabled ? <div className="rounded-xl bg-surface-secondary p-3"><div className="flex gap-2"><Input className="flex-1" value={semanticQuery} onChange={(event) => setSemanticQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && semanticQuery.trim()) void (async () => { try { setSemanticResults(unwrap(await window.r2.ai.semanticSearch({ profileId, bucket: bucket.name, query: semanticQuery, limit: 30 }))); } catch (problem) { setError(errorData(problem)); } })(); }} placeholder={tx("Semantic search, for example: calm blue hero image")} /><Button color="primary" variant="outline" disabled={!semanticQuery.trim()} onClick={async () => { try { setSemanticResults(unwrap(await window.r2.ai.semanticSearch({ profileId, bucket: bucket.name, query: semanticQuery, limit: 30 }))); } catch (problem) { setError(errorData(problem)); } }}>{tx("Semantic search")}</Button></div>{semanticResults.length ? <div className="mt-2 flex flex-wrap gap-2">{semanticResults.map((result) => <button key={result.asset.id} type="button" className="rounded-lg border border-subtle bg-surface px-2 py-1 text-left text-xs" onClick={() => setAssetQuery(result.asset.key)}><span className="font-medium">{result.asset.key}</span> · {Math.round(result.score * 100)}%</button>)}</div> : <p className="mt-2 text-xs text-tertiary">{tx("Only manually analyzed assets with the current embedding model participate.")}</p>}</div> : <Alert color="info" title={tx("Optional AI indexing is off")} description={tx("Enable it in Settings to manually create visual tags and semantic vectors. Local search and manual tags remain available without OpenAI.")} />}
      <p className="text-xs text-secondary">{zh ? `${visibleAssets.length}/${assets.length} 个已索引素材 · ${assets.filter((item) => item.checksum).length} 个含内容校验和 · ${assets.filter((item) => item.width && item.height).length} 个含尺寸 · ${assets.filter((item) => item.durationSeconds).length} 个含媒体时长` : `${visibleAssets.length}/${assets.length} indexed assets · ${assets.filter((item) => item.checksum).length} with content checksums · ${assets.filter((item) => item.width && item.height).length} with dimensions · ${assets.filter((item) => item.durationSeconds).length} with media duration`}</p>
      <div className="max-h-80 overflow-auto rounded-xl border border-subtle">{visibleAssets.map((item) => <div key={item.id} className="border-b border-subtle p-3 last:border-0"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{item.key} {item.embedding ? <Badge color="success" size="sm">{tx("AI indexed")}</Badge> : null}</p><p className="mt-1 text-xs text-secondary">{formatBytes(item.size, bootstrap?.preferences.locale)}{item.width && item.height ? ` · ${item.width}×${item.height} · ${tx(item.orientation ?? "")}` : ""}{item.durationSeconds ? ` · ${item.durationSeconds.toFixed(1)}s` : ""} · {tx(item.source === "upload" ? "verified upload" : "remote basic record")}</p><p className="mt-1 text-xs text-tertiary">{item.tags.length ? item.tags.join(" · ") : tx("No tags")}{item.aiDescription ? ` · ${item.aiDescription}` : ""}</p></div><div className="flex shrink-0 gap-1">{bootstrap?.preferences.ai.enabled && (item.contentType?.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(item.key)) ? <Button color="primary" variant="ghost" size="xs" loading={analyzingId === item.id} onClick={async () => { if (!window.confirm(zh ? `使用 OpenAI 分析 ${item.key}？\n\n只会为此次请求发送缩小后的 JPEG 副本；OpenAI API 使用可能产生费用。` : `Analyze ${item.key} with OpenAI?\n\nA resized JPEG copy will be sent only for this request. OpenAI API usage may incur charges.`)) return; setAnalyzingId(item.id); try { const result = unwrap<AiAnalysisResult>(await window.r2.ai.analyze(item.id)); setAssets((current) => current.map((entry) => entry.id === item.id ? result.asset : entry)); setError(null); } catch (problem) { setError(errorData(problem)); } finally { setAnalyzingId(null); } }}>{tx("Analyze")}</Button> : null}<Button color="secondary" variant="ghost" size="xs" onClick={async () => { const value = window.prompt(tx("Comma-separated local tags"), item.tags.join(", ")); if (value === null) return; const updated = unwrap<AssetIndexRecord | null>(await window.r2.assets.update({ id: item.id, tags: value.split(",").map((tag) => tag.trim()).filter(Boolean) })); if (updated) setAssets((current) => current.map((entry) => entry.id === item.id ? updated : entry)); }}>{tx("Tags")}</Button></div></div></div>)}</div>
    </div> : null}
    {tab === "lifecycle" ? <div className="space-y-4">
      <Alert color="warning" title={tx("Rules run remotely and can delete data")} description={tx("Preview counts are a current prefix sample, not a prediction. Disabled rules are stored but do not execute.")} />
      {lifecycle.map((rule) => <div key={rule.id} className="flex items-start justify-between gap-3 rounded-xl border border-subtle p-3"><div><p className="text-sm font-medium">{rule.id} <Badge color={rule.enabled ? "success" : "secondary"}>{tx(rule.enabled ? "Enabled" : "Disabled")}</Badge></p><p className="mt-1 text-xs text-secondary">/{rule.prefix} · {rule.deleteAfterDays ? `${zh ? "删除于" : "delete after"} ${rule.deleteAfterDays}d` : tx("no delete")}{rule.transitionToInfrequentAfterDays ? ` · ${zh ? "转为低频存储于" : "Infrequent after"} ${rule.transitionToInfrequentAfterDays}d` : ""}</p></div><Button color="danger" variant="ghost" size="xs" onClick={() => void saveLifecycle(lifecycle.filter((item) => item.id !== rule.id))}>{tx("Remove")}</Button></div>)}
      <div className="rounded-xl bg-surface-secondary p-3"><div className="grid gap-2 sm:grid-cols-2"><Input value={draftRule.id} onChange={(event) => setDraftRule((current) => ({ ...current, id: event.target.value.replace(/[^a-zA-Z0-9._-]/g, "") }))} placeholder="rule-id" /><Input value={draftRule.prefix} onChange={(event) => setDraftRule((current) => ({ ...current, prefix: event.target.value.replace(/^\/+/, "") }))} placeholder={tx("prefix/ (empty means all objects)")} /><Input type="number" min={1} value={draftRule.deleteAfterDays ?? ""} onChange={(event) => setDraftRule((current) => ({ ...current, deleteAfterDays: event.target.value ? Number(event.target.value) : undefined }))} placeholder={tx("Delete after days")} /><Input type="number" min={30} value={draftRule.transitionToInfrequentAfterDays ?? ""} onChange={(event) => setDraftRule((current) => ({ ...current, transitionToInfrequentAfterDays: event.target.value ? Number(event.target.value) : undefined }))} placeholder={tx("Infrequent after ≥30 days")} /></div><div className="mt-3 flex items-center justify-between"><p className="text-xs text-secondary">{impact ? `${impact.truncated ? tx("At least") + " " : ""}${impact.count} ${tx("current objects")} · ${formatBytes(impact.bytes, bootstrap?.preferences.locale)}` : tx("Estimate the current prefix before saving.")}</p><div className="flex gap-2"><Button color="secondary" variant="outline" size="sm" onClick={() => void estimateImpact()}>{tx("Preview impact")}</Button><Button color="primary" size="sm" disabled={!draftRule.id || (!draftRule.deleteAfterDays && !draftRule.transitionToInfrequentAfterDays && !draftRule.abortMultipartAfterDays)} onClick={() => void saveLifecycle([...lifecycle.filter((item) => item.id !== draftRule.id), draftRule])}>{tx("Save rule")}</Button></div></div></div>
      <details className="rounded-xl border border-subtle p-3"><summary className="cursor-pointer text-sm font-medium">{tx("Advanced JSON editor and export")}</summary><textarea className="mt-3 min-h-56 w-full rounded-lg border border-default bg-surface p-3 font-mono text-xs" value={lifecycleText} onChange={(event) => setLifecycleText(event.target.value)} spellCheck={false} /><div className="mt-2 flex flex-wrap justify-end gap-2"><Button color="secondary" variant="ghost" size="sm" onClick={() => void window.r2.system.copyText(lifecycleText)}>{tx("Copy JSON")}</Button><Button color="secondary" variant="outline" size="sm" onClick={() => void window.r2.system.exportText({ defaultName: `${bucket.name}-lifecycle.json`, extension: "json", text: lifecycleText })}>{tx("Export JSON")}</Button><Button color="warning" variant="outline" size="sm" onClick={() => void applyLifecycleJson()}>{tx("Validate and apply JSON")}</Button></div></details>
    </div> : null}
    {tab === "cors" ? <div className="space-y-4">
      <Alert color="info" title={tx("CORS is not an access-control replacement")} description={tx("It controls browser cross-origin behavior. Public access and presigned-link authorization remain separate.")} />
      <label className="block text-sm font-medium">{tx("Allowed website origin")}<Input className="mt-2" value={origin} onChange={(event) => setOrigin(event.target.value)} placeholder="https://www.example.com" /></label>
      <div className="flex flex-wrap gap-2"><Button color="secondary" variant="outline" onClick={() => void saveCors([{ id: "public-assets", origins: [origin], methods: ["GET", "HEAD"], exposeHeaders: ["ETag", "Content-Length", "Content-Type", "cf-cache-status"], maxAgeSeconds: 3600 }])}>{tx("Public asset preset")}</Button><Button color="secondary" variant="outline" onClick={() => void saveCors([{ id: "browser-upload", origins: [origin], methods: ["GET", "HEAD", "PUT", "POST"], headers: ["Content-Type"], exposeHeaders: ["ETag"], maxAgeSeconds: 3600 }])}>{tx("Presigned upload preset")}</Button><Button color="danger" variant="outline" onClick={() => void saveCors([])}>{tx("Remove CORS")}</Button>{previousCors ? <Button color="warning" variant="outline" onClick={() => void saveCors(previousCors, false)}>{tx("Restore previous")}</Button> : null}</div>
      <div><p className="mb-1 text-xs font-medium">{tx("Current remote policy · editable JSON")}</p><textarea className="min-h-64 w-full rounded-xl border border-default bg-surface p-3 font-mono text-xs" value={corsText} onChange={(event) => setCorsText(event.target.value)} spellCheck={false} /><div className="mt-2 flex flex-wrap justify-end gap-2"><Button color="secondary" variant="ghost" size="sm" onClick={() => void window.r2.system.copyText(corsText)}>{tx("Copy JSON")}</Button><Button color="secondary" variant="outline" size="sm" onClick={() => void window.r2.system.exportText({ defaultName: `${bucket.name}-cors.json`, extension: "json", text: corsText })}>{tx("Export JSON")}</Button><Button color="warning" variant="outline" size="sm" onClick={() => void applyCorsJson()}>{tx("Validate and apply JSON")}</Button></div></div>
    </div> : null}
    {tab === "events" ? <div className="space-y-4">
      <Alert color="warning" title={tx("Use a dedicated Cloudflare Queue")} description={tx("R2Uploader creates an object-change notification rule, pulls that Queue over HTTPS, acknowledges its messages, and refreshes matching open buckets. Do not enter a Queue consumed by another application. If Queue permissions fail, the configured polling interval remains active.")} />
      <div className="flex gap-2"><Input className="flex-1" value={queueId} onChange={(event) => setQueueId(event.target.value.trim())} placeholder={tx("32-character Cloudflare Queue ID")} /><Button color="primary" disabled={!/^[a-fA-F0-9]{32}$/.test(queueId)} onClick={async () => { if (!window.confirm(tx("I confirm this Queue is dedicated to R2Uploader and its messages may be acknowledged by this desktop app."))) return; setBusy(true); try { unwrap(await window.r2.buckets.subscribeEventRefresh({ profileId, bucket: bucket.name, queueId, dedicatedQueueConfirmation: true })); setQueueId(""); await load(); } catch (problem) { setError(errorData(problem)); } finally { setBusy(false); } }}>{tx("Connect")}</Button></div>
      {eventSubscriptions.map((item) => <div key={item.id} className="rounded-xl border border-subtle p-3"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium">{item.queueName || item.queueId} <Badge color={item.status === "active" ? "success" : item.status === "fallback-polling" ? "warning" : "secondary"}>{tx(item.status)}</Badge></p><p className="mt-1 text-xs text-secondary">Queue {item.queueId} · {zh ? "检查于" : "checked"} {formatDate(item.lastCheckedAt, bootstrap?.preferences.locale)}</p><p className="mt-1 text-xs text-tertiary">{item.lastEventAt ? `${zh ? "上次 R2 事件" : "Last R2 event"} ${formatDate(item.lastEventAt, bootstrap?.preferences.locale)}` : tx("No event received yet")}{item.lastError ? ` · ${item.lastError.message}` : ""}</p></div><Button color="secondary" variant="outline" size="xs" onClick={async () => { unwrap(await window.r2.buckets.pauseEventRefresh({ id: item.id, paused: item.enabled })); await load(); }}>{tx(item.enabled ? "Pause pull" : "Resume pull")}</Button></div></div>)}
      {!eventSubscriptions.length ? <p className="text-sm text-secondary">{tx("No Queue is connected. Local app actions still refresh immediately; external changes use fallback polling.")}</p> : null}
      <Button color="secondary" variant="ghost" size="sm" onClick={() => void window.r2.system.openExternal("https://developers.cloudflare.com/r2/buckets/event-notifications/")}>{tx("Cloudflare setup guide")}</Button>
    </div> : null}
    {tab === "health" ? <div className="space-y-4">
      <Input value={healthKey} onChange={(event) => setHealthKey(event.target.value.replace(/^\/+/, ""))} placeholder={tx("Optional known public object key")} />
      <Button color="primary" loading={busy} disabled={!bucket.domains.some((domain) => domain.enabled)} onClick={() => void checkHealth()}>{tx("Check enabled domains")}</Button>
      {!bucket.domains.some((domain) => domain.enabled) ? <Alert color="info" title={tx("No enabled public domain")} description={tx("Private authenticated access can still work normally. Enable a public domain only if permanent public URLs are required.")} /> : null}
      {health.map((item) => <div key={item.url} className="rounded-xl border border-subtle p-3"><div className="flex items-center justify-between"><p className="truncate text-sm font-medium">{item.url}</p><Badge color={item.http === "ok" ? "success" : item.http === "warning" ? "warning" : "danger"}>{item.status ?? tx(item.http)}</Badge></div><p className="mt-2 text-xs text-secondary">DNS {tx(item.dns)} · TLS {tx(item.tls)} · {item.latencyMs ?? "—"}ms · {zh ? "缓存" : "cache"} {item.cacheStatus ?? tx("not reported")}</p><p className="mt-1 text-xs text-tertiary">{zh ? (item.dns === "failed" ? "DNS 解析失败，因此未尝试 TLS 和 HTTP。请检查域名记录与本机网络解析器。" : item.tls === "failed" ? "DNS 已解析，但可信 TLS 握手失败。请检查证书状态、域名绑定和本机网络。" : item.http === "ok" ? "DNS、TLS 和 HTTP 均响应正常。" : item.status ? `HTTPS 返回 ${item.status}。私有对象或不存在的对象可能出现此结果；请检查公开访问状态和测试 Key。` : "DNS 和 TLS 正常，但 HTTP 请求失败；请检查网络代理、WAF 和服务状态。") : item.detail}</p></div>)}
    </div> : null}
    <div className="flex justify-end"><Button color="secondary" variant="outline" onClick={onClose}>{tx("Close")}</Button></div>
  </div></Modal>;
};

const Metric = ({ label, value }: { label: string; value: string }) => <div className="rounded-xl bg-surface-secondary p-3"><p className="text-xs text-secondary">{label}</p><p className="mt-1 text-lg font-semibold">{value}</p></div>;
const Quota = ({ label, value, limit, suffix }: { label: string; value: number; limit: number; suffix: string }) => { const percent = Math.min(100, limit ? value / limit * 100 : 0); return <div><div className="flex justify-between gap-2 text-[11px] text-secondary"><span>{label}</span><span>{Math.round(percent)}%</span></div><div className="progress-track mt-1"><div className="progress-bar" style={{ width: `${percent}%` }} /></div><p className="mt-1 text-[10px] text-tertiary">{value.toLocaleString(undefined, { maximumFractionDigits: 2 })} / {limit.toLocaleString()} {suffix}</p></div>; };
