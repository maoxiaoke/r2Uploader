import { useCallback, useEffect, useMemo, useState } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import { Alert } from "@openai/apps-sdk-ui/components/Alert";
import { Badge } from "@openai/apps-sdk-ui/components/Badge";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { EmptyMessage } from "@openai/apps-sdk-ui/components/EmptyMessage";
import { Input } from "@openai/apps-sdk-ui/components/Input";
import { ArrowRight, Globe, History, Lock, Love, Plus, Search, Storage, Trash } from "@openai/apps-sdk-ui/components/Icon";
import type { AppErrorData, BucketItem } from "../../shared/contracts";
import { isDomainReady, isUsableDomain } from "../../shared/domain-status";
import { ConnectionEditor } from "../components/new/connection-editor";
import { ErrorPanel } from "../components/new/error-panel";
import { Modal } from "../components/new/modal";
import { useAppState } from "../context/app-state";
import { errorData, unwrap } from "../lib/ipc";
import { formatDate } from "../lib/format";

const accessBadge = (access: BucketItem["access"]) =>
  access === "private"
    ? { color: "secondary" as const, key: "private" as const }
    : access === "public-custom"
      ? { color: "info" as const, key: "publicCustom" as const }
      : { color: "warning" as const, key: "publicManaged" as const };

export default function HomePage() {
  const router = useRouter();
  const { activeProfile, bootstrap, t, tx, updatePreferences } = useAppState();
  const zh = bootstrap?.preferences.locale === "zh-CN";
  const [buckets, setBuckets] = useState<BucketItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AppErrorData | null>(null);
  const [search, setSearch] = useState("");
  const [syncedAt, setSyncedAt] = useState<string>();
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [bucketName, setBucketName] = useState("");
  const [creating, setCreating] = useState(false);
  const [domainBucket, setDomainBucket] = useState<BucketItem | null>(null);
  const [customDomain, setCustomDomain] = useState("");
  const [customZoneId, setCustomZoneId] = useState("");
  const [domainBusy, setDomainBusy] = useState(false);

  const load = useCallback(async () => {
    if (!activeProfile) {
      setBuckets([]);
      setError(null);
      return;
    }
    setLoading(true);
    try {
      setBuckets(unwrap<BucketItem[]>(await window.r2.buckets.list(activeProfile.id)));
      setSyncedAt(new Date().toISOString());
      setError(null);
    } catch (problem) {
      setError(errorData(problem));
    } finally {
      setLoading(false);
    }
  }, [activeProfile]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(
    () => buckets.filter((bucket) => bucket.name.toLowerCase().includes(search.trim().toLowerCase())),
    [buckets, search]
  );
  const savedLocations = useMemo(() => {
    const parse = (value: string) => {
      const first = value.indexOf(":");
      const second = value.indexOf(":", first + 1);
      return first > 0 && second > first ? { profileId: value.slice(0, first), bucket: value.slice(first + 1, second), prefix: value.slice(second + 1) } : null;
    };
    const own = (values: string[]) => values.map(parse).filter((value): value is NonNullable<typeof value> => Boolean(value && value.profileId === activeProfile?.id));
    return {
      favorites: own(bootstrap?.preferences.favoriteLocations ?? []),
      recent: own(bootstrap?.preferences.recentLocations ?? []).slice(0, 6),
    };
  }, [activeProfile?.id, bootstrap?.preferences.favoriteLocations, bootstrap?.preferences.recentLocations]);
  const openLocation = (location: { bucket: string; prefix: string }) => {
    const delimiter = location.prefix.split("/").filter(Boolean);
    return router.push({ pathname: "/bucket/[name]/delimiter/[[...delimiter]]", query: { name: location.bucket, ...(delimiter.length ? { delimiter } : {}) } });
  };

  const createBucket = async () => {
    if (!activeProfile) return;
    setCreating(true);
    try {
      unwrap(await window.r2.buckets.create({ profileId: activeProfile.id, name: bucketName }));
      setBucketName("");
      setCreateOpen(false);
      await load();
    } catch (problem) {
      setError(errorData(problem));
    } finally {
      setCreating(false);
    }
  };

  const deleteBucket = async (bucket: BucketItem) => {
    if (!activeProfile) return;
    const confirmation = window.prompt(zh ? `删除存储桶是永久操作，并且只会在存储桶为空时成功。\n\n输入“${bucket.name}”继续：` : `Bucket deletion is permanent and only succeeds when the bucket is empty.\n\nType “${bucket.name}” to continue:`);
    if (confirmation !== bucket.name) return;
    try {
      unwrap(await window.r2.buckets.delete({ profileId: activeProfile.id, name: bucket.name, confirmation }));
      await load();
    } catch (problem) {
      setError(errorData(problem));
    }
  };
  const setManagedDomain = async (bucket: BucketItem, enabled: boolean) => {
    if (!activeProfile) return;
    const verb = enabled ? "enable public r2.dev access for" : "disable public r2.dev access for";
    if (!window.confirm(zh ? `这会为“${bucket.name}”中的每个对象${enabled ? "启用" : "停用"}公开 r2.dev 访问，是否继续？` : `This will ${verb} every object in “${bucket.name}”. Continue?`)) return;
    try {
      unwrap(await window.r2.buckets.setManagedDomain({ profileId: activeProfile.id, bucket: bucket.name, enabled, confirmation: true }));
      await load();
      setDomainBucket((current) => current ? { ...current, domains: current.domains.map((domain) => domain.type === "managed" ? { ...domain, enabled } : domain), access: enabled ? "public-managed" : current.domains.some((domain) => domain.type === "custom" && domain.enabled) ? "public-custom" : "private" } : null);
    } catch (problem) { setError(errorData(problem)); }
  };
  const refreshDomainBucket = async (bucketName: string) => {
    if (!activeProfile) return;
    const items = unwrap<BucketItem[]>(await window.r2.buckets.list(activeProfile.id));
    setBuckets(items);
    setSyncedAt(new Date().toISOString());
    setDomainBucket(items.find((item) => item.name === bucketName) ?? null);
  };
  const attachCustomDomain = async () => {
    if (!activeProfile || !domainBucket || !window.confirm(zh ? `将 ${customDomain} 连接到 ${domainBucket.name}？\n\n新域名会先以“已停用”状态连接，不会立即公开对象。` : `Attach ${customDomain} to ${domainBucket.name}?\n\nThe domain is attached disabled and will not expose objects yet.`)) return;
    setDomainBusy(true);
    try { unwrap(await window.r2.buckets.attachCustomDomain({ profileId: activeProfile.id, bucket: domainBucket.name, domain: customDomain, zoneId: customZoneId, confirmation: true })); setCustomDomain(""); setCustomZoneId(""); await refreshDomainBucket(domainBucket.name); setError(null); }
    catch (problem) { setError(errorData(problem)); } finally { setDomainBusy(false); }
  };
  const updateCustomDomain = async (domain: string, enabled: boolean) => {
    if (!activeProfile || !domainBucket || !window.confirm(zh ? `${enabled ? "启用" : "停用"} ${domain} 的公开存储桶访问？其他域名不会受影响。` : `${enabled ? "Enable" : "Disable"} public bucket access through ${domain}? Other domains are unaffected.`)) return;
    setDomainBusy(true);
    try { unwrap(await window.r2.buckets.updateCustomDomain({ profileId: activeProfile.id, bucket: domainBucket.name, domain, enabled, confirmation: true })); await refreshDomainBucket(domainBucket.name); setError(null); }
    catch (problem) { setError(errorData(problem)); } finally { setDomainBusy(false); }
  };
  const removeCustomDomain = async (domain: string) => {
    if (!activeProfile || !domainBucket) return;
    const confirmation = window.prompt(zh ? `移除会断开 ${domain} 并删除对应的 CNAME 配置。\n\n输入完整域名确认：` : `Removing disconnects ${domain} and deletes its CNAME configuration.\n\nType the full domain to confirm:`);
    if (confirmation !== domain) return;
    setDomainBusy(true);
    try { unwrap(await window.r2.buckets.removeCustomDomain({ profileId: activeProfile.id, bucket: domainBucket.name, domain, confirmation })); await refreshDomainBucket(domainBucket.name); setError(null); }
    catch (problem) { setError(errorData(problem)); } finally { setDomainBusy(false); }
  };

  return (
    <>
      <Head><title>{t("appName")}</title></Head>
      <div className="page-scroll">
        <div className="page-container">
          {!activeProfile ? (
            <div className="mx-auto flex min-h-[65vh] max-w-xl items-center justify-center">
              <EmptyMessage fill="none">
                <EmptyMessage.Icon size="md"><Lock /></EmptyMessage.Icon>
                <EmptyMessage.Title>{t("noConnectionTitle")}</EmptyMessage.Title>
                <EmptyMessage.Description>{t("noConnectionDescription")}</EmptyMessage.Description>
                <EmptyMessage.ActionRow><Button color="primary" size="lg" onClick={() => setConnectionOpen(true)}><Plus />{t("createConnection")}</Button></EmptyMessage.ActionRow>
              </EmptyMessage>
            </div>
          ) : (
            <>
              <header className="flex flex-wrap items-end justify-between gap-5">
                <div>
                  <p className="text-sm text-secondary">{activeProfile.name} · …{activeProfile.accountId.slice(-6)}</p>
                  <h1 className="heading-xl mt-1">{t("bucketsTitle")}</h1>
                  <p className="mt-2 max-w-2xl text-sm text-secondary">{activeProfile.provider === "r2" ? t("bucketsDescription") : `${zh ? "私有 S3 兼容连接" : "Private S3-compatible connection"} · ${activeProfile.endpoint}`}</p>
                </div>
                <div className="window-no-drag flex gap-2">
                  <Button color="secondary" variant="outline" loading={loading} onClick={() => void load()}>{t("refresh")}</Button>
                  <Button color="primary" onClick={() => setCreateOpen(true)}><Plus />{t("createBucket")}</Button>
                </div>
              </header>

              <div className="mt-7 flex flex-wrap items-center justify-between gap-3">
                <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("searchBuckets")} startAdornment={<Search className="size-4" />} className="w-full max-w-sm" />
                {syncedAt ? <p className="text-xs text-tertiary">{t("lastSynced")} {formatDate(syncedAt, bootstrap?.preferences.locale)}</p> : null}
              </div>

              {savedLocations.favorites.length || savedLocations.recent.length ? (
                <section className="mt-5 grid gap-3 lg:grid-cols-2" aria-label={tx("Saved locations")}>
                  {savedLocations.favorites.length ? <div className="surface-card p-4"><h2 className="flex items-center gap-2 text-sm font-semibold"><Love className="size-4" />{tx("Favorites")}</h2><div className="mt-3 flex flex-wrap gap-2">{savedLocations.favorites.map((location) => <Button key={`${location.bucket}:${location.prefix}`} color="secondary" variant="outline" size="sm" onClick={() => void openLocation(location)}>{location.bucket}/{location.prefix}</Button>)}</div></div> : null}
                  {savedLocations.recent.length ? <div className="surface-card p-4"><h2 className="flex items-center gap-2 text-sm font-semibold"><History className="size-4" />{tx("Recent locations")}</h2><div className="mt-3 flex flex-wrap gap-2">{savedLocations.recent.map((location) => <Button key={`${location.bucket}:${location.prefix}`} color="secondary" variant="ghost" size="sm" onClick={() => void openLocation(location)}>{location.bucket}/{location.prefix || tx("root")}</Button>)}</div></div> : null}
                </section>
              ) : null}

              {error ? <div className="mt-5"><ErrorPanel error={error} onRetry={() => void load()} /></div> : null}
              {!error && loading && buckets.length === 0 ? <p className="mt-12 text-center text-sm text-secondary">{t("loading")}</p> : null}
              {!error && !loading && filtered.length === 0 ? (
                <div className="mt-12">
                  <EmptyMessage fill="none">
                    <EmptyMessage.Icon><Storage /></EmptyMessage.Icon>
                    <EmptyMessage.Title>{t("noBuckets")}</EmptyMessage.Title>
                    <EmptyMessage.Description>{search ? (zh ? `没有与“${search}”匹配的存储桶。` : `No bucket matches “${search}”.`) : t("noBucketsDescription")}</EmptyMessage.Description>
                    {!search ? <EmptyMessage.ActionRow><Button color="primary" onClick={() => setCreateOpen(true)}><Plus />{t("createBucket")}</Button></EmptyMessage.ActionRow> : null}
                  </EmptyMessage>
                </div>
              ) : null}

              <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {filtered.map((bucket) => {
                  const badge = accessBadge(bucket.access);
                  return (
                    <article key={bucket.name} className="surface-card interactive-card group p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-secondary"><Storage className="size-5" /></div>
                          <div className="min-w-0"><h2 className="truncate text-sm font-semibold">{bucket.name}</h2><p className="mt-0.5 text-xs text-tertiary">{formatDate(bucket.creationDate, bootstrap?.preferences.locale)}</p></div>
                        </div>
                        <Badge color={badge.color} size="sm">{t(badge.key)}</Badge>
                      </div>
                      <div className="mt-4 flex items-center justify-between gap-2 border-t border-subtle pt-3">
                        <p className="min-w-0 truncate text-xs text-secondary">{bucket.domains.filter((domain) => domain.enabled).map((domain) => domain.domain).join(", ") || tx("No public domain")}</p>
                        <div className="flex shrink-0 gap-1">
                          <Button color="danger" variant="ghost" size="sm" uniform aria-label={zh ? `删除 ${bucket.name}` : `Delete ${bucket.name}`} onClick={() => void deleteBucket(bucket)}><Trash /></Button>
                          {activeProfile.provider === "r2" ? <Button color="secondary" variant="ghost" size="sm" uniform aria-label={zh ? `${bucket.name} 的域名` : `Domains for ${bucket.name}`} onClick={() => setDomainBucket(bucket)}><Globe /></Button> : null}
                          <Button color="secondary" variant="outline" size="sm" onClick={() => void router.push(`/bucket/${encodeURIComponent(bucket.name)}/delimiter`)}>{t("open")}<ArrowRight /></Button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      <ConnectionEditor open={connectionOpen} profile={null} onClose={() => setConnectionOpen(false)} />
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title={t("createBucket")} description={t("bucketPrivateNotice")}>
        <div className="space-y-4">
          <Alert color="info" variant="soft" title={t("private")} description={t("bucketPrivateNotice")} />
          <label className="block space-y-1.5"><span className="text-sm font-medium">{t("bucketName")}</span><Input value={bucketName} onChange={(event) => setBucketName(event.target.value.toLowerCase())} placeholder="my-assets" autoFocus /></label>
          <div className="flex justify-end gap-2"><Button color="secondary" variant="outline" onClick={() => setCreateOpen(false)}>{t("cancel")}</Button><Button color="primary" loading={creating} disabled={activeProfile?.provider === "r2" ? !/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(bucketName) : !bucketName || /[/\\]/.test(bucketName)} onClick={() => void createBucket()}>{t("create")}</Button></div>
        </div>
      </Modal>
      <Modal open={Boolean(domainBucket)} onClose={() => setDomainBucket(null)} title={`${tx("Access")} · ${domainBucket?.name ?? ""}`} description={tx("Public domains are independent from private authenticated browsing.")}>
        {domainBucket ? <div className="space-y-4">
          <Alert color={domainBucket.access === "private" ? "success" : "warning"} variant="soft" title={tx(domainBucket.access === "private" ? "Private-first protection is active" : "This bucket has public access")} description={tx(domainBucket.access === "private" ? "Objects are available only through authenticated operations and temporary links." : "Anyone with a public URL may be able to access matching objects.")} />
          <div className="space-y-2">
            {domainBucket.domains.map((domain) => { const preferenceKey = `${activeProfile?.id}:${domainBucket.name}`; const preferred = bootstrap?.preferences.defaultShareDomains[preferenceKey] === domain.domain; const usable = isUsableDomain(domain); const ready = isDomainReady(domain); return <div key={`${domain.type}:${domain.domain}`} className="flex items-center justify-between gap-3 rounded-xl border border-subtle p-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{domain.domain} {preferred ? <Badge color="info" size="sm">{tx("Default")}</Badge> : null}</p><p className="text-xs text-secondary">{domain.type === "managed" ? "Cloudflare r2.dev" : tx("Custom domain")}{domain.ownership ? ` · ${zh ? "所有权" : "ownership"} ${tx(domain.ownership)}` : ""}{domain.ssl ? ` · SSL ${tx(domain.ssl)}` : ""}</p>{!ready ? <p className="mt-1 text-xs text-warning">{tx("Ownership or SSL is not active yet, so this domain cannot generate links.")}</p> : null}</div><div className="flex flex-wrap items-center justify-end gap-2"><Badge color={usable ? "warning" : domain.enabled ? "info" : "secondary"}>{tx(usable ? "Public" : domain.enabled ? "Initializing" : "Disabled")}</Badge>{usable && !preferred ? <Button color="secondary" variant="ghost" size="xs" onClick={() => void updatePreferences({ defaultShareDomains: { ...(bootstrap?.preferences.defaultShareDomains ?? {}), [preferenceKey]: domain.domain } })}>{tx("Use for links")}</Button> : null}{domain.type === "custom" ? <><Button color={domain.enabled ? "warning" : "primary"} variant="outline" size="xs" loading={domainBusy} disabled={!domain.enabled && !ready} onClick={() => void updateCustomDomain(domain.domain, !domain.enabled)}>{tx(domain.enabled ? "Disable" : "Enable")}</Button><Button color="danger" variant="ghost" size="xs" disabled={domainBusy} onClick={() => void removeCustomDomain(domain.domain)}>{tx("Remove")}</Button></> : null}</div></div>; })}
            {!domainBucket.domains.length ? <p className="rounded-xl bg-surface-secondary p-4 text-sm text-secondary">{tx("No public domain is configured.")}</p> : null}
          </div>
          <section className="rounded-xl border border-subtle p-3"><h3 className="text-sm font-medium">{tx("Attach custom domain")}</h3><p className="mt-1 text-xs text-secondary">{tx("The domain must belong to a Cloudflare zone in this account. It is attached disabled; enable public access separately after ownership and SSL become active.")}</p><div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]"><Input value={customDomain} onChange={(event) => setCustomDomain(event.target.value.trim().toLowerCase())} placeholder="assets.example.com" /><Input value={customZoneId} onChange={(event) => setCustomZoneId(event.target.value.trim())} placeholder={tx("32-character Zone ID")} /><Button color="primary" variant="outline" loading={domainBusy} disabled={!/^[a-z0-9.-]+$/.test(customDomain) || !/^[a-fA-F0-9]{32}$/.test(customZoneId)} onClick={() => void attachCustomDomain()}>{tx("Attach disabled")}</Button></div></section>
          <div className="flex flex-wrap justify-between gap-2">
            <div className="flex gap-2"><Button color="secondary" variant="outline" onClick={() => void window.r2.system.openExternal(`https://dash.cloudflare.com/${activeProfile?.accountId}/r2/overview`)}><Globe />{tx("Cloudflare Dashboard")}</Button><Button color="secondary" variant="ghost" loading={domainBusy} onClick={() => void refreshDomainBucket(domainBucket.name)}>{tx("Refresh states")}</Button></div>
            {domainBucket.domains.find((domain) => domain.type === "managed")?.enabled ? <Button color="danger" variant="outline" onClick={() => void setManagedDomain(domainBucket, false)}>{tx("Disable r2.dev")}</Button> : <Button color="warning" onClick={() => void setManagedDomain(domainBucket, true)}>{tx("Enable public r2.dev")}</Button>}
          </div>
        </div> : null}
      </Modal>
    </>
  );
}
